/**
 * book-detail-metrics.ts — 书籍详情页的纯数据准备（无 DOM、无实例状态）
 *
 * 背景（v4.83.0 UI 可测性治理）：`book-detail-renderer.ts` 原有 2,247 行、覆盖率 0.1%、
 * 无任何测试——因为「数据准备」与「DOM 渲染」混在同一个方法里，只能整体靠人工点击验证。
 * 本模块把其中无副作用的判定/归一化/排序/查表抽出来，使这些规则可以单元测试锁定。
 *
 * 约定：本模块不 import obsidian、不碰 HTMLElement、不读 this；输入是知识库数据对象，
 * 输出是图表/列表可直接消费的纯数据。视图侧只保留 createElement 与事件绑定。
 */

import type { StyleData, StructureData, ForeshadowData, TechniqueData } from './knowledge-base-view';

/** 雷达图/柱状图数据项（与 ui/svg-charts 的入参形态一致） */
export interface ChartItem {
    label: string;
    value: number;
}

/** 词云数据项 */
export interface WordCloudItem {
    text: string;
    weight: number;
}

/** 起承转合时间轴事件（与 ui/svg-charts timelineChart 入参一致） */
export interface TimelineEventItem {
    position: number;
    label: string;
    description: string;
    type: string;
    level: number;
}

/** 伏笔筛选口径：全部 / 已回收 / 未回收 */
export type ForeshadowFilter = 'all' | 'resolved' | 'unresolved';

/** 句长雷达图的归一化基准：50 字记为满分 */
export const SENTENCE_LENGTH_SCALE = 50;

/** 段长雷达图的归一化基准：200 字记为满分 */
export const PARAGRAPH_LENGTH_SCALE = 200;

/** 词云默认取样上限 */
export const WORD_CLOUD_LIMIT = 30;

/** 技巧排行默认取样上限 */
export const TECHNIQUE_TOP_LIMIT = 10;

/**
 * 把单个指标按基准值归一到 0–100，并截断上界。
 *
 * @param value - 原始数值；undefined/NaN 返回 0
 * @param scale - 满分对应的原始值
 * @returns 0–100 之间的归一化值
 *
 * @example
 * normalizeToPercent(25, 50) // => 50
 * normalizeToPercent(999, 50) // => 100
 */
export function normalizeToPercent(value: number | undefined, scale: number): number {
    if (value === undefined || !Number.isFinite(value)) return 0;
    if (!Number.isFinite(scale) || scale <= 0) return 0;
    return Math.min(100, (value / scale) * 100);
}

/**
 * 归一化平均句长（50 字满分）。
 *
 * @param avgSentenceLength - 平均句长
 * @returns 0–100
 */
export function normalizeSentenceLength(avgSentenceLength?: number): number {
    return normalizeToPercent(avgSentenceLength, SENTENCE_LENGTH_SCALE);
}

/**
 * 归一化平均段长（200 字满分）。
 *
 * @param avgParagraphLength - 平均段长
 * @returns 0–100
 */
export function normalizeParagraphLength(avgParagraphLength?: number): number {
    return normalizeToPercent(avgParagraphLength, PARAGRAPH_LENGTH_SCALE);
}

/**
 * 组装风格雷达图数据。
 *
 * 只收录数据里真实存在的维度，顺序固定为：平均句长 / 平均段长 / 对白占比 / 描写占比 /
 * 口语化程度 / 成语密度。调用方以 `length >= 3` 决定是否渲染（少于 3 维雷达图无意义）。
 *
 * @param data - 风格分析数据
 * @returns 雷达图数据项
 *
 * @example
 * buildStyleRadarItems({ narrativeStyle: { dialogueRatio: 0.4 } })
 * // => [{ label: '对白占比', value: 40 }]
 */
export function buildStyleRadarItems(data: StyleData | null | undefined): ChartItem[] {
    const items: ChartItem[] = [];
    if (!data) return items;

    const { sentenceRhythm, paragraphStructure, narrativeStyle, wordPreference } = data;

    if (sentenceRhythm?.avgSentenceLength !== undefined) {
        items.push({ label: '平均句长', value: normalizeSentenceLength(sentenceRhythm.avgSentenceLength) });
    }
    if (paragraphStructure?.avgParagraphLength !== undefined) {
        items.push({ label: '平均段长', value: normalizeParagraphLength(paragraphStructure.avgParagraphLength) });
    }
    if (narrativeStyle?.dialogueRatio !== undefined) {
        items.push({ label: '对白占比', value: narrativeStyle.dialogueRatio * 100 });
    }
    if (narrativeStyle?.descriptionRatio?.total !== undefined) {
        items.push({ label: '描写占比', value: narrativeStyle.descriptionRatio.total * 100 });
    }
    if (wordPreference?.colloquialismLevel !== undefined) {
        items.push({ label: '口语化程度', value: wordPreference.colloquialismLevel * 100 });
    }
    if (wordPreference?.idiomDensity !== undefined) {
        // 原实现即 `Math.min(100, x / 100 * 100)`，等价于按 100 截断；保留原口径避免改变显示
        items.push({ label: '成语密度', value: Math.min(100, wordPreference.idiomDensity) });
    }
    return items;
}

