/**
 * project-selector-controller.ts — 项目选择器控制器
 *
 * 职责：渲染「项目与章节」选择页，包括项目卡片网格、预览面板、章节列表弹窗。
 *
 * 从 full-writer-view.ts 拆分而来，原代码约 320 行。
 * 与现有子模块保持一致的控制器模式：通过 deps 对象注入外部依赖。
 */

import { App, Modal, Notice, TFile } from 'obsidian';
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
        container.createDiv({ text: '创作分类', cls: 'novel-writer-fw-mode-nav-title' });
        const modes: Array<{ mode: CreationMode; label: string; icon: string }> = [
            { mode: 'long', label: '长篇小说', icon: '📖' },
            { mode: 'short', label: '短篇小说', icon: '📄' },
            { mode: 'script', label: '剧本', icon: '🎬' },
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

    private async openUnit(project: string, mode: CreationMode, unit: ChapterItem | null): Promise<void> {
        if (!unit) {
            new Notice(
                mode === 'long'
                    ? '该项目还没有章节，请先完成初始化向导的「批量建章」。'
                    : `该项目还没有${modeUnitLabel(mode)}骨架，请先在创作流程里创建。`,
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
            new Notice('未找到对应的正文文件', 4000);
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
        await Promise.all(allProjects.map(async (project) => {
            try {
                metaOf.set(project, await getProjectMeta(this.app, project));
            } catch {
                // 元信息读不到的项目按长篇默认归类；卡片渲染处会再取一次（与旧行为一致）
            }
        }));
        const modeOf = new Map<string, CreationMode>();
        for (const project of allProjects) {
            modeOf.set(project, metaOf.get(project)?.creationMode || 'long');
        }
        // 长篇章节一次扫描产出全部项目（旧实现每项目各遍历一次全库）
        const longProjects = allProjects.filter(project => (modeOf.get(project) || 'long') === 'long');
        const chapterScan = scanProjectChapters(this.app, longProjects);
        for (const project of longProjects) {
            unitsCache.set(project, chapterScan.get(project) || []);
        }

        // 从外部高亮某个项目时，自动切到它所属的分类
        if (this.highlightedProject && allProjects.includes(this.highlightedProject)) {
            this.selectedMode = modeOf.get(this.highlightedProject) || 'long';
        }

        this.renderModeNav(modeNav, allProjects, modeOf);
        const projects = allProjects.filter(project => (modeOf.get(project) || 'long') === this.selectedMode);

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
        await this.renderRightPanel(unitsCache);

        const modeLabel = this.selectedMode === 'long' ? '长篇小说' : this.selectedMode === 'short' ? '短篇小说' : '剧本';
        const toolbar = projectArea.createDiv({ cls: 'novel-writer-fw-project-toolbar' });
        const toolbarInfo = toolbar.createDiv({ cls: 'novel-writer-fw-project-toolbar-info' });
        toolbarInfo.createSpan({ text: modeLabel, cls: 'novel-writer-fw-project-toolbar-title' });
        toolbarInfo.createSpan({ text: `${projects.length} 个项目`, cls: 'novel-writer-fw-project-toolbar-count' });
        const toolbarActions = toolbar.createDiv({ cls: 'novel-writer-fw-project-toolbar-actions' });

        const agentBtn = toolbarActions.createEl('button', {
            text: '🤖 Agent 工作台',
            cls: 'novel-writer-fw-toolbar-btn is-primary',
            attr: { type: 'button', title: '通过多轮对话创建/继续项目：先选长篇/短篇/剧本，再选原创/同人或自动模式' },
        });
        agentBtn.onclick = () => {
            void this.plugin.openAgentWorkbench();
        };

        const createBtn = toolbarActions.createEl('button', {
            text: `＋ 新建${modeLabel}`,
            cls: 'novel-writer-fw-toolbar-btn',
            attr: { type: 'button', title: this.selectedMode === 'long' ? '打开长篇项目表单' : '打开前期调研' },
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
            const label = this.selectedMode === 'short' ? '短篇小说' : this.selectedMode === 'script' ? '剧本' : '长篇小说';
            heroCard.createDiv({ text: spec, cls: 'novel-writer-fw-hero-icon' });
            heroCard.createEl('h2', { text: `创建第一篇${label}`, cls: 'novel-writer-fw-hero-title' });
            heroCard.createEl('p', {
                text: this.selectedMode === 'short'
                    ? '先完成番茄短篇定位与故事核，再进入分节写作。'
                    : this.selectedMode === 'script'
                        ? '先完成红果短剧定位与商业钩子，再进入分集/分镜。'
                        : '创建长篇项目，AI 将协助你完成从世界观到正文的全程写作。',
                cls: 'novel-writer-fw-hero-desc',
            });
            const create = heroCard.createEl('button', {
                text: `＋ 新建${label}`,
                cls: 'novel-writer-fw-hero-btn',
            });
            create.onclick = () => {
                if (this.selectedMode === 'short') new PreResearchModal(this.app, this.plugin, 'short').open();
                else if (this.selectedMode === 'script') new PreResearchModal(this.app, this.plugin, 'script').open();
                else new CreateProjectModal(this.app, this.plugin).open();
            };
            if (this.selectedMode === 'long') {
                const agentBtn = heroCard.createEl('button', {
                    text: '🤖 Agent 工作台创作（推荐）',
                    cls: 'novel-writer-fw-hero-btn novel-writer-fw-hero-btn-secondary',
                    attr: { title: '通过多轮对话完成项目创建与故事结构配置，无需填表单' },
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
                placeholder.createSpan({ text: '添加封面', cls: 'text' });
            }
            coverArea.setAttr('title', coverUrl ? '点击更换封面' : '点击添加封面');
            coverArea.onclick = (e) => {
                e.stopPropagation();
                this.deps.getCoverPicker().openCoverPicker(project, coverArea);
            };

            const info = card.createDiv({ cls: 'novel-writer-fw-card-info-inner' });

            const nameRow = info.createDiv({ cls: 'novel-writer-fw-card-name-row' });
            nameRow.createDiv({ text: `📖 ${projectDisplayName(project)}`, cls: 'novel-writer-fw-card-name' });
            if (project === this.highlightedProject) {
                nameRow.createSpan({ text: '新', cls: 'novel-writer-fw-card-new-badge' });
            }

            const metaRow = info.createDiv({ cls: 'novel-writer-fw-card-meta' });
            let meta = metaOf.get(project);
            if (!meta) meta = await getProjectMeta(this.app, project);
            const modeText = meta.creationMode === 'long' ? '' : `${meta.creationModeLabel} · `;
            const categoryText = meta.shortCategory || meta.scriptGenre;
            metaRow.createSpan({ text: `${modeText}${categoryText || meta.genre}`.trim(), cls: 'novel-writer-fw-card-genre g0' });
            if (meta.storyStructureName) {
                metaRow.createSpan({ text: `🧬 ${meta.storyStructureName}`, cls: 'novel-writer-fw-card-structure' });
            }

            const sortedChapters = this.getUnitsForProject(project, meta.creationMode, unitsCache);
            const writtenChapters = sortedChapters.filter(c => c.status === 'written' || c.status === 'settled');

            metaRow.createSpan({ text: `${sortedChapters.length}${meta.unitLabel}`, cls: 'novel-writer-fw-card-count-badge' });

            if (sortedChapters.length > 0) {
                const progressPct = meta.totalChapters > 0
                    ? Math.round((writtenChapters.length / meta.totalChapters) * 100)
                    : Math.round((writtenChapters.length / Math.max(sortedChapters.length, 1)) * 100);
                info.createDiv({ text: `已完稿 ${writtenChapters.length}/${meta.totalChapters || sortedChapters.length} ${meta.unitLabel}`, cls: 'novel-writer-fw-card-progress-text' });
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
                    text: `${isPending ? `下一${meta.unitLabel}待写` : `最新${meta.unitLabel}`}：${nextChapter.chapter} · ${nextChapter.title || '无标题'}`,
                    cls: 'novel-writer-fw-card-latest'
                });
            }

            const actions = card.createDiv({ cls: 'novel-writer-fw-card-actions' });
            if (meta.creationMode === 'long') {
                const wizardBtn = actions.createEl('button', { text: '🧙 向导', cls: 'novel-writer-fw-card-action-btn' });
                wizardBtn.setAttribute('title', '打开项目向导，逐步搭建世界观和大纲');
                wizardBtn.onclick = async (e: MouseEvent) => {
                    e.stopPropagation();
                    await this.deps.onOpenWizard(project);
                };
            } else {
                const researchBtn = actions.createEl('button', { text: '📚 前期调研', cls: 'novel-writer-fw-card-action-btn' });
                researchBtn.setAttribute('title', '编辑本项目的类型定位与创作约束');
                researchBtn.onclick = (e: MouseEvent) => {
                    e.stopPropagation();
                    new PreResearchModal(this.app, this.plugin, meta.creationMode as 'short' | 'script', { project }).open();
                };
            }

            const openBtn = actions.createEl('button', { text: '✍️ 写作', cls: 'novel-writer-fw-card-action-btn secondary' });
            openBtn.onclick = async (e: MouseEvent) => {
                e.stopPropagation();
                await this.openUnit(project, meta.creationMode, nextChapter);
            };

            if (meta.creationMode === 'long') {
                const cowriteBtn = actions.createEl('button', { text: '✍️ 句级协同', cls: 'novel-writer-fw-card-action-btn secondary' });
                cowriteBtn.setAttribute('title', '直接进入句级协同写作工作台（自动绑定章节）');
                cowriteBtn.onclick = async (e: MouseEvent) => {
                    e.stopPropagation();
                    if (nextChapter) {
                        await this.deps.onOpenCoWriting(project, nextChapter);
                    } else {
                        new Notice('该项目还没有章节，请先通过向导或批量建章创建章节。', 4000);
                    }
                };
            }

            const browseBtn = actions.createEl('button', {
                text: meta.creationMode === 'long' ? '全部章节' : `全部${meta.unitLabel}`,
                cls: 'novel-writer-fw-card-action-btn secondary',
            });
            browseBtn.onclick = (e: MouseEvent) => {
                e.stopPropagation();
                this.showAllChapters(project, sortedChapters, meta.unitLabel, meta.creationMode !== 'long');
            };

            const renameBtn = actions.createEl('button', { text: '✏️', cls: 'novel-writer-fw-card-action-btn secondary' });
            renameBtn.setAttribute('title', '重命名项目');
            renameBtn.onclick = (e: MouseEvent) => {
                e.stopPropagation();
                this.openRenameProject(project);
            };

            const deleteBtn = actions.createEl('button', { text: '🗑️', cls: 'novel-writer-fw-card-delete-btn' });
            deleteBtn.setAttribute('title', '删除项目');
            deleteBtn.onclick = (e: MouseEvent) => {
                e.stopPropagation();
                this.showDeleteProjectModal(project);
            };

            card.onclick = () => {
                const isSelected = card.classList.contains('selected');
                projectGrid.querySelectorAll('.novel-writer-fw-project-card.selected').forEach(c => c.classList.remove('selected'));
                if (isSelected) {
                    this.selectedProject = null;
                } else {
                    card.classList.add('selected');
                    this.selectedProject = project;
                }
                this.deps.onProjectSelected?.(this.selectedProject);
                void this.renderRightPanel();
            };
        }
    }

    /** 右侧面板 = 选中项目概览 + 按项目类型切换的快捷工具 */
    private async renderRightPanel(unitsCache?: Map<string, ChapterItem[]>): Promise<void> {
        const panel = this.rightPanel;
        if (!panel) return;
        panel.empty();

        const project = this.selectedProject;
        let mode: CreationMode = this.selectedMode;
        let meta: Awaited<ReturnType<typeof getProjectMeta>> | undefined;
        if (project) {
            meta = await getProjectMeta(this.app, project);
            mode = meta.creationMode;
            this.selectedMode = mode;
            await this.renderProjectDetail(panel, project, meta, unitsCache);
            await this.renderFlowSummary(panel, project, mode);
        } else {
            const hint = panel.createDiv({ cls: 'nw-qt-empty-hint' });
            hint.createDiv({ text: '👈 点击左侧项目卡片', cls: 'nw-qt-empty-title' });
            hint.createDiv({ text: '点击任意项目卡片后，右侧会按项目类型显示对应的快捷工具。', cls: 'nw-qt-empty-desc' });
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
            const more = catalog.hiddenLabels.length > 4 ? ` 等 ${catalog.hiddenLabels.length} 项` : '';
            hint.createDiv({ text: '本模式暂不支持', cls: 'nw-qt-empty-title' });
            hint.createDiv({
                text: `${shown}${more}属于长篇小说流水线；短篇/剧本请用上方的创作流程与单元工作台。`,
                cls: 'nw-qt-empty-desc',
            });
        }
    }

    /**
     * 右侧流程摘要：让用户不用先点开页签就知道「进行到哪、下一步做什么」。
     * 详情仍以「创作流程」页签为准，这里只做摘要与入口。
     */
    private async renderFlowSummary(panel: HTMLElement, project: string, mode: CreationMode): Promise<void> {
        let snapshot;
        try {
            snapshot = (await collectCreationFlowState(this.app, project, { mode })).snapshot;
        } catch {
            return;
        }
        if (snapshot.stages.length === 0) return;

        const card = panel.createDiv({ cls: 'nw-flow-summary' });
        const head = card.createDiv({ cls: 'nw-flow-summary-head' });
        head.createSpan({ cls: 'nw-flow-summary-title', text: '创作流程' });
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
                ? `下一步：${next.label} · ${next.ctaLabel}`
                : `全部阶段已完成 · ${snapshot.unitLabel}与导出均已就绪`,
        });

        const button = card.createEl('button', { cls: 'nw-btn nw-btn-secondary nw-flow-summary-btn', text: '查看完整流程' });
        button.onclick = () => { void this.deps.onOpenFlow?.(project); };
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
                    label: '项目向导', icon: '🧙', primary: true,
                    desc: '逐步搭建世界观、设定、实体与大纲',
                    onClick: () => { void this.deps.onOpenWizard(project); },
                },
                {
                    label: '继续写作', icon: '✍️',
                    desc: '打开下一章写作工作台',
                    onClick: () => {
                        if (nextChapter) void this.deps.onSelectChapter(project, nextChapter);
                        else new Notice('该项目还没有章节，请先通过向导或批量建章创建章节。', 4000);
                    },
                },
                {
                    label: '全部章节', icon: '📖',
                    desc: '浏览并选择章节',
                    onClick: () => this.showAllChapters(project, chapters, unit),
                },
                {
                    label: '文笔风格', icon: '🖋️',
                    desc: '编辑或更换本项目的文笔风格',
                    onClick: () => { new WritingStyleModal(this.app, this.plugin, project).open(); },
                },
                {
                    label: '同人设定', icon: '📚',
                    desc: '生成/补充同人设定并保存到本项目',
                    onClick: () => {
                        if (this.deps.onAddFanficSetting) this.deps.onAddFanficSetting(project);
                        else this.deps.executeCommand('novel-writer-add-fanfic');
                    },
                },
                {
                    label: '重命名项目', icon: '✏️',
                    desc: '修改项目名，并同步元数据与插件偏好',
                    onClick: () => this.openRenameProject(project),
                },
                {
                    label: '删除项目', icon: '🗑️',
                    desc: '删除项目及其全部数据',
                    onClick: () => this.showDeleteProjectModal(project),
                },
            ];
        }

        const researchMode = mode === 'short' ? 'short' : 'script';
        return [
            {
                label: '前期调研', icon: '📚', primary: true,
                desc: mode === 'short'
                    ? '编辑五维分类、故事核与分节规格'
                    : '编辑类型、商业钩子、集数规格与场景圣经',
                onClick: () => {
                    new PreResearchModal(this.app, this.plugin, researchMode, { project }).open();
                },
            },
            {
                label: '继续写作', icon: '✍️',
                desc: `打开下一${unit}写作工作台`,
                onClick: () => {
                    void this.openUnit(project, mode, nextChapter);
                },
            },
            mode === 'short'
                ? {
                    label: '故事核', icon: '📖',
                    desc: '编辑故事核：主角、目标、阻力、反转与情绪承诺',
                    onClick: () => { new ModeDocumentModal(this.app, this.plugin, 'short', 'storyCore', project).open(); },
                }
                : {
                    label: '场景圣经', icon: '🎭',
                    desc: '编辑主场景、光线、道具与拍摄限制',
                    onClick: () => { new ModeDocumentModal(this.app, this.plugin, 'script', 'bible', project).open(); },
                },
            mode === 'short'
                ? {
                    label: '分节大纲', icon: '📋',
                    desc: '规划每节目标、冲突、反转与结尾钩子',
                    onClick: () => { new ModeDocumentModal(this.app, this.plugin, 'short', 'outline', project).open(); },
                }
                : {
                    label: '分集大纲', icon: '📋',
                    desc: '规划每集冲突、爽点、钩子与场次',
                    onClick: () => { new ModeDocumentModal(this.app, this.plugin, 'script', 'outline', project).open(); },
                },
            ...(mode === 'script' ? [{
                label: '分镜表', icon: '🎬',
                desc: '编辑镜号、景别、运镜、动作与台词',
                onClick: () => { new ModeDocumentModal(this.app, this.plugin, 'script', 'storyboard', project).open(); },
            }] : []),
            {
                label: `全部${unit}`, icon: '📖',
                desc: `浏览并选择${unit}`,
                onClick: () => this.showAllChapters(project, chapters, unit, true),
            },
            {
                label: '文笔风格', icon: '🖋️',
                desc: '编辑或更换本项目的文笔风格',
                onClick: () => { new WritingStyleModal(this.app, this.plugin, project).open(); },
            },
            {
                label: '同人设定', icon: '📚',
                desc: '生成/补充同人设定并保存到本项目',
                onClick: () => {
                    if (this.deps.onAddFanficSetting) this.deps.onAddFanficSetting(project);
                    else this.deps.executeCommand('novel-writer-add-fanfic');
                },
            },
            {
                label: '重命名项目', icon: '✏️',
                desc: '修改项目名，并同步元数据与插件偏好',
                onClick: () => this.openRenameProject(project),
            },
            {
                label: '删除项目', icon: '🗑️',
                desc: '删除项目及其全部数据',
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
        stats.createDiv({ text: `总${meta.unitLabel}：${meta.totalChapters || chapters.length}`, cls: 'novel-writer-fw-preview-stat' });
        stats.createDiv({ text: `已完稿：${written.length} ${meta.unitLabel}`, cls: 'novel-writer-fw-preview-stat' });
        if (nextChapter) {
            stats.createDiv({
                text: `下一${meta.unitLabel}：${nextChapter.chapter} · ${nextChapter.title || '无标题'}`,
                cls: 'novel-writer-fw-preview-next-chapter'
            });
        }

        const progressPct = meta.totalChapters > 0
            ? Math.round((written.length / meta.totalChapters) * 100)
            : (chapters.length > 0 ? Math.round((written.length / chapters.length) * 100) : 0);
        const bar = detail.createDiv({ cls: 'novel-writer-fw-preview-progress-bar' });
        bar.createDiv({ cls: 'novel-writer-fw-preview-progress-fill', attr: { style: `width: ${progressPct}%;` } });
        detail.createDiv({ text: `${progressPct}% 完成`, cls: 'novel-writer-fw-preview-stat' });
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
        modal.titleEl.setText(`📖 ${projectDisplayName(project)} - ${isLong ? '所有章节' : `所有${unitLabel}`}`);
        modal.modalEl.addClass('novel-writer-chapter-picker-modal');

        const picker = modal.contentEl.createDiv({ cls: 'novel-writer-chapter-picker' });

        const toolbar = picker.createDiv({ cls: 'novel-writer-chapter-picker-toolbar' });
        const search = toolbar.createEl('input', {
            cls: 'novel-writer-chapter-search',
            attr: { type: 'search', placeholder: `搜索${unitLabel}号或标题…` },
        });
        const legend = toolbar.createDiv({ cls: 'novel-writer-chapter-legend' });
        legend.createSpan({ text: '✅ 已写' });
        legend.createSpan({ text: `✏️ 下一${unitLabel}待写` });
        legend.createSpan({ text: '📝 未开始' });

        const groupsEl = picker.createDiv({ cls: 'novel-writer-chapter-groups' });
        const empty = picker.createEl('p', { text: isLong ? '未匹配到章节' : `未匹配到${unitLabel}`, cls: 'novel-writer-chapter-picker-empty' });
        empty.hidden = true;

        const nextChapter = ordered.find(c => c.status !== 'written' && c.status !== 'settled');
        const rows: Array<{ el: HTMLElement; groupEl: HTMLElement; text: string }> = [];

        // 按卷分组（保持章节原有顺序；无卷信息的骨架章归入「未分卷」）
        const volumeOrder: string[] = [];
        const byVolume = new Map<string, ChapterItem[]>();
        for (const ch of ordered) {
            const vol = ch.volume || '未分卷';
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
                    ? `${vol}（${volChapters.length} 章）`
                    : (volumeOrder.length > 1
                        ? `${vol}（${volChapters.length} ${unitLabel}）`
                        : `全部${unitLabel}（${volChapters.length} ${unitLabel}）`),
                cls: 'novel-writer-chapter-group-title',
            });
            const list = group.createDiv({ cls: 'novel-writer-chapter-selector' });

            for (const ch of volChapters) {
                const item = list.createEl('button', { cls: 'novel-writer-chapter-select-btn' });
                const isCompleted = ch.status === 'written' || ch.status === 'settled';
                const isNext = nextChapter && ch.chapter === nextChapter.chapter;

                if (isCompleted) item.classList.add('is-completed');
                if (isNext) item.classList.add('is-next');

                const stIcon = isCompleted ? ' ✅' : (isNext ? ' ✏️ 待写' : ' 📝');
                const displayChapter = formatUnitDisplay(ch.chapter, unitLabel);
                // F1：ch.title 来自 frontmatter（AI 生成/导入可写入任意文本），用 DOM 文本节点
                // 直接承载，不走 innerHTML，天然无 XSS。
                item.createSpan({ cls: 'novel-writer-chapter-num', text: displayChapter });
                item.createSpan({ cls: 'novel-writer-chapter-title', text: `${ch.title || '无标题'}${stIcon}` });
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
                    text: `${displayChapter} ${ch.title || '无标题'}`.toLowerCase(),
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
            title: '⚠️ 删除项目',
            description: `确定要删除项目「${displayName}」吗？`,
            warning: '此操作不可撤销，将删除所有章节、大纲、设定、人物数据。',
            confirmText: '继续删除',
            cancelText: '取消',
        });
        if (!first) return;

        const second = await OperationConfirmModal.confirm(this.app, {
            title: '🚨 最终确认',
            description: `即将永久删除「${displayName}」及其全部数据。`,
            warning: '删除后无法恢复；如仍需保留，请先备份或取消。',
            confirmText: '确认删除',
            cancelText: '取消',
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
