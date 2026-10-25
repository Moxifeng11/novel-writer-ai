/**
 * story-linkage.ts — 时间线 / 伏笔 ↔ 世界观设定库 ↔ 全书规划 的关联引擎
 *
 * Rev 186：此前时间线与伏笔只被平铺塞进 prompt（时间线 500 字、伏笔 1000 字），
 * 与世界观的设定条目、分卷大纲之间没有任何交叉引用，也没有可见输出。
 * 本模块把三类数据合成一份「本章关联索引」：
 *   - 伏笔：计划回收解析成章号区间 → 到期 / 逾期 / 3 章内即将到期
 *   - 时间线：本章事件 + 最近前史，去重后与设定条目互链
 *   - 设定/规划：命中的设定标题、全书规划中本章的定位句
 *
 * 纯函数、无 Obsidian 依赖，可被 UI / ContextManager / 单测直接复用。
 * 重复数据只做合并与告警，不改写原文件（用户选择「只提示不修改」）。
 */
import { chapterOutlineSection } from '../shared/format-constants';

export interface PlannedRange {
    start: number | null;
    end: number | null;
    raw: string;
}

export type ForeshadowState = 'due' | 'overdue' | 'upcoming' | 'later' | 'unknown';

export interface LinkageForeshadow {
    name: string;
    importance: string;
    buryChapter: string;
    plannedRaw: string;
    range: PlannedRange;
    state: ForeshadowState;
    relatedChars: string[];
    relatedMainline: string;
    /** 命中的设定 / 世界观条目标题（≤3） */
    settingRefs: string[];
    /** 全书规划中命中的句子（≤120 字） */
    planningRef: string;
}

export interface LinkageTimelineEvent {
    time: string;
    chapter: string;
    eventName: string;
    state: 'past' | 'in-chapter' | 'future';
    involved: string[];
    settingRefs: string[];
}

export interface StoryLinkage {
    chapterName: string;
    chapterNum: number;
    volume: string;
    due: LinkageForeshadow[];
    overdue: LinkageForeshadow[];
    upcoming: LinkageForeshadow[];
    /** 本章事件 + 最近前史（已去重，prompt 用） */
    timeline: LinkageTimelineEvent[];
    /** 去重后的全部时间线事件（回写看板用） */
    timelineAll: LinkageTimelineEvent[];
    settingHits: string[];
    planningRefs: string[];
    warnings: string[];
    /** ≤1800 字，供正文 prompt 注入 */
    promptText: string;
}

export interface StoryLinkageForeshadowInput {
    name?: string;
    importance?: string;
    buryChapter?: string;
    plannedReveal?: string;
    relatedChars?: string;
    relatedMainline?: string;
    status?: string;
}

export interface StoryLinkageTimelineInput {
    time?: string;
    chapter?: string;
    event?: string;
    eventName?: string;
    involvedEntities?: string[];
}

export interface StoryLinkageInput {
    chapterName: string;
    chapterNum: number;
    volume?: string;
    foreshadows?: StoryLinkageForeshadowInput[];
    timeline?: StoryLinkageTimelineInput[];
    /** 设定库 / 世界观中的条目名（markdown 2–6 级标题） */
    settingTitles?: string[];
    /** 合并分卷大纲原文（内部按章裁剪） */
    planningText?: string;
}

/** 默认提前量：与 filterForeshadowsByChapter 的「3 章内」保持一致 */
export const LINKAGE_UPCOMING_WINDOW = 3;
/** prompt 关联段的字数上限 */
export const LINKAGE_PROMPT_LIMIT = 1800;

