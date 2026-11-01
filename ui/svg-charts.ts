/**
 * 雷达图数据项。
 */
export interface RadarDataItem {
	label: string;
	value: number;
}

/**
 * 雷达图选项。
 */
export interface RadarOptions {
	size?: number;
	title?: string;
}

/**
 * 柱状图数据项。
 */
export interface BarDataItem {
	label: string;
	value: number;
}

/**
 * 柱状图选项。
 */
export interface BarOptions {
	width?: number;
	height?: number;
	title?: string;
	horizontal?: boolean;
}

/**
 * 环形图数据项。
 */
export interface DonutDataItem {
	label: string;
	value: number;
	color?: string;
}

/**
 * 环形图选项。
 */
export interface DonutOptions {
	size?: number;
	title?: string;
}

/**
 * 词云数据项。
 */
export interface WordCloudItem {
	text: string;
	weight: number;
}

/**
 * 词云选项。
 */
export interface WordCloudOptions {
	width?: number;
	height?: number;
	title?: string;
}

const DEFAULT_COLORS = [
	'#7c3aed',
	'#ec4899',
	'#f59e0b',
	'#10b981',
	'#3b82f6',
	'#ef4444',
	'#8b5cf6',
	'#14b8a6'
];

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function truncateText(text: string, maxLen: number): string {
	if (text.length <= maxLen) return text;
	return text.slice(0, maxLen) + '…';
}

function gaussianKDE(samples: number[], bandwidth: number, gridPoints: number[]): number[] {
	const n = samples.length;
	if (n === 0) return gridPoints.map(() => 0);
	const denom = n * bandwidth * Math.sqrt(2 * Math.PI);
	return gridPoints.map(x => {
		let sum = 0;
		for (const s of samples) {
			const d = (x - s) / bandwidth;
			sum += Math.exp(-0.5 * d * d);
		}
		return sum / denom;
	});
}

