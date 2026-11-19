/**
 * knowledge-capability.ts — 知识库当前能力边界（纯函数）
 *
 * 「拆解完成」不等于「检索可用」：只有拆解完成且向量就绪的书才能进入检索注入。
 * 这里把书籍状态汇总成 UI 可直接展示的阶段与说明，避免视图各写一套判断。
 */
import { t } from '@/i18n';
import type { BookBasicInfo } from '@/services/knowledge-base-manager';
import type { CapabilityMetric, CapabilityStage } from './capability-banner';

/** 嵌入模型可用性快照（由视图异步检测后传入） */
export interface EmbeddingAvailabilitySnapshot {
    /** true=可用；false=不可用（最常见：本地 Ollama 没装/没启动） */
    available: boolean;
    /** 不可用原因（provider 返回或异常信息） */
    reason?: string;
    /** 当前 provider 描述，如 `ollama · nomic-embed-text` */
    providerLabel?: string;
}

/** 知识库能力摘要 */
export interface KnowledgeCapability {
    stage: CapabilityStage;
    metrics: CapabilityMetric[];
    notes: string[];
}

/**
 * 根据书籍列表计算知识库能力阶段。
 *
 * @param books - 全部书籍基础信息
 * @param embedding - 嵌入模型可用性（缺省=未检测，不给嵌入相关提示）
 * @returns 阶段、指标与说明
 */
export function computeKnowledgeCapability(
    books: readonly BookBasicInfo[],
    embedding?: EmbeddingAvailabilitySnapshot,
): KnowledgeCapability {
    const total = books.length;
    const completed = books.filter(book => book.breakdownStatus === 'completed').length;
    const processing = books.filter(book => book.breakdownStatus === 'processing').length;
    const vectorDone = books.filter(book => book.breakdownStatus === 'completed' && book.vectorStatus === 'done').length;
    const vectorFailed = books.filter(book => book.vectorStatus === 'failed').length;
    const vectorPending = books.filter(book => book.breakdownStatus === 'completed' && book.vectorStatus !== 'done' && book.vectorStatus !== 'failed').length;

    const metrics: CapabilityMetric[] = [
        { label: t('knowledgebase.capability.metrics.books'), value: total },
        { label: t('knowledgebase.capability.metrics.brokenDown'), value: completed },
        { label: t('knowledgebase.capability.metrics.vectorReady'), value: vectorDone },
        { label: t('knowledgebase.capability.metrics.pendingFailed'), value: vectorPending + vectorFailed },
    ];

    /**
     * 嵌入模型不可用时，把「为什么检索用不上」说清楚（v4.83.1）。
     *
     * 默认 embedding provider 是本地 Ollama，没装/没启动时向量化必然失败，
     * 但此前界面只显示「待处理/失败 2」这种数字，用户不知道要去配什么。
     */
    const embeddingNotes: string[] = [];
    if (embedding && !embedding.available) {
        const unavailable = embedding.providerLabel
            ? t('knowledgebase.capability.unavailableWithProvider', { provider: embedding.providerLabel })
            : t('knowledgebase.capability.unavailable');
        embeddingNotes.push(
            unavailable + (embedding.reason ? t('knowledgebase.capability.reasonSuffix', { reason: embedding.reason }) : ''),
            t('knowledgebase.capability.configureHint'),
        );
    }
    const withEmbedding = (notes: string[]): string[] => [...embeddingNotes, ...notes];

    if (total === 0) {
        return {
            stage: 'empty',
            metrics,
            notes: withEmbedding([t('knowledgebase.capability.empty')]),
        };
    }
    if (completed === 0) {
        return {
            stage: 'accumulating',
            metrics,
            notes: withEmbedding([
                processing > 0 ? t('knowledgebase.capability.accumulatingInProgress') : t('knowledgebase.capability.accumulating'),
            ]),
        };
    }
    if (vectorDone === 0) {
        return {
            stage: 'degraded',
            metrics,
            notes: withEmbedding([
                t('knowledgebase.capability.degraded1'),
                t('knowledgebase.capability.degraded2'),
            ]),
        };
    }
    if (vectorDone < completed || vectorFailed > 0) {
        return {
            stage: 'accumulating',
            metrics,
            notes: withEmbedding([
                t('knowledgebase.capability.partial', { ready: vectorDone, missing: completed - vectorDone }),
                t('knowledgebase.capability.partialHint'),
            ]),
        };
    }
    return {
        stage: 'ready',
        metrics,
        notes: withEmbedding([
            t('knowledgebase.capability.ready1'),
            t('knowledgebase.capability.ready2'),
        ]),
    };
}
