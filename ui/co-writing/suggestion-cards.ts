/**
 * suggestion-cards.ts — 协同写作「建议 / 联想 / 校验 / 流式」卡片渲染
 *
 * 从 `ui/co-writing-view.ts` 抽出：候选卡片、联想卡片、校验结果、流式预览。
 * 只做 DOM 与纯函数格式化，采纳/编辑/拒绝等动作通过宿主回调注入。
 */
import type { AssociationSuggestion } from '@/shared/co-writer-types';
import { t } from '@/i18n';
import type { EditValidation, SuggestionRecord } from '@/shared/types';
import { getAssociationLabel, getDirectionLabel, getStyleLabel } from '@/ui/cowrite/cowrite-mappers';
import { describeDiff, type TextDiffResult } from '@/ui/co-writing/text-diff';

/** 卡片动作宿主。 */
export interface SuggestionCardActions {
    /** 采纳建议 */
    onAccept(suggestion: SuggestionRecord): void;
    /** 编辑建议（可带初始文本） */
    onEdit(suggestion: SuggestionRecord, initialText?: string): void;
    /** 迭代建议 */
    onIterate(suggestion: SuggestionRecord): void;
    /** 拒绝建议 */
    onReject(suggestionId: string): void;
    /** 校验后继续使用 */
    onContinue(modifiedText: string, suggestion: SuggestionRecord, validation: EditValidation, editDurationMs: number): Promise<void>;
    /** 尝试进入采纳临界区（false = 已有采纳在途） */
    tryBeginAccept(): boolean;
    /** 退出采纳临界区 */
    endAccept(): void;
    /** 创建评分卡 */
    createScoreCard(label: string, value: number): HTMLElement;
    /**
     * 计算候选相对当前正文的差异（E-05）。返回 null 表示无法比较（无正文）。
     */
    computeDiff?(suggestion: SuggestionRecord): TextDiffResult | null;
}

/**
 * 剧透风险标签。
 *
 * @param level - 风险等级
 * @returns 标签文本
 * @example
 * ```ts
 * riskBadgeLabel('high');
 * ```
 */
export function riskBadgeLabel(level: 'high' | 'medium' | 'low' | undefined): string {
    return level === 'high' ? t('cowrite.cards.spoilerHigh') : t('cowrite.cards.spoilerMid');
}

/**
 * 校验面板标题。
 *
 * @param degraded - 是否降级
 * @param isValid - 是否通过
 * @returns 标题文本
 * @example
 * ```ts
 * validationTitle(false, true);
 * ```
 */
export function validationTitle(degraded: boolean, isValid: boolean): string {
    if (degraded) return t('cowrite.cards.validateDegraded');
    return isValid ? t('cowrite.cards.validatePassed') : t('cowrite.cards.validateRisky');
}

/**
 * 联想置信度文本。
 *
 * @param confidence - 0–1 置信度
 * @returns 展示文本
 * @example
 * ```ts
 * associationConfidenceText(0.82);
 * ```
 */
export function associationConfidenceText(confidence?: number): string {
    return t('cowrite.cards.confidence', { pct: Math.round((confidence || 0) * 100) });
}

/**
 * 渲染候选建议卡片。
 *
 * @param container - 建议内容容器
 * @param suggestions - 建议列表
 * @param actions - 卡片动作
 * @example
 * ```ts
 * renderSuggestionCards(content, suggestions, actions);
 * ```
 */
