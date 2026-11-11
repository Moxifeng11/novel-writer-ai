/**
 * flow-diagnosis-collectors.ts — 链路诊断的输入采集（阶段 C1）
 *
 * `engine/agent/harness/diagnose-tools.ts` 的判定是纯函数，输入由这里采集。
 * 放在 ui 层的原因：采集要访问 knowledgeBaseManager / vectorStore / 指纹库 /
 * 同人设定，这些都在宿主侧；engine 层不应该直接持有它们。
 *
 * 采集原则：**任何一项采集失败都不抛错**，按「该项未知/为空」计入判定——
 * 诊断工具本身不能因为某个服务没初始化就整体失败，否则 agent 又回到「不知道」。
 */

import type { App } from 'obsidian';
import type NovelWriterPlugin from '@/main';
import type { FlowDiagnosisDeps } from '@/engine/agent/harness/diagnose-tools';
import { getSharedEmbeddingProvider } from '@/engine/embedding/embedding-service';
import { StyleFingerprintLibrary } from '@/engine/style-fingerprint-library';
import { getStyleIntensityEngine } from '@/engine/style/style-intensity-engine';
import { CanonResearchService } from '@/services/canon-research-service';
import { formatFanficRulesForPrompt, readFanficRules } from '@/shared/fanfic-rules';
import { filterDegradationsBySource, getDegradationNotifier } from '@/shared/degradation-notifier';
import { summarizeVectorReconcile } from '@/engine/knowledge-vector-reconcile';
import { createLogger } from '@/shared/logger';

const log = createLogger('FlowDiagnosis');

/** 采集器宿主 */
interface CollectorHost {
    app: App;
    plugin: NovelWriterPlugin;
}

/**
 * 创建三条链路的采集器。
 *
 * @param host - app 与插件实例
 * @returns 可直接注入 `AgentHarnessEngineOptions.flowDiagnosis`
 */
