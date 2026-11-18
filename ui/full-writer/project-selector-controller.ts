/**
 * project-selector-controller.ts — 项目选择器控制器
 *
 * 职责：渲染「项目与章节」选择页，包括项目卡片网格、预览面板、章节列表弹窗。
 *
 * 从 full-writer-view.ts 拆分而来，原代码约 320 行。
 * 与现有子模块保持一致的控制器模式：通过 deps 对象注入外部依赖。
 */

import { App, Menu, Modal, Notice, TFile } from 'obsidian';
import { t } from '@/i18n';
import NovelWriterPlugin from '@/main';
import { ContextManager } from '@/engine/context-manager';
import { CoverPickerController } from './cover-picker-controller';
import { renderQuickToolsPanel, type ProjectQuickAction } from './quick-tools-panel';
import { WritingStyleModal } from '@/ui/writing-style-modal';
import { CreateProjectModal } from '@/ui/create-project-modal';
import { PreResearchModal } from '@/ui/pre-research-modal';
import { ModeDocumentModal } from '@/ui/mode-document-modal';
import { getToolCatalogForMode, getToolGroupsForMode, getModeToolTitle } from '@/domains/kernel/tool-catalog-aggregator';
import type { CreationMode } from '@/shared/creation-mode';
import { collectCreationFlowState } from './creation-flow-state';
import { buildNextStepPlan, type NextStepPlan } from './next-step';
import { formatRecentLabel, pruneMissingProjects, recordProjectOpened, sortProjectsByRecent } from './recent-projects';
import type { CreationFlowSnapshot } from '@/shared/creation-flow';
import { findNextModeUnit, listModeUnits, modeUnitLabel } from '@/shared/mode-content';
import { projectDisplayName } from '@/domains/kernel/project-locator';
import { RenameProjectModal } from '@/ui/rename-project-modal';
import { OperationConfirmModal } from '@/ui/components/progress';
import {
    getProjectCover,
    getProjectMeta,
    getChaptersForProject,
    scanProjectChapters,
    sortChaptersByNumber,
    getNextChapter,
    deleteProject,
} from '@/ui/project-utils';

import { createLogger } from '@/shared/logger';

const log = createLogger('ProjectSelectorController');

type ProjectMeta = Awaited<ReturnType<typeof getProjectMeta>>;

/**
 * 章节条目结构定义。
 */
export type ChapterItem = {
    chapter: string;
    volume: string;
    title: string;
    status: string;
    /** 正文文件；仅有骨架时为空 */
    file: TFile | null;
    /** 长篇章节来自 scanProjectChapters 时携带；流程摘要复用 */
    written?: boolean;
};

/**
 * 内部文件名仍是「第N章」；短篇/剧本展示时映射为节/集
 *
 * @param text - 文本内容
 * @param unitLabel - 单元标签
 * @returns 文本结果
 */
function formatUnitDisplay(text: string, unitLabel: string): string {
    if (unitLabel === '章') return text;
    return text.replace(/第(\d+)章/g, `第$1${unitLabel}`);
}

/**
 * ProjectSelectorDeps 类型定义。
 */
export interface ProjectSelectorDeps {
    getContextManager: () => ContextManager;
    getCoverPicker: () => CoverPickerController;
    onSelectChapter: (project: string, chapter: ChapterItem) => Promise<void>;
    onOpenWizard: (project: string) => Promise<void>;
    onOpenCoWriting: (project: string, chapter: ChapterItem) => Promise<void>;
    /** 短篇/剧本：打开单元写作工作台（优先于直接打开 Markdown 文件） */
    onOpenUnit?: (project: string, mode: CreationMode, unitNumber: number) => void | Promise<void>;
    /** 右侧流程摘要的「查看完整流程」 */
    onOpenFlow?: (project: string) => void | Promise<void>;
    onAddFanficSetting?: (project: string) => void;
    onDeleteProject?: () => void;
    /** 右侧项目卡片选中变化：用于把「当前项目」同步给命令层（快捷工具无 activeFile） */
    onProjectSelected?: (project: string | null) => void;
    executeCommand: (commandId: string) => void;
}

/**
 * ProjectSelectorController 类。
 */
export class ProjectSelectorController {
    private app: App;
    private plugin: NovelWriterPlugin;
    private deps: ProjectSelectorDeps;

    private cleanup: (() => void) | null = null;
    private selectedProject: string | null = null;
    private selectedMode: CreationMode = 'long';
    private container: HTMLElement | null = null;
    private projectGrid: HTMLElement | null = null;
    private projectArea: HTMLElement | null = null;
    private rightPanel: HTMLElement | null = null;
    private highlightedProject: string | null = null;

    constructor(app: App, plugin: NovelWriterPlugin, deps: ProjectSelectorDeps) {
        this.app = app;
        this.plugin = plugin;
        this.deps = deps;
    }

    /**
     * refresh 方法。
     * @param maxRetries - 最大重试次数
     */
    async refresh(maxRetries = 0): Promise<void> {
        if (!this.container) return;
        await this.render(this.container);
        // 高亮未命中时最多再渲染一次（旧实现默认重试 2 次，大库开页会连渲 3 遍）。
        if (this.highlightedProject && maxRetries > 0) {
            const hasProject = this.projectGrid?.querySelector(`[data-project="${this.highlightedProject}"]`);
            if (!hasProject) {
                await new Promise(r => setTimeout(r, 200));
                await this.render(this.container);
            }
        }
    }

    /**
     * highlightProject 方法。
     * @param projectName - 项目名
     */
    async highlightProject(projectName: string): Promise<void> {
        this.highlightedProject = projectName;
        if (this.container) {
            await this.render(this.container);
        }
        requestAnimationFrame(() => {
            const card = this.projectGrid?.querySelector(`[data-project="${projectName}"]`);
            if (card && card instanceof HTMLElement) {
                card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                card.classList.add('novel-writer-fw-project-card-highlight');
                setTimeout(() => {
                    card.classList.remove('novel-writer-fw-project-card-highlight');
                }, 2000);
            }
        });
    }

