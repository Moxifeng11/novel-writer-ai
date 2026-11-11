/**
 * kb-panels-logic.ts — 知识库右侧面板的纯判定与聚合（无 DOM、无实例状态）
 *
 * 背景（v4.83.0 UI 可测性治理）：`kb-detail-actions.ts` 与 `kb-stats-panel.ts` 原本是
 * 覆盖率 0% 的纯渲染函数——「状态该显示什么按钮」「统计卡该显示什么数字」这类规则
 * 和 createElement 混在一起，只能靠人工点开知识库逐个确认。本模块把规则抽出来单测。
 *
 * 约定：不 import obsidian、不碰 HTMLElement；输入书籍数据，输出配置/数字。
 * 视图侧只负责把结果渲染成 DOM 并绑定 handler（样式与类名仍在视图内保持原样）。
 */

import type { BookBasicInfo, QualityScores } from '@/services/knowledge-base-manager';

/** 柱状图/环图数据项（与 ui/svg-charts 入参一致） */
export interface KbChartItem {
    label: string;
    value: number;
}

/** 环图数据项（带颜色） */
export interface KbDonutItem extends KbChartItem {
    color: string;
}

/** 拆解状态到操作按钮的稳定标识（视图据此绑定具体 handler） */
export type KbDetailActionKey =
    | 'start-deconstruction'
    | 'restart-deconstruction'
    | 'resume-deconstruction'
    | 'force-cancel'
    | 'clear-status'
    | 'processing-indicator'
    | 'dimension-tags'
    | 'edit'
    | 'delete';

/** 一个操作按钮的展示配置 */
export interface KbDetailActionButton {
    /** 稳定标识：视图用它决定点击后调用哪个宿主方法 */
    key: KbDetailActionKey;
    text: string;
    /** 按钮类名（含主/次/危险样式档位） */
    cls: string;
    /** 悬停说明；无说明时为空串 */
    title: string;
    /** 是否禁用 */
    disabled: boolean;
}

/** 统计概览卡（图标 + 数值 + 文案 + 颜色） */
export interface KbStatsOverviewCard {
    label: string;
    value: string;
    icon: string;
    color: string;
}

/** 单个质量维度的均分 */
export interface KbDimensionAverage {
    key: Exclude<keyof QualityScores, 'overall' | 'vectorEnabled'>;
    label: string;
    avg: number;
}

/** 质量维度清单（顺序与视图一致） */
export const KB_QUALITY_DIMENSIONS: Array<{ key: Exclude<keyof QualityScores, 'overall' | 'vectorEnabled'>; label: string }> = [
    { key: 'character', label: '人设' },
    { key: 'foreshadow', label: '伏笔' },
    { key: 'technique', label: '技巧' },
    { key: 'style', label: '风格' },
    { key: 'rhythm', label: '节奏' },
    { key: 'structure', label: '结构' },
];

/** 拆解状态在环图/图例中的固定配色与文案（顺序固定） */
export const KB_STATUS_STYLES: Array<{ status: 'pending' | 'processing' | 'completed' | 'failed' | 'interrupted'; label: string; color: string }> = [
    { status: 'pending', label: '待拆解', color: '#f59e0b' },
    { status: 'processing', label: '拆解中', color: '#3b82f6' },
    { status: 'completed', label: '已完成', color: '#2ecc71' },
    { status: 'failed', label: '失败', color: '#e74c3c' },
    { status: 'interrupted', label: '拆解中断', color: '#f97316' },
];

/** 按钮样式档位 */
const BTN_PRIMARY = 'nw-btn nw-btn-primary nw-btn-sm';
const BTN_SECONDARY = 'nw-btn nw-btn-secondary nw-btn-sm';
const BTN_WARNING = 'nw-btn nw-btn-warning nw-btn-sm';
const BTN_DANGER = 'nw-btn nw-btn-danger nw-btn-sm';

/** 拆解进行中的统一文案（按钮禁用时的占位） */
const BUSY_LABEL = '⏳ 准备中...';

