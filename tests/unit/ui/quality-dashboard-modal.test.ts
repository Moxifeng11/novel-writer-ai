import { describe, it, expect, beforeEach, vi } from 'vitest';

// 轻量 mock 外部依赖，避免引入 svg-charts / project-utils / main 的重型模块
vi.mock('../../../ui/svg-charts', () => ({
    radarChart: vi.fn((_data: any, opts?: any) => `<svg class="mock-radar">${opts?.title ?? ''}</svg>`),
}));
vi.mock('../../../ui/project-utils', () => ({
    getChaptersForProject: vi.fn(() => []),
}));
vi.mock('../../../main', () => ({
    default: class {},
}));

import { QualityDashboardModal, openFileAtLine } from '../../../ui/quality-dashboard-modal';

// ============================================================
// 最小 DOM 模拟（覆盖 renderCharts / exportData 用到的 API）
// ============================================================

type Listener = (ev?: any) => void;

class MockHTMLElement {
    tagName: string;
    className: string = '';
    textContent: string = '';
    style: Record<string, string> = {};
    children: MockHTMLElement[] = [];
    parentNode: MockHTMLElement | null = null;
    href: string = '';
    download: string = '';
    private _innerHTML: string = '';
    private listeners = new Map<string, Listener[]>();

    constructor(tagName: string = 'div') {
        this.tagName = tagName.toUpperCase();
    }

    get innerHTML(): string { return this._innerHTML; }
    set innerHTML(val: string) {
        this._innerHTML = val;
        if (val === '') {
            for (const c of this.children) c.parentNode = null;
            this.children = [];
        }
    }

    createEl(tag: string, opts?: { cls?: string; text?: string }): MockHTMLElement {
        const el = new MockHTMLElement(tag);
        if (opts?.cls) el.className = opts.cls;
        if (opts?.text !== undefined) el.textContent = opts.text;
        this.appendChild(el);
        return el;
    }

    empty(): void {
        for (const c of this.children) c.parentNode = null;
        this.children = [];
        this._innerHTML = '';
    }

    setText(text: string): void {
        this.textContent = text;
        this.children = [];
    }

    appendChild(child: MockHTMLElement): MockHTMLElement {
        child.parentNode = this;
        this.children.push(child);
        return child;
    }

    removeChild(child: MockHTMLElement): MockHTMLElement {
        const i = this.children.indexOf(child);
        if (i >= 0) {
            this.children.splice(i, 1);
            child.parentNode = null;
        }
        return child;
    }

    addEventListener(type: string, fn: Listener): void {
        const list = this.listeners.get(type) ?? [];
        list.push(fn);
        this.listeners.set(type, list);
    }

    trigger(type: string): void {
        for (const fn of this.listeners.get(type) ?? []) fn();
    }

    click(): void {}
    remove(): void {}
    getAttribute(): string | null { return null; }
    setAttribute(): void {}
}

// ============================================================
// 测试数据工厂
// ============================================================

const DIM_SCORES: Record<string, number> = {
    readability: 80,
    rhythm: 70,
    emotion: 65,
    characterConsistency: 75,
    coherence: 85,
    languageTexture: 60,
};

function makeScore(): any {
    const dimensions: any = {};
    for (const [dim, score] of Object.entries(DIM_SCORES)) {
        dimensions[dim] = { dimension: dim, score, basis: [], issues: [], suggestions: [], details: {} };
    }
    return {
        overallScore: 72,
        dimensions,
        issues: [
            { id: 'i1', dimension: 'readability', description: '句子过长', severity: 'medium', location: { line: 5 } },
            { id: 'i2', dimension: 'coherence', description: '时间线矛盾', severity: 'high', location: { line: 10 } },
            { id: 'i3', dimension: 'readability', description: '标点缺失', severity: 'low' },
        ],
        suggestions: [],
        evaluatedAt: Date.now(),
        wordCount: 100,
        evalTimeMs: 1,
        trend: 'stable',
        fromCache: false,
    };
}

function makeChapters(n: number): any[] {
    return Array.from({ length: n }, (_, i) => ({
        chapter: `第${i + 1}章`,
        volume: '第1卷',
        chapterNum: i + 1,
        title: `章节${i + 1}`,
        file: {
            path: `proj/03-大纲与章节/正文/第1卷/第${i + 1}章_正文.md`,
            stat: { mtime: 1 },
        },
    }));
}