    /**
     * 渲染项目选择器到指定容器
     *
     * 布局：左侧项目卡片网格（自适应），右侧常驻快捷工具面板。
     * 工具不再藏在弹窗里，分类功能一屏可见。
     */
    /**
     * 左侧分类导航：长篇小说 / 短篇小说 / 剧本。
     * 三类项目只在本分类下展示，切换后右侧工具同步切换。
     */
    private renderModeNav(
        container: HTMLElement,
        projects: string[],
        modeOf: Map<string, CreationMode>
    ): void {
        container.empty();
        container.createDiv({ text: t('fullwriter.selector.modeNavTitle'), cls: 'novel-writer-fw-mode-nav-title' });
        const modes: Array<{ mode: CreationMode; label: string; icon: string }> = [
            { mode: 'long', label: t('settings.mode.spec.long.label'), icon: '📖' },
            { mode: 'short', label: t('settings.mode.spec.short.label'), icon: '📄' },
            { mode: 'script', label: t('settings.mode.spec.script.label'), icon: '🎬' },
        ];
        for (const item of modes) {
            const count = projects.filter(p => (modeOf.get(p) || 'long') === item.mode).length;
            const btn = container.createEl('button', {
                cls: `novel-writer-fw-mode-nav-btn${this.selectedMode === item.mode ? ' is-active' : ''}`,
                attr: { type: 'button', 'aria-pressed': String(this.selectedMode === item.mode) },
            });
            btn.createSpan({ text: item.icon, cls: 'novel-writer-fw-mode-nav-icon' });
            btn.createSpan({ text: item.label, cls: 'novel-writer-fw-mode-nav-label' });
            btn.createSpan({ text: String(count), cls: 'novel-writer-fw-mode-nav-count' });
            btn.onclick = () => {
                if (this.selectedMode === item.mode) return;
                this.selectedMode = item.mode;
                this.selectedProject = null;
                if (this.container) void this.render(this.container);
            };
        }
    }

    /**
     * 项目单元列表。传入 unitsCache 时复用本次渲染已算好的结果
     * （卡片 / 右侧详情 / 快捷工具会重复问同一项目的章节）。
     */
    private getUnitsForProject(
        project: string,
        mode: CreationMode,
        unitsCache?: Map<string, ChapterItem[]>,
    ): ChapterItem[] {
        const cached = unitsCache?.get(project);
        if (cached) return cached;
        const units = mode === 'long'
            ? sortChaptersByNumber(getChaptersForProject(this.app, project))
            : listModeUnits(this.app, project, mode).map(unit => ({
                chapter: unit.unitName,
                volume: '',
                title: unit.title,
                status: unit.status,
                file: unit.file,
            }));
        unitsCache?.set(project, units);
        return units;
    }

    /**
     * 记录项目「最近使用」时间并异步落盘。
     *
     * @param project - 项目 id
     */
    private noteProjectOpened(project: string): void {
        if (!project) return;
        const map = this.plugin.settings.projectLastOpened ?? {};
        recordProjectOpened(map, project);
        this.plugin.settings.projectLastOpened = map;
        void this.plugin.saveSettings();
    }

    private async openUnit(project: string, mode: CreationMode, unit: ChapterItem | null): Promise<void> {
        this.noteProjectOpened(project);
        if (!unit) {
            new Notice(
                mode === 'long'
                    ? t('fullwriter.selector.noChaptersWizard')
                    : t('fullwriter.selector.noSkeleton', { unit: modeUnitLabel(mode) }),
                5000,
            );
            if (mode !== 'long' && this.deps.onOpenFlow) await this.deps.onOpenFlow(project);
            return;
        }
        if (mode === 'long') {
            await this.deps.onSelectChapter(project, unit);
            return;
        }
        const unitNumber = parseInt(unit.chapter.match(/第\s*(\d+)/)?.[1] || '0', 10);
        if (this.deps.onOpenUnit && unitNumber > 0) {
            await this.deps.onOpenUnit(project, mode, unitNumber);
            return;
        }
        if (unit.file) {
            await this.app.workspace.getLeaf(false).openFile(unit.file);
        } else {
            new Notice(t('fullwriter.selector.bodyFileNotFound'), 4000);
        }
    }