/**
 * 组装修辞手法柱状图数据（顺序固定，缺失记为 0）。
 *
 * @param rhetoric - 修辞统计；为空返回空数组
 * @returns 柱状图数据项
 */
export function buildRhetoricBarData(rhetoric: StyleData['rhetoric'] | undefined): ChartItem[] {
    if (!rhetoric) return [];
    return [
        { label: '比喻', value: rhetoric.metaphor },
        { label: '拟人', value: rhetoric.personification },
        { label: '排比', value: rhetoric.parallelism },
        { label: '反问', value: rhetoric.rhetoricalQuestion },
        { label: '夸张', value: rhetoric.hyperbole },
        { label: '对偶', value: rhetoric.antithesis },
    ];
}

/**
 * 组装高频词词云数据（取样上限 30）。
 *
 * @param topWords - 高频词列表
 * @param limit - 取样上限，默认 30
 * @returns 词云数据项
 */
export function buildWordCloudItems(
    topWords: Array<{ word: string; count: number }> | undefined,
    limit: number = WORD_CLOUD_LIMIT,
): WordCloudItem[] {
    if (!topWords || topWords.length === 0) return [];
    return topWords.slice(0, limit).map(item => ({ text: item.word, weight: item.count }));
}

/**
 * 组装起承转合时间轴事件。
 *
 * @param segments - 结构分段（qcchSegments）
 * @returns 时间轴事件；无分段返回空数组
 */
export function buildTimelineEvents(segments: StructureData['qcchSegments']): TimelineEventItem[] {
    if (!segments || segments.length === 0) return [];
    return segments.map(seg => ({
        position: seg.startPosition,
        label: seg.type,
        description: seg.type,
        type: seg.type,
        level: 0,
    }));
}

/**
 * 按筛选口径过滤伏笔。
 *
 * @param items - 伏笔列表
 * @param filter - 'all' 全部 / 'resolved' 已回收 / 'unresolved' 未回收
 * @returns 过滤后的列表（不改原数组）
 *
 * @example
 * filterForeshadows(items, 'unresolved').every(i => !i.hasResolution) // => true
 */
export function filterForeshadows<T extends { hasResolution: boolean }>(
    items: T[] | undefined,
    filter: ForeshadowFilter | string,
): T[] {
    if (!items || items.length === 0) return [];
    if (filter === 'all') return [...items];
    if (filter === 'resolved') return items.filter(item => item.hasResolution);
    return items.filter(item => !item.hasResolution);
}

/**
 * 按使用次数降序取 Top N 技巧（同分保持稳定顺序）。
 *
 * @param techniques - 技巧列表
 * @param limit - 取样上限，默认 10
 * @returns 排序后的新数组，不改原数组
 */
export function rankTechniquesTop<T extends { count: number }>(
    techniques: T[] | undefined,
    limit: number = TECHNIQUE_TOP_LIMIT,
): T[] {
    if (!techniques || techniques.length === 0) return [];
    return [...techniques].sort((a, b) => b.count - a.count).slice(0, limit);
}

/**
 * 技巧 Top N 转柱状图数据。
 *
 * @param techniques - 技巧列表
 * @param limit - 取样上限，默认 10
 * @returns 柱状图数据项
 */
export function buildTechniqueBarData(
    techniques: Array<{ name: string; count: number }> | undefined,
    limit: number = TECHNIQUE_TOP_LIMIT,
): ChartItem[] {
    return rankTechniquesTop(techniques, limit).map(item => ({ label: item.name, value: item.count }));
}

/** 角色层级 → 中文标签（未知值原样返回） */
const TIER_LABELS: Record<string, string> = {
    protagonist: '主角',
    core_supporting: '核心配角',
    important_supporting: '重要配角',
    minor_supporting: '次要配角',
    extra: '路人角色',
};

/** 角色弧线类型 → 中文标签（未知值原样返回） */
const ARC_TYPE_LABELS: Record<string, string> = {
    growth: '成长型',
    fall: '堕落型',
    awakening: '觉醒型',
    darkening: '黑化型',
    return: '回归型',
    stable: '稳定型',
};

/** 时间线事件类型 → 图标 */
const TIMELINE_ICONS: Record<string, string> = {
    appearance: '👤',
    growth: '📈',
    relationship: '💞',
    plot: '📌',
    turning_point: '⚡',
};