function silvermanBandwidth(data: number[]): number {
	const n = data.length;
	if (n < 2) return 1;
	const mean = data.reduce((a, b) => a + b, 0) / n;
	const sorted = [...data].sort((a, b) => a - b);
	const q1 = sorted[Math.floor(n * 0.25)];
	const q3 = sorted[Math.floor(n * 0.75)];
	const iqr = q3 - q1;
	const std = Math.sqrt(data.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
	const sigma = Math.min(std, iqr / 1.34) || std || 1;
	return 1.06 * sigma * Math.pow(n, -0.2);
}

function renderTitle(title: string | undefined, width: number): string {
	if (!title) return '';
	return `<text x="${width / 2}" y="20" text-anchor="middle" fill="var(--text-normal)" font-size="14" font-weight="600">${escapeHtml(title)}</text>`;
}

// ============================================================================
// Task 6: ChartContainer 统一图表容器
// ============================================================================

/**
 * ChartContainer 选项接口
 * 封装 SVG 图表的公共布局参数
 */
export interface ChartContainerOptions {
	width?: number;
	height?: number;
	title?: string;
	padding?: { top: number; right: number; bottom: number; left: number };
	showGrid?: boolean;
	showXAxis?: boolean;
	showYAxis?: boolean;
	xAxisLabel?: string;
	yAxisLabel?: string;
	tickCount?: number;
	xDomain?: [number, number];
	yDomain?: [number, number];
	xLabels?: string[];
}

/**
 * ChartContainer 返回的片段结构
 */
export interface ChartContainerResult {
	/** SVG 开始标签 + title + 网格 + 轴 + plot area 起始 <g> */
	svgStart: string;
	/** plot area 结束 </g> + SVG 结束标签 */
	svgEnd: string;
	/** 绘图区域坐标信息 */
	plotArea: {
		x: number;
		y: number;
		width: number;
		height: number;
	};
	/** 坐标转换辅助函数 */
	getX: (value: number) => number;
	getY: (value: number) => number;
	/** 图例 HTML 片段（外部使用） */
	legendArea: (items: { label: string; color: string }[]) => string;
	/** tooltip HTML 容器 */
	tooltipHtml: string;
}

/**
 * 创建统一图表容器
 * 封装 SVG 根元素、viewBox、网格、坐标轴、图例、tooltip 等公共逻辑
 */
export function createChartContainer(options: ChartContainerOptions = {}): ChartContainerResult {
	const width = options.width || 400;
	const height = options.height || 250;
	const title = options.title;
	const padding = options.padding || { top: 40, right: 20, bottom: 50, left: 50 };
	const showGrid = options.showGrid !== false;
	const showXAxis = options.showXAxis !== false;
	const showYAxis = options.showYAxis !== false;
	const tickCount = options.tickCount || 5;

	const chartWidth = width - padding.left - padding.right;
	const chartHeight = height - padding.top - padding.bottom;
	const titleSvg = renderTitle(title, width);

	const xDomain = options.xDomain || [0, 1];
	const yDomain = options.yDomain || [0, 1];
	const xRange = xDomain[1] - xDomain[0] || 1;
	const yRange = yDomain[1] - yDomain[0] || 1;

	function getX(value: number): number {
		return padding.left + ((value - xDomain[0]) / xRange) * chartWidth;
	}

	function getY(value: number): number {
		return padding.top + chartHeight - ((value - yDomain[0]) / yRange) * chartHeight;
	}

	let gridSvg = '';
	if (showGrid) {
		for (let i = 0; i <= tickCount; i++) {
			const y = padding.top + (i / tickCount) * chartHeight;
			const yValue = yDomain[1] - (i / tickCount) * yRange;
			gridSvg += `<line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="var(--background-modifier-border)" stroke-width="1" stroke-dasharray="3,3"/>`;
			gridSvg += `<text x="${padding.left - 5}" y="${y}" text-anchor="end" dominant-baseline="middle" fill="var(--text-muted)" font-size="11">${typeof yValue === 'number' ? +yValue.toFixed(2) : yValue}</text>`;

			const x = padding.left + (i / tickCount) * chartWidth;
			let xLabel = '';
			if (options.xLabels && options.xLabels[i] !== undefined) {
				xLabel = escapeHtml(options.xLabels[i]);
			} else {
				const xValue = xDomain[0] + (i / tickCount) * xRange;
				xLabel = String(+xValue.toFixed(2));
			}
			gridSvg += `<line x1="${x}" y1="${padding.top}" x2="${x}" y2="${height - padding.bottom}" stroke="var(--background-modifier-border)" stroke-width="1" stroke-dasharray="3,3"/>`;
			gridSvg += `<text x="${x}" y="${height - padding.bottom + 15}" text-anchor="middle" fill="var(--text-muted)" font-size="11">${xLabel}</text>`;
		}
	}

	let axesSvg = '';
	if (showXAxis) {
		axesSvg += `<line x1="${padding.left}" y1="${height - padding.bottom}" x2="${width - padding.right}" y2="${height - padding.bottom}" stroke="var(--background-modifier-border)" stroke-width="1"/>`;
		if (options.xAxisLabel) {
			axesSvg += `<text x="${width / 2}" y="${height - 10}" text-anchor="middle" fill="var(--text-normal)" font-size="12">${escapeHtml(options.xAxisLabel)}</text>`;
		}
	}
	if (showYAxis) {
		axesSvg += `<line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${height - padding.bottom}" stroke="var(--background-modifier-border)" stroke-width="1"/>`;
		if (options.yAxisLabel) {
			axesSvg += `<text x="12" y="${height / 2}" text-anchor="middle" dominant-baseline="middle" fill="var(--text-normal)" font-size="12" transform="rotate(-90, 12, ${height / 2})">${escapeHtml(options.yAxisLabel)}</text>`;
		}
	}

	const svgStart = `<div class="nw-chart-container" style="width:100%;position:relative;">
		<svg class="nw-chart-svg" width="100%" height="100%" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" style="display:block;max-width:100%;">
			${titleSvg}
			${gridSvg}
			${axesSvg}
			<g class="nw-chart-plot">`;

	const svgEnd = `</g></svg>
		<div class="nw-chart-tooltip" role="tooltip" aria-hidden="true"></div>
	</div>`;

	function legendArea(items: { label: string; color: string }[]): string {
		const itemsHtml = items.map(item => `
			<div class="nw-chart-legend-item" data-series="${escapeHtml(item.label)}" style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-normal);cursor:pointer;">
				<span style="width:12px;height:12px;border-radius:2px;background:${item.color};flex-shrink:0;"></span>
				<span>${escapeHtml(item.label)}</span>
			</div>
		`).join('');
		return `<div class="nw-chart-legend" style="display:flex;flex-wrap:wrap;gap:12px;justify-content:center;margin-top:8px;">${itemsHtml}</div>`;
	}

	const tooltipHtml = `<div class="nw-chart-tooltip" role="tooltip" aria-hidden="true"></div>`;

	return {
		svgStart,
		svgEnd,
		plotArea: { x: padding.left, y: padding.top, width: chartWidth, height: chartHeight },
		getX,
		getY,
		legendArea,
		tooltipHtml
	};
}

// ============================================================================
// Task 7: attachChartInteractions — 为图表添加交互
// ============================================================================

/**
 * 为容器内所有图表元素添加交互能力
 * - mouseenter/mouseleave：显示/隐藏 tooltip
 * - 图例点击：toggle 系列显示
 *
 * @param container 包含 SVG 图表的 HTMLElement
 */
export function attachChartInteractions(container: HTMLElement): void {
	if (container.getAttribute('data-chart-interactions-bound') === 'true') {
		return;
	}
	container.setAttribute('data-chart-interactions-bound', 'true');

	const tooltip = container.querySelector('.nw-chart-tooltip') as HTMLElement | null
		|| createTooltip(container);

	const interactiveSelectors = [
		'.nw-chart-rad-point',
		'.nw-chart-bar-rect',
		'.nw-chart-hbar-rect',
		'.nw-chart-donut-slice',
		'.nw-chart-line-point',
		'.nw-chart-scatter-dot',
		'.nw-chart-timeline-node',
		'.nw-chart-word-item',
		'.nw-chart-heatmap-cell',
		'.nw-chart-density-cell',
		'.nw-chart-tree-node',
		'.nw-chart-area-point',
		'.nw-chart-violin',
		'.nw-chart-violin-point'
	];
	const interactiveElements = container.querySelectorAll<SVGElement | HTMLElement>(
		interactiveSelectors.join(',')
	);

	interactiveElements.forEach(el => {
		el.addEventListener('mouseenter', (event: Event) => {
			const me = event as MouseEvent;
			const label = el.getAttribute('data-label') || el.getAttribute('data-text') || '';
			const value = el.getAttribute('data-value')
				|| el.getAttribute('data-weight')
				|| el.getAttribute('data-percent')
				|| '';
			const series = el.getAttribute('data-series') || '';
			const row = el.getAttribute('data-row') || '';
			const col = el.getAttribute('data-col') || '';
			const count = el.getAttribute('data-count') || '';
			const hasXY = el.getAttribute('data-x') !== null;
			const xVal = el.getAttribute('data-x') || '';
			const yVal = el.getAttribute('data-y') || '';

			const parts: string[] = [];
			if (label) parts.push(label);
			if (row && col && row + ' / ' + col !== label) {
				parts.push(`${row} / ${col}`);
			}
			if (series && series !== label) parts.push(series);
			if (value) parts.push(value);
			if (count) parts.push(`点数: ${count}`);
			if (hasXY) parts.push(`(${xVal}, ${yVal})`);
			tooltip.innerHTML = parts.map(p => `<div>${escapeHtml(p)}</div>`).join('');
			tooltip.classList.add('visible');
			tooltip.setAttribute('aria-hidden', 'false');
			positionTooltip(tooltip, me, container);
		});

		el.addEventListener('mousemove', (event: Event) => {
			positionTooltip(tooltip, event as MouseEvent, container);
		});

		el.addEventListener('mouseleave', () => {
			tooltip.classList.remove('visible');
			tooltip.setAttribute('aria-hidden', 'true');
		});
	});

	// 图例点击：toggle 系列显示
	const legendItems = container.querySelectorAll<HTMLElement>('.nw-chart-legend-item');
	legendItems.forEach(item => {
		item.addEventListener('click', () => {
			const series = item.getAttribute('data-series');
			if (!series) return;
			const hidden = item.getAttribute('data-series-hidden') === 'true';
			item.setAttribute('data-series-hidden', String(!hidden));
			item.style.opacity = hidden ? '1' : '0.5';
			const seriesEls = container.querySelectorAll<SVGElement | HTMLElement>(
				`[data-series="${CSS.escape(series)}"]`
			);
			seriesEls.forEach(el => {
				if (el.classList.contains('nw-chart-legend-item')) return;
				el.style.display = hidden ? '' : 'none';
			});
		});
	});
}

function createTooltip(container: HTMLElement): HTMLElement {
	const tip = document.createElement('div');
	tip.className = 'nw-chart-tooltip';
	tip.setAttribute('role', 'tooltip');
	tip.setAttribute('aria-hidden', 'true');
	container.appendChild(tip);
	return tip;
}

function positionTooltip(tooltip: HTMLElement, event: MouseEvent, container: HTMLElement): void {
	const rect = container.getBoundingClientRect();
	const tipRect = tooltip.getBoundingClientRect();
	let x = event.clientX - rect.left + 12;
	let y = event.clientY - rect.top + 12;
	if (x + tipRect.width > rect.width) x = event.clientX - rect.left - tipRect.width - 12;
	if (y + tipRect.height > rect.height) y = rect.height - tipRect.height - 4;
	tooltip.style.left = `${Math.max(4, x)}px`;
	tooltip.style.top = `${Math.max(4, y)}px`;
}

// ============================================================================
// Task 8/9: radarChart（响应式 + 动画 + 交互）
// ============================================================================

/**
 * 渲染雷达图。
 *
 * @param data - 参数
 * @param options - 参数
 * @returns SVG 字符串
 */
export function radarChart(data: RadarDataItem[], options: RadarOptions = {}): string {
	const size = options.size || 320;
	const title = options.title;
	const centerX = size / 2;
	const centerY = size / 2 + 15;
	const labelRadiusOffset = data.length > 6 ? 35 : 28;
	const maxRadius = size / 2 - 50 - (data.length > 6 ? 10 : 0);
	const levels = 5;
	const n = data.length;

	if (n < 3) {
		return `<div class="nw-chart-container" style="width:100%;color:var(--text-muted);">雷达图至少需要3个数据维度</div>`;
	}

	const angleStep = (Math.PI * 2) / n;
	const startAngle = -Math.PI / 2;
	const manyDimensions = n > 8;

	function getPoint(level: number, index: number): { x: number; y: number } {
		const angle = startAngle + index * angleStep;
		const r = (level / levels) * maxRadius;
		return {
			x: centerX + r * Math.cos(angle),
			y: centerY + r * Math.sin(angle)
		};
	}

	const gridPolygons: string[] = [];
	for (let level = 1; level <= levels; level++) {
		const points = [];
		for (let i = 0; i < n; i++) {
			const p = getPoint(level, i);
			points.push(`${p.x},${p.y}`);
		}
		gridPolygons.push(
			`<polygon points="${points.join(' ')}" fill="none" stroke="var(--background-modifier-border)" stroke-width="1"/>`
		);
	}

	const axisLines: string[] = [];
	for (let i = 0; i < n; i++) {
		const p = getPoint(levels, i);
		axisLines.push(
			`<line x1="${centerX}" y1="${centerY}" x2="${p.x}" y2="${p.y}" stroke="var(--background-modifier-border)" stroke-width="1"/>`
		);
	}

	const dataPoints = data.map((item, i) => {
		const value = Math.max(0, Math.min(100, item.value));
		const ratio = value / 100;
		const angle = startAngle + i * angleStep;
		const r = ratio * maxRadius;
		return {
			x: centerX + r * Math.cos(angle),
			y: centerY + r * Math.sin(angle),
			label: item.label,
			value: item.value
		};
	});

	const dataPolygonPoints = dataPoints.map(p => `${p.x},${p.y}`).join(' ');

	const dataDots = dataPoints.map(p =>
		`<circle class="nw-chart-rad-point" data-label="${escapeHtml(p.label)}" data-value="${p.value}" cx="${p.x}" cy="${p.y}" r="4" fill="var(--interactive-accent)" stroke="var(--background-primary)" stroke-width="2"/>`
	).join('');

	const labels = data.map((item, i) => {
		const angle = startAngle + i * angleStep;
		const labelRadius = maxRadius + labelRadiusOffset;
		const x = centerX + labelRadius * Math.cos(angle);
		const y = centerY + labelRadius * Math.sin(angle);
		let anchor = 'middle';
		if (Math.cos(angle) > 0.3) anchor = 'start';
		else if (Math.cos(angle) < -0.3) anchor = 'end';
		const displayLabel = truncateText(item.label, 6);
		return `<text x="${x}" y="${y}" text-anchor="${anchor}" dominant-baseline="middle" fill="var(--text-normal)" font-size="11">${escapeHtml(displayLabel)}</text>`;
	}).join('');

	const titleSvg = renderTitle(title, size);
	const hintText = manyDimensions
		? `<text x="${centerX}" y="32" text-anchor="middle" fill="var(--text-muted)" font-size="10">维度较多，建议切换为柱状图查看</text>`
		: '';

	return `<div class="nw-chart-container" style="width:100%;position:relative;">
		<svg class="nw-chart-svg" width="100%" height="100%" viewBox="0 0 ${size} ${size}" preserveAspectRatio="xMidYMid meet" style="display:block;max-width:100%;">
			${titleSvg}
			${hintText}
			${gridPolygons.join('')}
			${axisLines.join('')}
			<polygon points="${dataPolygonPoints}" fill="var(--interactive-accent)" fill-opacity="0.2" stroke="var(--interactive-accent)" stroke-width="2"/>
			${dataDots}
			${labels}
		</svg>
		<div class="nw-chart-tooltip" role="tooltip" aria-hidden="true"></div>
	</div>`;
}

// ============================================================================
// Task 8/9: barChart（响应式 + 动画 + 交互）
// ============================================================================

/**
 * 渲染柱状图。
 *
 * @param data - 参数
 * @param options - 参数
 * @returns SVG 字符串
 */
export function barChart(data: BarDataItem[], options: BarOptions = {}): string {
	const width = options.width || 400;
	const height = options.height || 250;
	const title = options.title;
	const horizontal = options.horizontal || false;

	if (data.length === 0) {
		return `<div class="nw-chart-container" style="width:100%;color:var(--text-muted);">暂无数据</div>`;
	}

	const maxValue = Math.max(...data.map(d => d.value), 1);
	const titleSvg = renderTitle(title, width);

	if (horizontal) {
		const padding = { top: 30, right: 40, bottom: 30, left: 90 };
		const chartWidth = width - padding.left - padding.right;
		const chartHeight = height - padding.top - padding.bottom;
		const barHeight = Math.min(28, (chartHeight - 10) / data.length - 6);
		const barGap = (chartHeight - barHeight * data.length) / (data.length + 1);

		const yAxis = `<line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${height - padding.bottom}" stroke="var(--background-modifier-border)" stroke-width="1"/>`;

		const gridLines: string[] = [];
		const tickCount = 5;
		for (let i = 0; i <= tickCount; i++) {
			const x = padding.left + (i / tickCount) * chartWidth;
			const value = Math.round((i / tickCount) * maxValue);
			gridLines.push(`<line x1="${x}" y1="${padding.top}" x2="${x}" y2="${height - padding.bottom}" stroke="var(--background-modifier-border)" stroke-width="1" stroke-dasharray="3,3"/>`);
			gridLines.push(`<text x="${x}" y="${height - padding.bottom + 15}" text-anchor="middle" fill="var(--text-muted)" font-size="11">${value}</text>`);
		}

		const bars = data.map((d, i) => {
			const y = padding.top + barGap + i * (barHeight + barGap);
			const barWidth = (d.value / maxValue) * chartWidth;
			const displayLabel = truncateText(d.label, 10);
			return `
				<rect class="nw-chart-bar-rect" data-label="${escapeHtml(d.label)}" data-value="${d.value}" data-series="bar-${i}" x="${padding.left}" y="${y}" width="${barWidth}" height="${barHeight}" fill="var(--interactive-accent)" rx="3"/>
				<text x="${padding.left + barWidth + 5}" y="${y + barHeight / 2}" dominant-baseline="middle" fill="var(--text-normal)" font-size="11">${d.value}</text>
				<text x="${padding.left - 8}" y="${y + barHeight / 2}" text-anchor="end" dominant-baseline="middle" fill="var(--text-normal)" font-size="11">${escapeHtml(displayLabel)}</text>
			`;
		}).join('');

		return `<div class="nw-chart-container" style="width:100%;position:relative;">
			<svg class="nw-chart-svg" width="100%" height="100%" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" style="display:block;max-width:100%;">
				${titleSvg}
				${gridLines.join('')}
				${yAxis}
				${bars}
			</svg>
			<div class="nw-chart-tooltip" role="tooltip" aria-hidden="true"></div>
		</div>`;
	} else {
		const needRotate = data.length > 8;
		const hasLongLabels = data.some(d => d.label.length > 8);
		const bottomPadding = needRotate ? 70 : (hasLongLabels ? 55 : 40);
		const padding = { top: 35, right: 20, bottom: bottomPadding, left: 45 };
		const chartWidth = width - padding.left - padding.right;
		const chartHeight = height - padding.top - padding.bottom;

		const barWidth = Math.min(40, (chartWidth - 10) / data.length - 8);
		const barGap = (chartWidth - barWidth * data.length) / (data.length + 1);

		const xAxis = `<line x1="${padding.left}" y1="${height - padding.bottom}" x2="${width - padding.right}" y2="${height - padding.bottom}" stroke="var(--background-modifier-border)" stroke-width="1"/>`;

		const gridLines: string[] = [];
		const tickCount = 5;
		for (let i = 0; i <= tickCount; i++) {
			const y = height - padding.bottom - (i / tickCount) * chartHeight;
			const value = Math.round((i / tickCount) * maxValue);
			gridLines.push(`<line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="var(--background-modifier-border)" stroke-width="1" stroke-dasharray="3,3"/>`);
			gridLines.push(`<text x="${padding.left - 5}" y="${y}" text-anchor="end" dominant-baseline="middle" fill="var(--text-muted)" font-size="11">${value}</text>`);
		}

		const bars = data.map((d, i) => {
			const x = padding.left + barGap + i * (barWidth + barGap);
			const barHeight = (d.value / maxValue) * chartHeight;
			const y = height - padding.bottom - barHeight;
			const displayLabel = truncateText(d.label, 8);
			const labelX = x + barWidth / 2;
			const labelY = needRotate ? height - padding.bottom + 8 : height - padding.bottom + 15;
			const labelTransform = needRotate
				? `transform="rotate(-45 ${labelX} ${labelY})"`
				: '';
			const labelAnchor = needRotate ? 'end' : 'middle';
			return `
				<rect class="nw-chart-bar-rect" data-label="${escapeHtml(d.label)}" data-value="${d.value}" data-series="bar-${i}" x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" fill="var(--interactive-accent)" rx="3"/>
				<text x="${x + barWidth / 2}" y="${y - 5}" text-anchor="middle" fill="var(--text-normal)" font-size="11">${d.value}</text>
				<text x="${labelX}" y="${labelY}" text-anchor="${labelAnchor}" fill="var(--text-normal)" font-size="11" ${labelTransform}>${escapeHtml(displayLabel)}</text>
			`;
		}).join('');

		return `<div class="nw-chart-container" style="width:100%;position:relative;">
			<svg class="nw-chart-svg" width="100%" height="100%" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" style="display:block;max-width:100%;">
				${titleSvg}
				${gridLines.join('')}
				${xAxis}
				${bars}
			</svg>
			<div class="nw-chart-tooltip" role="tooltip" aria-hidden="true"></div>
		</div>`;
	}
}

// ============================================================================
// Task 8/9: donutChart（响应式 + 动画 + 交互）
// ============================================================================

/**
 * 渲染环形图。
 *
 * @param data - 参数
 * @param options - 参数
 * @returns SVG 字符串
 */
export function donutChart(data: DonutDataItem[], options: DonutOptions = {}): string {
	const size = options.size || 280;
	const title = options.title;
	const centerX = size / 2;
	const centerY = size / 2 + 10;
	const outerRadius = size / 2 - 50;
	const innerRadius = outerRadius * 0.6;

	if (data.length === 0) {
		return `<div class="nw-chart-container" style="width:100%;color:var(--text-muted);">暂无数据</div>`;
	}

	const total = data.reduce((sum, d) => sum + d.value, 0);

	if (total === 0) {
		return `<div class="nw-chart-container" style="width:100%;color:var(--text-muted);">数据总和为0</div>`;
	}

	const colors = data.map((d, i) => d.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length]);

	let startAngle = -Math.PI / 2;
	const arcs: string[] = [];

	data.forEach((d, i) => {
		const sliceAngle = (d.value / total) * Math.PI * 2;
		const endAngle = startAngle + sliceAngle;
		const percent = ((d.value / total) * 100).toFixed(1);

		const x1 = centerX + outerRadius * Math.cos(startAngle);
		const y1 = centerY + outerRadius * Math.sin(startAngle);
		const x2 = centerX + outerRadius * Math.cos(endAngle);
		const y2 = centerY + outerRadius * Math.sin(endAngle);
		const x3 = centerX + innerRadius * Math.cos(endAngle);
		const y3 = centerY + innerRadius * Math.sin(endAngle);
		const x4 = centerX + innerRadius * Math.cos(startAngle);
		const y4 = centerY + innerRadius * Math.sin(startAngle);

		const largeArc = sliceAngle > Math.PI ? 1 : 0;

		const path = `
			M ${x1} ${y1}
			A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${x2} ${y2}
			L ${x3} ${y3}
			A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${x4} ${y4}
			Z
		`;

		arcs.push(`<path class="nw-chart-donut-slice" data-label="${escapeHtml(d.label)}" data-value="${d.value}" data-percent="${percent}%" data-series="${escapeHtml(d.label)}" d="${path.trim()}" fill="${colors[i]}" stroke="var(--background-primary)" stroke-width="2"/>`);

		startAngle = endAngle;
	});

	const legendItems = data.map((d, i) => {
		const percent = ((d.value / total) * 100).toFixed(1);
		return `
			<div class="nw-chart-legend-item" data-series="${escapeHtml(d.label)}" style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-normal);cursor:pointer;">
				<span style="width:10px;height:10px;border-radius:2px;background:${colors[i]};flex-shrink:0;"></span>
				<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(d.label)}</span>
				<span style="color:var(--text-muted);">${percent}%</span>
			</div>
		`;
	}).join('');

	const titleSvg = renderTitle(title, size);

	return `<div class="nw-chart-container" style="width:100%;position:relative;display:flex;align-items:center;gap:16px;">
		<svg class="nw-chart-svg" width="100%" height="100%" viewBox="0 0 ${size} ${size}" preserveAspectRatio="xMidYMid meet" style="flex-shrink:0;max-width:${size * 0.6}px;">
			${titleSvg}
			${arcs.join('')}
			<text x="${centerX}" y="${centerY - 5}" text-anchor="middle" fill="var(--text-normal)" font-size="20" font-weight="600">${total}</text>
			<text x="${centerX}" y="${centerY + 15}" text-anchor="middle" fill="var(--text-muted)" font-size="11">总计</text>
		</svg>
		<div style="display:flex;flex-direction:column;gap:6px;flex:1;min-width:0;">
			${legendItems}
		</div>
		<div class="nw-chart-tooltip" role="tooltip" aria-hidden="true"></div>
	</div>`;
}

