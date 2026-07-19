export interface RadarDataItem {
	label: string;
	value: number;
}

export interface RadarOptions {
	size?: number;
	title?: string;
}

export interface BarDataItem {
	label: string;
	value: number;
}

export interface BarOptions {
	width?: number;
	height?: number;
	title?: string;
	horizontal?: boolean;
}

export interface DonutDataItem {
	label: string;
	value: number;
	color?: string;
}

export interface DonutOptions {
	size?: number;
	title?: string;
}

export interface WordCloudItem {
	text: string;
	weight: number;
}

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
		.replace(/"/g, '&quot;');
}

function renderTitle(title: string | undefined, width: number): string {
	if (!title) return '';
	return `<text x="${width / 2}" y="20" text-anchor="middle" fill="var(--text-normal)" font-size="14" font-weight="600">${escapeHtml(title)}</text>`;
}

export function radarChart(data: RadarDataItem[], options: RadarOptions = {}): string {
	const size = options.size || 300;
	const title = options.title;
	const centerX = size / 2;
	const centerY = size / 2 + 10;
	const maxRadius = size / 2 - 50;
	const levels = 5;
	const n = data.length;

	if (n < 3) {
		return `<div style="width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;color:var(--text-muted);">雷达图至少需要3个数据维度</div>`;
	}

	const angleStep = (Math.PI * 2) / n;
	const startAngle = -Math.PI / 2;

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
		`<circle cx="${p.x}" cy="${p.y}" r="4" fill="var(--interactive-accent)" stroke="var(--background-primary)" stroke-width="2"/>`
	).join('');

	const labels = data.map((item, i) => {
		const angle = startAngle + i * angleStep;
		const labelRadius = maxRadius + 20;
		const x = centerX + labelRadius * Math.cos(angle);
		const y = centerY + labelRadius * Math.sin(angle);
		let anchor = 'middle';
		if (Math.cos(angle) > 0.3) anchor = 'start';
		else if (Math.cos(angle) < -0.3) anchor = 'end';
		return `<text x="${x}" y="${y}" text-anchor="${anchor}" dominant-baseline="middle" fill="var(--text-normal)" font-size="12">${escapeHtml(item.label)}</text>`;
	}).join('');

	const titleSvg = renderTitle(title, size);

	return `
		<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="display:block;">
			${titleSvg}
			${gridPolygons.join('')}
			${axisLines.join('')}
			<polygon points="${dataPolygonPoints}" fill="var(--interactive-accent)" fill-opacity="0.2" stroke="var(--interactive-accent)" stroke-width="2"/>
			${dataDots}
			${labels}
		</svg>
	`;
}

export function barChart(data: BarDataItem[], options: BarOptions = {}): string {
	const width = options.width || 400;
	const height = options.height || 250;
	const title = options.title;
	const horizontal = options.horizontal || false;

	if (data.length === 0) {
		return `<div style="width:${width}px;height:${height}px;display:flex;align-items:center;justify-content:center;color:var(--text-muted);">暂无数据</div>`;
	}

	const padding = { top: 40, right: 20, bottom: 40, left: 50 };
	const chartWidth = width - padding.left - padding.right;
	const chartHeight = height - padding.top - padding.bottom;
	const maxValue = Math.max(...data.map(d => d.value), 1);
	const titleSvg = renderTitle(title, width);

	if (horizontal) {
		const barHeight = Math.min(30, (chartHeight - 10) / data.length - 6);
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
			return `
				<rect x="${padding.left}" y="${y}" width="${barWidth}" height="${barHeight}" fill="var(--interactive-accent)" rx="3"/>
				<text x="${padding.left + barWidth + 5}" y="${y + barHeight / 2}" dominant-baseline="middle" fill="var(--text-normal)" font-size="11">${d.value}</text>
				<text x="${padding.left - 5}" y="${y + barHeight / 2}" text-anchor="end" dominant-baseline="middle" fill="var(--text-normal)" font-size="11">${escapeHtml(d.label)}</text>
			`;
		}).join('');

		return `
			<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="display:block;">
				${titleSvg}
				${gridLines.join('')}
				${yAxis}
				${bars}
			</svg>
		`;
	} else {
		const barWidth = Math.min(40, (chartWidth - 10) / data.length - 10);
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
			return `
				<rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" fill="var(--interactive-accent)" rx="3"/>
				<text x="${x + barWidth / 2}" y="${y - 5}" text-anchor="middle" fill="var(--text-normal)" font-size="11">${d.value}</text>
				<text x="${x + barWidth / 2}" y="${height - padding.bottom + 15}" text-anchor="middle" fill="var(--text-normal)" font-size="11">${escapeHtml(d.label)}</text>
			`;
		}).join('');

		return `
			<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="display:block;">
				${titleSvg}
				${gridLines.join('')}
				${xAxis}
				${bars}
			</svg>
		`;
	}
}

