/**
 * suggest-feedback.ts — 协同写作「建议失败 / 知识空态 / 空建议」反馈
 *
 * 从 `ui/co-writing-view.ts` 抽出：生成失败错误卡、知识库未命中提示、
 * 无建议文案、校验加载态与知识注入提示的纯文案决策。
 */
import { showSuccessNotice, showWarningNotice } from '@/ui/components/notice-helpers';

/** 错误卡动作。 */
export interface SuggestErrorCardActions {
    /** 关闭 */
    onDismiss(): void;
    /** 重试 */
    onRetry(): void;
}

/** 知识注入提示决策。 */
export interface KnowledgeInjectionNotice {
    /** 提示类型 */
    kind: 'success' | 'warning' | 'none';
    /** 提示文本 */
    text: string;
}

/**
 * 决定知识注入提示的类型与文案。
 *
 * @param count - 已注入片段数
 * @param dropped - 因预算不足未注入数
 * @returns 提示决策
 * @example
 * ```ts
 * resolveKnowledgeInjectionNotice(3, 1);
 * ```
 */
export function resolveKnowledgeInjectionNotice(count: number, dropped: number): KnowledgeInjectionNotice {
    if (count > 0) {
        return {
            kind: 'success',
            text: dropped > 0
                ? `已注入 ${count} 条知识库片段（另 ${dropped} 条因预算不足未注入）`
                : `已注入 ${count} 条知识库片段`,
        };
    }
    if (dropped > 0) {
        return { kind: 'warning', text: `知识库片段因预算不足未注入（${dropped} 条）` };
    }
    return { kind: 'none', text: '' };
}

/**
 * 按决策展示知识注入提示。
 *
 * @param count - 已注入片段数
 * @param dropped - 因预算不足未注入数
 * @example
 * ```ts
 * showKnowledgeInjectionNotice(3, 1);
 * ```
 */
export function showKnowledgeInjectionNotice(count: number, dropped: number): void {
    const notice = resolveKnowledgeInjectionNotice(count, dropped);
    if (notice.kind === 'success') {
        showSuccessNotice(notice.text);
    } else if (notice.kind === 'warning') {
        showWarningNotice(notice.text);
    }
}

/**
 * 渲染生成失败错误卡（含「知道了」「重试」）。
 *
 * @param container - 建议内容容器
 * @param message - 已友好化的错误信息
 * @param actions - 错误卡动作
 * @example
 * ```ts
 * renderSuggestErrorCard(content, '密钥未解锁', { onDismiss, onRetry });
 * ```
 */
export function renderSuggestErrorCard(
    container: HTMLElement,
    message: string,
    actions: SuggestErrorCardActions,
): void {
    const box = container.createDiv({ cls: 'nw-cowrite-error-card' });
    box.createDiv({ cls: 'nw-cowrite-error-card__text', text: `生成失败：${message}` });
    const actionRow = box.createDiv({ cls: 'nw-cowrite-error-card__actions' });
    const notNow = actionRow.createEl('button', { text: '知道了', cls: 'nw-btn nw-btn-ghost' });
    notNow.addEventListener('click', () => actions.onDismiss());
    const retry = actionRow.createEl('button', { text: '↻ 重试', cls: 'nw-btn nw-btn-primary' });
    retry.addEventListener('click', () => actions.onRetry());
}

/**
 * 渲染「知识库未检索到参考」提示条与补全按钮。
 *
 * @param container - 建议内容容器
 * @param onRefill - 点击补全知识库
 * @example
 * ```ts
 * renderKnowledgeEmptyNotice(content, () => openRefillModal('knowledge'));
 * ```
 */
export function renderKnowledgeEmptyNotice(container: HTMLElement, onRefill: () => void): void {
    const noticeBar = container.createDiv({ cls: 'nw-knowledge-empty-notice' });
    noticeBar.setCssStyles({
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 16px',
        marginBottom: '12px',
        borderRadius: '6px',
        background: 'rgba(var(--background-modifier-warning-rgb), 0.15)',
        border: '1px solid var(--background-modifier-warning)',
    });
    const noticeText = noticeBar.createSpan({ text: '⚠️ 未检索到知识库参考，可能知识库未完成拆解' });
    noticeText.setCssStyles({ fontSize: '13px', color: 'var(--text-warning)' });
    const refillBtn = noticeBar.createEl('button', { text: '补全知识库' });
    refillBtn.setCssStyles({
        padding: '4px 12px',
        borderRadius: '4px',
        background: 'var(--interactive-accent)',
        color: 'var(--text-on-accent)',
        fontSize: '12px',
        fontWeight: '600',
        border: 'none',
        cursor: 'pointer',
        transition: 'opacity 0.2s',
    });
    refillBtn.addEventListener('click', () => onRefill());
    refillBtn.addEventListener('mouseenter', () => {
        refillBtn.setCssStyles({ opacity: '0.8' });
    });
    refillBtn.addEventListener('mouseleave', () => {
        refillBtn.setCssStyles({ opacity: '1' });
    });
}

/**
 * 渲染「本轮没有拿到建议」文案。
 *
 * @param container - 建议内容容器
 * @example
 * ```ts
 * renderNoSuggestionMessage(content);
 * ```
 */
export function renderNoSuggestionMessage(container: HTMLElement): void {
    container.createDiv({
        cls: 'novel-writer-cowrite-empty',
        text: '这次没有拿到建议。可以换一批，或者检查 API 配置。',
    });
}

/**
 * 渲染校验加载态文案。
 *
 * @param container - 建议内容容器
 * @example
 * ```ts
 * renderValidationLoadingMessage(content);
 * ```
 */
export function renderValidationLoadingMessage(container: HTMLElement): void {
    container.createDiv({
        cls: 'novel-writer-cowrite-empty',
        text: '正在验证你的修改：设定一致性 / 文风对齐 / 剧情对齐……',
    });
}

/**
 * 渲染空建议提示。
 *
 * @param container - 建议内容容器
 * @param message - 提示文本
 * @example
 * ```ts
 * renderEmptySuggestionMessage(content, '按 Tab 生成建议');
 * ```
 */
export function renderEmptySuggestionMessage(container: HTMLElement, message: string): void {
    container.createDiv({ cls: 'novel-writer-cowrite-empty', text: message });
}
