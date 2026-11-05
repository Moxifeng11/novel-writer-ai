/**
 * metrics-refresh.ts — 协同写作「剧情完成度」刷新编排
 *
 * 从 `ui/co-writing-view.ts` 抽出：评估节流门控、在途评估中止、切章后丢弃旧结果、
 * 失败态回退。状态读写全部经宿主回调，纯编排便于单元测试。
 */
import type { PlotCompletionMetrics, SuggestionDirection } from '@/shared/types';
import { shouldRunPlotEval, type PlotEvalGateState } from '@/shared/plot-eval-throttle';
import { emptyMetrics } from '@/ui/cowrite/cowrite-mappers';
import { createLogger } from '@/shared/logger';

const log = createLogger('MetricsRefresh');

/** 指标评估状态机取值。 */
export type MetricsEvalStatus = 'idle' | 'evaluating' | 'error';

/**
 * 指标刷新宿主：视图只提供状态读写与副作用，编排逻辑集中在本模块。
 */
export interface MetricsRefreshHost {
    /** 当前项目路径（用于章节身份比较） */
    getProject(): string;
    /** 当前章号（用于章节身份比较） */
    getChapterNum(): number;
    /** 编辑器正文 */
    getEditorText(): string;
    /** 上次评估门状态 */
    getLastPlotEval(): PlotEvalGateState | null;
    /** 写回评估门状态 */
    setLastPlotEval(state: PlotEvalGateState): void;
    /** 在途评估的中止控制器 */
    getAbortController(): AbortController | null;
    /** 替换中止控制器 */
    setAbortController(controller: AbortController | null): void;
    /** 当前评估状态 */
    getMetricsStatus(): MetricsEvalStatus;
    /** 写入评估状态 */
    setMetricsStatus(status: MetricsEvalStatus): void;
    /** 会话缓存指标（评估发起前/失败后的兜底渲染值） */
    getSessionMetrics(): PlotCompletionMetrics | null;
    /** 发起 AI 完成度评估 */
    evaluatePlotComplete(text: string, signal: AbortSignal): Promise<PlotCompletionMetrics>;
    /** 把指标映射成下一轮方向提示 */
    adjustDirection(metrics: PlotCompletionMetrics): SuggestionDirection[];
    /** 写回会话指标 */
    syncPlotCompletion(metrics: PlotCompletionMetrics): void;
    /** 刷新「下一节点」按钮 */
    updateNextNodeButton(): void;
    /** 渲染指标面板（含浮窗） */
    renderMetrics(metrics: PlotCompletionMetrics): void;
    /** 渲染浮窗指标 */
    renderFloatingMetrics(): void;
}

/**
 * 执行一次剧情完成度刷新。
 *
 * 顺序约束：
 * 1. 先过节流门（未命中直接返回，不打断在途评估）；
 * 2. 中止上一次在途评估，避免旧结果晚到覆盖新结果；
 * 3. 评估返回后先校验 signal 与章节身份，再写回；
 * 4. 失败时回到 `error` 态并渲染会话缓存，避免面板停在「评估中」。
 *
 * @param host - 指标刷新宿主
 * @param force - 是否强制跳过节流门
 * @example
 * ```ts
 * await runMetricsRefresh(host, false);
 * ```
 */
export async function runMetricsRefresh(host: MetricsRefreshHost, force: boolean): Promise<void> {
    host.updateNextNodeButton();
    const now = Date.now();
    const chapterKey = `${host.getProject()}|${host.getChapterNum()}`;
    // `evaluatePlotComplete` 会把整章正文拼成约 9.6k token 的 prompt 发给 AI。
    // 此前只按 10 秒节流，开着自动评估时打字期间每分钟最多 6 次请求，
    // 而正文往往只多了几十字；这里要求「正文变过 + 新增达标或冷却到期」才评估。
    const gate = shouldRunPlotEval({
        chapterKey,
        text: host.getEditorText(),
        last: host.getLastPlotEval(),
        now,
        force,
    });
    if (!gate.run) return;
    host.setLastPlotEval(gate.next);
    const previous = host.getAbortController();
    if (previous) {
        previous.abort();
        host.setAbortController(null);
    }
    const controller = new AbortController();
    host.setAbortController(controller);
    const signal = controller.signal;
    host.setMetricsStatus('evaluating');
    host.renderMetrics(host.getSessionMetrics() ?? emptyMetrics());
    host.renderFloatingMetrics();
    // 完成度是异步 AI 评估：先记发起时的章节身份，返回后若已切章则丢弃
    const evalTarget = chapterKey;
    try {
        const metrics = await host.evaluatePlotComplete(host.getEditorText(), signal);
        if (signal.aborted) return;
        if (evalTarget !== `${host.getProject()}|${host.getChapterNum()}`) return;
        metrics.nextDirectionHints = host.adjustDirection(metrics);
        host.setMetricsStatus('idle');
        host.syncPlotCompletion(metrics);
        host.renderMetrics(metrics);
        host.renderFloatingMetrics();
    } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        if (evalTarget !== `${host.getProject()}|${host.getChapterNum()}`) return;
        log.warn('[CoWritingView] 完成度刷新失败:', e);
        host.setMetricsStatus('error');
        host.renderMetrics(host.getSessionMetrics() ?? emptyMetrics());
        host.renderFloatingMetrics();
    } finally {
        if (host.getAbortController()?.signal === signal) {
            host.setAbortController(null);
        }
    }
}
