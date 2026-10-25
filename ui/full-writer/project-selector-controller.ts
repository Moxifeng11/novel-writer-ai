/**
 * project-selector-controller.ts — 项目选择器控制器
 *
 * 职责：渲染「项目与章节」选择页，包括项目卡片网格、预览面板、章节列表弹窗。
 *
 * 从 full-writer-view.ts 拆分而来，原代码约 320 行。
 * 与现有子模块保持一致的控制器模式：通过 deps 对象注入外部依赖。
 */

import { App, Modal, Notice, TFile } from 'obsidian';
import NovelWriterPlugin from '../../main';
import { ContextManager } from '../../engine/context-manager';
import { escapeHtml } from '../../utils/helpers';
import { CoverPickerController } from './cover-picker-controller';
import { renderQuickToolsPanel, type ProjectQuickAction } from './quick-tools-panel';
import { WritingStyleModal } from '../writing-style-modal';
import { CreateProjectModal } from '../create-project-modal';
import {
    getProjectCover,
    getProjectMeta,
    getChaptersForProject,
    sortChaptersByNumber,
    getNextChapter,
    deleteProject,
} from '../project-utils';

export type ChapterItem = {
    chapter: string;
    volume: string;
    title: string;
    status: string;
    /** 正文文件；仅有骨架时为空 */
    file: TFile | null;
};

export interface ProjectSelectorDeps {
    getContextManager: () => ContextManager;
    getCoverPicker: () => CoverPickerController;
    onSelectChapter: (project: string, chapter: ChapterItem) => Promise<void>;
    onOpenWizard: (project: string) => Promise<void>;
    onOpenCoWriting: (project: string, chapter: ChapterItem) => Promise<void>;
    onAddFanficSetting?: (project: string) => void;
    onDeleteProject?: () => void;
    /** 右侧项目卡片选中变化：用于把「当前项目」同步给命令层（快捷工具无 activeFile） */
    onProjectSelected?: (project: string | null) => void;
    executeCommand: (commandId: string) => void;
}

export class ProjectSelectorController {
    private app: App;
    private plugin: NovelWriterPlugin;
    private deps: ProjectSelectorDeps;

    private cleanup: (() => void) | null = null;
    private selectedProject: string | null = null;
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

    async refresh(maxRetries = 2): Promise<void> {
        if (!this.container) return;
        await this.render(this.container);
        // 如果有高亮项目但未在列表中找到，重试
        if (this.highlightedProject && maxRetries > 0) {
            const hasProject = this.projectGrid?.querySelector(`[data-project="${this.highlightedProject}"]`);
            if (!hasProject) {
                await new Promise(r => setTimeout(r, 300));
                await this.refresh(maxRetries - 1);
            }
        }
    }

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
    async render(container: HTMLElement): Promise<void> {
        if (this.cleanup) {
            this.cleanup();
            this.cleanup = null;
        }
        this.container = container;
        container.empty();

        const wrapper = container.createDiv({ cls: 'novel-writer-fw-selector-layout' });

        const projectArea = wrapper.createDiv({ cls: 'novel-writer-fw-project-area' });
        this.projectArea = projectArea;

        const rightPanel = wrapper.createDiv({ cls: 'novel-writer-fw-right-panel' });
        this.rightPanel = rightPanel;

        const contextManager = this.deps.getContextManager();
        const projects = await contextManager.detectProjects();

        if (this.selectedProject && !projects.includes(this.selectedProject)) {
            this.selectedProject = null;
        }
        // 首次进入 / 视图重建后默认选中一个项目：
        // 右侧面板的「项目概览 + 项目级快捷操作」才有意义，避免只显示空提示。
        if (!this.selectedProject && projects.length > 0) {
            const preferred = this.highlightedProject && projects.includes(this.highlightedProject)
                ? this.highlightedProject
                : this.plugin.getActiveProject();
            this.selectedProject = preferred && projects.includes(preferred) ? preferred : projects[0];
        }
        this.deps.onProjectSelected?.(this.selectedProject);
        this.renderRightPanel();

        if (projects.length === 0) {
            const emptyState = projectArea.createDiv({ cls: 'novel-writer-fw-empty-state' });
            const heroCard = emptyState.createDiv({ cls: 'novel-writer-fw-hero-card' });
            heroCard.createDiv({ text: '📚', cls: 'novel-writer-fw-hero-icon' });
            heroCard.createEl('h2', { text: '开始你的创作之旅', cls: 'novel-writer-fw-hero-title' });
            heroCard.createEl('p', { text: '创建一个新项目，AI 将协助你完成从世界观到正文的全程写作', cls: 'novel-writer-fw-hero-desc' });
            const createBtn = heroCard.createEl('button', { text: '📁 创建新项目', cls: 'novel-writer-fw-hero-btn' });
            createBtn.onclick = () => {
                new CreateProjectModal(this.app, this.plugin).open();
            };
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
            nameRow.createDiv({ text: `📖 ${project}`, cls: 'novel-writer-fw-card-name' });
            if (project === this.highlightedProject) {
                nameRow.createSpan({ text: '新', cls: 'novel-writer-fw-card-new-badge' });
            }

            const metaRow = info.createDiv({ cls: 'novel-writer-fw-card-meta' });
            const meta = await getProjectMeta(this.app, project);
            if (meta.genre) {
                metaRow.createSpan({ text: meta.genre, cls: 'novel-writer-fw-card-genre g0' });
            }

            const chapters = getChaptersForProject(this.app, project);
            const sortedChapters = sortChaptersByNumber(chapters);
            const writtenChapters = sortedChapters.filter(c => c.status === 'written' || c.status === 'settled');

            metaRow.createSpan({ text: `${sortedChapters.length}章`, cls: 'novel-writer-fw-card-count-badge' });

            if (sortedChapters.length > 0) {
                const progressPct = meta.totalChapters > 0
                    ? Math.round((writtenChapters.length / meta.totalChapters) * 100)
                    : Math.round((writtenChapters.length / Math.max(sortedChapters.length, 1)) * 100);
                info.createDiv({ text: `已完稿 ${writtenChapters.length}/${meta.totalChapters || sortedChapters.length}`, cls: 'novel-writer-fw-card-progress-text' });
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
                    text: `${isPending ? '下一章待写' : '最新章节'}：${nextChapter.chapter} · ${nextChapter.title || '无标题'}`,
                    cls: 'novel-writer-fw-card-latest'
                });
            }

