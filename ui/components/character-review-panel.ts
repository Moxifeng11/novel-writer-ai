import { SuggestionManager } from '../../engine/suggestion-manager';
import type { AnalysisSuggestion, SuggestionType, SuggestionStatus } from '../../engine/types/analysis-suggestion';

/**
 * CharacterReviewPanelOptions 类型定义。
 */
export interface CharacterReviewPanelOptions {
    suggestionManager: SuggestionManager;
    onAdopt: (suggestion: AnalysisSuggestion) => void;
    onReject: (suggestion: AnalysisSuggestion) => void;
    onModify: (suggestion: AnalysisSuggestion, modifiedPayload: Record<string, any>) => void;
    onBatchAdopt: (count: number) => void;
}

type TabKey = 'characters' | 'merges' | 'all';

/**
 * CharacterReviewPanel 类。
 */
export class CharacterReviewPanel {
    private container: HTMLElement;
    private options: CharacterReviewPanelOptions;
    private activeTab: TabKey = 'characters';
    private expandedEvidence: Set<string> = new Set();

    private headerEl!: HTMLElement;
    private tabsEl!: HTMLElement;
    private contentEl!: HTMLElement;
    private batchActionsEl!: HTMLElement;

    constructor(container: HTMLElement, options: CharacterReviewPanelOptions) {
        this.container = container;
        this.options = options;
    }

    /**
     * 渲染。
     */
    render(): void {
        this.container.empty();
        this.container.addClass('nw-character-review-panel');

        this.renderHeader();
        this.renderTabs();
        this.renderContent();
        this.renderBatchActions();
    }

    /**
     * 更新。
     */
    update(): void {
        this.renderHeaderStats();
        this.renderContent();
        this.renderBatchActions();
    }

    /**
     * 销毁。
     */
    destroy(): void {
        this.container.empty();
        this.expandedEvidence.clear();
    }

    /**
     * getStats 方法。
      * @returns number } 结果
     */
    getStats(): { total: number; pending: number; adopted: number; rejected: number } {
        const stats = this.options.suggestionManager.getStats();
        return {
            total: stats.total,
            pending: stats.pending,
            adopted: stats.adopted,
            rejected: stats.rejected,
        };
    }

    // ============================================================
    // 渲染方法
    // ============================================================

    private renderHeader(): void {
        this.headerEl = this.container.createDiv({
            cls: 'nw-review-header',
        });

        const titleRow = this.headerEl.createDiv({
            cls: 'nw-review-title-row',
        });

        titleRow.createEl('h3', {
            text: '👤 角色审核',
            cls: 'nw-review-title',
        });

        this.renderHeaderStats();
    }

    private renderHeaderStats(): void {
        const statsEl = this.headerEl.querySelector('.nw-review-stats');
        if (statsEl) {
            statsEl.remove();
        }

        const stats = this.getStats();
        const statsElNew = this.headerEl.createDiv({
            cls: 'nw-review-stats',
        });

        this.createStatBadge(statsElNew, '待审核', stats.pending, 'pending');
        this.createStatBadge(statsElNew, '已采纳', stats.adopted, 'adopted');
        this.createStatBadge(statsElNew, '已拒绝', stats.rejected, 'rejected');
    }

    private createStatBadge(
        container: HTMLElement,
        label: string,
        count: number,
        type: 'pending' | 'adopted' | 'rejected'
    ): void {
        const badge = container.createDiv({
            cls: `nw-stat-badge nw-stat-${type}`,
        });
        badge.createSpan({
            text: count.toString(),
            cls: 'nw-stat-count',
        });
        badge.createSpan({
            text: label,
            cls: 'nw-stat-label',
        });
    }

    private renderTabs(): void {
        this.tabsEl = this.container.createDiv({
            cls: 'nw-review-tabs',
        });

        const tabs: { key: TabKey; label: string }[] = [
            { key: 'characters', label: '角色建议' },
            { key: 'merges', label: '合并建议' },
            { key: 'all', label: '全部' },
        ];

        tabs.forEach(tab => {
            const tabEl = this.tabsEl.createDiv({
                cls: `nw-review-tab${this.activeTab === tab.key ? ' active' : ''}`,
                text: tab.label,
            });
            tabEl.addEventListener('click', () => {
                this.activeTab = tab.key;
                this.renderTabs();
                this.renderContent();
            });
        });
    }

