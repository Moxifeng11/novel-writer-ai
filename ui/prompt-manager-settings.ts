import { App, Notice, Modal, Setting } from 'obsidian';
import type NovelWriterPlugin from '@/main';
import { PromptManager, promptCategoryLabel, PROMPT_CATEGORY_IDS } from '@/services/prompt-manager';
import { t } from '@/i18n';
import type {
    PromptTemplate,
    PromptCategory,
    ABTest,
    ABTestMetrics,
    PromptTemplateVersion,
} from '@/shared/prompt-manager-types';
import { OperationConfirmModal } from './components/progress';
import { showErrorNotice, showSuccessNotice } from './components/notice-helpers';
import { exportTextFile } from '@/shared/export-file';
import { buildVariantStatRows } from './prompt-manager-logic';
import { buildPromptImportDiff, type PromptImportMode } from '@/shared/prompt-manager-import';
import { PromptImportPreviewModal } from './prompt-import-preview-modal';
import { createCompactEmptyState } from './components/empty-state';

/** A/B 测试状态的标签键（未知状态回落原始值，避免旧数据渲染成空） */
const STATUS_LABEL_KEYS: Record<string, string> = {
    draft: 'settings.promptManager.statusDraft',
    running: 'settings.promptManager.statusRunning',
    paused: 'settings.promptManager.statusPaused',
    completed: 'settings.promptManager.statusCompleted',
};

/**
 * 提示词管理器设置列表。
 */
export class PromptManagerSettings {
    private plugin: NovelWriterPlugin;
    private app: App;
    private container: HTMLElement;
    private activeSubTab: string = 'templates';
    private selectedCategory: PromptCategory | 'all' = 'all';
    private selectedTemplateId: string | null = null;
    private selectedTestId: string | null = null;
    private searchKeyword: string = '';
    /** 子页签外壳（切页签只改 is-active，不重建整页） */
    private subTabEls: Array<{ id: string; el: HTMLElement }> = [];
    /** 子页签内容容器（局部重建的唯一入口） */
    private contentEl: HTMLElement | null = null;
    /** 模板列表容器（搜索时只重绘这里，输入框不失焦） */
    private templateListEl: HTMLElement | null = null;
    /** 模板详情容器（选中模板只重绘这里） */
    private templateDetailEl: HTMLElement | null = null;
    /** 使用记录当前页（0 基） */
    private usagePage = 0;
    /** 使用记录每页条数 */
    private readonly usagePageSize = 20;

    constructor(app: App, plugin: NovelWriterPlugin, container: HTMLElement) {
        this.app = app;
        this.plugin = plugin;
        this.container = container;
    }

    private get promptManager(): PromptManager {
        return this.plugin.promptManager!;
    }

    /**
     * 渲染外壳（子页签栏 + 内容容器），并画出当前子页签。
     *
     * 与旧实现的区别：以前任何一次状态变化都调 render() 把整个设置页推倒重来，
     * 导致搜索框每输入一个字就失焦、子页签点击也重建整块 DOM。现在外壳只建一次，
     * 状态变化走 renderActiveTab() 只清内容容器；子页签切换只改 is-active。
     *
     * @returns 无
     */
    render(): void {
        this.container.empty();

        const subTabBar = this.container.createDiv({ cls: 'nw-settings-subtab-bar' });
        const subTabs = [
            { id: 'templates', label: t('settings.promptManager.subtabTemplates') },
            { id: 'abtests', label: t('settings.promptManager.subtabABTests') },
            { id: 'usage', label: t('settings.promptManager.subtabUsage') },
            { id: 'import-export', label: t('settings.promptManager.subtabImportExport') },
        ];

        this.subTabEls = [];
        for (const tab of subTabs) {
            const tabEl = subTabBar.createDiv({
                cls: 'nw-settings-subtab',
                text: tab.label,
                attr: { 'data-subtab-id': tab.id },
            });
            if (tab.id === this.activeSubTab) tabEl.addClass('is-active');
            tabEl.addEventListener('click', () => this.switchSubTab(tab.id));
            this.subTabEls.push({ id: tab.id, el: tabEl });
        }

        this.contentEl = this.container.createDiv({ cls: 'nw-settings-subtab-content' });
        this.renderActiveTab();
    }

    /**
     * 切换子页签：只更新高亮类并重绘内容区，不重建页签栏。
     *
     * @param id - 目标子页签 id
     * @returns 无
     */
    private switchSubTab(id: string): void {
        if (id === this.activeSubTab) return;
        this.activeSubTab = id;
        for (const item of this.subTabEls) {
            item.el.toggleClass('is-active', item.id === id);
        }
        this.renderActiveTab();
    }

    /**
     * 只重绘内容区（子页签内容），保留外壳与页签高亮。
     *
     * @returns 无
     */
    private renderActiveTab(): void {
        const content = this.contentEl;
        if (!content) {
            // 还没建过外壳（例如外部直接调 renderActiveTab）时退回整页渲染一次
            this.render();
            return;
        }
        content.empty();
        this.templateListEl = null;
        this.templateDetailEl = null;

        switch (this.activeSubTab) {
            case 'templates':
                this.renderTemplatesTab(content);
                break;
            case 'abtests':
                this.renderABTestsTab(content);
                break;
            case 'usage':
                this.renderUsageTab(content);
                break;
            case 'import-export':
                this.renderImportExportTab(content);
                break;
        }
    }

    private renderTemplatesTab(container: HTMLElement): void {
        const layout = container.createDiv({ cls: 'nw-pm-layout' });

        const sidebar = layout.createDiv({ cls: 'nw-pm-sidebar' });
        const main = layout.createDiv({ cls: 'nw-pm-main' });

        this.templateDetailEl = main;
        this.renderTemplateSidebar(sidebar);
        this.renderTemplateDetail(main);
    }