/**
 * 角色层级标签。
 *
 * @param tier - 层级英文标识；缺省按 `extra` 处理
 * @returns 中文标签
 */
export function resolveTierLabel(tier?: string): string {
    return TIER_LABELS[tier || 'extra'] || tier || '';
}

/**
 * 角色弧线类型标签。
 *
 * @param type - 弧线类型标识
 * @returns 中文标签；未知值原样返回
 */
export function resolveArcTypeLabel(type: string): string {
    return ARC_TYPE_LABELS[type] || type;
}

/**
 * 时间线事件图标。
 *
 * @param type - 事件类型标识
 * @returns 图标字符；未知值返回 `•`
 */
export function resolveTimelineIcon(type: string): string {
    return TIMELINE_ICONS[type] || '•';
}

/**
 * 把角色描述的若干片段拼成一行（丢弃空值，用 ` · ` 连接）。
 *
 * @param parts - 片段数组（通常含可选字段）
 * @returns 拼接后的字符串；全空返回空串
 *
 * @example
 * joinRoleParts(['剑客', undefined, '主角']) // => '剑客 · 主角'
 */
export function joinRoleParts(parts: Array<string | undefined | null | false>): string {
    return parts.filter(Boolean).join(' · ');
}

/**
 * 伏笔统计摘要（供统计卡片展示）。
 *
 * @param stats - 伏笔统计
 * @returns 摘要项；无统计返回空数组
 */
export function buildForeshadowStatItems(stats: ForeshadowData['stats']): ChartItem[] {
    if (!stats) return [];
    return [
        { label: '伏笔总数', value: stats.totalForeshadows },
        { label: '已回收', value: stats.resolvedCount },
        { label: '未回收', value: stats.unresolvedCount },
        { label: '平均重要性', value: stats.avgImportance },
    ];
}

/**
 * 技巧质量评分项（供评分卡片展示）。
 *
 * @param qualityScore - 技巧质量评分
 * @returns 评分项；无评分返回空数组
 */
export function buildTechniqueQualityItems(qualityScore: TechniqueData['qualityScore']): ChartItem[] {
    if (!qualityScore) return [];
    return [
        { label: '总分', value: qualityScore.totalScore },
        { label: '多样性', value: qualityScore.diversityScore },
        { label: '覆盖度', value: qualityScore.coverageScore },
    ];
}

/**
 * 质量评分的色调（阶段 D1：从 `renderQualityScoreCard` 抽出）。
 *
 * 阈值口径：`>=80` 绿、`>=50` 橙、其余红。
 * 抽出来是为了让 80/50 这两个边界能被测试锁住——内联在渲染里改错了没人发现。
 */
export type QualityTone = 'green' | 'orange' | 'red';

/**
 * 分数 → 色调。
 *
 * @param score - 0–100 的分数（undefined/NaN 按最低档处理）
 * @returns 色调
 */
export function resolveScoreTone(score: number | undefined): QualityTone {
    const value = Number(score);
    if (!Number.isFinite(value)) return 'red';
    if (value >= 80) return 'green';
    if (value >= 50) return 'orange';
    return 'red';
}

/**
 * 质量等级 → 标签与色调。
 *
 * @param level - `high` / `medium` / 其它
 * @returns 中文标签与色调
 */
export function resolveQualityLevelMeta(level: string | undefined): { label: string; tone: QualityTone } {
    if (level === 'high') return { label: '优秀', tone: 'green' };
    if (level === 'medium') return { label: '一般', tone: 'orange' };
    return { label: '较差', tone: 'red' };
}

/**
 * 分析档位 → 中文标签。
 *
 * @param usedLevel - `fast` / `standard` / 其它
 * @returns 中文标签
 */
export function resolveUsedLevelLabel(usedLevel: string | undefined): string {
    if (usedLevel === 'fast') return '快速';
    if (usedLevel === 'standard') return '标准';
    return '深度';
}

/**
 * 质量评分的三个分项（完整性/一致性/置信度）及各自色调。
 *
 * @param qualityScore - 质量评分对象
 * @returns 分项数组；缺少必要字段时返回空数组
 */
export function buildQualityScoreItems(
    qualityScore: { completeness?: number; consistency?: number; confidence?: number } | null | undefined,
): Array<{ label: string; value: number; tone: QualityTone }> {
    if (!qualityScore) return [];
    const pick = (value: number | undefined): number => (Number.isFinite(Number(value)) ? Number(value) : 0);
    return [
        { label: '完整性', value: pick(qualityScore.completeness), tone: resolveScoreTone(qualityScore.completeness) },
        { label: '一致性', value: pick(qualityScore.consistency), tone: resolveScoreTone(qualityScore.consistency) },
        { label: '置信度', value: pick(qualityScore.confidence), tone: resolveScoreTone(qualityScore.confidence) },
    ];
}