    /**
     * 渲染。
     * @param container - 容器元素
     */
    async render(container: HTMLElement): Promise<void> {
        if (this.cleanup) {
            this.cleanup();
            this.cleanup = null;
        }
        this.container = container;
        container.empty();

        const wrapper = container.createDiv({ cls: 'novel-writer-fw-selector-layout' });

        const modeNav = wrapper.createDiv({ cls: 'novel-writer-fw-mode-nav' });
        const projectArea = wrapper.createDiv({ cls: 'novel-writer-fw-project-area' });
        this.projectArea = projectArea;

        const rightPanel = wrapper.createDiv({ cls: 'novel-writer-fw-right-panel' });
        this.rightPanel = rightPanel;

        const contextManager = this.deps.getContextManager();
        const allProjects = await contextManager.detectProjects();
        /** 本次渲染的项目元信息与单元列表缓存：卡片/详情/快捷工具共用，避免重复读文件与重复全库扫描 */
        const metaOf = new Map<string, ProjectMeta>();
        const unitsCache = new Map<string, ChapterItem[]>();
        // PF-5：项目元信息要读分卷大纲，旧实现每个项目都全库 getFiles() 一次。
        // 整页渲染只取一份快照，所有项目/右侧面板复用（vault 在渲染期间不会变）。
        const files = this.app.vault.getFiles();
        await Promise.all(allProjects.map(async (project) => {
            try {
                metaOf.set(project, await getProjectMeta(this.app, project, files));
            } catch {
                // 元信息读不到的项目按长篇默认归类；卡片渲染处会再取一次（与旧行为一致）
            }
        }));
        const modeOf = new Map<string, CreationMode>();
        for (const project of allProjects) {
            modeOf.set(project, metaOf.get(project)?.creationMode || 'long');
        }
        // 长篇章节一次扫描产出全部项目（旧实现每项目各遍历一次全库）；
        // P2-3：复用整页 files 快照，且只在当前分类为长篇时扫描。
        const longProjects = allProjects.filter(project => (modeOf.get(project) || 'long') === 'long');
        const chapterScan = this.selectedMode === 'long'
            ? scanProjectChapters(this.app, longProjects, files)
            : new Map<string, ChapterItem[]>();
        for (const project of longProjects) {
            unitsCache.set(project, chapterScan.get(project) || []);
        }
        // P2-3：短篇/剧本也预填单元缓存（同一份 files 快照，避免每张卡片再 getFiles）。
        for (const project of allProjects) {
            const mode = modeOf.get(project) || 'long';
            if (mode === 'long') continue;
            unitsCache.set(project, listModeUnits(this.app, project, mode, files).map(unit => ({
                chapter: unit.unitName,
                volume: '',
                title: unit.title,
                status: unit.status,
                file: unit.file,
            })));
        }

        // 从外部高亮某个项目时，自动切到它所属的分类
        if (this.highlightedProject && allProjects.includes(this.highlightedProject)) {
            this.selectedMode = modeOf.get(this.highlightedProject) || 'long';
        }

        // B1：清掉已删除项目的幽灵记录（否则会占用最近名额）
        const pruned = pruneMissingProjects(this.plugin.settings.projectLastOpened, allProjects);
        if (pruned.changed) {
            this.plugin.settings.projectLastOpened = pruned.map;
            void this.plugin.saveSettings();
        }

        this.renderModeNav(modeNav, allProjects, modeOf);
        // B1（2026-11-16）：项目按「最近使用」排序，没有记录的保持原顺序
        const projects = sortProjectsByRecent(
            allProjects.filter(project => (modeOf.get(project) || 'long') === this.selectedMode),
            this.plugin.settings.projectLastOpened,
        );

        if (this.selectedProject && !projects.includes(this.selectedProject)) {
            this.selectedProject = null;
        }
        // 首次进入 / 视图重建后默认选中当前分类下的一个项目
        if (!this.selectedProject && projects.length > 0) {
            const preferred = this.highlightedProject && projects.includes(this.highlightedProject)
                ? this.highlightedProject
                : this.plugin.getActiveProject();
            this.selectedProject = preferred && projects.includes(preferred) ? preferred : projects[0];
        }
        this.deps.onProjectSelected?.(this.selectedProject);
        await this.renderRightPanel(unitsCache, metaOf, files);

        const modeLabel = t(`settings.mode.spec.${this.selectedMode}.label`);
        const toolbar = projectArea.createDiv({ cls: 'novel-writer-fw-project-toolbar' });
        const toolbarInfo = toolbar.createDiv({ cls: 'novel-writer-fw-project-toolbar-info' });
        toolbarInfo.createSpan({ text: modeLabel, cls: 'novel-writer-fw-project-toolbar-title' });
        toolbarInfo.createSpan({ text: t('fullwriter.selector.projectCount', { count: projects.length }), cls: 'novel-writer-fw-project-toolbar-count' });
        const toolbarActions = toolbar.createDiv({ cls: 'novel-writer-fw-project-toolbar-actions' });

        const agentBtn = toolbarActions.createEl('button', {
            text: t('fullwriter.selector.agentBtn'),
            cls: 'novel-writer-fw-toolbar-btn is-primary',
            attr: { type: 'button', title: t('fullwriter.selector.agentBtnTip') },
        });
        agentBtn.onclick = () => {
            void this.plugin.openAgentWorkbench();
        };

        const createBtn = toolbarActions.createEl('button', {
            text: t('fullwriter.selector.newBtn', { mode: modeLabel }),
            cls: 'novel-writer-fw-toolbar-btn',
            attr: { type: 'button', title: this.selectedMode === 'long' ? t('fullwriter.selector.newLongTip') : t('fullwriter.selector.newResearchTip') },
        });
        createBtn.onclick = () => {
            if (this.selectedMode === 'short') new PreResearchModal(this.app, this.plugin, 'short').open();
            else if (this.selectedMode === 'script') new PreResearchModal(this.app, this.plugin, 'script').open();
            else new CreateProjectModal(this.app, this.plugin).open();
        };

        if (projects.length === 0) {
            const emptyState = projectArea.createDiv({ cls: 'novel-writer-fw-empty-state' });
            const heroCard = emptyState.createDiv({ cls: 'novel-writer-fw-hero-card' });
            const spec = this.selectedMode === 'short' ? '📄' : this.selectedMode === 'script' ? '🎬' : '📖';
            const label = t(`settings.mode.spec.${this.selectedMode}.label`);
            heroCard.createDiv({ text: spec, cls: 'novel-writer-fw-hero-icon' });
            heroCard.createEl('h2', { text: t('fullwriter.selector.heroTitle', { mode: label }), cls: 'novel-writer-fw-hero-title' });
            heroCard.createEl('p', {
                text: this.selectedMode === 'short'
                    ? t('fullwriter.selector.heroShortDesc')
                    : this.selectedMode === 'script'
                        ? t('fullwriter.selector.heroScriptDesc')
                        : t('fullwriter.selector.heroLongDesc'),
                cls: 'novel-writer-fw-hero-desc',
            });
            const create = heroCard.createEl('button', {
                text: t('fullwriter.selector.newBtn', { mode: label }),
                cls: 'novel-writer-fw-hero-btn',
            });
            create.onclick = () => {
                if (this.selectedMode === 'short') new PreResearchModal(this.app, this.plugin, 'short').open();
                else if (this.selectedMode === 'script') new PreResearchModal(this.app, this.plugin, 'script').open();
                else new CreateProjectModal(this.app, this.plugin).open();
            };
            if (this.selectedMode === 'long') {
                const agentBtn = heroCard.createEl('button', {
                    text: t('fullwriter.selector.agentCreateBtn'),
                    cls: 'novel-writer-fw-hero-btn novel-writer-fw-hero-btn-secondary',
                    attr: { title: t('fullwriter.selector.agentCreateTip') },
                });
                agentBtn.onclick = () => {
                    void this.plugin.openAgentWorkbench();
                };
            }
            return;
        }

        const projectGrid = projectArea.createDiv({ cls: 'novel-writer-fw-project-grid' });
        this.projectGrid = projectGrid;

        for (const project of projects) {
            const card = projectGrid.createDiv({ cls: 'novel-writer-fw-project-card' });
            card.setAttr('data-project', project);
            // 重渲染后恢复选中态，避免右侧显示详情但卡片无高亮
            if (project === this.selectedProject) card.classList.add('selected');

            const coverArea = card.createDiv({ cls: 'novel-writer-fw-cover-area' });
            const coverUrl = getProjectCover(this.app, project);
            if (coverUrl) {
                coverArea.createEl('img', { attr: { src: coverUrl } });
            } else {
                const placeholder = coverArea.createDiv({ cls: 'novel-writer-fw-cover-placeholder' });
                placeholder.createSpan({ text: '📷', cls: 'icon' });
                placeholder.createSpan({ text: t('fullwriter.selector.addCover'), cls: 'text' });
            }
            coverArea.setAttr('title', coverUrl ? t('fullwriter.selector.changeCover') : t('fullwriter.selector.addCoverTitle'));
            coverArea.onclick = (e) => {
                e.stopPropagation();
                this.deps.getCoverPicker().openCoverPicker(project, coverArea);
            };

            const info = card.createDiv({ cls: 'novel-writer-fw-card-info-inner' });

            const nameRow = info.createDiv({ cls: 'novel-writer-fw-card-name-row' });
            nameRow.createDiv({ text: `📖 ${projectDisplayName(project)}`, cls: 'novel-writer-fw-card-name' });
            if (project === this.highlightedProject) {
                nameRow.createSpan({ text: t('fullwriter.selector.newBadge'), cls: 'novel-writer-fw-card-new-badge' });
            }

            const metaRow = info.createDiv({ cls: 'novel-writer-fw-card-meta' });
            let meta = metaOf.get(project);
            if (!meta) meta = await getProjectMeta(this.app, project, files);
            const modeText = meta.creationMode === 'long' ? '' : `${meta.creationModeLabel} · `;
            const categoryText = meta.shortCategory || meta.scriptGenre;
            metaRow.createSpan({ text: `${modeText}${categoryText || meta.genre}`.trim(), cls: 'novel-writer-fw-card-genre g0' });
            if (meta.storyStructureName) {
                metaRow.createSpan({ text: `🧬 ${meta.storyStructureName}`, cls: 'novel-writer-fw-card-structure' });
            }

            const sortedChapters = this.getUnitsForProject(project, meta.creationMode, unitsCache);
            const writtenChapters = sortedChapters.filter(c => c.status === 'written' || c.status === 'settled');

            metaRow.createSpan({ text: `${sortedChapters.length}${meta.unitLabel}`, cls: 'novel-writer-fw-card-count-badge' });
            // B1：显示「最近使用」时间，让排序结果可解释（否则用户不知道为何是这个顺序）
            const recentLabel = formatRecentLabel(this.plugin.settings.projectLastOpened?.[project]);
            if (recentLabel) {
                metaRow.createSpan({
                    text: recentLabel,
                    cls: 'novel-writer-fw-card-recent',
                    attr: { title: t('fullwriter.selector.lastOpenedTitle') },
                });
            }

            if (sortedChapters.length > 0) {
                const progressPct = meta.totalChapters > 0
                    ? Math.round((writtenChapters.length / meta.totalChapters) * 100)
                    : Math.round((writtenChapters.length / Math.max(sortedChapters.length, 1)) * 100);
                info.createDiv({ text: t('fullwriter.selector.cardProgress', { done: writtenChapters.length, total: meta.totalChapters || sortedChapters.length, unit: meta.unitLabel }), cls: 'novel-writer-fw-card-progress-text' });
                const progressBar = info.createDiv({ cls: 'novel-writer-fw-card-progress-bar' });
                progressBar.createDiv({
                    cls: 'novel-writer-fw-card-progress-fill',
                    attr: { style: `width: ${progressPct}%;` }
                });
            }

            const nextChapter = getNextChapter(sortedChapters);
            if (nextChapter) {
                const isPending = nextChapter.status !== 'written' && nextChapter.status !== 'settled';
                info.createDiv({
                    text: t(isPending ? 'fullwriter.selector.cardNextPending' : 'fullwriter.selector.cardNextLatest', { unit: meta.unitLabel, chapter: nextChapter.chapter, title: nextChapter.title || t('fullwriter.selector.untitled') }),
                    cls: 'novel-writer-fw-card-latest'
                });
            }

            const actions = card.createDiv({ cls: 'novel-writer-fw-card-actions' });
            if (meta.creationMode === 'long') {
                const wizardBtn = actions.createEl('button', { text: t('fullwriter.selector.wizardBtn'), cls: 'novel-writer-fw-card-action-btn' });
                wizardBtn.setAttribute('title', t('fullwriter.selector.wizardBtnTip'));
                wizardBtn.onclick = async (e: MouseEvent) => {
                    e.stopPropagation();
                    this.noteProjectOpened(project);
                    await this.deps.onOpenWizard(project);
                };
            } else {
                const researchBtn = actions.createEl('button', { text: t('fullwriter.selector.researchBtn'), cls: 'novel-writer-fw-card-action-btn' });
                researchBtn.setAttribute('title', t('fullwriter.selector.researchBtnTip'));
                researchBtn.onclick = (e: MouseEvent) => {
                    e.stopPropagation();
                    this.noteProjectOpened(project);
                    new PreResearchModal(this.app, this.plugin, meta.creationMode as 'short' | 'script', { project }).open();
                };
            }

            const openBtn = actions.createEl('button', { text: t('fullwriter.selector.writeBtn'), cls: 'novel-writer-fw-card-action-btn secondary' });
            openBtn.onclick = async (e: MouseEvent) => {
                e.stopPropagation();
                await this.openUnit(project, meta.creationMode, nextChapter);
            };

            if (meta.creationMode === 'long') {
                const cowriteBtn = actions.createEl('button', { text: t('fullwriter.selector.cowriteBtn'), cls: 'novel-writer-fw-card-action-btn secondary' });
                cowriteBtn.setAttribute('title', t('fullwriter.selector.cowriteBtnTip'));
                cowriteBtn.onclick = async (e: MouseEvent) => {
                    e.stopPropagation();
                    if (nextChapter) {
                        this.noteProjectOpened(project);
                        await this.deps.onOpenCoWriting(project, nextChapter);
                    } else {
                        new Notice(t('fullwriter.selector.noChaptersNotice'), 4000);
                    }
                };
            }

            // E1（2026-11-16）：低频动作收进「⋯」菜单。
            // 常驻只留「向导/调研 + 写作 + 句级协同」；删除/重命名不再裸露在卡片上。
            const moreBtn = actions.createEl('button', {
                text: '⋯',
                cls: 'novel-writer-fw-card-action-btn secondary novel-writer-fw-card-more-btn',
                attr: { title: t('fullwriter.selector.moreActions') },
            });
            moreBtn.onclick = (e: MouseEvent) => {
                e.stopPropagation();
                const menu = new Menu();
                menu.addItem(item => item
                    .setTitle(meta.creationMode === 'long' ? t('fullwriter.selector.allChaptersTitle') : t('fullwriter.selector.allUnitsTitle', { unit: meta.unitLabel }))
                    .onClick(() => this.showAllChapters(project, sortedChapters, meta.unitLabel, meta.creationMode !== 'long')));
                menu.addItem(item => item
                    .setTitle(coverUrl ? t('fullwriter.selector.menuChangeCover') : t('fullwriter.selector.menuAddCover'))
                    .onClick(() => this.deps.getCoverPicker().openCoverPicker(project, coverArea)));
                menu.addItem(item => item
                    .setTitle(t('fullwriter.selector.menuRename'))
                    .onClick(() => this.openRenameProject(project)));
                menu.addSeparator();
                menu.addItem(item => item
                    .setTitle(t('fullwriter.selector.menuDelete'))
                    .onClick(() => this.showDeleteProjectModal(project)));
                menu.showAtMouseEvent(e);
            };

            card.onclick = () => {
                const isSelected = card.classList.contains('selected');
                projectGrid.querySelectorAll('.novel-writer-fw-project-card.selected').forEach(c => c.classList.remove('selected'));
                if (isSelected) {
                    this.selectedProject = null;
                } else {
                    card.classList.add('selected');
                    this.selectedProject = project;
                    // B1：选中即视为「最近使用」，下次进入按此排序
                    this.noteProjectOpened(project);
                }
                this.deps.onProjectSelected?.(this.selectedProject);
                // P-3：卡片点击复用整页快照，不再为一个项目重扫全库
                void this.renderRightPanel(unitsCache, metaOf, files);
            };
        }
    }

