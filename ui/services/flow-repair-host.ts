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

/** 孤儿清理的返回契约（removed/skipped 如实上报） */
export interface BridgeCleanupResult {
    orphanCount: number;
    removed: string[];
    skipped: string[];
}

/** 强度修复的返回契约（按指纹 id 上报） */
export interface BridgeFixZeroResult {
    fixed: string[];
    failed: string[];
}

/** 桥接宿主 */
export interface FlowRepairBridge {
    revectorizeBook(bookId: string): Promise<BridgeRevectorizeResult>;
    reloadFingerprints(): Promise<BridgeReloadResult>;
    cleanupOrphanVectors(): Promise<BridgeCleanupResult>;
    fixZeroIntensity(): Promise<BridgeFixZeroResult>;
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

        /**
         * 孤儿向量清理（DSH-20261112-14/15 能力的 agent 入口）：
         * 先对账（知识库索引 ↔ 向量库已加载），存在孤儿才调 removeOrphanVectors
         * （confirmed 固化在桥内——审批已由 repair_flow 工具的 requestApproval 承载，
         * 桥不再二次弹窗，但 fail-closed 语义保持：removed/skipped 如实上报）。
         */
        async cleanupOrphanVectors(): Promise<BridgeCleanupResult> {
            const store = plugin.knowledgeVectorStore;
            const manager = plugin.knowledgeBaseManager;
            if (!store || typeof store.reconcileWithIndex !== 'function' || typeof store.removeOrphanVectors !== 'function') {
                return { orphanCount: 0, removed: [], skipped: ['向量库未初始化'] };
            }
            const books = manager ? await manager.getAllBooks() : [];
            const kbIds = books.map(b => b.id);
            const report = await store.reconcileWithIndex(kbIds);
            if (report.orphans.length === 0) {
                return { orphanCount: 0, removed: [], skipped: [] };
            }
            return await store.removeOrphanVectors(report.orphans, {
                confirmed: true,
                kbBookIds: kbIds,
            }) as BridgeCleanupResult;
        },

        /**
         * 强度为 0 的启用指纹恢复默认强度（阶段 E 深化）。
         * 只动项目层已启用的指纹；写入走 setIntensityConfig（先合并磁盘已有配置）。
         */
        async fixZeroIntensity(): Promise<BridgeFixZeroResult> {
            let activeProject = '';
            try {
                activeProject = plugin.getActiveProject() || '';
            } catch {
                // silent-ok: getActiveProject 失败等价于「无活动项目」，下方分支会以
                // failed['未激活项目'] 如实上报给 agent（用户可见），此处无需 Notice。
                activeProject = '';
            }
            if (!activeProject) {
                return { fixed: [], failed: ['未激活项目——强度修复只支持项目层指纹'] };
            }
            const { getStyleIntensityEngine } = await import('@/engine/style/style-intensity-engine');
            const intensityEngine = getStyleIntensityEngine();
            const library = StyleFingerprintLibrary.get(app, activeProject);
            const enabled = await library.getEnabledFingerprints(activeProject);
            await library.loadIntensityConfigs(activeProject);
            const fixed: string[] = [];
            const failed: string[] = [];
            for (const fp of enabled) {
                const config = library.getIntensityConfig(fp.id, activeProject);
                if (!intensityEngine.previewIntensity(config).disabled) continue;
                try {
                    await library.setIntensityConfig(fp.id, { ...config, globalIntensity: 1.0 }, activeProject);
                    fixed.push(fp.id);
                } catch (e) {
                    log.warn('[FlowRepairHost] 强度恢复失败:', fp.id, e);
                    failed.push(fp.id);
                }
            }
            return { fixed, failed };
        },
    };
}