    private renderContent(): void {
        if (!this.contentEl) {
            this.contentEl = this.container.createDiv({
                cls: 'nw-review-content',
            });
        } else {
            this.contentEl.empty();
        }

        const suggestions = this.getFilteredSuggestions();

        if (suggestions.length === 0) {
            this.renderEmptyState();
            return;
        }

        suggestions.forEach((suggestion, index) => {
            const card = this.renderSuggestionCard(suggestion, index);
            this.contentEl.appendChild(card);
        });
    }

    private renderEmptyState(): void {
        const empty = this.contentEl.createDiv({
            cls: 'nw-review-empty',
        });
        empty.createDiv({
            cls: 'nw-review-empty-icon',
            text: '📭',
        });
        empty.createDiv({
            cls: 'nw-review-empty-title',
            text: '暂无建议',
        });
        empty.createDiv({
            cls: 'nw-review-empty-desc',
            text: this.activeTab === 'characters'
                ? '没有待审核的角色建议'
                : this.activeTab === 'merges'
                ? '没有待审核的合并建议'
                : '没有任何建议数据',
        });
    }

    private getFilteredSuggestions(): AnalysisSuggestion[] {
        const all = this.options.suggestionManager.getAllSuggestions();
        const characterTypes: SuggestionType[] = ['character', 'character_role'];
        const mergeTypes: SuggestionType[] = ['character_merge'];

        let filtered: AnalysisSuggestion[];

        switch (this.activeTab) {
            case 'characters':
                filtered = all.filter(s => characterTypes.includes(s.type));
                break;
            case 'merges':
                filtered = all.filter(s => mergeTypes.includes(s.type));
                break;
            case 'all':
                filtered = all.filter(s =>
                    [...characterTypes, ...mergeTypes].includes(s.type)
                );
                break;
        }

        return filtered.sort((a, b) => {
            const statusOrder: Record<SuggestionStatus, number> = {
                pending: 0,
                modified: 1,
                adopted: 2,
                rejected: 3,
            };
            const statusDiff = statusOrder[a.status] - statusOrder[b.status];
            if (statusDiff !== 0) return statusDiff;
            return b.confidence - a.confidence;
        });
    }

    private renderSuggestionCard(suggestion: AnalysisSuggestion, index: number): HTMLElement {
        const card = document.createElement('div');
        card.className = `nw-suggestion-card ${suggestion.status}`;
        card.dataset.suggestionId = suggestion.id;

        this.renderCardHeader(card, suggestion);
        this.renderConfidenceBar(card, suggestion.confidence);
        this.renderSourceAndType(card, suggestion);
        this.renderEvidenceSection(card, suggestion);
        this.renderActionButtons(card, suggestion);

        return card;
    }

    private renderCardHeader(card: HTMLElement, suggestion: AnalysisSuggestion): void {
        const header = card.createDiv({
            cls: 'nw-card-header',
        });

        const title = header.createDiv({
            cls: 'nw-card-title',
        });

        if (suggestion.type === 'character_merge') {
            const sourceName = suggestion.payload?.sourceName || '未知';
            const targetName = suggestion.payload?.targetName || '未知';
            title.createSpan({
                text: sourceName,
                cls: 'nw-merge-source',
            });
            title.createSpan({
                text: ' → ',
                cls: 'nw-merge-arrow',
            });
            title.createSpan({
                text: targetName,
                cls: 'nw-merge-target',
            });
        } else {
            const name = suggestion.payload?.name || suggestion.payload?.characterName || '未知角色';
            title.createSpan({
                text: name,
                cls: 'nw-character-name',
            });

            if (suggestion.payload?.aliases?.length > 0) {
                const aliases = suggestion.payload.aliases.slice(0, 3).join(' / ');
                title.createSpan({
                    text: ` (${aliases}${suggestion.payload.aliases.length > 3 ? '...' : ''})`,
                    cls: 'nw-character-aliases',
                });
            }
        }

        const statusBadge = header.createDiv({
            cls: `nw-status-badge ${suggestion.status}`,
            text: this.getStatusLabel(suggestion.status),
        });
        void statusBadge;
    }

