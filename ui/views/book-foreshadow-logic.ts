/**
 * book-foreshadow-logic.ts — 书籍详情「伏笔页签」的数据整形（纯逻辑，阶段 D2）
 *
 * 从 `ui/views/book-detail-renderer.ts#renderBookForeshadowTab` 抽出：质量评分卡、
 * 回收状态环图、统计卡、类型分布标签、重要度档位配色、筛选按钮组。
 * `typeLabels` 在原方法里**定义了两次**（类型分布与列表各一份）——正是这类
 * 复制粘贴迟早会改坏一边；抽成单点后只此一份。
 *
 * 约定：不 import obsidian、不碰 DOM；颜色串属于视图层语义，这里按抽取前原样保留。
 */

/** 伏笔类型英文键 → 中文名（类型分布与列表共用一份） */
export const FORESHADOW_TYPE_LABELS: Record<string, string> = {
    item: '物品伏笔',
    skill: '功法伏笔',
    character: '人物伏笔',
    setting: '设定伏笔',
    event: '事件伏笔',
};

/** 筛选按钮组（顺序即渲染顺序） */
export const FORESHADOW_FILTER_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
    { value: 'all', label: '全部' },
    { value: 'resolved', label: '已回收' },
    { value: 'unresolved', label: '未回收' },
];

/** 伏笔质量评分（与 ForeshadowData.qualityScore 结构兼容） */
export interface ForeshadowQualityScoreLike {
    totalScore?: number;
    diversityScore?: number;
    resolutionRate?: number;
    signalNoiseRatio?: number;
    coverageScore?: number;
}

/** 伏笔统计（与 ForeshadowData.stats 结构兼容） */
export interface ForeshadowStatsLike {
    totalForeshadows?: number;
    resolvedCount?: number;
    unresolvedCount?: number;
    avgImportance?: number;
}

/** 带颜色的展示项（评分卡 / 统计卡共用） */
export interface ColoredStatItem {
    label: string;
    value: string;
    color: string;
}

/** 环图数据点 */
export interface DonutPoint {
    label: string;
    /** 缺失统计时给 0（donutChart 只接受数值） */
    value: number;
    color: string;
}

/**
 * 伏笔质量评分卡五项（顺序固定；缺失字段给 '-' 占位，不让卡片塌掉）。
 *
 * @param q - 质量评分
 * @returns 五个展示项
 */
export function buildForeshadowQualityItems(q: ForeshadowQualityScoreLike | undefined): ColoredStatItem[] {
    return [
        { label: '综合评分', value: q?.totalScore !== undefined ? `${q.totalScore}分` : '-', color: 'var(--interactive-accent)' },
        { label: '类型多样性', value: q?.diversityScore !== undefined ? `${q.diversityScore}%` : '-', color: '#2ecc71' },
        { label: '回收率', value: q?.resolutionRate !== undefined ? `${q.resolutionRate}%` : '-', color: '#f59e0b' },
        { label: '信噪比', value: q?.signalNoiseRatio !== undefined ? `${q.signalNoiseRatio}%` : '-', color: '#9b59b6' },
        { label: '覆盖度', value: q?.coverageScore !== undefined ? `${q.coverageScore}%` : '-', color: '#3b82f6' },
    ];
}

/**
 * 回收状态环图数据（已回收 / 未回收两片）。
 *
 * @param stats - 统计
 * @returns 环图数据点
 */
export function buildForeshadowDonutData(stats: ForeshadowStatsLike | undefined): DonutPoint[] {
    return [
        { label: '已回收', value: stats?.resolvedCount ?? 0, color: '#2ecc71' },
        { label: '未回收', value: stats?.unresolvedCount ?? 0, color: '#f59e0b' },
    ];
}

/**
 * 伏笔统计卡四项（平均重要度由调用方注入百分比格式化，保持同一口径）。
 *
 * @param stats - 统计
 * @param formatPercent - 百分比格式化
 * @returns 四个展示项
 */
export function buildForeshadowStatItems(
    stats: ForeshadowStatsLike | undefined,
    formatPercent: (v: number) => string,
): ColoredStatItem[] {
    return [
        { label: '总伏笔数', value: String(stats?.totalForeshadows ?? '-'), color: 'var(--interactive-accent)' },
        { label: '已回收', value: String(stats?.resolvedCount ?? '-'), color: '#2ecc71' },
        { label: '未回收', value: String(stats?.unresolvedCount ?? '-'), color: '#f59e0b' },
        { label: '平均重要度', value: stats?.avgImportance !== undefined ? formatPercent(stats.avgImportance) : '-', color: '#9b59b6' },
    ];
}

/**
 * 伏笔类型中文名（未知键保留原文键，不做静默丢弃）。
 *
 * @param type - 英文键
 * @returns 中文名
 */
export function resolveForeshadowTypeLabel(type: string): string {
    return FORESHADOW_TYPE_LABELS[type] || type;
}

/** 重要度档位：≥0.7 高、≥0.4 中、其余默认 */
export type ForeshadowImportanceTier = 'high' | 'mid' | 'default';

/**
 * 重要度档位（决定徽标配色）。
 *
 * 边界语义与抽取前一致：0.7 与 0.4 都算高/中（`>=` 判定）。
 *
 * @param importance - 0..1
 * @returns 档位
 */
export function foreshadowImportanceTier(importance: number | undefined): ForeshadowImportanceTier {
    if (importance === undefined) return 'default';
    if (importance >= 0.7) return 'high';
    if (importance >= 0.4) return 'mid';
    return 'default';
}

/** 各档位徽标内联样式（与抽取前逐字一致） */
export const FORESHADOW_IMPORTANCE_STYLES: Record<ForeshadowImportanceTier, string> = {
    high: 'background:rgba(231,76,60,0.1);color:#e74c3c;',
    mid: 'background:rgba(245,158,11,0.1);color:#f59e0b;',
    default: 'background:var(--background-secondary);color:var(--text-muted);',
};
