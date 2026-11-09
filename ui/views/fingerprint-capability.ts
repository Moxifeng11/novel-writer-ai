/**
 * fingerprint-capability.ts — 写作指纹库当前能力边界（纯函数）
 *
 * 指纹库有两层作用：
 * 1. 提示词风格注入（普通/精准模式都生效，取决于指纹是否启用）；
 * 2. 精准模式的相似度评分（参考来自知识库 style 向量，不是指纹库自身）。
 * UI 必须把这两层说清楚，避免「有指纹就以为精准评分一定生效」。
 */
import type { CapabilityMetric, CapabilityStage } from './capability-banner';

/** 指纹能力输入 */
export interface FingerprintCapabilityInput {
    templateCount: number;
    globalCount: number;
    projectCount: number;
    enabledCount: number;
    totalSamples: number;
    v2Count: number;
    vectorReady: boolean;
    embeddingReady: boolean;
}

/** 指纹能力摘要 */
export interface FingerprintCapability {
    stage: CapabilityStage;
    metrics: CapabilityMetric[];
    notes: string[];
}

/**
 * 计算指纹库能力阶段。
 *
 * @param input - 各作用域数量/样本/向量状态
 * @returns 阶段、指标与说明
 */
export function computeFingerprintCapability(input: FingerprintCapabilityInput): FingerprintCapability {
    const total = input.templateCount + input.globalCount + input.projectCount;
    const metrics: CapabilityMetric[] = [
        { label: '指纹', value: total },
        { label: '已启用', value: input.enabledCount },
        { label: '样本', value: input.totalSamples },
        { label: 'V2 指纹', value: input.v2Count },
    ];
    const commonNotes = [
        '指纹用于提示词风格注入，普通/精准模式都会读取；未启用的指纹不参与注入。',
        '精准模式的相似度评分参考知识库 style 向量；知识库没有 style 向量时会直接放行。',
    ];

    if (total === 0) {
        return {
            stage: 'empty',
            metrics,
            notes: [
                '还没有指纹：不会产生风格注入，精准模式只剩通用约束。',
                ...commonNotes.slice(1),
                '可从章节正文提取、从知识库导入，或手动新建指纹。',
            ],
        };
    }
    if (input.enabledCount === 0) {
        return {
            stage: 'degraded',
            metrics,
            notes: ['指纹已存在但全部未启用：注入列表为空。', ...commonNotes],
        };
    }
    if (input.totalSamples === 0) {
        return {
            stage: 'accumulating',
            metrics,
            notes: [
                '已有指纹特征，但没有 few-shot 样本：风格描述可注入，相似样本/向量参考不足。',
                ...commonNotes,
                '建议为每枚指纹补充 2–3 段代表性样本。',
            ],
        };
    }
    if (!input.embeddingReady || !input.vectorReady) {
        return {
            stage: 'degraded',
            metrics,
            notes: [
                'embedding/向量库未就绪：指纹仍可按文本特征注入，但向量检索/融合/相似度能力不可用。',
                ...commonNotes,
            ],
        };
    }
    if (input.totalSamples < 3 || input.totalSamples < input.enabledCount * 2) {
        return {
            stage: 'accumulating',
            metrics,
            notes: [
                '样本量偏少：注入可用，但风格稳定性会随样本增加而提升。',
                ...commonNotes,
                '建议每枚启用指纹至少 2–3 段样本。',
            ],
        };
    }
    return {
        stage: 'ready',
        metrics,
        notes: ['指纹注入与向量能力已就绪。', ...commonNotes],
    };
}
