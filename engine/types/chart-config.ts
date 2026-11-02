/**
 * ChartType 类型定义。
 */
export type ChartType =
    | 'radar'
    | 'bar'
    | 'horizontalBar'
    | 'donut'
    | 'line'
    | 'scatter'
    | 'heatmap'
    | 'densityHeatmap'
    | 'area'
    | 'tree'
    | 'violin'
    | 'histogram'
    | 'timeline'
    | 'wordCloud';

/**
 * ChartDensity 类型定义。
 */
export type ChartDensity = 'compact' | 'normal' | 'spacious';

/**
 * ChartConfig 类型定义。
 */
export interface ChartConfig {
    type: ChartType;
    availableTypes: ChartType[];
    width: 'auto' | number;
    height: number;
    density: ChartDensity;
    showLegend: boolean;
    showTooltip: boolean;
    interactive: boolean;
}

/**
 * SmartChartOptions 类型定义。
 */
export interface SmartChartOptions {
    data: any;
    preferredType?: ChartType;
    availableTypes?: ChartType[];
    config?: Partial<ChartConfig>;
    onTypeChange?: (type: ChartType) => void;
    onDensityChange?: (density: ChartDensity) => void;
    context?: string;
}

/**
 * ChartToolbarOptions 类型定义。
 */
export interface ChartToolbarOptions {
    currentType: ChartType;
    availableTypes: ChartType[];
    currentDensity: ChartDensity;
    onTypeChange: (type: ChartType) => void;
    onDensityChange: (density: ChartDensity) => void;
    showSortToggle?: boolean;
    onSortChange?: (sort: 'asc' | 'desc' | 'none') => void;
}

/**
 * CHART_TYPE_LABELS 常量。
 */
export const CHART_TYPE_LABELS: Record<ChartType, string> = {
    radar: '雷达图',
    bar: '柱状图',
    horizontalBar: '横向柱状图',
    donut: '环形图',
    line: '折线图',
    scatter: '散点图',
    heatmap: '热力图',
    densityHeatmap: '密度热力图',
    area: '面积图',
    tree: '树图',
    violin: '小提琴图',
    histogram: '直方图',
    timeline: '时间线',
    wordCloud: '词云'
};