    private getStatusLabel(status: SuggestionStatus): string {
        const labels: Record<SuggestionStatus, string> = {
            pending: '待审核',
            adopted: '已采纳',
            rejected: '已拒绝',
            modified: '已修改',
        };
        return labels[status] || status;
    }

    private renderConfidenceBar(card: HTMLElement, confidence: number): void {
        const barContainer = card.createDiv({
            cls: 'nw-confidence-bar-container',
        });

        const label = barContainer.createDiv({
            cls: 'nw-confidence-label',
        });
        label.createSpan({ text: '置信度' });
        label.createSpan({
            text: `${(confidence * 100).toFixed(0)}%`,
            cls: 'nw-confidence-value',
        });

        const barWrap = barContainer.createDiv({
            cls: 'nw-confidence-bar',
        });
        const barFill = barWrap.createDiv({
            cls: 'nw-confidence-fill',
            attr: {
                style: `width: ${Math.max(0, Math.min(100, confidence * 100))}%`,
            },
        });

        const color = this.getConfidenceColor(confidence);
        barFill.style.background = color;
    }

    private getConfidenceColor(confidence: number): string {
        if (confidence >= 0.8) return 'var(--nw-success, #2ecc71)';
        if (confidence >= 0.6) return 'var(--nw-warning, #f59e0b)';
        return 'var(--nw-danger, #e74c3c)';
    }

    private renderSourceAndType(card: HTMLElement, suggestion: AnalysisSuggestion): void {
        const meta = card.createDiv({
            cls: 'nw-card-meta',
        });

        const sourceTag = meta.createSpan({
            cls: `nw-source-tag source-${suggestion.source}`,
            text: this.getSourceLabel(suggestion.source),
        });
        void sourceTag;

        const typeTag = meta.createSpan({
            cls: `nw-type-tag type-${suggestion.type}`,
            text: this.getTypeLabel(suggestion.type),
        });
        void typeTag;

        if (suggestion.reason) {
            meta.createDiv({
                cls: 'nw-suggestion-reason',
                text: suggestion.reason,
            });
        }
    }

    private getSourceLabel(source: string): string {
        const labels: Record<string, string> = {
            rule: '规则匹配',
            vector: '向量检索',
            llm: 'AI分析',
        };
        return labels[source] || source;
    }

    private getTypeLabel(type: SuggestionType): string {
        const labels: Record<string, string> = {
            character: '新角色',
            character_merge: '角色合并',
            character_role: '角色定位',
            character_alias: '角色别名',
        };
        return labels[type] || type;
    }

    private renderEvidenceSection(card: HTMLElement, suggestion: AnalysisSuggestion): void {
        const evidence = suggestion.evidence || [];
        if (evidence.length === 0) return;

        const section = card.createDiv({
            cls: 'nw-evidence-section',
        });

        section.createDiv({
            cls: 'nw-evidence-title',
            text: `📝 证据片段 (${evidence.length})`,
        });

        const isExpanded = this.expandedEvidence.has(suggestion.id);
        const displayEvidence = isExpanded ? evidence : evidence.slice(0, 2);

        const list = section.createDiv({
            cls: 'nw-evidence-list',
        });

        displayEvidence.forEach((ev: string, idx: number) => {
            const item = list.createDiv({
                cls: 'nw-evidence-item',
            });
            item.createSpan({
                text: `${idx + 1}. `,
                cls: 'nw-evidence-index',
            });
            item.createSpan({
                text: this.truncateText(ev, 100),
                cls: 'nw-evidence-text',
            });
        });

        if (evidence.length > 2) {
            const toggle = section.createDiv({
                cls: 'nw-evidence-toggle',
                text: isExpanded ? '收起' : `展开更多 (${evidence.length - 2})`,
            });
            toggle.addEventListener('click', () => {
                if (isExpanded) {
                    this.expandedEvidence.delete(suggestion.id);
                } else {
                    this.expandedEvidence.add(suggestion.id);
                }
                this.updateEvidenceSection(card, suggestion);
            });
        }
    }