    /** 右侧面板 = 选中项目概览 + 按项目类型切换的快捷工具 */
    private async renderRightPanel(
        unitsCache?: Map<string, ChapterItem[]>,
        metaOf?: Map<string, ProjectMeta>,
        files?: TFile[],
    ): Promise<void> {
        const panel = this.rightPanel;
        if (!panel) return;
        panel.empty();

        const project = this.selectedProject;
        let mode: CreationMode = this.selectedMode;
        let meta: Awaited<ReturnType<typeof getProjectMeta>> | undefined;
        if (project) {
            // PF-5：复用 render() 已算好的元信息与文件快照，不再为选中项目重扫一遍
            meta = metaOf?.get(project) ?? await getProjectMeta(this.app, project, files);
            mode = meta.creationMode;
            this.selectedMode = mode;
            // D2（2026-11-16）：流程快照只采集一次，供「下一步」主操作卡与流程摘要共用
            const snapshot = await this.collectSnapshotSafe(project, mode, unitsCache?.get(project));
            this.renderNextStepCard(panel, project, mode, snapshot, unitsCache);
            await this.renderProjectDetail(panel, project, meta, unitsCache);
            this.renderFlowSummary(panel, snapshot);
        } else {
            const hint = panel.createDiv({ cls: 'nw-qt-empty-hint' });
            hint.createDiv({ text: t('fullwriter.selector.qtEmptyTitle'), cls: 'nw-qt-empty-title' });
            hint.createDiv({ text: t('fullwriter.selector.qtEmptyDesc'), cls: 'nw-qt-empty-desc' });
        }

        const catalog = getToolCatalogForMode(mode);
        renderQuickToolsPanel(panel, {
            executeCommand: (commandId) => this.deps.executeCommand(commandId),
            project,
            projectActions: project && meta ? this.buildProjectActions(project, mode, meta, unitsCache) : undefined,
            toolGroups: catalog.groups,
            title: getModeToolTitle(mode),
        });

        // G3-3：被模式规则过滤掉的按钮不再静默消失，明确告知「这个模式没有这些动作」
        if (catalog.hiddenLabels.length > 0) {
            const hint = panel.createDiv({ cls: 'nw-qt-empty-hint' });
            const shown = catalog.hiddenLabels.slice(0, 4).join('、');
            const more = catalog.hiddenLabels.length > 4 ? t('fullwriter.selector.qtMore', { count: catalog.hiddenLabels.length }) : '';
            hint.createDiv({ text: t('fullwriter.selector.qtUnsupportedTitle'), cls: 'nw-qt-empty-title' });
            hint.createDiv({
                text: t('fullwriter.selector.qtUnsupportedDesc', { shown, more }),
                cls: 'nw-qt-empty-desc',
            });
        }
    }