            const actions = card.createDiv({ cls: 'novel-writer-fw-card-actions' });
            const wizardBtn = actions.createEl('button', { text: '🧙 向导', cls: 'novel-writer-fw-card-action-btn' });
            wizardBtn.setAttribute('title', '打开项目向导，逐步搭建世界观和大纲');
            wizardBtn.onclick = async (e: MouseEvent) => {
                e.stopPropagation();
                await this.deps.onOpenWizard(project);
            };

            const openBtn = actions.createEl('button', { text: '✍️ 写作', cls: 'novel-writer-fw-card-action-btn secondary' });
            openBtn.onclick = async (e: MouseEvent) => {
                e.stopPropagation();
                if (nextChapter) {
                    await this.deps.onSelectChapter(project, nextChapter);
                }
            };

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

            const browseBtn = actions.createEl('button', { text: '全部章节', cls: 'novel-writer-fw-card-action-btn secondary' });
            browseBtn.onclick = (e: MouseEvent) => {
                e.stopPropagation();
                this.showAllChapters(project, sortedChapters);
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
                this.renderRightPanel();
            };
        }
    }

    /** 右侧面板 = 选中项目概览 + 常驻分类工具 */
    private renderRightPanel(): void {
        const panel = this.rightPanel;
        if (!panel) return;
        panel.empty();

        const project = this.selectedProject;
        if (project) {
            this.renderProjectDetail(panel, project);
        } else {
            const hint = panel.createDiv({ cls: 'nw-qt-empty-hint' });
            hint.createDiv({ text: '👈 点击左侧项目卡片', cls: 'nw-qt-empty-title' });
            hint.createDiv({ text: '可在上方看到项目概览，并在下方直接使用全部快捷工具。', cls: 'nw-qt-empty-desc' });
        }

        renderQuickToolsPanel(panel, {
            executeCommand: (commandId) => this.deps.executeCommand(commandId),
            project,
            projectActions: project ? this.buildProjectActions(project) : undefined,
        });
    }

    private buildProjectActions(project: string): ProjectQuickAction[] {
        const chapters = sortChaptersByNumber(getChaptersForProject(this.app, project));
        const nextChapter = getNextChapter(chapters);

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
                onClick: () => this.showAllChapters(project, chapters),
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
                label: '删除项目', icon: '🗑️',
                desc: '删除项目及其全部数据',
                onClick: () => this.showDeleteProjectModal(project),
            },
        ];
    }

    private async renderProjectDetail(panel: HTMLElement, project: string): Promise<void> {
        const detail = panel.createDiv({ cls: 'novel-writer-fw-quick-detail' });
        const meta = await getProjectMeta(this.app, project);
        const chapters = sortChaptersByNumber(getChaptersForProject(this.app, project));
        const written = chapters.filter(c => c.status === 'written' || c.status === 'settled');
        const nextChapter = getNextChapter(chapters);

        const head = detail.createDiv({ cls: 'novel-writer-fw-quick-detail-head' });
        head.createDiv({ text: `📖 ${project}`, cls: 'novel-writer-fw-preview-title' });
        if (meta.genre) {
            head.createSpan({ text: meta.genre, cls: 'novel-writer-fw-preview-genre g0' });
        }
        if (meta.description) {
            detail.createEl('p', { text: meta.description, cls: 'novel-writer-fw-preview-desc' });
        }

        const stats = detail.createDiv({ cls: 'novel-writer-fw-preview-stats' });
        stats.createDiv({ text: `总章节：${meta.totalChapters || chapters.length}`, cls: 'novel-writer-fw-preview-stat' });
        stats.createDiv({ text: `已完稿：${written.length}`, cls: 'novel-writer-fw-preview-stat' });
        if (nextChapter) {
            stats.createDiv({
                text: `下一章：${nextChapter.chapter} · ${nextChapter.title || '无标题'}`,
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
     */
    showAllChapters(project: string, chapters: ChapterItem[]): void {
        // Rev 192：章节来源是「正文 ∪ 骨架目录」，顺序不保证；先按全书章号排序再分组
        const ordered = sortChaptersByNumber(chapters);
        const modal = new Modal(this.app);
        modal.titleEl.setText(`📖 ${project} - 所有章节`);
        modal.modalEl.addClass('novel-writer-chapter-picker-modal');

        const picker = modal.contentEl.createDiv({ cls: 'novel-writer-chapter-picker' });

        const toolbar = picker.createDiv({ cls: 'novel-writer-chapter-picker-toolbar' });
        const search = toolbar.createEl('input', {
            cls: 'novel-writer-chapter-search',
            attr: { type: 'search', placeholder: '搜索章号或标题…' },
        });
        const legend = toolbar.createDiv({ cls: 'novel-writer-chapter-legend' });
        legend.createSpan({ text: '✅ 已写' });
        legend.createSpan({ text: '✏️ 下一章待写' });
        legend.createSpan({ text: '📝 未开始' });

        const groupsEl = picker.createDiv({ cls: 'novel-writer-chapter-groups' });
        const empty = picker.createEl('p', { text: '未匹配到章节', cls: 'novel-writer-chapter-picker-empty' });
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
                text: `${vol}（${volChapters.length} 章）`,
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
                // F1：ch.title 来自 frontmatter（AI 生成/导入可写入任意文本），ch.chapter 为解析串，
                // innerHTML 插值前必须转义，防止章节标题 XSS。
                item.innerHTML = `<span class="novel-writer-chapter-num">${escapeHtml(ch.chapter)}</span><span class="novel-writer-chapter-title">${escapeHtml(ch.title || '无标题')}${stIcon}</span>`;
                item.onclick = async () => {
                    await this.deps.onSelectChapter(project, ch);
                    modal.close();
                };
                rows.push({
                    el: item,
                    groupEl: group,
                    text: `${ch.chapter} ${ch.title || '无标题'}`.toLowerCase(),
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

    /**
     * 显示删除项目确认弹窗
     */
    showDeleteProjectModal(projectName: string): void {
        const modal = new Modal(this.app);
        modal.titleEl.setText('⚠️ 删除项目');

        const content = modal.contentEl.createDiv({ attr: { style: 'padding: 20px;' } });
        content.createEl('p', {
            text: `确定要删除项目「${projectName}」吗？`,
            attr: { style: 'font-size: 1.1em; font-weight: 600; color: #3d3070; margin-bottom: 8px;' }
        });
        content.createEl('p', {
            text: '此操作不可撤销，将删除所有章节、大纲、设定、人物数据。',
            attr: { style: 'color: #ef4444; font-size: 0.9em; margin-bottom: 16px;' }
        });

        content.createEl('label', { text: '请输入项目名确认：' });
        const input = content.createEl('input', {
            attr: { type: 'text', placeholder: projectName, style: 'width: 100%; margin: 8px 0 16px 0; padding: 8px 12px; border-radius: 8px; border: 1px solid #e8e0f0; font-size: 0.9em;' }
        });

        const btnRow = content.createDiv({ attr: { style: 'display: flex; gap: 8px; justify-content: flex-end;' } });
        const cancelBtn = btnRow.createEl('button', { text: '取消' });
        const confirmBtn = btnRow.createEl('button', {
            text: '确认删除',
            attr: { style: 'background: #ef4444; color: white; border: none; padding: 8px 20px; border-radius: 8px; cursor: pointer; font-weight: 600;' }
        });

        cancelBtn.onclick = () => modal.close();
        confirmBtn.onclick = async () => {
            if (input.value.trim() !== projectName) {
                new Notice('项目名不匹配，取消删除');
                return;
            }
            modal.close();
            await deleteProject(this.app, projectName);
            this.deps.onDeleteProject?.();
        };

        modal.open();
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
