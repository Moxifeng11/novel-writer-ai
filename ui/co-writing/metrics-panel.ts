/**
 * metrics-panel.ts — 协同写作「剧情完成度」指标面板渲染
 *
 * 从 `ui/co-writing-view.ts` 抽出：`renderMetrics`（带上下文行）与
 * `renderMetricsInto`（紧凑版）共用的状态判定与 DOM 构建。
 * 状态由调用方传入，重试动作通过回调注入，模块本身不持有视图字段。
 */
import type { PlotCompletionMetrics } from '@/shared/types';

/** 指标面板的三态判定结果。 */
export interface MetricsRenderState {
    /** 正在评估 */
    isEvaluating: boolean;
    /** 评估失败 */
    isError: boolean;
    /** 正文不足且无任何指标 */
    isInsufficient: boolean;
}

/**
 * 计算指标面板的三态。
 *
 * @param metrics - 指标
 * @param contentLength - 正文有效字数
 * @param status - 评估状态
 * @returns 三态判定
 * @example
 * ```ts
 * const state = computeMetricsRenderState(metrics, 120, 'idle');
 * ```
 */
export function computeMetricsRenderState(
    metrics: PlotCompletionMetrics,
    contentLength: number,
    status: 'idle' | 'evaluating' | 'error',
): MetricsRenderState {
    const isEvaluating = status === 'evaluating';
    const isError = status === 'error';
    const hasAnyMetric = metrics.sceneObjectivesMet > 0 || metrics.characterArcsAdvanced > 0 ||
        metrics.foreshadowingSeeded > 0 || metrics.emotionalArcProgress > 0 || metrics.overallCompletion > 0;
    return { isEvaluating, isError, isInsufficient: contentLength < 50 && !hasAnyMetric };
}

/** 带上下文行的指标面板所需数据。 */
export interface MetricsPanelContext {
    /** 项目名（空 = 未绑定） */
    project: string;
    /** 卷名 */
    volume: string;
    /** 章节名 */
    chapterName: string;
    /** 当前字数 */
    wordCount: number;
    /** 目标字数 */
    targetWordCount: number;
    /** 保存状态展示文本 */
    saveStateText: string;
    /** 已格式化的下一轮方向文本 */
    directionText: string;
}

/** 将百分比夹到 0–100 并取整。 */
function clampPercent(value: number): number {
    return Math.max(0, Math.min(100, Math.round(value || 0)));
}

/** 渲染四格指标（原生 <progress>，accent-color 随主题）。 */
function renderMetricGrid(
    container: HTMLElement,
    metrics: PlotCompletionMetrics,
    isEvaluating: boolean,
): void {
    const rows: Array<[string, number]> = [
        ['场景目标', metrics.sceneObjectivesMet],
        ['人物弧', metrics.characterArcsAdvanced],
        ['伏笔埋设', metrics.foreshadowingSeeded],
        ['情绪弧', metrics.emotionalArcProgress],
    ];
    const grid = container.createDiv({ cls: 'nw-cowrite-metrics-grid' });
    if (isEvaluating) grid.addClass('nw-cowrite-metrics-evaluating-dim');
    rows.forEach(([label, value]) => {
        const item = grid.createDiv({ cls: 'nw-cowrite-metrics-item' });
        const head = item.createDiv({ cls: 'nw-cowrite-metrics-head' });
        head.createSpan({ cls: 'nw-cowrite-metrics-label', text: label });
        head.createSpan({ cls: 'nw-cowrite-metrics-value', text: `${clampPercent(value)}%` });
        const safe = clampPercent(value);
        item.createEl('progress', {
            cls: 'nw-cowrite-metrics-native-bar',
            attr: { value: String(safe), max: '100' },
        });
    });
}

/** 渲染综合完成度行。 */
function renderOverallRow(
    container: HTMLElement,
    metrics: PlotCompletionMetrics,
    isEvaluating: boolean,
): void {
    const overall = container.createDiv({ cls: 'nw-cowrite-metrics-overall' });
    const overallHead = overall.createDiv({ cls: 'nw-cowrite-metrics-head' });
    overallHead.createSpan({ cls: 'nw-cowrite-metrics-label', text: '综合完成度' });
    if (isEvaluating) {
        overallHead.createSpan({ cls: 'nw-cowrite-metrics-value nw-cowrite-metrics-overall-value nw-cowrite-metrics-evaluating', text: '评估中...' });
        overall.createEl('progress', {
            cls: 'nw-cowrite-metrics-native-bar nw-cowrite-metrics-loading-bar',
            attr: { value: '100', max: '100' },
        });
        return;
    }
    const overallSafe = clampPercent(metrics.overallCompletion);
    overallHead.createSpan({ cls: 'nw-cowrite-metrics-value nw-cowrite-metrics-overall-value', text: `${overallSafe}%` });
    overall.createEl('progress', {
        cls: 'nw-cowrite-metrics-native-bar',
        attr: { value: String(overallSafe), max: '100' },
    });
}

