/**
 * suggestion-flow.ts — 协同写作建议生成主流程
 *
 * 从 `ui/co-writing-view.ts` 抽出：Tab 建议（含知识注入提示/空态分支）与
 * 单方向流式建议。中止控制器、代次与 UI 状态通过宿主读写，流程顺序保持原样。
 */
import { Notice } from 'obsidian';
import { t } from '@/i18n';
import { createLogger } from '@/shared/logger';
import { resolveCursorPosition } from '@/shared/cursor-position';
import { ProgressEmitter } from '@/shared/progress-emitter';
import type { TimeEstimator } from '@/shared/time-estimator';
import { resolveEffectiveCoWriteMode } from '@/engine/co-writer/co-write-options';
import type { SentenceEditRecord, SuggestionRecord } from '@/shared/types';
import type { CoWriteFacade } from '@/ui/services/co-write-facade';
import { getFriendlyErrorMessage } from '@/ui/co-writing/friendly-error';
import {
    renderKnowledgeEmptyNotice,
    renderNoSuggestionMessage,
    renderSuggestErrorCard,
} from './suggest-feedback';

const log = createLogger('CoWritingView');

/** 建议流程宿主。 */
export interface SuggestionFlowHost {
    /** 项目路径 */
    project: string;
    /** 卷名 */
    volume: string;
    /** 章号 */
    chapterNum: number;
    /** 正文编辑器 */
    rightEditor: HTMLTextAreaElement;
    /** 临时指令 */
    cursorHint: string;
    /** 是否有可用于冷启动的规划 */
    canColdStart(): boolean;
    /** 是否生成中 */
    isSuggesting: boolean;
    /** 上次建议时间 */
    lastSuggestAt: number;
    /** 中止控制器 */
    suggestAbortController: AbortController | null;
    /** 进度发射器 */
    suggestProgressEmitter: ProgressEmitter | null;
    /** ETA 展示 */
    suggestEtaDisplay: HTMLElement | null;
    /** 建议按钮 */
    suggestBtn: HTMLButtonElement | null;
    /** 时间预估器 */
    timeEstimator: TimeEstimator | null;
    /** 协同门面 */
    facade: CoWriteFacade;
    /** 回写生成状态 */
    setSuggesting(value: boolean): void;
    /** 回写上次建议时间 */
    setLastSuggestAt(at: number): void;
    /** 回写中止控制器 */
    setSuggestAbortController(controller: AbortController | null): void;
    /** 回写进度发射器 */
    setSuggestProgressEmitter(emitter: ProgressEmitter | null): void;
    /** 开始新一轮代次 */
    beginSuggestionEpoch(): number;
    /** 是否当前代次 */
    isCurrentSuggestionEpoch(epoch: number): boolean;
    /** 中止控制器是否仍归本次请求 */
    isSuggestRequestOwner(signal: AbortSignal): boolean;
    /** 作废旧候选 */
    clearStaleSuggestions(): void;
    /** 渲染加载态 */
    renderSuggestionLoading(): void;
    /** 模拟步骤延迟 */
    simulateStepDelay(ms: number, signal: AbortSignal): Promise<void>;
    /** 更新流式预览 */
    updateStreamingPreview(index: number, cumulative: string): void;
    /** 清空流式预览 */
    clearStreamingPreview(): void;
    /** 渲染候选卡 */
    renderSuggestionCards(suggestions: SuggestionRecord[]): void;
    /** 渲染单张流式卡 */
    renderStreamingSuggestionCard(direction: string, style: string, index: number, currentText: string, isStreaming: boolean): HTMLElement;
    /** 显示知识注入提示 */
    showKnowledgeInjectionNotice(): void;
    /** 渲染空建议 */
    renderEmptySuggestions(message?: string): void;
    /** 重试建议 */
    retrySuggestion(): void;
    /** 打开补全知识库 */
    openRefillModal(type: 'knowledge' | 'fingerprint'): void;
    /** 回写候选列表 */
    setCurrentSuggestions(suggestions: SuggestionRecord[]): void;
    /** 回写当前记录 */
    setCurrentRecord(record: SentenceEditRecord | null): void;
    /** 回写上次参数 */
    setLastSuggestParams(params: { precedingText: string; cursorHint: string; mode: string; count: number } | null): void;
    /** 回写错误 */
    setLastSuggestError(error: string): void;
    /** 建议状态文本 */
    getSuggestionStatusText(): HTMLElement | null;
    /** 建议内容容器 */
    getSuggestionContent(): HTMLElement;
    /** 显示建议面板 */
    showSuggestionPanel(): void;
    /** 刷新建议按钮态 */
    updateStartButtonState(): void;
}

