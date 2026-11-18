/**
 * fingerprint-capability.ts — 写作指纹库当前能力边界（纯函数）
 *
 * 指纹库有两层作用：
 * 1. 提示词风格注入（普通/精准模式都生效，取决于指纹是否启用）；
 * 2. 精准模式的相似度评分（参考来自知识库 style 向量，不是指纹库自身）。
 * UI 必须把这两层说清楚，避免「有指纹就以为精准评分一定生效」。
 */
import { t } from '@/i18n';
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
        { label: t('fingerprint.cap.metricFps'), value: total },
        { label: t('fingerprint.cap.metricEnabled'), value: input.enabledCount },
        { label: t('fingerprint.cap.metricSamples'), value: input.totalSamples },
        { label: t('fingerprint.cap.metricV2'), value: input.v2Count },
    ];
    const commonNotes = [
        t('fingerprint.cap.noteInject'),
        t('fingerprint.cap.noteVector'),
    ];

    if (total === 0) {
        return {
            stage: 'empty',
            metrics,
            notes: [
                t('fingerprint.cap.noteEmpty'),
                ...commonNotes.slice(1),
                t('fingerprint.cap.noteHowToStart'),
            ],
        };
    }
    if (input.enabledCount === 0) {
        return {
            stage: 'degraded',
            metrics,
            notes: [t('fingerprint.cap.noteAllDisabled'), ...commonNotes],
        };
    }
    if (input.totalSamples === 0) {
        return {
            stage: 'accumulating',
            metrics,
            notes: [
                t('fingerprint.cap.noteNoSamples'),
                ...commonNotes,
                t('fingerprint.cap.noteSampleAdvice'),
            ],
        };
    }
    if (!input.embeddingReady || !input.vectorReady) {
        return {
            stage: 'degraded',
            metrics,
            notes: [
                t('fingerprint.cap.noteVectorNotReady'),
                ...commonNotes,
            ],
        };
    }
    if (input.totalSamples < 3 || input.totalSamples < input.enabledCount * 2) {
        return {
            stage: 'accumulating',
            metrics,
            notes: [
                t('fingerprint.cap.noteFewSamples'),
                ...commonNotes,
                t('fingerprint.cap.noteSampleAdvice2'),
            ],
        };
    }
    return {
        stage: 'ready',
        metrics,
        notes: [t('fingerprint.cap.noteReady'), ...commonNotes],
    };
}
