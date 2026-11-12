/**
 * link-status 渲染层假 DOM 回归（DSH-20261112-19）
 *
 * 背景：DSH-20261112-17 给 `renderLinkStatus` 加了「降级只取最近 3 条」的渲染逻辑
 * （原 `slice(0, 3)` 取的是**最旧**的三条，与「最近」语义相反，还会把新出现的
 * 孤儿/降级提示挤掉），但当时只补了 compute 层测试，渲染层零覆盖 →
 * `ui/views` 覆盖率从 27.17% 掉到 26.88%。
 *
 * 本文件用 `tests/unit/ui/support/fake-dom.ts` 的假 DOM 补上渲染分支，
 * 断言「分支为真时 DOM 真的长成那样」，而不是只断言函数被调用过。
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { renderLinkStatus } from '../../../ui/views/link-status';
import type { LinkStage, LinkStatus } from '../../../shared/link-status-compute';
import { FakeEl, stubCreateDiv } from './support/fake-dom';

/** 造一个环节 */
function stage(name: string, status: LinkStage['status'], detail = '详情'): LinkStage {
    return { name, status, detail };
}

/** 造一个链路状态 */
function status(partial: Partial<LinkStatus> & { overall: LinkStatus['overall'] }): LinkStatus {
    return {
        title: '知识流',
        stages: [stage('拆解', 'ok')],
        breakpoint: null,
        ...partial,
    } as LinkStatus;
}

/** 收集假元素树里的所有文本 */
function texts(el: FakeEl): string[] {
    const out: string[] = [];
    const walk = (node: FakeEl): void => {
        if (node.textContent) out.push(node.textContent);
        for (const child of node.children) walk(child);
    };
    walk(el);
    return out;
}

/** 渲染到假容器 */
function render(s: LinkStatus): FakeEl {
    const container = new FakeEl('div');
    const banner = renderLinkStatus(container as unknown as HTMLElement, s);
    return banner as unknown as FakeEl;
}

describe('渲染-1：整体状态的配色类与标题', () => {
    beforeEach(() => stubCreateDiv());
    afterEach(() => vi.unstubAllGlobals());

    it('ok → nw-is-ready，标题带「状态」后缀', () => {
        const banner = render(status({ overall: 'ok' }));
        expect(banner.className).toContain('nw-capability-banner');
        expect(banner.className).toContain('nw-is-ready');
        expect(texts(banner)).toContain('知识流状态');
    });

    it('warn → nw-is-accumulating', () => {
        expect(render(status({ overall: 'warn' })).className).toContain('nw-is-accumulating');
    });

    it('broken → nw-is-degraded', () => {
        expect(render(status({ overall: 'broken' })).className).toContain('nw-is-degraded');
    });

    it('unknown → nw-is-empty', () => {
        expect(render(status({ overall: 'unknown' })).className).toContain('nw-is-empty');
    });
});

describe('渲染-2：断点与说明文案', () => {
    beforeEach(() => stubCreateDiv());
    afterEach(() => vi.unstubAllGlobals());

    it('有断点时标题区显示「断在「X」」而不是状态词', () => {
        const banner = render(status({
            overall: 'broken',
            breakpoint: '向量化',
            stages: [stage('拆解', 'ok'), stage('向量化', 'broken', '0 本就绪')],
        }));
        const all = texts(banner);
        expect(all).toContain('断在「向量化」');
        expect(all.some(t => t.includes('断点：向量化'))).toBe(true);
    });

    it('无断点时显示状态词（通）', () => {
        const all = texts(render(status({ overall: 'ok' })));
        expect(all).toContain('通');
    });

    it('ok 时提示「链路已通」', () => {
        const all = texts(render(status({ overall: 'ok' })));
        expect(all.some(t => t.includes('链路已通'))).toBe(true);
    });

    it('unknown 时提示「尚未产生可判定数据」', () => {
        const all = texts(render(status({ overall: 'unknown' })));
        expect(all.some(t => t.includes('尚未产生可判定数据'))).toBe(true);
    });

    it('每个环节都渲染出图标与「名称 · 详情」', () => {
        const banner = render(status({
            overall: 'warn',
            stages: [
                stage('拆解', 'ok', '1 本已拆解'),
                stage('检索', 'warn', '向量库已加载 1 本'),
            ],
        }));
        const all = texts(banner);
        expect(all).toContain('✅');
        expect(all).toContain('⚠️');
        expect(all).toContain('拆解 · 1 本已拆解');
        expect(all).toContain('检索 · 向量库已加载 1 本');
    });
});

describe('渲染-3：降级只取最近 3 条（-17 的核心修正）', () => {
    beforeEach(() => stubCreateDiv());
    afterEach(() => vi.unstubAllGlobals());

    /** 取出降级那一行文案 */
    function degradationNote(banner: FakeEl): string | undefined {
        return texts(banner).find(t => t.startsWith('最近降级'));
    }

    it('5 条 → 只显示最近 3 条（d3/d4/d5），并带省略号', () => {
        const note = degradationNote(render(status({
            overall: 'warn',
            degradations: ['d1', 'd2', 'd3', 'd4', 'd5'],
        })));
        expect(note).toBeTruthy();
        expect(note).toContain('最近降级 5 次');
        expect(note).toContain('d3');
        expect(note).toContain('d4');
        expect(note).toContain('d5');
        expect(note).not.toContain('d1');
        expect(note).not.toContain('d2');
        expect(note).toContain('…');
    });

    it('4 条 → 显示 d2/d3/d4，最旧的 d1 不出现', () => {
        const note = degradationNote(render(status({
            overall: 'warn',
            degradations: ['d1', 'd2', 'd3', 'd4'],
        })));
        expect(note).toContain('d2');
        expect(note).toContain('d4');
        expect(note).not.toContain('d1');
        expect(note).toContain('…');
    });

    it('3 条 → 全部显示，不带省略号', () => {
        const note = degradationNote(render(status({
            overall: 'warn',
            degradations: ['d1', 'd2', 'd3'],
        })));
        expect(note).toContain('d1');
        expect(note).toContain('d3');
        expect(note).not.toContain('…');
    });

    it('1 条 → 显示该条', () => {
        const note = degradationNote(render(status({
            overall: 'warn',
            degradations: ['只有一条'],
        })));
        expect(note).toContain('只有一条');
    });

    it('无降级 → 不渲染降级说明', () => {
        const banner = render(status({ overall: 'ok', degradations: [] }));
        expect(degradationNote(banner)).toBeUndefined();
    });

    it('降级数组缺省 → 不渲染降级说明（防 undefined 崩溃）', () => {
        const banner = render(status({ overall: 'ok' }));
        expect(degradationNote(banner)).toBeUndefined();
    });
});