/**
 * 触发 Tab 建议生成。
 *
 * @param host - 建议流程宿主
 * @param force - 是否绕过节流
 * @example
 * ```ts
 * await runTabSuggest(host, false);
 * ```
 */
export async function runTabSuggest(host: SuggestionFlowHost, force: boolean): Promise<void> {
    // UX 修复：未绑定章节时 CoWriterEngine 未初始化，原逻辑会空等数十秒才显示「无建议」
    if (!host.project || !host.volume || !host.chapterNum) {
        new Notice(t("cowrite.flow.needChapterForGen"), 3e3);
        return;
    }
    if (!host.rightEditor.value.trim() && !host.canColdStart()) {
        new Notice(t("cowrite.flow.needSceneOrOutline"), 6000);
        return;
    }
    const now = Date.now();
    if (!force && now - host.lastSuggestAt < 500)
        return;
    // v6.3: 先 abort 旧请求（即使 isSuggesting=true 也允许覆盖），再设新请求
    if (host.suggestAbortController) {
        host.suggestAbortController.abort();
        host.setSuggestAbortController(null);
    }
    if (host.suggestProgressEmitter) {
        host.suggestProgressEmitter.cancel();
        host.setSuggestProgressEmitter(null);
    }
    host.setSuggestAbortController(new AbortController());
    const signal = host.suggestAbortController!.signal;
    // NBI-05: 本次请求代次，切章或后续请求会使旧代次失效
    const epoch = host.beginSuggestionEpoch();

    host.setLastSuggestAt(now);
    host.setSuggesting(true);
    host.facade.syncSuggestionsGenerating(true);
    // BUG-K fix: 生成期间禁用建议按钮，给出视觉反馈
    if (host.suggestBtn) {
        host.suggestBtn.disabled = true;
        host.suggestBtn.textContent = t("cowrite.generating");
    }

    const cursor = resolveCursorPosition(host.rightEditor.selectionStart, host.rightEditor.value.length);
    const precedingText = host.rightEditor.value.slice(0, cursor);

    host.setLastSuggestParams({
        precedingText,
        cursorHint: host.cursorHint,
        mode: "continue",
        count: 3
    });

    const emitter = new ProgressEmitter(`suggest_${Date.now()}`, t('cowrite.flow.progressTitle'));
    emitter.registerSteps([
        t('cowrite.flow.stepRetrieve'),
        t('cowrite.flow.stepAnalyzeContext'),
        t('cowrite.flow.stepGenerate')
    ]);
    host.setSuggestProgressEmitter(emitter);

    // RG-02: 新一轮生成开始即作废旧候选，避免中止/失败后快捷键仍能插入上一轮建议
    host.clearStaleSuggestions();
    host.renderSuggestionLoading();
    emitter.start();

    const startTime = Date.now();
    const wordCount = precedingText.length;
    // 本地模型（Ollama）耗时高度不确定，统计 ETA 会给出「预估剩余 1 秒」这类误导信息，直接跳过
    // M-2：按生效模式判断——本地未选模型自动切云端后不应再展示「本地模型等待」文案
    const isLocalModelMode = resolveEffectiveCoWriteMode(host.facade.settings) === 'local';
    // 串行生成时展示「第 N/M 条」，避免单条耗时较长被误认为卡死
    let suggestProgressTimer: number | null = null;
    if (isLocalModelMode && host.suggestEtaDisplay) {
        host.suggestEtaDisplay.setText(t("cowrite.flow.localModelWait"));
        suggestProgressTimer = window.setInterval(() => {
            const progress = host.facade.getSuggestProgress();
            if (progress && progress.total > 0 && host.suggestEtaDisplay) {
                host.suggestEtaDisplay.setText(t('cowrite.flow.generatingN', { current: progress.current, total: progress.total }));
            }
        }, 1000);
    }

    if (host.timeEstimator && !isLocalModelMode) {
        const est = host.timeEstimator.estimate({
            operationType: 'co_write_suggest',
            wordCount,
            mode: 'statistical'
        });
        if (est.confidence > 0) {
            emitter.setProgress(1, t('cowrite.flow.etaEstimate', { seconds: Math.ceil(est.eta / 1000) }));
        }
    }
    const record: SentenceEditRecord = {
        id: `rec_${Date.now()}`,
        triggerText: precedingText.slice(-200),
        cursorPosition: cursor,
        suggestions: [],
        humanModifiedText: "",
        editDurationMs: 0,
        createdAt: Date.now()
    };
    host.setCurrentRecord(record);
    try {
        if (signal.aborted) return;
        emitter.nextStep(t('cowrite.flow.retrieving'));

        await host.simulateStepDelay(300, signal);
        if (signal.aborted) return;

        emitter.setStepProgress(50, t('cowrite.flow.matchingFragments'));
        await host.simulateStepDelay(200, signal);
        if (signal.aborted) return;

        emitter.nextStep(t('cowrite.flow.analyzingContext'));
        emitter.setStepProgress(30, t('cowrite.flow.analyzingPlot'));

        await host.simulateStepDelay(200, signal);
        if (signal.aborted) return;

        emitter.setStepProgress(70, t('cowrite.flow.adjustingDirection'));
        await host.simulateStepDelay(200, signal);
        if (signal.aborted) return;

        emitter.nextStep(t('cowrite.flow.generatingSuggestions'));
        emitter.setStepProgress(10, t('cowrite.flow.callingModel'));

        const suggestions = await host.facade.suggestNext(
            precedingText,
            host.cursorHint,
            "continue",
            3,
            signal,
            (index, cumulative) => {
                if (signal.aborted || !host.isCurrentSuggestionEpoch(epoch)) return;
                host.updateStreamingPreview(index, cumulative);
            }
        );
        if (signal.aborted || !host.isCurrentSuggestionEpoch(epoch)) {
            // NBI-03: 中止时引擎可能已回流空数组，这里主动清理未完成的流式骨架
            // RG-02: 仅最新请求可清理，避免被新请求中止的旧请求误清新请求的骨架
            // NBI-05: 切章后旧代次结果一律丢弃，不回填新章节
            if (host.isSuggestRequestOwner(signal)) host.clearStreamingPreview();
            return;
        }

        emitter.setStepProgress(100, t('cowrite.flow.genComplete'));
        emitter.complete();

        const duration = Date.now() - startTime;
        if (host.timeEstimator) {
            host.timeEstimator.record({
                operationType: 'co_write_suggest',
                wordCount,
                mode: 'statistical',
                duration
            });
            void host.timeEstimator.saveHistory();
        }

        host.setCurrentSuggestions(suggestions);
        record.suggestions = suggestions;
        host.facade.syncSuggestionsReady(suggestions, 'action');
        if (suggestions.length === 0) {
            const engineError = host.facade.getLastSuggestError();
            const statusText = host.getSuggestionStatusText();
            if (statusText) statusText.textContent = engineError ? t("cowrite.genFailedStatus") : t("cowrite.flow.noSuggestions");
            const content = host.getSuggestionContent();
            content.empty();

            // 引擎已捕获到具体失败原因（密钥未解锁/401/超时等）时直接展示，不再误报成「知识库未拆解」
            if (engineError) {
                // 注意：上面的 empty() 已经把进度容器（含错误区与重试按钮）摘掉，
                // 旧实现继续调用 showSuggestError 会写进脱离文档的节点：
                // 用户只看到「生成失败」，既没有原因也没有重试入口。
                renderSuggestErrorCard(content, getFriendlyErrorMessage(engineError), {
                    onDismiss: () => host.renderEmptySuggestions(),
                    onRetry: () => host.retrySuggestion(),
                });
                return;
            }

            const dirCounts = host.facade.directionKnowledgeCounts || {};
            const directions = ['action', 'emotion', 'dialogue'];
            const allZero = directions.every(dir => (dirCounts[dir] || 0) === 0);

            if (allZero) {
                renderKnowledgeEmptyNotice(content, () => host.openRefillModal('knowledge'));
            }

            renderNoSuggestionMessage(content);
            return;
        }
        host.renderSuggestionCards(suggestions);
        host.showKnowledgeInjectionNotice();
    } catch (e) {
        if (signal.aborted || !host.isCurrentSuggestionEpoch(epoch)) {
            // RG-02: 旧请求（已被新请求接管）不得取消新请求的进度条或清理其骨架
            // NBI-05: 切章后旧代次的错误也不写入新章节面板
            if (host.isSuggestRequestOwner(signal)) {
                const activeEmitter = host.suggestProgressEmitter;
                if (activeEmitter) activeEmitter.cancel();
                host.clearStreamingPreview();
            }
            return;
        }
        log.warn("[CoWritingView] 生成建议失败:", e);
        const errorMsg = e instanceof Error ? e.message : String(e);
        host.setLastSuggestError(errorMsg);
        host.facade.syncSuggestionsError(errorMsg);

        host.clearStreamingPreview();
        const activeEmitter = host.suggestProgressEmitter;
        if (activeEmitter) {
            activeEmitter.fail(getFriendlyErrorMessage(errorMsg));
        }
    } finally {
        if (suggestProgressTimer !== null) {
            window.clearInterval(suggestProgressTimer);
            suggestProgressTimer = null;
        }
        // v6.3: 仅当本次请求仍是当前 controller 时才清除状态，避免被后续请求的 abort 干扰
        if (host.suggestAbortController?.signal === signal) {
            host.setSuggesting(false);
            host.setSuggestAbortController(null);
            // BUG-K fix: 恢复建议按钮可用态
            if (host.suggestBtn) {
                host.suggestBtn.disabled = false;
                host.updateStartButtonState();
            }
        }
    }
}