const SENTENCE_STRIP_RE = /^[\s#>*\-|]+/;
const KEYWORD_SPLIT_RE = /[、，,；;/|·:：（）()\s]+/;

/** 世界观/设定库里的通用章节标题，不作为「关联设定条目」命中 */
const GENERIC_SETTING_TITLES = new Set([
    '世界观', '世界观总览', '设定库', '人物', '地点', '势力', '物品功法',
    '与主线关联', '与世界观关联', '变更记录', '附录', '备注', '说明',
]);

/**
 * 解析「计划回收」为章号区间。
 *
 * | 原文            | start | end |
 * |-----------------|-------|-----|
 * | 第6章           | 6     | 6   |
 * | 第6-8章 / 第6章至第8章 | 6 | 8 |
 * | 第6章前后 / 左右 | 5     | 7   |
 * | 待定 / 后续章节 / 空 | null | null |
 */
export function parsePlannedRange(raw: string): PlannedRange {
    const text = (raw || '').trim();
    if (!text || !text.includes('章')) return { start: null, end: null, raw: text };

    const match = text.match(/第?\s*(\d+)\s*章?\s*(?:[-–—~～至到]\s*第?\s*(\d+)\s*章)?/);
    if (!match) return { start: null, end: null, raw: text };

    const start = parseInt(match[1], 10);
    let end = match[2] ? parseInt(match[2], 10) : start;
    if (!Number.isFinite(start) || start <= 0) return { start: null, end: null, raw: text };
    if (!Number.isFinite(end) || end < start) end = start;

    if (/前后|左右|上下/.test(text)) {
        return { start: Math.max(1, start - 1), end: end + 1, raw: text };
    }
    return { start, end, raw: text };
}

/** 伏笔相对当前章的状态 */
export function classifyForeshadow(
    range: PlannedRange,
    current: number,
    window: number = LINKAGE_UPCOMING_WINDOW,
): ForeshadowState {
    if (range.start === null || range.end === null) return 'unknown';
    if (current >= range.start && current <= range.end) return 'due';
    if (range.end < current) return 'overdue';
    if (range.start <= current + window) return 'upcoming';
    return 'later';
}

function splitKeywords(raw: string | undefined): string[] {
    if (!raw) return [];
    return raw
        .split(KEYWORD_SPLIT_RE)
        .map(s => s.trim())
        .filter(s => s.length >= 2);
}

function matchSettings(keywords: string[], settingTitles: string[]): string[] {
    if (keywords.length === 0 || settingTitles.length === 0) return [];
    const hits: string[] = [];
    for (const title of settingTitles) {
        if (hits.includes(title)) continue;
        if (keywords.some(k => title.includes(k) || k.includes(title))) hits.push(title);
    }
    return hits;
}

/** 把合并分卷大纲裁剪到本章段落；无匹配返回空串（避免把别章规划当成本章定位） */
function scopePlanningToChapter(text: string | undefined, chapterNum: number): string {
    if (!text || chapterNum <= 0) return '';
    const match = text.match(chapterOutlineSection(chapterNum));
    return match ? match[0] : '';
}

function extractPlanningSentences(scopedText: string): string[] {
    if (!scopedText) return [];
    return scopedText
        .split(/\n+/)
        .map(line => line
            .replace(SENTENCE_STRIP_RE, '')
            .replace(/^\d+\s*\|\s*/, '')
            .replace(/\s*\|\s*$/, '')
            .trim())
        .filter(line => line.length >= 4 && !/^[|\-:：]+$/.test(line))
        .slice(0, 12);
}

function clip(value: string, max: number): string {
    return value.length > max ? `${value.slice(0, max)}…` : value;
}

/**
 * 生成某章的关联索引。
 */
export function buildStoryLinkage(input: StoryLinkageInput): StoryLinkage {
    const chapterNum = input.chapterNum || 0;
    const warnings: string[] = [];
    const settingTitles = (input.settingTitles || [])
        .map(t => t.trim())
        .filter(t => t.length > 0 && !GENERIC_SETTING_TITLES.has(t));
    const planningSentences = extractPlanningSentences(scopePlanningToChapter(input.planningText, chapterNum));
    const planningRefs = planningSentences.slice(0, 5);

    // ── 伏笔：按名称合并重复，再解析计划区间 ──
    const grouped = new Map<string, { item: StoryLinkageForeshadowInput; count: number }>();
    for (const raw of input.foreshadows || []) {
        const name = (raw.name || '').trim();
        if (!name) continue;
        const existing = grouped.get(name);
        if (existing) {
            existing.count += 1;
            continue;
        }
        grouped.set(name, { item: raw, count: 1 });
    }
    const duplicatedGroups = [...grouped.values()].filter(g => g.count > 1);
    if (duplicatedGroups.length > 0) {
        const extra = duplicatedGroups.reduce((sum, g) => sum + g.count - 1, 0);
        warnings.push(`伏笔库有 ${extra} 条重复记录（${duplicatedGroups.length} 组同名），已按名称合并，原文件未修改`);
    }

    const all: LinkageForeshadow[] = [];
    let unknownCount = 0;
    for (const { item } of grouped.values()) {
        const name = (item.name || '').trim();
        const range = parsePlannedRange(item.plannedReveal || '');
        const state = classifyForeshadow(range, chapterNum);
        if (state === 'unknown') unknownCount += 1;
        const relatedChars = splitKeywords(item.relatedChars);
        const keywords = [...relatedChars, ...splitKeywords(name), ...splitKeywords(item.relatedMainline)];
        const planningRef = planningSentences.find(s => s.includes(name) || keywords.some(k => s.includes(k))) || '';
        all.push({
            name,
            importance: (item.importance || '').trim(),
            buryChapter: (item.buryChapter || '').trim(),
            plannedRaw: (item.plannedReveal || '').trim(),
            range,
            state,
            relatedChars,
            relatedMainline: (item.relatedMainline || '').trim(),
            settingRefs: matchSettings(keywords, settingTitles).slice(0, 3),
            planningRef: clip(planningRef, 120),
        });
    }
    if (unknownCount > 0) {
        warnings.push(`${unknownCount} 条伏笔的「计划回收」无法解析为章号（如「待定」「后续章节」），仅在看板展示`);
    }

    const due = all.filter(f => f.state === 'due');
    const overdue = all.filter(f => f.state === 'overdue');
    const upcoming = all.filter(f => f.state === 'upcoming');

    // ── 时间线：按 事件名|时间|章节 去重，保留本章事件与最近前史 ──
    const seen = new Set<string>();
    const timeline: LinkageTimelineEvent[] = [];
    let timelineDup = 0;
    for (const raw of input.timeline || []) {
        const eventName = (raw.eventName || raw.event || '').trim();
        const time = (raw.time || '').trim();
        if (!eventName && !time) continue;
        const chapter = (raw.chapter || '').trim();
        const key = `${eventName}|${time}|${chapter}`;
        if (seen.has(key)) {
            timelineDup += 1;
            continue;
        }
        seen.add(key);

        const eventNum = parseInt(chapter.match(/第(\d+)章/)?.[1] || '0', 10);
        const state: LinkageTimelineEvent['state'] = eventNum === chapterNum && chapterNum > 0
            ? 'in-chapter'
            : (eventNum > 0 && eventNum < chapterNum ? 'past' : 'future');
        const involved = raw.involvedEntities || [];
        timeline.push({
            time,
            chapter,
            eventName: eventName || time,
            state,
            involved,
            settingRefs: matchSettings([...involved, ...splitKeywords(eventName)], settingTitles).slice(0, 3),
        });
    }
    if (timelineDup > 0) {
        warnings.push(`时间线有 ${timelineDup} 条重复事件，已去重后使用，原文件未修改`);
    }

    const past = timeline.filter(t => t.state === 'past').slice(-3);
    const inChapter = timeline.filter(t => t.state === 'in-chapter');
    const scopedTimeline = [...past, ...inChapter];

    const settingHits: string[] = [];
    for (const f of [...due, ...overdue, ...upcoming]) {
        for (const ref of f.settingRefs) if (!settingHits.includes(ref)) settingHits.push(ref);
    }
    for (const t of scopedTimeline) {
        for (const ref of t.settingRefs) if (!settingHits.includes(ref)) settingHits.push(ref);
    }

    const linkage: StoryLinkage = {
        chapterName: input.chapterName,
        chapterNum,
        volume: input.volume || '',
        due,
        overdue,
        upcoming,
        timeline: scopedTimeline,
        timelineAll: timeline,
        settingHits: settingHits.slice(0, 8),
        planningRefs,
        warnings,
        promptText: '',
    };
    linkage.promptText = formatStoryLinkageForPrompt(linkage);
    return linkage;
}

function formatForeshadowRow(item: LinkageForeshadow): string {
    const bits: string[] = [];
    if (item.importance) bits.push(item.importance);
    bits.push(`埋设 ${item.buryChapter || '—'}`);
    bits.push(`计划 ${item.plannedRaw || '待定'}`);
    if (item.settingRefs.length > 0) bits.push(`设定：${item.settingRefs.join('、')}`);
    if (item.planningRef) bits.push(`规划：${item.planningRef}`);
    return `- ${item.name}（${bits.join('；')}）`;
}

/**
 * 生成 prompt 关联段：到期 → 逾期 → 设定/规划 → 时间线，超限按段截断。
 */
export function formatStoryLinkageForPrompt(
    linkage: StoryLinkage,
    limit: number = LINKAGE_PROMPT_LIMIT,
): string {
    const parts: string[] = [];
    if (linkage.due.length > 0) {
        parts.push(`【关联伏笔·本章到期】\n${linkage.due.map(formatForeshadowRow).join('\n')}`);
    }
    if (linkage.overdue.length > 0) {
        parts.push(`【关联伏笔·逾期未回收】\n${linkage.overdue.map(formatForeshadowRow).join('\n')}`);
    }
    const settingPlanning: string[] = [];
    if (linkage.settingHits.length > 0) {
        settingPlanning.push(`- 本章关联设定：${linkage.settingHits.join('、')}`);
    }
    if (linkage.planningRefs.length > 0) {
        settingPlanning.push(`- 全书规划定位：\n  ${linkage.planningRefs.join('\n  ')}`);
    }
    if (settingPlanning.length > 0) {
        parts.push(`【设定/规划关联】\n${settingPlanning.join('\n')}`);
    }
    if (linkage.timeline.length > 0) {
        const rows = linkage.timeline.map(t => {
            const involved = t.involved.length > 0 ? `｜涉及：${t.involved.join('、')}` : '';
            return `- ${t.time || '—'}｜${t.eventName}${involved}`;
        });
        parts.push(`【本章时间线】\n${rows.join('\n')}`);
    }

    let out = '';
    for (const part of parts) {
        if (!out) {
            out = part;
            continue;
        }
        if (out.length + 2 + part.length > limit) break;
        out += `\n\n${part}`;
    }
    if (out.length > limit) out = `${out.slice(0, limit)}…`;
    return out;
}