/**
 * 按书籍拆解状态解析详情页顶部操作按钮。
 *
 * 状态与按钮的对应关系是知识库详情页的既有契约：
 * - `pending`   → 开始拆解（主按钮）
 * - `failed`    → 重新拆解（主按钮，允许重试）
 * - `completed` → 重新拆解（次按钮，避免误触覆盖已有结果）
 * - `processing`→ 禁用态「拆解中」+ 强制取消
 * - `interrupted`→ 恢复拆解（警示色）+ 清除状态
 * - 其他/未知   → 只有尾部固定按钮
 *
 * 尾部固定按钮（维度归类 / 编辑 / 删除）在任何状态下都存在。
 *
 * @param status - 书籍拆解状态
 * @param isStarting - 是否已有拆解启动在途（在途时状态按钮文案变 `⏳ 准备中...` 并禁用）
 * @returns 按钮配置数组（顺序即渲染顺序）
 *
 * @example
 * resolveDetailActionButtons('pending', false).map(b => b.key)
 * // => ['start-deconstruction', 'dimension-tags', 'edit', 'delete']
 */
export function resolveDetailActionButtons(status: string, isStarting: boolean): KbDetailActionButton[] {
    const buttons: KbDetailActionButton[] = [];
    const busy = isStarting;

    if (status === 'pending') {
        buttons.push({
            key: 'start-deconstruction',
            text: busy ? BUSY_LABEL : '🚀 开始拆解',
            cls: BTN_PRIMARY,
            title: '拆解本书：分段 + 统计 + 向量增强，提取多维度写作特征',
            disabled: busy,
        });
    } else if (status === 'failed') {
        buttons.push({
            key: 'restart-deconstruction',
            text: busy ? BUSY_LABEL : '🔄 重新拆解',
            cls: BTN_PRIMARY,
            title: '上次拆解失败，重新开始拆解',
            disabled: busy,
        });
    } else if (status === 'completed') {
        buttons.push({
            key: 'restart-deconstruction',
            text: busy ? BUSY_LABEL : '🔄 重新拆解',
            cls: BTN_SECONDARY,
            title: '清除已有拆解结果，重新拆解',
            disabled: busy,
        });
    } else if (status === 'processing') {
        buttons.push({
            key: 'processing-indicator',
            text: '⏳ 拆解中...',
            cls: BTN_SECONDARY,
            title: '',
            disabled: true,
        });
        buttons.push({
            key: 'force-cancel',
            text: '⚠️ 强制取消',
            cls: 'nw-btn nw-btn-sm',
            title: '中断当前拆解任务（已完成维度保留）',
            disabled: false,
        });
    } else if (status === 'interrupted') {
        buttons.push({
            key: 'resume-deconstruction',
            text: '🔄 恢复拆解',
            cls: BTN_WARNING,
            title: '从上次中断处继续拆解（已完成的段不再重跑）',
            disabled: false,
        });
        buttons.push({
            key: 'clear-status',
            text: '🗑️ 清除状态',
            cls: BTN_SECONDARY,
            title: '清除拆解状态与进度（不删除书籍）',
            disabled: false,
        });
    }

    // 不论状态如何都存在的尾部动作
    buttons.push(
        {
            key: 'dimension-tags',
            text: '🏷️ 维度归类',
            cls: BTN_SECONDARY,
            title: '按本地规则生成题材/节奏/情绪等维度标签并写入自定义标签',
            disabled: false,
        },
        {
            key: 'edit',
            text: '✏️ 编辑',
            cls: BTN_SECONDARY,
            title: '编辑书籍信息',
            disabled: false,
        },
        {
            key: 'delete',
            text: '🗑️ 删除',
            cls: BTN_DANGER,
            title: '删除该书籍及其拆解数据',
            disabled: false,
        },
    );

    return buttons;
}

/**
 * 筛选出「可用于质量统计」的书籍：拆解完成且已产出质量分。
 *
 * 只按 completed + qualityScores 双重条件，`processing`/`failed` 的中间态不参与均值，
 * 否则会把 0 分算进平均质量分。
 *
 * @param books - 全部书籍
 * @returns 参与统计的书籍
 */
export function selectCompletedBooks(books: BookBasicInfo[] | undefined): BookBasicInfo[] {
    if (!books || books.length === 0) return [];
    return books.filter(book => book.breakdownStatus === 'completed' && Boolean(book.qualityScores));
}

/**
 * 统计「平均质量分」；没有可统计书籍时返回 `-`。
 *
 * @param books - 参与统计的书籍（通常来自 selectCompletedBooks）
 * @returns 一位小数分数字符串，或 `-`
 */
export function computeAverageQuality(books: BookBasicInfo[] | undefined): string {
    const list = books || [];
    if (list.length === 0) return '-';
    const sum = list.reduce((acc, book) => acc + (book.qualityScores?.overall ?? 0), 0);
    return (sum / list.length).toFixed(1);
}

