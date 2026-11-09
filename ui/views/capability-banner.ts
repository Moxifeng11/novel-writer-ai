/**
 * capability-banner.ts — 知识库/指纹库能力边界说明条
 *
 * 两个模块都容易出现「看起来有内容，实际检索/评分未生效」的误解。
 * 这里用统一的阶段徽标 + 指标 + 说明，把「当前能做什么、还缺什么」直接放进 UI。
 */

/** 能力阶段 */
export type CapabilityStage = 'empty' | 'accumulating' | 'ready' | 'degraded';

/** 一个能力指标 */
export interface CapabilityMetric {
    label: string;
    value: string | number;
}

/** 说明条配置 */
export interface CapabilityBannerOptions {
    title: string;
    stage: CapabilityStage;
    metrics: CapabilityMetric[];
    notes: string[];
}

const STAGE_LABELS: Record<CapabilityStage, string> = {
    empty: '未积累',
    accumulating: '积累中',
    ready: '已生效',
    degraded: '降级',
};

/**
 * 渲染能力边界说明条。
 *
 * @param container - 挂载容器
 * @param options - 标题/阶段/指标/说明
 * @returns 说明条根元素
 */
export function renderCapabilityBanner(
    container: HTMLElement,
    options: CapabilityBannerOptions,
): HTMLElement {
    const banner = container.createDiv({
        cls: `nw-capability-banner nw-is-${options.stage}`,
    });
    const head = banner.createDiv({ cls: 'nw-capability-head' });
    head.createSpan({ cls: 'nw-capability-title', text: options.title });
    head.createSpan({
        cls: 'nw-capability-stage',
        text: STAGE_LABELS[options.stage],
    });

    const metrics = banner.createDiv({ cls: 'nw-capability-metrics' });
    for (const metric of options.metrics) {
        const item = metrics.createDiv({ cls: 'nw-capability-metric' });
        item.createSpan({ cls: 'nw-capability-metric-value', text: String(metric.value) });
        item.createSpan({ cls: 'nw-capability-metric-label', text: metric.label });
    }

    if (options.notes.length > 0) {
        const notes = banner.createDiv({ cls: 'nw-capability-notes' });
        for (const note of options.notes) {
            notes.createDiv({ cls: 'nw-capability-note', text: note });
        }
    }
    return banner;
}
