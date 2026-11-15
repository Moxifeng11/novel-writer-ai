/**
 * baseline-probe-service.ts — 写作效果基线采集（架构整改计划 §3.3）
 *
 * 目的：用**同一真实项目、同一模型**各跑一次「旧策略整份注入」与「新策略场景精确注入」，
 * 记录真实 prompt token，作为后续 C/B/A 阶段改善的对照基线。
 *
 * 不生成正文（maxTokens 很小），只量注入侧成本；结果同时进 usage-ledger 便于追溯。
 */

import { App, TFile } from 'obsidian';
import { createLogger } from '@/shared/logger';
import type { APIResponse } from '@/shared/api-types';

const log = createLogger('BaselineProbe');

/** 单策略探测结果 */
export interface ProbeSample {
    /** 输入字符数 */
    chars: number;
    /** 真实 prompt token */
    promptTokens: number;
    /** 本次调用总 token */
    totalTokens: number;
    /** 输出是否被截断（length 说明 maxTokens 太小，可忽略） */
    finishReason?: string;
    /** 失败原因 */
    error?: string;
}

/** 基线探测结果 */
export interface BaselineProbeResult {
    project: string;
    chapterName: string;
    model: string;
    /** 旧策略：整份注入 */
    full: ProbeSample;
    /** 新策略：场景精确注入 */
    scene: ProbeSample;
    /** prompt token 下降百分比（正数表示下降） */
    reductionPercent: number;
    /** 报告文本 */
    report: string;
}

/** AI 调用函数签名（便于测试注入） */
export type ProbeCaller = (system: string, user: string, model?: string) => Promise<APIResponse>;

/** 探测用系统提示（真实正文步的极简替代：同一 system，避免两策略 system 差异干扰对比） */
const PROBE_SYSTEM = '你是中文网文写手。只输出正文，不要解释。';

/**
 * 写作效果基线采集服务。
 */
export class BaselineProbeService {
    private readonly call: ProbeCaller;

    /**
     * @param app - Obsidian 应用
     * @param plugin - 插件实例（用于构造 AiEngine）
     * @param call - 可选 AI 调用实现（测试注入）
     */
    constructor(
        private readonly app: App,
        private readonly plugin: unknown,
        call: ProbeCaller,
    ) {
        this.call = call;
    }

    /**
     * 采集基线。
     *
     * @param project - 项目路径
     * @param chapterName - 章节名（用于定位 Scene 展开）
     * @param model - 模型（默认用插件默认模型）
     * @returns 基线结果
     */
    async probe(project: string, chapterName: string, model?: string): Promise<BaselineProbeResult> {
        const settings = (this.plugin as { settings?: Record<string, string> } | undefined)?.settings ?? {};
        const effectiveModel = model || settings['flashModel'] || settings['defaultModel'] || 'deepseek-chat';
        const files = await this.loadProjectFiles(project, chapterName);
        const fullPrompt = this.buildFullPrompt(files);
        const scenePrompt = this.buildScenePrompt(files);

        const full = await this.measure(fullPrompt, effectiveModel);
        const scene = await this.measure(scenePrompt, effectiveModel);
        const reductionPercent = full.promptTokens > 0
            ? Math.round((1 - scene.promptTokens / full.promptTokens) * 1000) / 10
            : 0;
        const report = [
            `【写作基线】项目：${project} · ${chapterName} · 模型：${effectiveModel}`,
            `旧策略（整份注入）：${full.chars} 字符 → prompt ${full.promptTokens} token`,
            `新策略（场景精确注入）：${scene.chars} 字符 → prompt ${scene.promptTokens} token`,
            `结论：prompt token ${reductionPercent >= 0 ? '下降' : '上升'} ${Math.abs(reductionPercent)}%`,
        ].join('\n');
        log.info(report);
        return { project, chapterName, model: effectiveModel, full, scene, reductionPercent, report };
    }

    /** 执行一次真实调用并取 usage */
    private async measure(prompt: string, model: string): Promise<ProbeSample> {
        try {
            const response = await this.call(PROBE_SYSTEM, prompt, model);
            if (response.error) {
                return { chars: prompt.length, promptTokens: 0, totalTokens: 0, error: response.error };
            }
            return {
                chars: prompt.length,
                promptTokens: response.usage?.prompt ?? 0,
                totalTokens: response.usage?.total ?? 0,
                finishReason: response.finishReason,
            };
        } catch (error) {
            return { chars: prompt.length, promptTokens: 0, totalTokens: 0, error: String(error) };
        }
    }

