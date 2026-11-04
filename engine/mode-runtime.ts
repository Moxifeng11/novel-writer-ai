/**
 * mode-runtime.ts — 短篇 / 剧本的共享运行上下文（M3）
 *
 * 长篇走 11 步流水线 + ContextManager；短篇/剧本此前只读「大纲 + 故事核/场景圣经 +
 * 前期调研人物」，实体、文笔风格、分镜表都不进提示词。这里把模式级上下文收敛成
 * 一个入口，单元写作与文档生成共用，避免每个调用方各拼一份。
 *
 * 边界：这里只做“读文件并格式化”，不写盘、不调 AI；RAG/知识库检索由上层注入，
 * 后续 M4 再接入 KnowledgeInjector。
 */
import type { App } from 'obsidian';
import { parseCreationModeMeta, getCreationModePromptBlock, type CreationMode, type CreationModeMeta } from '@/shared/creation-mode';
import { modeDocPath, modeUnitLabel } from '@/shared/mode-content';
import { readProjectMeta, pjWritingStyle } from '@/shared/paths';
import { readPreResearchData, type PreResearchData } from '@/shared/pre-research';
import { listEntityFiles, ENTITY_KINDS, ENTITY_KIND_LABEL } from '@/shared/entity-reader';
import { parseFrontmatter } from '@/shared/frontmatter';
import { createLogger } from '@/shared/logger';

const log = createLogger('ModeRuntime');

/** 模式级上下文。 */
export interface ModeRuntimeContext {
    mode: CreationMode;
    project: string;
    meta: CreationModeMeta;
    outlineDoc: string;
    /** 短篇：故事核；剧本：场景圣经 */
    storyDoc: string;
    /** 剧本分镜表；短篇为空 */
    storyboardDoc: string;
    preResearch: PreResearchData | null;
    preResearchDigest: string;
    /** 人物/地点/势力/物品的状态摘要 */
    entities: string;
    /** 项目文笔风格（前 1200 字） */
    styleGuide: string;
    /** 本模式给模型的总纲块 */
    modeGuide: string;
    targetWords: number;
}

async function readText(app: App, path: string): Promise<string> {
    try {
        const adapter = app.vault.adapter;
        if (!(await adapter.exists(path))) return '';
        return await adapter.read(path);
    } catch (error) {
        log.warn(`读取模式上下文失败：${path}`, error);
        return '';
    }
}

function clip(text: string, max: number): string {
    const value = String(text || '').trim();
    return value.length > max ? value.slice(0, max) : value;
}

/**
 * 前期调研摘要：只保留对写作有约束力的字段。
 *
 * @param data - 调研数据
 * @returns 文本摘要
 */
export function formatPreResearchDigest(data: PreResearchData | null): string {
    if (!data) return '';
    if (data.mode === 'short') {
        return [
            data.primaryCategory ? `主分类：${data.primaryCategory}` : '',
            data.premise ? `故事前提：${data.premise}` : '',
            data.coreConflict ? `核心冲突：${data.coreConflict}` : '',
            data.reversals ? `反转设计：${data.reversals}` : '',
            data.emotionalPromise ? `情绪承诺：${data.emotionalPromise}` : '',
            data.endingPayoff ? `结尾兑现：${data.endingPayoff}` : '',
            data.characterCore ? `人物内核：${data.characterCore}` : '',
        ].filter(Boolean).join('\n');
    }
    return [
        data.genre ? `剧本类型：${data.genre}` : '',
        data.logline ? `一句话故事：${data.logline}` : '',
        data.hook3s ? `前 3 秒钩子：${data.hook3s}` : '',
        data.coreConflict ? `核心冲突：${data.coreConflict}` : '',
        data.payoff ? `爽点/兑现：${data.payoff}` : '',
        data.characters ? `主要人物：${data.characters}` : '',
        data.scenes ? `主要场景：${data.scenes}` : '',
        data.paywallEpisode ? `付费卡点：第 ${data.paywallEpisode} 集` : '',
    ].filter(Boolean).join('\n');
}

