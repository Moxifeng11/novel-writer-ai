import { SuggestionManager } from '../../engine/suggestion-manager';
import type { AnalysisSuggestion, SuggestionType } from '../../engine/types/analysis-suggestion';

export interface CategorizationReviewPanelOptions {
    suggestionManager: SuggestionManager;
    categoryTypes: string[];
    onAdopt: (suggestion: AnalysisSuggestion) => void;
    onReject: (suggestion: AnalysisSuggestion) => void;
    onModify: (suggestion: AnalysisSuggestion, newCategory: string) => void;
    onBatchAdopt: (count: number) => void;
}

const CATEGORIZATION_TYPES: SuggestionType[] = ['character_role'];

export class CategorizationReviewPanel {
    private container: HTMLElement;
    private options: CategorizationReviewPanelOptions;
    private filterCategory: string | 'all' = 'all';
    private expandedItems: Set<string> = new Set();

    constructor(container: HTMLElement, options: CategorizationReviewPanelOptions) {
        this.container = container;
        this.options = options;
    }

    render(): void {
        this.container.empty();
        this.container.addClass('nw-categorization-review-panel');

        this.renderHeader();
        this.renderBody();
    }

    update(): void {
        this.render();
    }

    destroy(): void {
        this.container.empty();
    }

    private renderHeader(): void {
        const header = this.container.createDiv('nw-cat-header');

        const titleSection = header.createDiv('nw-cat-header-title');
        titleSection.createEl('h3', { text: '🏷️ 分类建议审核' });

        const stats = this.getOverallStats();
        const statsText = titleSection.createSpan('nw-cat-header-stats');
        statsText.setText(
            `待处理 ${stats.pending} · 已采纳 ${stats.adopted} · 已拒绝 ${stats.rejected} · 已修改 ${stats.modified}`
        );

        this.renderBatchActions(header);
    }

    private renderBody(): void {
        const body = this.container.createDiv('nw-cat-body');
        this.renderFilter(body);
        this.renderSuggestionList(body);
    }

    private renderFilter(container: HTMLElement): void {
        const filter = container.createDiv('nw-cat-filter');
        filter.createEl('h4', { text: '分类筛选', cls: 'nw-cat-filter-title' });

        const btnGroup = filter.createDiv('nw-cat-filter-buttons');

        const allBtn = btnGroup.createEl('button', {
            text: '全部',
            cls: 'nw-cat-filter-btn'
        });
        if (this.filterCategory === 'all') {
            allBtn.addClass('is-active');
        }
        allBtn.onclick = () => {
            this.filterCategory = 'all';
            this.update();
        };

        const categoryStats = this.getCategoryStats();
        for (const cat of this.options.categoryTypes) {
            const stat = categoryStats[cat] || { pending: 0, adopted: 0, rejected: 0 };
            const btn = btnGroup.createEl('button', {
                cls: 'nw-cat-filter-btn'
            });
            if (this.filterCategory === cat) {
                btn.addClass('is-active');
            }
            btn.createSpan({ text: this.getCategoryLabel(cat) });
            btn.createSpan({ text: ` (${stat.pending})`, cls: 'nw-cat-filter-count' });
            btn.onclick = () => {
                this.filterCategory = cat;
                this.update();
            };
        }
    }

    private renderSuggestionList(container: HTMLElement): void {
        const list = container.createDiv('nw-cat-list');

        const suggestions = this.getFilteredSuggestions();

        if (suggestions.length === 0) {
            const empty = list.createDiv('nw-cat-empty');
            empty.createEl('p', { text: '暂无待处理的分类建议' });
            return;
        }

        suggestions.forEach((suggestion, index) => {
            const item = this.renderSuggestionItem(suggestion, index);
            list.appendChild(item);
        });
    }