    /**
     * 采集流程快照（失败时返回 null，不阻塞右栏渲染）。
     *
     * @param project - 项目 id
     * @param mode - 创作模式
     * @param chapters - 长篇已扫描章节（复用，避免重复全库扫描）
     * @returns 快照或 null
     */
    private async collectSnapshotSafe(
        project: string,
        mode: CreationMode,
        chapters?: ChapterItem[],
    ): Promise<CreationFlowSnapshot | null> {
        try {
            return (await collectCreationFlowState(this.app, project, {
                mode,
                longChapters: mode === 'long' ? chapters : undefined,
            })).snapshot;
        } catch {
            return null;
        }
    }

    /**
     * 「下一步」主操作卡（D2）：按项目真实状态推演下一步并给一键入口。
     *
     * 与「创作流程」页签同一套事实源（shared/creation-flow 快照），
     * 因此卡片上的「下一步」与流程页的阶段高亮永远一致。
     *
     * @param panel - 右栏容器
     * @param project - 项目 id
     * @param mode - 创作模式
     * @param snapshot - 流程快照
     * @param unitsCache - 章节缓存
     */
    private renderNextStepCard(
        panel: HTMLElement,
        project: string,
        mode: CreationMode,
        snapshot: CreationFlowSnapshot | null,
        unitsCache?: Map<string, ChapterItem[]>,
    ): void {
        const plan = buildNextStepPlan(snapshot);
        if (!plan) return;
        const chapters = this.getUnitsForProject(project, mode, unitsCache);
        const card = panel.createDiv({ cls: 'nw-next-step' });
        const head = card.createDiv({ cls: 'nw-next-step-head' });
        head.createSpan({
            cls: 'nw-next-step-kicker',
            text: plan.allDone ? t('fullwriter.selector.flowDone') : t('fullwriter.selector.flowNext'),
        });
        head.createSpan({ cls: 'nw-next-step-percent', text: `${plan.percent}%` });
        card.createDiv({ cls: 'nw-next-step-title', text: plan.title });
        card.createDiv({ cls: 'nw-next-step-desc', text: plan.description });
        const actions = card.createDiv({ cls: 'nw-next-step-actions' });
        const cta = actions.createEl('button', {
            cls: 'nw-btn nw-btn-primary',
            text: plan.ctaLabel,
        });
        cta.onclick = () => this.dispatchNextStep(project, mode, plan, chapters);
        const flowLink = actions.createEl('button', {
            cls: 'nw-btn nw-btn-secondary',
            text: t('fullwriter.selector.flowViewAll'),
        });
        flowLink.onclick = () => { void this.deps.onOpenFlow?.(project); };
    }

