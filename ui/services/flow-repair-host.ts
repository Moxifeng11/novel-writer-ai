/**
 * flow-repair-host.ts — repair_flow 的宿主桥（DSH-20261112-16，阶段 E 接线）
 *
 * 与 `flow-diagnosis-collectors.ts` 同一模式：engine 层的 `repair_flow` 工具
 * 只认函数依赖（revectorizeBook / reloadFingerprints），宿主能力由这里桥接。
 *
 * - `revectorizeBook`：桥到 `DeconstructionScheduler.revectorizeBook`
 *   （与知识库视图「重试向量化」同语义：不重新拆解、不调用生成模型）；
 *   书名由知识库管理器补齐，调度器缺失/书不存在/执行异常一律如实 `ok:false`。
 * - `reloadFingerprints`：桥到 `StyleFingerprintLibrary` 三层 load（模板/全局/项目），
 *   返回各层条数供修复结果展示。
 *
 * 审批不在此处：engine 侧统一注入（options.requestApproval ?? port.confirmDangerousAction），
 * 工具自身 fail-closed。
 */

import type { App } from 'obsidian';
import type NovelWriterPlugin from '@/main';
import { StyleFingerprintLibrary } from '@/engine/style-fingerprint-library';
import { createLogger } from '@/shared/logger';

const log = createLogger('FlowRepairHost');

/** revectorizeBook 的返回契约（与 repair-tools 的 RevectorizeBookResult 兼容） */
export interface BridgeRevectorizeResult {
    ok: boolean;
    detail?: string;
}

/** 重载指纹库的返回契约 */
export interface BridgeReloadResult {
    template: number;
    global: number;
    project: number;
}

/** 桥接宿主 */
export interface FlowRepairBridge {
    revectorizeBook(bookId: string): Promise<BridgeRevectorizeResult>;
    reloadFingerprints(): Promise<BridgeReloadResult>;
}

/**
 * 创建 repair_flow 的宿主桥。
 *
 * @param host - app 与插件实例
 * @returns 可直接作为 `AgentHarnessEngineOptions.flowRepair` 的依赖集合
 */
export function createFlowRepairHost(host: { app: App; plugin: NovelWriterPlugin }): FlowRepairBridge {
    const { app, plugin } = host;

    return {
        async revectorizeBook(bookId: string): Promise<BridgeRevectorizeResult> {
            const scheduler = plugin.deconstructionScheduler;
            if (!scheduler || typeof scheduler.revectorizeBook !== 'function') {
                return { ok: false, detail: '拆解调度器未初始化' };
            }
            let bookName = bookId;
            try {
                const book = await plugin.knowledgeBaseManager?.getBook(bookId);
                if (!book) {
                    return { ok: false, detail: `知识库中未找到书籍 ${bookId}` };
                }
                bookName = book.name;
            } catch (e) {
                return { ok: false, detail: `查询书籍信息失败：${e instanceof Error ? e.message : String(e)}` };
            }
            try {
                await scheduler.revectorizeBook(bookId, bookName);
                return { ok: true, detail: `《${bookName}》向量已重算` };
            } catch (e) {
                const message = e instanceof Error ? e.message : String(e);
                log.warn('[FlowRepairHost] 重向量化失败:', e);
                return { ok: false, detail: message };
            }
        },

        async reloadFingerprints(): Promise<BridgeReloadResult> {
            let activeProject = '';
            try {
                activeProject = plugin.getActiveProject() || '';
            } catch {
                activeProject = '';
            }
            const library = StyleFingerprintLibrary.get(app, activeProject || undefined);
            const template = await library.loadTemplate();
            const global = await library.loadGlobal();
            const projectList = activeProject ? await library.loadProject() : [];
            return {
                template: template.length,
                global: global.length,
                project: projectList.length,
            };
        },
    };
}
