/**
 * story-context-graph.ts — 故事上下文图的构建、自动关联、检索与预算装配
 *
 * 纯函数模块：不访问 Obsidian，不写文件，只消费 GatheredContext 的结构化数据。
 * 同一张图同时服务一键生成与协同写作；区别只在 request.mode / tier / 预算。
 */
import { estimateTokens } from '@/shared/token-estimator';
import { extractKeywordTokens, keywordOverlapRatio } from '@/shared/keyword-tokens';
import { truncateTextToTokens } from '@/shared/prompt-budget';
import { parseSceneCardFields, parseSceneField, type SceneCardFields } from '@/shared/scene-card';
import type { StoryLinkage } from '@/engine/story-linkage';
import type { GatheredContext } from './context-types';
import { linkFactsToEntities } from './knowledge-fact-nodes';
import { activeContextQuotas } from '@/shared/context-budget-policy';
import type {
    StoryContextBundle,
    StoryContextGraph,
    StoryContextKind,
    StoryContextKindTelemetry,
    StoryContextLink,
    StoryContextMode,
    StoryContextNode,
    StoryContextProfile,
    StoryContextRequest,
    StoryContextSource,
    StoryContextTier,
    StoryContextTelemetry,
} from './story-context-types';

const ALL_KINDS: StoryContextKind[] = [
    'worldview', 'setting', 'character', 'faction', 'location', 'item',
    'timeline', 'foreshadow', 'scene', 'emotion',
];

const KIND_LABELS: Record<StoryContextKind, string> = {
    worldview: '世界观',
    setting: '设定库',
    character: '人物',
    faction: '势力',
    location: '地点',
    item: '物品功法',
    timeline: '时间线',
    foreshadow: '伏笔',
    scene: '场景卡',
    emotion: '情绪弧',
};

const KIND_ORDER: StoryContextKind[] = [
    'scene', 'emotion', 'character', 'location', 'faction', 'item',
    'timeline', 'foreshadow', 'setting', 'worldview',
];

const DEFAULT_PROFILES: Record<StoryContextTier, StoryContextProfile> = {
    local: {
        tier: 'local',
        maxPackTokens: 4200,
        preferCompact: true,
        requiredShare: 0.7,
        maxPerKind: {
            worldview: 1, setting: 6, character: 8, faction: 4, location: 4,
            item: 4, timeline: 8, foreshadow: 6, scene: 8, emotion: 8,
        },
    },
    cloud: {
        tier: 'cloud',
        maxPackTokens: 24000,
        preferCompact: false,
        requiredShare: 0.82,
        maxPerKind: {
            worldview: 1, setting: 20, character: 24, faction: 12, location: 12,
            item: 12, timeline: 40, foreshadow: 24, scene: 12, emotion: 12,
        },
    },
};

const PROTAGONIST_RE = /(主角|主人公|男主|女主)/;
const MAJOR_RE = /(重要配角|主要配角|核心配角|关键角色|男二|女二|反派主角)/;
const MINOR_RE = /(配角|次要角色|支线角色)/;

function clip(text: string, max: number): string {
    const value = String(text || '').trim();
    if (!value || value.length <= max) return value;
    return `${value.slice(0, Math.max(0, max - 1))}…`;
}

function firstSentences(text: string, maxChars: number): string {
    const value = String(text || '').trim();
    if (!value) return '';
    const sentences = value.match(/[^。！？!?…\n]+[。！？!?…]?/g) || [];
    let out = '';
    for (const sentence of sentences) {
        const next = out ? `${out}${sentence}` : sentence;
        if (next.length > maxChars) break;
        out = next;
    }
    if (!out) return clip(value, maxChars);
    return out.trim();
}