export function renderSuggestionCards(
    container: HTMLElement,
    suggestions: SuggestionRecord[],
    actions: SuggestionCardActions,
): void {
    container.empty();
    const row = container.createDiv({ cls: 'novel-writer-cowrite-card-row' });
    suggestions.forEach((suggestion, index) => {
        const card = row.createDiv({ cls: 'novel-writer-cowrite-suggestion-card' });
        const tags = card.createDiv({ cls: 'novel-writer-cowrite-card-tags' });
        tags.createSpan({ cls: 'novel-writer-cowrite-direction-tag', text: getDirectionLabel(suggestion.direction) });
        tags.createSpan({ cls: 'novel-writer-cowrite-style-tag', text: getStyleLabel(suggestion.style) });
        tags.createSpan({ cls: 'novel-writer-cowrite-index-tag', text: `Ctrl+${index + 1}` });
        card.createDiv({ cls: 'novel-writer-cowrite-suggestion-text', text: suggestion.text });
        if (suggestion.riskLevel && suggestion.riskLevel !== 'low' && (suggestion.riskWarnings?.length || 0) > 0) {
            const riskBox = card.createDiv({ cls: `novel-writer-cowrite-risk novel-writer-cowrite-risk-${suggestion.riskLevel}` });
            riskBox.createDiv({ cls: 'novel-writer-cowrite-risk-title', text: riskBadgeLabel(suggestion.riskLevel) });
            const ul = riskBox.createEl('ul', { cls: 'novel-writer-cowrite-risk-list' });
            (suggestion.riskWarnings || []).slice(0, 3).forEach(w => ul.createEl('li', { text: w }));
        }
        const actionRow = card.createDiv({ cls: 'novel-writer-cowrite-card-actions' });
        const acceptBtn = actionRow.createEl('button', { text: t('cowrite.cards.acceptBtn'), cls: 'novel-writer-cowrite-primary-btn' });
        acceptBtn.addEventListener('click', () => actions.onAccept(suggestion));
        const editBtn = actionRow.createEl('button', { text: t('cowrite.cards.editValidateBtn'), cls: 'novel-writer-cowrite-secondary-btn' });
        editBtn.addEventListener('click', () => actions.onEdit(suggestion));
        const iterateBtn = actionRow.createEl('button', { text: t('cowrite.cards.iterateBtn'), cls: 'novel-writer-cowrite-secondary-btn' });
        iterateBtn.addEventListener('click', () => actions.onIterate(suggestion));
        const rejectBtn = actionRow.createEl('button', { text: t('cowrite.cards.rejectBtn'), cls: 'novel-writer-cowrite-secondary-btn' });
        rejectBtn.addEventListener('click', () => actions.onReject(suggestion.id));
        // E-05：差异对比——先给摘要，展开后列出行级 +/-，避免盲采纳
        attachDiffToggle(card, actionRow, suggestion, actions);
    });
}

/**
 * 渲染行级差异（+ 绿 / − 红 / 未变灰）。
 *
 * @param container - 差异容器
 * @param result - 差异结果
 * @example
 * renderDiffRows(box, diffLines(before, after));
 */
export function renderDiffRows(container: HTMLElement, result: TextDiffResult): void {
    container.empty();
    const head = container.createDiv({ cls: 'novel-writer-cowrite-diff-head' });
    head.setText(t('cowrite.cards.vsBody', { diff: describeDiff(result) }));
    const body = container.createDiv({ cls: 'novel-writer-cowrite-diff-body' });
    for (const row of result.rows) {
        if (row.kind === 'same') continue;
        const line = body.createDiv({ cls: `novel-writer-cowrite-diff-line nw-diff-${row.kind}` });
        line.createSpan({ cls: 'novel-writer-cowrite-diff-sign', text: row.kind === 'add' ? '+' : '−' });
        line.createSpan({ cls: 'novel-writer-cowrite-diff-text', text: row.text || t('cowrite.cards.blankLine') });
    }
    if (result.rows.every(row => row.kind === 'same')) {
        body.createDiv({ cls: 'novel-writer-cowrite-diff-same', text: t('cowrite.cards.identical') });
    }
}

/**
 * 给卡片挂上「差异对比」按钮与可展开的差异区。
 *
 * 候选卡与联想卡共用，避免两处实现漂移。
 *
 * @param card - 卡片容器
 * @param actionRow - 按钮行
 * @param suggestion - 建议记录
 * @param actions - 卡片动作（需提供 computeDiff）
 * @example
 * attachDiffToggle(card, actionRow, suggestion, actions);
 */
