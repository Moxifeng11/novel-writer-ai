/**
 * kb-config-panel 假 DOM 回归（DSH-20261112-19 补测）
 *
 * `ui/views/kb-config-panel.ts` 是从 knowledge-base-view 抽出的纯 DOM 构建器
 * （61 行可执行代码、此前 **0% 覆盖**）。它负责整个「题材配置」页签：
 * 频道分类栏、工具栏四个按钮、题材卡片网格、自定义徽标与删除入口、细分题材预览。
 *
 * 这些分支如果坏掉，用户看到的是「按钮点了没反应」「自定义题材删不掉」
 * 这种静默失效——没有测试就只能靠人工点。
 *
 * 本文件断言「分支为真时 DOM 真的长成那样」，并验证点击回调真的连到了 host。
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { buildKbConfigPanel, type KbConfigPanelHost } from '../../../ui/views/kb-config-panel';
import type { GenreConfig } from '../../../shared/webnovel-knowledge-base';
import { FakeEl, stubCreateDiv } from './support/fake-dom';

/** 造一个题材 */
function genre(partial: Partial<GenreConfig> & { id: string; name: string }): GenreConfig {
    return {
        category: 'male',
        description: '描述',
        personalityTags: [],
        abilityTypes: [],
        techniques: [],
        subGenres: [],
        ...partial,
    } as GenreConfig;
}

/** 造宿主（全部回调可观测） */
function makeHost(overrides: Partial<KbConfigPanelHost> = {}): KbConfigPanelHost & {
    calls: string[];
} {
    const calls: string[] = [];
    const genres = overrides.kb?.getGenresByCategory?.('male' as never) ?? [];
    const host = {
        calls,
        configCategory: 'male' as KbConfigPanelHost['configCategory'],
        kb: {
            getGenresByCategory: () => genres,
            isCustomGenre: () => false,
        } as unknown as KbConfigPanelHost['kb'],
        isSelectedGenre: () => false,
        getChannelLabel: (channel: string) => (channel === 'male' ? '男频' : '其它'),
        switchCategory: (cat: string) => { calls.push(`switch:${cat}`); },
        selectGenre: (g: { id: string }) => { calls.push(`select:${g.id}`); },
        addGenre: () => { calls.push('add'); },
        importConfig: () => { calls.push('import'); },
        exportConfig: async () => { calls.push('export'); },
        resetConfig: () => { calls.push('reset'); },
        deleteGenre: (id: string) => { calls.push(`delete:${id}`); },
        ...overrides,
    };
    return host as KbConfigPanelHost & { calls: string[] };
}

/** 渲染 */
function render(host: KbConfigPanelHost): FakeEl {
    const root = new FakeEl('div');
    buildKbConfigPanel(root as unknown as HTMLElement, host);
    return root;
}

/** 收集文本 */
function texts(el: FakeEl): string[] {
    const out: string[] = [];
    const walk = (node: FakeEl): void => {
        if (node.textContent) out.push(node.textContent);
        for (const child of node.children) walk(child);
    };
    walk(el);
    return out;
}

/** 按类名找元素 */
function byClass(root: FakeEl, cls: string): FakeEl[] {
    return root.querySelectorAll<FakeEl>(`.${cls}`);
}

/** 按文本找按钮 */
function buttonByText(root: FakeEl, text: string): FakeEl | undefined {
    return root.querySelectorAll<FakeEl>('button').find(b => b.textContent.includes(text));
}

describe('配置面板-1：空分类占位', () => {
    beforeEach(() => stubCreateDiv());
    afterEach(() => vi.unstubAllGlobals());

    it('没有题材时只渲染「暂无题材配置」并提前返回', () => {
        const root = render(makeHost());
        expect(texts(root)).toContain('暂无题材配置');
        // 提前返回：不应出现题材卡片网格
        expect(byClass(root, 'nw-kb-config-content')).toHaveLength(1);
    });

    it('kb 为 null 时同样走空态（不崩溃）', () => {
        const root = render(makeHost({ kb: null }));
        expect(texts(root)).toContain('暂无题材配置');
    });
});

describe('配置面板-2：频道分类栏', () => {
    beforeEach(() => stubCreateDiv());
    afterEach(() => vi.unstubAllGlobals());

    it('渲染全部频道分类项', () => {
        const root = render(makeHost());
        const panel = byClass(root, 'nw-kb-config-category-panel')[0];
        expect(panel).toBeTruthy();
        expect(texts(panel).length).toBeGreaterThan(0);
    });

    it('点击分类项回调 switchCategory', () => {
        const host = makeHost();
        const root = render(host);
        const panel = byClass(root, 'nw-kb-config-category-panel')[0];
        // 分类项是 panel 的直属子元素（第一个是 header）
        const items = panel.children.filter(c => c.tagName === 'div' && c.listeners.has('click'));
        expect(items.length).toBeGreaterThan(0);
        for (const fn of items[0].listeners.get('click') || []) fn({});
        expect(host.calls.some(c => c.startsWith('switch:'))).toBe(true);
    });

    it('当前分类项高亮为 accent，其它为 transparent', () => {
        const root = render(makeHost());
        const panel = byClass(root, 'nw-kb-config-category-panel')[0];
        const styles = panel.children.map(c => c.attr.style || '');
        expect(styles.some(s => s.includes('var(--interactive-accent)'))).toBe(true);
        expect(styles.some(s => s.includes('transparent'))).toBe(true);
    });
});