    private renderSuggestionItem(suggestion: AnalysisSuggestion, index: number): HTMLElement {
        const item = document.createElement('div');
        item.className = 'nw-cat-item';
        item.dataset.id = suggestion.id;
        item.dataset.status = suggestion.status;

        if (suggestion.status === 'adopted') item.addClass('adopted');
        if (suggestion.status === 'rejected') item.addClass('rejected');
        if (suggestion.status === 'modified') item.addClass('modified');

        const mainRow = item.createDiv('nw-cat-item-main');

        const leftSection = mainRow.createDiv('nw-cat-item-left');
        const characterName = suggestion.payload.characterName || '未知角色';
        const nameEl = leftSection.createEl('span', {
            text: characterName,
            cls: 'nw-cat-item-name'
        });

        const currentCategory = suggestion.payload.category || '未分类';
        const catTag = leftSection.createSpan({
            text: this.getCategoryLabel(currentCategory),
            cls: 'nw-cat-item-category'
        });
        catTag.dataset.category = currentCategory;

        if (suggestion.status === 'modified' && suggestion.originalPayload?.category) {
            const originalCat = leftSection.createSpan({
                text: this.getCategoryLabel(suggestion.originalPayload.category),
                cls: 'nw-cat-item-category-original'
            });
            originalCat.setText(`(原: ${this.getCategoryLabel(suggestion.originalPayload.category)})`);
        }

        const middleSection = mainRow.createDiv('nw-cat-item-middle');
        middleSection.innerHTML = this.renderConfidenceBadge(suggestion.confidence);

        if (suggestion.evidence && suggestion.evidence.length > 0) {
            const evidencePreview = middleSection.createSpan({
                cls: 'nw-cat-evidence-preview'
            });
            evidencePreview.setText(`"${this.truncateText(suggestion.evidence[0], 60)}"`);
        }

        const rightSection = mainRow.createDiv('nw-cat-item-right');
        this.renderItemActions(rightSection, suggestion);

        const isExpanded = this.expandedItems.has(suggestion.id);
        if (isExpanded && suggestion.evidence && suggestion.evidence.length > 0) {
            const detail = item.createDiv('nw-cat-item-detail');
            detail.createEl('h5', { text: '证据列表' });
            const evidenceList = detail.createDiv('nw-cat-evidence-list');
            suggestion.evidence.forEach((ev, i) => {
                const evItem = evidenceList.createDiv('nw-cat-evidence-item');
                evItem.createSpan({ text: `${i + 1}. `, cls: 'nw-cat-evidence-index' });
                evItem.createSpan({ text: ev });
            });
        }

        mainRow.onclick = (e) => {
            const target = e.target as HTMLElement;
            if (target.closest('.nw-cat-actions') || target.closest('.nw-cat-selector')) return;
            if (this.expandedItems.has(suggestion.id)) {
                this.expandedItems.delete(suggestion.id);
            } else {
                this.expandedItems.add(suggestion.id);
            }
            this.update();
        };

        return item;
    }

    private renderItemActions(container: HTMLElement, suggestion: AnalysisSuggestion): void {
        const actions = container.createDiv('nw-cat-actions');

        if (suggestion.status === 'pending' || suggestion.status === 'modified') {
            const adoptBtn = actions.createEl('button', {
                text: '✓ 采纳',
                cls: 'nw-cat-btn nw-cat-btn-adopt'
            });
            adoptBtn.onclick = (e) => {
                e.stopPropagation();
                this.options.suggestionManager.adopt(suggestion.id);
                this.options.onAdopt(this.options.suggestionManager.getSuggestionById(suggestion.id)!);
                this.update();
            };

            const modifyBtn = actions.createEl('button', {
                text: '✎ 修改',
                cls: 'nw-cat-btn nw-cat-btn-modify'
            });
            modifyBtn.onclick = (e) => {
                e.stopPropagation();
                this.showCategorySelector(suggestion, actions);
            };

            const rejectBtn = actions.createEl('button', {
                text: '✕ 拒绝',
                cls: 'nw-cat-btn nw-cat-btn-reject'
            });
            rejectBtn.onclick = (e) => {
                e.stopPropagation();
                this.options.suggestionManager.reject(suggestion.id);
                this.options.onReject(this.options.suggestionManager.getSuggestionById(suggestion.id)!);
                this.update();
            };
        } else if (suggestion.status === 'adopted') {
            const statusBadge = actions.createSpan({
                text: '✓ 已采纳',
                cls: 'nw-cat-status-badge nw-cat-status-adopted'
            });
        } else if (suggestion.status === 'rejected') {
            const statusBadge = actions.createSpan({
                text: '✕ 已拒绝',
                cls: 'nw-cat-status-badge nw-cat-status-rejected'
            });
            const resetBtn = actions.createEl('button', {
                text: '↺ 撤销',
                cls: 'nw-cat-btn nw-cat-btn-reset'
            });
            resetBtn.onclick = (e) => {
                e.stopPropagation();
                const s = this.options.suggestionManager.getSuggestionById(suggestion.id);
                if (s) {
                    s.status = 'pending';
                    this.options.suggestionManager['suggestions'].set(suggestion.id, s);
                }
                this.update();
            };
        }
    }