    private renderTemplateSidebar(container: HTMLElement): void {
        new Setting(container)
            .setName(t('settings.promptManager.searchName'))
            .addText(text => {
                text.setPlaceholder(t('settings.promptManager.searchPlaceholder'))
                    .setValue(this.searchKeyword)
                    .onChange(value => {
                        this.searchKeyword = value;
                        // 只重绘列表：旧实现调 render() 会连同输入框自身一起重建，每敲一个字就失焦
                        this.renderTemplateListItems();
                    });
            });

        const categoryList = container.createDiv({ cls: 'nw-pm-category-list' });
        const categoryEntries: Array<{ id: PromptCategory | 'all'; el: HTMLElement }> = [];

        const allBtn = categoryList.createEl('button', {
            text: t('settings.promptManager.allCategory', { count: this.promptManager.getAllTemplates().length }),
            cls: `nw-pm-category-btn nw-pm-category-btn--all${this.selectedCategory === 'all' ? ' nw-pm-category-btn--active' : ''}`,
            attr: { type: 'button', 'aria-pressed': this.selectedCategory === 'all' ? 'true' : 'false' },
        });
        categoryEntries.push({ id: 'all', el: allBtn });

        for (const { category, count } of this.promptManager.getCategories()) {
            const label = promptCategoryLabel(category);
            const btn = categoryList.createEl('button', {
                text: `${label} (${count})`,
                cls: `nw-pm-category-btn${this.selectedCategory === category ? ' nw-pm-category-btn--active' : ''}`,
                attr: { type: 'button', 'aria-pressed': this.selectedCategory === category ? 'true' : 'false' },
            });
            categoryEntries.push({ id: category, el: btn });
        }

        for (const entry of categoryEntries) {
            entry.el.onclick = () => this.selectCategory(entry.id, categoryEntries);
        }
        this.bindListKeyboardNav(categoryEntries.map(entry => ({
            el: entry.el,
            activate: () => this.selectCategory(entry.id, categoryEntries),
        })));

        this.templateListEl = container.createDiv({ cls: 'nw-pm-template-list' });
        this.renderTemplateListItems();

        const addBtn = container.createEl('button', {
            text: t('settings.promptManager.addCustomBtn'),
            cls: 'nw-pm-add-btn',
            attr: { type: 'button' }
        });
        addBtn.onclick = () => this.showCreateTemplateModal();
    }

    /**
     * 选中分类：只改按钮高亮 + 重绘模板列表，不动搜索框与详情外壳。
     *
     * @param id - 分类 id 或 'all'
     * @param entries - 分类按钮引用表
     * @returns 无
     */
    private selectCategory(
        id: PromptCategory | 'all',
        entries: Array<{ id: PromptCategory | 'all'; el: HTMLElement }>,
    ): void {
        this.selectedCategory = id;
        for (const entry of entries) {
            const active = entry.id === id;
            entry.el.toggleClass('nw-pm-category-btn--active', active);
            entry.el.setAttribute('aria-pressed', active ? 'true' : 'false');
        }
        this.renderTemplateListItems();
    }

    /**
     * 重绘模板列表（搜索/切分类/选中态变化时调用）。
     *
     * @returns 无
     */
    private renderTemplateListItems(): void {
        const list = this.templateListEl;
        if (!list) return;
        list.empty();

        const templates = this.selectedCategory === 'all'
            ? this.promptManager.getAllTemplates()
            : this.promptManager.getTemplatesByCategory(this.selectedCategory);

        const keyword = this.searchKeyword.toLowerCase();
        const filtered = templates.filter(tpl =>
            !keyword ||
            tpl.name.toLowerCase().includes(keyword) ||
            tpl.description.toLowerCase().includes(keyword)
        );

        if (filtered.length === 0) {
            list.createDiv({ cls: 'nw-pm-template-empty', text: t('settings.promptManager.emptyList') });
            return;
        }

        const entries: Array<{ el: HTMLElement; activate: () => void }> = [];
        for (const tpl of filtered) {
            const selected = this.selectedTemplateId === tpl.id;
            const item = list.createDiv({
                cls: `nw-pm-template-item${selected ? ' nw-pm-template-item--selected' : ''}`,
            });
            item.setAttribute('role', 'button');
            item.setAttribute('aria-pressed', selected ? 'true' : 'false');
            item.createDiv({
                text: tpl.name,
                cls: 'nw-pm-template-name'
            });
            item.createDiv({
                text: tpl.description.slice(0, 40) + (tpl.description.length > 40 ? '...' : ''),
                cls: 'nw-pm-template-desc'
            });
            if (tpl.isCustom) {
                item.createSpan({
                    text: t('settings.promptManager.customBadge'),
                    cls: 'nw-pm-badge nw-pm-badge--custom'
                });
            }
            const activate = () => this.selectTemplate(tpl.id);
            item.onclick = activate;
            entries.push({ el: item, activate });
        }
        this.bindListKeyboardNav(entries);
    }

    /**
     * 选中模板：重绘列表选中态 + 重绘详情，搜索框与分类按钮保持原样。
     *
     * @param id - 模板 id
     * @returns 无
     */
    private selectTemplate(id: string): void {
        this.selectedTemplateId = id;
        this.renderTemplateListItems();
        this.renderTemplateDetailNow();
    }

    /**
     * 只重绘详情面板（选中模板 / 版本切换 / 重置后调用）。
     *
     * @returns 无
     */
    private renderTemplateDetailNow(): void {
        const detail = this.templateDetailEl;
        if (!detail) return;
        detail.empty();
        this.renderTemplateDetail(detail);
    }

    /**
     * 给一组元素绑定列表键盘导航（↑/↓/Home/End 移动焦点，Enter/Space 激活）。
     *
     * 为什么用回调而不是 el.click()：假 DOM（测试）里没有 click() 方法，
     * 而且单击语义与「键盘激活」在部分元素上并不等价。
     *
     * @param entries - 元素与激活回调
     * @returns 无
     */
    private bindListKeyboardNav(entries: Array<{ el: HTMLElement; activate: () => void }>): void {
        if (entries.length === 0) return;
        entries.forEach((entry, index) => {
            entry.el.setAttribute('tabindex', '0');
            entry.el.addEventListener('keydown', (ev: KeyboardEvent) => {
                let target: number | null = null;
                if (ev.key === 'ArrowDown') {
                    target = (index + 1) % entries.length;
                } else if (ev.key === 'ArrowUp') {
                    target = (index - 1 + entries.length) % entries.length;
                } else if (ev.key === 'Home') {
                    target = 0;
                } else if (ev.key === 'End') {
                    target = entries.length - 1;
                }
                if (target !== null) {
                    ev.preventDefault();
                    const next = entries[target].el;
                    if (typeof next.focus === 'function') next.focus();
                    return;
                }
                if (ev.key === 'Enter' || ev.key === ' ') {
                    ev.preventDefault();
                    entry.activate();
                }
            });
        });
    }

