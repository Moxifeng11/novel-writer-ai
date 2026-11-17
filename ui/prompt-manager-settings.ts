import { App, Notice, Modal, Setting, TextComponent } from 'obsidian';
import type NovelWriterPlugin from '@/main';
import { PromptManager, PROMPT_CATEGORY_LABELS } from '@/services/prompt-manager';
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
            { id: 'templates', label: '📝 提示词模板' },
            { id: 'abtests', label: '🧪 A/B 测试' },
            { id: 'usage', label: '📊 使用统计' },
            { id: 'import-export', label: '📦 导入/导出' },
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
            .setName('搜索提示词')
            .addText(text => {
                text.setPlaceholder('输入关键词搜索...')
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
            text: `📚 全部 (${this.promptManager.getAllTemplates().length})`,
            cls: `nw-pm-category-btn nw-pm-category-btn--all${this.selectedCategory === 'all' ? ' nw-pm-category-btn--active' : ''}`,
            attr: { type: 'button', 'aria-pressed': this.selectedCategory === 'all' ? 'true' : 'false' },
        });
        categoryEntries.push({ id: 'all', el: allBtn });

        for (const { category, count } of this.promptManager.getCategories()) {
            const label = PROMPT_CATEGORY_LABELS[category] || category;
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
            text: '➕ 新建自定义提示词',
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
        const filtered = templates.filter(t =>
            !keyword ||
            t.name.toLowerCase().includes(keyword) ||
            t.description.toLowerCase().includes(keyword)
        );

        if (filtered.length === 0) {
            list.createDiv({ cls: 'nw-pm-template-empty', text: '没有匹配的提示词模板' });
            return;
        }

        const entries: Array<{ el: HTMLElement; activate: () => void }> = [];
        for (const t of filtered) {
            const selected = this.selectedTemplateId === t.id;
            const item = list.createDiv({
                cls: `nw-pm-template-item${selected ? ' nw-pm-template-item--selected' : ''}`,
            });
            item.setAttribute('role', 'button');
            item.setAttribute('aria-pressed', selected ? 'true' : 'false');
            item.createDiv({
                text: t.name,
                cls: 'nw-pm-template-name'
            });
            item.createDiv({
                text: t.description.slice(0, 40) + (t.description.length > 40 ? '...' : ''),
                cls: 'nw-pm-template-desc'
            });
            if (t.isCustom) {
                item.createEl('span', {
                    text: '自定义',
                    cls: 'nw-pm-badge nw-pm-badge--custom'
                });
            }
            const activate = () => this.selectTemplate(t.id);
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
            container.createDiv({
                text: '请从左侧选择一个提示词模板查看详情',
                cls: 'nw-empty-center-muted'
            });
            return;
        }

        const template = this.promptManager.getTemplateById(this.selectedTemplateId);
        if (!template) {
            container.createDiv({ text: '模板未找到', cls: 'nw-pm-error' });
            return;
        }

        const header = container.createDiv({ cls: 'nw-pm-detail-header' });
        const titleArea = header.createDiv();
        titleArea.createEl('h3', { text: template.name, cls: 'nw-pm-detail-title' });
        titleArea.createEl('div', {
            text: `${PROMPT_CATEGORY_LABELS[template.category] || template.category} · v${this.promptManager.getActiveVersion(template)?.version || '?'}`,
            cls: 'nw-pm-detail-meta'
        });

        const actions = header.createDiv({ cls: 'nw-pm-detail-actions' });

        const editBtn = actions.createEl('button', {
            text: template.isCustom ? '✏️ 编辑' : '📝 自定义',
            cls: 'nw-action-btn',
            attr: { type: 'button' }
        });
        editBtn.onclick = () => this.showEditTemplateModal(template);

        if (template.isCustom) {
            const resetBtn = actions.createEl('button', {
                text: '🔄 重置',
                cls: 'nw-pm-btn nw-pm-btn--danger',
                attr: { type: 'button' }
            });
            resetBtn.onclick = async () => {
                const confirmed = await OperationConfirmModal.confirm(this.app, {
                    title: '重置提示词',
                    description: '确定要重置为默认提示词吗？',
                    warning: '自定义修改将丢失',
                    confirmText: '确认重置',
                    cancelText: '取消',
                });
                if (confirmed) {
                    await this.promptManager.resetTemplateToDefault(template.id);
                    showSuccessNotice('已重置为默认提示词');
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
        section.createEl('h4', { text: '📋 版本历史', cls: 'nw-h4-sm' });

        const versionList = section.createDiv({ cls: 'nw-pm-version-list' });

        for (const ver of template.versions) {
            const badge = versionList.createEl('span', {
                text: `v${ver.version}${ver.isActive ? ' ✓' : ''}`,
                cls: `nw-pm-version-badge${ver.isActive ? ' nw-pm-version-badge--active' : ''}`
            });
            badge.title = new Date(ver.createdAt).toLocaleString();
            if (!ver.isActive) {
                badge.onclick = async () => {
                    await this.promptManager.setActiveVersion(template.id, ver.version);
                    showSuccessNotice(`已切换到 v${ver.version}`);
                    this.renderActiveTab();
                };
            }
        }

        const addVerBtn = section.createEl('button', {
            text: '➕ 新建版本',
            cls: 'nw-pm-version-add',
            attr: { type: 'button' }
        });
        addVerBtn.onclick = () => this.showAddVersionModal(template);
    }

    private renderPromptPreview(container: HTMLElement, version: PromptTemplateVersion): void {
        const section = container.createDiv({ cls: 'nw-pm-section' });
        section.createEl('h4', { text: '🔤 系统提示词', cls: 'nw-h4-sm' });
        const systemBox = section.createEl('pre', {
            text: version.systemPrompt,
            cls: 'nw-pm-prompt-box'
        });

        section.createEl('h4', { text: '📝 用户提示词模板', cls: 'nw-pm-subheading-gap' });
        const userBox = section.createEl('pre', {
            text: version.userPrompt,
            cls: 'nw-pm-prompt-box'
        });
    }

    private renderVariablesList(container: HTMLElement, template: PromptTemplate): void {
        const section = container.createDiv();
        section.createEl('h4', { text: '🔧 可用变量', cls: 'nw-h4-sm' });

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
                item.createEl('span', {
                    text: '必填',
                    cls: 'nw-pm-badge nw-pm-badge--required'
                });
            }
        }
    }

    private renderABTestsTab(container: HTMLElement): void {
        const header = container.createDiv({ cls: 'nw-pm-ab-header' });
        header.createEl('h3', { text: '🧪 A/B 测试管理', cls: 'nw-pm-ab-title' });

        const enableRow = header.createDiv({ cls: 'nw-pm-ab-enable' });
        enableRow.createSpan({ text: '启用A/B测试', cls: 'nw-pm-ab-enable-label' });
        const toggle = enableRow.createEl('input', {
            type: 'checkbox',
            cls: 'nw-pm-check'
        });
        toggle.checked = this.promptManager.isABTestingEnabled();
        toggle.addEventListener('change', async () => {
            this.promptManager.setABTestingEnabled(toggle.checked);
            showSuccessNotice(toggle.checked ? 'A/B测试已启用' : 'A/B测试已关闭');
            this.renderActiveTab();
        });

        const tests = this.promptManager.getABTests();

        if (tests.length === 0) {
            container.createDiv({
                text: '暂无A/B测试。点击下方按钮创建第一个测试。',
                cls: 'nw-empty-center-muted'
            });
        } else {
            const testList = container.createDiv({ cls: 'nw-pm-test-list' });
            for (const test of tests) {
                this.renderTestCard(testList, test);
            }
        }

        const createBtn = container.createEl('button', {
            text: '➕ 创建A/B测试',
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
            text: `模板: ${test.templateId} · 流量 ${test.trafficSplit.a}/${test.trafficSplit.b}`,
            cls: 'nw-stat-muted-mt'
        });

        const statusBadge = header.createEl('span', {
            text: this.getStatusLabel(test.status),
            cls: `nw-pm-status ${this.getStatusClass(test.status)}`
        });

        if (this.selectedTestId === test.id) {
            this.renderTestDetail(card, test);
        }
    }

    private getStatusLabel(status: string): string {
        const labels: Record<string, string> = {
            draft: '📝 草稿',
            running: '▶️ 运行中',
            paused: '⏸️ 已暂停',
            completed: '✅ 已完成',
        };
        return labels[status] || status;
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

        this.renderVariantStats(statsGrid, 'A 版本', test.variantA, test.trafficSplit.a);
        this.renderVariantStats(statsGrid, 'B 版本', test.variantB, test.trafficSplit.b);

        const stats = this.promptManager.getABTestStats(test.id);
        if (stats?.winner) {
            const winnerBox = detail.createDiv({
                cls: 'nw-pm-winner'
            });
            winnerBox.setText(`🏆 当前优胜: ${stats.winner.toUpperCase()} 版本`);
        }

        const actions = detail.createDiv({ cls: 'nw-pm-test-actions' });

        if (test.status === 'draft') {
            const startBtn = actions.createEl('button', {
                text: '▶️ 开始测试',
                cls: 'nw-pm-btn nw-pm-btn--primary',
                attr: { type: 'button' }
            });
            startBtn.onclick = async () => {
                await this.promptManager.updateABTestStatus(test.id, 'running');
                showSuccessNotice('测试已开始');
                this.renderActiveTab();
            };
        }

        if (test.status === 'running') {
            const pauseBtn = actions.createEl('button', {
                text: '⏸️ 暂停',
                cls: 'nw-action-btn',
                attr: { type: 'button' }
            });
            pauseBtn.onclick = async () => {
                await this.promptManager.updateABTestStatus(test.id, 'paused');
                showSuccessNotice('测试已暂停');
                this.renderActiveTab();
            };
        }

        if (test.status === 'paused') {
            const resumeBtn = actions.createEl('button', {
                text: '▶️ 继续',
                cls: 'nw-pm-btn nw-pm-btn--primary',
                attr: { type: 'button' }
            });
            resumeBtn.onclick = async () => {
                await this.promptManager.updateABTestStatus(test.id, 'running');
                showSuccessNotice('测试已继续');
                this.renderActiveTab();
            };
        }

        if (test.status !== 'completed') {
            const finishBtn = actions.createEl('button', {
                text: '🏁 结束测试',
                cls: 'nw-action-btn',
                attr: { type: 'button' }
            });
            finishBtn.onclick = () => this.showFinishTestModal(test);
        }

        const deleteBtn = actions.createEl('button', {
            text: '🗑️ 删除',
            cls: 'nw-pm-btn nw-pm-btn--danger nw-pm-btn--push-end',
            attr: { type: 'button' }
        });
        deleteBtn.onclick = async () => {
            const confirmed = await OperationConfirmModal.confirm(this.app, {
                title: '删除测试',
                description: '确定要删除这个测试吗？',
                confirmText: '确认删除',
                cancelText: '取消',
            });
            if (confirmed) {
                await this.promptManager.deleteABTest(test.id);
                this.selectedTestId = null;
                showSuccessNotice('测试已删除');
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
        container.createEl('h3', { text: '📊 使用记录', cls: 'nw-pm-tab-title' });

        const pageSize = this.usagePageSize;
        // 先取一次总数，把越界页码夹回来（清空/删除后当前页可能已不存在）
        const first = this.promptManager.getUsageHistoryPage(0, 1);
        const totalPages = Math.max(1, Math.ceil(first.total / pageSize));
        if (this.usagePage > totalPages - 1) this.usagePage = totalPages - 1;
        if (this.usagePage < 0) this.usagePage = 0;

        const toolbar = container.createDiv({ cls: 'nw-pm-usage-toolbar' });
        toolbar.createSpan({
            cls: 'nw-pm-usage-summary',
            text: first.total === 0 ? '共 0 条记录' : `共 ${first.total} 条记录`,
        });
        if (first.total > 0) {
            const clearBtn = toolbar.createEl('button', {
                text: '🗑 清空记录',
                cls: 'nw-pm-btn nw-pm-btn--danger',
                attr: { type: 'button' },
            });
            clearBtn.onclick = async () => {
                const confirmed = await OperationConfirmModal.confirm(this.app, {
                    title: '清空使用记录',
                    description: `确定要清空全部 ${first.total} 条使用记录吗？`,
                    warning: '清空后无法恢复，模板与 A/B 配置不受影响',
                    confirmText: '确认清空',
                    cancelText: '取消',
                });
                if (confirmed) {
                    await this.promptManager.clearUsageHistory();
                    this.usagePage = 0;
                    showSuccessNotice('使用记录已清空');
                    this.renderActiveTab();
                }
            };
        }

        if (first.total === 0) {
            container.createDiv({
                text: '暂无使用记录',
                cls: 'nw-empty-center-muted'
            });
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
                left.createEl('span', {
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
                text: '← 上一页',
                cls: 'nw-pm-pager-btn',
                attr: { type: 'button' },
            });
            prev.disabled = this.usagePage <= 0;
            prev.onclick = () => this.gotoUsagePage(this.usagePage - 1);

            pager.createSpan({
                cls: 'nw-pm-pager-label',
                text: `第 ${this.usagePage + 1} / ${totalPages} 页`,
            });

            const next = pager.createEl('button', {
                text: '下一页 →',
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
        container.createEl('h3', { text: '📦 导入/导出', cls: 'nw-pm-tab-title' });

        const exportSection = container.createDiv({
            cls: 'nw-pm-io-box'
        });
        exportSection.createEl('h4', { text: '📤 导出配置', cls: 'nw-h4-sm' });
        exportSection.createDiv({
            text: '导出所有自定义提示词模板和A/B测试配置',
            cls: 'nw-pm-io-desc'
        });
        const exportBtn = exportSection.createEl('button', {
            text: '📥 导出 JSON',
            cls: 'nw-pm-btn nw-pm-btn--primary-lg',
            attr: { type: 'button' }
        });
        exportBtn.onclick = () => { void this.exportConfig(); };

        const importSection = container.createDiv({
            cls: 'nw-pm-io-box nw-pm-io-box--last'
        });
        importSection.createEl('h4', { text: '📥 导入配置', cls: 'nw-h4-sm' });
        importSection.createDiv({
            text: '从 JSON 文件导入提示词配置（导入前先预览将要新增/覆盖的内容，可合并或整份覆盖）',
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
                showErrorNotice('导入失败：文件读取错误');
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
            showErrorNotice(`导入失败：${parsed.error}`);
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
            showErrorNotice('导入失败：格式错误');
            return;
        }
        showSuccessNotice(mode === 'merge' ? '已合并导入配置' : '已覆盖导入配置');
        this.usagePage = 0;
        this.renderActiveTab();
    }

    private async exportConfig(): Promise<void> {
        const json = this.promptManager.exportConfig();
        await exportTextFile(this.app, `prompt-config-${new Date().toISOString().slice(0, 10)}.json`, json, {
            mime: 'application/json',
            successMessage: '✅ 配置已导出',
        });
    }

    private showCreateTemplateModal(): void {
        const modal = new Modal(this.app);
        modal.titleEl.setText('新建自定义提示词');

        let name = '';
        let category: PromptCategory = 'other';
        let description = '';
        let systemPrompt = '';
        let userPrompt = '';

        const content = modal.contentEl;

        new Setting(content)
            .setName('名称')
            .addText(text => text
                .setPlaceholder('提示词名称')
                .onChange(v => name = v));

        new Setting(content)
            .setName('分类')
            .addDropdown(dropdown => {
                for (const [key, label] of Object.entries(PROMPT_CATEGORY_LABELS)) {
                    dropdown.addOption(key, label);
                }
                dropdown.setValue(category);
                dropdown.onChange(v => category = v as PromptCategory);
            });

        new Setting(content)
            .setName('描述')
            .addTextArea(text => text
                .setPlaceholder('简要描述这个提示词的用途')
                .onChange(v => description = v));

        content.createEl('h4', { text: '系统提示词' });
        const sysTextarea = content.createEl('textarea', {
            cls: 'nw-textarea-code',
            attr: { placeholder: '系统提示词内容...' }
        });
        sysTextarea.addEventListener('input', () => systemPrompt = sysTextarea.value);

        content.createEl('h4', { text: '用户提示词模板' });
        const userTextarea = content.createEl('textarea', {
            cls: 'nw-textarea-code',
            attr: { placeholder: '用户提示词模板内容...' }
        });
        userTextarea.addEventListener('input', () => userPrompt = userTextarea.value);

        modal.modalEl.createDiv({ cls: 'nw-modal-footer' })
            .createEl('button', {
                text: '创建',
                cls: 'nw-modal-btn-primary',
                attr: { type: 'button' }
            }).onclick = async () => {
                if (!name.trim()) {
                    new Notice('请输入提示词名称');
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
                showSuccessNotice('提示词已创建');
                modal.close();
                this.renderActiveTab();
            };

        modal.open();
    }

    private showEditTemplateModal(template: PromptTemplate): void {
        const activeVersion = this.promptManager.getActiveVersion(template);
        if (!activeVersion) return;

        const modal = new Modal(this.app);
        modal.titleEl.setText(template.isCustom ? '编辑提示词' : '自定义提示词');

        let name = template.name;
        let description = template.description;
        let systemPrompt = activeVersion.systemPrompt;
        let userPrompt = activeVersion.userPrompt;
        let newVersion = false;
        let versionNote = '';

        const content = modal.contentEl;

        new Setting(content)
            .setName('名称')
            .addText(text => text
                .setValue(name)
                .onChange(v => name = v));

        new Setting(content)
            .setName('描述')
            .addTextArea(text => text
                .setValue(description)
                .onChange(v => description = v));

        if (template.isCustom) {
            new Setting(content)
                .setName('另存为新版本')
                .setDesc('保存为新版本，保留历史版本')
                .addToggle(toggle => toggle
                    .setValue(false)
                    .onChange(v => newVersion = v));

            if (newVersion) {
                new Setting(content)
                    .setName('版本说明')
                    .addText(text => text
                        .setPlaceholder('可选：版本更新说明')
                        .onChange(v => versionNote = v));
            }
        }

        content.createEl('h4', { text: '系统提示词' });
        const sysTextarea = content.createEl('textarea', {
            cls: 'nw-pm-textarea'
        });
        sysTextarea.value = systemPrompt;
        sysTextarea.addEventListener('input', () => systemPrompt = sysTextarea.value);

        content.createEl('h4', { text: '用户提示词模板' });
        const userTextarea = content.createEl('textarea', {
            cls: 'nw-pm-textarea'
        });
        userTextarea.value = userPrompt;
        userTextarea.addEventListener('input', () => userPrompt = userTextarea.value);

        const footer = modal.modalEl.createDiv({ cls: 'nw-modal-footer' });

        const cancelBtn = footer.createEl('button', {
            text: '取消',
            cls: 'nw-modal-btn-secondary',
            attr: { type: 'button' }
        });
        cancelBtn.onclick = () => modal.close();

        const saveBtn = footer.createEl('button', {
            text: template.isCustom ? '保存' : '保存为自定义',
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
                showSuccessNotice('已保存');
            } else {
                const currentVersion = activeVersion.version;
                const parts = currentVersion.split('.').map(Number);
                parts[2]++;
                const nextVersion = parts.join('.');

                await this.promptManager.addVersion(template.id, {
                    version: nextVersion,
                    systemPrompt,
                    userPrompt,
                    description: versionNote || '用户修改',
                    isActive: true,
                });
                await this.promptManager.updateTemplate(template.id, {
                    name,
                    description,
                });
                showSuccessNotice(`已保存为 v${nextVersion}`);
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
        modal.titleEl.setText('新建版本');

        let version = '';
        let description = '';
        let systemPrompt = activeVersion.systemPrompt;
        let userPrompt = activeVersion.userPrompt;

        const content = modal.contentEl;

        const parts = activeVersion.version.split('.').map(Number);
        parts[2]++;
        const suggestedVersion = parts.join('.');

        new Setting(content)
            .setName('版本号')
            .addText(text => text
                .setValue(suggestedVersion)
                .onChange(v => version = v));
        version = suggestedVersion;

        new Setting(content)
            .setName('版本说明')
            .addText(text => text
                .setPlaceholder('版本更新说明（可选）')
                .onChange(v => description = v));

        content.createEl('h4', { text: '系统提示词' });
        const sysTextarea = content.createEl('textarea', {
            cls: 'nw-textarea-code',
        });
        sysTextarea.value = systemPrompt;
        sysTextarea.addEventListener('input', () => systemPrompt = sysTextarea.value);

        content.createEl('h4', { text: '用户提示词模板' });
        const userTextarea = content.createEl('textarea', {
            cls: 'nw-textarea-code',
        });
        userTextarea.value = userPrompt;
        userTextarea.addEventListener('input', () => userPrompt = userTextarea.value);

        const footer = modal.modalEl.createDiv({ cls: 'nw-modal-footer' });

        footer.createEl('button', {
            text: '取消',
            cls: 'nw-modal-btn-secondary',
            attr: { type: 'button' }
        }).onclick = () => modal.close();

        footer.createEl('button', {
            text: '创建版本',
            cls: 'nw-modal-btn-primary',
            attr: { type: 'button' }
        }).onclick = async () => {
            if (!version.trim()) {
                new Notice('请输入版本号');
                return;
            }
            await this.promptManager.addVersion(template.id, {
                version,
                systemPrompt,
                userPrompt,
                description: description || undefined,
                isActive: true,
            });
            showSuccessNotice(`v${version} 已创建`);
            modal.close();
            this.renderActiveTab();
        };

        modal.open();
    }

    private showCreateTestModal(): void {
        const modal = new Modal(this.app);
        modal.titleEl.setText('创建A/B测试');

        let name = '';
        let description = '';
        let templateId = '';
        let versionA = '';
        let versionB = '';
        let splitA = 50;
        let splitB = 50;

        const content = modal.contentEl;

        new Setting(content)
            .setName('测试名称')
            .addText(text => text
                .setPlaceholder('测试名称')
                .onChange(v => name = v));

        new Setting(content)
            .setName('测试描述')
            .addTextArea(text => text
                .setPlaceholder('简要描述测试目的（可选）')
                .onChange(v => description = v));

        const templates = this.promptManager.getAllTemplates();
        new Setting(content)
            .setName('选择提示词模板')
            .addDropdown(dropdown => {
                dropdown.addOption('', '请选择模板');
                for (const t of templates) {
                    dropdown.addOption(t.id, t.name);
                }
                dropdown.onChange(v => {
                    templateId = v;
                    const t = this.promptManager.getTemplateById(v);
                    if (t && t.versions.length >= 1) {
                        versionA = t.versions[0].version;
                        versionB = t.versions[Math.min(1, t.versions.length - 1)].version;
                    }
                    renderVersionDropdowns();
                });
            });

        const versionASetting = new Setting(content).setName('A 版本');
        const versionBSetting = new Setting(content).setName('B 版本');

        function renderVersionDropdowns() {
            const t = templateId ? this_2.promptManager.getTemplateById(templateId) : null;
            versionASetting.clear();
            versionBSetting.clear();
            if (t) {
                versionASetting.addDropdown(dropdown => {
                    for (const v of t.versions) {
                        dropdown.addOption(v.version, `v${v.version}`);
                    }
                    dropdown.setValue(versionA);
                    dropdown.onChange(v => versionA = v);
                });
                versionBSetting.addDropdown(dropdown => {
                    for (const v of t.versions) {
                        dropdown.addOption(v.version, `v${v.version}`);
                    }
                    dropdown.setValue(versionB);
                    dropdown.onChange(v => versionB = v);
                });
            } else {
                versionASetting.setDesc('请先选择模板');
                versionBSetting.setDesc('请先选择模板');
            }
        }

        const this_2 = this;

        new Setting(content)
            .setName('A 流量占比')
            .addSlider(slider => slider
                .setLimits(10, 90, 5)
                .setValue(50)
                .setDynamicTooltip()
                .onChange(v => {
                    splitA = v;
                    splitB = 100 - v;
                }));

        new Setting(content)
            .setName('B 流量占比')
            .setDesc(`${splitB}%`)
            .addText(text => text
                .setValue(String(100 - splitA))
                .setDisabled(true));

        const footer = modal.modalEl.createDiv({ cls: 'nw-modal-footer' });

        footer.createEl('button', {
            text: '取消',
            cls: 'nw-modal-btn-secondary',
            attr: { type: 'button' }
        }).onclick = () => modal.close();

        footer.createEl('button', {
            text: '创建',
            cls: 'nw-modal-btn-primary',
            attr: { type: 'button' }
        }).onclick = async () => {
            if (!name.trim()) {
                new Notice('请输入测试名称');
                return;
            }
            if (!templateId) {
                new Notice('请选择提示词模板');
                return;
            }
            if (!versionA || !versionB) {
                new Notice('请选择两个版本');
                return;
            }
            if (versionA === versionB) {
                new Notice('两个版本不能相同');
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
            showSuccessNotice('测试已创建');
            modal.close();
            this.renderActiveTab();
        };

        modal.open();
    }

    private showFinishTestModal(test: ABTest): void {
        const modal = new Modal(this.app);
        modal.titleEl.setText('结束测试');

        const content = modal.contentEl;
        content.createDiv({
            text: '选择优胜版本，该版本将设为提示词的活跃版本。',
            cls: 'nw-pm-finish-desc'
        });

        const stats = this.promptManager.getABTestStats(test.id);

        if (stats?.winner && stats.winner !== 'tie') {
            content.createDiv({
                text: `🏆 推荐优胜: ${stats.winner.toUpperCase()} 版本`,
                cls: 'nw-pm-winner nw-pm-winner--lg'
            });
        }

        const footer = modal.modalEl.createDiv({ cls: 'nw-modal-footer' });

        footer.createEl('button', {
            text: 'A 获胜',
            cls: 'nw-modal-btn-primary',
            attr: { type: 'button' }
        }).onclick = async () => {
            await this.promptManager.setWinner(test.id, 'a');
            showSuccessNotice('A 版本获胜，已设为活跃版本');
            modal.close();
            this.renderActiveTab();
        };

        footer.createEl('button', {
            text: 'B 获胜',
            cls: 'nw-modal-btn-primary',
            attr: { type: 'button' }
        }).onclick = async () => {
            await this.promptManager.setWinner(test.id, 'b');
            showSuccessNotice('B 版本获胜，已设为活跃版本');
            modal.close();
            this.renderActiveTab();
        };

        footer.createEl('button', {
            text: '仅结束（不决出胜负）',
            cls: 'nw-modal-btn-secondary',
            attr: { type: 'button' }
        }).onclick = async () => {
            await this.promptManager.updateABTestStatus(test.id, 'completed');
            showSuccessNotice('测试已结束');
            modal.close();
            this.renderActiveTab();
        };

        modal.open();
    }
}