export function donutChart(data: DonutDataItem[], options: DonutOptions = {}): string {
	const size = options.size || 280;
	const title = options.title;
	const centerX = size / 2;
	const centerY = size / 2 + 10;
	const outerRadius = size / 2 - 50;
	const innerRadius = outerRadius * 0.6;

	if (data.length === 0) {
		return `<div style="width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;color:var(--text-muted);">暂无数据</div>`;
	}

	const total = data.reduce((sum, d) => sum + d.value, 0);

	if (total === 0) {
		return `<div style="width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;color:var(--text-muted);">数据总和为0</div>`;
	}

	const colors = data.map((d, i) => d.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length]);

	let startAngle = -Math.PI / 2;
	const arcs: string[] = [];

	data.forEach((d, i) => {
		const sliceAngle = (d.value / total) * Math.PI * 2;
		const endAngle = startAngle + sliceAngle;

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

		arcs.push(`<path d="${path.trim()}" fill="${colors[i]}" stroke="var(--background-primary)" stroke-width="2"/>`);

		startAngle = endAngle;
	});

	const legendItems = data.map((d, i) => {
		const percent = ((d.value / total) * 100).toFixed(1);
		return `
			<div style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-normal);">
				<span style="width:10px;height:10px;border-radius:2px;background:${colors[i]};flex-shrink:0;"></span>
				<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(d.label)}</span>
				<span style="color:var(--text-muted);">${percent}%</span>
			</div>
		`;
	}).join('');

	const titleSvg = renderTitle(title, size);

	return `
		<div style="display:flex;align-items:center;gap:16px;width:100%;">
			<svg width="${size * 0.6}" height="${size}" viewBox="0 0 ${size} ${size}" style="flex-shrink:0;">
				${titleSvg}
				${arcs.join('')}
				<text x="${centerX}" y="${centerY - 5}" text-anchor="middle" fill="var(--text-normal)" font-size="20" font-weight="600">${total}</text>
				<text x="${centerX}" y="${centerY + 15}" text-anchor="middle" fill="var(--text-muted)" font-size="11">总计</text>
			</svg>
			<div style="display:flex;flex-direction:column;gap:6px;flex:1;min-width:0;">
				${legendItems}
			</div>
		</div>
	`;
}

export interface LineChartDataPoint {
	label?: string;
	value: number;
	color?: string;
	annotation?: string;
}

export interface LineChartSeries {
	name: string;
	data: LineChartDataPoint[];
	color?: string;
	showPoints?: boolean;
	smooth?: boolean;
}

export interface LineChartOptions {
	width?: number;
	height?: number;
	title?: string;
	xAxisLabel?: string;
	yAxisLabel?: string;
	showGrid?: boolean;
	showLegend?: boolean;
}

export interface ScatterDataPoint {
	x: number;
	y: number;
	label?: string;
	category?: string;
	size?: number;
}

export interface ScatterChartOptions {
	width?: number;
	height?: number;
	title?: string;
	xAxisLabel?: string;
	yAxisLabel?: string;
	showGrid?: boolean;
	showLegend?: boolean;
}

export interface TimelineEvent {
	position: number;
	label: string;
	description?: string;
	type?: string;
	level?: number;
}

export interface TimelineChartOptions {
	width?: number;
	height?: number;
	title?: string;
	showLabels?: boolean;
	orientation?: 'horizontal' | 'vertical';
}

