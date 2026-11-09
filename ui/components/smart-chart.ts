import type { ChartType, ChartDensity, SmartChartOptions } from '@/engine/types/chart-config';
import { createChartToolbar } from './chart-toolbar';
import { setSanitizedHtml } from '@/ui/rendering/safe-html';
import {
	radarChart,
	barChart,
	donutChart,
	wordCloud,
	lineChart,
	scatterChart,
	timelineChart,
	heatmap,
	treeChart,
	areaChart,
	densityHeatmap,
	horizontalBarChart,
	violinChart,
	scatterToHistogram,
	attachChartInteractions
} from '@/ui/svg-charts';
import type {
	RadarDataItem,
	BarDataItem,
	DonutDataItem,
	WordCloudItem,
	LineChartSeries,
	ScatterDataPoint,
	TimelineEvent,
	HeatmapCell,
	TreeNode,
	AreaSeries,
	DensityPoint,
	HorizontalBarItem,
	ViolinDataItem
} from '@/ui/svg-charts';

type ChartData =
	| RadarDataItem[]
	| BarDataItem[]
	| DonutDataItem[]
	| WordCloudItem[]
	| LineChartSeries[]
	| ScatterDataPoint[]
	| TimelineEvent[]
	| HeatmapCell[]
	| TreeNode
	| AreaSeries[]
	| DensityPoint[]
	| HorizontalBarItem[]
	| ViolinDataItem[];

interface ChartRenderOptions {
	padding?: { top: number; right: number; bottom: number; left: number };
	size?: number;
	width?: number;
	height?: number;
	showLegend?: boolean;
}

type ChartRenderer = (data: ChartData, options?: ChartRenderOptions) => string;

/**
 * 把各图表渲染器的精确签名收敛为注册表统一签名。
 *
 * @example
 * ```ts
 * const renderer = chartRenderer(radarChart);
 * renderer([{ label: 'A', value: 1 }], { size: 320 });
 * ```
 */
function chartRenderer<T, O>(render: (data: T, options?: O) => string): ChartRenderer {
	return (data, options) => render(data as T, options as unknown as O);
}

interface ChartMeta {
	renderer: ChartRenderer;
	defaultWidth: number;
	defaultHeight: number;
	supportsPadding: boolean;
}

const CHART_META: Record<ChartType, ChartMeta> = {
	radar: {
		renderer: chartRenderer(radarChart),
		defaultWidth: 320,
		defaultHeight: 320,
		supportsPadding: false
	},
	bar: {
		renderer: chartRenderer(barChart),
		defaultWidth: 400,
		defaultHeight: 250,
		supportsPadding: true
	},
	horizontalBar: {
		renderer: chartRenderer(horizontalBarChart),
		defaultWidth: 450,
		defaultHeight: 300,
		supportsPadding: true
	},
	donut: {
		renderer: chartRenderer(donutChart),
		defaultWidth: 280,
		defaultHeight: 280,
		supportsPadding: false
	},
	line: {
		renderer: chartRenderer(lineChart),
		defaultWidth: 400,
		defaultHeight: 250,
		supportsPadding: true
	},
	scatter: {
		renderer: chartRenderer(scatterChart),
		defaultWidth: 400,
		defaultHeight: 250,
		supportsPadding: true
	},
	heatmap: {
		renderer: chartRenderer(heatmap),
		defaultWidth: 500,
		defaultHeight: 320,
		supportsPadding: true
	},
	densityHeatmap: {
		renderer: chartRenderer(densityHeatmap),
		defaultWidth: 500,
		defaultHeight: 320,
		supportsPadding: true
	},
	area: {
		renderer: chartRenderer(areaChart),
		defaultWidth: 400,
		defaultHeight: 250,
		supportsPadding: true
	},
	tree: {
		renderer: chartRenderer(treeChart),
		defaultWidth: 500,
		defaultHeight: 320,
		supportsPadding: true
	},
	violin: {
		renderer: chartRenderer(violinChart),
		defaultWidth: 480,
		defaultHeight: 320,
		supportsPadding: true
	},
	timeline: {
		renderer: chartRenderer(timelineChart),
		defaultWidth: 500,
		defaultHeight: 140,
		supportsPadding: true
	},
	wordCloud: {
		renderer: chartRenderer(wordCloud),
		defaultWidth: 400,
		defaultHeight: 200,
		supportsPadding: false
	},
	histogram: {
		renderer: chartRenderer(barChart),
		defaultWidth: 400,
		defaultHeight: 250,
		supportsPadding: true
	}
};

/**
 * SmartChart 类。
 *
 * @example
 * ```ts
 * const chart = new SmartChart(container, {
 *     data: emotionPoints,
 *     preferredType: 'line',
 * });
 * chart.setData(nextPoints);
 * chart.destroy();
 * ```
 */
export class SmartChart {
	private container: HTMLElement;
	private chartContainer: HTMLElement;
	private toolbarContainer: HTMLElement;
	private currentType: ChartType;
	private currentDensity: ChartDensity;
	private data: unknown;
	private options: SmartChartOptions;
	private sortOrder: 'asc' | 'desc' | 'none' = 'none';
	private destroyed = false;