/**
 * 折线图数据点。
 */
export interface LineChartDataPoint {
	label?: string;
	value: number;
	color?: string;
	annotation?: string;
}

/**
 * 折线图序列。
 */
export interface LineChartSeries {
	name: string;
	data: LineChartDataPoint[];
	color?: string;
	showPoints?: boolean;
	smooth?: boolean;
}

/**
 * 折线图选项。
 */
export interface LineChartOptions {
	width?: number;
	height?: number;
	title?: string;
	xAxisLabel?: string;
	yAxisLabel?: string;
	showGrid?: boolean;
	showLegend?: boolean;
}

/**
 * 散点图数据点。
 */
export interface ScatterDataPoint {
	x: number;
	y: number;
	label?: string;
	category?: string;
	size?: number;
}

/**
 * 散点图选项。
 */
export interface ScatterChartOptions {
	width?: number;
	height?: number;
	title?: string;
	xAxisLabel?: string;
	yAxisLabel?: string;
	showGrid?: boolean;
	showLegend?: boolean;
}

/**
 * 时间线事件。
 */
export interface TimelineEvent {
	position: number;
	label: string;
	description?: string;
	type?: string;
	level?: number;
	date?: string;
}

/**
 * 时间线图选项。
 */
export interface TimelineChartOptions {
	width?: number;
	height?: number;
	title?: string;
	showLabels?: boolean;
	orientation?: 'horizontal' | 'vertical';
}

// ============================================================================
// Task 8/9: wordCloud（响应式 + 交互；Task 11 升级为螺旋布局）
// ============================================================================

/**
 * 渲染词云。
 *
 * @param words - 参数
 * @param options - 参数
 * @returns SVG 字符串
 */
export function wordCloud(words: WordCloudItem[], options: WordCloudOptions = {}): string {
	const width = options.width || 400;
	const height = options.height || 200;
	const title = options.title;

	if (words.length === 0) {
		return `<div class="nw-chart-container" style="width:100%;color:var(--text-muted);">暂无数据</div>`;
	}

	const titleHtml = title
		? `<div style="text-align:center;font-size:14px;font-weight:600;color:var(--text-normal);margin-bottom:8px;">${escapeHtml(title)}</div>`
		: '';

	// Task 11: 使用螺旋布局
	const laidOut = spiralLayout(words, { width, height });
	const centerX = width / 2;
	const centerY = height / 2;

	const levelColors = [
		'var(--interactive-accent)',
		'color-mix(in srgb, var(--interactive-accent) 80%, var(--text-normal))',
		'color-mix(in srgb, var(--interactive-accent) 60%, var(--text-normal))',
		'color-mix(in srgb, var(--interactive-accent) 40%, var(--text-normal))',
		'var(--text-muted)'
	];

	const textEls = laidOut.map(w => {
		const color = levelColors[w.level] || 'var(--text-muted)';
		return `<text class="nw-chart-word-item" data-text="${escapeHtml(w.text)}" data-weight="${w.weight}" data-label="${escapeHtml(w.text)}" data-value="${w.weight}" x="${centerX + w.x}" y="${centerY + w.y}" text-anchor="middle" dominant-baseline="middle" fill="${color}" font-size="${w.fontSize}" style="cursor:pointer;">${escapeHtml(w.text)}</text>`;
	}).join('');

	return `<div class="nw-chart-container" style="width:100%;position:relative;">
		${titleHtml}
		<svg class="nw-chart-svg" width="100%" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" style="display:block;max-width:100%;">
			<rect x="0" y="0" width="${width}" height="${height}" fill="none" stroke="var(--background-modifier-border)" stroke-width="1" rx="6"/>
			${textEls}
		</svg>
		<div class="nw-chart-tooltip" role="tooltip" aria-hidden="true"></div>
	</div>`;
}

// ============================================================================
// Task 11: spiralLayout — wordCloud 阿基米德螺线布局
// ============================================================================

/**
 * 螺旋布局输入。
 */
export interface SpiralLayoutInput {
	text: string;
	weight: number;
}

/**
 * 螺旋布局输出。
 */
export interface SpiralLayoutOutput {
	text: string;
	weight: number;
	x: number;
	y: number;
	fontSize: number;
	level: number;
}

/**
 * 阿基米德螺线布局
 * - 按权重降序排序
 * - 从中心开始，沿 r = a + b*θ 螺线计算位置
 * - bounding box 碰撞检测
 * - 字体大小 5 级梯度（按权重分位数）
 */
export function spiralLayout(
	words: SpiralLayoutInput[],
	bounds: { width: number; height: number }
): SpiralLayoutOutput[] {
	if (words.length === 0) return [];

	const sorted = [...words].sort((a, b) => b.weight - a.weight);
	const maxWeight = sorted[0].weight;
	const minWeight = sorted[sorted.length - 1].weight;
	const weightRange = maxWeight - minWeight || 1;

	// 5 级字体梯度
	const levelSizes = [22, 18, 15, 13, 11];
	const levels = 5;

	function getLevel(weight: number): number {
		const normalized = (weight - minWeight) / weightRange;
		// 权重越高 level 越小（字号越大）
		return Math.min(levels - 1, Math.floor((1 - normalized) * levels));
	}

	const placed: { x: number; y: number; w: number; h: number }[] = [];
	const results: SpiralLayoutOutput[] = [];

	// 阿基米德螺线参数
	const a = 0;
	const b = 0.6;
	const thetaStep = 0.3;
	const maxTheta = Math.PI * 30;

	// 字号→像素宽估算（仅用于碰撞检测，近似）
	const estimateWidth = (text: string, fontSize: number) => text.length * fontSize * 0.6;
	const estimateHeight = (fontSize: number) => fontSize * 1.2;

	for (const word of sorted) {
		const level = getLevel(word.weight);
		const fontSize = levelSizes[level];
		const w = estimateWidth(word.text, fontSize);
		const h = estimateHeight(fontSize);

		let theta = 0;
		let placedOk = false;
		let x = 0, y = 0;
		const maxIter = 5000;
		let iter = 0;

		while (theta < maxTheta && iter < maxIter && !placedOk) {
			const r = a + b * theta;
			x = r * Math.cos(theta);
			y = r * Math.sin(theta);

			// 边界检查（中心点为 0,0，需转换为相对中心）
			const absX = Math.abs(x);
			const absY = Math.abs(y);
			if (absX + w / 2 <= bounds.width / 2 - 6 && absY + h / 2 <= bounds.height / 2 - 6) {
				// 碰撞检测
				const collide = placed.some(p =>
					Math.abs(x - p.x) < (w + p.w) / 2 + 2 &&
					Math.abs(y - p.y) < (h + p.h) / 2 + 2
				);
				if (!collide) {
					placedOk = true;
				}
			}

			theta += thetaStep;
			iter++;
		}

		// 超出边界也强制放置（避免遗漏词）
		placed.push({ x, y, w, h });
		results.push({
			text: word.text,
			weight: word.weight,
			x,
			y,
			fontSize,
			level
		});
	}

	return results;
}