    /**
     * 执行「下一步」主操作卡的动作。
     *
     * 动作语义与创作流程页签一致（同一套 CreationFlowAction），
     * 因此从首页点进来和从流程页点进去效果相同。
     *
     * @param project - 项目 id
     * @param mode - 创作模式
     * @param plan - 主操作卡数据
     * @param chapters - 已扫描章节
     */
    private dispatchNextStep(
        project: string,
        mode: CreationMode,
        plan: NextStepPlan,
        chapters: ChapterItem[],
    ): void {
        this.noteProjectOpened(project);
        switch (plan.action) {
            case 'wizard':
                void this.deps.onOpenWizard(project);
                return;
            case 'research':
                if (mode === 'long') return;
                new PreResearchModal(this.app, this.plugin, mode === 'short' ? 'short' : 'script', { project }).open();
                return;
            case 'document': {
                const kind = plan.stageId === 'bible'
                    ? (mode === 'short' ? 'storyCore' : 'bible')
                    : plan.stageId === 'storyboard'
                        ? 'storyboard'
                        : plan.stageId === 'outline'
                            ? 'outline'
                            : (mode === 'short' ? 'storyCore' : 'bible');
                new ModeDocumentModal(this.app, this.plugin, mode === 'long' ? 'short' : mode, kind as 'storyCore' | 'bible' | 'outline' | 'storyboard', project).open();
                return;
            }
            case 'create-units':
                this.deps.executeCommand('novel-writer-batch-create');
                return;
            case 'write-unit': {
                const target = chapters.find(chapter => chapter.chapter.includes(String(plan.unitNumber ?? '')))
                    ?? getNextChapter(chapters);
                void this.openUnit(project, mode, target ?? null);
                return;
            }
            case 'settle':
                this.deps.executeCommand('novel-writer-chapter-settlement');
                return;
            case 'export':
                this.deps.executeCommand('novel-writer-export-manuscript');
                return;
            default:
                void this.deps.onOpenFlow?.(project);
        }
    }

    /**
     * 右侧流程摘要：项目进行到哪、整体百分比、各阶段状态。
     *
     * @param panel - 右栏容器
     * @param snapshot - 流程快照（由 renderRightPanel 统一采集）
     */
    private renderFlowSummary(panel: HTMLElement, snapshot: CreationFlowSnapshot | null): void {
        if (!snapshot || snapshot.stages.length === 0) return;

        const card = panel.createDiv({ cls: 'nw-flow-summary' });
        const head = card.createDiv({ cls: 'nw-flow-summary-head' });
        head.createSpan({ cls: 'nw-flow-summary-title', text: t('fullwriter.selector.flowTitle') });
        head.createSpan({ cls: 'nw-flow-summary-percent', text: `${Math.round(snapshot.overallRatio * 100)}%` });

        const bar = card.createDiv({ cls: 'nw-flow-bar' });
        const fill = bar.createDiv({ cls: 'nw-flow-bar-fill' });
        fill.style.setProperty('width', `${Math.round(snapshot.overallRatio * 100)}%`);

        const dots = card.createDiv({ cls: 'nw-flow-summary-stages' });
        for (const stage of snapshot.stages) {
            const dot = dots.createSpan({
                cls: `nw-flow-dot nw-is-${stage.state}`,
                attr: { title: `${stage.label} · ${stage.progressText}` },
            });
            dot.setText(stage.state === 'done' ? '✓' : '');
        }

        const next = snapshot.stages.find(stage => stage.id === snapshot.nextStageId);
        card.createDiv({
            cls: 'nw-flow-summary-next',
            text: next
                ? t('fullwriter.selector.flowStageProgress', { stage: next.label, progress: next.progressText })
                : t('fullwriter.selector.flowAllDone', { unit: snapshot.unitLabel }),
        });
    }

    private buildProjectActions(
        project: string,
        mode: CreationMode,
        meta: Awaited<ReturnType<typeof getProjectMeta>>,
        unitsCache?: Map<string, ChapterItem[]>,
    ): ProjectQuickAction[] {
        const chapters = this.getUnitsForProject(project, mode, unitsCache);
        const nextChapter = getNextChapter(chapters);
        const unit = meta.unitLabel;

        if (mode === 'long') {
            return [
                {
                    label: t('fullwriter.selector.qtWizard'), icon: '🧙', primary: true,
                    desc: t('fullwriter.selector.qtWizardDesc'),
                    onClick: () => { void this.deps.onOpenWizard(project); },
                },
                {
                    label: t('fullwriter.selector.qtContinueWrite'), icon: '✍️',
                    desc: t('fullwriter.selector.qtContinueWriteDesc'),
                    onClick: () => {
                        if (nextChapter) void this.deps.onSelectChapter(project, nextChapter);
                        else new Notice(t('fullwriter.selector.noChaptersNotice'), 4000);
                    },
                },
                {
                    label: t('fullwriter.selector.qtAllChapters'), icon: '📖',
                    desc: t('fullwriter.selector.qtAllChaptersDesc'),
                    onClick: () => this.showAllChapters(project, chapters, unit),
                },
                {
                    label: t('fullwriter.selector.qtStyle'), icon: '🖋️',
                    desc: t('fullwriter.selector.qtStyleDesc'),
                    onClick: () => { new WritingStyleModal(this.app, this.plugin, project).open(); },
                },
                {
                    label: t('fullwriter.selector.qtFanfic'), icon: '📚',
                    desc: t('fullwriter.selector.qtFanficDesc'),
                    onClick: () => {
                        if (this.deps.onAddFanficSetting) this.deps.onAddFanficSetting(project);
                        else this.deps.executeCommand('novel-writer-add-fanfic');
                    },
                },
                {
                    label: t('fullwriter.selector.qtRename'), icon: '✏️',
                    desc: t('fullwriter.selector.qtRenameDesc'),
                    onClick: () => this.openRenameProject(project),
                },
                {
                    label: t('fullwriter.selector.qtDelete'), icon: '🗑️',
                    desc: t('fullwriter.selector.qtDeleteDesc'),
                    onClick: () => this.showDeleteProjectModal(project),
                },
            ];
        }

        const researchMode = mode === 'short' ? 'short' : 'script';
        return [
            {
                label: t('fullwriter.selector.qtResearch'), icon: '📚', primary: true,
                desc: mode === 'short'
                    ? t('fullwriter.selector.qtResearchShortDesc')
                    : t('fullwriter.selector.qtResearchScriptDesc'),
                onClick: () => {
                    new PreResearchModal(this.app, this.plugin, researchMode, { project }).open();
                },
            },
            {
                label: t('fullwriter.selector.qtContinueWrite'), icon: '✍️',
                desc: t('fullwriter.selector.qtContinueUnitDesc', { unit }),
                onClick: () => {
                    void this.openUnit(project, mode, nextChapter);
                },
            },
            mode === 'short'
                ? {
                    label: t('fullwriter.selector.qtStoryCore'), icon: '📖',
                    desc: t('fullwriter.selector.qtStoryCoreDesc'),
                    onClick: () => { new ModeDocumentModal(this.app, this.plugin, 'short', 'storyCore', project).open(); },
                }
                : {
                    label: t('fullwriter.selector.qtSceneBible'), icon: '🎭',
                    desc: t('fullwriter.selector.qtSceneBibleDesc'),
                    onClick: () => { new ModeDocumentModal(this.app, this.plugin, 'script', 'bible', project).open(); },
                },
            mode === 'short'
                ? {
                    label: t('fullwriter.selector.qtSectionOutline'), icon: '📋',
                    desc: t('fullwriter.selector.qtSectionOutlineDesc'),
                    onClick: () => { new ModeDocumentModal(this.app, this.plugin, 'short', 'outline', project).open(); },
                }
                : {
                    label: t('fullwriter.selector.qtEpisodeOutline'), icon: '📋',
                    desc: t('fullwriter.selector.qtEpisodeOutlineDesc'),
                    onClick: () => { new ModeDocumentModal(this.app, this.plugin, 'script', 'outline', project).open(); },
                },
            ...(mode === 'script' ? [{
                label: t('fullwriter.selector.qtStoryboard'), icon: '🎬',
                desc: t('fullwriter.selector.qtStoryboardDesc'),
                onClick: () => { new ModeDocumentModal(this.app, this.plugin, 'script', 'storyboard', project).open(); },
            }] : []),
            {
                label: t('fullwriter.selector.qtAllUnits', { unit }), icon: '📖',
                desc: t('fullwriter.selector.qtAllUnitsDesc', { unit }),
                onClick: () => this.showAllChapters(project, chapters, unit, true),
            },
            {
                label: t('fullwriter.selector.qtStyle'), icon: '🖋️',
                desc: t('fullwriter.selector.qtStyleDesc'),
                onClick: () => { new WritingStyleModal(this.app, this.plugin, project).open(); },
            },
            {
                label: t('fullwriter.selector.qtFanfic'), icon: '📚',
                desc: t('fullwriter.selector.qtFanficDesc'),
                onClick: () => {
                    if (this.deps.onAddFanficSetting) this.deps.onAddFanficSetting(project);
                    else this.deps.executeCommand('novel-writer-add-fanfic');
                },
            },
            {
                label: t('fullwriter.selector.qtRename'), icon: '✏️',
                desc: t('fullwriter.selector.qtRenameDesc'),
                onClick: () => this.openRenameProject(project),
            },
            {
                label: t('fullwriter.selector.qtDelete'), icon: '🗑️',
                desc: t('fullwriter.selector.qtDeleteDesc'),
                onClick: () => this.showDeleteProjectModal(project),
            },
        ];
    }

