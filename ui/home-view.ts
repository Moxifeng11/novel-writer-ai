/**
 * home-view.ts — 创作主页
 *
 * 统一入口：三个创作模式、最近项目、下一步建议、任务中心与项目体检。
 * 原有「项目与章节 / 创作流程 / 句级协同 / Agent」仍保留为子页/深链，
 * 但主 Ribbon 只留主页，避免六个入口都像“开始写作”。
 */
import { ItemView, WorkspaceLeaf } from 'obsidian';
import type NovelWriterPlugin from '@/main';
import {
    CREATION_MODE_SPECS,
    creationModeDisplayDescription,
    creationModeDisplayName,
    creationUnitDisplayLabel,
    type CreationMode,
} from '@/shared/creation-mode';
import { listProjectIds } from '@/shared/project-catalog';
import { modeFromLibraryPath, projectDisplayName } from '@/domains/kernel/project-locator';
import { CommandIds } from '@/shared/command-ids';
import { hasUsableAiCredentials } from '@/shared/ai-credentials';
import { t } from '@/i18n';
import { createEmptyState } from './components/empty-state';

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
    getDisplayText(): string { return t('home.viewTitle'); }

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
        text.createEl('h2', { text: t('home.heroTitle') });
        text.createEl('p', {
            text: projectCount > 0
                ? t('home.heroWithProjects', {
                    count: projectCount,
                    extra: running > 0 ? t('home.heroRunning', { count: running }) : '',
                })
                : t('home.heroEmpty'),
        });
        const actions = hero.createDiv({ cls: 'nw-home-hero-actions' });
        this.actionButton(actions, running > 0 ? t('home.jobCenterCount', { count: running }) : t('home.jobCenter'), 'nw-btn-secondary', () => {
            this.plugin.openJobCenter();
        });
        this.actionButton(actions, t('home.projectHealth'), 'nw-btn-secondary', () => {
            this.plugin.openProjectHealth();
        });
        this.actionButton(actions, t('home.assetRegistry'), 'nw-btn-secondary', () => {
            this.plugin.openAssetRegistry();
        });
        this.actionButton(actions, t('home.planningCanvas'), 'nw-btn-secondary', () => {
            void this.plugin.openPlanningCanvas();
        });
        this.actionButton(actions, t('home.memoryGraph'), 'nw-btn-secondary', () => {
            void this.plugin.openMemoryGraph();
        });
        this.actionButton(actions, t('home.usageLedger'), 'nw-btn-secondary', () => {
            this.plugin.openUsageLedger();
        });
        this.actionButton(actions, t('home.backupCenter'), 'nw-btn-secondary', () => {
            this.plugin.openBackupCenter();
        });
        this.actionButton(actions, t('home.onboarding'), 'nw-btn-secondary', () => {
            this.plugin.openOnboarding();
        });
    }

    private renderModes(host: HTMLElement, projects: string[]): void {
        host.createEl('h3', { text: t('home.start'), cls: 'nw-home-section-title' });
        const grid = host.createDiv({ cls: 'nw-home-mode-grid' });
        for (const mode of MODE_ORDER) {
            const spec = CREATION_MODE_SPECS[mode];
            const modeName = creationModeDisplayName(mode);
            const count = projects.filter(project => modeFromLibraryPath(project) === mode).length;
            const card = grid.createDiv({ cls: 'nw-home-mode-card' });
            card.createDiv({ cls: 'nw-home-mode-icon', text: spec.icon });
            card.createEl('h4', { text: modeName });
            card.createEl('p', { text: creationModeDisplayDescription(mode) });
            card.createDiv({
                cls: 'nw-home-mode-meta',
                text: count > 0
                    ? t('home.modeMeta', { count, unit: creationUnitDisplayLabel(mode) })
                    : t('home.modeMetaEmpty', { mode: modeName }),
            });
            const button = card.createEl('button', {
                cls: 'nw-btn nw-btn-primary',
                text: count > 0 ? t('home.enterMode', { mode: modeName }) : t('home.createMode', { mode: modeName }),
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
        host.createEl('h3', { text: t('home.nextStep'), cls: 'nw-home-section-title' });
        const card = host.createDiv({ cls: 'nw-home-next' });
        const hasKey = hasUsableAiCredentials(this.plugin.settings);

        if (!hasKey) {
            card.createEl('h4', { text: t('home.needKeyTitle') });
            card.createEl('p', { text: t('home.needKeyDesc') });
            this.actionButton(card, t('home.goSettings'), 'nw-btn-primary', () => this.plugin.openPluginSettings());
            return;
        }
        if (projects.length === 0) {
            card.createEl('h4', { text: t('home.noProjectTitle') });
            card.createEl('p', { text: t('home.noProjectDesc') });
            const actions = card.createDiv({ cls: 'nw-home-next-actions' });
            this.actionButton(actions, t('home.importExample'), 'nw-btn-primary', () => {
                void this.plugin.commandUiPort?.executeCommand(CommandIds.IMPORT_EXAMPLE);
            });
            this.actionButton(actions, t('home.newLong'), 'nw-btn-secondary', () => {
                void this.plugin.openFullWriterHome();
            });
            return;
        }

        const target = activeProject && projects.includes(activeProject) ? activeProject : projects[0];
        card.createEl('h4', { text: t('home.continueTitle', { name: projectDisplayName(target) }) });
        card.createEl('p', { text: t('home.continueDesc') });
        const actions = card.createDiv({ cls: 'nw-home-next-actions' });
        this.actionButton(actions, t('home.openFlow'), 'nw-btn-primary', () => {
            void this.plugin.openCreationFlow(target);
        });
        this.actionButton(actions, t('home.handToAgent'), 'nw-btn-secondary', () => {
            void this.plugin.openAgentWorkbench();
        });
    }

    private renderRecent(host: HTMLElement, projects: string[]): void {
        host.createEl('h3', { text: t('home.recent'), cls: 'nw-home-section-title' });
        if (projects.length === 0) {
            host.appendChild(createEmptyState({
                icon: 'folder',
                title: t('home.emptyTitle'),
                description: t('home.emptyDesc'),
            }));
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
            const row = list.createDiv({ cls: 'nw-home-recent-row' });
            row.createSpan({ cls: 'nw-home-recent-mode', text: mode ? CREATION_MODE_SPECS[mode].icon : '📁' });
            row.createSpan({ cls: 'nw-home-recent-name', text: projectDisplayName(project) });
            row.createSpan({ cls: 'nw-home-recent-type', text: mode ? creationModeDisplayName(mode) : t('home.legacyProject') });
            const open = row.createEl('button', { cls: 'nw-btn nw-btn-secondary', text: t('home.open') });
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