function attachDiffToggle(
    card: HTMLElement,
    actionRow: HTMLElement,
    suggestion: SuggestionRecord,
    actions: SuggestionCardActions,
): void {
    if (!actions.computeDiff) return;
    const diffResult = actions.computeDiff(suggestion);
    if (!diffResult) return;
    const diffBtn = actionRow.createEl('button', {
        text: t('cowrite.cards.diffTab', { diff: describeDiff(diffResult) }),
        cls: 'novel-writer-cowrite-secondary-btn',
        attr: { title: t('cowrite.cards.diffTabTip') },
    });
    const diffBox = card.createDiv({ cls: 'novel-writer-cowrite-diff nw-u-d-none' });
    diffBtn.addEventListener('click', () => {
        const hidden = diffBox.hasClass('nw-u-d-none');
        if (hidden) renderDiffRows(diffBox, diffResult);
        diffBox.toggleClass('nw-u-d-none', !hidden);
    });
}

/**
 * 渲染联想建议卡片。
 *
 * @param container - 建议内容容器
 * @param associations - 联想列表
 * @param suggestions - 对应的建议记录
 * @param actions - 卡片动作
 * @example
 * ```ts
 * renderAssociationCards(content, associations, suggestions, actions);
 * ```
 */
export function renderAssociationCards(
    container: HTMLElement,
    associations: AssociationSuggestion[],
    suggestions: SuggestionRecord[],
    actions: SuggestionCardActions,
): void {
    container.empty();
    const header = container.createDiv({ cls: 'novel-writer-cowrite-association-header' });
    header.createSpan({ text: t('cowrite.cards.assocInputTitle') });
    header.createSpan({ cls: 'novel-writer-cowrite-association-tip', text: t('cowrite.cards.assocInputTip') });
    const row = container.createDiv({ cls: 'novel-writer-cowrite-card-row' });
    suggestions.forEach((suggestion, index) => {
        const association = associations[index];
        const card = row.createDiv({ cls: 'novel-writer-cowrite-suggestion-card novel-writer-cowrite-association-card' });
        const tags = card.createDiv({ cls: 'novel-writer-cowrite-card-tags' });
        tags.createSpan({ cls: 'novel-writer-cowrite-direction-tag', text: getAssociationLabel(association.type) });
        tags.createSpan({ cls: 'novel-writer-cowrite-style-tag', text: associationConfidenceText(association.confidence) });
        tags.createSpan({ cls: 'novel-writer-cowrite-index-tag', text: `Ctrl+${index + 1}` });
        card.createDiv({ cls: 'novel-writer-cowrite-suggestion-text', text: association.text });
        const actionRow = card.createDiv({ cls: 'novel-writer-cowrite-card-actions' });
        const acceptBtn = actionRow.createEl('button', { text: t('cowrite.cards.insertAssocBtn'), cls: 'novel-writer-cowrite-primary-btn' });
        acceptBtn.addEventListener('click', () => actions.onAccept(suggestion));
        const editBtn = actionRow.createEl('button', { text: t('cowrite.cards.editBtn'), cls: 'novel-writer-cowrite-secondary-btn' });
        editBtn.addEventListener('click', () => actions.onEdit(suggestion));
        const rejectBtn = actionRow.createEl('button', { text: t('cowrite.cards.rejectBtn'), cls: 'novel-writer-cowrite-secondary-btn' });
        rejectBtn.addEventListener('click', () => actions.onReject(suggestion.id));
        // E-05：联想也可先看差异再插入
        attachDiffToggle(card, actionRow, suggestion, actions);
    });
}

/**
 * 渲染联想加载态（三个骨架卡）。
 *
 * @param container - 建议内容容器
 * @example
 * ```ts
 * renderAssociationLoading(content);
 * ```
 */
