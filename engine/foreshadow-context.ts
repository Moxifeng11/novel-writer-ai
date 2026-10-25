/**
 * 伏笔追踪 → 偏离检测上下文的映射（纯函数）。
 *
 * `ForeshadowManager` 的追踪数据面向展示/AI 抽取，`DeviationDetector` 需要
 * 「埋设章号 + 检索关键词」。映射只做一份，避免协同视图与后续新入口各写一套而漂移。
 */
import type { ForeshadowTracking } from './quality/deviation-detector';

/** 追踪条目中检测实际读取的字段（结构兼容 `TrackedForeshadowItem`） */
export interface TrackedForeshadowLike {
    id?: string;
    content?: string;
    plantedChapter?: number;
    status?: string;
    importance?: string;
}

/** 伏笔库表格条目中用于「计划回收」的字段 */
export interface PlannedRevealLike {
    name?: string;
    plannedReveal?: string;
    status?: string;
}

/** 解析「计划回收」文本中的章号：`第12章` / `第 12 章` / 纯数字 `12`；无法解析返回 null */
export function parsePlannedRevealChapter(value: string | undefined | null): number | null {
    if (!value) return null;
    const matched = value.match(/第\s*(\d+)\s*章/) || value.match(/^\s*(\d+)\s*$/);
    if (!matched) return null;
    const chapter = parseInt(matched[1], 10);
    if (!Number.isFinite(chapter) || chapter <= 0) return null;
    return chapter;
}

function normalizeForeshadowName(value: string): string {
    return (value || '').replace(/[\s「」『』《》"'“”‘’（）()【】[\]]、，,。；;：:！!？?—\-·]/g, '');
}

/**
 * 把伏笔库里的「计划回收章」补到追踪条目上。
 *
 * 追踪器（自动检测）与伏笔库（人工维护）是两份文件：前者有埋设章号与检索关键词，
 * 后者有计划回收章。缺了计划回收章时，偏离检测只能按全局阈值一刀切，
 * 长期伏笔会被误报、计划回收的伏笔又不会提前提醒。
 *
 * 匹配按规范化名称的包含关系，取最长命中，避免「玄铁剑」抢走「玄铁剑鞘」的计划章。
 * 已有 `expectedRecoverChapterNum` 的条目保持原值（调用方显式设置的优先）。
 */
export function applyPlannedRevealChapters(
    trackings: ForeshadowTracking[],
    items: PlannedRevealLike[] | undefined | null,
): ForeshadowTracking[] {
    if (trackings.length === 0 || !items || items.length === 0) return trackings;

    const planned: Array<{ name: string; chapter: number }> = [];
    for (const item of items) {
        const status = (item.status || '').trim();
        if (status.includes('已揭示') || status.includes('已回收')) continue;
        const name = normalizeForeshadowName(item.name || '');
        if (name.length < 2) continue;
        const chapter = parsePlannedRevealChapter(item.plannedReveal);
        if (chapter === null) continue;
        planned.push({ name, chapter });
    }
    if (planned.length === 0) return trackings;

    return trackings.map(tracking => {
        if (tracking.expectedRecoverChapterNum) return tracking;
        const content = normalizeForeshadowName(tracking.description);
        if (content.length < 2) return tracking;

        let best: { name: string; chapter: number } | null = null;
        for (const candidate of planned) {
            if (!content.includes(candidate.name) && !candidate.name.includes(content)) continue;
            if (!best || candidate.name.length > best.name.length) best = candidate;
        }
        return best ? { ...tracking, expectedRecoverChapterNum: best.chapter } : tracking;
    });
}

/**
 * 抽取用于「后续章节是否已回收」的检索关键词。
 *
 * 关键词越短越容易在无关段落命中（把未回收判成已回收，漏报），
 * 越长越容易匹配不到（误报）。这里宁漏勿误：
 * - 短伏笔（4–12 字）整体作为关键词；过短的名称（<4 字）无法可靠检索，直接丢弃；
 * - 长伏笔按标点切分，只保留 4–16 字片段，最多 4 个。
 */
export function extractForeshadowKeywords(content: string): string[] {
    const normalized = (content || '').trim();
    if (!normalized) return [];

    const keywords = new Set<string>();
    if (normalized.length >= 4 && normalized.length <= 12) keywords.add(normalized);

    const parts = normalized.split(/[\s，,、。；;：:！!？?（）()「」【】《》"'“”‘’—\-]+/);
    for (const part of parts) {
        const piece = part.trim();
        if (piece.length >= 4 && piece.length <= 16) keywords.add(piece);
        if (keywords.size >= 4) break;
    }
    return [...keywords].slice(0, 4);
}

/**
 * 把追踪条目映射为偏离检测的伏笔上下文。
 *
 * 跳过三类条目，避免「恒报」的假告警：
 * - 已回收（`status === 'resolved'`）；
 * - 低重要度（`importance === 'low'`）；
 * - 埋设章号缺失/非法（`distance = 当前章 - 0` 会让每条都直接判 critical）。
 */
export function toForeshadowTrackings(
    items: TrackedForeshadowLike[] | undefined | null,
): ForeshadowTracking[] {
    if (!items || items.length === 0) return [];

    const list: ForeshadowTracking[] = [];
    for (const item of items) {
        const description = (item.content || '').trim();
        const plantedChapterNum = item.plantedChapter;
        if (!description) continue;
        if (item.status === 'resolved') continue;
        if (item.importance === 'low') continue;
        if (typeof plantedChapterNum !== 'number' || !Number.isFinite(plantedChapterNum) || plantedChapterNum <= 0) {
            continue;
        }

        const keywords = extractForeshadowKeywords(description);
        if (keywords.length === 0) continue;

        list.push({
            id: (item.id || '').trim() || `F${list.length + 1}`,
            description,
            plantedChapterNum,
            keywords,
            recovered: false,
        });
    }
    return list;
}
