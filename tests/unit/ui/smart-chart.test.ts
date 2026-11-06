import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SmartChart } from '../../../ui/components/smart-chart';
import { barChart } from '../../../ui/svg-charts';
import type { ChartType, ChartDensity, SmartChartOptions } from '../../../engine/types/chart-config';

vi.mock('../../../ui/components/chart-toolbar', () => ({
    createChartToolbar: vi.fn(),
}));

vi.mock('../../../ui/svg-charts', () => ({
    radarChart: vi.fn((data: any[], opts: any) => '<svg class="radar-chart"></svg>'),
    barChart: vi.fn((data: any[], opts: any) => '<svg class="bar-chart"></svg>'),
    donutChart: vi.fn((data: any[], opts: any) => '<svg class="donut-chart"></svg>'),
    wordCloud: vi.fn((data: any[], opts: any) => '<svg class="word-cloud"></svg>'),
    lineChart: vi.fn((data: any[], opts: any) => '<svg class="line-chart"></svg>'),
    scatterChart: vi.fn((data: any[], opts: any) => '<svg class="scatter-chart"></svg>'),
    timelineChart: vi.fn((data: any[], opts: any) => '<svg class="timeline-chart"></svg>'),
    heatmap: vi.fn((data: any[], opts: any) => '<svg class="heatmap"></svg>'),
    treeChart: vi.fn((data: any, opts: any) => '<svg class="tree-chart"></svg>'),
    areaChart: vi.fn((data: any[], opts: any) => '<svg class="area-chart"></svg>'),
    densityHeatmap: vi.fn((data: any[], opts: any) => '<svg class="density-heatmap"></svg>'),
    horizontalBarChart: vi.fn((data: any[], opts: any) => '<svg class="horizontal-bar-chart"></svg>'),
    violinChart: vi.fn((data: any[], opts: any) => '<svg class="violin-chart"></svg>'),
    scatterToHistogram: vi.fn((data: any[], opts: any) => [
        { label: 'bin1', value: 5 },
        { label: 'bin2', value: 10 },
    ]),
    attachChartInteractions: vi.fn(),
}));

class MockClassList {
    private element: MockHTMLElement;

    constructor(element: MockHTMLElement) {
        this.element = element;
    }

    private get classes(): Set<string> {
        return new Set(this.element.className.split(/\s+/).filter(Boolean));
    }

    private setClasses(classes: Set<string>) {
        this.element.className = Array.from(classes).join(' ');
    }

    add(cls: string) {
        const classes = this.classes;
        classes.add(cls);
        this.setClasses(classes);
    }

    remove(cls: string) {
        const classes = this.classes;
        classes.delete(cls);
        this.setClasses(classes);
    }

    contains(cls: string): boolean {
        return this.classes.has(cls);
    }

    toggle(cls: string) {
        const classes = this.classes;
        if (classes.has(cls)) {
            classes.delete(cls);
            this.setClasses(classes);
            return false;
        } else {
            classes.add(cls);
            this.setClasses(classes);
            return true;
        }
    }
}

class MockHTMLElement {
    tagName: string = 'DIV';
    private _className: string = '';
    private _innerHTML: string = '';
    children: MockHTMLElement[] = [];
    parentNode: MockHTMLElement | null = null;
    private _classList: MockClassList;
    style: Record<string, string> = {};
    dataset: Record<string, string> = {};
    id: string = '';

    get className(): string { return this._className; }
    set className(val: string) { this._className = val; }

    get classList(): MockClassList { return this._classList; }

    get innerHTML(): string { return this._innerHTML; }
    set innerHTML(val: string) {
        this._innerHTML = val;
        if (val === '') {
            for (const child of this.children) {
                child.parentNode = null;
            }
            this.children = [];
        }
    }

    constructor(tagName: string = 'div') {
        this.tagName = tagName.toUpperCase();
        this._classList = new MockClassList(this);
    }

    appendChild(child: MockHTMLElement): MockHTMLElement {
        child.parentNode = this;
        this.children.push(child);
        return child;
    }

    removeChild(child: MockHTMLElement): MockHTMLElement {
        const idx = this.children.indexOf(child);
        if (idx >= 0) {
            this.children.splice(idx, 1);
            child.parentNode = null;
        }
        return child;
    }

    querySelector(selector: string): MockHTMLElement | null {
        if (selector.startsWith('.')) {
            const cls = selector.slice(1);
            for (const child of this.children) {
                if (child.className.split(/\s+/).includes(cls)) return child;
                const found = child.querySelector(selector);
                if (found) return found;
            }
        }
        return null;
    }