    private renderTemplateDetail(container: HTMLElement): void {
        if (!this.selectedTemplateId) {
            container.appendChild(createCompactEmptyState(t('settings.promptManager.pickTemplate')));
            return;
        }

        const template = this.promptManager.getTemplateById(this.selectedTemplateId);
        if (!template) {
            container.createDiv({ text: t('settings.promptManager.templateNotFound'), cls: 'nw-pm-error' });
            return;
        }

        const header = container.createDiv({ cls: 'nw-pm-detail-header' });
        const titleArea = header.createDiv();
        titleArea.createEl('h3', { text: template.name, cls: 'nw-pm-detail-title' });
        titleArea.createDiv({
            text: `${promptCategoryLabel(template.category)} · v${this.promptManager.getActiveVersion(template)?.version || '?'}`,
            cls: 'nw-pm-detail-meta'
        });

        const actions = header.createDiv({ cls: 'nw-pm-detail-actions' });

        const editBtn = actions.createEl('button', {
            text: t(template.isCustom ? 'settings.promptManager.editBtn' : 'settings.promptManager.customizeBtn'),
            cls: 'nw-action-btn',
            attr: { type: 'button' }
        });
        editBtn.onclick = () => this.showEditTemplateModal(template);

        if (template.isCustom) {
            const resetBtn = actions.createEl('button', {
                text: t('settings.promptManager.resetBtn'),
                cls: 'nw-pm-btn nw-pm-btn--danger',
                attr: { type: 'button' }
            });
            resetBtn.onclick = async () => {
                const confirmed = await OperationConfirmModal.confirm(this.app, {
                    title: t('settings.promptManager.resetTitle'),
                    description: t('settings.promptManager.resetDesc'),
                    warning: t('settings.promptManager.resetWarning'),
                    confirmText: t('settings.promptManager.resetOk'),
                    cancelText: t('common.cancel'),
                });
                if (confirmed) {
                    await this.promptManager.resetTemplateToDefault(template.id);
                    showSuccessNotice(t('settings.promptManager.resetNotice'));
                    this.renderActiveTab();
                }
            };
        }

        const desc = container.createDiv({
            text: template.description,
            cls: 'nw-pm-detail-desc'
        });

        this.renderVersionsList(container, template);

        const activeVersion = this.promptManager.getActiveVersion(template);
        if (activeVersion) {
            this.renderPromptPreview(container, activeVersion);
        }

        if (template.variables.length > 0) {
            this.renderVariablesList(container, template);
        }
    }

    private renderVersionsList(container: HTMLElement, template: PromptTemplate): void {
        const section = container.createDiv({ cls: 'nw-pm-section' });
        section.createEl('h4', { text: t('settings.promptManager.versionsTitle'), cls: 'nw-h4-sm' });

        const versionList = section.createDiv({ cls: 'nw-pm-version-list' });

        for (const ver of template.versions) {
            const badge = versionList.createSpan({
                text: `v${ver.version}${ver.isActive ? ' ✓' : ''}`,
                cls: `nw-pm-version-badge${ver.isActive ? ' nw-pm-version-badge--active' : ''}`
            });
            badge.title = new Date(ver.createdAt).toLocaleString();
            if (!ver.isActive) {
                badge.onclick = async () => {
                    await this.promptManager.setActiveVersion(template.id, ver.version);
                    showSuccessNotice(t('settings.promptManager.versionSwitched', { version: ver.version }));
                    this.renderActiveTab();
                };
            }
        }

        const addVerBtn = section.createEl('button', {
            text: t('settings.promptManager.addVersionBtn'),
            cls: 'nw-pm-version-add',
            attr: { type: 'button' }
        });
        addVerBtn.onclick = () => this.showAddVersionModal(template);
    }

    private renderPromptPreview(container: HTMLElement, version: PromptTemplateVersion): void {
        const section = container.createDiv({ cls: 'nw-pm-section' });
        section.createEl('h4', { text: t('settings.promptManager.systemPromptTitle'), cls: 'nw-h4-sm' });
        const systemBox = section.createEl('pre', {
            text: version.systemPrompt,
            cls: 'nw-pm-prompt-box'
        });

        section.createEl('h4', { text: t('settings.promptManager.userPromptTitle'), cls: 'nw-pm-subheading-gap' });
        const userBox = section.createEl('pre', {
            text: version.userPrompt,
            cls: 'nw-pm-prompt-box'
        });
    }

    private renderVariablesList(container: HTMLElement, template: PromptTemplate): void {
        const section = container.createDiv();
        section.createEl('h4', { text: t('settings.promptManager.variablesTitle'), cls: 'nw-h4-sm' });

        const varGrid = section.createDiv({ cls: 'nw-pm-var-grid' });

        for (const v of template.variables) {
            const item = varGrid.createDiv({ cls: 'nw-pm-var-item' });
            item.createDiv({
                text: `\${${v.name}}`,
                cls: 'nw-pm-var-code'
            });
            item.createDiv({
                text: v.description,
                cls: 'nw-pm-var-desc'
            });
            if (v.required) {
                item.createSpan({
                    text: t('settings.promptManager.requiredBadge'),
                    cls: 'nw-pm-badge nw-pm-badge--required'
                });
            }
        }
    }