export function renderAssociationLoading(container: HTMLElement): void {
    container.empty();
    const header = container.createDiv({ cls: 'novel-writer-cowrite-association-header' });
    header.createSpan({ text: t('cowrite.cards.associating') });
    const row = container.createDiv({ cls: 'novel-writer-cowrite-card-row' });
    for (let i = 0; i < 3; i++) {
        const card = row.createDiv({ cls: 'novel-writer-cowrite-skeleton-card novel-writer-cowrite-association-card' });
        card.createDiv();
        card.createDiv();
        card.createDiv();
    }
}

/**
 * 渲染校验结果面板。
 *
 * @param container - 建议内容容器
 * @param validation - 校验结果
 * @param modifiedText - 用户修改后的文本
 * @param suggestion - 原建议
 * @param editDurationMs - 编辑耗时
 * @param actions - 卡片动作
 * @example
 * ```ts
 * renderValidationResult(content, validation, text, suggestion, 1200, actions);
 * ```
 */
export function renderValidationResult(
    container: HTMLElement,
    validation: EditValidation,
    modifiedText: string,
    suggestion: SuggestionRecord,
    editDurationMs: number,
    actions: SuggestionCardActions,
): void {
    container.empty();
    const degraded = validation.degraded === true;
    const panel = container.createDiv({ cls: 'novel-writer-cowrite-validation-panel' });
    const statusClass = !degraded && validation.isValid ? 'is-valid' : 'is-warning';
    panel.createDiv({
        cls: `novel-writer-cowrite-validation-title ${statusClass}`,
        text: validationTitle(degraded, validation.isValid),
    });
    if (!degraded) {
        const scores = panel.createDiv({ cls: 'novel-writer-cowrite-score-grid' });
        scores.appendChild(actions.createScoreCard(t('cowrite.cards.scoreConsistency'), validation.consistencyScore));
        scores.appendChild(actions.createScoreCard(t('cowrite.cards.scoreStyle'), validation.styleScore));
        scores.appendChild(actions.createScoreCard(t('cowrite.cards.scorePlot'), validation.plotAlignmentScore));
    }
    if (validation.warnings.length > 0) {
        const warnings = panel.createDiv({ cls: 'novel-writer-cowrite-validation-list' });
        warnings.createEl('strong', { text: t('cowrite.cards.warningsTitle') });
        validation.warnings.forEach(w => warnings.createDiv({ text: `· ${w}` }));
    }
    if (validation.suggestions.length > 0) {
        const tips = panel.createDiv({ cls: 'novel-writer-cowrite-validation-list' });
        tips.createEl('strong', { text: t('cowrite.cards.tipsTitle') });
        validation.suggestions.forEach(t => tips.createDiv({ text: `· ${t}` }));
    }
    const actionRow = panel.createDiv({ cls: 'novel-writer-cowrite-card-actions' });
    const useBtn = actionRow.createEl('button', { text: t('cowrite.cards.useBtn'), cls: 'novel-writer-cowrite-primary-btn' });
    // 与「✓ 接受」同一把采纳互斥锁：连点两次不能重复插入同一段校验后的文本
    useBtn.addEventListener('click', async () => {
        if (!actions.tryBeginAccept()) return;
        try {
            await actions.onContinue(modifiedText, suggestion, validation, editDurationMs);
        } finally {
            actions.endAccept();
        }
    });
    const editBtn = actionRow.createEl('button', { text: t('cowrite.cards.editThenValidate'), cls: 'novel-writer-cowrite-secondary-btn' });
    editBtn.addEventListener('click', () => actions.onEdit(suggestion, modifiedText));
}