    querySelectorAll(selector: string): MockHTMLElement[] {
        const results: MockHTMLElement[] = [];
        if (selector.startsWith('.')) {
            const cls = selector.slice(1);
            for (const child of this.children) {
                if (child.className.split(/\s+/).includes(cls)) results.push(child);
                results.push(...child.querySelectorAll(selector));
            }
        }
        return results;
    }

    addEventListener() {}
    removeEventListener() {}
    getAttribute(name: string): string | null {
        return (this as any)[name] ?? null;
    }
    setAttribute(name: string, value: string) {
        (this as any)[name] = value;
    }
    removeAttribute(name: string) {
        delete (this as any)[name];
    }
}

function createMockContainer(): any {
    return new MockHTMLElement('div');
}

function createMockElement(tagName: string = 'div'): any {
    return new MockHTMLElement(tagName);
}

function createMockOptions(overrides: Partial<SmartChartOptions> = {}): SmartChartOptions {
    return {
        data: [
            { label: 'A', value: 10 },
            { label: 'B', value: 20 },
            { label: 'C', value: 15 },
        ],
        ...overrides,
    };
}

const originalCreateElement = (globalThis as any).document?.createElement;

beforeEach(() => {
    (globalThis as any).document = {
        createElement: (tagName: string) => createMockElement(tagName),
    };
});

describe('SmartChart — 实例化', () => {
    it('实例化成功', () => {
        const container = createMockContainer();
        const options = createMockOptions();
        const chart = new SmartChart(container, options);
        expect(chart).toBeDefined();
        expect(chart).toBeInstanceOf(SmartChart);
    });

    it('容器添加 nw-smart-chart 类名', () => {
        const container = createMockContainer();
        const options = createMockOptions();
        new SmartChart(container, options);
        expect(container.classList.contains('nw-smart-chart')).toBe(true);
    });

    it('创建工具栏和图表内容容器', () => {
        const container = createMockContainer();
        const options = createMockOptions();
        new SmartChart(container, options);
        expect(container.querySelector('.nw-smart-chart-toolbar-wrapper')).toBeTruthy();
        expect(container.querySelector('.nw-smart-chart-content')).toBeTruthy();
    });

    it('preferredType 被使用时作为初始类型', () => {
        const container = createMockContainer();
        const options = createMockOptions({
            preferredType: 'donut',
            availableTypes: ['bar', 'donut', 'radar'],
        });
        const chart = new SmartChart(container, options);
        expect(chart).toBeDefined();
    });
});

describe('SmartChart — 渲染', () => {
    it('render 不抛异常', () => {
        const container = createMockContainer();
        const options = createMockOptions();
        const chart = new SmartChart(container, options);
        expect(() => chart.render()).not.toThrow();
    });

    it('图表容器有内容', () => {
        const container = createMockContainer();
        const options = createMockOptions();
        new SmartChart(container, options);
        const chartContent = container.querySelector('.nw-smart-chart-content');
        expect(chartContent).toBeTruthy();
        expect(chartContent.innerHTML).toBeTruthy();
    });
});

describe('SmartChart — 渲染器注册表', () => {
    const allTypes: ChartType[] = [
        'radar', 'bar', 'horizontalBar', 'donut', 'line', 'scatter', 'heatmap',
        'densityHeatmap', 'area', 'tree', 'violin', 'histogram', 'timeline', 'wordCloud',
    ];

    it('十四种图表类型均可渲染出内容', () => {
        for (const type of allTypes) {
            const container = createMockContainer();
            const chart = new SmartChart(container, createMockOptions({
                availableTypes: [type],
                preferredType: type,
            }));
            const content = container.querySelector('.nw-smart-chart-content');
            expect(content?.innerHTML).toBeTruthy();
            chart.destroy();
        }
    });

    it('柱状图渲染器收到 padding 与默认宽高', () => {
        const container = createMockContainer();
        new SmartChart(container, createMockOptions({
            availableTypes: ['bar'],
            preferredType: 'bar',
        }));
        const calls = vi.mocked(barChart).mock.calls;
        const lastOptions = calls[calls.length - 1]?.[1];
        expect(lastOptions).toMatchObject({
            width: 400,
            height: 250,
            padding: { top: 40, right: 20, bottom: 50, left: 50 },
        });
    });
});