    private renderABTestsTab(container: HTMLElement): void {
        const header = container.createDiv({ cls: 'nw-pm-ab-header' });
        header.createEl('h3', { text: t('settings.promptManager.abTitle'), cls: 'nw-pm-ab-title' });

        const enableRow = header.createDiv({ cls: 'nw-pm-ab-enable' });
        enableRow.createSpan({ text: t('settings.promptManager.abEnableLabel'), cls: 'nw-pm-ab-enable-label' });
        const toggle = enableRow.createEl('input', {
            type: 'checkbox',
            cls: 'nw-pm-check'
        });
        toggle.checked = this.promptManager.isABTestingEnabled();
        toggle.addEventListener('change', async () => {
            this.promptManager.setABTestingEnabled(toggle.checked);
            showSuccessNotice(t(toggle.checked ? 'settings.promptManager.abEnabledNotice' : 'settings.promptManager.abDisabledNotice'));
            this.renderActiveTab();
        });

        const tests = this.promptManager.getABTests();

        if (tests.length === 0) {
            container.appendChild(createCompactEmptyState(t('settings.promptManager.abEmpty')));
        } else {
            const testList = container.createDiv({ cls: 'nw-pm-test-list' });
            for (const test of tests) {
                this.renderTestCard(testList, test);
            }
        }

        const createBtn = container.createEl('button', {
            text: t('settings.promptManager.abCreateBtn'),
            cls: 'nw-pm-create-btn',
            attr: { type: 'button' }
        });
        createBtn.onclick = () => this.showCreateTestModal();
    }

    private renderTestCard(container: HTMLElement, test: ABTest): void {
        const card = container.createDiv({
            cls: `nw-pm-test-card${this.selectedTestId === test.id ? ' nw-pm-test-card--selected' : ''}`
        });
        card.onclick = () => {
            this.selectedTestId = this.selectedTestId === test.id ? null : test.id;
            this.renderActiveTab();
        };

        const header = card.createDiv({ cls: 'nw-pm-test-head' });
        const title = header.createDiv();
        title.createDiv({
            text: test.name,
            cls: 'nw-pm-test-name'
        });
        title.createDiv({
            text: t('settings.promptManager.abMeta', { id: test.templateId, a: test.trafficSplit.a, b: test.trafficSplit.b }),
            cls: 'nw-stat-muted-mt'
        });

        const statusBadge = header.createSpan({
            text: this.getStatusLabel(test.status),
            cls: `nw-pm-status ${this.getStatusClass(test.status)}`
        });

        if (this.selectedTestId === test.id) {
            this.renderTestDetail(card, test);
        }
    }

    private getStatusLabel(status: string): string {
        const key = STATUS_LABEL_KEYS[status];
        return key ? t(key) : status;
    }

    private getStatusClass(status: string): string {
        const classes: Record<string, string> = {
            draft: 'nw-pm-status--draft',
            running: 'nw-pm-status--running',
            paused: 'nw-pm-status--paused',
            completed: 'nw-pm-status--completed',
        };
        return classes[status] || 'nw-pm-status--draft';
    }

    private renderTestDetail(container: HTMLElement, test: ABTest): void {
        const detail = container.createDiv({ cls: 'nw-pm-test-detail' });

        if (test.description) {
            detail.createDiv({
                text: test.description,
                cls: 'nw-pm-test-desc'
            });
        }

        const statsGrid = detail.createDiv({ cls: 'nw-pm-stats-grid' });

        this.renderVariantStats(statsGrid, t('settings.promptManager.variantA'), test.variantA, test.trafficSplit.a);
        this.renderVariantStats(statsGrid, t('settings.promptManager.variantB'), test.variantB, test.trafficSplit.b);

        const stats = this.promptManager.getABTestStats(test.id);
        if (stats?.winner) {
            const winnerBox = detail.createDiv({
                cls: 'nw-pm-winner'
            });
            winnerBox.setText(t('settings.promptManager.winnerCurrent', { variant: stats.winner.toUpperCase() }));
        }

        const actions = detail.createDiv({ cls: 'nw-pm-test-actions' });

        if (test.status === 'draft') {
            const startBtn = actions.createEl('button', {
                text: t('settings.promptManager.startTestBtn'),
                cls: 'nw-pm-btn nw-pm-btn--primary',
                attr: { type: 'button' }
            });
            startBtn.onclick = async () => {
                await this.promptManager.updateABTestStatus(test.id, 'running');
                showSuccessNotice(t('settings.promptManager.testStartedNotice'));
                this.renderActiveTab();
            };
        }

        if (test.status === 'running') {
            const pauseBtn = actions.createEl('button', {
                text: t('settings.promptManager.pauseTestBtn'),
                cls: 'nw-action-btn',
                attr: { type: 'button' }
            });
            pauseBtn.onclick = async () => {
                await this.promptManager.updateABTestStatus(test.id, 'paused');
                showSuccessNotice(t('settings.promptManager.testPausedNotice'));
                this.renderActiveTab();
            };
        }

        if (test.status === 'paused') {
            const resumeBtn = actions.createEl('button', {
                text: t('settings.promptManager.resumeTestBtn'),
                cls: 'nw-pm-btn nw-pm-btn--primary',
                attr: { type: 'button' }
            });
            resumeBtn.onclick = async () => {
                await this.promptManager.updateABTestStatus(test.id, 'running');
                showSuccessNotice(t('settings.promptManager.testResumedNotice'));
                this.renderActiveTab();
            };
        }

        if (test.status !== 'completed') {
            const finishBtn = actions.createEl('button', {
                text: t('settings.promptManager.finishTestBtn'),
                cls: 'nw-action-btn',
                attr: { type: 'button' }
            });
            finishBtn.onclick = () => this.showFinishTestModal(test);
        }

        const deleteBtn = actions.createEl('button', {
            text: t('settings.promptManager.deleteTestBtn'),
            cls: 'nw-pm-btn nw-pm-btn--danger nw-pm-btn--push-end',
            attr: { type: 'button' }
        });
        deleteBtn.onclick = async () => {
            const confirmed = await OperationConfirmModal.confirm(this.app, {
                title: t('settings.promptManager.deleteTestTitle'),
                description: t('settings.promptManager.deleteTestDesc'),
                confirmText: t('settings.promptManager.deleteTestOk'),
                cancelText: t('common.cancel'),
            });
            if (confirmed) {
                await this.promptManager.deleteABTest(test.id);
                this.selectedTestId = null;
                showSuccessNotice(t('settings.promptManager.testDeletedNotice'));
                this.renderActiveTab();
            }
        };
    }