    private async renderProjectDetail(
        panel: HTMLElement,
        project: string,
        metaArg?: Awaited<ReturnType<typeof getProjectMeta>>,
        unitsCache?: Map<string, ChapterItem[]>,
    ): Promise<void> {
        const detail = panel.createDiv({ cls: 'novel-writer-fw-quick-detail' });
        const meta = metaArg ?? await getProjectMeta(this.app, project);
        const chapters = this.getUnitsForProject(project, meta.creationMode, unitsCache);
        const written = chapters.filter(c => c.status === 'written' || c.status === 'settled');
        const nextChapter = getNextChapter(chapters);

        const head = detail.createDiv({ cls: 'novel-writer-fw-quick-detail-head' });
        head.createDiv({ text: `📖 ${projectDisplayName(project)}`, cls: 'novel-writer-fw-preview-title' });
        head.createSpan({ text: `📖 ${meta.creationModeLabel}`, cls: 'novel-writer-fw-preview-genre g0' });
        const modeCategory = meta.shortCategory || meta.scriptGenre;
        if (modeCategory || meta.genre) {
            head.createSpan({ text: modeCategory || meta.genre, cls: 'novel-writer-fw-preview-genre g0' });
        }
        if (meta.description) {
            detail.createEl('p', { text: meta.description, cls: 'novel-writer-fw-preview-desc' });
        }

        const stats = detail.createDiv({ cls: 'novel-writer-fw-preview-stats' });
        stats.createDiv({ text: t('fullwriter.selector.previewTotal', { unit: meta.unitLabel, count: meta.totalChapters || chapters.length }), cls: 'novel-writer-fw-preview-stat' });
        stats.createDiv({ text: t('fullwriter.selector.previewDone', { count: written.length, unit: meta.unitLabel }), cls: 'novel-writer-fw-preview-stat' });
        if (nextChapter) {
            stats.createDiv({
                text: t('fullwriter.selector.previewNext', { unit: meta.unitLabel, chapter: nextChapter.chapter, title: nextChapter.title || t('fullwriter.selector.untitled') }),
                cls: 'novel-writer-fw-preview-next-chapter'
            });
        }

        const progressPct = meta.totalChapters > 0
            ? Math.round((written.length / meta.totalChapters) * 100)
            : (chapters.length > 0 ? Math.round((written.length / chapters.length) * 100) : 0);
        const bar = detail.createDiv({ cls: 'novel-writer-fw-preview-progress-bar' });
        bar.createDiv({ cls: 'novel-writer-fw-preview-progress-fill', attr: { style: `width: ${progressPct}%;` } });
        detail.createDiv({ text: t('fullwriter.selector.previewPct', { pct: progressPct }), cls: 'novel-writer-fw-preview-stat' });
    }

