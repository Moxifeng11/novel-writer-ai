/**
 * knowledge-capability.ts — 知识库当前能力边界（纯函数）
 *
 * 「拆解完成」不等于「检索可用」：只有拆解完成且向量就绪的书才能进入检索注入。
 * 这里把书籍状态汇总成 UI 可直接展示的阶段与说明，避免视图各写一套判断。
 */
import type { BookBasicInfo } from '@/services/knowledge-base-manager';
import type { CapabilityMetric, CapabilityStage } from './capability-banner';

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
 * @returns 阶段、指标与说明
 */
export function computeKnowledgeCapability(books: readonly BookBasicInfo[]): KnowledgeCapability {
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

    if (total === 0) {
        return {
            stage: 'empty',
            metrics,
            notes: ['导入书籍并完成拆解后，知识库才会参与检索注入；空库不会影响普通写作，但精准模式无从参考。'],
        };
    }
    if (completed === 0) {
        return {
            stage: 'accumulating',
            metrics,
            notes: [`${processing > 0 ? '拆解进行中。' : ''}完成至少 1 本书的拆解后，才可进入检索注入。`],
        };
    }
    if (vectorDone === 0) {
        return {
            stage: 'degraded',
            metrics,
            notes: [
                '拆解结果可查看/统计，但语义检索尚不可用。',
                '请配置 embedding 并在知识库中重建向量；向量失败的书不会参与检索。',
            ],
        };
    }
    if (vectorDone < completed || vectorFailed > 0) {
        return {
            stage: 'accumulating',
            metrics,
            notes: [
                `已有 ${vectorDone} 本书可检索，${completed - vectorDone} 本尚未就绪。`,
                '增加已拆解且向量就绪的书籍，会提升检索覆盖；失败的向量需要重建。',
            ],
        };
    }
    return {
        stage: 'ready',
        metrics,
        notes: [
            '知识库已参与上下文检索注入（普通/精准模式都会使用）。',
            '精准模式的风格相似度评分依赖知识库中的 style 维度向量；没有 style 样本时会直接放行。',
        ],
    };
}
