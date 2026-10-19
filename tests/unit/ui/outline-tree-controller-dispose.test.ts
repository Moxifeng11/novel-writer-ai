/**
 * OutlineTreeController — S1 文档级监听解绑回归
 *
 * 覆盖：`dispose()` 解绑 `document` 级 click / keydown 监听（此前为匿名监听、无法移除，
 * 且 `render()` 每次调用都会新增一份 → 重复渲染叠加泄漏）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OutlineTreeController } from '../../../ui/full-writer/outline-tree-controller';

describe('OutlineTreeController — dispose() 解绑文档级监听', () => {
    let removeSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        removeSpy = vi.fn();
        // node 环境无 DOM，注入仅含监听 API 的最小 document 垫片
        (globalThis as unknown as { document: unknown }).document = {
            addEventListener: vi.fn(),
            removeEventListener: removeSpy,
            activeElement: null,
        };
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('dispose() 解绑 click 与 keydown 监听，并清空句柄', () => {
        const ctrl = new OutlineTreeController({} as never, () => 'proj');
        const onClick = () => {};
        const onKey = () => {};
        (ctrl as unknown as Record<string, unknown>)._onDocumentClick = onClick;
        (ctrl as unknown as Record<string, unknown>)._onDocumentKeyDown = onKey;

        ctrl.dispose();

        expect(removeSpy).toHaveBeenCalledWith('click', onClick);
        expect(removeSpy).toHaveBeenCalledWith('keydown', onKey);
        expect((ctrl as unknown as Record<string, unknown>)._onDocumentClick).toBeNull();
        expect((ctrl as unknown as Record<string, unknown>)._onDocumentKeyDown).toBeNull();
    });

    it('dispose() 幂等：句柄已置空后重复调用不再解绑', () => {
        const ctrl = new OutlineTreeController({} as never, () => 'proj');
        (ctrl as unknown as Record<string, unknown>)._onDocumentClick = () => {};
        (ctrl as unknown as Record<string, unknown>)._onDocumentKeyDown = () => {};

        ctrl.dispose();
        removeSpy.mockClear();
        ctrl.dispose();

        expect(removeSpy).not.toHaveBeenCalled();
    });

    it('无句柄时 dispose() 不抛异常', () => {
        const ctrl = new OutlineTreeController({} as never, () => 'proj');
        expect(() => ctrl.dispose()).not.toThrow();
    });
});
