/**
 * home-view.ts — 创作主页
 *
 * 统一入口：三个创作模式、最近项目、下一步建议、任务中心与项目体检。
 * 原有「项目与章节 / 创作流程 / 句级协同 / Agent」仍保留为子页/深链，
 * 但主 Ribbon 只留主页，避免六个入口都像“开始写作”。
 */
import { ItemView, WorkspaceLeaf } from 'obsidian';
import type NovelWriterPlugin from '@/main';
import { CREATION_MODE_SPECS, type CreationMode } from '@/shared/creation-mode';
import { listProjectIds } from '@/shared/project-catalog';
import { modeFromLibraryPath, projectDisplayName } from '@/domains/kernel/project-locator';
import { CommandIds } from '@/shared/command-ids';
import { hasUsableAiCredentials } from '@/shared/ai-credentials';

/** 主页视图类型。 */
export const VIEW_TYPE_HOME = 'novel-writer-home';

const MODE_ORDER: CreationMode[] = ['long', 'short', 'script'];

/**
 * 创作主页视图。
 */
export class HomeView extends ItemView {
    private readonly plugin: NovelWriterPlugin;
    private refreshTimer: number | null = null;
    private unsubscribeJobs: (() => void) | null = null;

    /**
     * @param leaf - 工作区叶子
     * @param plugin - 插件实例
     */
    constructor(leaf: WorkspaceLeaf, plugin: NovelWriterPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    /**
     * 获取视图类型。
     *
     * @returns 视图类型标识
     */
    getViewType(): string { return VIEW_TYPE_HOME; }

    /**
     * 获取视图标题。
     *
     * @returns 显示标题
     */
    getDisplayText(): string { return '小说工坊 · 创作主页'; }

    /**
     * 获取视图图标。
     *
     * @returns Obsidian 图标名
     */
    getIcon(): string { return 'home'; }

    /** 打开时渲染并监听任务/项目变化。 */
    async onOpen(): Promise<void> {
        this.unsubscribeJobs = this.plugin.getJobService().subscribe(() => this.scheduleRefresh());
        this.registerEvent(this.app.vault.on('create', () => this.scheduleRefresh()));
        this.registerEvent(this.app.vault.on('delete', () => this.scheduleRefresh()));
        this.registerEvent(this.app.vault.on('rename', () => this.scheduleRefresh()));
        await this.render();
    }

    /** 关闭时清理监听。 */
    async onClose(): Promise<void> {
        this.unsubscribeJobs?.();
        this.unsubscribeJobs = null;
        if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
        this.contentEl.empty();
    }

    private scheduleRefresh(): void {
        if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
        this.refreshTimer = window.setTimeout(() => {
            this.refreshTimer = null;
            void this.render();
        }, 200);
    }

    private async render(): Promise<void> {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('nw-scope', 'nw-home');

        const projects = listProjectIds(this.app);
        const activeProject = this.plugin.getActiveProject();
        const running = this.plugin.getJobService().getActive().length;

        this.renderHero(contentEl, projects.length, running);
        this.renderModes(contentEl, projects);
        this.renderNextStep(contentEl, projects, activeProject);
        this.renderRecent(contentEl, projects);
    }

    private renderHero(host: HTMLElement, projectCount: number, running: number): void {
        const hero = host.createDiv({ cls: 'nw-home-hero' });
        const text = hero.createDiv({ cls: 'nw-home-hero-text' });
        text.createEl('h2', { text: '📖 创作主页' });
        text.createEl('p', {
            text: projectCount > 0
                ? `已有 ${projectCount} 个项目${running > 0 ? `，${running} 个任务进行中` : ''}。`
                : '从长篇、短篇或剧本开始；所有数据都在你的 vault 里。',
        });
        const actions = hero.createDiv({ cls: 'nw-home-hero-actions' });
        this.actionButton(actions, running > 0 ? `🧵 任务中心（${running}）` : '🧵 任务中心', 'nw-btn-secondary', () => {
            this.plugin.openJobCenter();
        });
        this.actionButton(actions, '🩺 项目体检', 'nw-btn-secondary', () => {
            this.plugin.openProjectHealth();
        });
        this.actionButton(actions, '🚀 首启引导', 'nw-btn-secondary', () => {
            this.plugin.openOnboarding();
        });
    }

    private renderModes(host: HTMLElement, projects: string[]): void {
        host.createEl('h3', { text: '开始创作', cls: 'nw-home-section-title' });
        const grid = host.createDiv({ cls: 'nw-home-mode-grid' });
        for (const mode of MODE_ORDER) {
            const spec = CREATION_MODE_SPECS[mode];
            const count = projects.filter(project => modeFromLibraryPath(project) === mode).length;
            const card = grid.createDiv({ cls: 'nw-home-mode-card' });
            card.createDiv({ cls: 'nw-home-mode-icon', text: spec.icon });
            card.createEl('h4', { text: spec.label });
            card.createEl('p', { text: spec.description });
            card.createEl('div', {
                cls: 'nw-home-mode-meta',
                text: count > 0 ? `${count} 个项目 · 单元「${spec.unitLabel}」` : `还没有${spec.label}项目`,
            });
            const button = card.createEl('button', {
                cls: 'nw-btn nw-btn-primary',
                text: count > 0 ? `进入${spec.label}` : `新建${spec.label}`,
            });
            button.addEventListener('click', () => {
                if (mode === 'long') {
                    void this.plugin.openFullWriterHome();
                    return;
                }
                void this.plugin.commandUiPort?.executeCommand(
                    mode === 'short' ? CommandIds.CREATE_SHORT : CommandIds.CREATE_SCRIPT,
                );
            });
        }
    }

    private renderNextStep(host: HTMLElement, projects: string[], activeProject: string | null): void {
        host.createEl('h3', { text: '下一步', cls: 'nw-home-section-title' });
        const card = host.createDiv({ cls: 'nw-home-next' });
        const hasKey = hasUsableAiCredentials(this.plugin.settings);

        if (!hasKey) {
            card.createEl('h4', { text: '先配置 API key' });
            card.createEl('p', { text: '写作、质检、结算都需要模型；key 会加密保存在插件数据里。' });
            this.actionButton(card, '⚙️ 去配置', 'nw-btn-primary', () => this.plugin.openPluginSettings());
            return;
        }
        if (projects.length === 0) {
            card.createEl('h4', { text: '还没有项目' });
            card.createEl('p', { text: '可以新建项目，或先导入一个 1 卷 3 章的示例项目看看流程。' });
            const actions = card.createDiv({ cls: 'nw-home-next-actions' });
            this.actionButton(actions, '✨ 导入示例项目', 'nw-btn-primary', () => {
                void this.plugin.commandUiPort?.executeCommand(CommandIds.IMPORT_EXAMPLE);
            });
            this.actionButton(actions, '新建长篇', 'nw-btn-secondary', () => {
                void this.plugin.openFullWriterHome();
            });
            return;
        }

        const target = activeProject && projects.includes(activeProject) ? activeProject : projects[0];
        card.createEl('h4', { text: `继续《${projectDisplayName(target)}》` });
        card.createEl('p', { text: '打开创作流程，查看阶段进度与下一件该做的事。' });
        const actions = card.createDiv({ cls: 'nw-home-next-actions' });
        this.actionButton(actions, '🧭 打开创作流程', 'nw-btn-primary', () => {
            void this.plugin.openCreationFlow(target);
        });
        this.actionButton(actions, '🤖 交给 Agent', 'nw-btn-secondary', () => {
            void this.plugin.openAgentWorkbench();
        });
    }

    private renderRecent(host: HTMLElement, projects: string[]): void {
        host.createEl('h3', { text: '最近项目', cls: 'nw-home-section-title' });
        if (projects.length === 0) {
            const empty = host.createDiv({ cls: 'nw-empty-state' });
            empty.createDiv({ cls: 'nw-empty-state-icon', text: '📂' });
            empty.createDiv({ cls: 'nw-empty-state-title', text: '还没有项目' });
            empty.createDiv({ cls: 'nw-empty-state-description', text: '从上方三种模式开始，或导入示例项目。' });
            return;
        }
        const list = host.createDiv({ cls: 'nw-home-recent' });
        const activeProject = this.plugin.getActiveProject();
        const ordered = [...projects].sort((a, b) => {
            if (a === activeProject) return -1;
            if (b === activeProject) return 1;
            return projectDisplayName(a).localeCompare(projectDisplayName(b), 'zh-Hans-CN');
        }).slice(0, 6);
        for (const project of ordered) {
            const mode = modeFromLibraryPath(project);
            const spec = mode ? CREATION_MODE_SPECS[mode] : null;
            const row = list.createDiv({ cls: 'nw-home-recent-row' });
            row.createSpan({ cls: 'nw-home-recent-mode', text: spec?.icon ?? '📁' });
            row.createSpan({ cls: 'nw-home-recent-name', text: projectDisplayName(project) });
            row.createSpan({ cls: 'nw-home-recent-type', text: spec?.label ?? '旧版项目' });
            const open = row.createEl('button', { cls: 'nw-btn nw-btn-secondary', text: '打开' });
            open.addEventListener('click', () => {
                void this.plugin.openCreationFlow(project);
            });
        }
    }

    private actionButton(host: HTMLElement, label: string, cls: string, onClick: () => void): void {
        const button = host.createEl('button', { cls: `nw-btn ${cls}`, text: label });
        button.addEventListener('click', onClick);
    }
}