const OUTLINE_FILE = {
    path: 'proj/03-大纲与章节/步骤结果/第1卷/第1章/第1章_大纲摘要.md',
    name: '第1章_大纲摘要.md',
};

const evaluate = vi.fn(async (_text: string, _context?: any) => makeScore());
const fakeEngine = { evaluate };

function setupModal(chapters: any[]): QualityDashboardModal {
    const modal = new QualityDashboardModal({} as any, {} as any, fakeEngine as any);
    (modal as any).app = {
        vault: {
            read: vi.fn(async (file: any) => (file.name === OUTLINE_FILE.name ? '本章大纲内容' : '正文内容')),
            getFiles: () => [OUTLINE_FILE],
        },
    };
    (modal as any).plugin = {
        ctxManager: {
            gatherCharacterState: vi.fn(async () => ({
                character_state: [{ name: '林默' }, { '姓名': '苏晚' }, { name: '' }],
            })),
        },
    };
    (modal as any).project = 'proj';
    (modal as any).chapters = chapters;
    (modal as any).radarEl = new MockHTMLElement('div');
    (modal as any).dimListEl = new MockHTMLElement('div');
    (modal as any).issuesEl = new MockHTMLElement('div');
    (modal as any).issuesTitleEl = new MockHTMLElement('h3');
    return modal;
}

// ============================================================
// 测试
// ============================================================

beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as any).document = {
        createElement: (tagName: string) => new MockHTMLElement(tagName),
        body: { appendChild: vi.fn() },
    };
});

describe('QualityDashboardModal — 联动', () => {
    it('场景1：切换时间范围 → 所有关联图表同步更新', async () => {
        const modal = setupModal(makeChapters(5));

        (modal as any).range = 'current';
        await (modal as any).refreshData();
        expect(evaluate).toHaveBeenCalledTimes(1);
        expect((modal as any).dimListEl.children.length).toBe(6); // 六维横条
        expect((modal as any).issuesEl.children.length).toBe(3); // 单章 3 个问题
        expect((modal as any).radarEl.innerHTML).toContain('聚合评分');

        (modal as any).qualityCache.clear();
        evaluate.mockClear();
        (modal as any).range = 'recent3';
        await (modal as any).refreshData();
        expect(evaluate).toHaveBeenCalledTimes(3);
        expect((modal as any).issuesEl.children.length).toBe(9); // 3 章 × 3 问题

        (modal as any).qualityCache.clear();
        evaluate.mockClear();
        (modal as any).range = 'all';
        await (modal as any).refreshData();
        expect(evaluate).toHaveBeenCalledTimes(5);
        expect((modal as any).issuesEl.children.length).toBe(15); // 5 章 × 3 问题
    });

    it('场景2：点击维度项 → 其他关联组件自动过滤对应数据', async () => {
        const modal = setupModal(makeChapters(1));
        (modal as any).range = 'current';
        await (modal as any).refreshData();
        expect((modal as any).issuesEl.children.length).toBe(3);

        // 点击第一个维度（readability）
        const readabilityRow = (modal as any).dimListEl.children[0];
        readabilityRow.trigger('click');
        expect((modal as any).activeDimension).toBe('readability');
        expect((modal as any).issuesEl.children.length).toBe(2); // 仅 readability 2 条
        expect((modal as any).issuesTitleEl.textContent).toContain('可读性');

        // 再次点击取消钻取 → 恢复全部
        readabilityRow.trigger('click');
        expect((modal as any).activeDimension).toBeNull();
        expect((modal as any).issuesEl.children.length).toBe(3);

        // 点击 coherence（第 5 个维度）→ 仅 1 条
        const coherenceRow = (modal as any).dimListEl.children[4];
        coherenceRow.trigger('click');
        expect((modal as any).activeDimension).toBe('coherence');
        expect((modal as any).issuesEl.children.length).toBe(1);
    });

    it('场景3：导出功能获取联动后的数据集（范围 + 维度）', async () => {
        const modal = setupModal(makeChapters(2));
        (modal as any).range = 'current';
        (modal as any).activeDimension = 'readability';
        await (modal as any).refreshData();

        let captured: any = null;
        (globalThis as any).Blob = class {
            constructor(parts: any) { captured = parts[0]; }
        };
        (globalThis as any).URL = {
            createObjectURL: vi.fn(() => 'blob:mock'),
            revokeObjectURL: vi.fn(),
        };

        (modal as any).exportData();

        expect(captured).toBeTruthy();
        const payload = JSON.parse(captured);
        expect(payload.project).toBe('proj');
        expect(payload.range).toBe('current');
        expect(payload.activeDimension).toBe('readability');
        expect(payload.chapterCount).toBe(1);
        expect(payload.chapters).toHaveLength(1);

        // 导出的 issues 已按维度过滤，且保留六维分数
        const issues = payload.chapters[0].issues;
        expect(issues).toHaveLength(2);
        expect(issues.every((i: any) => i.dimension === 'readability')).toBe(true);
        expect(payload.chapters[0].dimensions).toHaveLength(6);
    });

    it('C2：评估带人物名册与本章大纲；改稿（mtime 变化）后缓存失效', async () => {
        const chapters = makeChapters(1);
        const modal = setupModal(chapters);
        (modal as any).range = 'current';

        await (modal as any).refreshData();
        expect(evaluate).toHaveBeenCalledTimes(1);
        expect(evaluate.mock.calls[0][1]).toMatchObject({
            characterNames: ['林默', '苏晚'],
            chapterOutline: '本章大纲内容',
        });

        // mtime 未变 → 命中缓存，不重复评估
        await (modal as any).refreshData();
        expect(evaluate).toHaveBeenCalledTimes(1);

        // 改稿后 mtime 变化 → 必须重新评估
        chapters[0].file.stat.mtime = 2;
        await (modal as any).refreshData();
        expect(evaluate).toHaveBeenCalledTimes(2);
    });
});

