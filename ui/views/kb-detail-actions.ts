/**
 * kb-detail-actions.ts — 知识库详情页操作按钮区的纯 DOM 构建（自 knowledge-base-view 抽出）
 *
 * 只负责「给定一本书 + 操作容器 + 宿主能力，构建出操作按钮」这一件事：
 *  - 按拆解状态渲染对应按钮：pending 开始 / failed·completed 重新拆解 /
 *    processing 强制取消 / interrupted 恢复与清除
 *  - 常驻按钮：维度归类、编辑、删除
 *  - 自身不持有任何状态：拆解启停、状态写入、二次确认弹窗与详情刷新全部通过
 *    KbDetailActionHost 回调宿主（KnowledgeBaseView），保证与抽取前行为完全一致
 */

import { Notice, type App } from 'obsidian';
import type { BookBasicInfo, KnowledgeBaseManager } from '@/services/knowledge-base-manager';
import type { DeconstructionScheduler } from '@/engine/deconstruction-scheduler';
import { OperationConfirmModal } from '@/ui/components/progress';
import { createLogger } from '@/shared/logger';

const log = createLogger('KbDetailActions');

/**
 * 详情页操作按钮构建所需的宿主能力集合。
 *
 * 由 KnowledgeBaseView 以自身方法/字段注入，构建函数不直接依赖视图实例。
 */
export interface KbDetailActionHost {
    /** 当前应用实例（强制取消前的二次确认弹窗需要）。 */
    readonly app: App;
    /** 知识库管理器（恢复/清除/强制取消时写入拆解状态；为 null 时跳过写入）。 */
    readonly kbManager: KnowledgeBaseManager | null;
    /** 拆解调度器（强制取消时查询并取消活动任务；可为 null）。 */
    readonly deconstructionScheduler: DeconstructionScheduler | null;
    /** 当前是否处于「启动拆解中」状态（决定开始/重试按钮的文案与禁用态）。 */
    readonly isStartingDeconstruction: boolean;
    /** 开始拆解指定书籍（宿主内含调度器校验与耗时确认弹窗）。 */
    startDeconstruction(book: BookBasicInfo): Promise<void>;
    /** 重新拆解指定书籍（清除已有结果后重跑）。 */
    restartDeconstruction(book: BookBasicInfo): Promise<void>;
    /** 拆解状态变更后刷新操作区与详情（仅当视图未关闭且该书仍被选中时）。 */
    refreshDetailIfSelected(book: BookBasicInfo): void;
    /** 按本地规则生成题材/节奏/情绪等维度标签并写入自定义标签。 */
    applyDimensionTags(book: BookBasicInfo): Promise<void>;
    /** 打开书籍信息编辑弹窗。 */
    openEditModal(book: BookBasicInfo): void;
    /** 删除指定书籍及其拆解数据。 */
    deleteBook(book: BookBasicInfo): Promise<void>;
}

/**
 * 构建详情页操作按钮区 DOM（结构、类名与事件绑定与抽取前完全一致）。
 *
 * @param book 当前详情书籍（interrupted 清除状态时会被就地重置进度/错误字段）
 * @param actionsEl 操作按钮容器（将被清空并重建）
 * @param host 宿主能力回调集合（拆解控制 / 状态写入 / 弹窗与刷新）
 */
