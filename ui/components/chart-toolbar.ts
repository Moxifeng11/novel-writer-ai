import type { ChartType, ChartDensity } from '@/engine/types/chart-config';
import { CHART_TYPE_LABELS } from '@/engine/types/chart-config';

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

const DENSITY_ICONS: Record<ChartDensity, string> = {
	compact: `<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><rect x="2" y="3" width="12" height="2" rx="1"/><rect x="2" y="7" width="12" height="2" rx="1"/><rect x="2" y="11" width="12" height="2" rx="1"/></svg>`,
	normal: `<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><rect x="2" y="2" width="12" height="2.5" rx="1"/><rect x="2" y="6.75" width="12" height="2.5" rx="1"/><rect x="2" y="11.5" width="12" height="2.5" rx="1"/></svg>`,
	spacious: `<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><rect x="2" y="1" width="12" height="3" rx="1"/><rect x="2" y="6.5" width="12" height="3" rx="1"/><rect x="2" y="12" width="12" height="3" rx="1"/></svg>`
};

const DENSITY_TITLES: Record<ChartDensity, string> = {
	compact: '紧凑型',
	normal: '标准型',
	spacious: '宽松型'
};

/**
 * createChartToolbar 函数。
 * @param container - 容器元素
 * @param options - 配置项
 *
 * @example
 * ```ts
 * createChartToolbar(container, {
 *     currentType: 'line',
 *     availableTypes: ['line', 'bar'],
 *     currentDensity: 'normal',
 *     onTypeChange: (type) => console.log(type),
 *     onDensityChange: (density) => console.log(density),
 * });
 * ```
 */
export function createChartToolbar(container: HTMLElement, options: ChartToolbarOptions): void {
	container.innerHTML = '';
	container.className = 'nw-chart-toolbar';

	const typeGroup = document.createElement('div');
	typeGroup.className = 'nw-chart-toolbar-type-group';

	options.availableTypes.forEach(type => {
		const btn = document.createElement('button');
		btn.className = 'nw-chart-toolbar-btn';
		if (type === options.currentType) {
			btn.classList.add('active');
		}
		btn.textContent = CHART_TYPE_LABELS[type] || type;
		btn.title = CHART_TYPE_LABELS[type] || type;
		btn.addEventListener('click', () => {
			options.onTypeChange(type);
		});
		typeGroup.appendChild(btn);
	});

	const densityGroup = document.createElement('div');
	densityGroup.className = 'nw-chart-toolbar-density-group';

	(['compact', 'normal', 'spacious'] as ChartDensity[]).forEach(density => {
		const btn = document.createElement('button');
		btn.className = 'nw-chart-toolbar-btn nw-chart-toolbar-icon-btn';
		if (density === options.currentDensity) {
			btn.classList.add('active');
		}
		btn.innerHTML = DENSITY_ICONS[density];
		btn.title = DENSITY_TITLES[density];
		btn.addEventListener('click', () => {
			options.onDensityChange(density);
		});
		densityGroup.appendChild(btn);
	});

	container.appendChild(typeGroup);
	container.appendChild(densityGroup);

	if (options.showSortToggle && options.onSortChange) {
		const sortGroup = document.createElement('div');
		sortGroup.className = 'nw-chart-toolbar-sort-group';

		const sortOrders: Array<{ order: 'asc' | 'desc' | 'none'; label: string; icon: string }> = [
			{ order: 'none', label: '默认', icon: `<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M3 3h10v2H3zM3 7h7v2H3zM3 11h4v2H3z"/></svg>` },
			{ order: 'asc', label: '升序', icon: `<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M3 3h10v2H3zM3 7h7v2H3zM3 11h4v2H3zM12 11l2 3-2 3V11z" transform="translate(0 -1)"/></svg>` },
			{ order: 'desc', label: '降序', icon: `<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M3 3h4v2H3zM3 7h7v2H3zM3 11h10v2H3zM12 2l2 3-2 3V2z" transform="translate(0 0)"/></svg>` }
		];

		sortOrders.forEach(({ order, label, icon }) => {
			const btn = document.createElement('button');
			btn.className = 'nw-chart-toolbar-btn nw-chart-toolbar-icon-btn';
			btn.innerHTML = icon;
			btn.title = label;
			btn.addEventListener('click', () => {
				options.onSortChange?.(order);
			});
			sortGroup.appendChild(btn);
		});

		container.appendChild(sortGroup);
	}
}