function normalizeName(value: string): string {
    return String(value || '')
        .replace(/[\s「」『』《》"'“”‘’（）()【】[\]]/g, '')
        .trim();
}

function splitNames(value: string | string[] | undefined): string[] {
    if (!value) return [];
    const list = Array.isArray(value) ? value : String(value).split(/[、，,；;/|·\s]+/);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of list) {
        const name = String(item || '').trim();
        const key = normalizeName(name);
        if (!key || key.length < 2 || seen.has(key)) continue;
        seen.add(key);
        out.push(name);
    }
    return out;
}

function emptyByKind<T>(): Record<StoryContextKind, T[]> {
    return {
        worldview: [], setting: [], character: [], faction: [], location: [],
        item: [], timeline: [], foreshadow: [], scene: [], emotion: [],
    };
}

function emptyKindTelemetry(): Record<StoryContextKind, StoryContextKindTelemetry> {
    const out = {} as Record<StoryContextKind, StoryContextKindTelemetry>;
    for (const kind of ALL_KINDS) out[kind] = { total: 0, included: 0, dropped: 0, truncated: 0 };
    return out;
}

function nodeTokens(text: string, modelId?: string): number {
    return estimateTokens(text, modelId || 'default');
}

function pushNode(
    nodes: Map<string, StoryContextNode>,
    byKind: Record<StoryContextKind, StoryContextNode[]>,
    node: StoryContextNode,
): void {
    if (!node.text.trim()) return;
    if (nodes.has(node.id)) {
        // 同名实体（人物/势力/地点/物品）不覆盖；追加别名链接由 nameIndex 处理
        return;
    }
    nodes.set(node.id, node);
    byKind[node.kind].push(node);
}

function makeNode(input: {
    id: string;
    kind: StoryContextKind;
    title: string;
    text: string;
    compactText?: string;
    priority: number;
    required?: boolean;
    sourcePath?: string;
    metadata?: Record<string, unknown>;
    modelId?: string;
}): StoryContextNode {
    const text = input.text.trim();
    const compactText = (input.compactText || firstSentences(text, 220)).trim();
    return {
        id: input.id,
        kind: input.kind,
        title: input.title,
        text,
        compactText: compactText || text,
        priority: input.priority,
        required: input.required === true,
        tokens: nodeTokens(text, input.modelId),
        compactTokens: nodeTokens(compactText || text, input.modelId),
        links: [],
        sourcePath: input.sourcePath,
        metadata: input.metadata || {},
    };
}

// ============================================================
// 设定库 / 世界观
// ============================================================

interface SettingSection {
    title: string;
    content: string;
}

function parseSettingSections(markdown: string): SettingSection[] {
    const raw = String(markdown || '').replace(/\r\n?/g, '\n').trim();
    if (!raw) return [];
    const lines = raw.split('\n');
    const sections: SettingSection[] = [];
    let current: SettingSection | null = null;
    const preamble: string[] = [];

    const flush = () => {
        if (!current) return;
        const content = current.content.trim();
        if (current.title || content) sections.push({ title: current.title, content });
        current = null;
    };

    for (const line of lines) {
        const heading = line.match(/^(#{2,4})\s+(.+)$/);
        if (heading) {
            flush();
            current = { title: heading[2].trim(), content: '' };
            continue;
        }
        if (!current) {
            if (line.trim()) preamble.push(line);
        } else {
            current.content += `${line}\n`;
        }
    }
    flush();
    if (preamble.join('\n').trim()) {
        sections.unshift({ title: '总览', content: preamble.join('\n').trim() });
    }
    return sections;
}

function addSettingNodes(
    source: StoryContextSource,
    nodes: Map<string, StoryContextNode>,
    byKind: Record<StoryContextKind, StoryContextNode[]>,
): void {
    const data = source.context.data;
    const worldview = String(data.world_view?.raw || '').trim();
    if (worldview) {
        pushNode(nodes, byKind, makeNode({
            id: 'worldview',
            kind: 'worldview',
            title: '世界观',
            text: clip(worldview, 3200),
            compactText: firstSentences(worldview, 650),
            priority: 95,
            required: true,
            sourcePath: '世界观',
            metadata: { legacyVar: 'worldView' },
        }));
    }

    const settingLib = String(data.setting_lib?.raw || '').trim();
    if (!settingLib) return;
    const sections = parseSettingSections(settingLib);
    if (sections.length === 0) {
        pushNode(nodes, byKind, makeNode({
            id: 'setting:full',
            kind: 'setting',
            title: '设定库',
            text: clip(settingLib, 6000),
            compactText: firstSentences(settingLib, 500),
            priority: 70,
            sourcePath: '设定库',
            metadata: { legacyVar: 'settingLib' },
        }));
        return;
    }

    sections.forEach((section, index) => {
        const title = section.title || `设定 ${index + 1}`;
        const content = section.content.trim();
        if (!content && !section.title) return;
        pushNode(nodes, byKind, makeNode({
            id: `setting:${index}`,
            kind: 'setting',
            title,
            text: `## ${title}\n${content}`.trim(),
            compactText: firstSentences(`${title}。${content}`, 320),
            priority: 60,
            sourcePath: '设定库',
            metadata: { legacyVar: 'settingLib', settingTitle: title, settingIndex: index },
        }));
    });
}

// ============================================================
// 实体
// ============================================================

function entityName(record: Record<string, unknown>, fallback: string): string {
    return String(record.name || record.姓名 || record.名称 || record.fileName || fallback || '').trim();
}

function entityAliases(record: Record<string, unknown>): string[] {
    const aliases = [
        ...splitNames(record.别称 as string | string[] | undefined),
        ...splitNames(record.别名 as string | string[] | undefined),
        ...splitNames(record.曾用名 as string | string[] | undefined),
    ];
    return [...new Set(aliases.map(normalizeName).filter(Boolean))];
}

function characterPriority(record: Record<string, unknown>): { priority: number; required: boolean; role: string } {
    const roleText = [
        record.角色定位, record.身份, record.角色, record.定位,
    ].filter(Boolean).join(' ');
    if (PROTAGONIST_RE.test(roleText)) return { priority: 100, required: true, role: '主角' };
    if (MAJOR_RE.test(roleText)) return { priority: 78, required: false, role: '重要配角' };
    if (MINOR_RE.test(roleText)) return { priority: 52, required: false, role: '配角' };
    return { priority: 40, required: false, role: '人物' };
}

function formatCharacter(record: Record<string, unknown>, compact: boolean): { text: string; line: string } {
    const name = entityName(record, '?');
    const parts: string[] = [];
    const push = (label: string, value: unknown) => {
        const text = String(value || '').trim();
        // v4.22：人物字段上限跟预算走（旧值紧凑 60 / 完整 240 字，
        // 会把「人物背景/软肋/功法」这类长字段砍到只剩一句 → 续写 OOC）
        const fullCap = activeContextQuotas().entityFieldChars;
        if (text) parts.push(`${label}：${clip(text, compact ? Math.round(fullCap * 0.2) : fullCap)}`);
    };
    push('角色定位', record.角色定位);
    push('身份', record.身份);
    push('当前状态', record.当前状态);
    push('核心动机', record.核心动机);
    if (!compact) {
        push('性格', record.性格标签);
        push('当前目标', record.当前目标);
        push('能力', record['金手指/特殊能力']);
        push('所属势力', record.所属势力);
        push('当前位置', record.当前位置);
        push('背景', record.人物背景);
        push('外貌', record.外貌特征);
        push('软肋', record.核心驱动力_软肋);
        push('习惯', record.习惯性小动作);
        push('当前情绪', record.当前情绪);
        push('功法', record['功法/技能树']);
    } else {
        push('所属势力', record.所属势力);
        push('当前位置', record.当前位置);
        push('当前情绪', record.当前情绪);
    }
    const body = parts.join('；') || '（无详细字段）';
    return {
        text: `【${name}】${body}`,
        line: `- ${name}：${body}`,
    };
}

function formatFaction(record: Record<string, unknown>, compact: boolean): { text: string; line: string } {
    const name = entityName(record, '?');
    const parts: string[] = [];
    const push = (label: string, value: unknown) => {
        const text = String(value || '').trim();
        if (text) parts.push(`${label}：${clip(text, compact ? 50 : 200)}`);
    };
    push('类型', record.类型);
    push('地位', record['地位/排名']);
    if (!compact) {
        push('领袖', record.领袖);
        push('描述', record.描述);
        push('所在地', record.所在地 || record.所在区域);
    } else {
        push('领袖', record.领袖);
    }
    const body = parts.join('；') || '（无详细字段）';
    return { text: `【${name}】${body}`, line: `- ${name}：${body}` };
}

function formatLocation(record: Record<string, unknown>, compact: boolean): { text: string; line: string } {
    const name = entityName(record, '?');
    const parts: string[] = [];
    const push = (label: string, value: unknown) => {
        const text = String(value || '').trim();
        if (text) parts.push(`${label}：${clip(text, compact ? 50 : 220)}`);
    };
    push('类型', record.类型);
    push('所在区域', record['所在世界/区域']);
    push('重要程度', record.重要程度);
    if (!compact) {
        push('地理特征', record['地理特征']);
        push('居民/势力', record['主要居民/势力']);
        push('描述', record.描述);
    }
    const body = parts.join('；') || '（无详细字段）';
    return { text: `【${name}】${body}`, line: `- ${name}：${body}` };
}

function formatItem(record: Record<string, unknown>, compact: boolean): { text: string; line: string } {
    const name = entityName(record, '?');
    const parts: string[] = [];
    const push = (label: string, value: unknown) => {
        const text = String(value || '').trim();
        if (text) parts.push(`${label}：${clip(text, compact ? 50 : 180)}`);
    };
    push('类型', record.类型);
    push('品阶', record['品阶/等级']);
    if (!compact) {
        push('效果', record.效果);
        push('归属', record['所属/归属']);
        push('描述', record.描述);
    } else {
        push('归属', record['所属/归属']);
    }
    const body = parts.join('；') || '（无详细字段）';
    return { text: `【${name}】${body}`, line: `- ${name}：${body}` };
}

function addEntityNodes(
    source: StoryContextSource,
    nodes: Map<string, StoryContextNode>,
    byKind: Record<StoryContextKind, StoryContextNode[]>,
): void {
    const data = source.context.data;
    const characters = (data.character_state || []) as Record<string, unknown>[];
    for (const record of characters) {
        const name = entityName(record, '');
        if (!name) continue;
        const full = formatCharacter(record, false);
        const compact = formatCharacter(record, true);
        const info = characterPriority(record);
        pushNode(nodes, byKind, makeNode({
            id: `character:${name}`,
            kind: 'character',
            title: name,
            text: full.text,
            compactText: compact.text,
            priority: info.priority,
            required: info.required,
            sourcePath: `人物/${name}`,
            metadata: {
                legacyVar: 'allChars',
                legacyLine: full.line,
                role: info.role,
                faction: String(record.所属势力 || ''),
                location: String(record.当前位置 || ''),
                aliases: entityAliases(record),
                entityStatus: String(record.entity_status || ''),
            },
        }));
    }

    const factions = (data.factions || []) as Record<string, unknown>[];
    for (const record of factions) {
        const name = entityName(record, '');
        if (!name) continue;
        const full = formatFaction(record, false);
        const compact = formatFaction(record, true);
        pushNode(nodes, byKind, makeNode({
            id: `faction:${name}`,
            kind: 'faction',
            title: name,
            text: full.text,
            compactText: compact.text,
            priority: 52,
            sourcePath: `势力/${name}`,
            metadata: {
                legacyVar: 'allFactions',
                legacyLine: full.line,
                aliases: entityAliases(record),
            },
        }));
    }

    const locations = (data.locations || []) as Record<string, unknown>[];
    for (const record of locations) {
        const name = entityName(record, '');
        if (!name) continue;
        const full = formatLocation(record, false);
        const compact = formatLocation(record, true);
        pushNode(nodes, byKind, makeNode({
            id: `location:${name}`,
            kind: 'location',
            title: name,
            text: full.text,
            compactText: compact.text,
            priority: 62,
            sourcePath: `地点/${name}`,
            metadata: {
                legacyVar: 'allLocs',
                legacyLine: full.line,
                aliases: entityAliases(record),
                region: String(record['所在世界/区域'] || ''),
            },
        }));
    }

    const items = (data.items || []) as Record<string, unknown>[];
    for (const record of items) {
        const name = entityName(record, '');
        if (!name) continue;
        const full = formatItem(record, false);
        const compact = formatItem(record, true);
        const itemAliases = [
            ...entityAliases(record),
            ...name.split(/[·\-—]/).map(part => part.trim()).filter(part => part.length >= 2),
        ];
        pushNode(nodes, byKind, makeNode({
            id: `item:${name}`,
            kind: 'item',
            title: name,
            text: full.text,
            compactText: compact.text,
            priority: 45,
            sourcePath: `物品功法/${name}`,
            metadata: {
                legacyVar: 'allItems',
                legacyLine: full.line,
                aliases: [...new Set(itemAliases)],
            },
        }));
    }
}

// ============================================================
// 时间线
// ============================================================

function timelinePriority(state: string): number {
    if (state === 'in-chapter') return 90;
    if (state === 'past') return 62;
    if (state === 'future') return 30;
    return 42;
}

function addTimelineNodes(
    source: StoryContextSource,
    nodes: Map<string, StoryContextNode>,
    byKind: Record<StoryContextKind, StoryContextNode[]>,
    warnings: string[],
): void {
    const timeline = (source.context.data.timeline || []) as unknown as Array<Record<string, unknown>>;
    const seen = new Set<string>();
    let duplicates = 0;
    timeline.forEach((event, index) => {
        const chapter = String(event.chapter || '');
        const eventNum = parseInt(chapter.match(/第\s*(\d+)\s*章/)?.[1] || '0', 10);
        const state = eventNum === source.chapterNum && source.chapterNum > 0
            ? 'in-chapter'
            : eventNum > 0 && eventNum < source.chapterNum ? 'past' : 'future';
        const time = String(event.time || '').trim();
        const eventName = String(event.eventName || event.event || '').trim();
        const impact = String(event.impact || '').trim();
        const involved = splitNames(event.involvedEntities as string[] | undefined);
        if (!eventName && !time) return;
        const dedupeKey = `${time}|${chapter}|${eventName}|${impact}`;
        if (seen.has(dedupeKey)) {
            duplicates++;
            return;
        }
        seen.add(dedupeKey);
        const title = `${chapter || '—'} · ${clip(eventName || time, 36)}`;
        const full = [
            time ? `时间：${time}` : '',
            chapter ? `章节：${chapter}` : '',
            eventName ? `事件：${eventName}` : '',
            impact ? `影响：${impact}` : '',
            involved.length ? `涉及：${involved.join('、')}` : '',
        ].filter(Boolean).join('；');
        const compact = `${chapter || '—'} · ${clip(eventName || time, 40)}${involved.length ? `（${involved.join('、')}）` : ''}`;
        pushNode(nodes, byKind, makeNode({
            id: `timeline:${index}`,
            kind: 'timeline',
            title,
            text: full || title,
            compactText: compact,
            priority: timelinePriority(state),
            // 是否必含由 collectRequiredIds 按“本章最近 3 条”决定，避免一章几十条时间线全部必含
            required: false,
            sourcePath: '时间线',
            metadata: {
                legacyVar: 'timelineEvents',
                legacyLine: `- ${time || '—'} | ${chapter || '—'} | ${eventName || '—'} | ${impact || '—'}`,
                chapter, eventNum, state, time, eventName, impact, involved,
            },
        }));
    });
    if (duplicates > 0) warnings.push(`时间线有 ${duplicates} 条重复事件，已去重后使用，原文件未修改`);
}

// ============================================================
// 伏笔
// ============================================================

function foreshadowState(
    item: Record<string, unknown>,
    source: StoryContextSource,
    linkage: StoryLinkage | null,
): 'due' | 'overdue' | 'upcoming' | 'later' | 'revealed' | 'abandoned' | 'unknown' {
    const name = String(item.name || '').trim();
    if (linkage) {
        if (linkage.due.some(f => f.name === name)) return 'due';
        if (linkage.overdue.some(f => f.name === name)) return 'overdue';
        if (linkage.upcoming.some(f => f.name === name)) return 'upcoming';
    }
    const status = String(item.status || '');
    if (status.includes('已揭示') || status.includes('已回收')) return 'revealed';
    if (status.includes('废弃')) return 'abandoned';
    const planned = String(item.plannedReveal || '');
    const match = planned.match(/第\s*(\d+)\s*章/);
    if (!match) return 'unknown';
    const plannedNum = parseInt(match[1], 10);
    if (plannedNum === source.chapterNum) return 'due';
    if (plannedNum < source.chapterNum) return 'overdue';
    if (plannedNum <= source.chapterNum + 3) return 'upcoming';
    return 'later';
}

function foreshadowPriority(state: string): number {
    switch (state) {
        case 'due': return 98;
        case 'overdue': return 96;
        case 'upcoming': return 82;
        case 'unknown': return 55;
        case 'later': return 42;
        default: return 25;
    }
}

function addForeshadowNodes(
    source: StoryContextSource,
    nodes: Map<string, StoryContextNode>,
    byKind: Record<StoryContextKind, StoryContextNode[]>,
    warnings: string[],
): void {
    const data = source.context.data;
    const fs = data.foreshadows;
    if (!fs) return;
    const linkage = source.storyLinkage || data.story_linkage || null;
    const all: Array<{ item: Record<string, unknown>; group: string }> = [
        ...(fs.unrevealed || []).map(item => ({ item: item as unknown as Record<string, unknown>, group: 'unrevealed' })),
        ...(fs.revealed || []).map(item => ({ item: item as unknown as Record<string, unknown>, group: 'revealed' })),
        ...(fs.abandoned || []).map(item => ({ item: item as unknown as Record<string, unknown>, group: 'abandoned' })),
    ];
    const seen = new Set<string>();
    let duplicates = 0;
    all.forEach(({ item, group }, index) => {
        const name = String(item.name || '').trim();
        if (!name) return;
        const dedupeKey = normalizeName(name);
        if (seen.has(dedupeKey)) {
            duplicates++;
            return;
        }
        seen.add(dedupeKey);
        const state = group === 'unrevealed' ? foreshadowState(item, source, linkage) : group;
        const id = `foreshadow:${String(item.id || name)}:${index}`;
        const importance = String(item.importance || '中');
        const relatedChars = splitNames(item.relatedChars as string | undefined);
        const relatedMainline = String(item.relatedMainline || '').trim();
        const full = [
            `名称：${name}`,
            `重要度：${importance}`,
            item.buryChapter ? `埋设：${item.buryChapter}` : '',
            item.plannedReveal ? `计划回收：${item.plannedReveal}` : '',
            item.status ? `状态：${item.status}` : '',
            relatedChars.length ? `关联人物：${relatedChars.join('、')}` : '',
            relatedMainline ? `关联主线：${relatedMainline}` : '',
        ].filter(Boolean).join('；');
        const compact = `${name}（${importance}${item.plannedReveal ? `；计划 ${item.plannedReveal}` : ''}）`;
        pushNode(nodes, byKind, makeNode({
            id,
            kind: 'foreshadow',
            title: name,
            text: full,
            compactText: compact,
            priority: foreshadowPriority(state),
            // 是否必含由 collectRequiredIds 按“到期/逾期最多 6 条”决定
            required: false,
            sourcePath: '伏笔库',
            metadata: {
                legacyVar: 'unrevealedForeshadow',
                legacyLine: `[${item.id || index}] ${compact}`,
                foreshadowId: String(item.id || index),
                state,
                importance,
                plannedReveal: String(item.plannedReveal || ''),
                buryChapter: String(item.buryChapter || ''),
                relatedChars,
                relatedMainline,
            },
        }));
    });
    if (duplicates > 0) warnings.push(`伏笔库有 ${duplicates} 条同名重复记录，已按名称合并，原文件未修改`);
}

// ============================================================
// 场景卡 / 情绪弧
// ============================================================

const SCENE_HEADER_RE = /^#{2,6}\s*(?:场景|scene)\s*([0-9一二三四五六七八九十百]+)\s*[：:]\s*(.*)$/im;

function parseChineseNum(raw: string): number | null {
    const map: Record<string, number> = {
        零: 0, 〇: 0, 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 百: 100,
    };
    if (raw.length === 1) return map[raw] ?? null;
    if (raw === '十') return 10;
    const match = raw.match(/^(十)?([一二三四五六七八九])?$/);
    if (!match) return null;
    return (match[1] ? 10 : 0) + (match[2] ? map[match[2]] : 0);
}

/**
 * parseStorySceneCards 函数。
 * @param content - 内容
 * @returns 结果数组
 */
export function parseStorySceneCards(content: string): SceneCardFields[] {
    const raw = String(content || '');
    if (!raw.trim()) return [];
    const lines = raw.split(/\r?\n/);
    const blocks: Array<{ num: number; name: string; lines: string[] }> = [];
    let current: { num: number; name: string; lines: string[] } | null = null;
    for (const line of lines) {
        const header = line.match(SCENE_HEADER_RE);
        if (header) {
            const rawNum = header[1];
            const num = /^\d+$/.test(rawNum) ? parseInt(rawNum, 10) : (parseChineseNum(rawNum) ?? blocks.length + 1);
            current = { num, name: (header[2] || '').trim(), lines: [] };
            blocks.push(current);
        } else if (current) {
            current.lines.push(line);
        }
    }
    return blocks.map(block => {
        const rawBlock = block.lines.join('\n');
        const card = parseSceneCardFields(rawBlock, {
            num: block.num,
            name: block.name,
        });
        // 兼容人工编辑/旧模板的中文字段名
        const aliases: Array<[keyof SceneCardFields, string]> = [
            ['pov', '视角'],
            ['time', '时间'],
            ['location', '地点'],
            ['objective', '目标'],
            ['entryState', '入场'],
            ['conflict', '冲突'],
            ['turn', '转折'],
            ['exitState', '离场'],
            ['emotionArc', '情绪弧'],
            ['sensoryHook', '感官钩子'],
            ['bodyReaction', '身体反应'],
            ['characters', '出场人物'],
        ];
        for (const [key, alias] of aliases) {
            if ((card as unknown as Record<string, string>)[key]) continue;
            const value = parseSceneField(rawBlock, alias);
            if (value) (card as unknown as Record<string, string>)[key] = value;
        }
        return card;
    });
}

function sceneDigest(card: SceneCardFields): string {
    const parts = [
        card.pov ? `POV:${card.pov}` : '',
        card.time ? `时间:${card.time}` : '',
        card.location ? `地点:${card.location}` : '',
        card.objective ? `目标:${card.objective}` : '',
        card.conflict ? `冲突:${card.conflict}` : '',
        card.turn ? `转折:${card.turn}` : '',
        card.exitState ? `离场:${card.exitState}` : '',
        card.emotionArc ? `情绪:${card.emotionArc}` : '',
        card.sensoryHook ? `感官:${card.sensoryHook}` : '',
    ].filter(Boolean);
    return parts.join(' | ');
}

function addSceneNodes(
    source: StoryContextSource,
    nodes: Map<string, StoryContextNode>,
    byKind: Record<StoryContextKind, StoryContextNode[]>,
): void {
    const text = source.sceneExpansionText || String(source.context.data.scene_expansion?.raw || '');
    const cards = parseStorySceneCards(text);
    cards.forEach(card => {
        const title = `场景${card.num}${card.name ? `「${card.name}」` : ''}`;
        const full = [
            `## ${title}`,
            card.pov ? `POV：${card.pov}` : '',
            card.time ? `时间：${card.time}` : '',
            card.location ? `地点：${card.location}` : '',
            card.objective ? `目标：${card.objective}` : '',
            card.entryState ? `入场：${card.entryState}` : '',
            card.conflict ? `冲突：${card.conflict}` : '',
            card.turn ? `转折：${card.turn}` : '',
            card.exitState ? `离场：${card.exitState}` : '',
            card.emotionArc ? `情绪弧：${card.emotionArc}` : '',
            card.sensoryHook ? `感官钩子：${card.sensoryHook}` : '',
            card.bodyReaction ? `身体反应：${card.bodyReaction}` : '',
            card.memoryTrigger ? `记忆触发：${card.memoryTrigger}` : '',
            card.characters ? `出场人物：${card.characters}` : '',
            card.cliffhanger ? `章末钩子：${card.cliffhanger}` : '',
        ].filter(Boolean).join('\n');
        pushNode(nodes, byKind, makeNode({
            id: `scene:${card.num}`,
            kind: 'scene',
            title,
            text: full,
            compactText: `${title}：${sceneDigest(card) || '（无摘要）'}`,
            priority: 88,
            sourcePath: 'Scene 展开',
            metadata: {
                legacyVar: 'sceneCardDigest',
                sceneNum: card.num,
                sceneName: card.name,
                location: card.location || '',
                characters: splitNames(card.characters),
                pov: card.pov || '',
                time: card.time || '',
                card,
            },
        }));
    });
}

interface ParsedEmotionScene {
    num: number;
    name: string;
    emotionStart: string;
    emotionEnd: string;
    delta: string;
    bodyReaction: string;
    relationshipChange: string;
}

function parseEmotionScenes(text: string): ParsedEmotionScene[] {
    const raw = String(text || '').replace(/\r\n?/g, '\n');
    if (!raw.trim()) return [];
    const headerRe = /^#{2,6}\s*(?:scene|场景)\s*([0-9一二三四五六七八九十百]+)\s*[：:]\s*(.*)$/gim;
    const matches = [...raw.matchAll(headerRe)];
    if (matches.length === 0) return [];
    return matches.map((match, index) => {
        const start = match.index ?? 0;
        const end = index + 1 < matches.length ? (matches[index + 1].index ?? raw.length) : raw.length;
        const block = raw.slice(start, end);
        const field = (name: string): string => {
            const re = new RegExp(`^\\s*${name}\\s*[：:]\\s*(.+)$`, 'im');
            return block.match(re)?.[1]?.trim() || '';
        };
        const rawNum = match[1];
        return {
            num: /^\d+$/.test(rawNum) ? parseInt(rawNum, 10) : (parseChineseNum(rawNum) ?? index + 1),
            name: (match[2] || '').trim(),
            emotionStart: field('emotion_start'),
            emotionEnd: field('emotion_end'),
            delta: field('emotion_delta'),
            bodyReaction: field('body_reaction'),
            relationshipChange: field('relationship_change'),
        };
    });
}

function addEmotionNodes(
    source: StoryContextSource,
    nodes: Map<string, StoryContextNode>,
    byKind: Record<StoryContextKind, StoryContextNode[]>,
): void {
    const text = source.emotionPlanText || String(source.context.data.emotion_plan?.raw || '');
    const scenes = parseEmotionScenes(text);
    if (scenes.length === 0) {
        if (text.trim()) {
            pushNode(nodes, byKind, makeNode({
                id: 'emotion:chapter',
                kind: 'emotion',
                title: '本章情绪曲线',
                text: clip(text, 2400),
                compactText: firstSentences(text, 360),
                priority: 70,
                sourcePath: '情绪规划',
                metadata: { legacyVar: 'emotionPlan' },
            }));
        }
        return;
    }
    scenes.forEach(scene => {
        const title = `情绪弧 场景${scene.num}${scene.name ? `「${scene.name}」` : ''}`;
        const full = [
            title,
            scene.emotionStart ? `入场：${scene.emotionStart}` : '',
            scene.emotionEnd ? `离场：${scene.emotionEnd}` : '',
            scene.delta ? `变化：${scene.delta}` : '',
            scene.bodyReaction ? `身体反应：${scene.bodyReaction}` : '',
            scene.relationshipChange ? `关系变化：${scene.relationshipChange}` : '',
        ].filter(Boolean).join('；');
        pushNode(nodes, byKind, makeNode({
            id: `emotion:${scene.num}`,
            kind: 'emotion',
            title,
            text: full,
            compactText: `${title}：${scene.emotionStart || '—'} → ${scene.emotionEnd || '—'}${scene.delta ? `（${scene.delta}）` : ''}`,
            priority: 84,
            sourcePath: '情绪规划',
            metadata: {
                legacyVar: 'emotionPlan',
                sceneNum: scene.num,
                sceneName: scene.name,
                relationshipChange: scene.relationshipChange,
            },
        }));
    });
}

// ============================================================
// 图构建与自动关联
// ============================================================

function buildSourceHash(source: StoryContextSource): string {
    const data = source.context.data;
    const parts = [
        source.project,
        source.chapterName,
        String(source.chapterNum),
        String(data.world_view?.raw?.length || 0),
        String(data.setting_lib?.raw?.length || 0),
        String(data.character_state?.length || 0),
        String(data.factions?.length || 0),
        String(data.locations?.length || 0),
        String(data.items?.length || 0),
        String(data.timeline?.length || 0),
        String(data.foreshadows?.unrevealed?.length || 0),
        String(source.sceneExpansionText?.length || data.scene_expansion?.raw?.length || 0),
        String(source.emotionPlanText?.length || data.emotion_plan?.raw?.length || 0),
        source.context.gatheredAt || '',
    ];
    let hash = 2166136261;
    const input = parts.join('|');
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}

function indexNames(graph: StoryContextGraph): void {
    const add = (name: string, id: string) => {
        const key = normalizeName(name);
        if (!key || key.length < 2) return;
        const list = graph.nameIndex.get(key) || [];
        if (!list.includes(id)) list.push(id);
        graph.nameIndex.set(key, list);
    };
    for (const node of graph.nodes.values()) {
        add(node.title, node.id);
        const aliases = node.metadata.aliases;
        if (Array.isArray(aliases)) {
            for (const alias of aliases) add(String(alias), node.id);
        }
        if (node.kind === 'foreshadow') add(node.title, node.id);
    }
}

function addLink(node: StoryContextNode, targetId: string, reason: StoryContextLink['reason'], weight: number): void {
    if (node.id === targetId) return;
    const existing = node.links.find(link => link.targetId === targetId);
    if (existing) {
        if (weight > existing.weight) {
            existing.weight = weight;
            existing.reason = reason;
        }
        return;
    }
    node.links.push({ targetId, reason, weight });
}

function linkText(graph: StoryContextGraph, node: StoryContextNode, text: string, reason: StoryContextLink['reason'], weight: number): void {
    const haystack = normalizeName(text);
    if (!haystack) return;
    for (const [name, ids] of graph.nameIndex) {
        if (name.length < 2 || !haystack.includes(name)) continue;
        for (const id of ids) addLink(node, id, reason, weight);
    }
}

function linkGraph(graph: StoryContextGraph): void {
    indexNames(graph);

    for (const node of graph.nodes.values()) {
        switch (node.kind) {
            case 'scene': {
                const chars = (node.metadata.characters as string[] | undefined) || [];
                for (const name of chars) {
                    const ids = graph.nameIndex.get(normalizeName(name)) || [];
                    for (const id of ids) addLink(node, id, 'scene-explicit', 5);
                }
                const location = String(node.metadata.location || '');
                if (location) {
                    const ids = graph.nameIndex.get(normalizeName(location)) || [];
                    for (const id of ids) addLink(node, id, 'scene-explicit', 5);
                }
                const pov = String(node.metadata.pov || '');
                if (pov) {
                    const ids = graph.nameIndex.get(normalizeName(pov)) || [];
                    for (const id of ids) addLink(node, id, 'scene-explicit', 4);
                }
                linkText(graph, node, node.text, 'scene-mention', 2);
                break;
            }
            case 'emotion': {
                const sceneNum = Number(node.metadata.sceneNum || 0);
                if (sceneNum > 0) addLink(node, `scene:${sceneNum}`, 'emotion-scene', 5);
                const rel = String(node.metadata.relationshipChange || '');
                if (rel) linkText(graph, node, rel, 'emotion-scene', 2);
                break;
            }
            case 'timeline': {
                const involved = (node.metadata.involved as string[] | undefined) || [];
                for (const name of involved) {
                    const ids = graph.nameIndex.get(normalizeName(name)) || [];
                    for (const id of ids) addLink(node, id, 'timeline-mention', 4);
                }
                linkText(graph, node, node.text, 'timeline-mention', 2);
                break;
            }
            case 'foreshadow': {
                const related = (node.metadata.relatedChars as string[] | undefined) || [];
                for (const name of related) {
                    const ids = graph.nameIndex.get(normalizeName(name)) || [];
                    for (const id of ids) addLink(node, id, 'foreshadow-related', 4);
                }
                linkText(graph, node, node.text, 'foreshadow-related', 2);
                break;
            }
            case 'setting': {
                linkText(graph, node, node.text, 'setting-mention', 2);
                const title = String(node.metadata.settingTitle || node.title);
                const ids = graph.nameIndex.get(normalizeName(title)) || [];
                for (const id of ids) addLink(node, id, 'setting-mention', 4);
                break;
            }
            case 'character':
            case 'faction':
            case 'location':
            case 'item': {
                linkText(graph, node, node.text, 'alias', 1);
                break;
            }
            default:
                break;
        }
    }

    // 反向关联：如果实体/设定被场景或伏笔引用，补一条反向边，便于扩展检索
    for (const node of graph.nodes.values()) {
        for (const link of node.links) {
            const target = graph.nodes.get(link.targetId);
            if (!target) continue;
            addLink(target, node.id, link.reason, Math.max(1, link.weight - 1));
        }
    }
}

/**
 * 构建故事上下文图。
 * @param source - 来源
  * @returns StoryContextGraph 实例
 */
export function buildStoryContextGraph(source: StoryContextSource): StoryContextGraph {
    const nodes = new Map<string, StoryContextNode>();
    const byKind = emptyByKind<StoryContextNode>();
    const warnings: string[] = [];
    addSettingNodes(source, nodes, byKind);
    addEntityNodes(source, nodes, byKind);
    addTimelineNodes(source, nodes, byKind, warnings);
    addForeshadowNodes(source, nodes, byKind, warnings);
    addSceneNodes(source, nodes, byKind);
    addEmotionNodes(source, nodes, byKind);
    // 事实节点（v4.89 P0）：与既有节点同住一张图；缺省时零影响
    const factNodes = source.factNodes ?? [];
    for (const node of factNodes) pushNode(nodes, byKind, node);

    const graph: StoryContextGraph = {
        project: source.project,
        chapterName: source.chapterName,
        chapterNum: source.chapterNum,
        volume: source.volume || '',
        nodes,
        byKind,
        nameIndex: new Map(),
        sourceHash: buildSourceHash(source),
        warnings,
    };
    linkGraph(graph);
    // 事实节点连到同名实体（复用既有 links；linkGraph 只按 title 建 nameIndex，
    // 事实节点 title 是「主体·谓词」，需显式按 subject 连边）
    if (factNodes.length > 0) {
        const inGraph = factNodes.filter(node => graph.nodes.has(node.id));
        const entities = [...graph.nodes.values()].filter(node => !node.id.startsWith('fact:'));
        linkFactsToEntities(inGraph, entities);
    }
    return graph;
}

// ============================================================
// 检索与预算装配
// ============================================================

/**
 * 解析故事上下文配置档。
 * @param tier - 层级
 * @param maxInputTokens - 最大输入 token 数
  * @returns StoryContextProfile 实例
 */
export function resolveStoryContextProfile(
    tier: StoryContextTier,
    maxInputTokens?: number,
): StoryContextProfile {
    const base = DEFAULT_PROFILES[tier];
    if (!maxInputTokens || maxInputTokens <= 0) return base;
    const share = 0.55;
    const fromWindow = Math.floor(maxInputTokens * share);
    return {
        ...base,
        maxPackTokens: Math.max(900, Math.min(base.maxPackTokens, fromWindow)),
    };
}

function findSceneNode(graph: StoryContextGraph, scene: SceneCardFields | undefined): StoryContextNode | null {
    if (!scene) return null;
    const byNum = graph.nodes.get(`scene:${scene.num}`);
    if (byNum) return byNum;
    if (scene.name) {
        const normalized = normalizeName(scene.name);
        for (const node of graph.byKind.scene) {
            if (normalizeName(node.metadata.sceneName as string || '') === normalized) return node;
        }
    }
    return null;
}

function collectRequiredIds(graph: StoryContextGraph, request: StoryContextRequest): Set<string> {
    const required = new Set<string>();
    for (const node of graph.nodes.values()) {
        if (node.required) required.add(node.id);
    }
    for (const id of request.pinnedIds || []) {
        if (graph.nodes.has(id)) required.add(id);
    }
    const sceneNode = findSceneNode(graph, request.scene);
    const addSceneLinks = (scene: StoryContextNode) => {
        required.add(scene.id);
        for (const link of scene.links) {
            const target = graph.nodes.get(link.targetId);
            if (!target) continue;
            // 显式字段（出场人物/地点/POV）直接必含；场景正文里点名的角色/地点也必含，
            // 避免没有 characters 字段的旧场景卡把在场角色降级成可选。
            if (link.weight >= 5
                || (link.weight >= 2 && (target.kind === 'character' || target.kind === 'location'))) {
                required.add(link.targetId);
            }
        }
    };
    if (sceneNode) {
        addSceneLinks(sceneNode);
    } else if (request.mode === 'one-click') {
        // 一键生成覆盖整章：所有场景卡及其显式关联的人物/地点/物品都必须进入信息包
        for (const node of graph.byKind.scene) {
            addSceneLinks(node);
        }
        for (const node of graph.byKind.emotion) required.add(node.id);
    }
    // 本章时间线只保留最近 3 条为必含，避免一章几十条背景事件把预算吃光
    const inChapterTimeline = graph.byKind.timeline
        .filter(node => node.metadata.state === 'in-chapter');
    for (const node of inChapterTimeline.slice(-3)) required.add(node.id);

    // 到期/逾期伏笔最多 6 条必含；其余作为高优先级可选，避免信息债过大时挤掉场景/人物
    const urgentForeshadows = graph.byKind.foreshadow
        .filter(node => node.metadata.state === 'due' || node.metadata.state === 'overdue')
        .sort((a, b) => b.priority - a.priority)
        .slice(0, 6);
    for (const node of urgentForeshadows) required.add(node.id);
    if (sceneNode) {
        for (const node of graph.byKind.emotion) {
            if (Number(node.metadata.sceneNum || 0) === Number(sceneNode.metadata.sceneNum || 0)) {
                required.add(node.id);
            }
        }
    }
    return required;
}

function relatedToRequired(graph: StoryContextGraph, node: StoryContextNode, required: Set<string>): number {
    let score = 0;
    for (const link of node.links) {
        if (required.has(link.targetId)) score += link.weight * 3;
    }
    for (const requiredId of required) {
        const requiredNode = graph.nodes.get(requiredId);
        if (!requiredNode) continue;
        for (const link of requiredNode.links) {
            if (link.targetId === node.id) score += link.weight * 2;
        }
    }
    return score;
}

function selectCandidates(
    graph: StoryContextGraph,
    request: StoryContextRequest,
    requiredIds: Set<string>,
): StoryContextNode[] {
    const queryTokens = extractKeywordTokens(
        `${request.precedingText || ''}\n${request.queryText || ''}\n${request.scene ? JSON.stringify(request.scene) : ''}`,
        90,
    );
    const sceneNode = findSceneNode(graph, request.scene);
    const sceneId = sceneNode?.id || '';
    const candidates: Array<{ node: StoryContextNode; score: number }> = [];

    for (const node of graph.nodes.values()) {
        let score = node.priority;
        if (requiredIds.has(node.id)) score += 200;
        if (sceneId) {
            if (node.id === sceneId) score += 120;
            for (const link of node.links) {
                if (link.targetId === sceneId) score += link.weight * 8;
            }
            if (sceneNode) {
                for (const link of sceneNode.links) {
                    if (link.targetId === node.id) score += link.weight * 10;
                }
            }
        }
        score += relatedToRequired(graph, node, requiredIds);
        if (queryTokens.length > 0) {
            score += keywordOverlapRatio(queryTokens, node.text) * 30;
        }
        if (node.kind === 'timeline' && node.metadata.state === 'in-chapter') score += 25;
        if (node.kind === 'foreshadow') {
            const state = node.metadata.state;
            if (state === 'due' || state === 'overdue') score += 30;
            else if (state === 'upcoming') score += 12;
        }
        if (request.mode === 'co-write' && node.kind === 'scene' && node.id !== sceneId) score -= 40;
        if (request.mode === 'co-write' && node.kind === 'worldview') score -= 10;
        candidates.push({ node, score });
    }

    candidates.sort((a, b) => b.score - a.score);
    return candidates.map(item => item.node);
}

function nodeTextFor(
    node: StoryContextNode,
    profile: StoryContextProfile,
    isRequired: boolean,
    remaining: number,
    modelId?: string,
): { text: string; tokens: number; truncated: boolean } {
    const preferFull = !profile.preferCompact;
    const fullTokens = node.tokens;
    const compactTokens = node.compactTokens;
    if (preferFull && fullTokens <= remaining) {
        return { text: node.text, tokens: fullTokens, truncated: false };
    }
    if (compactTokens <= remaining) {
        return { text: node.compactText, tokens: compactTokens, truncated: false };
    }
    if (remaining > 60) {
        const text = truncateAtSentence(node.compactText || node.text, Math.max(40, remaining - 8), modelId);
        if (text.trim()) {
            return { text, tokens: nodeTokens(text, modelId), truncated: true };
        }
    }
    return { text: '', tokens: 0, truncated: false };
}

/**
 * 预算不足时按句末截断，避免把设定/人物卡切在半句话中间
 *
 * @param text - 文本内容
 * @param maxTokens - 最大 token 数
 * @param modelId - 模型ID
 * @returns 文本结果
 */
function truncateAtSentence(text: string, maxTokens: number, modelId?: string): string {
    const clipped = truncateTextToTokens(text, maxTokens, modelId);
    if (clipped === text) return text;
    const lastPunctuation = Math.max(
        clipped.lastIndexOf('。'),
        clipped.lastIndexOf('！'),
        clipped.lastIndexOf('？'),
        clipped.lastIndexOf('；'),
        clipped.lastIndexOf('…'),
    );
    if (lastPunctuation >= Math.floor(clipped.length * 0.55)) {
        return `${clipped.slice(0, lastPunctuation + 1)}…`;
    }
    return `${clipped.trimEnd()}…`;
}

/**
 * assembleStoryContextBundle 函数。
 * @param graph - 关系图
 * @param request - 请求
  * @returns StoryContextBundle 实例
 */
export function assembleStoryContextBundle(
    graph: StoryContextGraph,
    request: StoryContextRequest,
): StoryContextBundle {
    const profile = resolveStoryContextProfile(request.tier, request.maxInputTokens);
    const budget = profile.maxPackTokens;
    const requiredIds = collectRequiredIds(graph, request);
    const candidates = selectCandidates(graph, request, requiredIds);

    const selected: StoryContextNode[] = [];
    const includedIds = new Set<string>();
    const seenText = new Set<string>();
    const perKindCount = new Map<StoryContextKind, number>();
    const telemetry: StoryContextTelemetry = {
        tier: request.tier,
        mode: request.mode,
        budgetTokens: budget,
        estimatedTokens: 0,
        included: 0,
        dropped: 0,
        truncated: 0,
        deduped: 0,
        dedupeRate: 0,
        requiredTotal: requiredIds.size,
        requiredIncluded: 0,
        missingRequired: [],
        byKind: emptyKindTelemetry(),
        droppedItems: [],
        warnings: [],
    };
    for (const kind of ALL_KINDS) telemetry.byKind[kind].total = graph.byKind[kind].length;
    for (const warning of graph.warnings) telemetry.warnings.push(warning);

    // 透明化“必含项上限”：到期伏笔最多 6 条、本章时间线最多 3 条必含，其余按优先级可选
    const urgentForeshadowCount = graph.byKind.foreshadow
        .filter(node => node.metadata.state === 'due' || node.metadata.state === 'overdue').length;
    if (urgentForeshadowCount > 6) {
        telemetry.warnings.push(`有 ${urgentForeshadowCount} 条到期/逾期伏笔，仅将最重要的 6 条设为必含，其余按优先级可选`);
    }
    const inChapterTimelineCount = graph.byKind.timeline
        .filter(node => node.metadata.state === 'in-chapter').length;
    if (inChapterTimelineCount > 3) {
        telemetry.warnings.push(`本章时间线有 ${inChapterTimelineCount} 条，仅将最近 3 条设为必含，其余按优先级可选`);
    }

    let used = 0;
    const trySelect = (node: StoryContextNode, isRequired: boolean): boolean => {
        if (includedIds.has(node.id)) return true;
        const cap = profile.maxPerKind[node.kind] ?? 99;
        const count = perKindCount.get(node.kind) || 0;
        if (!isRequired && count >= cap) {
            telemetry.droppedItems.push({ id: node.id, kind: node.kind, title: node.title, reason: `超过 ${KIND_LABELS[node.kind]} 名额 ${cap}` });
            return false;
        }
        const remaining = budget - used;
        const chosen = nodeTextFor(node, profile, isRequired, remaining, request.modelId);
        if (!chosen.text) {
            if (isRequired) {
                // 必含项即使超预算也不静默丢弃；用最小可用文本并记录告警
                const minimal = truncateAtSentence(node.compactText || node.text, 60, request.modelId);
                if (minimal.trim()) {
                    const copy = { ...node, text: minimal, tokens: nodeTokens(minimal, request.modelId) };
                    selected.push(copy);
                    includedIds.add(node.id);
                    perKindCount.set(node.kind, count + 1);
                    used += copy.tokens;
                    telemetry.truncated++;
                    telemetry.warnings.push(`必含项「${node.title}」超出预算，已截断到最小文本`);
                    return true;
                }
            }
            telemetry.droppedItems.push({ id: node.id, kind: node.kind, title: node.title, reason: '预算不足' });
            return false;
        }
        const dedupeKey = normalizeName(chosen.text);
        if (dedupeKey && seenText.has(dedupeKey)) {
            telemetry.deduped++;
            telemetry.droppedItems.push({ id: node.id, kind: node.kind, title: node.title, reason: '内容重复' });
            return false;
        }
        const copy: StoryContextNode = {
            ...node,
            text: chosen.text,
            tokens: chosen.tokens,
        };
        selected.push(copy);
        includedIds.add(node.id);
        perKindCount.set(node.kind, count + 1);
        used += chosen.tokens;
        if (dedupeKey) seenText.add(dedupeKey);
        if (chosen.truncated) telemetry.truncated++;
        return true;
    };

    // 1) 必含项优先
    const requiredNodes = candidates.filter(node => requiredIds.has(node.id));
    for (const node of requiredNodes) trySelect(node, true);

    // 2) 其余按分数与名额装配
    for (const node of candidates) {
        if (includedIds.has(node.id)) continue;
        trySelect(node, false);
    }

    telemetry.included = selected.length;
    telemetry.estimatedTokens = used;
    // 去重率口径：重复项 /（真正入选项 + 重复项），避免把「预算不足丢弃」算进去
    telemetry.dedupeRate = telemetry.deduped + telemetry.included > 0
        ? Math.round((telemetry.deduped / (telemetry.deduped + telemetry.included)) * 1000) / 1000
        : 0;
    telemetry.requiredIncluded = requiredNodes.filter(node => includedIds.has(node.id)).length;
    telemetry.missingRequired = requiredNodes.filter(node => !includedIds.has(node.id)).map(node => node.id);
    for (const node of graph.nodes.values()) {
        if (includedIds.has(node.id)) {
            telemetry.byKind[node.kind].included++;
            if (selected.find(s => s.id === node.id && s.tokens < node.tokens)) {
                telemetry.byKind[node.kind].truncated++;
            }
        } else {
            telemetry.byKind[node.kind].dropped++;
        }
    }
    telemetry.dropped = graph.nodes.size - selected.length;
    if (telemetry.missingRequired.length > 0) {
        telemetry.warnings.push(`有 ${telemetry.missingRequired.length} 个必含项未进入信息包：${telemetry.missingRequired.slice(0, 5).join('、')}`);
    }
    if (used > budget) {
        telemetry.warnings.push(`信息包超出预算：${used}/${budget} tokens；已优先保留必含项`);
    }

    const byKind = emptyByKind<StoryContextNode>();
    for (const node of selected) byKind[node.kind].push(node);

    const bundle: StoryContextBundle = {
        tier: request.tier,
        mode: request.mode,
        items: selected,
        byKind,
        telemetry,
        formattedFull: '',
        formattedCrossLink: '',
    };
    bundle.formattedFull = formatStoryContextPack(bundle, 'full');
    bundle.formattedCrossLink = formatStoryContextPack(bundle, 'cross-link');
    return bundle;
}

// ============================================================
// 格式化
// ============================================================

function formatNodeLine(node: StoryContextNode): string {
    if (node.kind === 'scene' || node.kind === 'emotion') return `- ${node.compactText}`;
    if (node.kind === 'worldview' || node.kind === 'setting') return `${node.text}`;
    if (node.kind === 'character' || node.kind === 'faction' || node.kind === 'location' || node.kind === 'item') {
        return `- ${node.compactText}`;
    }
    if (node.kind === 'timeline') return `- ${node.compactText}`;
    if (node.kind === 'foreshadow') return `- ${node.compactText}`;
    return `- ${node.compactText}`;
}

/**
 * formatStoryContextPack 函数。
 * @param bundle - 打包结果
 * @param mode - 模式
 * @returns 文本结果
 */
export function formatStoryContextPack(
    bundle: StoryContextBundle,
    mode: 'full' | 'cross-link' = 'full',
): string {
    const parts: string[] = [];
    const header = `【故事上下文｜${bundle.tier === 'local' ? '本地' : '云端'}｜${bundle.telemetry.included} 项｜约 ${bundle.telemetry.estimatedTokens} tokens】`;
    parts.push(header);

    if (mode === 'cross-link') {
        const byId = new Map(bundle.items.map(node => [node.id, node]));
        const titlesOf = (node: StoryContextNode, kinds: StoryContextKind[]): string[] => {
            const out: string[] = [];
            for (const link of node.links) {
                const target = byId.get(link.targetId);
                if (!target || !kinds.includes(target.kind)) continue;
                if (!out.includes(target.title)) out.push(target.title);
            }
            return out;
        };

        const sceneLines: string[] = [];
        for (const scene of bundle.byKind.scene) {
            const linked = titlesOf(scene, ['character', 'location', 'faction', 'item']);
            const fallback = [
                ...((scene.metadata.characters as string[] | undefined) || []),
                String(scene.metadata.location || ''),
            ].filter(Boolean);
            const names = linked.length > 0 ? linked : [...new Set(fallback)];
            sceneLines.push(`- ${scene.title}${names.length ? ` → ${names.join('、')}` : ''}`);
        }
        if (sceneLines.length) parts.push('■ 场景→人物/地点', ...sceneLines);

        const foreshadowLines = bundle.byKind.foreshadow.map(node => {
            const chars = titlesOf(node, ['character']);
            const related = (node.metadata.relatedChars as string[] | undefined) || [];
            const names = [...new Set([...chars, ...related])];
            const mainline = String(node.metadata.relatedMainline || '').trim();
            return `- ${node.title}${names.length ? ` → ${names.join('、')}` : ''}${mainline ? `；主线：${mainline}` : ''}`;
        });
        if (foreshadowLines.length) parts.push('■ 伏笔→人物/主线', ...foreshadowLines);

        const timelineLines = bundle.byKind.timeline.map(node => {
            const names = titlesOf(node, ['character', 'location', 'faction', 'item']);
            const involved = (node.metadata.involved as string[] | undefined) || [];
            const merged = [...new Set([...names, ...involved])];
            return `- ${node.compactText}${merged.length ? ` → ${merged.join('、')}` : ''}`;
        });
        if (timelineLines.length) parts.push('■ 时间线→实体', ...timelineLines);

        const emotionLines = bundle.byKind.emotion.map(node => `- ${node.compactText}`);
        if (emotionLines.length) parts.push('■ 情绪弧', ...emotionLines);

        // 硬事实（DSH-20261114-01）：拆解事实的 character/location/item/setting 节点
        // 不属于上面任何交叉段，不补这里就进不了 cross-link 摘要——一键 prompt 的
        // storyContextPack 正是这个摘要，事实接线会在最后一公里再次断掉。
        // timeline 类事实已在「时间线→实体」段（compactText 同形），此处排除防重复。
        const factLines = bundle.items
            .filter(node => node.id.startsWith('fact:') && node.kind !== 'timeline')
            .map(node => {
                const linked = titlesOf(node, ['character', 'location', 'faction', 'item', 'setting']);
                return `- ${node.compactText}${linked.length ? ` → ${linked.join('、')}` : ''}`;
            });
        if (factLines.length) parts.push('■ 硬事实→关联实体', ...factLines);

        return parts.join('\n');
    }

    for (const kind of KIND_ORDER) {
        const nodes = bundle.byKind[kind];
        if (!nodes.length) continue;
        const lines = nodes.map(formatNodeLine).filter(Boolean);
        if (!lines.length) continue;
        parts.push(`■ ${KIND_LABELS[kind]}`);
        parts.push(...lines);
    }
    return parts.join('\n');
}

/**
 * 把信息包映射回既有模板变量，保持模板契约不变
 *
 * @param bundle - 打包结果
 * @returns 映射结果
 */
export function formatStoryContextLegacyVars(bundle: StoryContextBundle): Record<string, string> {
    const joinLines = (kind: StoryContextKind, key: 'legacyLine' | 'text'): string => {
        const lines = bundle.byKind[kind]
            .map(node => String(node.metadata[key] || (key === 'legacyLine' ? '' : node.text)).trim())
            .filter(Boolean);
        return [...new Set(lines)].join('\n');
    };
    const entityLine = (node: StoryContextNode): string => {
        const text = node.text.trim();
        const prefix = `【${node.title}】`;
        if (text.startsWith(prefix)) {
            const body = text.slice(prefix.length).trim();
            return body ? `- ${node.title}：${body}` : '';
        }
        return String(node.metadata.legacyLine || '').trim();
    };
    const joinEntities = (kind: StoryContextKind): string => {
        const lines = bundle.byKind[kind].map(entityLine).filter(Boolean);
        return [...new Set(lines)].join('\n');
    };
    // v4.24：只把「现在就该处理 / 状态未知」的伏笔写回模板变量。
    // 旧实现把 upcoming/later（+1..+N 章才揭示）也整条注入，连同「计划 第N章」一起剧透。
    const unrevealed = bundle.byKind.foreshadow
        .filter(node => ['due', 'overdue', 'unknown'].includes(String(node.metadata.state || '')))
        .map(node => String(node.metadata.legacyLine || '').trim())
        .filter(Boolean);
    const sceneLines = bundle.byKind.scene.map(node => node.compactText).filter(Boolean);
    return {
        worldView: bundle.byKind.worldview.map(node => node.text).join('\n\n'),
        settingLib: bundle.byKind.setting.map(node => node.text).join('\n\n'),
        allChars: joinEntities('character'),
        allFactions: joinEntities('faction'),
        allLocs: joinEntities('location'),
        allItems: joinEntities('item'),
        timelineEvents: joinLines('timeline', 'legacyLine'),
        unrevealedForeshadow: [...new Set(unrevealed)].join('\n'),
        emotionPlan: bundle.byKind.emotion.map(node => node.text).join('\n\n'),
        sceneCardDigest: sceneLines.length > 0
            ? `【场景卡（硬约束）】\n${sceneLines.join('\n')}`
            : '',
    };
}

/**
 * 故事上下文种类标签列表常量。
 */
export const STORY_CONTEXT_KIND_LABELS = KIND_LABELS;