export function wordCloud(words: WordCloudItem[], options: WordCloudOptions = {}): string {
	const width = options.width || 400;
	const height = options.height || 200;
	const title = options.title;

	if (words.length === 0) {
		return `<div style="width:${width}px;height:${height}px;display:flex;align-items:center;justify-content:center;color:var(--text-muted);">暂无数据</div>`;
	}

	const sorted = [...words].sort((a, b) => b.weight - a.weight);
	const maxWeight = sorted[0].weight;
	const minWeight = sorted[sorted.length - 1].weight;
	const weightRange = maxWeight - minWeight || 1;

	const levels = 5;
	const levelColors = [
		'var(--interactive-accent)',
		'color-mix(in srgb, var(--interactive-accent) 80%, var(--text-normal))',
		'color-mix(in srgb, var(--interactive-accent) 60%, var(--text-normal))',
		'color-mix(in srgb, var(--interactive-accent) 40%, var(--text-normal))',
		'var(--text-muted)'
	];
	const levelSizes = [22, 18, 15, 13, 11];

	const wordSpans = sorted.map(w => {
		const normalized = (w.weight - minWeight) / weightRange;
		const level = Math.min(levels - 1, Math.floor((1 - normalized) * levels));
		const size = levelSizes[level];
		const color = levelColors[level];
		return `
			<span style="
				font-size:${size}px;
				color:${color};
				padding:2px 8px;
				display:inline-block;
				white-space:nowrap;
			">${escapeHtml(w.text)}</span>
		`;
	}).join('');

	const titleHtml = title
		? `<div style="text-align:center;font-size:14px;font-weight:600;color:var(--text-normal);margin-bottom:8px;">${escapeHtml(title)}</div>`
		: '';

	return `
		<div style="width:${width}px;">
			${titleHtml}
			<div style="
				width:${width}px;
				min-height:${height}px;
				display:flex;
				flex-wrap:wrap;
				align-items:center;
				justify-content:center;
				align-content:center;
				gap:4px;
				padding:12px;
				box-sizing:border-box;
				border:1px solid var(--background-modifier-border);
				border-radius:6px;
			;">
				${wordSpans}
			</div>
		</div>
	`;
}