describe('配置面板-3：工具栏四个按钮', () => {
    beforeEach(() => stubCreateDiv());
    afterEach(() => vi.unstubAllGlobals());

    it('标题带频道中文名', () => {
        const root = render(makeHost());
        expect(texts(root)).toContain('男频题材配置');
    });

    it('四个按钮都存在', () => {
        const root = render(makeHost());
        for (const label of ['新增题材', '导入', '导出', '恢复默认']) {
            expect(buttonByText(root, label)).toBeTruthy();
        }
    });

    it('点击各自回调到 host', () => {
        const host = makeHost();
        const root = render(host);
        const click = (text: string): void => {
            const btn = buttonByText(root, text);
            for (const fn of btn?.listeners.get('click') || []) fn({});
        };
        click('新增题材');
        click('导入');
        click('导出');
        click('恢复默认');
        expect(host.calls).toEqual(['add', 'import', 'export', 'reset']);
    });
});

describe('配置面板-4：题材卡片', () => {
    beforeEach(() => stubCreateDiv());
    afterEach(() => vi.unstubAllGlobals());

    /** 造带题材的宿主 */
    function hostWithGenres(genres: GenreConfig[], opts: { custom?: string[]; selected?: string } = {}) {
        const customSet = new Set(opts.custom || []);
        return makeHost({
            kb: {
                getGenresByCategory: () => genres,
                isCustomGenre: (id: string) => customSet.has(id),
            } as unknown as KbConfigPanelHost['kb'],
            isSelectedGenre: (id: string) => id === opts.selected,
        });
    }

    it('渲染题材名与描述', () => {
        const root = render(hostWithGenres([genre({ id: 'g1', name: '东方玄幻', description: '古典修真' })]));
        const all = texts(root);
        expect(all).toContain('东方玄幻');
        expect(all).toContain('古典修真');
    });

    it('自定义题材显示「自定义」徽标与删除入口', () => {
        const root = render(hostWithGenres(
            [genre({ id: 'g1', name: '自定义题材' })],
            { custom: ['g1'] },
        ));
        expect(texts(root)).toContain('自定义');
        expect(texts(root)).toContain('🗑️');
    });

    it('非自定义题材不显示删除入口', () => {
        const root = render(hostWithGenres([genre({ id: 'g1', name: '内置题材' })]));
        expect(texts(root)).not.toContain('🗑️');
        expect(texts(root)).not.toContain('自定义');
    });

    it('点击删除图标回调 deleteGenre 且阻止冒泡', () => {
        const host = hostWithGenres([genre({ id: 'g1', name: '自定义题材' })], { custom: ['g1'] });
        const root = render(host);
        const trash = root.querySelectorAll<FakeEl>('span').find(s => s.textContent === '🗑️');
        expect(trash).toBeTruthy();
        let stopped = false;
        for (const fn of trash!.listeners.get('click') || []) {
            fn({ stopPropagation: () => { stopped = true; } });
        }
        expect(stopped).toBe(true);
        expect(host.calls).toContain('delete:g1');
    });

    it('点击卡片回调 selectGenre', () => {
        const host = hostWithGenres([genre({ id: 'g1', name: '题材一' })]);
        const root = render(host);
        const grid = byClass(root, 'nw-u-d-grid')[0];
        const card = grid.children[0];
        for (const fn of card.listeners.get('click') || []) fn({});
        expect(host.calls).toContain('select:g1');
    });

    it('选中题材的卡片带 accent 边框', () => {
        const root = render(hostWithGenres(
            [genre({ id: 'g1', name: '题材一' }), genre({ id: 'g2', name: '题材二' })],
            { selected: 'g2' },
        ));
        const grid = byClass(root, 'nw-u-d-grid')[0];
        expect(grid.children[0].attr.style).not.toContain('interactive-accent');
        expect(grid.children[1].attr.style).toContain('interactive-accent');
    });

    it('细分题材预览显示标签与溢出计数', () => {
        const subGenres = Array.from({ length: 6 }, (_, i) => ({
            id: `s${i}`, name: `细分${i}`, description: 'd', keywords: [], exampleTitles: [],
        }));
        const root = render(hostWithGenres([genre({ id: 'g1', name: '题材一', subGenres })]));
        const all = texts(root);
        expect(all.some(t => t.startsWith('细分'))).toBe(true);
        // 溢出计数形如 +N
        expect(all.some(t => /^\+\d+$/.test(t))).toBe(true);
    });

    it('无细分题材时不渲染预览区', () => {
        const root = render(hostWithGenres([genre({ id: 'g1', name: '题材一', subGenres: [] })]));
        expect(texts(root).some(t => /^\+\d+$/.test(t))).toBe(false);
    });
});
