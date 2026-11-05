/**
 * metrics-render.ts — 协同写作「剧情完成度」指标渲染入口
 *
 * 从 `ui/co-writing-view.ts` 抽出：带上下文的指标面板、紧凑指标、指标条与评分卡。
 * 状态与容器由宿主提供，重试动作通过回调注入。
 */
import type { PlotCompletionMetrics, SuggestionDirection } from '@/shared/types';
import { getDirectionLabel } from '@/ui/cowrite/cowrite-mappers';
import { computeMetricsRenderState, renderMetricsCompact, renderMetricsPanel } from '@/ui/co-writing/metrics-panel';

/** 指标渲染宿主。 */
export interface MetricsRenderHost {
    /** 指标容器（概览卡） */
    metricsContainer: HTMLElement;
    /** 正文编辑器 */
    rightEditor: HTMLTextAreaElement | null;
    /** 评估状态 */
    metricsStatus: 'idle' | 'evaluating' | 'error';
    /** 项目名 */
    project: string;
    /** 卷名 */
    volume: string;
    /** 章节名 */
    chapterName: string;
    /** 目标字数 */
    targetWordCount: number;
    /** 保存状态文本 */
    saveStateText: string;
    /** 强制刷新指标 */
    refreshMetrics(force: boolean): Promise<void>;
}

/**
 * 格式化带上下文的下一轮方向文本。
 *
 * @param metrics - 指标数据
 * @returns 方向文本
 * @example
 * ```ts
 * formatMetricsDirectionText({ ...metrics, nextDirectionHints: ['action', 'emotion'] });
 * ```
 */
export function formatMetricsDirectionText(metrics: PlotCompletionMetrics): string {
    return metrics.nextDirectionHints?.length
        ? metrics.nextDirectionHints.map((d: SuggestionDirection) => getDirectionLabel(d)).join(" \u2192 ")
        : '';
}

/**
 * 格式化紧凑指标的下一轮方向文本。
 *
 * @param metrics - 指标数据
 * @returns 方向文本
 * @example
 * ```ts
 * formatCompactDirectionText({ ...metrics, nextDirectionHints: ['action', 'emotion'] });
 * ```
 */
export function formatCompactDirectionText(metrics: PlotCompletionMetrics): string {
    return metrics.nextDirectionHints?.length
        ? metrics.nextDirectionHints.join('\u3001')
        : '';
}

/**
 * 渲染带上下文的指标面板。
 *
 * @param host - 指标宿主
 * @param metrics - 指标数据
 * @example
 * ```ts
 * renderMetrics(host, metrics);
 * ```
 */
export function renderMetrics(host: MetricsRenderHost, metrics: PlotCompletionMetrics): void {
    const state = computeMetricsRenderState(
        metrics,
        host.rightEditor?.value?.trim().length || 0,
        host.metricsStatus,
    );
    const directionText = formatMetricsDirectionText(metrics);
    renderMetricsPanel(
        host.metricsContainer,
        metrics,
        state,
        {
            project: host.project,
            volume: host.volume,
            chapterName: host.chapterName,
            wordCount: host.rightEditor?.value?.trim().length || 0,
            targetWordCount: host.targetWordCount,
            saveStateText: host.saveStateText,
            directionText,
        },
        () => host.refreshMetrics(true),
    );
}

/**
 * 渲染指标条。
 *
 * @param host - 指标宿主
 * @param label - 显示标签
 * @param value - 值
 * @example
 * ```ts
 * renderMetricBar(host, '完成度', 45);
 * ```
 */
export function renderMetricBar(host: MetricsRenderHost, label: string, value: number): void {
    const safe = Math.max(0, Math.min(100, Math.round(value || 0)));
    const row = host.metricsContainer.createDiv({ cls: "novel-writer-cowrite-metric-row" });
    row.createSpan({ cls: "novel-writer-cowrite-metric-label", text: label });
    const bar = row.createDiv({ cls: "novel-writer-cowrite-metric-bar" });
    const fill = bar.createDiv({ cls: `novel-writer-cowrite-metric-fill ${safe < 30 ? "low" : safe < 60 ? "mid" : "high"}` });
    fill.style.width = `${safe}%`;
    row.createSpan({ cls: "novel-writer-cowrite-metric-value", text: `${safe}%` });
}

/**
 * 创建评分卡。
 *
 * @param label - 显示标签
 * @param value - 值
 * @returns 元素
 * @example
 * ```ts
 * createScoreCard('设定一致性', 80);
 * ```
 */
export function createScoreCard(label: string, value: number): HTMLElement {
    const card = createDiv({ cls: "novel-writer-cowrite-score-card" });
    card.createDiv({ cls: "novel-writer-cowrite-score-value", text: `${Math.round(value || 0)}` });
    card.createDiv({ cls: "novel-writer-cowrite-score-label", text: label });
    return card;
}

/**
 * 渲染紧凑指标（浮窗使用）。
 *
 * @param host - 指标宿主
 * @param metrics - 指标数据
 * @param container - 目标容器
 * @example
 * ```ts
 * renderMetricsInto(host, metrics, floatingSection);
 * ```
 */
export function renderMetricsInto(
    host: MetricsRenderHost,
    metrics: PlotCompletionMetrics,
    container: HTMLElement,
): void {
    const state = computeMetricsRenderState(
        metrics,
        host.rightEditor?.value?.trim().length || 0,
        host.metricsStatus,
    );
    const directionText = formatCompactDirectionText(metrics);
    renderMetricsCompact(
        container,
        metrics,
        state,
        directionText,
        () => host.refreshMetrics(true),
    );
}