// ============================================================================
// Task 8/9: lineChart（响应式 + 动画 + 交互）
// ============================================================================

/**
 * 渲染折线图。
 *
 * @param series - 参数
 * @param options - 参数
 * @returns SVG 字符串
 */
export function lineChart(series: LineChartSeries[], options: LineChartOptions = {}): string {
	const width = options.width || 400;
	const height = options.height || 250;
	const title = options.title;
	const xAxisLabel = options.xAxisLabel;
	const yAxisLabel = options.yAxisLabel;
	const showGrid = options.showGrid !== false;
	const showLegend = options.showLegend !== false;

	if (series.length === 0 || series.every(s => s.data.length === 0)) {
		return `<div class="nw-chart-container" style="width:100%;color:var(--text-muted);">暂无数据</div>`;
	}

	const padding = { top: 40, right: 20, bottom: 50, left: 50 };
	const chartWidth = width - padding.left - padding.right;
	const chartHeight = height - padding.top - padding.bottom;
	const titleSvg = renderTitle(title, width);

	const allValues = series.flatMap(s => s.data.map(d => d.value));
	const maxValue = Math.max(...allValues, 1);
	const minValue = Math.min(...allValues, 0);
	const valueRange = maxValue - minValue || 1;

	const maxDataPoints = Math.max(...series.map(s => s.data.length));
	const xStep = maxDataPoints > 1 ? chartWidth / (maxDataPoints - 1) : chartWidth / 2;

	function getX(index: number): number {
		if (maxDataPoints === 1) return padding.left + chartWidth / 2;
		return padding.left + index * xStep;
	}

	function getY(value: number): number {
		return padding.top + chartHeight - ((value - minValue) / valueRange) * chartHeight;
	}

	let gridLines = '';
	if (showGrid) {
		const tickCount = 5;
		for (let i = 0; i <= tickCount; i++) {
			const y = padding.top + (i / tickCount) * chartHeight;
			const value = Math.round(maxValue - (i / tickCount) * valueRange);
			gridLines += `<line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="var(--background-modifier-border)" stroke-width="1" stroke-dasharray="3,3"/>`;
			gridLines += `<text x="${padding.left - 5}" y="${y}" text-anchor="end" dominant-baseline="middle" fill="var(--text-muted)" font-size="11">${value}</text>`;
		}
	}

	const xAxisLine = `<line x1="${padding.left}" y1="${height - padding.bottom}" x2="${width - padding.right}" y2="${height - padding.bottom}" stroke="var(--background-modifier-border)" stroke-width="1"/>`;
	const yAxisLine = `<line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${height - padding.bottom}" stroke="var(--background-modifier-border)" stroke-width="1"/>`;

	let xAxisLabels = '';
	const firstSeries = series.find(s => s.data.length > 0);
	if (firstSeries) {
		firstSeries.data.forEach((d, i) => {
			if (d.label) {
				const x = getX(i);
				xAxisLabels += `<text x="${x}" y="${height - padding.bottom + 15}" text-anchor="middle" fill="var(--text-muted)" font-size="11">${escapeHtml(d.label)}</text>`;
			}
		});
	}

	let xAxisLabelText = '';
	if (xAxisLabel) {
		xAxisLabelText = `<text x="${width / 2}" y="${height - 10}" text-anchor="middle" fill="var(--text-normal)" font-size="12">${escapeHtml(xAxisLabel)}</text>`;
	}

	let yAxisLabelText = '';
	if (yAxisLabel) {
		yAxisLabelText = `<text x="12" y="${height / 2}" text-anchor="middle" dominant-baseline="middle" fill="var(--text-normal)" font-size="12" transform="rotate(-90, 12, ${height / 2})">${escapeHtml(yAxisLabel)}</text>`;
	}

	function generateSmoothPath(points: { x: number; y: number }[]): string {
		if (points.length < 2) return '';
		let path = `M ${points[0].x} ${points[0].y}`;
		for (let i = 0; i < points.length - 1; i++) {
			const p0 = points[i - 1] || points[i];
			const p1 = points[i];
			const p2 = points[i + 1];
			const p3 = points[i + 2] || p2;
			const cp1x = p1.x + (p2.x - p0.x) / 6;
			const cp1y = p1.y + (p2.y - p0.y) / 6;
			const cp2x = p2.x - (p3.x - p1.x) / 6;
			const cp2y = p2.y - (p3.y - p1.y) / 6;
			path += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
		}
		return path;
	}

	function generateLinePath(points: { x: number; y: number }[]): string {
		if (points.length < 2) return '';
		return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
	}

	const seriesColors = series.map((s, i) => s.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length]);

	let lines = '';
	let dataPoints = '';
	let annotations = '';

	series.forEach((s, seriesIndex) => {
		const color = seriesColors[seriesIndex];
		const points = s.data.map((d, i) => ({ x: getX(i), y: getY(d.value) }));

		const path = s.smooth ? generateSmoothPath(points) : generateLinePath(points);
		// Task 9: 添加 nw-chart-line-path 类用于路径绘制动画
		lines += `<path class="nw-chart-line-path" data-series="${escapeHtml(s.name)}" d="${path}" fill="none" stroke="${color}" stroke-width="2"/>`;

		if (s.showPoints !== false) {
			s.data.forEach((d, i) => {
				const x = getX(i);
				const y = getY(d.value);
				const pointColor = d.color || color;
				dataPoints += `<circle class="nw-chart-line-point" data-label="${escapeHtml(d.label || s.name)}" data-x="${i}" data-y="${d.value}" data-series="${escapeHtml(s.name)}" data-value="${d.value}" cx="${x}" cy="${y}" r="4" fill="${pointColor}" stroke="var(--background-primary)" stroke-width="2"/>`;

				if (d.annotation) {
					annotations += `
						<g>
							<line x1="${x}" y1="${y - 8}" x2="${x}" y2="${y - 25}" stroke="${pointColor}" stroke-width="1" stroke-dasharray="2,2"/>
							<rect x="${x - 40}" y="${y - 42}" width="80" height="20" rx="3" fill="${pointColor}" fill-opacity="0.1"/>
							<text x="${x}" y="${y - 28}" text-anchor="middle" fill="${pointColor}" font-size="10">${escapeHtml(d.annotation)}</text>
						</g>
					`;
				}
			});
		}
	});

	let legend = '';
	if (showLegend && series.length > 1) {
		const legendItems = series.map((s, i) => `
			<div class="nw-chart-legend-item" data-series="${escapeHtml(s.name)}" style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-normal);cursor:pointer;">
				<span style="width:16px;height:2px;background:${seriesColors[i]};flex-shrink:0;"></span>
				<span>${escapeHtml(s.name)}</span>
			</div>
		`).join('');
		legend = `
			<div class="nw-chart-legend" style="display:flex;flex-wrap:wrap;gap:12px;justify-content:center;margin-top:8px;">
				${legendItems}
			</div>
		`;
	}

	const svg = `<svg class="nw-chart-svg" width="100%" height="100%" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" style="display:block;max-width:100%;">
			${titleSvg}
			${gridLines}
			${xAxisLine}
			${yAxisLine}
			${xAxisLabels}
			${xAxisLabelText}
			${yAxisLabelText}
			${lines}
			${dataPoints}
			${annotations}
		</svg>`;

	return `<div class="nw-chart-container" style="width:100%;position:relative;">${svg}${legend}<div class="nw-chart-tooltip" role="tooltip" aria-hidden="true"></div></div>`;
}

// ============================================================================
// Task 8/9: scatterChart（响应式 + 动画 + 交互）
// ============================================================================

/**
 * 渲染散点图。
 *
 * @param points - 参数
 * @param options - 参数
 * @returns SVG 字符串
 */
export function scatterChart(points: ScatterDataPoint[], options: ScatterChartOptions = {}): string {
	const width = options.width || 400;
	const height = options.height || 250;
	const title = options.title;
	const xAxisLabel = options.xAxisLabel;
	const yAxisLabel = options.yAxisLabel;
	const showGrid = options.showGrid !== false;
	const showLegend = options.showLegend !== false;

	if (points.length === 0) {
		return `<div class="nw-chart-container" style="width:100%;color:var(--text-muted);">暂无数据</div>`;
	}

	const padding = { top: 40, right: 20, bottom: 50, left: 50 };
	const chartWidth = width - padding.left - padding.right;
	const chartHeight = height - padding.top - padding.bottom;
	const titleSvg = renderTitle(title, width);

	const xValues = points.map(p => p.x);
	const yValues = points.map(p => p.y);
	let xMax = Math.max(...xValues, 1);
	let xMin = Math.min(...xValues, 0);
	let yMax = Math.max(...yValues, 1);
	let yMin = Math.min(...yValues, 0);

	if (xMax === xMin) {
		xMax = xMin + 1;
	}
	if (yMax === yMin) {
		yMax = yMin + 1;
	}

	const xRange = xMax - xMin;
	const yRange = yMax - yMin;

	function getX(x: number): number {
		return padding.left + ((x - xMin) / xRange) * chartWidth;
	}

	function getY(y: number): number {
		return padding.top + chartHeight - ((y - yMin) / yRange) * chartHeight;
	}

	let gridLines = '';
	if (showGrid) {
		const tickCount = 5;
		for (let i = 0; i <= tickCount; i++) {
			const y = padding.top + (i / tickCount) * chartHeight;
			const value = +(yMax - (i / tickCount) * yRange).toFixed(2);
			gridLines += `<line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="var(--background-modifier-border)" stroke-width="1" stroke-dasharray="3,3"/>`;
			gridLines += `<text x="${padding.left - 5}" y="${y}" text-anchor="end" dominant-baseline="middle" fill="var(--text-muted)" font-size="11">${value}</text>`;
		}
		for (let i = 0; i <= tickCount; i++) {
			const x = padding.left + (i / tickCount) * chartWidth;
			const value = +(xMin + (i / tickCount) * xRange).toFixed(2);
			gridLines += `<line x1="${x}" y1="${padding.top}" x2="${x}" y2="${height - padding.bottom}" stroke="var(--background-modifier-border)" stroke-width="1" stroke-dasharray="3,3"/>`;
			gridLines += `<text x="${x}" y="${height - padding.bottom + 15}" text-anchor="middle" fill="var(--text-muted)" font-size="11">${value}</text>`;
		}
	}

	const xAxisLine = `<line x1="${padding.left}" y1="${height - padding.bottom}" x2="${width - padding.right}" y2="${height - padding.bottom}" stroke="var(--background-modifier-border)" stroke-width="1"/>`;
	const yAxisLine = `<line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${height - padding.bottom}" stroke="var(--background-modifier-border)" stroke-width="1"/>`;

	let xAxisLabelText = '';
	if (xAxisLabel) {
		xAxisLabelText = `<text x="${width / 2}" y="${height - 10}" text-anchor="middle" fill="var(--text-normal)" font-size="12">${escapeHtml(xAxisLabel)}</text>`;
	}

	let yAxisLabelText = '';
	if (yAxisLabel) {
		yAxisLabelText = `<text x="12" y="${height / 2}" text-anchor="middle" dominant-baseline="middle" fill="var(--text-normal)" font-size="12" transform="rotate(-90, 12, ${height / 2})">${escapeHtml(yAxisLabel)}</text>`;
	}

	const categories = [...new Set(points.filter(p => p.category).map(p => p.category!))];
	const categoryColorMap: Record<string, string> = {};
	categories.forEach((cat, i) => {
		categoryColorMap[cat] = DEFAULT_COLORS[i % DEFAULT_COLORS.length];
	});

	let dots = '';
	points.forEach(p => {
		const x = getX(p.x);
		const y = getY(p.y);
		const size = p.size || 6;
		const color = p.category ? categoryColorMap[p.category] : 'var(--interactive-accent)';
		const label = p.label || '';
		dots += `<circle class="nw-chart-scatter-dot" data-label="${escapeHtml(label)}" data-x="${p.x}" data-y="${p.y}" data-category="${escapeHtml(p.category || '')}" data-value="${p.y}" cx="${x}" cy="${y}" r="${size}" fill="${color}" fill-opacity="0.6" stroke="var(--background-primary)" stroke-width="1.5"/>`;
	});

	let legend = '';
	if (showLegend && categories.length > 0) {
		const legendItems = categories.map(cat => `
			<div class="nw-chart-legend-item" data-series="${escapeHtml(cat)}" style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-normal);cursor:pointer;">
				<span style="width:12px;height:12px;border-radius:50%;background:${categoryColorMap[cat]};flex-shrink:0;"></span>
				<span>${escapeHtml(cat)}</span>
			</div>
		`).join('');
		legend = `
			<div class="nw-chart-legend" style="display:flex;flex-wrap:wrap;gap:12px;justify-content:center;margin-top:8px;">
				${legendItems}
			</div>
		`;
	}

	const svg = `<svg class="nw-chart-svg" width="100%" height="100%" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" style="display:block;max-width:100%;">
			${titleSvg}
			${gridLines}
			${xAxisLine}
			${yAxisLine}
			${xAxisLabelText}
			${yAxisLabelText}
			${dots}
		</svg>`;

	return `<div class="nw-chart-container" style="width:100%;position:relative;">${svg}${legend}<div class="nw-chart-tooltip" role="tooltip" aria-hidden="true"></div></div>`;
}