    private updateEvidenceSection(card: HTMLElement, suggestion: AnalysisSuggestion): void {
        const oldSection = card.querySelector('.nw-evidence-section');
        if (!oldSection) return;

        const tempContainer = document.createElement('div');
        this.renderEvidenceSection(tempContainer, suggestion);
        const newSection = tempContainer.firstElementChild;
        if (newSection) {
            oldSection.replaceWith(newSection);
        }
    }

    private truncateText(text: string, maxLen: number): string {
        if (text.length <= maxLen) return text;
        return text.slice(0, maxLen) + '…';
    }

    private renderActionButtons(card: HTMLElement, suggestion: AnalysisSuggestion): void {
        const actions = card.createDiv({
            cls: 'nw-review-actions',
        });

        if (suggestion.status === 'pending' || suggestion.status === 'modified') {
            const adoptBtn = actions.createEl('button', {
                cls: 'nw-btn nw-btn-success nw-btn-sm',
                text: '✓ 采纳',
            });
            adoptBtn.addEventListener('click', () => {
                this.options.onAdopt(suggestion);
                this.update();
            });

            if (suggestion.type === 'character_merge') {
                const swapBtn = actions.createEl('button', {
                    cls: 'nw-btn nw-btn-secondary nw-btn-sm',
                    text: '⇄ 交换主名',
                });
                swapBtn.addEventListener('click', () => {
                    const modified = { ...suggestion.payload };
                    const temp = modified.sourceName;
                    modified.sourceName = modified.targetName;
                    modified.targetName = temp;
                    this.options.onModify(suggestion, modified);
                    this.update();
                });
            }

            const modifyBtn = actions.createEl('button', {
                cls: 'nw-btn nw-btn-secondary nw-btn-sm',
                text: '✎ 修改',
            });
            modifyBtn.addEventListener('click', () => {
                this.handleModify(suggestion);
            });

            const rejectBtn = actions.createEl('button', {
                cls: 'nw-btn nw-btn-danger nw-btn-sm',
                text: '✕ 拒绝',
            });
            rejectBtn.addEventListener('click', () => {
                this.options.onReject(suggestion);
                this.update();
            });
        }
    }

    private handleModify(suggestion: AnalysisSuggestion): void {
        const currentName = suggestion.payload?.name || suggestion.payload?.sourceName || '';
        const input = prompt('请输入修改后的名称：', currentName);

        if (input === null) return;

        const trimmed = input.trim();
        if (!trimmed) return;

        const modified = { ...suggestion.payload };
        if (suggestion.type === 'character_merge') {
            modified.targetName = trimmed;
        } else {
            modified.name = trimmed;
        }

        this.options.onModify(suggestion, modified);
        this.update();
    }

    private renderBatchActions(): void {
        if (!this.batchActionsEl) {
            this.batchActionsEl = this.container.createDiv({
                cls: 'nw-batch-actions',
            });
        } else {
            this.batchActionsEl.empty();
        }

        const pendingHighConfidence = this.options.suggestionManager
            .getPendingSuggestions()
            .filter(s => {
                const validTypes: SuggestionType[] = ['character', 'character_merge', 'character_role'];
                return validTypes.includes(s.type) && s.confidence >= 0.7;
            }).length;

        const leftInfo = this.batchActionsEl.createDiv({
            cls: 'nw-batch-info',
        });
        leftInfo.createSpan({
            text: `高置信度(≥70%)待审核：${pendingHighConfidence} 条`,
            cls: 'nw-text-sm-muted',
        });

        const rightActions = this.batchActionsEl.createDiv({
            cls: 'nw-batch-buttons',
        });

        const batchAdoptBtn = rightActions.createEl('button', {
            cls: 'nw-btn nw-btn-primary',
            text: `⚡ 一键采纳高置信度 (${pendingHighConfidence})`,
        });
        batchAdoptBtn.disabled = pendingHighConfidence === 0;
        batchAdoptBtn.addEventListener('click', () => {
            if (pendingHighConfidence === 0) return;
            const count = this.options.suggestionManager.batchAdopt({
                minConfidence: 0.7,
            });
            this.options.onBatchAdopt(count);
            this.update();
        });
    }
}