/**
 * 流式生成单方向建议。
 *
 * @param host - 建议流程宿主
 * @param directionIndex - 方向索引
 * @example
 * ```ts
 * await runStreamSuggestion(host, 0);
 * ```
 */
export async function runStreamSuggestion(host: SuggestionFlowHost, directionIndex = 0): Promise<void> {
    if (host.isSuggesting) return;
    if (host.suggestAbortController) {
        host.suggestAbortController.abort();
        host.setSuggestAbortController(null);
    }
    host.setSuggestAbortController(new AbortController());
    const signal = host.suggestAbortController!.signal;

    host.setSuggesting(true);
    host.facade.syncSuggestionsGenerating(true);
    if (host.suggestBtn) {
        host.suggestBtn.disabled = true;
        host.suggestBtn.textContent = t("cowrite.generating");
    }

    const cursor = resolveCursorPosition(host.rightEditor.selectionStart, host.rightEditor.value.length);
    const precedingText = host.rightEditor.value.slice(0, cursor);

    try {
        if (signal.aborted) return;

        const styleLabels = [t("cowrite.flow.styleDefault"), t("cowrite.flow.styleCreative"), t("cowrite.flow.styleConservative")];

        let currentText = "";
        const card = host.renderStreamingSuggestionCard(
            "生成中...",
            styleLabels[directionIndex] || "默认",
            directionIndex,
            "",
            true
        );
        let textEl = card.querySelector(".novel-writer-cowrite-suggestion-text") as HTMLElement;

        const stream = host.facade.suggestStream(
            precedingText,
            host.cursorHint,
            "continue",
            directionIndex,
            signal
        );

        let finalSuggestion: SuggestionRecord | null = null;
        let result: IteratorResult<string, SuggestionRecord | null>;

        while (true) {
            result = await stream.next();
            if (signal.aborted) return;

            if (result.done) {
                finalSuggestion = result.value;
                break;
            }

            const chunk = result.value;
            if (chunk) {
                currentText += chunk;
                if (textEl) {
                    const cursorEl = textEl.querySelector(".nw-streaming-cursor");
                    if (cursorEl) {
                        cursorEl.remove();
                    }
                    textEl.textContent = currentText;
                    const newCursor = createSpan();
                    newCursor.className = "nw-streaming-cursor";
                    newCursor.textContent = "▋";
                    textEl.appendChild(newCursor);
                }
            }
        }

        if (signal.aborted) return;

        if (finalSuggestion) {
            currentText = finalSuggestion.text;

            host.setCurrentSuggestions([finalSuggestion]);
            host.setCurrentRecord({
                id: `rec_stream_${Date.now()}`,
                triggerText: precedingText.slice(-200),
                cursorPosition: cursor,
                suggestions: [finalSuggestion],
                humanModifiedText: "",
                editDurationMs: 0,
                createdAt: Date.now()
            });

            host.renderSuggestionCards([finalSuggestion]);
            host.facade.syncSuggestionsReady([finalSuggestion], finalSuggestion.direction);
            host.showKnowledgeInjectionNotice();
        } else {
            const statusText = host.getSuggestionStatusText();
            if (statusText) statusText.textContent = t("cowrite.flow.noSuggestions");
            const content = host.getSuggestionContent();
            content.empty();
            content.createDiv({ cls: "novel-writer-cowrite-empty", text: t("cowrite.flow.emptySuggestions") });
        }
    } catch (e) {
        if (signal.aborted) return;
        log.warn("[CoWritingView] 流式生成建议失败:", e);
        const errorMsg = e instanceof Error ? e.message : String(e);
        host.facade.syncSuggestionsError(errorMsg);
        host.showSuggestionPanel();
        const statusText = host.getSuggestionStatusText();
        if (statusText) statusText.textContent = t("cowrite.genFailedStatus");
        const content = host.getSuggestionContent();
        content.empty();
        content.createDiv({ cls: "novel-writer-cowrite-error", text: t("cowrite.flow.genFailedBody") });
    } finally {
        if (host.suggestAbortController?.signal === signal) {
            host.setSuggesting(false);
            host.setSuggestAbortController(null);
            if (host.suggestBtn) {
                host.suggestBtn.disabled = false;
                host.updateStartButtonState();
            }
            host.facade.syncSuggestionsGenerating(false);
        }
    }
}
