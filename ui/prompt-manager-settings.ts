import { App, Notice, Modal, Setting, TextComponent } from 'obsidian';
import type NovelWriterPlugin from '../main';
import { PromptManager, PROMPT_CATEGORY_LABELS } from '../services/prompt-manager';
import type {
    PromptTemplate,
    PromptCategory,
    ABTest,
    PromptTemplateVersion,
} from '../shared/prompt-manager-types';
import { OperationConfirmModal } from './components/progress';
import { exportTextFile } from '../shared/export-file';

export class PromptManagerSettings {
    private plugin: NovelWriterPlugin;
    private app: App;
    private container: HTMLElement;
    private activeSubTab: string = 'templates';
    private selectedCategory: PromptCategory | 'all' = 'all';
    private selectedTemplateId: string | null = null;
    private selectedTestId: string | null = null;
    private searchKeyword: string = '';

    constructor(app: App, plugin: NovelWriterPlugin, container: HTMLElement) {
        this.app = app;
        this.plugin = plugin;
        this.container = container;
    }

    private get promptManager(): PromptManager {
        return this.plugin.promptManager!;
    }

    render(): void {
        this.container.empty();

        const subTabBar = this.container.createDiv({ cls: 'nw-settings-subtab-bar' });
        const subTabs = [
            { id: 'templates', label: '📝 提示词模板' },
            { id: 'abtests', label: '🧪 A/B 测试' },
            { id: 'usage', label: '📊 使用统计' },
            { id: 'import-export', label: '📦 导入/导出' },
        ];

        for (const tab of subTabs) {
            const tabEl = subTabBar.createDiv({
                cls: 'nw-settings-subtab',
                text: tab.label,
                attr: { 'data-subtab-id': tab.id },
            });
            if (tab.id === this.activeSubTab) tabEl.addClass('is-active');
            tabEl.addEventListener('click', () => {
                this.activeSubTab = tab.id;
                this.render();
            });
        }

        const content = this.container.createDiv({ cls: 'nw-settings-subtab-content' });

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
        const layout = container.createDiv({ cls: 'nw-u-d-flex-2 nw-u-gap-16px-2' });

        const sidebar = layout.createDiv({ cls: 'nw-u-w-260px nw-u-fsh-0-2' });
        const main = layout.createDiv({ cls: 'nw-u-flex-1-2 nw-u-minw-0-2' });

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
                        this.render();
                    });
            });

        const categoryList = container.createDiv({ cls: 'nw-u-marginbottom-12px-2' });
        const allBtn = categoryList.createEl('button', {
            text: `📚 全部 (${this.promptManager.getAllTemplates().length})`,
            attr: {
                style: `width:100%;text-align:left;padding:6px 10px;margin-bottom:4px;border:none;background:${this.selectedCategory === 'all' ? 'var(--background-modifier-hover)' : 'transparent'};color:var(--text-normal);cursor:pointer;border-radius:4px;font-size:13px;`
            }
        });
        allBtn.onclick = () => {
            this.selectedCategory = 'all';
            this.render();
        };

        for (const { category, count } of this.promptManager.getCategories()) {
            const label = PROMPT_CATEGORY_LABELS[category] || category;
            const btn = categoryList.createEl('button', {
                text: `${label} (${count})`,
                attr: {
                    style: `width:100%;text-align:left;padding:6px 10px;margin-bottom:2px;border:none;background:${this.selectedCategory === category ? 'var(--background-modifier-hover)' : 'transparent'};color:var(--text-normal);cursor:pointer;border-radius:4px;font-size:13px;`
                }
            });
            btn.onclick = () => {
                this.selectedCategory = category;
                this.render();
            };
        }

        const templates = this.selectedCategory === 'all'
            ? this.promptManager.getAllTemplates()
            : this.promptManager.getTemplatesByCategory(this.selectedCategory);

        const filtered = templates.filter(t =>
            !this.searchKeyword ||
            t.name.toLowerCase().includes(this.searchKeyword.toLowerCase()) ||
            t.description.toLowerCase().includes(this.searchKeyword.toLowerCase())
        );

        const templateList = container.createDiv({
            cls: 'nw-u-bt-1px-solid-background-m-2 nw-u-paddingtop-8px-2 nw-u-maxh-400px-2 nw-u-ovy-auto-2'
        });

        for (const t of filtered) {
            const item = templateList.createDiv({
                attr: {
                    style: `padding:8px 10px;border-radius:4px;cursor:pointer;margin-bottom:2px;background:${this.selectedTemplateId === t.id ? 'var(--background-modifier-hover)' : 'transparent'};`
                }
            });
            item.createDiv({
                text: t.name,
                cls: 'nw-u-fwt-600-2 nw-u-fs-13px-2'
            });
            item.createDiv({
                text: t.description.slice(0, 40) + (t.description.length > 40 ? '...' : ''),
                cls: 'nw-u-fs-11px-2 nw-u-c-text-muted-2 nw-u-margintop-2px-2'
            });
            if (t.isCustom) {
                item.createEl('span', {
                    text: '自定义',
                    cls: 'nw-u-d-inline-block nw-u-p-1px-6px-2 nw-u-fs-10px-2 nw-u-bg-background-modifier-su nw-u-c-text-on-accent-2 nw-u-brd-3px-2 nw-u-margintop-4px-3'
                });
            }
            item.onclick = () => {
                this.selectedTemplateId = t.id;
                this.render();
            };
        }

        const addBtn = container.createEl('button', {
            text: '➕ 新建自定义提示词',
            attr: {
                type: 'button',
                style: 'width:100%;margin-top:12px;padding:8px;border:1px dashed var(--background-modifier-border);background:transparent;color:var(--text-muted);cursor:pointer;border-radius:6px;font-size:13px;'
            }
        });
        addBtn.onclick = () => this.showCreateTemplateModal();
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
            container.createDiv({ text: '模板未找到', cls: 'nw-u-c-text-error' });
            return;
        }

        const header = container.createDiv({ cls: 'nw-u-d-flex-2 nw-u-jc-space-between-2 nw-u-ai-flex-start-2 nw-u-marginbottom-16px-2' });
        const titleArea = header.createDiv();
        titleArea.createEl('h3', { text: template.name, cls: 'nw-u-m-0-0-4px-0' });
        titleArea.createEl('div', {
            text: `${PROMPT_CATEGORY_LABELS[template.category] || template.category} · v${this.promptManager.getActiveVersion(template)?.version || '?'}`,
            cls: 'nw-u-fs-13px-2 nw-u-c-text-muted-2'
        });

        const actions = header.createDiv({ cls: 'nw-u-d-flex-2 nw-u-gap-8px-2' });

        const editBtn = actions.createEl('button', {
            text: template.isCustom ? '✏️ 编辑' : '📝 自定义',
            cls: 'nw-action-btn',
            attr: { type: 'button' }
        });
        editBtn.onclick = () => this.showEditTemplateModal(template);

        if (template.isCustom) {
            const resetBtn = actions.createEl('button', {
                text: '🔄 重置',
                attr: {
                    type: 'button',
                    style: 'padding:6px 12px;font-size:12px;cursor:pointer;border:1px solid var(--background-modifier-border);border-radius:4px;background:var(--background-secondary);color:var(--text-error);'
                }
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
                    new Notice('已重置为默认提示词');
                    this.render();
                }
            };
        }

        const desc = container.createDiv({
            text: template.description,
            cls: 'nw-u-p-12px-2 nw-u-bg-background-secondary-2 nw-u-brd-6px-2 nw-u-marginbottom-16px-2 nw-u-fs-13px-2 nw-u-c-text-muted-2'
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
        const section = container.createDiv({ cls: 'nw-u-marginbottom-16px-2' });
        section.createEl('h4', { text: '📋 版本历史', cls: 'nw-h4-sm' });

        const versionList = section.createDiv({
            cls: 'nw-u-d-flex-2 nw-u-fwr-wrap-2 nw-u-gap-6px-2 nw-u-marginbottom-8px-2'
        });

        for (const ver of template.versions) {
            const badge = versionList.createEl('span', {
                text: `v${ver.version}${ver.isActive ? ' ✓' : ''}`,
                attr: {
                    style: `padding:4px 10px;font-size:12px;border-radius:4px;cursor:pointer;${ver.isActive
                        ? 'background:var(--interactive-accent);color:var(--text-on-accent);'
                        : 'background:var(--background-secondary);color:var(--text-muted);'
                        }`
                }
            });
            badge.title = new Date(ver.createdAt).toLocaleString();
            if (!ver.isActive) {
                badge.onclick = async () => {
                    await this.promptManager.setActiveVersion(template.id, ver.version);
                    new Notice(`已切换到 v${ver.version}`);
                    this.render();
                };
            }
        }

        const addVerBtn = section.createEl('button', {
            text: '➕ 新建版本',
            attr: {
                type: 'button',
                style: 'padding:4px 10px;font-size:12px;cursor:pointer;border:1px dashed var(--background-modifier-border);background:transparent;color:var(--text-muted);border-radius:4px;'
            }
        });
        addVerBtn.onclick = () => this.showAddVersionModal(template);
    }

    private renderPromptPreview(container: HTMLElement, version: PromptTemplateVersion): void {
        const section = container.createDiv({ cls: 'nw-u-marginbottom-16px-2' });
        section.createEl('h4', { text: '🔤 系统提示词', cls: 'nw-h4-sm' });
        const systemBox = section.createEl('pre', {
            text: version.systemPrompt,
            cls: 'nw-u-p-12px-2 nw-u-bg-background-secondary-2 nw-u-brd-6px-2 nw-u-fs-12px-2 nw-u-ws-pre-wrap nw-u-maxh-200px-2 nw-u-ovy-auto-2 nw-u-m-0-2'
        });

        section.createEl('h4', { text: '📝 用户提示词模板', cls: 'nw-u-m-16px-0-8px-0' });
        const userBox = section.createEl('pre', {
            text: version.userPrompt,
            cls: 'nw-u-p-12px-2 nw-u-bg-background-secondary-2 nw-u-brd-6px-2 nw-u-fs-12px-2 nw-u-ws-pre-wrap nw-u-maxh-200px-2 nw-u-ovy-auto-2 nw-u-m-0-2'
        });
    }

    private renderVariablesList(container: HTMLElement, template: PromptTemplate): void {
        const section = container.createDiv();
        section.createEl('h4', { text: '🔧 可用变量', cls: 'nw-h4-sm' });

        const varGrid = section.createDiv({
            cls: 'nw-u-d-grid-2 nw-u-gtc-1fr-1fr-2 nw-u-gap-8px-2'
        });

        for (const v of template.variables) {
            const item = varGrid.createDiv({
                cls: 'nw-u-p-8px-10px-2 nw-u-bg-background-secondary-2 nw-u-brd-4px-2 nw-u-fs-12px-2'
            });
            item.createDiv({
                text: `\${${v.name}}`,
                cls: 'nw-u-fontfamily-monospace nw-u-fwt-600-2 nw-u-c-interactive-accent-2'
            });
            item.createDiv({
                text: v.description,
                cls: 'nw-u-c-text-muted-2 nw-u-margintop-2px-2 nw-u-fs-11px-2'
            });
            if (v.required) {
                item.createEl('span', {
                    text: '必填',
                    cls: 'nw-u-d-inline-block nw-u-p-1px-4px nw-u-fs-10px-2 nw-u-bg-background-modifier-er nw-u-c-text-on-accent-2 nw-u-brd-3px-2 nw-u-margintop-4px-3'
                });
            }
        }
    }

    private renderABTestsTab(container: HTMLElement): void {
        const header = container.createDiv({ cls: 'nw-u-d-flex-2 nw-u-jc-space-between-2 nw-u-ai-center-2 nw-u-marginbottom-16px-2' });
        header.createEl('h3', { text: '🧪 A/B 测试管理', cls: 'nw-u-m-0-2' });

        const enableRow = header.createDiv({ cls: 'nw-u-d-flex-2 nw-u-ai-center-2 nw-u-gap-8px-2' });
        enableRow.createSpan({ text: '启用A/B测试', cls: 'nw-u-fs-13px-2' });
        const toggle = enableRow.createEl('input', {
            type: 'checkbox',
            cls: 'nw-u-cur-pointer-2'
        });
        toggle.checked = this.promptManager.isABTestingEnabled();
        toggle.addEventListener('change', async () => {
            this.promptManager.setABTestingEnabled(toggle.checked);
            new Notice(toggle.checked ? 'A/B测试已启用' : 'A/B测试已关闭');
            this.render();
        });

        const tests = this.promptManager.getABTests();

        if (tests.length === 0) {
            container.createDiv({
                text: '暂无A/B测试。点击下方按钮创建第一个测试。',
                cls: 'nw-empty-center-muted'
            });
        } else {
            const testList = container.createDiv({ cls: 'nw-u-d-flex-2 nw-u-fd-column-2 nw-u-gap-8px-2' });
            for (const test of tests) {
                this.renderTestCard(testList, test);
            }
        }

        const createBtn = container.createEl('button', {
            text: '➕ 创建A/B测试',
            attr: {
                type: 'button',
                style: 'margin-top:16px;padding:8px 16px;cursor:pointer;border:1px solid var(--background-modifier-border);border-radius:6px;background:var(--background-secondary);color:var(--text-normal);font-size:13px;'
            }
        });
        createBtn.onclick = () => this.showCreateTestModal();
    }

    private renderTestCard(container: HTMLElement, test: ABTest): void {
        const card = container.createDiv({
            attr: {
                style: `padding:12px;border:1px solid var(--background-modifier-border);border-radius:8px;background:var(--background-primary);cursor:${this.selectedTestId === test.id ? 'default' : 'pointer'};${this.selectedTestId === test.id ? 'border-color:var(--interactive-accent);' : ''}`
            }
        });
        card.onclick = () => {
            this.selectedTestId = this.selectedTestId === test.id ? null : test.id;
            this.render();
        };

        const header = card.createDiv({ cls: 'nw-u-d-flex-2 nw-u-jc-space-between-2 nw-u-ai-center-2' });
        const title = header.createDiv();
        title.createDiv({
            text: test.name,
            cls: 'nw-u-fwt-600-2 nw-u-fs-14px-2'
        });
        title.createDiv({
            text: `模板: ${test.templateId} · 流量 ${test.trafficSplit.a}/${test.trafficSplit.b}`,
            cls: 'nw-stat-muted-mt'
        });

        const statusBadge = header.createEl('span', {
            text: this.getStatusLabel(test.status),
            attr: {
                style: `padding:4px 10px;font-size:11px;border-radius:4px;${this.getStatusStyle(test.status)}`
            }
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

    private getStatusStyle(status: string): string {
        const styles: Record<string, string> = {
            draft: 'background:var(--background-secondary);color:var(--text-muted);',
            running: 'background:var(--background-modifier-success);color:var(--text-on-accent);',
            paused: 'background:var(--background-modifier-warning);color:var(--text-on-accent);',
            completed: 'background:var(--interactive-accent);color:var(--text-on-accent);',
        };
        return styles[status] || '';
    }

    private renderTestDetail(container: HTMLElement, test: ABTest): void {
        const detail = container.createDiv({
            cls: 'nw-u-margintop-12px-2 nw-u-paddingtop-12px-2 nw-u-bt-1px-solid-background-m-2'
        });

        if (test.description) {
            detail.createDiv({
                text: test.description,
                cls: 'nw-u-fs-13px-2 nw-u-c-text-muted-2 nw-u-marginbottom-12px-2'
            });
        }

        const statsGrid = detail.createDiv({
            cls: 'nw-u-d-grid-2 nw-u-gtc-1fr-1fr-2 nw-u-gap-12px-2 nw-u-marginbottom-12px-2'
        });

        this.renderVariantStats(statsGrid, 'A 版本', test.variantA, test.trafficSplit.a);
        this.renderVariantStats(statsGrid, 'B 版本', test.variantB, test.trafficSplit.b);

        const stats = this.promptManager.getABTestStats(test.id);
        if (stats?.winner) {
            const winnerBox = detail.createDiv({
                cls: 'nw-u-p-10px-2 nw-u-bg-background-modifier-su nw-u-c-text-on-accent-2 nw-u-brd-6px-2 nw-u-ta-center-2 nw-u-fwt-600-2 nw-u-marginbottom-12px-2'
            });
            winnerBox.setText(`🏆 当前优胜: ${stats.winner.toUpperCase()} 版本`);
        }

        const actions = detail.createDiv({ cls: 'nw-u-d-flex-2 nw-u-gap-8px-2 nw-u-fwr-wrap-2' });

        if (test.status === 'draft') {
            const startBtn = actions.createEl('button', {
                text: '▶️ 开始测试',
                attr: {
                    type: 'button',
                    style: 'padding:6px 12px;cursor:pointer;border:none;border-radius:4px;background:var(--interactive-accent);color:var(--text-on-accent);font-size:12px;'
                }
            });
            startBtn.onclick = async () => {
                await this.promptManager.updateABTestStatus(test.id, 'running');
                new Notice('测试已开始');
                this.render();
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
                new Notice('测试已暂停');
                this.render();
            };
        }

        if (test.status === 'paused') {
            const resumeBtn = actions.createEl('button', {
                text: '▶️ 继续',
                attr: {
                    type: 'button',
                    style: 'padding:6px 12px;cursor:pointer;border:none;border-radius:4px;background:var(--interactive-accent);color:var(--text-on-accent);font-size:12px;'
                }
            });
            resumeBtn.onclick = async () => {
                await this.promptManager.updateABTestStatus(test.id, 'running');
                new Notice('测试已继续');
                this.render();
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
            attr: {
                type: 'button',
                style: 'padding:6px 12px;cursor:pointer;border:1px solid var(--background-modifier-border);border-radius:4px;background:var(--background-secondary);color:var(--text-error);font-size:12px;margin-left:auto;'
            }
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
                new Notice('测试已删除');
                this.render();
            }
        };
    }

    private renderVariantStats(container: HTMLElement, label: string, variant: { version: string; metrics: any }, traffic: number): void {
        const card = container.createDiv({
            cls: 'nw-u-p-10px-2 nw-u-bg-background-secondary-2 nw-u-brd-6px-2'
        });
        card.createDiv({
            text: `${label} (v${variant.version})`,
            cls: 'nw-u-fwt-600-2 nw-u-fs-13px-2 nw-u-marginbottom-8px-2'
        });
        card.createDiv({
            text: `调用次数: ${variant.metrics.totalCalls}`,
            cls: 'nw-u-fs-12px-2 nw-u-c-text-muted-2'
        });
        if (variant.metrics.ratingCount > 0) {
            card.createDiv({
                text: `平均评分: ${variant.metrics.avgRating.toFixed(1)}/10`,
                cls: 'nw-stat-muted-mt'
            });
        }
        if (variant.metrics.qualityCount > 0) {
            card.createDiv({
                text: `平均质量: ${variant.metrics.avgQuality.toFixed(1)}/10`,
                cls: 'nw-stat-muted-mt'
            });
        }
        if (variant.metrics.modificationCount > 0) {
            card.createDiv({
                text: `修改率: ${(variant.metrics.modificationRate * 100).toFixed(1)}%`,
                cls: 'nw-stat-muted-mt'
            });
        }
        card.createDiv({
            text: `流量占比: ${traffic}%`,
            cls: 'nw-stat-muted-mt'
        });
    }

    private renderUsageTab(container: HTMLElement): void {
        container.createEl('h3', { text: '📊 使用记录', cls: 'nw-u-m-0-0-16px-0-2' });

        const history = this.promptManager.getUsageHistory(undefined, 50);

        if (history.length === 0) {
            container.createDiv({
                text: '暂无使用记录',
                cls: 'nw-empty-center-muted'
            });
            return;
        }

        const list = container.createDiv({
            cls: 'nw-u-d-flex-2 nw-u-fd-column-2 nw-u-gap-4px-2 nw-u-maxh-500px nw-u-ovy-auto-2'
        });

        for (const record of history) {
            const item = list.createDiv({
                cls: 'nw-u-p-8px-12px-2 nw-u-bg-background-secondary-2 nw-u-brd-4px-2 nw-u-fs-12px-2 nw-u-d-flex-2 nw-u-jc-space-between-2 nw-u-ai-center-2'
            });
            const left = item.createDiv();
            left.createSpan({
                text: record.templateId,
                cls: 'nw-u-fwt-600-2 nw-u-marginright-8px'
            });
            left.createSpan({
                text: `v${record.version}`,
                cls: 'nw-u-c-text-muted-2'
            });
            if (record.abTestId) {
                left.createEl('span', {
                    text: `A/B ${record.abVariant?.toUpperCase()}`,
                    cls: 'nw-u-marginleft-8px nw-u-p-2px-6px-2 nw-u-fs-10px-2 nw-u-bg-interactive-accent-2 nw-u-c-text-on-accent-2 nw-u-brd-3px-2'
                });
            }

            const right = item.createDiv({ cls: 'nw-u-c-text-muted-2' });
            right.setText(new Date(record.timestamp).toLocaleString());
            if (record.rating !== undefined) {
                right.setText(right.textContent + ` · ⭐${record.rating}`);
            }
        }
    }

    private renderImportExportTab(container: HTMLElement): void {
        container.createEl('h3', { text: '📦 导入/导出', cls: 'nw-u-m-0-0-16px-0-2' });

        const exportSection = container.createDiv({
            cls: 'nw-u-p-16px-2 nw-u-bg-background-secondary-2 nw-u-brd-8px-2 nw-u-marginbottom-16px-2'
        });
        exportSection.createEl('h4', { text: '📤 导出配置', cls: 'nw-h4-sm' });
        exportSection.createDiv({
            text: '导出所有自定义提示词模板和A/B测试配置',
            cls: 'nw-u-fs-13px-2 nw-u-c-text-muted-2 nw-u-marginbottom-12px-2'
        });
        const exportBtn = exportSection.createEl('button', {
            text: '📥 导出 JSON',
            attr: {
                type: 'button',
                style: 'padding:8px 16px;cursor:pointer;border:none;border-radius:6px;background:var(--interactive-accent);color:var(--text-on-accent);font-size:13px;'
            }
        });
        exportBtn.onclick = () => { void this.exportConfig(); };

        const importSection = container.createDiv({
            cls: 'nw-u-p-16px-2 nw-u-bg-background-secondary-2 nw-u-brd-8px-2'
        });
        importSection.createEl('h4', { text: '📥 导入配置', cls: 'nw-h4-sm' });
        importSection.createDiv({
            text: '从 JSON 文件导入提示词配置（将覆盖现有自定义配置）',
            cls: 'nw-u-fs-13px-2 nw-u-c-text-muted-2 nw-u-marginbottom-12px-2'
        });

        const input = importSection.createEl('input', {
            type: 'file',
            attr: { accept: '.json', style: 'margin-bottom:12px;' }
        });
        input.addEventListener('change', async (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) return;
            const text = await file.text();
            try {
                const success = this.promptManager.importConfig(text);
                if (success) {
                    new Notice('✅ 配置导入成功');
                    this.render();
                } else {
                    new Notice('❌ 导入失败：格式错误');
                }
            } catch (err) {
                new Notice('❌ 导入失败：文件解析错误');
            }
        });
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
                const template: any = {
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
                new Notice('✅ 提示词已创建');
                modal.close();
                this.render();
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
            cls: 'nw-u-w-100-2 nw-u-minh-150px nw-u-p-8px-2 nw-u-b-1px-solid-background-m-2 nw-u-brd-4px-2 nw-u-bg-background-primary-2 nw-u-c-text-normal-2 nw-u-fontfamily-monospace nw-u-fs-12px-2 nw-u-resize-vertical'
        });
        sysTextarea.value = systemPrompt;
        sysTextarea.addEventListener('input', () => systemPrompt = sysTextarea.value);

        content.createEl('h4', { text: '用户提示词模板' });
        const userTextarea = content.createEl('textarea', {
            cls: 'nw-u-w-100-2 nw-u-minh-150px nw-u-p-8px-2 nw-u-b-1px-solid-background-m-2 nw-u-brd-4px-2 nw-u-bg-background-primary-2 nw-u-c-text-normal-2 nw-u-fontfamily-monospace nw-u-fs-12px-2 nw-u-resize-vertical'
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
                } as any);
                new Notice('✅ 已保存');
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
                } as any);
                new Notice(`✅ 已保存为 v${nextVersion}`);
            }
            modal.close();
            this.render();
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
            new Notice(`✅ v${version} 已创建`);
            modal.close();
            this.render();
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
            new Notice('✅ 测试已创建');
            modal.close();
            this.render();
        };

        modal.open();
    }

    private showFinishTestModal(test: ABTest): void {
        const modal = new Modal(this.app);
        modal.titleEl.setText('结束测试');

        const content = modal.contentEl;
        content.createDiv({
            text: '选择优胜版本，该版本将设为提示词的活跃版本。',
            cls: 'nw-u-marginbottom-16px-2 nw-u-c-text-muted-2'
        });

        const stats = this.promptManager.getABTestStats(test.id);

        if (stats?.winner && stats.winner !== 'tie') {
            content.createDiv({
                text: `🏆 推荐优胜: ${stats.winner.toUpperCase()} 版本`,
                cls: 'nw-u-p-10px-2 nw-u-bg-background-modifier-su nw-u-c-text-on-accent-2 nw-u-brd-6px-2 nw-u-ta-center-2 nw-u-fwt-600-2 nw-u-marginbottom-16px-2'
            });
        }

        const footer = modal.modalEl.createDiv({ cls: 'nw-modal-footer' });

        footer.createEl('button', {
            text: 'A 获胜',
            cls: 'nw-modal-btn-primary',
            attr: { type: 'button' }
        }).onclick = async () => {
            await this.promptManager.setWinner(test.id, 'a');
            new Notice('🏆 A 版本获胜，已设为活跃版本');
            modal.close();
            this.render();
        };

        footer.createEl('button', {
            text: 'B 获胜',
            cls: 'nw-modal-btn-primary',
            attr: { type: 'button' }
        }).onclick = async () => {
            await this.promptManager.setWinner(test.id, 'b');
            new Notice('🏆 B 版本获胜，已设为活跃版本');
            modal.close();
            this.render();
        };

        footer.createEl('button', {
            text: '仅结束（不决出胜负）',
            cls: 'nw-modal-btn-secondary',
            attr: { type: 'button' }
        }).onclick = async () => {
            await this.promptManager.updateABTestStatus(test.id, 'completed');
            new Notice('测试已结束');
            modal.close();
            this.render();
        };

        modal.open();
    }
}
