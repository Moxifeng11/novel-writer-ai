/**
 * kb-card-logic.ts — 知识库卡片（书籍卡 / 题材卡）的纯判定与预览取样
 *
 * 背景（v4.83.0 UI 可测性治理）：`kb-book-card.ts`（147 行）与 `kb-config-panel.ts`（221 行）
 * 原本覆盖率 0%——「什么状态配什么颜色」「标签最多显示几个」「什么时候出现警示条」
 * 全写在 createElement 之间，只能打开知识库翻书确认。本模块把这些判定抽出来单测。
 *
 * 约定：不 import obsidian、不碰 HTMLElement、不产生颜色字符串以外的新结构；
 * 视图侧仍持有具体样式表，这里只回答「是哪个档位 / 显示几条 / 显不显示」。
 */

import type { BookBasicInfo } from '@/services/knowledge-base-manager';
import type { ClassificationResult, ClassificationTag } from '@/shared/content-classifier';
import type { GenreConfig, SubGenreConfig } from '@/shared/webnovel-knowledge-base';

/** 拆解状态徽标的语义档位（视图据此选配色） */
export type KbStatusTone = 'success' | 'info' | 'danger' | 'warning' | 'muted';

/** 题材配置面板的频道分类（顺序固定） */
export const KB_CONFIG_CATEGORIES: Array<{ key: GenreConfig['category']; label: string; icon: string }> = [
    { key: 'male', label: '男频', icon: '♂️' },
    { key: 'female', label: '女频', icon: '♀️' },
    { key: 'neutral', label: '中性', icon: '⚧️' },
];

/** 题材卡统计行标签（顺序固定） */
export const KB_GENRE_STAT_LABELS = ['性格标签', '能力类型', '写作技巧'] as const;

/** 分类标签最多展示条数 */
export const CLASSIFICATION_PREVIEW_LIMIT = 3;

/** 自定义标签最多展示条数 */
export const CUSTOM_TAG_PREVIEW_LIMIT = 2;

/** 细分题材最多直接展示条数（超出显示 +N） */
export const SUB_GENRE_PREVIEW_LIMIT = 5;

/**
 * 拆解状态 → 徽标档位。
 *
 * 五档与视图配色一一对应；未知状态落回 `muted`（灰色），不会因新状态值而视觉缺失。
 *
 * @param status - 拆解状态
 * @returns 语义档位
 *
 * @example
 * resolveBookStatusTone('completed') // => 'success'
 * resolveBookStatusTone('whatever')  // => 'muted'
 */
export function resolveBookStatusTone(status?: string): KbStatusTone {
    switch (status) {
        case 'completed': return 'success';
        case 'processing': return 'info';
        case 'failed': return 'danger';
        case 'interrupted': return 'warning';
        default: return 'muted';
    }
}

/**
 * 是否展示向量化失败警示。
 *
 * A5 背景：拆解完成但向量化失败时检索实际不可用，列表必须能看出来。
 *
 * @param book - 书籍
 * @returns 是否展示
 */
export function shouldShowVectorWarning(book: Pick<BookBasicInfo, 'vectorStatus'> | undefined): boolean {
    return book?.vectorStatus === 'failed';
}

/**
 * 向量化失败警示的悬停说明。
 *
 * @param book - 书籍
 * @returns 错误详情；无详情时给出兜底指引
 */
export function resolveVectorWarningTitle(book: Pick<BookBasicInfo, 'vectorError'> | undefined): string {
    return book?.vectorError || '检索不可用，请到详情页重试向量化';
}

/**
 * 是否展示拆解进度条：仅「拆解中」且进度值已知。
 *
 * @param book - 书籍
 * @returns 是否展示
 */
export function shouldShowBreakdownProgress(
    book: Pick<BookBasicInfo, 'breakdownStatus' | 'breakdownProgress'> | undefined,
): boolean {
    return book?.breakdownStatus === 'processing' && book?.breakdownProgress !== undefined;
}

/**
 * 拆解进度条文案。
 *
 * @param book - 书籍
 * @returns 形如「拆解中 42%」；进度未知时返回「拆解中」
 */
export function formatBreakdownProgressLabel(
    book: Pick<BookBasicInfo, 'breakdownProgress'> | undefined,
): string {
    const value = book?.breakdownProgress;
    return value === undefined ? '拆解中' : `拆解中 ${value}%`;
}

/**
 * 分类标签预览（最多 3 条）。
 *
 * @param classification - 分类结果
 * @param limit - 上限，默认 3
 * @returns 预览标签；无分类返回空数组
 */