export function lineChart(series: LineChartSeries[], options: LineChartOptions = {}): string {
	const width = options.width || 400;
	const height = options.height || 250;
	const title = options.title;
	const xAxisLabel = options.xAxisLabel;
	const yAxisLabel = options.yAxisLabel;
	const showGrid = options.showGrid !== false;
	const showLegend = options.showLegend !== false;

	if (series.length === 0 || series.every(s => s.data.length === 0)) {
		return `<div style="width:${width}px;height:${height}px;display:flex;align-items:center;justify-content:center;color:var(--text-muted);">暂无数据</div>`;
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
		lines += `<path d="${path}" fill="none" stroke="${color}" stroke-width="2"/>`;

		if (s.showPoints !== false) {
			s.data.forEach((d, i) => {
				const x = getX(i);
				const y = getY(d.value);
				const pointColor = d.color || color;
				dataPoints += `<circle cx="${x}" cy="${y}" r="4" fill="${pointColor}" stroke="var(--background-primary)" stroke-width="2"/>`;

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
			<div style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-normal);">
				<span style="width:16px;height:2px;background:${seriesColors[i]};flex-shrink:0;"></span>
				<span>${escapeHtml(s.name)}</span>
			</div>
		`).join('');
		legend = `
			<div style="display:flex;flex-wrap:wrap;gap:12px;justify-content:center;margin-top:8px;">
				${legendItems}
			</div>
		`;
	}

	const svg = `
		<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="display:block;">
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
		</svg>
	`;

	if (legend) {
		return `<div style="width:${width}px;">${svg}${legend}</div>`;
	}
	return svg;
}

export function scatterChart(points: ScatterDataPoint[], options: ScatterChartOptions = {}): string {
	const width = options.width || 400;
	const height = options.height || 250;
	const title = options.title;
	const xAxisLabel = options.xAxisLabel;
	const yAxisLabel = options.yAxisLabel;
	const showGrid = options.showGrid !== false;
	const showLegend = options.showLegend !== false;

	if (points.length === 0) {
		return `<div style="width:${width}px;height:${height}px;display:flex;align-items:center;justify-content:center;color:var(--text-muted);">暂无数据</div>`;
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
		const titleText = p.label ? `<title>${escapeHtml(p.label)} (${p.x}, ${p.y})</title>` : `<title>(${p.x}, ${p.y})</title>`;
		dots += `
			<circle cx="${x}" cy="${y}" r="${size}" fill="${color}" fill-opacity="0.7" stroke="var(--background-primary)" stroke-width="1.5">
				${titleText}
			</circle>
		`;
	});

	let legend = '';
	if (showLegend && categories.length > 0) {
		const legendItems = categories.map(cat => `
			<div style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-normal);">
				<span style="width:12px;height:12px;border-radius:50%;background:${categoryColorMap[cat]};flex-shrink:0;"></span>
				<span>${escapeHtml(cat)}</span>
			</div>
		`).join('');
		legend = `
			<div style="display:flex;flex-wrap:wrap;gap:12px;justify-content:center;margin-top:8px;">
				${legendItems}
			</div>
		`;
	}

	const svg = `
		<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="display:block;">
			${titleSvg}
			${gridLines}
			${xAxisLine}
			${yAxisLine}
			${xAxisLabelText}
			${yAxisLabelText}
			${dots}
		</svg>
	`;

	if (legend) {
		return `<div style="width:${width}px;">${svg}${legend}</div>`;
	}
	return svg;
}

export function timelineChart(events: TimelineEvent[], options: TimelineChartOptions = {}): string {
	const width = options.width || 500;
	const height = options.height || 120;
	const title = options.title;
	const showLabels = options.showLabels !== false;
	const orientation = options.orientation || 'horizontal';

	if (events.length === 0) {
		return `<div style="width:${width}px;height:${height}px;display:flex;align-items:center;justify-content:center;color:var(--text-muted);">暂无事件</div>`;
	}

	const padding = { top: 30, right: 20, bottom: 30, left: 20 };
	const titleSvg = title ? renderTitle(title, width) : '';

	const types = [...new Set(events.filter(e => e.type).map(e => e.type!))];
	const typeColorMap: Record<string, string> = {};
	types.forEach((type, i) => {
		typeColorMap[type] = DEFAULT_COLORS[i % DEFAULT_COLORS.length];
	});

	const sortedEvents = [...events].sort((a, b) => a.position - b.position);
	const maxLevel = Math.max(...events.map(e => e.level || 0), 0);
	const levelHeight = 30;
	const totalHeightForLevels = (maxLevel + 1) * levelHeight;

	const adjustedHeight = Math.max(height, padding.top + padding.bottom + totalHeightForLevels + 20);

	const chartWidth = width - padding.left - padding.right;
	const lineY = adjustedHeight / 2;

	const baseLine = `<line x1="${padding.left}" y1="${lineY}" x2="${width - padding.right}" y2="${lineY}" stroke="var(--background-modifier-border)" stroke-width="2"/>`;

	let eventDots = '';
	let eventLabels = '';

	sortedEvents.forEach((event, i) => {
		const x = padding.left + event.position * chartWidth;
		const color = event.type ? typeColorMap[event.type] : 'var(--interactive-accent)';
		const level = event.level || 0;

		const dotY = lineY;
		const labelY = level % 2 === 0 ? lineY - 15 - level * levelHeight : lineY + 25 + level * levelHeight;
		const lineEndY = level % 2 === 0 ? labelY + 12 : labelY - 12;
		const lineStartY = level % 2 === 0 ? dotY - 8 : dotY + 8;

		eventDots += `
			<circle cx="${x}" cy="${dotY}" r="6" fill="${color}" stroke="var(--background-primary)" stroke-width="2"/>
		`;

		if (showLabels) {
			eventLabels += `
				<line x1="${x}" y1="${lineStartY}" x2="${x}" y2="${lineEndY}" stroke="${color}" stroke-width="1"/>
				<text x="${x}" y="${labelY}" text-anchor="middle" fill="var(--text-normal)" font-size="11">
					${escapeHtml(event.label)}
				</text>
			`;

			if (event.description) {
				const descY = level % 2 === 0 ? labelY + 14 : labelY + 14;
				eventLabels += `
					<text x="${x}" y="${descY}" text-anchor="middle" fill="var(--text-muted)" font-size="10">
						${escapeHtml(event.description)}
					</text>
				`;
			}
		}

		if (event.type || event.label) {
			const titleText = event.description
				? `${escapeHtml(event.label)}${event.type ? ` [${event.type}]` : ''}\n${escapeHtml(event.description)}`
				: `${escapeHtml(event.label)}${event.type ? ` [${event.type}]` : ''}`;
			eventDots += `<title>${titleText}</title>`;
		}
	});

	const svg = `
		<svg width="${width}" height="${adjustedHeight}" viewBox="0 0 ${width} ${adjustedHeight}" style="display:block;">
			${titleSvg}
			${baseLine}
			${eventDots}
			${eventLabels}
		</svg>
	`;

	return svg;
}