describe('openFileAtLine — 问题定位', () => {
    function makeApp(editor: any, openFile: any = vi.fn(async () => {})) {
        return {
            workspace: {
                getLeaf: vi.fn(() => ({ openFile, view: { editor } })),
            },
        } as any;
    }

    it('打开文件并把 1-based 行号转换为编辑器 0-based 光标', async () => {
        const setCursor = vi.fn();
        const scrollIntoView = vi.fn();
        const openFile = vi.fn(async () => {});
        const app = makeApp({ lineCount: () => 20, setCursor, scrollIntoView }, openFile);
        const file = { path: 'proj/03-大纲与章节/正文/第1卷/第1章_正文.md' } as any;

        const ok = await openFileAtLine(app, file, 5);

        expect(ok).toBe(true);
        expect(openFile).toHaveBeenCalledWith(file);
        expect(setCursor).toHaveBeenCalledWith({ line: 4, ch: 0 });
        expect(scrollIntoView).toHaveBeenCalledWith(
            { from: { line: 4, ch: 0 }, to: { line: 4, ch: 0 } },
            true
        );
    });

    it('行号越界时收敛到末行', async () => {
        const setCursor = vi.fn();
        const app = makeApp({ lineCount: () => 3, setCursor, scrollIntoView: vi.fn() });

        await openFileAtLine(app, { path: 'a.md' } as any, 99);

        expect(setCursor).toHaveBeenCalledWith({ line: 2, ch: 0 });
    });

    it('无行号时仅打开文件，不移动光标', async () => {
        const setCursor = vi.fn();
        const openFile = vi.fn(async () => {});
        const app = makeApp({ lineCount: () => 10, setCursor, scrollIntoView: vi.fn() }, openFile);

        const ok = await openFileAtLine(app, { path: 'a.md' } as any);

        expect(ok).toBe(true);
        expect(openFile).toHaveBeenCalledTimes(1);
        expect(setCursor).not.toHaveBeenCalled();
    });

    it('打开失败时返回 false 而不是抛异常', async () => {
        const app = makeApp(
            { lineCount: () => 10, setCursor: vi.fn(), scrollIntoView: vi.fn() },
            vi.fn(async () => { throw new Error('not found'); })
        );

        await expect(openFileAtLine(app, { path: 'missing.md' } as any, 1)).resolves.toBe(false);
    });
});