    private showCategorySelector(suggestion: AnalysisSuggestion, anchor: HTMLElement): void {
        const existing = anchor.querySelector('.nw-cat-selector-popup');
        if (existing) {
            existing.remove();
            return;
        }

        const popup = anchor.createDiv('nw-cat-selector-popup');
        popup.createEl('div', { text: '选择分类', cls: 'nw-cat-selector-title' });

        const selector = popup.createDiv('nw-cat-selector');
        const currentCategory = suggestion.payload.category || '';

        for (const cat of this.options.categoryTypes) {
            const btn = selector.createEl('button', {
                text: this.getCategoryLabel(cat),
                cls: 'nw-cat-selector-btn'
            });
            if (cat === currentCategory) {
                btn.addClass('is-selected');
            }
            btn.onclick = (e) => {
                e.stopPropagation();
                const newPayload = { ...suggestion.payload, category: cat };
                this.options.suggestionManager.adopt(suggestion.id, newPayload);
                const updated = this.options.suggestionManager.getSuggestionById(suggestion.id)!;
                this.options.onModify(updated, cat);
                popup.remove();
                this.update();
            };
        }

        const cancelBtn = popup.createEl('button', {
            text: '取消',
            cls: 'nw-cat-selector-cancel'
        });
        cancelBtn.onclick = (e) => {
            e.stopPropagation();
            popup.remove();
        };

        setTimeout(() => {
            const closeHandler = (e: MouseEvent) => {
                const target = e.target as Node;
                if (!popup.contains(target)) {
                    popup.remove();
                    document.removeEventListener('click', closeHandler);
                }
            };
            document.addEventListener('click', closeHandler);
        }, 0);
    }

    private renderBatchActions(container: HTMLElement): void {
        const batch = container.createDiv('nw-cat-batch-actions');

        const highConfCount = this.getHighConfidenceCount();
        const batchBtn = batch.createEl('button', {
            text: `⚡ 一键采纳高置信度 (${highConfCount})`,
            cls: 'nw-cat-batch-btn mod-cta'
        });
        batchBtn.onclick = () => {
            const count = this.options.suggestionManager.batchAdopt({
                type: CATEGORIZATION_TYPES[0],
                minConfidence: 0.8
            });
            this.options.onBatchAdopt(count);
            this.update();
        };
    }

    private renderConfidenceBadge(confidence: number): string {
        const level = confidence >= 0.9 ? 'high' : confidence >= 0.7 ? 'medium' : 'low';
        const percentage = Math.round(confidence * 100);
        return `<span class="nw-confidence-badge confidence-${level}">${percentage}%</span>`;
    }

    getCategoryStats(): Record<string, { pending: number; adopted: number; rejected: number; modified: number }> {
        const stats: Record<string, { pending: number; adopted: number; rejected: number; modified: number }> = {};

        for (const cat of this.options.categoryTypes) {
            stats[cat] = { pending: 0, adopted: 0, rejected: 0, modified: 0 };
        }

        const suggestions = this.getCategorizationSuggestions();
        for (const s of suggestions) {
            const category = s.payload.category;
            if (category && stats[category]) {
                stats[category][s.status]++;
            }
        }

        return stats;
    }

    private getCategorizationSuggestions(): AnalysisSuggestion[] {
        const all: AnalysisSuggestion[] = [];
        for (const type of CATEGORIZATION_TYPES) {
            all.push(...this.options.suggestionManager.getAllSuggestions(type));
        }
        return all;
    }

    private getFilteredSuggestions(): AnalysisSuggestion[] {
        let suggestions = this.getCategorizationSuggestions();

        if (this.filterCategory !== 'all') {
            suggestions = suggestions.filter(s => s.payload.category === this.filterCategory);
        }

        return suggestions.sort((a, b) => {
            const statusOrder: Record<string, number> = {
                pending: 0,
                modified: 1,
                adopted: 2,
                rejected: 3
            };
            const statusDiff = statusOrder[a.status] - statusOrder[b.status];
            if (statusDiff !== 0) return statusDiff;
            return b.confidence - a.confidence;
        });
    }

    private getOverallStats(): { total: number; pending: number; adopted: number; rejected: number; modified: number } {
        const suggestions = this.getCategorizationSuggestions();
        return {
            total: suggestions.length,
            pending: suggestions.filter(s => s.status === 'pending').length,
            adopted: suggestions.filter(s => s.status === 'adopted').length,
            rejected: suggestions.filter(s => s.status === 'rejected').length,
            modified: suggestions.filter(s => s.status === 'modified').length
        };
    }

    private getHighConfidenceCount(): number {
        return this.getCategorizationSuggestions().filter(
            s => s.status === 'pending' && s.confidence >= 0.8
        ).length;
    }

    private getCategoryLabel(category: string): string {
        const labels: Record<string, string> = {
            protagonist: '主角',
            antagonist: '反派',
            mentor: '导师',
            ally: '盟友',
            supporting: '配角',
            passerby: '路人',
            mysterious: '神秘人物',
            rival: '对手',
            love_interest: '感情线',
            family: '家人'
        };
        return labels[category] || category;
    }

    private truncateText(text: string, maxLength: number): string {
        if (text.length <= maxLength) return text;
        return text.slice(0, maxLength) + '...';
    }
}