export function selectClassificationPreview(
    classification: ClassificationResult | null | undefined,
    limit: number = CLASSIFICATION_PREVIEW_LIMIT,
): ClassificationTag[] {
    if (!classification || !classification.tags || classification.tags.length === 0) return [];
    return classification.tags.slice(0, limit);
}

/**
 * 分类标签的悬停说明：`维度 · 理由（置信度 n%）`。
 *
 * 置信度按百分比取整，避免出现 `33.333333%` 这类长串。
 *
 * @param tag - 分类标签
 * @returns 悬停说明
 */
export function formatClassificationTagTitle(tag: ClassificationTag): string {
    return `${tag.dimension} · ${tag.reason}（置信度 ${(tag.confidence * 100).toFixed(0)}%）`;
}

/**
 * 自定义标签预览（过滤掉自动分类标签，最多 2 条）。
 *
 * @param tags - 书籍自定义标签
 * @param isClassificationTag - 判断是否为自动分类标签
 * @param limit - 上限，默认 2
 * @returns 预览标签
 *
 * @example
 * selectCustomTagPreview(['爽文', '分类:节奏'], t => t.startsWith('分类:')) // => ['爽文']
 */
export function selectCustomTagPreview(
    tags: string[] | undefined,
    isClassificationTag: (tag: string) => boolean,
    limit: number = CUSTOM_TAG_PREVIEW_LIMIT,
): string[] {
    if (!tags || tags.length === 0) return [];
    return tags.filter(tag => !isClassificationTag(tag)).slice(0, limit);
}

/**
 * 质量分展示文案。
 *
 * @param scores - 质量分；为空返回 null 表示「不展示评分」
 * @returns 形如「⭐ 82分」；无评分返回 null
 */
export function formatQualityBadge(
    scores: Pick<BookBasicInfo['qualityScores'] & object, 'overall'> | null | undefined,
): string | null {
    if (!scores || typeof scores.overall !== 'number' || !Number.isFinite(scores.overall)) return null;
    return `⭐ ${scores.overall.toFixed(0)}分`;
}

/**
 * 作者名展示（空作者回落「未知作者」）。
 *
 * @param author - 作者
 * @returns 展示用作者名
 */
export function formatAuthorName(author?: string): string {
    return author && author.trim() ? author : '未知作者';
}

/**
 * 题材是否为自定义（本地配置标记或知识库判定任一为真）。
 *
 * @param genre - 题材配置
 * @param isCustomGenre - 知识库侧的判定函数（可选）
 * @returns 是否自定义题材
 */
export function isCustomGenre(
    genre: Pick<GenreConfig, 'id' | 'isCustom'>,
    isCustomGenre?: (id: string) => boolean,
): boolean {
    return Boolean(genre.isCustom || isCustomGenre?.(genre.id));
}

/**
 * 题材卡统计行数据（性格标签 / 能力类型 / 写作技巧 的数量）。
 *
 * @param genre - 题材配置
 * @returns 统计项（顺序与 KB_GENRE_STAT_LABELS 一致）
 */
export function buildGenreStatItems(genre: Pick<GenreConfig, 'personalityTags' | 'abilityTypes' | 'techniques'>): Array<{ label: string; value: number }> {
    return [
        { label: KB_GENRE_STAT_LABELS[0], value: genre.personalityTags.length },
        { label: KB_GENRE_STAT_LABELS[1], value: genre.abilityTypes.length },
        { label: KB_GENRE_STAT_LABELS[2], value: genre.techniques.length },
    ];
}

/**
 * 细分题材预览：前 N 条 + 溢出的剩余数量。
 *
 * @param subGenres - 细分题材列表
 * @param limit - 最多直接展示条数，默认 5
 * @returns `shown` 展示项、`overflow` 剩余数量（0 表示不显示 +N）
 *
 * @example
 * selectSubGenrePreview([1,2,3,4,5,6,7]) // => { shown: 前 5 项, overflow: 2 }
 */
export function selectSubGenrePreview(
    subGenres: SubGenreConfig[] | undefined,
    limit: number = SUB_GENRE_PREVIEW_LIMIT,
): { shown: SubGenreConfig[]; overflow: number } {
    if (!subGenres || subGenres.length === 0) return { shown: [], overflow: 0 };
    const shown = subGenres.slice(0, limit);
    return { shown, overflow: Math.max(0, subGenres.length - limit) };
}

/**
 * 细分题材区块标题（带总数）。
 *
 * @param total - 细分题材总数
 * @returns 形如「细分题材 (7)」
 */
export function formatSubGenreSectionTitle(total: number): string {
    return `细分题材 (${total})`;
}
