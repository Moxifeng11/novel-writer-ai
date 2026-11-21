/**
 * modal-running-guard.ts — 长任务弹窗「运行中关闭」确认（审计 A-14）
 *
 * ## 为什么需要
 *
 * 重建章节 / 继续创建 / 批量建章 / 备份元文件这类弹窗，点下按钮后进入长循环；
 * 此时按 Esc 或点遮罩，Obsidian 会直接 `close()`——弹窗消失，但任务**不会停止**
 * （循环持有 this 继续跑，进度条还在），用户完全无法判断「刚才是中断了还是后台继续」。
 *
 * ## 设计
 *
 * - 拦截时机与 `modal-dirty-guard` 一致：覆写实例 `close()`，在关闭发生前询问。
 * - 确认框复用 `OperationConfirmModal`（不造新确认框）。
 * - 运行态由接入方持有，构造时传 `isRunning` 回调：任务开始置 true、结束/finally 置 false。
 * - 非运行态关闭完全不拦（含所有正常关闭路径），不改变既有行为。
 *
 * ## 语义
 *
 * 确认 = 「关闭弹窗，任务继续在后台跑」（进度条仍在）；取消 = 「留在弹窗」。
 * 有意不做「关闭即取消」——四个任务都没有 AbortSignal 基建，假装取消会造成更危险的误解。
 */
import type { App, Modal } from 'obsidian';
import { OperationConfirmModal } from '@/ui/components/progress/operation-confirm-modal';
import { t } from '@/i18n';

/**
 * 长任务弹窗运行态关闭守卫。
 *
 * @example
 * ```ts
 * private running = false;
 * private runningGuard = new ModalRunningGuard(() => this.running);
 * // onOpen 里：
 * this.runningGuard.attach(this, this.app);
 * // 任务开始时：
 * this.running = true;
 * // 任务结束（finally）：
 * this.running = false;
 * ```
 */
export class ModalRunningGuard {
    private intercepted = false;
    /** 确认框是否已弹出：防 Esc 连按叠加出第二个确认框 */
    private confirming = false;

    /**
     * @param isRunning - 运行态探针，由接入方（Modal 实例）提供
     */
    constructor(private readonly isRunning: () => boolean) {}

    /**
     * 覆写 modal 的 close 实例方法：任务运行中先确认，用户选择「关闭」才真正关闭。
     *
     * 只拦一次（幂等）；返回解除函数以便测试或特殊场景还原。
     *
     * @param modal - 目标 Modal
     * @param app - 传给确认弹窗的 App
     * @returns 解除拦截的函数
     */
    attach(modal: Modal, app: App): () => void {
        if (this.intercepted) return () => undefined;
        this.intercepted = true;
        const originalClose = modal.close.bind(modal);
        const guarded = (): void => {
            if (!this.isRunning()) {
                originalClose();
                return;
            }
            if (this.confirming) return;
            this.confirming = true;
            void OperationConfirmModal.confirm(app, {
                title: t('modalRunningGuard.title'),
                description: t('modalRunningGuard.description'),
                confirmText: t('modalRunningGuard.background'),
                cancelText: t('modalRunningGuard.stay'),
            }).then((confirmed) => {
                if (confirmed) originalClose();
                // 选择留下：弹窗保持打开，任务继续，进度条仍在
            }).catch(() => { /* silent-ok: 确认框自身异常时保持弹窗打开，避免误关运行中的任务 */ })
                .finally(() => {
                    this.confirming = false;
                });
        };
        modal.close = guarded;
        return () => {
            modal.close = originalClose;
            this.intercepted = false;
        };
    }
}
