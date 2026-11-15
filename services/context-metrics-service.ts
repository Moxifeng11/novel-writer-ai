/**
 * context-metrics-service.ts — 注入量对比实测（M14 ②）
 *
 * 对比两种注入策略在同一真实项目上的**字符规模**：
 *  - before：旧策略（世界观/设定库/伏笔库/时间线看板/全部人物卡 整份注入）
 *  - after：新策略（当前场景精确上下文 + 断言约束 + 节奏报告）
 *
 * 不调用 AI，因此不需要 API Key；是「改造前后注入量」的可复现实测口径。
 */

import { App, TFile, TFolder } from 'obsidian';
import { createLogger } from '@/shared/logger';
import {
    compareMetrics,
    renderMetricsReport,
    type InjectionRecord,
    type MetricsComparison,
} from '@/shared/context-metrics-model';
import { parseAssertions } from '@/shared/assertion-source-model';
import { buildAssertionConstraintPack, renderAssertionConstraintSection } from './assertion-context-service';
import { parseEmotionIntensities } from '@/shared/emotion-plan-parse';
import { detectRhythmDeviations, renderRhythmReport } from '@/shared/rhythm-baseline-model';

const log = createLogger('ContextMetrics');

/** 旧策略整份注入的文件（相对项目） */
const LEGACY_FILES = [
    '01-世界架构/世界观总览.md',
    '01-世界架构/设定库.md',
    '02-时间线与伏笔/伏笔库.md',
    '02-时间线与伏笔/时间线看板.md',
];
/** 旧策略整份注入的目录（其中每个 md 都算一份） */
const LEGACY_DIRS = ['01-世界架构/人物'];

/** 实测结果 */
export interface ContextMetricsResult {
    /** 旧策略总字符 */
    beforeChars: number;
    /** 新策略总字符 */
    afterChars: number;
    /** 对比（复用共享模型） */
    comparison: MetricsComparison;
    /** 报告文本 */
    report: string;
    /** 参与统计的文件数 */
    legacyFiles: number;
    /** 使用的场景序号 */
    sceneIndex: number;
}

/**
 * 注入量实测服务。
 */
export class ContextMetricsService {
    /**
     * @param app - Obsidian 应用
     * @param buildSceneContext - 场景上下文装配（复用 M5 入口）
     */
    constructor(
        private readonly app: App,
        private readonly buildSceneContext: (project: string, sceneText: string, sceneIndex: number) => Promise<{ section: string }>,
    ) {}

    /**
     * 实测项目改造前后注入量。
     *
     * @param project - 项目路径
     * @param sceneIndex - 场景序号（默认 1）
     * @returns 实测结果
     */
    async measure(project: string, sceneIndex = 1): Promise<ContextMetricsResult> {
        const legacy = await this.collectLegacy(project);
        const sceneText = await this.findSceneExpand(project);
        const sceneSection = sceneText
            ? (await this.buildSceneContext(project, sceneText, sceneIndex)).section
            : '';

        const assertionSection = await this.renderAssertions(project);
        const rhythmSection = await this.renderRhythm(project);
        const afterText = [sceneSection, assertionSection, rhythmSection].filter(Boolean).join('\n\n');

        const before: InjectionRecord[] = legacy.records;
        const after: InjectionRecord[] = afterText.length > 0
            ? [{ step: 'scene-scoped', chars: afterText.length, estTokens: Math.ceil(afterText.length / 2) }]
            : [];
        const comparison = compareMetrics(before, after);
        return {
            beforeChars: legacy.chars,
            afterChars: afterText.length,
            comparison,
            report: renderMetricsReport(comparison),
            legacyFiles: legacy.records.length,
            sceneIndex,
        };
    }

    /** 统计旧策略整份注入的字符量 */
    private async collectLegacy(project: string): Promise<{ records: InjectionRecord[]; chars: number }> {
        const records: InjectionRecord[] = [];
        let chars = 0;
        for (const rel of LEGACY_FILES) {
            const text = await this.readText(`${project}/${rel}`);
            if (!text) continue;
            chars += text.length;
            records.push({ step: rel, chars: text.length, estTokens: Math.ceil(text.length / 2) });
        }
        for (const dir of LEGACY_DIRS) {
            const folder = this.app.vault.getAbstractFileByPath(`${project}/${dir}`);
            if (!(folder instanceof TFolder)) continue;
            for (const child of folder.children) {
                if (!(child instanceof TFile) || child.extension !== 'md') continue;
                const text = await this.readText(child.path);
                if (!text) continue;
                chars += text.length;
                records.push({ step: child.path.replace(`${project}/`, ''), chars: text.length, estTokens: Math.ceil(text.length / 2) });
            }
        }
        return { records, chars };
    }

    /** 找本章 Scene 展开文件（第一个匹配） */
    private async findSceneExpand(project: string): Promise<string> {
        const target = await this.findFirst(project, file => file.basename.endsWith('_Scene展开'));
        return target ? this.readText(target) : '';
    }

    /** 渲染断言约束段（无断言返回空） */
    private async renderAssertions(project: string): Promise<string> {
        const text = await this.readText(`${project}/04-项目总控/一致性审核/断言.json`);
        if (!text) return '';
        try {
            const assertions = parseAssertions(JSON.parse(text));
            const anchorIds = [...new Set(assertions.flatMap(item => item.entityIds))];
            const pack = buildAssertionConstraintPack(assertions, anchorIds);
            return renderAssertionConstraintSection(pack);
        } catch { // silent-ok: 断言损坏时跳过该项统计
            return '';
        }
    }

    /** 渲染节奏报告段（无情绪规划返回空） */
    private async renderRhythm(project: string): Promise<string> {
        const text = await this.findFirst(project, file => file.basename.endsWith('_情绪规划')).then(path => (path ? this.readText(path) : ''));
        if (!text) return '';
        const scenes = parseEmotionIntensities(text);
        if (scenes.length < 2) return '';
        return renderRhythmReport(scenes, detectRhythmDeviations(scenes));
    }

    /** 深度优先找第一个匹配文件 */
    private async findFirst(project: string, predicate: (file: TFile) => boolean): Promise<string | null> {
        const root = this.app.vault.getAbstractFileByPath(project);
        if (!(root instanceof TFolder)) return null;
        const stack: TFolder[] = [root];
        while (stack.length > 0) {
            const current = stack.pop();
            if (!current) continue;
            for (const child of current.children) {
                if (child instanceof TFolder) stack.push(child);
                else if (child instanceof TFile && child.extension === 'md' && predicate(child)) return child.path;
            }
        }
        return null;
    }

    /** 读文件文本（失败返回空） */
    private async readText(path: string): Promise<string> {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) return '';
        try {
            return await this.app.vault.read(file);
        } catch { // silent-ok: 单文件读失败按空处理，不阻断统计
            log.warn('读取失败:', path);
            return '';
        }
    }
}