describe('SmartChart — setType', () => {
    it('setType 切换图表类型不抛异常', () => {
        const container = createMockContainer();
        const options = createMockOptions({
            availableTypes: ['bar', 'donut', 'radar'],
            preferredType: 'bar',
        });
        const chart = new SmartChart(container, options);
        expect(() => chart.setType('donut')).not.toThrow();
    });

    it('setType 相同类型不触发回调', () => {
        const container = createMockContainer();
        const onTypeChange = vi.fn();
        const options = createMockOptions({
            availableTypes: ['bar', 'donut'],
            preferredType: 'bar',
            onTypeChange,
        });
        const chart = new SmartChart(container, options);
        chart.setType('bar');
        expect(onTypeChange).not.toHaveBeenCalled();
    });

    it('setType 调用 onTypeChange 回调', () => {
        const container = createMockContainer();
        const onTypeChange = vi.fn();
        const options = createMockOptions({
            availableTypes: ['bar', 'donut'],
            preferredType: 'bar',
            onTypeChange,
        });
        const chart = new SmartChart(container, options);
        chart.setType('donut');
        expect(onTypeChange).toHaveBeenCalledWith('donut');
    });

    it('setType 不支持的类型不生效', () => {
        const container = createMockContainer();
        const onTypeChange = vi.fn();
        const options = createMockOptions({
            availableTypes: ['bar', 'donut'],
            preferredType: 'bar',
            onTypeChange,
        });
        const chart = new SmartChart(container, options);
        chart.setType('radar' as ChartType);
        expect(onTypeChange).not.toHaveBeenCalled();
    });
});

describe('SmartChart — setDensity', () => {
    it('setDensity 切换密度不抛异常', () => {
        const container = createMockContainer();
        const options = createMockOptions();
        const chart = new SmartChart(container, options);
        expect(() => chart.setDensity('compact')).not.toThrow();
    });

    it('setDensity 相同密度不触发回调', () => {
        const container = createMockContainer();
        const onDensityChange = vi.fn();
        const options = createMockOptions({
            config: { density: 'normal' as ChartDensity },
            onDensityChange,
        });
        const chart = new SmartChart(container, options);
        chart.setDensity('normal');
        expect(onDensityChange).not.toHaveBeenCalled();
    });

    it('setDensity 调用 onDensityChange 回调', () => {
        const container = createMockContainer();
        const onDensityChange = vi.fn();
        const options = createMockOptions({
            config: { density: 'normal' as ChartDensity },
            onDensityChange,
        });
        const chart = new SmartChart(container, options);
        chart.setDensity('spacious');
        expect(onDensityChange).toHaveBeenCalledWith('spacious');
    });
});

describe('SmartChart — setData', () => {
    it('setData 更新数据不抛异常', () => {
        const container = createMockContainer();
        const options = createMockOptions();
        const chart = new SmartChart(container, options);
        const newData = [
            { label: 'X', value: 100 },
            { label: 'Y', value: 200 },
        ];
        expect(() => chart.setData(newData)).not.toThrow();
    });
});