export function createFlowDiagnosisDeps(host: CollectorHost): FlowDiagnosisDeps {
    const { app, plugin } = host;

    /** 当前项目（无项目时返回空串，采集器按「未就绪」处理） */
    const activeProject = (): string => {
        try {
            return plugin.getActiveProject() || '';
        } catch {
            return '';
        }
    };

    /** 嵌入是否可用（失败按不可用，不抛） */
    const embeddingReady = async (): Promise<boolean> => {
        try {
            const provider = getSharedEmbeddingProvider();
            if (!provider) return false;
            const availability = await provider.isAvailable();
            return availability.available === true;
        } catch {
            return false;
        }
    };

    return {
        async collectKnowledge() {
            const project = activeProject();
            let books: Array<{ breakdownStatus?: string; vectorStatus?: string }> = [];
            try {
                const manager = plugin.knowledgeBaseManager;
                if (manager) books = await manager.getAllBooks() as typeof books;
            } catch (e) {
                log.warn('[FlowDiagnosis] 读取知识库书籍失败:', e);
            }
            const store = plugin.knowledgeVectorStore;
            let storeLoadedBooks = 0;
            let storeReady = false;
            try {
                if (store) {
                    storeLoadedBooks = store.getLoadedBookIds().length;
                    storeReady = typeof store.isLoaded === 'function' ? store.isLoaded() : false;
                }
            } catch (e) {
                log.warn('[FlowDiagnosis] 读取向量库状态失败:', e);
            }
            // DSH-20261112-14：对账结果作为降级提示——「已加载 N 本」必须能反映
            // 「其中 M 本是孤儿」，否则诊断与界面都停在假绿。
            // 审计 #A8：先触发 reconcile（内部 ensureLoaded）再读 loaded 状态，
            // 避免首次诊断同时报「已加载 0 本/未就绪」+「1 本孤儿」的自相矛盾快照。
            let orphanNote: string | null = null;
            const kbIds = books.map(b => (b as unknown as { id: string }).id);
            try {
                const reconcile = await (store as unknown as { reconcileWithIndex?: (ids: string[]) => Promise<{ orphans: string[]; missing: string[]; healthy: string[] }> })?.reconcileWithIndex?.(kbIds);
                if (reconcile) {
                    orphanNote = summarizeVectorReconcile(reconcile);
                    storeLoadedBooks = (store as unknown as { getLoadedBookIds?: () => string[] })?.getLoadedBookIds?.().length ?? storeLoadedBooks;
                }
            } catch (e) {
                log.warn('[FlowDiagnosis] 向量对账失败:', e);
            }
            const baseDegradations = filterDegradationsBySource(
                getDegradationNotifier().getEvents(),
                ['vector', 'injection'],
            ).map(e => e.reason);
            return {
                bookTotal: books.length,
                breakdownCompleted: books.filter(b => b.breakdownStatus === 'completed').length,
                vectorDone: books.filter(b => b.vectorStatus === 'done').length,
                vectorFailed: books.filter(b => b.vectorStatus === 'failed').length,
                embeddingReady: await embeddingReady(),
                storeLoadedBooks,
                storeReady,
                degradations: orphanNote ? [orphanNote, ...baseDegradations] : baseDegradations,
            };
        },

        async collectStyle() {
            const project = activeProject();
            let templateCount = 0;
            let globalCount = 0;
            let projectCount = 0;
            let enabledCount = 0;
            let intensityDisabledCount = 0;
            try {
                const library = StyleFingerprintLibrary.get(app, project || undefined);
                const [template, global, projectList] = await Promise.all([
                    library.loadTemplate(),
                    library.loadGlobal(),
                    project ? library.loadProject() : Promise.resolve([]),
                ]);
                templateCount = template.length;
                globalCount = global.length;
                projectCount = projectList.length;
                const enabled = await library.getEnabledFingerprints(project || undefined);
                enabledCount = enabled.length;
                // 强度必须先加载：同步 getter 未加载时恒返回默认 1.0（阶段 B3 教训）
                if (project) {
                    await library.loadIntensityConfigs(project);
                    const intensityEngine = getStyleIntensityEngine();
                    intensityDisabledCount = enabled.filter(fp => {
                        const config = library.getIntensityConfig(fp.id, project);
                        return intensityEngine.previewIntensity(config).disabled;
                    }).length;
                }
            } catch (e) {
                log.warn('[FlowDiagnosis] 读取指纹库状态失败:', e);
            }
            return {
                templateCount,
                globalCount,
                projectCount,
                enabledCount,
                intensityDisabledCount,
                embeddingReady: await embeddingReady(),
                degradations: filterDegradationsBySource(
                    getDegradationNotifier().getEvents(),
                    ['vector'],
                ).map(e => e.reason),
            };
        },

        async collectConstraint() {
            const project = activeProject();
            if (!project) {
                return {
                    sourceCount: 0,
                    settingExists: false,
                    reviewStatus: 'none' as const,
                    bound: false,
                    rulesHasContent: false,
                };
            }
            let sourceCount = 0;
            let settingExists = false;
            let reviewStatus: 'approved' | 'pending' | 'rejected' | 'legacy' | 'none' = 'none';
            let bound = false;
            let rulesHasContent = false;
            try {
                const rules = await readFanficRules(app, project);
                bound = Boolean(rules.path);
                if (rules.path) {
                    settingExists = rules.loadError !== 'missing-file';
                    reviewStatus = rules.reviewStatus ?? 'none';
                    rulesHasContent = formatFanficRulesForPrompt(rules).length > 0;
                }
                // 考据来源：按作品名找缓存（作品名来自已绑定设定，缺失时无从定位）
                if (rules.workName) {
                    const research = new CanonResearchService(app, plugin);
                    const cached = await research.loadCache(project, rules.workName);
                    sourceCount = cached?.sources?.length ?? 0;
                }
            } catch (e) {
                log.warn('[FlowDiagnosis] 读取同人设定状态失败:', e);
            }
            return {
                sourceCount,
                settingExists,
                reviewStatus,
                bound,
                rulesHasContent,
                degradations: filterDegradationsBySource(
                    getDegradationNotifier().getEvents(),
                    ['llm', 'injection'],
                ).map(e => e.reason),
            };
        },
    };
}