/** 渲染建议/方向/错误/提示尾部。 */
function renderMetricsFooter(
    container: HTMLElement,
    metrics: PlotCompletionMetrics,
    state: MetricsRenderState,
    directionText: string,
    onRetry: () => void,
): void {
    if (metrics.suggestionAdvice && !state.isEvaluating) {
        container.createDiv({ cls: 'novel-writer-cowrite-advice', text: `💡 ${metrics.suggestionAdvice}` });
    }
    if (directionText && !state.isEvaluating) {
        container.createDiv({ cls: 'novel-writer-cowrite-next-directions', text: `下一轮方向：${directionText}` });
    }
    if (state.isError) {
        const errorEl = container.createDiv({ cls: 'nw-cowrite-metrics-error nw-u-cursor-pointer-2', text: '❌ 评估失败，点击重试' });
        errorEl.addEventListener('click', () => onRetry());
    }
    if (state.isInsufficient && !state.isEvaluating && !state.isError) {
        container.createDiv({ cls: 'nw-cowrite-metrics-hint', text: '📝 内容不足，继续写作后自动评估' });
    }
}

/**
 * 渲染带上下文行的指标面板（左栏主面板）。
 *
 * @param container - 容器
 * @param metrics - 指标
 * @param state - 三态
 * @param ctx - 上下文数据
 * @param onRetry - 重试回调
 * @example
 * ```ts
 * renderMetricsPanel(this.metricsContainer, metrics, state, ctx, () => this.refreshMetrics(true));
 * ```
 */
export function renderMetricsPanel(
    container: HTMLElement,
    metrics: PlotCompletionMetrics,
    state: MetricsRenderState,
    ctx: MetricsPanelContext,
    onRetry: () => void,
): void {
    container.empty();
    container.createEl('h4', { text: '📊 剧情完成度', cls: 'nw-cowrite-metrics-title' });
    // 上下文信息：项目 · 章节 · 字数 · 保存状态
    const contextRow = container.createDiv({ cls: 'nw-cowrite-metrics-context' });
    contextRow.createSpan({ text: `${ctx.project || '未绑定'} · ${ctx.volume || ''} ${ctx.chapterName || ''}` });
    contextRow.createSpan({ text: `${ctx.wordCount}/${ctx.targetWordCount}字` });
    contextRow.createSpan({ cls: 'nw-cowrite-control-state', text: ctx.saveStateText });
    renderMetricGrid(container, metrics, state.isEvaluating);
    renderOverallRow(container, metrics, state.isEvaluating);
    renderMetricsFooter(container, metrics, state, ctx.directionText, onRetry);
}

/**
 * 渲染紧凑指标面板（浮动面板 / 面板 B）。
 *
 * @param container - 容器
 * @param metrics - 指标
 * @param state - 三态
 * @param directionText - 已格式化的方向文本
 * @param onRetry - 重试回调
 * @example
 * ```ts
 * renderMetricsCompact(container, metrics, state, labels, () => this.refreshMetrics(true));
 * ```
 */
export function renderMetricsCompact(
    container: HTMLElement,
    metrics: PlotCompletionMetrics,
    state: MetricsRenderState,
    directionText: string,
    onRetry: () => void,
): void {
    container.empty();
    container.createEl('h4', { text: '📊 剧情完成度', cls: 'nw-cowrite-metrics-title' });
    const grid = container.createDiv({ cls: 'nw-cowrite-metrics-grid' });
    if (state.isEvaluating) grid.addClass('nw-cowrite-metrics-evaluating-dim');
    const labels = ['场景目标', '人物弧', '伏笔', '情绪弧'];
    const values = [metrics.sceneObjectivesMet, metrics.characterArcsAdvanced, metrics.foreshadowingSeeded, metrics.emotionalArcProgress];
    for (let i = 0; i < 4; i++) {
        const item = grid.createDiv({ cls: 'nw-cowrite-metrics-item' });
        const head = item.createDiv({ cls: 'nw-cowrite-metrics-head' });
        head.createSpan({ cls: 'nw-cowrite-metrics-label', text: labels[i] });
        head.createSpan({ cls: 'nw-cowrite-metrics-value', text: `${values[i]}%` });
        item.createEl('progress', {
            cls: 'nw-cowrite-metrics-native-bar',
            attr: { value: String(values[i]), max: '100' },
        });
    }
    const overall = container.createDiv({ cls: 'nw-cowrite-metrics-overall' });
    const overallHead = overall.createDiv({ cls: 'nw-cowrite-metrics-head' });
    overallHead.createSpan({ cls: 'nw-cowrite-metrics-label', text: '综合完成度' });
    if (state.isEvaluating) {
        overallHead.createSpan({ cls: 'nw-cowrite-metrics-value nw-cowrite-metrics-overall-value nw-cowrite-metrics-evaluating', text: '评估中...' });
        overall.createEl('progress', {
            cls: 'nw-cowrite-metrics-native-bar nw-cowrite-metrics-loading-bar',
            attr: { value: '100', max: '100' },
        });
    } else {
        overallHead.createSpan({ cls: 'nw-cowrite-metrics-value nw-cowrite-metrics-overall-value', text: `${metrics.overallCompletion}%` });
        overall.createEl('progress', {
            cls: 'nw-cowrite-metrics-native-bar',
            attr: { value: String(metrics.overallCompletion), max: '100' },
        });
    }
    renderMetricsFooter(container, metrics, state, directionText, onRetry);
}