function entitySummary(app: App, project: string): string {
    const lines: string[] = [];
    for (const kind of ENTITY_KINDS) {
        const files = listEntityFiles(app, project, kind).slice(0, 8);
        if (files.length === 0) continue;
        lines.push(`【${ENTITY_KIND_LABEL[kind]}】`);
        for (const file of files) {
            // listEntityFiles 返回 TFile；读取失败时跳过单个实体，不影响整块上下文
            const cached = app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
            const name = String(cached?.['姓名'] || cached?.['名称'] || file.basename).trim();
            const status = String(cached?.['entity_status'] || cached?.['当前状态'] || '').trim();
            const location = String(cached?.['当前位置'] || '').trim();
            const relation = String(cached?.['关系'] || cached?.['所属势力'] || '').trim();
            const bits = [status, location, relation].filter(Boolean).join(' · ');
            lines.push(`- ${name}${bits ? `：${bits}` : ''}`);
        }
    }
    return clip(lines.join('\n'), 2400);
}

/**
 * 读取模式级上下文。
 *
 * @param app - Obsidian 应用实例
 * @param project - 项目 ID
 * @param mode - 创作模式
 * @returns 模式上下文
 */
export async function loadModeRuntimeContext(
    app: App,
    project: string,
    mode: CreationMode,
): Promise<ModeRuntimeContext> {
    const meta = parseCreationModeMeta((await readProjectMeta(app, project)) || '');
    const targetTotal = meta.mode === mode ? meta.targetUnits : 0;
    const wordTotal = meta.mode === mode ? meta.targetWords : 0;
    const targetWords = targetTotal > 0 && wordTotal > 0
        ? Math.max(600, Math.round(wordTotal / targetTotal))
        : (mode === 'script' ? 900 : 3000);

    const [outlineDoc, storyDoc, storyboardDoc, preResearch, styleRaw] = await Promise.all([
        readText(app, modeDocPath(project, mode, 'outline')),
        readText(app, modeDocPath(project, mode, mode === 'script' ? 'bible' : 'storyCore')),
        mode === 'script' ? readText(app, modeDocPath(project, mode, 'storyboard')) : Promise.resolve(''),
        readPreResearchData(app.vault.adapter, project),
        readText(app, pjWritingStyle(project)),
    ]);

    return {
        mode,
        project,
        meta,
        outlineDoc,
        storyDoc: clip(storyDoc, 4000),
        storyboardDoc: clip(storyboardDoc, 3000),
        preResearch,
        preResearchDigest: clip(formatPreResearchDigest(preResearch), 1600),
        entities: entitySummary(app, project),
        styleGuide: clip(styleRaw, 1200),
        modeGuide: getCreationModePromptBlock(mode, meta),
        targetWords,
    };
}

/**
 * 单元大纲块标题（避免剧本里出现「本节大纲」）。
 *
 * @param mode - 创作模式
 * @returns 标题
 */
export function modeOutlineLabel(mode: CreationMode): string {
    return `本${modeUnitLabel(mode)}大纲`;
}

/**
 * 从实体摘要里粗略取人物名（用于质量评估的 characterNames）。
 *
 * @param entities - 实体摘要
 * @returns 名字数组
 */
export function namesFromEntitySummary(entities: string): string[] {
    const names: string[] = [];
    const charBlock = entities.split('【人物】')[1]?.split('【')[0] ?? '';
    for (const line of charBlock.split('\n')) {
        const match = line.match(/^-\s*([^：:]{2,12})[：:]/);
        if (match && !names.includes(match[1].trim())) names.push(match[1].trim());
    }
    return names.slice(0, 20);
}

/**
 * 单元 frontmatter 摘要（调试/诊断用）。
 *
 * @param text - 单元文本
 * @returns 关键字段
 */
export function unitFrontmatterSummary(text: string): Record<string, string> {
    return parseFrontmatter(text);
}
