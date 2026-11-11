/**
 * book-detail-logic.ts — 书籍详情页的数据整形（纯逻辑，阶段 D2）
 *
 * 从 `ui/views/book-detail-renderer.ts` 抽出：图表数据、排序、可选分数行。
 * 这些逻辑此前内联在 900+ 行的渲染器里，没有任何测试能覆盖——改一个
 * `?? 0` 或排序稳定性就可能让图表空掉/排名错乱而无人察觉。
 *
 * 约定：不 import obsidian、不碰 DOM、不读全局状态；视图只负责把返回值画出来。
 */

/** 质量评分（与 BookBasicInfo.qualityScores 的结构兼容） */
export interface QualityScoreLike {
    character: number;
    foreshadow: number;
    technique: number;
    style: number;
    rhythm: number;
    structure: number;
    commercial?: number;
    readability?: number;
    overall: number;
}

/** 图表数据点（label + 数值） */
export interface ChartPoint {
    label: string;
    value: number;
}

/** 质量评分条行 */
export interface ScoreRow {
    name: string;
    /** 值可能缺失（商业/可读为后补维度） */
    value?: number;
    /** 缺失时展示 N/A 而不是 0 */
    optional?: boolean;
}

/**
 * 质量雷达图数据（固定 8 维；后补维度缺失按 0 画）。
 *
 * @param qs - 质量评分
 * @returns 8 个数据点
 */
export function buildQualityRadarData(qs: QualityScoreLike): ChartPoint[] {
    return [
        { label: '人设', value: qs.character },
        { label: '伏笔', value: qs.foreshadow },
        { label: '技巧', value: qs.technique },
        { label: '风格', value: qs.style },
        { label: '节奏', value: qs.rhythm },
        { label: '结构', value: qs.structure },
        { label: '商业', value: qs.commercial ?? 0 },
        { label: '可读', value: qs.readability ?? 0 },
    ];
}

/**
 * 质量评分条行（商业/可读标记 optional，缺失显示 N/A）。
 *
 * @param qs - 质量评分
 * @returns 8 行
 */
export function buildQualityScoreRows(qs: QualityScoreLike): ScoreRow[] {
    return [
        { name: '人设', value: qs.character },
        { name: '伏笔', value: qs.foreshadow },
        { name: '技巧', value: qs.technique },
        { name: '风格', value: qs.style },
        { name: '节奏', value: qs.rhythm },
        { name: '结构', value: qs.structure },
        { name: '商业', value: qs.commercial, optional: true },
        { name: '可读', value: qs.readability, optional: true },
    ];
}

/**
 * 按重要度总分降序排序角色（不修改入参）。
 *
 * @param characters - 角色列表
 * @returns 新数组
 */
export function sortCharactersByImportance<T extends { importance?: { totalScore?: number } }>(
    characters: readonly T[],
): T[] {
    return [...characters].sort((a, b) =>
        (b.importance?.totalScore ?? 0) - (a.importance?.totalScore ?? 0));
}

/**
 * 取中心度排名前 N 的角色（按 pagerank 降序）。
 *
 * @param list - 中心度列表
 * @param limit - 最多条数（默认 10）
 * @returns 图表数据点
 */
export function topCentralityBars(
    list: ReadonlyArray<{ characterName: string; pagerank: number }>,
    limit = 10,
): ChartPoint[] {
    return [...list]
        .sort((a, b) => b.pagerank - a.pagerank)
        .slice(0, Math.max(0, limit))
        .map(item => ({ label: item.characterName, value: item.pagerank }));
}

/**
 * 按严重度排序改进建议（high → medium → low → 未知）。
 *
 * @param suggestions - 建议列表
 * @returns 新数组
 */
const SEVERITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

export function sortSuggestionsBySeverity<T extends { severity: string }>(
    suggestions: readonly T[],
): T[] {
    return [...suggestions].sort((a, b) =>
        (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99));
}

/**
 * 把「字段 → 分数」记录转成条形图数据（跳过未定义、乘以 scale）。
 *
 * @param record - 分数记录（0..1）
 * @param labels - 字段中文名映射
 * @param scale - 乘数（默认 100）
 * @returns 图表数据点
 */
export function buildScoreBars(
    record: Record<string, number | undefined> | null | undefined,
    labels: Record<string, string>,
    scale = 100,
): ChartPoint[] {
    if (!record) return [];
    return Object.entries(record)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => ({
            label: labels[key] || key,
            value: (value as number) * scale,
        }));
}

/**
 * 合并张力峰/谷并按章节序号升序（图表 x 轴必须是有序的）。
 *
 * @param peaks - 峰值点
 * @param valleys - 谷值点
 * @returns 有序数据点
 */
export function sortTensionPoints(
    peaks: ReadonlyArray<{ chapterIndex: number; intensity: number }>,
    valleys: ReadonlyArray<{ chapterIndex: number; intensity: number }>,
): ChartPoint[] {
    return [...peaks, ...valleys]
        .map(point => ({ label: `C${point.chapterIndex}`, value: point.intensity, chapterIndex: point.chapterIndex }))
        .sort((a, b) => a.chapterIndex - b.chapterIndex)
        .map(({ label, value }) => ({ label, value }));
}