// ============================================================================
// Task 11: scatterToHistogram — 散点数据转直方图
// ============================================================================

/**
 * 直方图选项。
 */
export interface HistogramOptions {
	bins?: number;
	xAxisLabel?: string;
}

/**
 * 将散点数据转换为直方图数据（按 x 轴分桶统计数量）
 */
export function scatterToHistogram(
	points: ScatterDataPoint[],
	options: HistogramOptions = {}
): BarDataItem[] {
	const bins = options.bins || 10;

	if (points.length === 0) return [];

	const xValues = points.map(p => p.x);
	const xMin = Math.min(...xValues);
	const xMax = Math.max(...xValues);

	if (xMax === xMin) {
		return [{
			label: `${xMin.toFixed(1)}`,
			value: points.length
		}];
	}

	const binWidth = (xMax - xMin) / bins;
	const counts: number[] = new Array(bins).fill(0);

	for (const p of points) {
		let binIndex = Math.floor((p.x - xMin) / binWidth);
		if (binIndex >= bins) binIndex = bins - 1;
		if (binIndex < 0) binIndex = 0;
		counts[binIndex]++;
	}

	const result: BarDataItem[] = [];
	for (let i = 0; i < bins; i++) {
		const binStart = xMin + i * binWidth;
		const binEnd = xMin + (i + 1) * binWidth;
		const label = bins <= 10
			? `${binStart.toFixed(0)}-${binEnd.toFixed(0)}`
			: `${binStart.toFixed(1)}`;
		result.push({
			label,
			value: counts[i]
		});
	}

	return result;
}

// ============================================================================
// Task 8/9: timelineChart（响应式 + 交互）
// ============================================================================

/**
 * 渲染时间线图。
 *
 * @param events - 参数
 * @param options - 参数
 * @returns SVG 字符串
 */
export function timelineChart(events: TimelineEvent[], options: TimelineChartOptions = {}): string {
	const width = options.width || 500;
	const height = options.height || 140;
	const title = options.title;
	const showLabels = options.showLabels !== false;
	const _orientation = options.orientation || 'horizontal';

	if (events.length === 0) {
		return `<div class="nw-chart-container" style="width:100%;color:var(--text-muted);">暂无事件</div>`;
	}

	const padding = { top: 30, right: 20, bottom: 30, left: 20 };
	const titleSvg = title ? renderTitle(title, width) : '';

	const types = [...new Set(events.filter(e => e.type).map(e => e.type!))];
	const typeColorMap: Record<string, string> = {};
	types.forEach((type, i) => {
		typeColorMap[type] = DEFAULT_COLORS[i % DEFAULT_COLORS.length];
	});

	const sortedEvents = [...events].sort((a, b) => a.position - b.position);
	const chartWidth = width - padding.left - padding.right;
	const labelFontSize = 11;
	const charWidth = 7;
	const minGap = 8;

	const eventsWithLayout = sortedEvents.map((event, idx) => {
		const x = padding.left + event.position * chartWidth;
		const displayLabel = truncateText(event.label, 12);
		const labelWidth = Math.max(40, displayLabel.length * charWidth);
		const color = event.type ? typeColorMap[event.type] : 'var(--interactive-accent)';
		return {
			event,
			idx,
			x,
			color,
			displayLabel,
			labelWidth,
			autoLevel: 0,
			side: 0
		};
	});

	if (showLabels) {
		const upperLevels: { endX: number }[][] = [[]];
		const lowerLevels: { endX: number }[][] = [[]];
		let useUpper = true;

		for (const item of eventsWithLayout) {
			const halfW = item.labelWidth / 2;
			const startX = item.x - halfW - minGap;
			const endX = item.x + halfW + minGap;

			let placed = false;
			const levels = useUpper ? upperLevels : lowerLevels;
			for (let lv = 0; lv < levels.length; lv++) {
				const levelItems = levels[lv];
				const overlap = levelItems.some(p => p.endX > startX);
				if (!overlap) {
					item.autoLevel = lv;
					item.side = useUpper ? 0 : 1;
					levelItems.push({ endX });
					placed = true;
					break;
				}
			}
			if (!placed) {
				item.autoLevel = levels.length;
				item.side = useUpper ? 0 : 1;
				levels.push([{ endX }]);
			}
			useUpper = !useUpper;
		}

		const maxUpperLevel = upperLevels.length - 1;
		const maxLowerLevel = lowerLevels.length - 1;
		const levelHeight = 24;
		const baseOffset = 20;

		for (const item of eventsWithLayout) {
			(item as any).maxUpperLevel = maxUpperLevel;
			(item as any).maxLowerLevel = maxLowerLevel;
			(item as any).levelHeight = levelHeight;
			(item as any).baseOffset = baseOffset;
		}
	}

	const firstItem = eventsWithLayout[0] as any;
	const maxUpper = firstItem?.maxUpperLevel ?? 0;
	const maxLower = firstItem?.maxLowerLevel ?? 0;
	const levelHeight = firstItem?.levelHeight ?? 24;
	const baseOffset = firstItem?.baseOffset ?? 20;

	const topSpace = showLabels ? baseOffset + (maxUpper + 1) * levelHeight + 10 : 0;
	const bottomSpace = showLabels ? baseOffset + (maxLower + 1) * levelHeight + 10 : 0;
	const totalExtra = topSpace + bottomSpace;
	const adjustedHeight = Math.max(height, padding.top + padding.bottom + 40 + totalExtra);

	const lineY = padding.top + topSpace + 20;

	const baseLine = `<line x1="${padding.left}" y1="${lineY}" x2="${width - padding.right}" y2="${lineY}" stroke="var(--background-modifier-border)" stroke-width="2"/>`;

	let eventDots = '';
	let eventLabels = '';

	for (const item of eventsWithLayout) {
		const { event, x, color, displayLabel, autoLevel, side } = item;

		eventDots += `
			<circle class="nw-chart-timeline-node" data-label="${escapeHtml(event.label)}" data-type="${escapeHtml(event.type || '')}" data-date="${escapeHtml(event.date || '')}" data-value="${event.position}" cx="${x}" cy="${lineY}" r="6" fill="${color}" stroke="var(--background-primary)" stroke-width="2"/>
		`;

		if (showLabels) {
			const isUpper = side === 0;
			const labelY = isUpper
				? lineY - baseOffset - autoLevel * levelHeight
				: lineY + baseOffset + autoLevel * levelHeight + labelFontSize * 0.3;
			const lineEndY = isUpper ? labelY + 8 : labelY - 8;
			const lineStartY = isUpper ? lineY - 8 : lineY + 8;

			eventLabels += `
				<line x1="${x}" y1="${lineStartY}" x2="${x}" y2="${lineEndY}" stroke="${color}" stroke-width="1"/>
				<text x="${x}" y="${labelY}" text-anchor="middle" fill="var(--text-normal)" font-size="11">
					${escapeHtml(displayLabel)}
				</text>
			`;

			if (event.description) {
				const descY = isUpper ? labelY - 12 : labelY + 12;
				eventLabels += `
					<text x="${x}" y="${descY}" text-anchor="middle" fill="var(--text-muted)" font-size="10">
						${escapeHtml(event.description)}
					</text>
				`;
			}
		}
	}

	return `<div class="nw-chart-container" style="width:100%;position:relative;">
		<svg class="nw-chart-svg" width="100%" height="100%" viewBox="0 0 ${width} ${adjustedHeight}" preserveAspectRatio="xMidYMid meet" style="display:block;max-width:100%;">
			${titleSvg}
			${baseLine}
			${eventDots}
			${eventLabels}
		</svg>
		<div class="nw-chart-tooltip" role="tooltip" aria-hidden="true"></div>
	</div>`;
}

// ============================================================================
// Task 10: 新增图表类型 — heatmap / treeChart / areaChart
// ============================================================================

// ---------- heatmap ----------
/**
 * 热力图单元。
 */
export interface HeatmapCell {
	row: string;
	col: string;
	value: number;
}

/**
 * 热力图选项。
 */
export interface HeatmapOptions {
	title?: string;
	colorScale?: string[];
	width?: number;
	height?: number;
}

/**
 * 渲染热力图。
 *
 * @param data - 参数
 * @param options - 参数
 * @returns SVG 字符串
 */
