/**
 * constraint-block-service.ts — 组装结构化约束块（B3）
 *
 * 从项目文件与设定卡抽取「必须遵守」的约束，输出带编号与锚点的块，
 * 供正文步/协同步注入，并可直接记录到注入归因。
 */

import { App, TFile, TFolder } from 'obsidian';
import { createLogger } from '@/shared/logger';
import {
    normalizeConstraintBlocks,
    renderConstraintBlocks,
    type ConstraintBlock,
    type RenderedConstraints,
} from '@/shared/constraint-block-model';
import { parseEmotionIntensities } from '@/shared/emotion-plan-parse';
import { detectRhythmDeviations } from '@/shared/rhythm-baseline-model';

const log = createLogger('ConstraintBlocks');

/** 实体卡信息（插件侧从索引/卡文件提供） */
export interface EntityConstraintInput {
    id: string;
    name: string;
    /** 口吻样本（人物卡 frontmatter） */
    voiceSamples: string[];
    /** 说话特征 */
    speechTraits: string[];
    /** 硬设定（如 当前境界/身份） */
    hardFacts: Record<string, string>;
}

/** 依赖注入 */
export interface ConstraintBlockDeps {
    /** 按名字解析实体卡（找不到返回 null） */
    resolveEntity(name: string): Promise<EntityConstraintInput | null>;
    /** 读文本（不存在返回空串） */
    readText(path: string): Promise<string>;
    /** 深度优先找文件名后缀 */
    findBySuffix(project: string, suffix: string): Promise<string | null>;
}

/** 组装结果 */
export interface ConstraintAssembly extends RenderedConstraints {
    blocks: ConstraintBlock[];
    /** 场景在场人物 */
    sceneNames: string[];
}

/**
 * 结构化约束块服务。
 */
export class ConstraintBlockService {
    /**
     * @param deps - 数据依赖
     */
    constructor(private readonly deps: ConstraintBlockDeps) {}

    /**
     * 组装本章约束块。
     *
     * @param project - 项目路径
     * @param chapterName - 章节名
     * @param maxChars - 渲染上限
     * @returns 块 + 渲染 + 归因
     */
    async assemble(project: string, chapterName: string, maxChars = 4000): Promise<ConstraintAssembly> {
        const scenePath = await this.deps.findBySuffix(project, `${chapterName}_Scene展开`);
        const sceneText = scenePath ? await this.deps.readText(scenePath) : '';
        const sceneNames = this.extractSceneNames(sceneText);

        const raw: Array<Omit<ConstraintBlock, 'id'> & { id?: string }> = [];
        for (const name of sceneNames) {
            const entity = await this.deps.resolveEntity(name).catch(() => null);
            if (!entity) continue;
            for (const [field, value] of Object.entries(entity.hardFacts)) {
                if (!value) continue;
                raw.push({ kind: 'fact', text: `${entity.name}的${field}是「${value}」，不得写成其他值`, anchorIds: [entity.id], source: '人物卡' });
            }
            if (entity.voiceSamples.length > 0) {
                raw.push({
                    kind: 'voice',
                    text: `${entity.name}说话特征：${entity.speechTraits.join('、') || '见样本'}；口吻样本：${entity.voiceSamples.slice(0, 2).join(' / ')}`,
                    anchorIds: [entity.id],
                    source: '人物卡',
                });
            }
        }

        // 伏笔：高重要度未回收项提醒
        const foreshadowText = await this.deps.readText(`${project}/02-时间线与伏笔/伏笔库.md`);
        for (const line of foreshadowText.split('\n')) {
            if (!line.includes('|')) continue;
            const cells = line.split('|').map(cell => cell.trim());
            if (cells.length < 5) continue;
            const name = cells[1];
            const importance = cells[4] ?? '';
            if (!name || !/高/.test(importance)) continue;
            raw.push({ kind: 'foreshadow', text: `高重要度伏笔「${name}」尚未回收：本章若涉及其线索，必须与埋设内容一致，不得改设定`, anchorIds: [name], source: '伏笔库' });
        }

        // 节奏：偏离项转为约束
        const rhythmPath = await this.deps.findBySuffix(project, `${chapterName}_情绪规划`);
        if (rhythmPath) {
            const scenes = parseEmotionIntensities(await this.deps.readText(rhythmPath));
            for (const deviation of detectRhythmDeviations(scenes)) {
                raw.push({
                    kind: 'rhythm',
                    text: `第${deviation.index}场节奏要求：${deviation.message}——本场需${deviation.kind === 'flat' ? '增加冲突或信息增量' : '补足铺垫或压缩情绪落差'}`,
                    anchorIds: [],
                    source: '情绪规划',
                });
            }
        }

        const blocks = normalizeConstraintBlocks(raw);
        const rendered = renderConstraintBlocks(blocks, maxChars);
        log.info(`约束块：${chapterName} 组装 ${blocks.length} 条，渲染 ${rendered.attribution.length} 条`);
        return { ...rendered, blocks, sceneNames };
    }

    /** 抽取场景在场人物名 */
    private extractSceneNames(sceneText: string): string[] {
        const names = new Set<string>();
        for (const line of sceneText.split('\n')) {
            const match = line.match(/在场人物[：:]\s*(.+)/);
            if (!match) continue;
            for (const name of match[1].split(/[、,，\s]+/)) {
                if (name.trim()) names.add(name.trim());
            }
        }
        return [...names];
    }
}

/**
 * 便捷构造：从 Obsidian vault 读文件。
 *
 * @param app - Obsidian 应用
 * @param resolveEntity - 实体解析器
 * @returns 约束块依赖
 */
export function createVaultConstraintDeps(
    app: App,
    resolveEntity: ConstraintBlockDeps['resolveEntity'],
): ConstraintBlockDeps {
    const readText = async (path: string): Promise<string> => {
        const file = app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) return '';
        try {
            return await app.vault.read(file);
        } catch { // silent-ok: 单文件读失败按空处理
            return '';
        }
    };
    const findBySuffix = async (project: string, suffix: string): Promise<string | null> => {
        const root = app.vault.getAbstractFileByPath(project);
        if (!(root instanceof TFolder)) return null;
        const stack: TFolder[] = [root];
        while (stack.length > 0) {
            const current = stack.pop();
            if (!current) continue;
            for (const child of current.children) {
                if (child instanceof TFolder) stack.push(child);
                else if (child instanceof TFile && child.extension === 'md' && child.basename.endsWith(suffix)) return child.path;
            }
        }
        return null;
    };
    return { resolveEntity, readText, findBySuffix };
}