/**
 * 渲染单条流式建议卡。
 *
 * @param container - 建议内容容器
 * @param direction - 方向标签
 * @param style - 风格标签
 * @param index - 候选下标
 * @param currentText - 当前累计文本
 * @param isStreaming - 是否仍在流式
 * @returns 卡片元素
 * @example
 * ```ts
 * const card = renderStreamingSuggestionCard(content, '动作', '冷峻', 0, '……', true);
 * ```
 */
export function renderStreamingSuggestionCard(
    container: HTMLElement,
    direction: string,
    style: string,
    index: number,
    currentText: string,
    isStreaming: boolean,
): HTMLElement {
    container.empty();
    const row = container.createDiv({ cls: 'novel-writer-cowrite-card-row' });
    const card = row.createDiv({ cls: 'novel-writer-cowrite-suggestion-card' });
    const tags = card.createDiv({ cls: 'novel-writer-cowrite-card-tags' });
    tags.createSpan({ cls: 'novel-writer-cowrite-direction-tag', text: direction });
    tags.createSpan({ cls: 'novel-writer-cowrite-style-tag', text: style });
    tags.createSpan({ cls: 'novel-writer-cowrite-index-tag', text: `Ctrl+${index + 1}` });
    const textEl = card.createDiv({ cls: 'novel-writer-cowrite-suggestion-text', text: currentText });
    if (isStreaming) {
        const cursor = card.createSpan({ cls: 'nw-streaming-cursor', text: '▋' });
        textEl.appendChild(cursor);
    }
    return card;
}

/**
 * 展开流式候选预览骨架（首个回调到达时创建）。
 *
 * @param container - 流式容器
 * @param cards - 已创建的卡片数组（原地填充）
 * @example
 * ```ts
 * ensureStreamingPreview(container, cards);
 * ```
 */
export function ensureStreamingPreview(container: HTMLElement | null, cards: HTMLElement[]): void {
    if (!container || !container.isConnected) return;
    if (cards.length > 0) {
        container.removeClass('nw-u-d-none');
        return;
    }
    const row = container.createDiv({ cls: 'novel-writer-cowrite-card-row nw-cowrite-stream-row' });
    for (let i = 0; i < 3; i++) {
        const card = row.createDiv({ cls: 'novel-writer-cowrite-suggestion-card nw-cowrite-streaming-card' });
        const tags = card.createDiv({ cls: 'novel-writer-cowrite-card-tags' });
        tags.createSpan({ cls: 'novel-writer-cowrite-direction-tag', text: t('cowrite.cards.candidateGenerating', { n: i + 1 }) });
        const textEl = card.createDiv({ cls: 'novel-writer-cowrite-suggestion-text nw-cowrite-streaming-text' });
        textEl.createSpan({ cls: 'nw-cowrite-stream-cursor', text: '▍' });
        cards.push(card);
    }
    container.removeClass('nw-u-d-none');
}

/**
 * 按候选索引更新流式文本。
 *
 * @param container - 流式容器
 * @param cards - 卡片数组
 * @param index - 候选下标
 * @param cumulativeText - 累计文本
 * @example
 * ```ts
 * updateStreamingPreview(container, cards, 0, '文本');
 * ```
 */
export function updateStreamingPreview(
    container: HTMLElement | null,
    cards: HTMLElement[],
    index: number,
    cumulativeText: string,
): void {
    if (!container || !container.isConnected) return;
    const card = cards[index];
    if (!card) return;
    const textEl = card.querySelector<HTMLElement>('.nw-cowrite-streaming-text');
    if (!textEl) return;
    textEl.setText(cumulativeText);
    if (cumulativeText.length > 0) {
        textEl.createSpan({ cls: 'nw-cowrite-stream-cursor', text: '▍' });
    }
}

/**
 * 清理未完成的流式骨架。
 *
 * @param container - 流式容器
 * @example
 * ```ts
 * clearStreamingPreview(container);
 * ```
 */
export function clearStreamingPreview(container: HTMLElement | null): void {
    if (container?.isConnected) {
        container.empty();
        container.addClass('nw-u-d-none');
    }
}