describe('SmartChart — recommendType 推荐算法', () => {
    it('空数据返回 bar 作为默认', () => {
        const result = SmartChart.recommendType(null);
        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBeGreaterThan(0);
        expect(result[0]).toBe('bar');
    });

    it('空数组返回 bar', () => {
        const result = SmartChart.recommendType([]);
        expect(result[0]).toBe('bar');
    });

    it('label-value 数据推荐 bar 和 donut', () => {
        const data = [
            { label: 'A', value: 10 },
            { label: 'B', value: 20 },
        ];
        const result = SmartChart.recommendType(data);
        expect(result).toContain('bar');
        expect(result).toContain('donut');
    });

    it('长标签推荐 horizontalBar', () => {
        const data = [
            { label: '这是一个非常长的标签名称', value: 10 },
            { label: '另一个超长标签文本测试', value: 20 },
        ];
        const result = SmartChart.recommendType(data);
        expect(result).toContain('horizontalBar');
    });

    it('xy 散点数据推荐 scatter', () => {
        const data = [
            { x: 1, y: 2 },
            { x: 3, y: 4 },
            { x: 5, y: 6 },
        ];
        const result = SmartChart.recommendType(data);
        expect(result).toContain('scatter');
        expect(result).toContain('densityHeatmap');
    });

    it('text-weight 数据推荐 wordCloud', () => {
        const data = [
            { text: '小说', weight: 10 },
            { text: '角色', weight: 20 },
        ];
        const result = SmartChart.recommendType(data);
        expect(result[0]).toBe('wordCloud');
    });

    it('position 数据推荐 timeline', () => {
        const data = [
            { position: 1, label: '开始' },
            { position: 100, label: '结束' },
        ];
        const result = SmartChart.recommendType(data);
        expect(result[0]).toBe('timeline');
    });

    it('row-col 数据推荐 heatmap', () => {
        const data = [
            { row: 'A', col: '1', value: 10 },
            { row: 'B', col: '2', value: 20 },
        ];
        const result = SmartChart.recommendType(data);
        expect(result[0]).toBe('heatmap');
    });

    it('values 数组数据推荐 violin', () => {
        const data = [
            { label: '组1', values: [1, 2, 3, 4, 5] },
            { label: '组2', values: [2, 3, 4, 5, 6] },
        ];
        const result = SmartChart.recommendType(data);
        expect(result).toContain('violin');
    });

    it('data 数组数据推荐 line 和 area', () => {
        const data = [
            { name: '系列1', data: [1, 2, 3, 4] },
            { name: '系列2', data: [2, 3, 4, 5] },
        ];
        const result = SmartChart.recommendType(data);
        expect(result).toContain('line');
        expect(result).toContain('area');
    });

    it('tree 结构数据推荐 tree', () => {
        const data = {
            name: '根节点',
            children: [
                { name: '子节点1' },
                { name: '子节点2' },
            ],
        };
        const result = SmartChart.recommendType(data);
        expect(result[0]).toBe('tree');
    });

    it('context 包含角色时提高 radar 分数', () => {
        const data = [
            { label: '智力', value: 80 },
            { label: '力量', value: 70 },
            { label: '敏捷', value: 90 },
        ];
        const withoutContext = SmartChart.recommendType(data);
        const withContext = SmartChart.recommendType(data, '角色属性');

        const radarIndexWithout = withoutContext.indexOf('radar');
        const radarIndexWith = withContext.indexOf('radar');

        expect(radarIndexWith).toBeLessThanOrEqual(radarIndexWithout);
    });

    it('context 包含时间时提高 line 和 area 分数', () => {
        const data = [
            { name: '趋势', data: [1, 2, 3, 4, 5] },
        ];
        const withoutContext = SmartChart.recommendType(data);
        const withContext = SmartChart.recommendType(data, '时间趋势');

        const lineIndexWithout = withoutContext.indexOf('line');
        const lineIndexWith = withContext.indexOf('line');

        expect(lineIndexWith).toBeLessThanOrEqual(lineIndexWithout);
    });

    it('context 包含情绪时提高 violin 分数', () => {
        const data = [
            { label: '情绪', values: [1, 2, 3, 4, 5] },
        ];
        const withoutContext = SmartChart.recommendType(data);
        const withContext = SmartChart.recommendType(data, '情绪分布');

        const violinIndexWithout = withoutContext.indexOf('violin');
        const violinIndexWith = withContext.indexOf('violin');

        expect(violinIndexWith).toBeLessThanOrEqual(violinIndexWithout);
    });

    it('返回结果去重', () => {
        const data = [
            { label: 'A', value: 10 },
        ];
        const result = SmartChart.recommendType(data);
        const unique = new Set(result);
        expect(unique.size).toBe(result.length);
    });

    it('最多返回 6 种推荐', () => {
        const data = [
            { label: 'A', value: 10 },
            { label: 'B', value: 20 },
        ];
        const result = SmartChart.recommendType(data);
        expect(result.length).toBeLessThanOrEqual(6);
    });

    it('points 数组数据推荐 area 和 line', () => {
        const data = [
            { name: '系列1', points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] },
        ];
        const result = SmartChart.recommendType(data);
        expect(result).toContain('area');
        expect(result).toContain('line');
    });

    it('未知数据格式返回默认推荐', () => {
        const data = { unknown: 'format' };
        const result = SmartChart.recommendType(data);
        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBeGreaterThan(0);
    });
});

describe('SmartChart — destroy', () => {
    it('destroy 清理容器内容', () => {
        const container = createMockContainer();
        const options = createMockOptions();
        const chart = new SmartChart(container, options);

        expect(container.children.length).toBeGreaterThan(0);
        chart.destroy();
        expect(container.children.length).toBe(0);
    });

    it('destroy 移除 nw-smart-chart 类名', () => {
        const container = createMockContainer();
        const options = createMockOptions();
        const chart = new SmartChart(container, options);

        expect(container.classList.contains('nw-smart-chart')).toBe(true);
        chart.destroy();
        expect(container.classList.contains('nw-smart-chart')).toBe(false);
    });

    it('destroy 后 render 不生效', () => {
        const container = createMockContainer();
        const options = createMockOptions();
        const chart = new SmartChart(container, options);

        chart.destroy();
        expect(container.innerHTML).toBe('');
        chart.render();
        expect(container.innerHTML).toBe('');
    });
});