    /**
     * 显示所有章选择弹窗
     * Rev 192：400 章直接平铺会让按钮零散、无法检索。改为「搜索 + 按卷分组 +
     * 自适应网格 + 限定高度滚动」，并补图例与空态。
     * @param project - 项目（路径或对象）
     * @param chapters - 章节列表
     * @param unitLabel - 单元标签
     * @param openDirectly - 是否直接打开
     */
    showAllChapters(project: string, chapters: ChapterItem[], unitLabel = '章', openDirectly = false): void {
        // Rev 192：章节来源是「正文 ∪ 骨架目录」，顺序不保证；先按全书章号排序再分组
        const ordered = sortChaptersByNumber(chapters);
        const isLong = unitLabel === '章';
        const modal = new Modal(this.app);
        modal.titleEl.setText(t('fullwriter.selector.pickerTitle', { project: projectDisplayName(project), units: isLong ? t('fullwriter.selector.allChaptersPlain') : t('fullwriter.selector.allUnitsPlain', { unit: unitLabel }) }));
        modal.modalEl.addClass('novel-writer-chapter-picker-modal');

        const picker = modal.contentEl.createDiv({ cls: 'novel-writer-chapter-picker' });

        const toolbar = picker.createDiv({ cls: 'novel-writer-chapter-picker-toolbar' });
        const search = toolbar.createEl('input', {
            cls: 'novel-writer-chapter-search',
            attr: { type: 'search', placeholder: t('fullwriter.selector.pickerSearch', { unit: unitLabel }) },
        });
        const legend = toolbar.createDiv({ cls: 'novel-writer-chapter-legend' });
        legend.createSpan({ text: t('fullwriter.selector.legendWritten') });
        legend.createSpan({ text: t('fullwriter.selector.legendNext', { unit: unitLabel }) });
        legend.createSpan({ text: t('fullwriter.selector.legendNotStarted') });

        const groupsEl = picker.createDiv({ cls: 'novel-writer-chapter-groups' });
        const empty = picker.createEl('p', { text: isLong ? t('fullwriter.selector.pickerNoMatch') : t('fullwriter.selector.pickerNoMatchUnit', { unit: unitLabel }), cls: 'novel-writer-chapter-picker-empty' });
        empty.hidden = true;

        const nextChapter = ordered.find(c => c.status !== 'written' && c.status !== 'settled');
        const rows: Array<{ el: HTMLElement; groupEl: HTMLElement; text: string }> = [];

        // 按卷分组（保持章节原有顺序；无卷信息的骨架章归入「未分卷」）
        const volumeOrder: string[] = [];
        const byVolume = new Map<string, ChapterItem[]>();
        for (const ch of ordered) {
            const vol = ch.volume || t('fullwriter.selector.noVolume');
            if (!byVolume.has(vol)) {
                byVolume.set(vol, []);
                volumeOrder.push(vol);
            }
            byVolume.get(vol)!.push(ch);
        }

        for (const vol of volumeOrder) {
            const volChapters = byVolume.get(vol)!;
            const group = groupsEl.createDiv({ cls: 'novel-writer-chapter-group' });
            group.createEl('h4', {
                text: isLong
                    ? t('fullwriter.selector.volChapterCount', { vol, count: volChapters.length })
                    : (volumeOrder.length > 1
                        ? `${vol}（${volChapters.length} ${unitLabel}）`
                        : t('fullwriter.selector.volUnitCount', { count: volChapters.length, unit: unitLabel })),
                cls: 'novel-writer-chapter-group-title',
            });
            const list = group.createDiv({ cls: 'novel-writer-chapter-selector' });

            for (const ch of volChapters) {
                const item = list.createEl('button', { cls: 'novel-writer-chapter-select-btn' });
                const isCompleted = ch.status === 'written' || ch.status === 'settled';
                const isNext = nextChapter && ch.chapter === nextChapter.chapter;

                if (isCompleted) item.classList.add('is-completed');
                if (isNext) item.classList.add('is-next');

                const stIcon = isCompleted ? ' ✅' : (isNext ? ' ' + t('fullwriter.selector.stNext') : ' 📝');
                const displayChapter = formatUnitDisplay(ch.chapter, unitLabel);
                // F1：ch.title 来自 frontmatter（AI 生成/导入可写入任意文本），用 DOM 文本节点
                // 直接承载，不走 innerHTML，天然无 XSS。
                item.createSpan({ cls: 'novel-writer-chapter-num', text: displayChapter });
                item.createSpan({ cls: 'novel-writer-chapter-title', text: `${ch.title || t('fullwriter.selector.untitled')}${stIcon}` });
                item.onclick = async () => {
                    if (openDirectly && ch.file) {
                        await this.app.workspace.getLeaf(false).openFile(ch.file);
                    } else {
                        await this.deps.onSelectChapter(project, ch);
                    }
                    modal.close();
                };
                rows.push({
                    el: item,
                    groupEl: group,
                    text: `${displayChapter} ${ch.title || t('fullwriter.selector.untitled')}`.toLowerCase(),
                });
            }
        }

        const applyFilter = () => {
            const kw = search.value.trim().toLowerCase();
            const visibleByGroup = new Map<HTMLElement, number>();
            for (const row of rows) {
                const match = !kw || row.text.includes(kw);
                row.el.hidden = !match;
                if (match) visibleByGroup.set(row.groupEl, (visibleByGroup.get(row.groupEl) || 0) + 1);
            }
            for (const group of Array.from(groupsEl.children) as HTMLElement[]) {
                group.hidden = (visibleByGroup.get(group) || 0) === 0;
            }
            empty.hidden = visibleByGroup.size > 0;
        };
        search.oninput = applyFilter;
        search.onkeydown = (ev: KeyboardEvent) => {
            if (ev.key === 'Escape') {
                ev.preventDefault();
                ev.stopPropagation();
                modal.close();
            }
        };

        modal.open();
        window.setTimeout(() => search.focus(), 0);
    }

    private openRenameProject(project: string): void {
        new RenameProjectModal(this.app, project, (newProject) => {
            void this.handleProjectRenamed(project, newProject);
        }).open();
    }

    private async handleProjectRenamed(oldProject: string, newProject: string): Promise<void> {
        this.selectedProject = newProject;
        this.highlightedProject = newProject;
        this.deps.onProjectSelected?.(newProject);
        try {
            await this.plugin.engineRegistry.disposeProject(oldProject);
            await this.plugin.engineRegistry.setActiveProject(newProject);
        } catch (e) {
            log.warn('重命名后释放旧项目实例失败:', e);
        }
        this.plugin.ctxManager.invalidateContextCache(oldProject);
        this.plugin.ctxManager.invalidateContextCache(newProject);
        await this.refresh();
    }

    /**
     * 显示删除项目确认弹窗。
     *
     * 旧实现要求用户手动输入项目名；改为两步确认（继续删除 → 最终确认），
     * 降低误触成本，同时不再让用户复制/输入项目名。
     *
     * @param projectName - 项目名
     */
    showDeleteProjectModal(projectName: string): void {
        void this.confirmDeleteProject(projectName);
    }

    private async confirmDeleteProject(projectName: string): Promise<void> {
        const displayName = projectDisplayName(projectName);
        const first = await OperationConfirmModal.confirm(this.app, {
            title: t('fullwriter.selector.deleteTitle'),
            description: t('fullwriter.selector.deleteDesc', { name: displayName }),
            warning: t('fullwriter.selector.deleteWarning'),
            confirmText: t('fullwriter.selector.deleteConfirm'),
            cancelText: t('common.cancel'),
        });
        if (!first) return;

        const second = await OperationConfirmModal.confirm(this.app, {
            title: t('fullwriter.selector.finalTitle'),
            description: t('fullwriter.selector.finalDesc', { name: displayName }),
            warning: t('fullwriter.selector.finalWarning'),
            confirmText: t('fullwriter.selector.finalOk'),
            cancelText: t('common.cancel'),
        });
        if (!second) return;

        await deleteProject(this.app, projectName);
        this.deps.onDeleteProject?.();
    }

    /**
     * 清理资源
     */
    destroy(): void {
        if (this.cleanup) {
            this.cleanup();
            this.cleanup = null;
        }
        this.selectedProject = null;
    }
}