	constructor(container: HTMLElement, options: SmartChartOptions) {
		this.container = container;
		this.options = options;
		this.data = options.data;
		this.currentDensity = options.config?.density || 'normal';

		const available = options.availableTypes?.length
			? options.availableTypes
			: SmartChart.recommendType(options.data, options.context);

		this.currentType = options.preferredType && available.includes(options.preferredType)
			? options.preferredType
			: available[0];

		this.container.classList.add('nw-smart-chart');

		this.toolbarContainer = document.createElement('div');
		this.toolbarContainer.className = 'nw-smart-chart-toolbar-wrapper';

		this.chartContainer = document.createElement('div');
		this.chartContainer.className = 'nw-smart-chart-content';

		this.container.appendChild(this.toolbarContainer);
		this.container.appendChild(this.chartContainer);

		this.render();
	}

	/**
	 * 渲染。
	 */
	render(): void {
		if (this.destroyed) return;
		this.renderToolbar();
		this.renderChart();
	}

	/**
	 * 设置类型。
	 * @param type - 类型
	 */
	setType(type: ChartType): void {
		if (this.currentType === type) return;
		const available = this.getAvailableTypes();
		if (!available.includes(type)) return;
		this.currentType = type;
		this.options.onTypeChange?.(type);
		this.render();
	}

	/**
	 * setDensity 方法。
	 * @param density - 密度
	 */
	setDensity(density: ChartDensity): void {
		if (this.currentDensity === density) return;
		this.currentDensity = density;
		this.options.onDensityChange?.(density);
		this.render();
	}

	/**
	 * 设置数据。
	 * @param data - 数据
	 */
	setData(data: unknown): void {
		this.data = data;
		this.render();
	}

	/**
	 * 销毁。
	 */
	destroy(): void {
		this.destroyed = true;
		this.container.empty();
		this.container.classList.remove('nw-smart-chart');
	}

	private getAvailableTypes(): ChartType[] {
		if (this.options.availableTypes?.length) {
			return this.options.availableTypes;
		}
		return SmartChart.recommendType(this.data, this.options.context);
	}

	private renderToolbar(): void {
		const availableTypes = this.getAvailableTypes();
		createChartToolbar(this.toolbarContainer, {
			currentType: this.currentType,
			availableTypes,
			currentDensity: this.currentDensity,
			onTypeChange: (type) => this.setType(type),
			onDensityChange: (density) => this.setDensity(density),
			showSortToggle: this.supportsSorting(),
			onSortChange: (sort) => {
				this.sortOrder = sort;
				this.renderChart();
			}
		});
	}

	private supportsSorting(): boolean {
		const sortableTypes: ChartType[] = ['bar', 'horizontalBar', 'donut', 'wordCloud'];
		return sortableTypes.includes(this.currentType);
	}

	private getSortedData(data: ChartData): ChartData {
		if (this.sortOrder === 'none') return data;

		const sortFn = this.sortOrder === 'asc'
			? (a: { value?: number }, b: { value?: number }) => (a.value ?? 0) - (b.value ?? 0)
			: (a: { value?: number }, b: { value?: number }) => (b.value ?? 0) - (a.value ?? 0);

		if (Array.isArray(data)) {
			const items = data as unknown as { value?: number }[];
			return [...items].sort(sortFn) as unknown as ChartData;
		}
		return data;
	}

	private renderChart(): void {
		setSanitizedHtml(this.chartContainer, this.getChartSvg());
		attachChartInteractions(this.chartContainer);
	}

	private getChartSvg(): string {
		const meta = CHART_META[this.currentType];
		if (!meta) {
			return `<div class="nw-chart-container" style="width:100%;color:var(--text-muted);">不支持的图表类型</div>`;
		}

		const data = this.transformData(this.data, this.currentType);
		const sortedData = this.supportsSorting() ? this.getSortedData(data) : data;
		const padding = this.getDensityPadding();
		const baseOpts: ChartRenderOptions = {};

		if (meta.supportsPadding) {
			baseOpts.padding = padding;
		}

		if (this.currentType === 'radar') {
			baseOpts.size = meta.defaultWidth;
		} else {
			baseOpts.width = meta.defaultWidth;
			baseOpts.height = meta.defaultHeight;
		}

		if (this.options.config?.showLegend !== undefined) {
			baseOpts.showLegend = this.options.config.showLegend;
		}

		return meta.renderer(sortedData, baseOpts);
	}

	private isScatterData(data: unknown): data is ScatterDataPoint[] {
		if (!Array.isArray(data) || data.length === 0) return false;
		const first = data[0] as { x?: unknown; y?: unknown };
		return typeof first?.x === 'number'
			&& typeof first?.y === 'number';
	}

	private transformData(data: unknown, targetType: ChartType): ChartData {
		if (!this.isScatterData(data)) return data as ChartData;

		switch (targetType) {
			case 'scatter':
				return data;

			case 'densityHeatmap':
				return data.map(p => ({
					x: p.x,
					y: p.y,
					value: 1
				})) as DensityPoint[];

			case 'bar':
			case 'histogram':
				return scatterToHistogram(data, { bins: 10 });

			default:
				return data as ChartData;
		}
	}