    private renderVariantStats(container: HTMLElement, label: string, variant: { version: string; metrics: ABTestMetrics }, traffic: number): void {
        const card = container.createDiv({
            cls: 'nw-pm-variant'
        });
        card.createDiv({
            text: `${label} (v${variant.version})`,
            cls: 'nw-pm-variant-title'
        });
        // 指标行构造抽到 prompt-manager-logic：0 样本时不能显示 NaN/10
        for (const row of buildVariantStatRows(variant.metrics, traffic)) {
            card.createDiv({
                text: `${row.label}: ${row.value}`,
                cls: 'nw-stat-muted-mt'
            });
        }
    }

    private renderUsageTab(container: HTMLElement): void {
        container.createEl('h3', { text: t('settings.promptManager.usageTitle'), cls: 'nw-pm-tab-title' });

        const pageSize = this.usagePageSize;
        // 先取一次总数，把越界页码夹回来（清空/删除后当前页可能已不存在）
        const first = this.promptManager.getUsageHistoryPage(0, 1);
        const totalPages = Math.max(1, Math.ceil(first.total / pageSize));
        if (this.usagePage > totalPages - 1) this.usagePage = totalPages - 1;
        if (this.usagePage < 0) this.usagePage = 0;

        const toolbar = container.createDiv({ cls: 'nw-pm-usage-toolbar' });
        toolbar.createSpan({
            cls: 'nw-pm-usage-summary',
            text: t('settings.promptManager.usageCount', { count: first.total }),
        });
        if (first.total > 0) {
            const clearBtn = toolbar.createEl('button', {
                text: t('settings.promptManager.clearUsageBtn'),
                cls: 'nw-pm-btn nw-pm-btn--danger',
                attr: { type: 'button' },
            });
            clearBtn.onclick = async () => {
                const confirmed = await OperationConfirmModal.confirm(this.app, {
                    title: t('settings.promptManager.clearUsageTitle'),
                    description: t('settings.promptManager.clearUsageDesc', { count: first.total }),
                    warning: t('settings.promptManager.clearUsageWarning'),
                    confirmText: t('settings.promptManager.clearUsageOk'),
                    cancelText: t('common.cancel'),
                });
                if (confirmed) {
                    await this.promptManager.clearUsageHistory();
                    this.usagePage = 0;
                    showSuccessNotice(t('settings.promptManager.usageClearedNotice'));
                    this.renderActiveTab();
                }
            };
        }

        if (first.total === 0) {
            container.appendChild(createCompactEmptyState(t('settings.promptManager.usageEmpty')));
            return;
        }

        const page = this.promptManager.getUsageHistoryPage(this.usagePage * pageSize, pageSize);
        const list = container.createDiv({ cls: 'nw-pm-usage-list' });

        for (const record of page.records) {
            const item = list.createDiv({ cls: 'nw-pm-usage-item' });
            const left = item.createDiv();
            left.createSpan({
                text: record.templateId,
                cls: 'nw-pm-usage-id'
            });
            left.createSpan({
                text: `v${record.version}`,
                cls: 'nw-pm-usage-version'
            });
            if (record.abTestId) {
                left.createSpan({
                    text: `A/B ${record.abVariant?.toUpperCase()}`,
                    cls: 'nw-pm-badge nw-pm-badge--ab'
                });
            }

            const right = item.createDiv({ cls: 'nw-pm-usage-time' });
            right.setText(new Date(record.timestamp).toLocaleString());
            if (record.rating !== undefined) {
                right.setText(right.textContent + ` · ⭐${record.rating}`);
            }
        }

        if (totalPages > 1) {
            const pager = container.createDiv({ cls: 'nw-pm-usage-pager' });

            const prev = pager.createEl('button', {
                text: t('settings.promptManager.prevPageBtn'),
                cls: 'nw-pm-pager-btn',
                attr: { type: 'button' },
            });
            prev.disabled = this.usagePage <= 0;
            prev.onclick = () => this.gotoUsagePage(this.usagePage - 1);

            pager.createSpan({
                cls: 'nw-pm-pager-label',
                text: t('settings.promptManager.pageLabel', { page: this.usagePage + 1, total: totalPages }),
            });

            const next = pager.createEl('button', {
                text: t('settings.promptManager.nextPageBtn'),
                cls: 'nw-pm-pager-btn',
                attr: { type: 'button' },
            });
            next.disabled = this.usagePage >= totalPages - 1;
            next.onclick = () => this.gotoUsagePage(this.usagePage + 1);
        }
    }

    /**
     * 翻到指定使用记录页（越界会被夹回合法范围）。
     *
     * @param page - 目标页（0 基）
     * @returns 无
     */
    private gotoUsagePage(page: number): void {
        const size = this.usagePageSize;
        const total = this.promptManager.getUsageHistoryPage(0, 1).total;
        const totalPages = Math.max(1, Math.ceil(total / size));
        const next = Math.min(Math.max(0, page), totalPages - 1);
        if (next === this.usagePage) return;
        this.usagePage = next;
        this.renderActiveTab();
    }

    private renderImportExportTab(container: HTMLElement): void {
        container.createEl('h3', { text: t('settings.promptManager.ioTitle'), cls: 'nw-pm-tab-title' });

        const exportSection = container.createDiv({
            cls: 'nw-pm-io-box'
        });
        exportSection.createEl('h4', { text: t('settings.promptManager.exportTitle'), cls: 'nw-h4-sm' });
        exportSection.createDiv({
            text: t('settings.promptManager.exportDesc'),
            cls: 'nw-pm-io-desc'
        });
        const exportBtn = exportSection.createEl('button', {
            text: t('settings.promptManager.exportBtn'),
            cls: 'nw-pm-btn nw-pm-btn--primary-lg',
            attr: { type: 'button' }
        });
        exportBtn.onclick = () => { void this.exportConfig(); };

        const importSection = container.createDiv({
            cls: 'nw-pm-io-box nw-pm-io-box--last'
        });
        importSection.createEl('h4', { text: t('settings.promptManager.importTitle'), cls: 'nw-h4-sm' });
        importSection.createDiv({
            text: t('settings.promptManager.importDesc'),
            cls: 'nw-pm-io-desc'
        });

        const input = importSection.createEl('input', {
            type: 'file',
            cls: 'nw-pm-file-input',
            attr: { accept: '.json' }
        });
        input.addEventListener('change', async (e) => {
            const target = e.target as HTMLInputElement;
            const file = target.files?.[0];
            if (!file) return;
            // 清空 value，让用户能再次选择同一个文件触发 change
            target.value = '';
            let text: string;
            try {
                text = await file.text();
            } catch {
                showErrorNotice(t('settings.promptManager.importReadFailed'));
                return;
            }
            this.openImportPreview(file.name, text);
        });
    }

