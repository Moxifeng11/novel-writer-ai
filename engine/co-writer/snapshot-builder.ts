/**
 * snapshot-builder.ts — 协同写作上下文快照构建
 *
 * 从 co-writer-engine.ts 抽出的 `buildSnapshot`：把 `gatherAll` 的原始数据
 * 渲染成 `ContextSnapshot` 的静态字段。除读取写作规则需要 `App` 访问 RulesService
 * 外不持有任何引擎状态，也不读写 `this.snapshot`；关系/跨卷/长篇记忆/同人约束/
 * 创作模式等动态字段仍由引擎在 init 阶段单独加载。
 */
import type { App } from 'obsidian';
import { RulesService } from '@/services/rules-service';
import { formatEntityBrief } from '@/engine/chapter-brief';
import type { GatheredContext } from '@/engine/context/context-types';
import { createLogger } from '@/shared/logger';
import type { ContextSnapshot } from './co-writer-types';

const log = createLogger('CoWriterEngine');

/**
 * 从采集结果构建上下文快照的静态字段。
 *
 * 行为与抽取前的 `CoWriterEngine.buildSnapshot` 完全一致：
 * - 写作规则走 `RulesService`（v4.26 起规则唯一来源，含模式附录全文），读取失败降级为空块；
 * - 人物/势力/地点/道具走 `formatEntityBrief` 统一字段映射，映射不到时保留原始 JSON 片段；
 * - 世界观原文、题材、文风、情绪/场景/大纲、前章四段摘要、设定库、时间线、角色内核、触发记忆按原样拼接；
 * - 动态字段（关系、跨卷、长篇记忆、同人约束、创作模式、正文/光标等）一律给空值，由调用方补齐。
 *
 * @param app - Obsidian 应用实例，仅用于 `RulesService.getInstance(app)` 读取写作规则
 * @param ctx - `contextManager.gatherAll` 的采集结果
 * @param project - 项目名
 * @param chapterName - 章节名
 * @returns 已填充静态字段的快照（动态字段为空，`dirtyFields` 为空集合）
 * @example
 * ```ts
 * const ctx = await contextManager.gatherAll(project, chapterName);
 * const snapshot = await buildSnapshot(app, ctx, project, chapterName);
 * snapshot.project;    // project
 * snapshot.worldType;  // 从世界观「题材：…」提取，未命中为 ''
 * snapshot.writingRules; // RulesService 返回的完整规则文本，失败时为 ''
 * ```
 */
export async function buildSnapshot(
    app: App,
    ctx: GatheredContext,
    project: string,
    chapterName: string
): Promise<ContextSnapshot> {
    const data = ctx.data;
    // v4.26：规则唯一来源 RulesService（含模式附录全文）
    let cachedRulesText = '';
    try {
        cachedRulesText = await RulesService.getInstance(app).getWritingRules(project);
    } catch (e) {
        log.warn('[CoWriterEngine] 读取写作规则失败，规则块为空:', e);
    }
    const getRaw = (obj: unknown): string => {
        if (!obj || typeof obj !== 'object' || !('raw' in obj)) return '';
        const raw = (obj as { raw?: unknown }).raw;
        return typeof raw === 'string' ? raw : '';
    };
    const getEntitySummary = (list: unknown, maxChars = 3000) => {
        if (!Array.isArray(list) || list.length === 0) return '';
        // 实体文件使用中文字段（姓名/名称、人物背景/描述、当前状态），统一走真实字段映射
        const brief = formatEntityBrief(list, { maxChars });
        if (brief) return brief;
        // 字段完全不匹配时保留原始内容，避免提示词里只剩 “：”
        return JSON.stringify(list).slice(0, 500);
    };
    const worldViewRaw = getRaw(data.world_view);
    let worldType = '';
    const typeMatch = worldViewRaw.match(/题材[：:]\s*([^\n]+)/);
    if (typeMatch) worldType = typeMatch[1].trim();
    return {
        project,
        chapterName,
        allChars: getEntitySummary(data.character_state, 4000),
        allFactions: getEntitySummary(data.factions, 2000),
        allLocs: getEntitySummary(data.locations, 3000),
        allItems: getEntitySummary(data.items, 2000),
        foreshadows: data.foreshadows || { unrevealed: [], revealed: [], abandoned: [] },
        relationshipStates: [],
        crossVolumeContext: '',
        longTermMemoryContext: '',
        fanficRulesContext: '',
        creationModeContext: '',
        worldView: worldViewRaw,
        worldType,
        writingStyle: getRaw(data.writing_style),
        // v4.26：规则唯一来源 RulesService（含模式附录全文），不再走 ContextManager 的节选渲染
        writingRules: cachedRulesText,
        protagonistSoulDetail: '',
        emotionPlan: getRaw(data.emotion_plan),
        sceneExpansion: getRaw(data.scene_expansion),
        chapPlan: getRaw(data.outline),
        prevChaptersSummary: (() => {
            const prev = data.previous_chapter;
            if (!prev) return '';
            return [
                prev.bodySummary ? `【前章概要】\n${prev.bodySummary}` : '',
                prev.outline ? `【前章大纲】\n${prev.outline}` : '',
                prev.ending ? `【前章结尾】\n${prev.ending}` : '',
                prev.analysisReport ? `【前章分析报告】\n${prev.analysisReport}` : '',
            ].filter(Boolean).join('\n\n');
        })(),
        settingLib: getRaw(data.setting_lib),
        timeline: (() => {
            const tl = data.timeline as Array<{ time?: string; chapter?: string; event?: string; impact?: string }>;
            if (!Array.isArray(tl) || tl.length === 0) return '';
            return tl.map(t => `${t.time || ''}|${t.chapter || ''}|${t.event || ''}|${t.impact || ''}`).join('\n');
        })(),
        characterCores: (() => {
            const cores = data.character_cores;
            if (!cores) return '';
            if (typeof cores === 'string') return cores;
            if (Array.isArray(cores)) {
                // 旧数据可能带 coreTraits/summary 字段，而 CharacterSoul 类型未声明；
                // 用最小结构替代 any，读取方式与抽取前一致。
                return (cores as Array<{ name?: string; coreTraits?: string; summary?: string }>)
                    .map(c => `${c.name || ''}: ${c.coreTraits || c.summary || ''}`)
                    .join('\n');
            }
            return String(cores);
        })(),
        triggeredMemories: data.triggered_memories_prompt || (Array.isArray(data.triggered_memories)
            ? (data.triggered_memories as Array<{ character?: string; content?: string; text?: string }>).map(m => `${m.character || ''}: ${m.content || m.text || ''}`).join('\n')
            : ''),
        precedingText: '',
        cursorHint: '',
        currentMode: 'continue',
        gatheredAt: Date.now(),
        dirtyFields: new Set()
    };
}
