/**
 * modal-dirty-guard.ts — Modal 未保存修改的关闭确认（i18n engine 分层④，审计 A-5 / C#3）
 *
 * ## 为什么需要
 *
 * 全库 106 个有 `onClose` 的文件里 **0 个**检查未保存状态；42 个含 textarea 的 Modal，
 * Esc / 点外部一律静默丢弃。用户在 `writing-style-modal` 八节表单里写的内容，
 * 误触 Esc 全部丢失且不可恢复。
 *
 * ## 设计
 *
 * - **拦截时机**：Obsidian 的 Esc / 点外部都会走 `modal.close()`——覆写实例的 `close()`
 *   即可在关闭发生**前**拦截（onClose 时 Modal 已关，事后确认无法恢复内容）。
 * - **确认机制**：复用 `OperationConfirmModal`（promise 风格），不造第五套确认框（审计 A-6）。
 * - **接入成本**：三行——创建 guard、输入事件里 `markDirty()`、保存/取消成功后 `markClean()`。
 *   `attach()` 负责覆写 close，其余不变。
 *
 * ## 语义
 *
 * - 「取消」按钮是用户**明确**放弃：接入方在取消回调里先 `markClean()` 再 close，不重复询问。
 * - Esc / 点外部 = 可能误触：dirty 时必须询问。
 * - 保存成功 = 内容已落盘：`markClean()` 后 close 不询问。
 */
import type { App, Modal } from 'obsidian';
import { OperationConfirmModal } from '@/ui/components/progress/operation-confirm-modal';
import { t } from '@/i18n';

/**
 * Modal 未保存修改守卫。
 *
 * @example
 * ```ts
 * private dirtyGuard = new ModalDirtyGuard();
 * // onOpen 里：
 * this.dirtyGuard.attach(this, this.app);
 * // 输入事件里：
 * this.dirtyGuard.markDirty();
 * // 保存成功 / 用户明确取消后：
 * this.dirtyGuard.markClean();
 * ```
 */
export class ModalDirtyGuard {
    private dirty = false;
    private closeIntercepted = false;
    /** 确认框是否已弹出：防 Esc 连按叠加出第二个确认框 */
    private confirming = false;

    /** 有任何输入/变更时调用 */
    markDirty(): void {
        this.dirty = true;
    }

    /** 保存成功 / 用户明确取消后调用（此后 close 不再询问） */
    markClean(): void {
        this.dirty = false;
    }

    get isDirty(): boolean {
        return this.dirty;
    }

    /**
     * 覆写 modal 的 close 实例方法：dirty 时先弹确认，用户同意丢弃才真正关闭。
     *
     * 只拦一次（幂等）；返回一个解除函数以便测试或特殊场景还原。
     *
     * @param modal - 目标 Modal
     * @param app - 传给确认弹窗的 App
     * @returns 解除拦截的函数
     */
    attach(modal: Modal, app: App): () => void {
        if (this.closeIntercepted) return () => undefined;
        this.closeIntercepted = true;
        const originalClose = modal.close.bind(modal);
        const guarded = (): void => {
            if (!this.dirty) {
                originalClose();
                return;
            }
            // 确认框已经开着：忽略重复的 Esc / 点外部，避免叠加第二个确认框
            if (this.confirming) return;
            this.confirming = true;
            void OperationConfirmModal.confirm(app, {
                title: t('modalGuard.title'),
                description: t('modalGuard.description'),
                confirmText: t('modalGuard.discard'),
                cancelText: t('modalGuard.keep'),
            }).then((discard) => {
                if (discard) {
                    this.markClean();
                    originalClose();
                }
                // 用户选择留下：什么都不做，Modal 保持打开，可继续编辑/保存
            }).catch(() => { /* silent-ok: 确认框自身异常时保持弹窗打开，宁可让用户再关一次也不静默丢内容 */
                // 关闭已取消，保持 dirty 与打开状态
            }).finally(() => {
                this.confirming = false;
            });
        };
        modal.close = guarded as typeof modal.close;
        return () => {
            modal.close = originalClose;
            this.closeIntercepted = false;
        };
    }
}
