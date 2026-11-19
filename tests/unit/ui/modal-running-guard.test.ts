/**
 * modal-running-guard.test.ts — 长任务弹窗「运行中关闭」确认（审计 A-14，P2 #19）
 *
 * 锁四件事：
 * 1. **非运行态**：close 直接放行，不弹确认（不改变既有行为）；
 * 2. **运行态**：先弹确认，确认前不关闭；选「关闭，任务继续」才真关；
 * 3. **选留**：弹窗保持打开，运行态仍为 true（任务继续、进度条仍在）；
 * 4. **幂等**：确认框开着时不叠加第二个；attach 两次只拦一次，解除可还原。
 *
 * OperationConfirmModal 用 vi.mock 替身（真 Modal 需要 Obsidian 环境）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ModalRunningGuard } from '../../../ui/components/modal-running-guard';

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

/** 让 then/catch/finally 链跑完（最少 4 个微任务） */
async function flushMicrotasks(): Promise<void> {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

beforeEach(() => {
    mockConfirm.mockReset();
    mockConfirm.mockImplementation(() => Promise.resolve(true));
});

describe('ModalRunningGuard（审计 A-14 / P2 #19）', () => {
    it('非运行态：close 直接放行，不弹确认', async () => {
        const guard = new ModalRunningGuard(() => false);
        const modal = makeFakeModal();
        guard.attach(modal as never, fakeApp);
        modal.close();
        expect(modal.closed).toBe(true);
        expect(mockConfirm).not.toHaveBeenCalled();
    });

    it('运行态：确认前不关闭，选「关闭，任务继续」才真关', async () => {
        let running = true;
        const guard = new ModalRunningGuard(() => running);
        const modal = makeFakeModal();
        guard.attach(modal as never, fakeApp);

        let resolveConfirm!: (value: boolean) => void;
        mockConfirm.mockImplementationOnce(() => new Promise<boolean>((resolve) => {
            resolveConfirm = resolve;
        }));

        modal.close();
        expect(modal.closed).toBe(false);
        expect(mockConfirm).toHaveBeenCalledTimes(1);

        resolveConfirm(true);
        await flushMicrotasks();
        expect(modal.closed).toBe(true);
        // 运行态由接入方持有：关闭弹窗不等于任务结束
        expect(running).toBe(true);
    });

    it('运行态选「留在弹窗」：不关闭，任务继续', async () => {
        const guard = new ModalRunningGuard(() => true);
        const modal = makeFakeModal();
        guard.attach(modal as never, fakeApp);

        mockConfirm.mockImplementationOnce(() => new Promise<boolean>((resolve) => {
            resolve(false);
        }));
        modal.close();
        await flushMicrotasks();
        expect(modal.closed).toBe(false);
    });

    it('确认框开着时连按 Esc 不叠加第二个确认框', async () => {
        const guard = new ModalRunningGuard(() => true);
        const modal = makeFakeModal();
        guard.attach(modal as never, fakeApp);

        let resolveConfirm!: (value: boolean) => void;
        mockConfirm.mockImplementationOnce(() => new Promise<boolean>((resolve) => {
            resolveConfirm = resolve;
        }));

        modal.close();
        modal.close();
        expect(mockConfirm).toHaveBeenCalledTimes(1);

        resolveConfirm(false);
        await flushMicrotasks();
        expect(modal.closed).toBe(false);
    });

    it('任务结束后再关闭不再询问', async () => {
        let running = true;
        const guard = new ModalRunningGuard(() => running);
        const modal = makeFakeModal();
        guard.attach(modal as never, fakeApp);

        running = false;
        modal.close();
        expect(modal.closed).toBe(true);
        expect(mockConfirm).not.toHaveBeenCalled();
    });

    it('attach 幂等：两次挂不叠加拦截', async () => {
        const guard = new ModalRunningGuard(() => true);
        const modal = makeFakeModal();
        guard.attach(modal as never, fakeApp);
        guard.attach(modal as never, fakeApp);

        mockConfirm.mockImplementationOnce(() => new Promise<boolean>((resolve) => {
            resolve(true);
        }));
        modal.close();
        expect(mockConfirm).toHaveBeenCalledTimes(1);
        await flushMicrotasks();
        expect(modal.closed).toBe(true);
    });

    it('解除拦截后 close 走原实现，不再询问', () => {
        const guard = new ModalRunningGuard(() => true);
        const modal = makeFakeModal();
        const detach = guard.attach(modal as never, fakeApp);
        detach();
        modal.close();
        expect(modal.closed).toBe(true);
        expect(mockConfirm).not.toHaveBeenCalled();
    });
});
