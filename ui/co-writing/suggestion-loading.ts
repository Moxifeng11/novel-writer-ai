/**
 * suggestion-loading.ts — 协同写作「生成中」进度面板
 *
 * 从 `ui/co-writing-view.ts` 抽出：步骤列表、ETA、流式预览容器、取消/重试按钮、错误区。
 * 所有字段通过宿主 setter 回写，DOM 结构与内联样式保持原样。
 */
import { StepListComponent } from '@/ui/components/progress/step-list';
import type { ProgressState } from '@/shared/progress-emitter';

/** 生成进度面板宿主。 */
export interface SuggestionLoadingHost {
    /** 建议内容容器 */
    container: HTMLElement;
    /** 取消生成 */
    onCancel(): void;
    /** 重试 */
    onRetry(): void;
    /** 回写进度容器 */
    setProgressContainer(el: HTMLElement): void;
    /** 回写 ETA 元素 */
    setEtaDisplay(el: HTMLElement): void;
    /** 回写步骤列表 */
    setStepList(el: StepListComponent): void;
    /** 清空流式卡片 */
    resetStreamingCards(): void;
    /** 回写流式容器 */
    setStreamingContainer(el: HTMLElement): void;
    /** 回写取消按钮 */
    setCancelButton(el: HTMLButtonElement): void;
    /** 回写重试按钮 */
    setRetryButton(el: HTMLButtonElement): void;
    /** 回写错误容器 */
    setErrorContainer(el: HTMLElement): void;
    /** 绑定进度事件（仅当存在 emitter） */
    bindProgressEmitter(stepList: StepListComponent): void;
}

/**
 * 本地模型串行生成时的进度文案。
 *
 * @param current - 当前第几条
 * @param total - 总条数
 * @returns 文案
 * @example
 * ```ts
 * formatLocalProgressText(2, 3);
 * ```
 */
export function formatLocalProgressText(current: number, total: number): string {
    return `正在生成第 ${current}/${total} 条建议…`;
}

/**
 * 渲染生成中进度面板。
 *
 * @param host - 进度面板宿主
 * @example
 * ```ts
 * renderSuggestionLoading({ container, onCancel, onRetry, ...setters });
 * ```
 */
export function renderSuggestionLoading(host: SuggestionLoadingHost): void {
    const progressContainer = host.container.createDiv({ cls: 'nw-suggest-progress-container' });
    progressContainer.setCssStyles({ padding: '16px 20px' });
    host.setProgressContainer(progressContainer);

    const headerRow = progressContainer.createDiv();
    headerRow.setCssStyles({
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '16px',
    });
    const headerTitle = headerRow.createSpan({ text: '🤖 AI 正在生成建议' });
    headerTitle.setCssStyles({ fontWeight: '600', fontSize: '14px' });

    const etaDisplay = headerRow.createSpan({ text: '预估时间: 计算中...' });
    etaDisplay.setCssStyles({ fontSize: '12px', color: 'var(--text-muted)' });
    host.setEtaDisplay(etaDisplay);

    const stepListContainer = progressContainer.createDiv();
    stepListContainer.setCssStyles({ marginBottom: '16px' });
    const stepList = new StepListComponent(stepListContainer, [
        '检索知识库内容',
        '分析写作上下文',
        '生成写作建议',
    ]);
    host.setStepList(stepList);

    // NBI-03: 流式候选预览区（生成开始即展开骨架，非流式 provider 也仅在调用期展示）
    host.resetStreamingCards();
    const streamingContainer = progressContainer.createDiv({ cls: 'nw-cowrite-stream-preview' });
    streamingContainer.setCssStyles({ display: 'none', marginBottom: '16px' });
    host.setStreamingContainer(streamingContainer);

    const actionsRow = progressContainer.createDiv();
    actionsRow.setCssStyles({ display: 'flex', gap: '12px', justifyContent: 'flex-end' });

    const cancelBtn = actionsRow.createEl('button', {
        text: '✕ 取消生成',
        cls: 'nw-btn nw-btn-ghost',
    });
    cancelBtn.addEventListener('click', () => host.onCancel());
    host.setCancelButton(cancelBtn);

    const retryBtn = actionsRow.createEl('button', {
        text: '↻ 重试',
        cls: 'nw-btn nw-btn-primary',
    });
    retryBtn.setCssStyles({ display: 'none' });
    retryBtn.addEventListener('click', () => host.onRetry());
    host.setRetryButton(retryBtn);

    const errorContainer = progressContainer.createDiv({ cls: 'nw-suggest-error-container' });
    errorContainer.setCssStyles({
        display: 'none',
        marginTop: '12px',
        padding: '12px',
        background: 'var(--background-secondary)',
        borderRadius: '6px',
        borderLeft: '3px solid var(--text-error, #ef4444)',
    });
    host.setErrorContainer(errorContainer);

    host.bindProgressEmitter(stepList);
}

/** 供外部构造的进度状态类型别名（避免重复导入）。 */
export type SuggestionProgressState = ProgressState;