export function heatmap(data: HeatmapCell[], options: HeatmapOptions = {}): string {
	const title = options.title;
	const colorScale = options.colorScale || ['#dbeafe', '#93c5fd', '#3b82f6', '#1d4ed8'];
	const width = options.width || 500;
	const height = options.height || 320;

	if (data.length === 0) {
		return `<div class="nw-chart-container" style="width:100%;color:var(--text-muted);">暂无数据</div>`;
	}

	const rows = [...new Set(data.map(d => d.row))];
	const cols = [...new Set(data.map(d => d.col))];
	const values = data.map(d => d.value);
	const maxValue = Math.max(...values);
	const minValue = Math.min(...values);
	const valueRange = maxValue - minValue || 1;

	const manyCols = cols.length > 10;
	const rotateAngle = manyCols ? -45 : -30;
	const bottomPadding = manyCols ? 80 : 65;
	const leftPadding = Math.max(60, Math.min(120, 8 + rows.reduce((m, r) => Math.max(m, r.length * 7), 0)));
	const padding = { top: 35, right: 20, bottom: bottomPadding, left: leftPadding };
	const cellWidth = (width - padding.left - padding.right) / cols.length;
	const cellHeight = (height - padding.top - padding.bottom) / rows.length;
	const titleSvg = renderTitle(title, width);

	function getColor(value: number): string {
		const t = (value - minValue) / valueRange;
		const idx = Math.min(colorScale.length - 1, Math.floor(t * colorScale.length));
		return colorScale[idx];
	}

	let cells = '';
	data.forEach(d => {
		const rowIdx = rows.indexOf(d.row);
		const colIdx = cols.indexOf(d.col);
		if (rowIdx < 0 || colIdx < 0) return;
		const x = padding.left + colIdx * cellWidth;
		const y = padding.top + rowIdx * cellHeight;
		cells += `<rect class="nw-chart-heatmap-cell" data-label="${escapeHtml(d.row)} / ${escapeHtml(d.col)}" data-value="${d.value}" data-row="${escapeHtml(d.row)}" data-col="${escapeHtml(d.col)}" x="${x + 1}" y="${y + 1}" width="${Math.max(0, cellWidth - 2)}" height="${Math.max(0, cellHeight - 2)}" fill="${getColor(d.value)}" rx="2"/>`;
	});

	let rowLabels = '';
	rows.forEach((r, i) => {
		const displayLabel = truncateText(r, 8);
		rowLabels += `<text x="${padding.left - 8}" y="${padding.top + i * cellHeight + cellHeight / 2}" text-anchor="end" dominant-baseline="middle" fill="var(--text-normal)" font-size="11">${escapeHtml(displayLabel)}</text>`;
	});

	let colLabels = '';
	cols.forEach((c, i) => {
		const x = padding.left + i * cellWidth + cellWidth / 2;
		const y = height - padding.bottom + 8;
		const displayLabel = truncateText(c, 8);
		colLabels += `<text x="${x}" y="${y}" text-anchor="end" fill="var(--text-normal)" font-size="11" transform="rotate(${rotateAngle} ${x} ${y})">${escapeHtml(displayLabel)}</text>`;
	});

	const legendX = padding.left;
	const legendY = height - 18;
	const legendW = 100;
	const legendH = 8;
	let legendStops = '';
	colorScale.forEach((c, i) => {
		const offset = (i / (colorScale.length - 1)) * 100;
		legendStops += `<stop offset="${offset}%" stop-color="${c}"/>`;
	});
	const legend = `
		<defs>
			<linearGradient id="nw-heatmap-legend" x1="0" y1="0" x2="1" y2="0">
				${legendStops}
			</linearGradient>
		</defs>
		<rect x="${legendX}" y="${legendY}" width="${legendW}" height="${legendH}" fill="url(#nw-heatmap-legend)"/>
		<text x="${legendX}" y="${legendY - 4}" fill="var(--text-muted)" font-size="10">${minValue}</text>
		<text x="${legendX + legendW}" y="${legendY - 4}" text-anchor="end" fill="var(--text-muted)" font-size="10">${maxValue}</text>
	`;

	return `<div class="nw-chart-container" style="width:100%;position:relative;">
		<svg class="nw-chart-svg" width="100%" height="100%" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" style="display:block;max-width:100%;">
			${titleSvg}
			${cells}
			${rowLabels}
			${colLabels}
			${legend}
		</svg>
		<div class="nw-chart-tooltip" role="tooltip" aria-hidden="true"></div>
	</div>`;
}

// ---------- treeChart ----------
/**
 * 树图节点。
 */
export interface TreeNode {
	name: string;
	children?: TreeNode[];
	value?: number;
}

/**
 * 树图选项。
 */
export interface TreeOptions {
	title?: string;
	orientation?: 'horizontal' | 'vertical';
	width?: number;
	height?: number;
}

interface LayoutNode {
	node: TreeNode;
	x: number;
	y: number;
	depth: number;
	parent?: LayoutNode;
	children: LayoutNode[];
}

/**
 * 渲染树图。
 *
 * @param root - 参数
 * @param options - 参数
 * @returns SVG 字符串
 */
export function treeChart(root: TreeNode, options: TreeOptions = {}): string {
	const title = options.title;
	const orientation = options.orientation || 'vertical';
	const width = options.width || 500;
	const height = options.height || 320;

	if (!root) {
		return `<div class="nw-chart-container" style="width:100%;color:var(--text-muted);">暂无数据</div>`;
	}

	const padding = { top: 40, right: 40, bottom: 40, left: 40 };
	const titleSvg = renderTitle(title, width);

	// 计算最大深度和叶子数
	let maxDepth = 0;
	let leafCount = 0;
	function walk(node: TreeNode, depth: number) {
		maxDepth = Math.max(maxDepth, depth);
		if (!node.children || node.children.length === 0) {
			leafCount++;
		} else {
			node.children.forEach(c => walk(c, depth + 1));
		}
	}
	walk(root, 0);
	maxDepth = Math.max(maxDepth, 1);
	leafCount = Math.max(leafCount, 1);

	const chartWidth = width - padding.left - padding.right;
	const chartHeight = height - padding.top - padding.bottom;

	// 简化 dendrogram 布局：递归分配叶子位置
	let leafIdx = 0;
	function layout(node: TreeNode, depth: number, parent?: LayoutNode): LayoutNode {
		const ln: LayoutNode = { node, x: 0, y: 0, depth, parent, children: [] };
		if (!node.children || node.children.length === 0) {
			if (orientation === 'vertical') {
				ln.x = padding.left + (leafIdx + 0.5) / leafCount * chartWidth;
				ln.y = padding.top + (depth / maxDepth) * chartHeight;
			} else {
				ln.y = padding.top + (leafIdx + 0.5) / leafCount * chartHeight;
				ln.x = padding.left + (depth / maxDepth) * chartWidth;
			}
			leafIdx++;
		} else {
			node.children.forEach(c => {
				const child = layout(c, depth + 1, ln);
				ln.children.push(child);
			});
			// 内部节点位置 = 子节点位置中点
			if (ln.children.length > 0) {
				ln.x = ln.children.reduce((s, c) => s + c.x, 0) / ln.children.length;
				ln.y = ln.children.reduce((s, c) => s + c.y, 0) / ln.children.length;
			}
		}
		return ln;
	}

	const layoutRoot = layout(root, 0);

	// 收集所有节点和边
	const allNodes: LayoutNode[] = [];
	const allEdges: { from: LayoutNode; to: LayoutNode }[] = [];
	function collect(ln: LayoutNode) {
		allNodes.push(ln);
		ln.children.forEach(c => {
			allEdges.push({ from: ln, to: c });
			collect(c);
		});
	}
	collect(layoutRoot);

	// 边路径（L 型连接）
	let edges = '';
	allEdges.forEach(e => {
		if (orientation === 'vertical') {
			edges += `<path d="M ${e.from.x} ${e.from.y} L ${e.from.x} ${e.to.y} L ${e.to.x} ${e.to.y}" fill="none" stroke="var(--background-modifier-border)" stroke-width="1"/>`;
		} else {
			edges += `<path d="M ${e.from.x} ${e.from.y} L ${e.to.x} ${e.from.y} L ${e.to.x} ${e.to.y}" fill="none" stroke="var(--background-modifier-border)" stroke-width="1"/>`;
		}
	});

	// 节点
	let nodes = '';
	allNodes.forEach(ln => {
		const hasChildren = ln.children.length > 0;
		const r = hasChildren ? 6 : 4;
		const fill = hasChildren ? 'var(--interactive-accent)' : 'var(--text-muted)';
		const cls = hasChildren ? 'nw-chart-tree-node nw-chart-tree-branch' : 'nw-chart-tree-node nw-chart-tree-leaf';
		const collapsedAttr = hasChildren ? 'data-collapsed="false"' : '';
		nodes += `<circle class="${cls}" data-label="${escapeHtml(ln.node.name)}" data-value="${ln.node.value ?? ''}" ${collapsedAttr} cx="${ln.x}" cy="${ln.y}" r="${r}" fill="${fill}" stroke="var(--background-primary)" stroke-width="2" style="cursor:${hasChildren ? 'pointer' : 'default'};"/>`;

		// 文本
		const labelOffsetX = orientation === 'vertical' ? 0 : (hasChildren ? -10 : 10);
		const labelOffsetY = orientation === 'vertical' ? (ln.depth === 0 ? -16 : 18) : 4;
		const anchor = orientation === 'vertical' ? 'middle' : (hasChildren ? 'end' : 'start');
		nodes += `<text x="${ln.x + labelOffsetX}" y="${ln.y + labelOffsetY}" text-anchor="${anchor}" dominant-baseline="middle" fill="var(--text-normal)" font-size="11">${escapeHtml(ln.node.name)}</text>`;
	});

	return `<div class="nw-chart-container" style="width:100%;position:relative;">
		<svg class="nw-chart-svg" width="100%" height="100%" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" style="display:block;max-width:100%;">
			${titleSvg}
			${edges}
			${nodes}
		</svg>
		<div class="nw-chart-tooltip" role="tooltip" aria-hidden="true"></div>
	</div>`;
}

// ---------- areaChart ----------
/**
 * 面积图序列。
 */
export interface AreaSeries {
	label: string;
	points: { x: number; y: number }[];
	color?: string;
}

/**
 * 面积图选项。
 */
export interface AreaOptions {
	title?: string;
	smooth?: boolean;
	showGrid?: boolean;
	width?: number;
	height?: number;
	xAxisLabel?: string;
	yAxisLabel?: string;
}

/**
 * 渲染面积图。
 *
 * @param series - 参数
 * @param options - 参数
 * @returns SVG 字符串
 */
