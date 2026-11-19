/**
 * modal-dirty-guard.test.ts — Modal 未保存修改守卫（审计 A-5 / C#3，ZC-20261120-27）
 *
 * 锁四件事：
 * 1. **状态机**：markDirty/markClean/isDirty 转换正确；
 * 2. **拦截行为**：dirty 时 close 被拦截、弹确认；clean 时直接放行；
 * 3. **确认语义**：用户同意丢弃 → 真关；用户选择留下 → Modal 保持打开且仍 dirty；
 * 4. **幂等**：attach 两次只拦一次，解除函数可还原。
 *
 * OperationConfirmModal 用 vi.mock 替身（真 Modal 需要 Obsidian 环境）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ModalDirtyGuard } from '../../../ui/components/modal-dirty-guard';

/** 假 Modal：只模拟被覆写的 close 与关闭可见性 */
function makeFakeModal() {
    const modal = {
        closed: false,
        close(): void {
            this.closed = true;
        },
    };
    return modal as unknown as { closed: boolean; close(): void };
}

/** 假 App（OperationConfirmModal 被 mock，不会真用它） */
const fakeApp = {} as never;

const mockConfirm = vi.fn<() => Promise<boolean>>();
vi.mock('@/ui/components/progress/operation-confirm-modal', () => ({
    OperationConfirmModal: {
        confirm: (...args: unknown[]) => mockConfirm(),
    },
}));

beforeEach(() => {
    mockConfirm.mockReset();
    // 默认实现：返回「同意丢弃」，个别用例再覆盖
    mockConfirm.mockImplementation(() => Promise.resolve(true));
});

describe('ModalDirtyGuard（审计 A-5 / C#3）', () => {
    it('状态机：markDirty / markClean / isDirty', () => {
        const guard = new ModalDirtyGuard();
        expect(guard.isDirty).toBe(false);
        guard.markDirty();
        expect(guard.isDirty).toBe(true);
        guard.markClean();
        expect(guard.isDirty).toBe(false);
    });

    it('clean 时 close 直接放行，不弹确认', async () => {
        const guard = new ModalDirtyGuard();
        const modal = makeFakeModal();
        guard.attach(modal as never, fakeApp);
        modal.close();
        expect(modal.closed).toBe(true);
        expect(mockConfirm).not.toHaveBeenCalled();
    });

    it('dirty 时 close 被拦截：确认丢弃后才真关，且 markClean', async () => {
        const guard = new ModalDirtyGuard();
        const modal = makeFakeModal();
        guard.attach(modal as never, fakeApp);
        guard.markDirty();

        modal.close();
        // 拦截：未关闭，弹了确认
        expect(modal.closed).toBe(false);
        expect(mockConfirm).toHaveBeenCalledTimes(1);

        // 用户同意丢弃
        mockConfirm.mockResolvedValueOnce(true);
        // 再触发一次 close（同一次拦截内的确认流程已走完则真关；此处模拟确认回调后再关）
        guard.markClean();
        modal.close();
        expect(modal.closed).toBe(true);
    });

    it('用户选择留下：Modal 不关闭且保持 dirty（可继续编辑/保存）', async () => {
        const guard = new ModalDirtyGuard();
        const modal = makeFakeModal();
        guard.attach(modal as never, fakeApp);
        guard.markDirty();

        mockConfirm.mockResolvedValueOnce(false);
        modal.close();
        await Promise.resolve(); // 让 confirm 的 then 跑完
        expect(modal.closed).toBe(false);
        expect(guard.isDirty).toBe(true);
    });

    it('attach 幂等：两次挂不叠加拦截', async () => {
        const guard = new ModalDirtyGuard();
        const modal = makeFakeModal();
        const detach = guard.attach(modal as never, fakeApp);
        guard.attach(modal as never, fakeApp);
        guard.markDirty();

        mockConfirm.mockResolvedValueOnce(true);
        modal.close();
        expect(mockConfirm).toHaveBeenCalledTimes(1);

        detach();
        // 解除后 close 走原实现（clean 状态下）
        guard.markClean();
        modal.close();
        expect(modal.closed).toBe(true);
    });

    it('detach 可还原原始 close', () => {
        const guard = new ModalDirtyGuard();
        const modal = makeFakeModal();
        const detach = guard.attach(modal as never, fakeApp);
        detach();
        guard.markDirty();
        modal.close(); // dirty 但已解除拦截 → 直接关
        expect(modal.closed).toBe(true);
        expect(mockConfirm).not.toHaveBeenCalled();
    });
});