    /**
     * 打开导入预览弹窗（dry-run 展示差异，用户确认后才写盘）。
     *
     * @param fileName - 选中的文件名
     * @param text - 文件内容
     * @returns 无
     */
    private openImportPreview(fileName: string, text: string): void {
        const parsed = this.promptManager.parseImportPayload(text);
        if (!parsed.ok) {
            showErrorNotice(t('settings.promptManager.importParseFailed', { error: parsed.error }));
            return;
        }

        const diff = buildPromptImportDiff(
            {
                templates: this.promptManager.getCustomTemplates(),
                tests: this.promptManager.getABTests(),
            },
            parsed.config,
            'merge',
        );

        new PromptImportPreviewModal(this.app, {
            fileName,
            diff,
            onConfirm: (mode) => this.applyImport(text, mode),
        }).open();
    }

    /**
     * 按用户选择的方式写入导入配置。
     *
     * @param text - 文件内容
     * @param mode - replace 整份替换 / merge 与现有配置合并
     * @returns 无
     */
    private applyImport(text: string, mode: PromptImportMode): void {
        const success = this.promptManager.importConfig(text, mode);
        if (!success) {
            showErrorNotice(t('settings.promptManager.importFormatFailed'));
            return;
        }
        showSuccessNotice(t(mode === 'merge' ? 'settings.promptManager.importMergedNotice' : 'settings.promptManager.importReplacedNotice'));
        this.usagePage = 0;
        this.renderActiveTab();
    }

    private async exportConfig(): Promise<void> {
        const json = this.promptManager.exportConfig();
        await exportTextFile(this.app, `prompt-config-${new Date().toISOString().slice(0, 10)}.json`, json, {
            mime: 'application/json',
            successMessage: t('settings.promptManager.exportedNotice'),
        });
    }

    private showCreateTemplateModal(): void {
        const modal = new Modal(this.app);
        modal.titleEl.setText(t('settings.promptManager.createModalTitle'));

        let name = '';
        let category: PromptCategory = 'other';
        let description = '';
        let systemPrompt = '';
        let userPrompt = '';

        const content = modal.contentEl;

        new Setting(content)
            .setName(t('settings.promptManager.nameLabel'))
            .addText(text => text
                .setPlaceholder(t('settings.promptManager.namePlaceholder'))
                .onChange(v => name = v));

        new Setting(content)
            .setName(t('settings.promptManager.categoryLabel'))
            .addDropdown(dropdown => {
                for (const key of PROMPT_CATEGORY_IDS) {
                    dropdown.addOption(key, promptCategoryLabel(key));
                }
                dropdown.setValue(category);
                dropdown.onChange(v => category = v as PromptCategory);
            });

        new Setting(content)
            .setName(t('settings.promptManager.descLabel'))
            .addTextArea(text => text
                .setPlaceholder(t('settings.promptManager.descPlaceholder'))
                .onChange(v => description = v));

        content.createEl('h4', { text: t('settings.promptManager.systemPromptTitle') });
        const sysTextarea = content.createEl('textarea', {
            cls: 'nw-textarea-code',
            attr: { placeholder: t('settings.promptManager.createSystemPromptPlaceholder') }
        });
        sysTextarea.addEventListener('input', () => systemPrompt = sysTextarea.value);

        content.createEl('h4', { text: t('settings.promptManager.userPromptTitle') });
        const userTextarea = content.createEl('textarea', {
            cls: 'nw-textarea-code',
            attr: { placeholder: t('settings.promptManager.createUserPromptPlaceholder') }
        });
        userTextarea.addEventListener('input', () => userPrompt = userTextarea.value);

        modal.modalEl.createDiv({ cls: 'nw-modal-footer' })
            .createEl('button', {
                text: t('settings.promptManager.createBtn'),
                cls: 'nw-modal-btn-primary',
                attr: { type: 'button' }
            }).onclick = async () => {
                if (!name.trim()) {
                    new Notice(t('settings.promptManager.nameRequired'));
                    return;
                }
                const now = Date.now();
                const template: PromptTemplate = {
                    id: `custom-${now}`,
                    name,
                    category,
                    description,
                    isCustom: true,
                    createdAt: now,
                    updatedAt: now,
                    versions: [{
                        version: '1.0.0',
                        createdAt: now,
                        systemPrompt,
                        userPrompt,
                        isActive: true,
                    }],
                    variables: [],
                    tags: [category],
                };
                this.promptManager['config'].customTemplates.push(template);
                await this.promptManager['saveConfig']();
                this.selectedTemplateId = template.id;
                showSuccessNotice(t('settings.promptManager.templateCreatedNotice'));
                modal.close();
                this.renderActiveTab();
            };

        modal.open();
    }