export function areaChart(series: AreaSeries[], options: AreaOptions = {}): string {
	const width = options.width || 400;
	const height = options.height || 250;
	const title = options.title;
	const smooth = options.smooth || false;
	const showGrid = options.showGrid !== false;

	if (series.length === 0 || series.every(s => s.points.length === 0)) {
		return `<div class="nw-chart-container" style="width:100%;color:var(--text-muted);">暂无数据</div>`;
	}

	const padding = { top: 40, right: 20, bottom: 50, left: 50 };
	const chartWidth = width - padding.left - padding.right;
	const chartHeight = height - padding.top - padding.bottom;
	const titleSvg = renderTitle(title, width);

	const allPoints = series.flatMap(s => s.points);
	const xValues = allPoints.map(p => p.x);
	const yValues = allPoints.map(p => p.y);
	const xMax = Math.max(...xValues, 1);
	const xMin = Math.min(...xValues, 0);
	const yMax = Math.max(...yValues, 1);
	const yMin = Math.min(...yValues, 0);
	const xRange = xMax - xMin || 1;
	const yRange = yMax - yMin || 1;

	function getX(x: number): number {
		return padding.left + ((x - xMin) / xRange) * chartWidth;
	}
	function getY(y: number): number {
		return padding.top + chartHeight - ((y - yMin) / yRange) * chartHeight;
	}

	let gridLines = '';
	if (showGrid) {
		const tickCount = 5;
		for (let i = 0; i <= tickCount; i++) {
			const y = padding.top + (i / tickCount) * chartHeight;
			const value = +(yMax - (i / tickCount) * yRange).toFixed(2);
			gridLines += `<line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="var(--background-modifier-border)" stroke-width="1" stroke-dasharray="3,3"/>`;
			gridLines += `<text x="${padding.left - 5}" y="${y}" text-anchor="end" dominant-baseline="middle" fill="var(--text-muted)" font-size="11">${value}</text>`;
		}
		for (let i = 0; i <= tickCount; i++) {
			const x = padding.left + (i / tickCount) * chartWidth;
			const value = +(xMin + (i / tickCount) * xRange).toFixed(2);
			gridLines += `<line x1="${x}" y1="${padding.top}" x2="${x}" y2="${height - padding.bottom}" stroke="var(--background-modifier-border)" stroke-width="1" stroke-dasharray="3,3"/>`;
			gridLines += `<text x="${x}" y="${height - padding.bottom + 15}" text-anchor="middle" fill="var(--text-muted)" font-size="11">${value}</text>`;
		}
	}

	const xAxisLine = `<line x1="${padding.left}" y1="${height - padding.bottom}" x2="${width - padding.right}" y2="${height - padding.bottom}" stroke="var(--background-modifier-border)" stroke-width="1"/>`;
	const yAxisLine = `<line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${height - padding.bottom}" stroke="var(--background-modifier-border)" stroke-width="1"/>`;

	let xAxisLabelText = '';
	if (options.xAxisLabel) {
		xAxisLabelText = `<text x="${width / 2}" y="${height - 10}" text-anchor="middle" fill="var(--text-normal)" font-size="12">${escapeHtml(options.xAxisLabel)}</text>`;
	}
	let yAxisLabelText = '';
	if (options.yAxisLabel) {
		yAxisLabelText = `<text x="12" y="${height / 2}" text-anchor="middle" dominant-baseline="middle" fill="var(--text-normal)" font-size="12" transform="rotate(-90, 12, ${height / 2})">${escapeHtml(options.yAxisLabel)}</text>`;
	}

	function generateSmoothPath(points: { x: number; y: number }[]): string {
		if (points.length < 2) return '';
		let path = `M ${points[0].x} ${points[0].y}`;
		for (let i = 0; i < points.length - 1; i++) {
			const p0 = points[i - 1] || points[i];
			const p1 = points[i];
			const p2 = points[i + 1];
			const p3 = points[i + 2] || p2;
			const cp1x = p1.x + (p2.x - p0.x) / 6;
			const cp1y = p1.y + (p2.y - p0.y) / 6;
			const cp2x = p2.x - (p3.x - p1.x) / 6;
			const cp2y = p2.y - (p3.y - p1.y) / 6;
			path += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
		}
		return path;
	}
	function generateLinePath(points: { x: number; y: number }[]): string {
		if (points.length < 2) return '';
		return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
	}

	const seriesColors = series.map((s, i) => s.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length]);

	let defs = '<defs>';
	let areas = '';
	let lines = '';
	let dataPoints = '';

	series.forEach((s, seriesIndex) => {
		const color = seriesColors[seriesIndex];
		const points = s.points.map(p => ({ x: getX(p.x), y: getY(p.y) }));
		const linePath = smooth ? generateSmoothPath(points) : generateLinePath(points);

		// 渐变定义
		const gradId = `nw-area-grad-${seriesIndex}`;
		defs += `<linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
			<stop offset="0%" stop-color="${color}" stop-opacity="0.4"/>
			<stop offset="100%" stop-color="${color}" stop-opacity="0.05"/>
		</linearGradient>`;

		// 面积路径（闭合到底部）
		if (points.length > 0) {
			const baselineY = height - padding.bottom;
			const firstX = points[0].x;
			const lastX = points[points.length - 1].x;
			const areaPath = `${linePath} L ${lastX} ${baselineY} L ${firstX} ${baselineY} Z`;
			areas += `<path d="${areaPath}" fill="url(#${gradId})"/>`;
		}

		lines += `<path class="nw-chart-line-path" data-series="${escapeHtml(s.label)}" d="${linePath}" fill="none" stroke="${color}" stroke-width="2"/>`;

		s.points.forEach((p, i) => {
			const x = getX(p.x);
			const y = getY(p.y);
			dataPoints += `<circle class="nw-chart-area-point" data-label="${escapeHtml(s.label)}" data-x="${p.x}" data-y="${p.y}" data-series="${escapeHtml(s.label)}" data-value="${p.y}" cx="${x}" cy="${y}" r="3" fill="${color}" stroke="var(--background-primary)" stroke-width="1.5"/>`;
		});
	});
	defs += '</defs>';

	let legend = '';
	if (series.length > 1) {
		const legendItems = series.map((s, i) => `
			<div class="nw-chart-legend-item" data-series="${escapeHtml(s.label)}" style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-normal);cursor:pointer;">
				<span style="width:12px;height:12px;border-radius:2px;background:${seriesColors[i]};flex-shrink:0;"></span>
				<span>${escapeHtml(s.label)}</span>
			</div>
		`).join('');
		legend = `<div class="nw-chart-legend" style="display:flex;flex-wrap:wrap;gap:12px;justify-content:center;margin-top:8px;">${legendItems}</div>`;
	}

	const svg = `<svg class="nw-chart-svg" width="100%" height="100%" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" style="display:block;max-width:100%;">
			${titleSvg}
			${defs}
			${gridLines}
			${xAxisLine}
			${yAxisLine}
			${xAxisLabelText}
			${yAxisLabelText}
			${areas}
			${lines}
			${dataPoints}
		</svg>`;

	return `<div class="nw-chart-container" style="width:100%;position:relative;">${svg}${legend}<div class="nw-chart-tooltip" role="tooltip" aria-hidden="true"></div></div>`;
}

// ============================================================================
// Task 9: 新增图表类型 — densityHeatmap / horizontalBarChart / violinChart
// ============================================================================

// ---------- densityHeatmap ----------
/**
 * 密度热力点。
 */
export interface DensityPoint {
	x: number;
	y: number;
	value?: number;
}

/**
 * 密度热力图选项。
 */
export interface DensityHeatmapOptions {
	title?: string;
	colorScale?: string[];
	width?: number;
	height?: number;
	gridCols?: number;
	gridRows?: number;
	bandwidth?: number;
}

/**
 * 渲染密度热力图。
 *
 * @param points - 参数
 * @param options - 参数
 * @returns SVG 字符串
 */
export function densityHeatmap(points: DensityPoint[], options: DensityHeatmapOptions = {}): string {
	const title = options.title;
	const width = options.width || 500;
	const height = options.height || 320;
	const gridCols = options.gridCols || 30;
	const gridRows = options.gridRows || 20;
	const colorScale = options.colorScale || ['#dbeafe', '#93c5fd', '#60a5fa', '#3b82f6', '#1d4ed8'];

	if (points.length === 0) {
		return `<div class="nw-chart-container" style="width:100%;color:var(--text-muted);">暂无数据</div>`;
	}

	const padding = { top: 35, right: 30, bottom: 45, left: 50 };
	const chartWidth = width - padding.left - padding.right;
	const chartHeight = height - padding.top - padding.bottom;
	const titleSvg = renderTitle(title, width);

	const xValues = points.map(p => p.x);
	const yValues = points.map(p => p.y);
	let xMin = Math.min(...xValues);
	let xMax = Math.max(...xValues);
	let yMin = Math.min(...yValues);
	let yMax = Math.max(...yValues);

	if (xMax === xMin) { xMax = xMin + 1; }
	if (yMax === yMin) { yMax = yMin + 1; }

	const xRange = xMax - xMin;
	const yRange = yMax - yMin;

	const bwX = options.bandwidth ?? xRange * 0.08;
	const bwY = options.bandwidth ?? yRange * 0.08;
	const cellW = chartWidth / gridCols;
	const cellH = chartHeight / gridRows;

	const grid: number[][] = [];
	let maxDensity = 0;

	for (let row = 0; row < gridRows; row++) {
		grid[row] = [];
		for (let col = 0; col < gridCols; col++) {
			const cx = xMin + (col + 0.5) / gridCols * xRange;
			const cy = yMin + (row + 0.5) / gridRows * yRange;
			let density = 0;
			for (const p of points) {
				const dx = (cx - p.x) / bwX;
				const dy = (cy - p.y) / bwY;
				const w = p.value ?? 1;
				density += w * Math.exp(-0.5 * (dx * dx + dy * dy));
			}
			density /= (2 * Math.PI * bwX * bwY * points.length);
			grid[row][col] = density;
			if (density > maxDensity) maxDensity = density;
		}
	}

	const densityRange = maxDensity || 1;

	function getColor(d: number): string {
		const t = maxDensity > 0 ? d / densityRange : 0;
		const idx = Math.min(colorScale.length - 1, Math.floor(t * colorScale.length));
		return colorScale[Math.max(0, idx)];
	}

	let cells = '';
	for (let row = 0; row < gridRows; row++) {
		for (let col = 0; col < gridCols; col++) {
			const d = grid[row][col];
			const x = padding.left + col * cellW;
			const y = padding.top + row * cellH;
			const cxVal = xMin + (col + 0.5) / gridCols * xRange;
			const cyVal = yMin + (row + 0.5) / gridRows * yRange;
			const count = points.filter(p =>
				Math.abs(p.x - cxVal) < xRange / gridCols &&
				Math.abs(p.y - cyVal) < yRange / gridRows
			).length;
			cells += `<rect class="nw-chart-density-cell" data-label="密度区域" data-value="${d.toFixed(4)}" data-x="${cxVal.toFixed(2)}" data-y="${cyVal.toFixed(2)}" data-count="${count}" x="${x}" y="${y}" width="${cellW + 0.5}" height="${cellH + 0.5}" fill="${getColor(d)}"/>`;
		}
	}

	const tickCount = 5;
	let gridLines = '';
	for (let i = 0; i <= tickCount; i++) {
		const y = padding.top + (i / tickCount) * chartHeight;
		const val = +(yMax - (i / tickCount) * yRange).toFixed(2);
		gridLines += `<line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="var(--background-modifier-border)" stroke-width="0.5" stroke-dasharray="2,2" opacity="0.5"/>`;
		gridLines += `<text x="${padding.left - 5}" y="${y}" text-anchor="end" dominant-baseline="middle" fill="var(--text-muted)" font-size="10">${val}</text>`;

		const x = padding.left + (i / tickCount) * chartWidth;
		const xVal = +(xMin + (i / tickCount) * xRange).toFixed(2);
		gridLines += `<line x1="${x}" y1="${padding.top}" x2="${x}" y2="${height - padding.bottom}" stroke="var(--background-modifier-border)" stroke-width="0.5" stroke-dasharray="2,2" opacity="0.5"/>`;
		gridLines += `<text x="${x}" y="${height - padding.bottom + 15}" text-anchor="middle" fill="var(--text-muted)" font-size="10">${xVal}</text>`;
	}

	const legendX = width - padding.right - 100;
	const legendY = height - 18;
	const legendW = 100;
	const legendH = 8;
	let legendStops = '';
	colorScale.forEach((c, i) => {
		const offset = (i / (colorScale.length - 1)) * 100;
		legendStops += `<stop offset="${offset}%" stop-color="${c}"/>`;
	});
	const legend = `
		<defs>
			<linearGradient id="nw-density-legend" x1="0" y1="0" x2="1" y2="0">
				${legendStops}
			</linearGradient>
		</defs>
		<rect x="${legendX}" y="${legendY}" width="${legendW}" height="${legendH}" fill="url(#nw-density-legend)" rx="2"/>
		<text x="${legendX}" y="${legendY - 4}" fill="var(--text-muted)" font-size="10">低</text>
		<text x="${legendX + legendW}" y="${legendY - 4}" text-anchor="end" fill="var(--text-muted)" font-size="10">高</text>
	`;

	const pointDots = points.slice(0, 50).map(p => {
		const px = padding.left + ((p.x - xMin) / xRange) * chartWidth;
		const py = padding.top + chartHeight - ((p.y - yMin) / yRange) * chartHeight;
		return `<circle cx="${px}" cy="${py}" r="2" fill="var(--text-normal)" fill-opacity="0.3"/>`;
	}).join('');

	return `<div class="nw-chart-container" style="width:100%;position:relative;">
		<svg class="nw-chart-svg" width="100%" height="100%" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" style="display:block;max-width:100%;">
			${titleSvg}
			${cells}
			${gridLines}
			${pointDots}
			${legend}
		</svg>
		<div class="nw-chart-tooltip" role="tooltip" aria-hidden="true"></div>
	</div>`;
}

