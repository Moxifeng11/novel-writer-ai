/**
 * knowledge-rebuild-action.ts — 重建向量索引动作（U6，技术审计）
 *
 * 原实现分别在 mini-settings-modal 与 settings-tab 各有一份逐行复制的
 * 重建索引流程（确认弹窗 → rebuildIndex → 三态反馈），双入口存在行为
 * 漂移风险（改一处漏一处），统一收敛到本模块。
 */

import { App, Notice } from 'obsidian';
import { OperationConfirmModal } from './components/progress';
import { createLogger } from '@/shared/logger';


const log = createLogger('KnowledgeRebuildAction');

/**
 * 重建向量索引：带确认弹窗与完成/未初始化/失败三态反馈
 *
 * @param app - Obsidian 应用实例
 * @param plugin - 插件实例
 */
export async function rebuildKnowledgeIndexWithConfirm(
    app: App,
    plugin: unknown,
): Promise<void> {
    const confirmed = await OperationConfirmModal.confirm(app, {
        title: '重建向量索引',
        description: '确定要重建向量索引吗？这将重新扫描所有向量文件。',
        confirmText: '确认重建',
        cancelText: '取消',
    });
    if (!confirmed) return;
    try {
        new Notice('⏳ 正在重建索引...');
        const store = (plugin as any).knowledgeVectorStore;
        if (store && typeof store.rebuildIndex === 'function') {
            await store.rebuildIndex();
            new Notice('✅ 索引重建完成');
        } else {
            new Notice('⚠️ 向量存储未初始化');
        }
    } catch (e) {
        log.error('重建索引失败:', e);
        new Notice('❌ 重建索引失败');
    }
}
