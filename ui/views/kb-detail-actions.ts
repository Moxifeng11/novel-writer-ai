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
import { resolveDetailActionButtons } from './kb-panels-logic';

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

    // 状态 → 按钮配置的规则在 kb-panels-logic（纯函数，有单测）；此处只做渲染与 handler 绑定
    const buttons = resolveDetailActionButtons(book.breakdownStatus, host.isStartingDeconstruction);

    for (const config of buttons) {
        const isPrimaryAction = config.key === 'start-deconstruction' || config.key === 'restart-deconstruction';
        const attr: Record<string, string> = {};
        if (isPrimaryAction) attr['data-action'] = config.key;
        if (config.title) attr.title = config.title;

        if (config.key === 'force-cancel') {
            attr.style = 'margin-left: 8px; font-size: 12px; color: var(--nw-danger-soft);';
        }

        const btn = actionsEl.createEl('button', {
            text: config.text,
            cls: config.cls,
            attr,
        });

        if (config.key === 'processing-indicator') {
            btn.disabled = true;
            btn.addClass('nw-disabled-look-soft');
            continue;
        }

        if (config.key === 'force-cancel') {
            btn.onclick = async () => {
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
            continue;
        }

        if (config.key === 'resume-deconstruction') {
            btn.onclick = async () => {
                try {
                    if (!host.kbManager) return;
                    await host.kbManager.setBreakdownStatus(book.id, 'pending');
                    await host.startDeconstruction(book);
                } catch (e) {
                    log.error('恢复拆解失败:', e);
                    new Notice(`恢复拆解失败: ${e instanceof Error ? e.message : String(e)}`);
                }
            };
            continue;
        }

        if (config.key === 'clear-status') {
            btn.onclick = async () => {
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
            continue;
        }

        if (isPrimaryAction) {
            // 开始/重新拆解：在途时禁用并降透明度（原行为，含 disabled=true 时的 not-allowed 光标）
            btn.disabled = config.disabled;
            btn.style.opacity = config.disabled ? '0.7' : '1';
            btn.style.cursor = config.disabled ? 'not-allowed' : 'pointer';
            btn.addEventListener('click', () => {
                if (config.key === 'start-deconstruction') {
                    host.startDeconstruction(book).catch(err => {
                        log.error('开始拆解失败:', err);
                    });
                } else {
                    host.restartDeconstruction(book).catch(err => {
                        log.error('重新拆解失败:', err);
                    });
                }
            });
            continue;
        }

        if (config.key === 'dimension-tags') {
            btn.addEventListener('click', () => {
                void host.applyDimensionTags(book);
            });
            continue;
        }

        if (config.key === 'edit') {
            btn.addEventListener('click', () => host.openEditModal(book));
            continue;
        }

        btn.addEventListener('click', () => {
            host.deleteBook(book).catch(err => { // silent-ok: handleDeleteBook 内部已有失败 Notice
                log.error('删除书籍失败:', err);
            });
        });
    }
}