/**
 * 组装统计页顶部 4 张概览卡（总数 / 已拆解 / 拆解中 / 平均质量分）。
 *
 * @param books - 全部书籍
 * @returns 概览卡配置（顺序固定）
 *
 * @example
 * buildStatsOverviewCards([]).map(c => c.value) // => ['0', '0', '0', '-']
 */
export function buildStatsOverviewCards(books: BookBasicInfo[] | undefined): KbStatsOverviewCard[] {
    const all = books || [];
    const completed = selectCompletedBooks(all);
    const processing = all.filter(book => book.breakdownStatus === 'processing').length;
    return [
        { label: '书籍总数', value: String(all.length), icon: '📚', color: 'var(--interactive-accent)' },
        { label: '已拆解', value: String(completed.length), icon: '✅', color: '#2ecc71' },
        { label: '拆解中', value: String(processing), icon: '⏳', color: '#3b82f6' },
        { label: '平均质量分', value: computeAverageQuality(completed), icon: '⭐', color: '#f59e0b' },
    ];
}

/**
 * 计算各质量维度的平均分（只统计已拆解且有质量分的书）。
 *
 * @param books - 参与统计的书籍
 * @returns 六个维度的均分；无书籍时每项 avg 为 0
 */
export function computeDimensionAverages(books: BookBasicInfo[] | undefined): KbDimensionAverage[] {
    const list = books || [];
    return KB_QUALITY_DIMENSIONS.map(dimension => {
        if (list.length === 0) return { ...dimension, avg: 0 };
        const sum = list.reduce((acc, book) => acc + (book.qualityScores?.[dimension.key] ?? 0), 0);
        return { ...dimension, avg: sum / list.length };
    });
}

/**
 * 按题材聚合书籍数量，按数量降序排列。
 *
 * @param books - 全部书籍
 * @returns `{ id, count }` 列表；没有 primaryGenre 的书不计入
 */
export function aggregateGenreCounts(books: BookBasicInfo[] | undefined): Array<{ id: string; count: number }> {
    const all = books || [];
    const counts = new Map<string, number>();
    for (const book of all) {
        if (!book.primaryGenre) continue;
        counts.set(book.primaryGenre, (counts.get(book.primaryGenre) || 0) + 1);
    }
    return [...counts.entries()]
        .map(([id, count]) => ({ id, count }))
        .sort((a, b) => b.count - a.count);
}

/**
 * 组装题材分布柱状图数据（取前 10，已按数量降序）。
 *
 * @param books - 全部书籍
 * @param getGenreName - 题材 ID → 显示名（不存在时视图层会自行回落）
 * @param limit - 取样上限，默认 10
 * @returns 柱状图数据项
 */
export function buildGenreBarData(
    books: BookBasicInfo[] | undefined,
    getGenreName: (id: string) => string,
    limit = 10,
): KbChartItem[] {
    return aggregateGenreCounts(books)
        .slice(0, limit)
        .map(item => ({ label: getGenreName(item.id), value: item.count }));
}

/**
 * 统计五种拆解状态的数量。
 *
 * @param books - 全部书籍
 * @returns 状态 → 数量
 */
export function computeStatusCounts(books: BookBasicInfo[] | undefined): Record<'pending' | 'processing' | 'completed' | 'failed' | 'interrupted', number> {
    const all = books || [];
    const counts = { pending: 0, processing: 0, completed: 0, failed: 0, interrupted: 0 };
    for (const book of all) {
        const status = book.breakdownStatus as keyof typeof counts;
        if (status in counts) counts[status] += 1;
    }
    return counts;
}

/**
 * 组装状态分布环图数据（过滤掉 0 值，避免图例出现空扇区）。
 *
 * @param counts - computeStatusCounts 的结果
 * @returns 环图数据项（顺序固定）
 */
export function buildStatusDonutData(
    counts: Record<'pending' | 'processing' | 'completed' | 'failed' | 'interrupted', number>,
): KbDonutItem[] {
    return KB_STATUS_STYLES
        .map(style => ({ label: style.label, value: counts[style.status], color: style.color }))
        .filter(item => item.value > 0);
}

/**
 * 组装状态分布图例（包含 0 值，便于用户看到「失败 0」这类事实）。
 *
 * @param counts - computeStatusCounts 的结果
 * @returns 图例数据项（顺序固定）
 */
export function buildStatusLegendData(
    counts: Record<'pending' | 'processing' | 'completed' | 'failed' | 'interrupted', number>,
): KbDonutItem[] {
    return KB_STATUS_STYLES.map(style => ({ label: style.label, value: counts[style.status], color: style.color }));
}