    private showEditTemplateModal(template: PromptTemplate): void {
        const activeVersion = this.promptManager.getActiveVersion(template);
        if (!activeVersion) return;

        const modal = new Modal(this.app);
        modal.titleEl.setText(t(template.isCustom ? 'settings.promptManager.editModalTitleCustom' : 'settings.promptManager.editModalTitleDefault'));

        let name = template.name;
        let description = template.description;
        let systemPrompt = activeVersion.systemPrompt;
        let userPrompt = activeVersion.userPrompt;
        let newVersion = false;
        let versionNote = '';

        const content = modal.contentEl;

        new Setting(content)
            .setName(t('settings.promptManager.editNameLabel'))
            .addText(text => text
                .setValue(name)
                .onChange(v => name = v));

        new Setting(content)
            .setName(t('settings.promptManager.editDescLabel'))
            .addTextArea(text => text
                .setValue(description)
                .onChange(v => description = v));

        if (template.isCustom) {
            new Setting(content)
                .setName(t('settings.promptManager.saveAsNewVersion'))
                .setDesc(t('settings.promptManager.saveAsNewVersionDesc'))
                .addToggle(toggle => toggle
                    .setValue(false)
                    .onChange(v => newVersion = v));

            if (newVersion) {
                new Setting(content)
                    .setName(t('settings.promptManager.versionNoteLabel'))
                    .addText(text => text
                        .setPlaceholder(t('settings.promptManager.versionNotePlaceholder'))
                        .onChange(v => versionNote = v));
            }
        }

        content.createEl('h4', { text: t('settings.promptManager.systemPromptTitle') });
        const sysTextarea = content.createEl('textarea', {
            cls: 'nw-pm-textarea'
        });
        sysTextarea.value = systemPrompt;
        sysTextarea.addEventListener('input', () => systemPrompt = sysTextarea.value);

        content.createEl('h4', { text: t('settings.promptManager.userPromptTitle') });
        const userTextarea = content.createEl('textarea', {
            cls: 'nw-pm-textarea'
        });
        userTextarea.value = userPrompt;
        userTextarea.addEventListener('input', () => userPrompt = userTextarea.value);

        const footer = modal.modalEl.createDiv({ cls: 'nw-modal-footer' });

        const cancelBtn = footer.createEl('button', {
            text: t('settings.promptManager.cancelBtn'),
            cls: 'nw-modal-btn-secondary',
            attr: { type: 'button' }
        });
        cancelBtn.onclick = () => modal.close();

        const saveBtn = footer.createEl('button', {
            text: t(template.isCustom ? 'settings.promptManager.saveBtn' : 'settings.promptManager.saveAsCustomBtn'),
            cls: 'nw-modal-btn-primary',
            attr: { type: 'button' }
        });
        saveBtn.onclick = async () => {
            if (template.isCustom && !newVersion) {
                activeVersion.systemPrompt = systemPrompt;
                activeVersion.userPrompt = userPrompt;
                await this.promptManager.updateTemplate(template.id, {
                    name,
                    description,
                    updatedAt: Date.now(),
                });
                showSuccessNotice(t('settings.promptManager.savedNotice'));
            } else {
                const currentVersion = activeVersion.version;
                const parts = currentVersion.split('.').map(Number);
                parts[2]++;
                const nextVersion = parts.join('.');

                await this.promptManager.addVersion(template.id, {
                    version: nextVersion,
                    systemPrompt,
                    userPrompt,
                    description: versionNote || t('settings.promptManager.defaultVersionNote'),
                    isActive: true,
                });
                await this.promptManager.updateTemplate(template.id, {
                    name,
                    description,
                });
                showSuccessNotice(t('settings.promptManager.savedAsVersion', { version: nextVersion }));
            }
            modal.close();
            this.renderActiveTab();
        };

        modal.open();
    }

    private showAddVersionModal(template: PromptTemplate): void {
        const activeVersion = this.promptManager.getActiveVersion(template);
        if (!activeVersion) return;

        const modal = new Modal(this.app);
        modal.titleEl.setText(t('settings.promptManager.newVersionTitle'));

        let version = '';
        let description = '';
        let systemPrompt = activeVersion.systemPrompt;
        let userPrompt = activeVersion.userPrompt;

        const content = modal.contentEl;

        const parts = activeVersion.version.split('.').map(Number);
        parts[2]++;
        const suggestedVersion = parts.join('.');

        new Setting(content)
            .setName(t('settings.promptManager.versionLabel'))
            .addText(text => text
                .setValue(suggestedVersion)
                .onChange(v => version = v));
        version = suggestedVersion;

        new Setting(content)
            .setName(t('settings.promptManager.versionNoteLabel'))
            .addText(text => text
                .setPlaceholder(t('settings.promptManager.newVersionNotePlaceholder'))
                .onChange(v => description = v));

        content.createEl('h4', { text: t('settings.promptManager.systemPromptTitle') });
        const sysTextarea = content.createEl('textarea', {
            cls: 'nw-textarea-code',
        });
        sysTextarea.value = systemPrompt;
        sysTextarea.addEventListener('input', () => systemPrompt = sysTextarea.value);

        content.createEl('h4', { text: t('settings.promptManager.userPromptTitle') });
        const userTextarea = content.createEl('textarea', {
            cls: 'nw-textarea-code',
        });
        userTextarea.value = userPrompt;
        userTextarea.addEventListener('input', () => userPrompt = userTextarea.value);

        const footer = modal.modalEl.createDiv({ cls: 'nw-modal-footer' });

        footer.createEl('button', {
            text: t('settings.promptManager.cancelBtn'),
            cls: 'nw-modal-btn-secondary',
            attr: { type: 'button' }
        }).onclick = () => modal.close();

        footer.createEl('button', {
            text: t('settings.promptManager.createVersionBtn'),
            cls: 'nw-modal-btn-primary',
            attr: { type: 'button' }
        }).onclick = async () => {
            if (!version.trim()) {
                new Notice(t('settings.promptManager.versionRequired'));
                return;
            }
            await this.promptManager.addVersion(template.id, {
                version,
                systemPrompt,
                userPrompt,
                description: description || undefined,
                isActive: true,
            });
            showSuccessNotice(t('settings.promptManager.versionCreatedNotice', { version }));
            modal.close();
            this.renderActiveTab();
        };

        modal.open();
    }