    /** 读取项目文件 */
    private async loadProjectFiles(project: string, chapterName: string): Promise<Record<string, string>> {
        const read = async (path: string): Promise<string> => {
            const file = this.app.vault.getAbstractFileByPath(path);
            if (!(file instanceof TFile)) return '';
            try { return await this.app.vault.read(file); } catch { // silent-ok: 缺文件按空处理
                return '';
            }
        };
        const worldview = await read(`${project}/01-世界架构/世界观总览.md`);
        const settingLib = await read(`${project}/01-世界架构/设定库.md`);
        const characters: string[] = [];
        const charFolder = this.app.vault.getAbstractFileByPath(`${project}/01-世界架构/人物`);
        if (charFolder && 'children' in charFolder) {
            for (const child of (charFolder as { children: unknown[] }).children) {
                if (child instanceof TFile && child.extension === 'md') characters.push(await read(child.path));
            }
        }
        const timeline = await read(`${project}/02-时间线与伏笔/时间线看板.md`);
        const foreshadow = await read(`${project}/02-时间线与伏笔/伏笔库.md`);
        const outline = await this.findBySuffix(project, '分卷大纲').then(path => (path ? read(path) : ''));
        const sceneExpand = await this.findBySuffix(project, '_Scene展开', chapterName).then(path => (path ? read(path) : ''));
        return { worldview, settingLib, characters: characters.join('\n'), timeline, foreshadow, outline, sceneExpand };
    }

    /** 旧策略：全部整份塞入 */
    private buildFullPrompt(files: Record<string, string>): string {
        return [
            '【世界观】', files['worldview'], '',
            '【设定库】', files['settingLib'], '',
            '【人物】', files['characters'], '',
            '【时间线】', files['timeline'], '',
            '【伏笔】', files['foreshadow'], '',
            '【分卷大纲】', files['outline'], '',
            '【本章场景】', files['sceneExpand'], '',
            '请写本章开头 200 字。',
        ].join('\n');
    }

    /** 新策略：场景精确注入（在场人物 + 相关伏笔 + 关键设定，截断整库） */
    private buildScenePrompt(files: Record<string, string>): string {
        const scene = files['sceneExpand'] || '';
        const names = this.extractSceneNames(scene);
        const charBlocks = files['characters']
            .split('\n# ')
            .filter(block => block.trim())
            .map(block => (block.startsWith('# ') ? block : `# ${block}`))
            .filter(block => names.some(name => block.includes(name)));
        const foreshadowLines = files['foreshadow']
            .split('\n')
            .filter(line => line.includes('|') && names.some(name => line.includes(name)) || /断剑/.test(line))
            .slice(0, 5);
        const timelineLines = files['timeline']
            .split('\n')
            .filter(line => line.includes('|') && names.some(name => line.includes(name)))
            .slice(0, 5);
        const settingYears = this.pickSection(files['settingLib'], ['修炼境界', '货币']);
        return [
            '【当前场景】', scene, '',
            '【在场人物】', charBlocks.join('\n\n'), '',
            '【相关设定】', settingYears, '',
            '【相关时间线】', timelineLines.join('\n'), '',
            '【相关伏笔】', foreshadowLines.join('\n'), '',
            '请写本章开头 200 字。',
        ].join('\n');
    }

    /** 提取场景中的在场人物名（- 在场人物：甲、乙） */
    private extractSceneNames(scene: string): string[] {
        const names = new Set<string>();
        for (const line of scene.split('\n')) {
            const match = line.match(/在场人物[：:]\s*(.+)/);
            if (!match) continue;
            for (const name of match[1].split(/[、,，\s]+/)) {
                const trimmed = name.trim();
                if (trimmed) names.add(trimmed);
            }
        }
        return [...names];
    }

    /** 按 H2 标题挑选设定小节 */
    private pickSection(text: string, titles: readonly string[]): string {
        const blocks = String(text ?? '').split(/\n(?=## )/);
        return blocks.filter(block => titles.some(title => block.startsWith(`## ${title}`))).join('\n\n');
    }

    /** 深度优先按文件名后缀找文件 */
    private async findBySuffix(project: string, suffix: string, mustInclude?: string): Promise<string | null> {
        const root = this.app.vault.getAbstractFileByPath(project);
        if (!root || !Array.isArray((root as { children?: unknown }).children)) return null;
        const stack: Array<{ children: unknown[] }> = [root as unknown as { children: unknown[] }];
        while (stack.length > 0) {
            const current = stack.pop();
            if (!current) continue;
            for (const child of current.children) {
                if (child instanceof TFile) {
                    if (child.extension === 'md' && child.basename.endsWith(suffix) && (!mustInclude || child.path.includes(mustInclude))) {
                        return child.path;
                    }
                } else if (child && Array.isArray((child as { children?: unknown }).children)) {
                    stack.push(child as unknown as { children: unknown[] });
                }
            }
        }
        return null;
    }
}