// ---------- horizontalBarChart ----------
/**
 * 横向柱状图数据项。
 */
export interface HorizontalBarItem {
	label: string;
	value: number;
	color?: string;
}

/**
 * 横向柱状图选项。
 */
export interface HorizontalBarOptions {
	title?: string;
	width?: number;
	height?: number;
	sorted?: boolean;
}

/**
 * 渲染横向柱状图。
 *
 * @param data - 参数
 * @param options - 参数
 * @returns SVG 字符串
 */
export function horizontalBarChart(data: HorizontalBarItem[], options: HorizontalBarOptions = {}): string {
	const width = options.width || 450;
	const height = options.height || 300;
	const title = options.title;

	if (data.length === 0) {
		return `<div class="nw-chart-container" style="width:100%;color:var(--text-muted);">暂无数据</div>`;
	}

	const sortedData = options.sorted !== false
		? [...data].sort((a, b) => b.value - a.value)
		: data;

	const maxLabelLen = Math.max(...sortedData.map(d => d.label.length));
	const leftPadding = Math.max(80, Math.min(180, 20 + maxLabelLen * 7));
	const padding = { top: 35, right: 50, bottom: 30, left: leftPadding };
	const chartWidth = width - padding.left - padding.right;
	const chartHeight = height - padding.top - padding.bottom;
	const maxValue = Math.max(...sortedData.map(d => d.value), 1);
	const titleSvg = renderTitle(title, width);

	const barHeight = Math.min(28, Math.max(12, (chartHeight - 10) / sortedData.length - 8));
	const barGap = (chartHeight - barHeight * sortedData.length) / (sortedData.length + 1);

	const tickCount = 5;
	let gridLines = '';
	for (let i = 0; i <= tickCount; i++) {
		const x = padding.left + (i / tickCount) * chartWidth;
		const value = Math.round((i / tickCount) * maxValue * 100) / 100;
		gridLines += `<line x1="${x}" y1="${padding.top}" x2="${x}" y2="${height - padding.bottom}" stroke="var(--background-modifier-border)" stroke-width="1" stroke-dasharray="3,3"/>`;
		gridLines += `<text x="${x}" y="${height - padding.bottom + 15}" text-anchor="middle" fill="var(--text-muted)" font-size="11">${value}</text>`;
	}

	const yAxis = `<line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${height - padding.bottom}" stroke="var(--background-modifier-border)" stroke-width="1"/>`;

	const bars = sortedData.map((d, i) => {
		const y = padding.top + barGap + i * (barHeight + barGap);
		const barWidth = (d.value / maxValue) * chartWidth;
		const color = d.color || 'var(--interactive-accent)';
		const displayLabel = truncateText(d.label, 12);
		return `
			<rect class="nw-chart-hbar-rect" data-label="${escapeHtml(d.label)}" data-value="${d.value}" data-series="${escapeHtml(d.label)}" x="${padding.left}" y="${y}" width="${barWidth}" height="${barHeight}" fill="${color}" rx="3"/>
			<text x="${padding.left + barWidth + 5}" y="${y + barHeight / 2}" dominant-baseline="middle" fill="var(--text-normal)" font-size="11">${d.value}</text>
			<text x="${padding.left - 8}" y="${y + barHeight / 2}" text-anchor="end" dominant-baseline="middle" fill="var(--text-normal)" font-size="11">${escapeHtml(displayLabel)}</text>
		`;
	}).join('');

	return `<div class="nw-chart-container" style="width:100%;position:relative;">
		<svg class="nw-chart-svg" width="100%" height="100%" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" style="display:block;max-width:100%;">
			${titleSvg}
			${gridLines}
			${yAxis}
			${bars}
		</svg>
		<div class="nw-chart-tooltip" role="tooltip" aria-hidden="true"></div>
	</div>`;
}

// ---------- violinChart ----------
/**
 * 小提琴图数据项。
 */
export interface ViolinDataItem {
	label: string;
	values: number[];
	color?: string;
}

/**
 * 小提琴图选项。
 */
export interface ViolinChartOptions {
	title?: string;
	width?: number;
	height?: number;
	showBox?: boolean;
}

/**
 * 渲染小提琴图。
 *
 * @param data - 参数
 * @param options - 参数
 * @returns SVG 字符串
 */
export function violinChart(data: ViolinDataItem[], options: ViolinChartOptions = {}): string {
	const width = options.width || 480;
	const height = options.height || 320;
	const title = options.title;
	const showBox = options.showBox !== false;

	if (data.length === 0 || data.every(d => d.values.length === 0)) {
		return `<div class="nw-chart-container" style="width:100%;color:var(--text-muted);">暂无数据</div>`;
	}

	const maxLabelLen = Math.max(...data.map(d => d.label.length));
	const bottomPadding = Math.max(50, 30 + maxLabelLen * 6);
	const padding = { top: 35, right: 30, bottom: bottomPadding, left: 50 };
	const chartWidth = width - padding.left - padding.right;
	const chartHeight = height - padding.top - padding.bottom;
	const titleSvg = renderTitle(title, width);

	const allValues = data.flatMap(d => d.values);
	let yMin = Math.min(...allValues);
	let yMax = Math.max(...allValues);
	if (yMax === yMin) { yMax = yMin + 1; }
	const yRange = yMax - yMin;
	const yPadding = yRange * 0.05;
	yMin -= yPadding;
	yMax += yPadding;

	function getY(v: number): number {
		return padding.top + chartHeight - ((v - yMin) / (yMax - yMin)) * chartHeight;
	}

	const nGroups = data.length;
	const groupWidth = chartWidth / nGroups;
	const violinWidth = groupWidth * 0.7;

	let violins = '';
	let boxPlots = '';
	let xLabels = '';

	data.forEach((d, i) => {
		const cx = padding.left + i * groupWidth + groupWidth / 2;
		const color = d.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length];
		const values = d.values;
		const displayLabel = truncateText(d.label, 8);

		if (values.length === 0) {
			xLabels += `<text x="${cx}" y="${height - padding.bottom + 15}" text-anchor="middle" fill="var(--text-muted)" font-size="11">${escapeHtml(displayLabel)}</text>`;
			return;
		}

		const bw = silvermanBandwidth(values);
		const nPoints = 60;
		const yGrid: number[] = [];
		for (let p = 0; p <= nPoints; p++) {
			yGrid.push(yMin + (p / nPoints) * (yMax - yMin));
		}
		const densities = gaussianKDE(values, bw * 0.6, yGrid);
		const maxDens = Math.max(...densities, 1e-6);

		let path = '';
		const rightPoints: { x: number; y: number }[] = [];
		const leftPoints: { x: number; y: number }[] = [];

		for (let p = 0; p <= nPoints; p++) {
			const y = getY(yGrid[p]);
			const w = (densities[p] / maxDens) * (violinWidth / 2);
			rightPoints.push({ x: cx + w, y });
			leftPoints.unshift({ x: cx - w, y });
		}

		const allPts = [...rightPoints, ...leftPoints];
		path = allPts.map((pt, idx) => `${idx === 0 ? 'M' : 'L'} ${pt.x} ${pt.y}`).join(' ') + ' Z';

		violins += `<path class="nw-chart-violin" data-label="${escapeHtml(d.label)}" data-value="${values.length}" data-series="${escapeHtml(d.label)}" d="${path}" fill="${color}" fill-opacity="0.4" stroke="${color}" stroke-width="1.5"/>`;

		if (showBox) {
			const sorted = [...values].sort((a, b) => a - b);
			const n = sorted.length;
			const q1 = sorted[Math.floor(n * 0.25)];
			const median = sorted[Math.floor(n * 0.5)];
			const q3 = sorted[Math.floor(n * 0.75)];
			const minV = sorted[0];
			const maxV = sorted[n - 1];

			const boxW = violinWidth * 0.25;
			const boxY1 = getY(q3);
			const boxY2 = getY(q1);
			const medianY = getY(median);

			boxPlots += `
				<line x1="${cx}" y1="${getY(minV)}" x2="${cx}" y2="${getY(maxV)}" stroke="${color}" stroke-width="1.5"/>
				<rect x="${cx - boxW}" y="${boxY1}" width="${boxW * 2}" height="${boxY2 - boxY1}" fill="var(--background-primary)" stroke="${color}" stroke-width="1.5" rx="1"/>
				<line x1="${cx - boxW}" y1="${medianY}" x2="${cx + boxW}" y2="${medianY}" stroke="${color}" stroke-width="2"/>
				<circle class="nw-chart-violin-point" data-label="${escapeHtml(d.label)} 中位数" data-value="${median}" cx="${cx}" cy="${medianY}" r="3" fill="${color}" stroke="var(--background-primary)" stroke-width="1"/>
			`;
		}

		xLabels += `<text x="${cx}" y="${height - padding.bottom + 15}" text-anchor="middle" fill="var(--text-normal)" font-size="11">${escapeHtml(displayLabel)}</text>`;
	});

	const tickCount = 5;
	let gridLines = '';
	for (let i = 0; i <= tickCount; i++) {
		const y = padding.top + (i / tickCount) * chartHeight;
		const val = +(yMax - (i / tickCount) * (yMax - yMin)).toFixed(2);
		gridLines += `<line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="var(--background-modifier-border)" stroke-width="1" stroke-dasharray="3,3"/>`;
		gridLines += `<text x="${padding.left - 5}" y="${y}" text-anchor="end" dominant-baseline="middle" fill="var(--text-muted)" font-size="11">${val}</text>`;
	}

	const yAxis = `<line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${height - padding.bottom}" stroke="var(--background-modifier-border)" stroke-width="1"/>`;

	return `<div class="nw-chart-container" style="width:100%;position:relative;">
		<svg class="nw-chart-svg" width="100%" height="100%" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" style="display:block;max-width:100%;">
			${titleSvg}
			${gridLines}
			${yAxis}
			${violins}
			${boxPlots}
			${xLabels}
		</svg>
		<div class="nw-chart-tooltip" role="tooltip" aria-hidden="true"></div>
	</div>`;
}