export function buildKbDetailActionButtons(book: BookBasicInfo, actionsEl: HTMLElement, host: KbDetailActionHost): void {
    actionsEl.empty();

    if (book.breakdownStatus === 'pending') {
        const startBtn = actionsEl.createEl('button', {
            text: host.isStartingDeconstruction ? '⏳ 准备中...' : '🚀 开始拆解',
            cls: 'nw-btn nw-btn-primary nw-btn-sm',
            attr: { 'data-action': 'start-deconstruction', title: '拆解本书：分段 + 统计 + 向量增强，提取多维度写作特征' }
        });
        startBtn.disabled = host.isStartingDeconstruction;
        startBtn.style.opacity = host.isStartingDeconstruction ? '0.7' : '1';
        startBtn.style.cursor = host.isStartingDeconstruction ? 'not-allowed' : 'pointer';
        startBtn.addEventListener('click', () => {
            host.startDeconstruction(book).catch(err => {
                log.error('开始拆解失败:', err);
            });
        });
    } else if (book.breakdownStatus === 'failed') {
        const retryBtn = actionsEl.createEl('button', {
            text: host.isStartingDeconstruction ? '⏳ 准备中...' : '🔄 重新拆解',
            cls: 'nw-btn nw-btn-primary nw-btn-sm',
            attr: { 'data-action': 'restart-deconstruction', title: '上次拆解失败，重新开始拆解' }
        });
        retryBtn.disabled = host.isStartingDeconstruction;
        retryBtn.style.opacity = host.isStartingDeconstruction ? '0.7' : '1';
        retryBtn.style.cursor = host.isStartingDeconstruction ? 'not-allowed' : 'pointer';
        retryBtn.addEventListener('click', () => {
            host.restartDeconstruction(book).catch(err => {
                log.error('重新拆解失败:', err);
            });
        });
    } else if (book.breakdownStatus === 'completed') {
        const reBtn = actionsEl.createEl('button', {
            text: host.isStartingDeconstruction ? '⏳ 准备中...' : '🔄 重新拆解',
            cls: 'nw-btn nw-btn-secondary nw-btn-sm',
            attr: { 'data-action': 'restart-deconstruction', title: '清除已有拆解结果，重新拆解' }
        });
        reBtn.disabled = host.isStartingDeconstruction;
        reBtn.style.opacity = host.isStartingDeconstruction ? '0.7' : '1';
        reBtn.style.cursor = host.isStartingDeconstruction ? 'not-allowed' : 'pointer';
        reBtn.addEventListener('click', () => {
            host.restartDeconstruction(book).catch(err => {
                log.error('重新拆解失败:', err);
            });
        });
    } else if (book.breakdownStatus === 'processing') {
        const processingBtn = actionsEl.createEl('button', {
            text: '⏳ 拆解中...',
            cls: 'nw-btn nw-btn-secondary nw-btn-sm'
        });
        processingBtn.disabled = true;
        processingBtn.addClass('nw-disabled-look-soft');

        const forceCancelBtn = actionsEl.createEl('button', {
            text: '⚠️ 强制取消',
            cls: 'nw-btn nw-btn-sm',
            attr: { style: 'margin-left: 8px; font-size: 12px; color: var(--nw-danger-soft);', title: '中断当前拆解任务（已完成维度保留）' }
        });
        forceCancelBtn.onclick = async () => {
            try {
                const confirmed = await OperationConfirmModal.confirm(host.app, {
                    title: '强制取消拆解',
                    description: '强制取消将中断当前拆解任务。已完成的维度会保留，但未完成的维度需要重新拆解。\n\n确定要强制取消吗？',
                    confirmText: '强制取消',
                    cancelText: '不取消',
                    rememberKey: 'force-cancel-deconstruction'
                });
                if (confirmed) {
                    if (!host.kbManager) return;
                    const activeTasks = host.deconstructionScheduler?.getActiveTasks() || [];
                    const bookTask = activeTasks.find(t => t.bookId === book.id);
                    if (bookTask) {
                        await host.deconstructionScheduler?.cancelTask(bookTask.id);
                    }
                    await host.kbManager.setBreakdownStatus(book.id, 'interrupted', book.breakdownProgress);
                    host.refreshDetailIfSelected(book);
                }
            } catch (e) {
                log.error('强制取消拆解失败:', e);
                new Notice(`强制取消失败: ${e instanceof Error ? e.message : String(e)}`);
            }
        };
    } else if (book.breakdownStatus === 'interrupted') {
        const resumeBtn = actionsEl.createEl('button', {
            text: '🔄 恢复拆解',
            cls: 'nw-btn nw-btn-warning nw-btn-sm',
            attr: { title: '从上次中断处继续拆解（已完成的段不再重跑）' }
        });
        resumeBtn.onclick = async () => {
            try {
                if (!host.kbManager) return;
                await host.kbManager.setBreakdownStatus(book.id, 'pending');
                await host.startDeconstruction(book);
            } catch (e) {
                log.error('恢复拆解失败:', e);
                new Notice(`恢复拆解失败: ${e instanceof Error ? e.message : String(e)}`);
            }
        };

        const clearBtn = actionsEl.createEl('button', {
            text: '🗑️ 清除状态',
            cls: 'nw-btn nw-btn-secondary nw-btn-sm',
            attr: { title: '清除拆解状态与进度（不删除书籍）' }
        });
        clearBtn.onclick = async () => {
            try {
                if (!host.kbManager) return;
                await host.kbManager.setBreakdownStatus(book.id, 'pending', undefined, undefined);
                book.breakdownProgress = undefined;
                book.breakdownError = undefined;
                host.refreshDetailIfSelected(book);
            } catch (e) {
                log.error('清除状态失败:', e);
                new Notice(`清除状态失败: ${e instanceof Error ? e.message : String(e)}`);
            }
        };
    }

    const editBtn = actionsEl.createEl('button', {
        text: '🏷️ 维度归类',
        cls: 'nw-btn nw-btn-secondary nw-btn-sm',
        attr: { title: '按本地规则生成题材/节奏/情绪等维度标签并写入自定义标签' }
    });
    editBtn.addEventListener('click', () => {
        void host.applyDimensionTags(book);
    });

    const editInfoBtn = actionsEl.createEl('button', {
        text: '✏️ 编辑',
        cls: 'nw-btn nw-btn-secondary nw-btn-sm',
        attr: { title: '编辑书籍信息' }
    });
    editInfoBtn.addEventListener('click', () => host.openEditModal(book));
    const deleteBtn = actionsEl.createEl('button', {
        text: '🗑️ 删除',
        cls: 'nw-btn nw-btn-danger nw-btn-sm',
        attr: { title: '删除该书籍及其拆解数据' }
    });
    deleteBtn.addEventListener('click', () => {
        host.deleteBook(book).catch(err => { // silent-ok: handleDeleteBook 内部已有失败 Notice
            log.error('删除书籍失败:', err);
        });
    });
}
