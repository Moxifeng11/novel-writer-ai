import { describe, it, expect, vi } from 'vitest';
import { onNodeDoc, resolveNodeDoc, resolveNodeWindow } from '../../../shared/dom-window';

/**
 * 跨窗口（popout）安全的 document 监听（v4.77.0）。
 *
 * 背景：Obsidian 允许把 ItemView / Modal 放进第二窗口，全局 `document` 仍指向主窗口，
 * 绑定在上面的 pointermove/mousedown 收不到 popout 事件，表现为「浮窗拖不动 /
 * 点击外部不收下拉」。这里钉住三件事：优先用节点自身 doc、回退 ownerDocument、
 * add/remove 落在同一个 document（否则关闭时会泄漏）。
 */

function makeDoc() {
    return {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    } as unknown as Document;
}

describe('resolveNodeDoc', () => {
    it('优先取节点自身的 doc（Obsidian 注入，窗口迁移后会跟着变）', () => {
        const doc = makeDoc();
        const other = makeDoc();
        expect(resolveNodeDoc({ doc, ownerDocument: other })).toBe(doc);
    });

    it('没有 doc 时回退 ownerDocument', () => {
        const doc = makeDoc();
        expect(resolveNodeDoc({ ownerDocument: doc })).toBe(doc);
    });

    it('两者都取不到（游离节点/测试替身）返回 null', () => {
        expect(resolveNodeDoc({})).toBeNull();
        expect(resolveNodeDoc(null)).toBeNull();
        expect(resolveNodeDoc(undefined)).toBeNull();
    });
});

describe('resolveNodeWindow', () => {
    it('优先取节点自身的 win（1.6+ 多窗口）', () => {
        const win = { setTimeout: vi.fn() } as unknown as Window;
        const other = { setTimeout: vi.fn() } as unknown as Window;
        expect(resolveNodeWindow({ win, ownerDocument: { defaultView: other } as unknown as Document })).toBe(win);
    });

    it('1.4.4 无 win 时回退 doc.defaultView', () => {
        const view = { setTimeout: vi.fn() } as unknown as Window;
        expect(resolveNodeWindow({ doc: { defaultView: view } as unknown as Document })).toBe(view);
    });

    it('都取不到时回退全局 window', () => {
        const fallback = (typeof window === 'undefined' ? globalThis : window) as unknown as Window;
        expect(resolveNodeWindow({})).toBe(fallback);
        expect(resolveNodeWindow(null)).toBe(fallback);
        expect(resolveNodeWindow(undefined)).toBe(fallback);
    });
});

describe('onNodeDoc', () => {
    it('在所属 document 绑定，并用同一 document 解绑', () => {
        const doc = makeDoc();
        const handler = vi.fn();
        const dispose = onNodeDoc({ doc }, 'mousedown', handler, true);

        expect(doc.addEventListener).toHaveBeenCalledTimes(1);
        expect(doc.addEventListener).toHaveBeenCalledWith('mousedown', handler, true);

        dispose();
        expect(doc.removeEventListener).toHaveBeenCalledTimes(1);
        expect(doc.removeEventListener).toHaveBeenCalledWith('mousedown', handler, true);
    });

    it('popout 场景：绑定与解绑都落在 popout 的文档上，不碰主文档', () => {
        const mainDoc = makeDoc();
        const popoutDoc = makeDoc();
        const handler = vi.fn();

        const dispose = onNodeDoc({ doc: popoutDoc }, 'pointerup', handler);
        dispose();

        expect(popoutDoc.addEventListener).toHaveBeenCalledTimes(1);
        expect(popoutDoc.removeEventListener).toHaveBeenCalledTimes(1);
        expect(mainDoc.addEventListener).not.toHaveBeenCalled();
        expect(mainDoc.removeEventListener).not.toHaveBeenCalled();
    });

    it('无 document 时返回 noop，不抛错', () => {
        const handler = vi.fn();
        const dispose = onNodeDoc({}, 'click', handler);

        expect(() => dispose()).not.toThrow();
        expect(handler).not.toHaveBeenCalled();
    });
});
