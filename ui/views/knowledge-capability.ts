/**
 * knowledge-capability.ts — 知识库当前能力边界（纯函数）
 *
 * 「拆解完成」不等于「检索可用」：只有拆解完成且向量就绪的书才能进入检索注入。
 * 这里把书籍状态汇总成 UI 可直接展示的阶段与说明，避免视图各写一套判断。
 */
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
        { label: '书籍', value: total },
        { label: '已拆解', value: completed },
        { label: '向量就绪', value: vectorDone },
        { label: '待处理/失败', value: vectorPending + vectorFailed },
    ];

    /**
     * 嵌入模型不可用时，把「为什么检索用不上」说清楚（v4.83.1）。
     *
     * 默认 embedding provider 是本地 Ollama，没装/没启动时向量化必然失败，
     * 但此前界面只显示「待处理/失败 2」这种数字，用户不知道要去配什么。
     */
    const embeddingNotes: string[] = [];
    if (embedding && !embedding.available) {
        const label = embedding.providerLabel ? `（当前：${embedding.providerLabel}）` : '';
        embeddingNotes.push(
            `未检测到可用的嵌入模型${label}：拆解结果无法生成向量，语义检索不可用。`
            + (embedding.reason ? `原因：${embedding.reason}` : ''),
            '请到 设置 → 向量化 配置嵌入模型（本地 Ollama 或云端 OpenAI/Doubao/Qwen）；'
            + '未配置时检索已退化为关键词匹配，仍可命中专有名词但语义召回较弱。',
        );
    }
    const withEmbedding = (notes: string[]): string[] => [...embeddingNotes, ...notes];

    if (total === 0) {
        return {
            stage: 'empty',
            metrics,
            notes: withEmbedding(['导入书籍并完成拆解后，知识库才会参与检索注入；空库不会影响普通写作，但精准模式无从参考。']),
        };
    }
    if (completed === 0) {
        return {
            stage: 'accumulating',
            metrics,
            notes: withEmbedding([`${processing > 0 ? '拆解进行中。' : ''}完成至少 1 本书的拆解后，才可进入检索注入。`]),
        };
    }
    if (vectorDone === 0) {
        return {
            stage: 'degraded',
            metrics,
            notes: withEmbedding([
                '拆解结果可查看/统计，但语义检索尚不可用。',
                '请配置 embedding 并在知识库中重建向量；向量失败的书不会参与检索。',
            ]),
        };
    }
    if (vectorDone < completed || vectorFailed > 0) {
        return {
            stage: 'accumulating',
            metrics,
            notes: withEmbedding([
                `已有 ${vectorDone} 本书可检索，${completed - vectorDone} 本尚未就绪。`,
                '增加已拆解且向量就绪的书籍，会提升检索覆盖；失败的向量需要重建。',
            ]),
        };
    }
    return {
        stage: 'ready',
        metrics,
        notes: withEmbedding([
            '知识库已参与上下文检索注入（普通/精准模式都会使用）。',
            '精准模式的风格相似度评分依赖知识库中的 style 维度向量；没有 style 样本时会直接放行。',
        ]),
    };
}