    private showCreateTestModal(): void {
        const modal = new Modal(this.app);
        modal.titleEl.setText(t('settings.promptManager.createTestTitle'));

        let name = '';
        let description = '';
        let templateId = '';
        let versionA = '';
        let versionB = '';
        let splitA = 50;
        let splitB = 50;

        const content = modal.contentEl;

        new Setting(content)
            .setName(t('settings.promptManager.testNameLabel'))
            .addText(text => text
                .setPlaceholder(t('settings.promptManager.testNamePlaceholder'))
                .onChange(v => name = v));

        new Setting(content)
            .setName(t('settings.promptManager.testDescLabel'))
            .addTextArea(text => text
                .setPlaceholder(t('settings.promptManager.testDescPlaceholder'))
                .onChange(v => description = v));

        const templates = this.promptManager.getAllTemplates();
        new Setting(content)
            .setName(t('settings.promptManager.selectTemplateLabel'))
            .addDropdown(dropdown => {
                dropdown.addOption('', t('settings.promptManager.selectTemplatePlaceholder'));
                for (const tpl of templates) {
                    dropdown.addOption(tpl.id, tpl.name);
                }
                dropdown.onChange(v => {
                    templateId = v;
                    const tpl = this.promptManager.getTemplateById(v);
                    if (tpl && tpl.versions.length >= 1) {
                        versionA = tpl.versions[0].version;
                        versionB = tpl.versions[Math.min(1, tpl.versions.length - 1)].version;
                    }
                    renderVersionDropdowns();
                });
            });

        const versionASetting = new Setting(content).setName(t('settings.promptManager.versionALabel'));
        const versionBSetting = new Setting(content).setName(t('settings.promptManager.versionBLabel'));

        function renderVersionDropdowns() {
            const tpl = templateId ? this_2.promptManager.getTemplateById(templateId) : null;
            versionASetting.clear();
            versionBSetting.clear();
            if (tpl) {
                versionASetting.addDropdown(dropdown => {
                    for (const v of tpl.versions) {
                        dropdown.addOption(v.version, `v${v.version}`);
                    }
                    dropdown.setValue(versionA);
                    dropdown.onChange(v => versionA = v);
                });
                versionBSetting.addDropdown(dropdown => {
                    for (const v of tpl.versions) {
                        dropdown.addOption(v.version, `v${v.version}`);
                    }
                    dropdown.setValue(versionB);
                    dropdown.onChange(v => versionB = v);
                });
            } else {
                versionASetting.setDesc(t('settings.promptManager.pickTemplateFirst'));
                versionBSetting.setDesc(t('settings.promptManager.pickTemplateFirst'));
            }
        }

        const this_2 = this;

        new Setting(content)
            .setName(t('settings.promptManager.trafficALabel'))
            .addSlider(slider => slider
                .setLimits(10, 90, 5)
                .setValue(50)
                .onChange(v => {
                    splitA = v;
                    splitB = 100 - v;
                }));

        new Setting(content)
            .setName(t('settings.promptManager.trafficBLabel'))
            .setDesc(`${splitB}%`)
            .addText(text => text
                .setValue(String(100 - splitA))
                .setDisabled(true));

        const footer = modal.modalEl.createDiv({ cls: 'nw-modal-footer' });

        footer.createEl('button', {
            text: t('settings.promptManager.cancelBtn'),
            cls: 'nw-modal-btn-secondary',
            attr: { type: 'button' }
        }).onclick = () => modal.close();

        footer.createEl('button', {
            text: t('settings.promptManager.createBtn'),
            cls: 'nw-modal-btn-primary',
            attr: { type: 'button' }
        }).onclick = async () => {
            if (!name.trim()) {
                new Notice(t('settings.promptManager.testNameRequired'));
                return;
            }
            if (!templateId) {
                new Notice(t('settings.promptManager.testTemplateRequired'));
                return;
            }
            if (!versionA || !versionB) {
                new Notice(t('settings.promptManager.testVersionsRequired'));
                return;
            }
            if (versionA === versionB) {
                new Notice(t('settings.promptManager.testVersionsSame'));
                return;
            }
            await this.promptManager.createABTest({
                name,
                description: description || undefined,
                templateId,
                variantAVersion: versionA,
                variantBVersion: versionB,
                trafficSplit: { a: splitA, b: splitB },
            });
            showSuccessNotice(t('settings.promptManager.testCreatedNotice'));
            modal.close();
            this.renderActiveTab();
        };

        modal.open();
    }

    private showFinishTestModal(test: ABTest): void {
        const modal = new Modal(this.app);
        modal.titleEl.setText(t('settings.promptManager.finishTestTitle'));

        const content = modal.contentEl;
        content.createDiv({
            text: t('settings.promptManager.finishTestDesc'),
            cls: 'nw-pm-finish-desc'
        });

        const stats = this.promptManager.getABTestStats(test.id);

        if (stats?.winner && stats.winner !== 'tie') {
            content.createDiv({
                text: t('settings.promptManager.finishRecommended', { variant: stats.winner.toUpperCase() }),
                cls: 'nw-pm-winner nw-pm-winner--lg'
            });
        }

        const footer = modal.modalEl.createDiv({ cls: 'nw-modal-footer' });

        footer.createEl('button', {
            text: t('settings.promptManager.winnerABtn'),
            cls: 'nw-modal-btn-primary',
            attr: { type: 'button' }
        }).onclick = async () => {
            await this.promptManager.setWinner(test.id, 'a');
            showSuccessNotice(t('settings.promptManager.winnerANotice'));
            modal.close();
            this.renderActiveTab();
        };

        footer.createEl('button', {
            text: t('settings.promptManager.winnerBBtn'),
            cls: 'nw-modal-btn-primary',
            attr: { type: 'button' }
        }).onclick = async () => {
            await this.promptManager.setWinner(test.id, 'b');
            showSuccessNotice(t('settings.promptManager.winnerBNotice'));
            modal.close();
            this.renderActiveTab();
        };

        footer.createEl('button', {
            text: t('settings.promptManager.finishOnlyBtn'),
            cls: 'nw-modal-btn-secondary',
            attr: { type: 'button' }
        }).onclick = async () => {
            await this.promptManager.updateABTestStatus(test.id, 'completed');
            showSuccessNotice(t('settings.promptManager.testFinishedNotice'));
            modal.close();
            this.renderActiveTab();
        };

        modal.open();
    }
}