	private getDensityPadding(): { top: number; right: number; bottom: number; left: number } {
		switch (this.currentDensity) {
			case 'compact':
				return { top: 25, right: 10, bottom: 30, left: 35 };
			case 'spacious':
				return { top: 50, right: 30, bottom: 70, left: 65 };
			case 'normal':
			default:
				return { top: 40, right: 20, bottom: 50, left: 50 };
		}
	}

	/**
	 * recommendType 方法。
	 * @param data - 数据
	 * @param context - 上下文
	 * @returns 结果数组
	 */
	static recommendType(data: unknown, context?: string): ChartType[] {
		const scores: { type: ChartType; score: number }[] = [];

		if (!data) return ['bar'];

		if (Array.isArray(data)) {
			if (data.length === 0) return ['bar'];

			const first = data[0] as {
				x?: unknown;
				y?: unknown;
				label?: unknown;
				value?: unknown;
				text?: unknown;
				weight?: unknown;
				values?: unknown;
				position?: unknown;
				row?: unknown;
				col?: unknown;
				data?: unknown;
				points?: unknown;
			};
			const hasXY = typeof first?.x === 'number' && typeof first?.y === 'number';
			const hasLabelValue = typeof first?.label === 'string' && typeof first?.value === 'number';
			const hasTextWeight = typeof first?.text === 'string' && typeof first?.weight === 'number';
			const hasValues = Array.isArray(first?.values);
			const hasPosition = typeof first?.position === 'number';
			const hasRowCol = typeof first?.row === 'string' && typeof first?.col === 'string';
			const hasData = Array.isArray(first?.data);
			const hasPoints = Array.isArray(first?.points);

			const longLabels = hasLabelValue && data.some((item: { label?: string }) => (item.label?.length ?? 0) > 8);

			if (hasXY) {
				scores.push({ type: 'scatter', score: 10 });
				scores.push({ type: 'densityHeatmap', score: 8 });
				scores.push({ type: 'bar', score: 4 });
				scores.push({ type: 'heatmap', score: 3 });
			}

			if (hasLabelValue) {
				if (longLabels) {
					scores.push({ type: 'horizontalBar', score: 9 });
					scores.push({ type: 'bar', score: 5 });
				} else {
					scores.push({ type: 'bar', score: 9 });
					scores.push({ type: 'horizontalBar', score: 7 });
				}
				scores.push({ type: 'donut', score: 7 });
				scores.push({ type: 'radar', score: data.length <= 6 ? 6 : 3 });
				scores.push({ type: 'wordCloud', score: 4 });
			}

			if (hasTextWeight) {
				scores.push({ type: 'wordCloud', score: 10 });
				scores.push({ type: 'bar', score: 6 });
				scores.push({ type: 'horizontalBar', score: 6 });
			}

			if (hasValues) {
				scores.push({ type: 'violin', score: 9 });
				scores.push({ type: 'bar', score: 5 });
				scores.push({ type: 'heatmap', score: 4 });
			}

			if (hasPosition) {
				scores.push({ type: 'timeline', score: 10 });
				scores.push({ type: 'bar', score: 4 });
			}

			if (hasRowCol) {
				scores.push({ type: 'heatmap', score: 10 });
				scores.push({ type: 'bar', score: 4 });
			}

			if (hasData) {
				scores.push({ type: 'line', score: 9 });
				scores.push({ type: 'area', score: 8 });
				scores.push({ type: 'bar', score: 5 });
			}

			if (hasPoints) {
				scores.push({ type: 'area', score: 9 });
				scores.push({ type: 'line', score: 8 });
				scores.push({ type: 'bar', score: 4 });
			}
		} else if (data && typeof data === 'object') {
			const node = data as { name?: unknown; children?: unknown };
			if (node.name !== undefined && node.children !== undefined) {
				scores.push({ type: 'tree', score: 10 });
			}
		}

		if (context) {
			const contextLower = context.toLowerCase();
			if (contextLower.includes('关系') || contextLower.includes('角色')) {
				scores.forEach(s => {
					if (s.type === 'radar') s.score += 2;
					if (s.type === 'tree') s.score += 1;
				});
			}
			if (contextLower.includes('情绪') || contextLower.includes('分布')) {
				scores.forEach(s => {
					if (s.type === 'violin') s.score += 2;
					if (s.type === 'densityHeatmap') s.score += 2;
				});
			}
			if (contextLower.includes('时间') || contextLower.includes('趋势')) {
				scores.forEach(s => {
					if (s.type === 'line') s.score += 2;
					if (s.type === 'area') s.score += 2;
					if (s.type === 'timeline') s.score += 2;
				});
			}
		}

		if (scores.length === 0) {
			return ['bar', 'horizontalBar', 'donut'];
		}

		scores.sort((a, b) => b.score - a.score);
		return scores.map(s => s.type).filter((t, i, arr) => arr.indexOf(t) === i).slice(0, 6);
	}
}
