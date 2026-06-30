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
import { CoverPickerController } from './cover-picker-controller';
import { ToolsModal } from './tools-modal';
import { WritingStyleModal } from '../writing-style-modal';
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
    file: TFile;
};

export interface ProjectSelectorDeps {
    getContextManager: () => ContextManager;
    getCoverPicker: () => CoverPickerController;
    onSelectChapter: (project: string, chapter: ChapterItem) => Promise<void>;
    onOpenWizard: (project: string) => Promise<void>;
    onOpenCoWriting: (project: string, chapter: ChapterItem) => Promise<void>;
    onDeleteProject?: () => void;
    executeCommand: (commandId: string) => void;
}

export class ProjectSelectorController {
    private app: App;
    private plugin: NovelWriterPlugin;
    private deps: ProjectSelectorDeps;

    private cleanup: (() => void) | null = null;
    private selectedProject: string | null = null;

    constructor(app: App, plugin: NovelWriterPlugin, deps: ProjectSelectorDeps) {
        this.app = app;
        this.plugin = plugin;
        this.deps = deps;
    }

    /**
     * 渲染项目选择器到指定容器
     */
    async render(container: HTMLElement): Promise<void> {
        if (this.cleanup) {
            this.cleanup();
            this.cleanup = null;
        }
        container.empty();

        const wrapper = container.createDiv({
            attr: { style: 'display: flex; gap: 0; height: 100%; position: relative;' }
        });

        const previewPanel = wrapper.createDiv({ cls: 'novel-writer-fw-preview-panel hidden' });
        const projectArea = wrapper.createDiv({ cls: 'novel-writer-fw-project-area' });

        const toolbar = projectArea.createDiv({ cls: 'novel-writer-fw-toolbar' });
        const toolsBtn = toolbar.createEl('button', { text: '⚡️ 工具', cls: 'novel-writer-fw-tools-btn' });
        toolsBtn.onclick = (e: MouseEvent) => {
            e.stopPropagation();
            new ToolsModal(this.app, this.plugin).open();
        };
        this.cleanup = null;

        const contextManager = this.deps.getContextManager();
        const projects = await contextManager.detectProjects();

        if (projects.length === 0) {
            const emptyState = projectArea.createDiv({ cls: 'novel-writer-fw-empty-state' });
            emptyState.createSpan({ text: '📚', cls: 'icon' });
            emptyState.createEl('p', { text: '当前没有项目，请先创建新项目' });
            const createBtn = emptyState.createEl('button', { text: '📁 新建项目', cls: 'novel-writer-fw-card-action-btn' });
            createBtn.onclick = () => {
                this.deps.executeCommand('novel-writer-create-project');
            };
            return;
        }

        const projectGrid = projectArea.createDiv({ cls: 'novel-writer-fw-project-grid' });

        const renderPreviewFor = async (project: string) => {
            previewPanel.empty();
            previewPanel.classList.remove('hidden');
            this.selectedProject = project;

            const meta = await getProjectMeta(this.app, project);
            const chapters = getChaptersForProject(this.app, project);
            const sortedChapters = sortChaptersByNumber(chapters);
            const writtenChapters = sortedChapters.filter(c => c.status === 'written' || c.status === 'settled');
            const progressPct = meta.totalChapters > 0
                ? Math.round((writtenChapters.length / meta.totalChapters) * 100)
                : 0;
            const nextChapter = getNextChapter(sortedChapters);

            previewPanel.createEl('h3', { text: `📖 ${project}`, cls: 'novel-writer-fw-preview-title' });

            if (meta.genre) {
                previewPanel.createSpan({ text: meta.genre, cls: 'novel-writer-fw-preview-genre g0' });
            }

            if (meta.description) {
                previewPanel.createEl('p', { text: meta.description, cls: 'novel-writer-fw-preview-desc' });
            }

            previewPanel.createDiv({ cls: 'novel-writer-fw-preview-divider' });

            const overviewSection = previewPanel.createDiv({ cls: 'novel-writer-fw-preview-section' });
            overviewSection.createEl('h4', { text: '📊 全书概览' });
            if (meta.totalWordsTarget) {
                overviewSection.createDiv({ text: `总字数目标：${meta.totalWordsTarget}`, cls: 'novel-writer-fw-preview-stat' });
            }
            overviewSection.createDiv({ text: `总章节数：${meta.totalChapters || sortedChapters.length}`, cls: 'novel-writer-fw-preview-stat' });
            overviewSection.createDiv({ text: `已完稿：${writtenChapters.length}`, cls: 'novel-writer-fw-preview-stat' });
            if (nextChapter && nextChapter.status !== 'written' && nextChapter.status !== 'settled') {
                overviewSection.createDiv({
                    text: `下一章待写：${nextChapter.chapter} · ${nextChapter.title || '无标题'}`,
                    cls: 'novel-writer-fw-preview-next-chapter'
                });
            }

            const progressBar = overviewSection.createDiv({ cls: 'novel-writer-fw-preview-progress-bar' });
            progressBar.createDiv({
                cls: 'novel-writer-fw-preview-progress-fill',
                attr: { style: `width: ${progressPct}%;` }
            });
            overviewSection.createDiv({ text: `${progressPct}% 完成`, cls: 'novel-writer-fw-preview-stat' });

            if (meta.volumes.length > 0) {
                const volSection = previewPanel.createDiv({ cls: 'novel-writer-fw-preview-section' });
                volSection.createEl('h4', { text: '📋 分卷结构' });
                const volList = volSection.createEl('ul', { cls: 'novel-writer-fw-preview-volume-list' });
                for (const v of meta.volumes) {
                    volList.createEl('li', { text: `${v.name} · ${v.range}`, cls: 'novel-writer-fw-preview-volume-item' });
                }
            }

            const actions = previewPanel.createDiv({ cls: 'novel-writer-fw-preview-actions' });
            const openBtn = actions.createEl('button', { text: '🚀 打开项目', cls: 'novel-writer-fw-preview-open-btn' });
            openBtn.onclick = async () => {
                if (nextChapter) {
                    await this.deps.onSelectChapter(project, nextChapter);
                }
            };

            const updateWsBtn = actions.createEl('button', { text: '🔄 文笔风格', cls: 'novel-writer-fw-preview-update-ws-btn' });
            updateWsBtn.onclick = async () => {
                new WritingStyleModal(this.app, this.plugin, project).open();
            };

            const wizardBtn = actions.createEl('button', { text: '🧙 项目向导', cls: 'novel-writer-fw-preview-wizard-btn' });
            wizardBtn.onclick = async () => {
                await this.deps.onOpenWizard(project);
            };

            const deleteBtn = actions.createEl('button', { text: '🗑️ 删除项目', cls: 'novel-writer-fw-preview-delete-btn' });
            deleteBtn.onclick = () => {
                this.showDeleteProjectModal(project);
            };
        };

        const hidePreview = () => {
            previewPanel.empty();
            previewPanel.classList.add('hidden');
            this.selectedProject = null;
            projectGrid.querySelectorAll('.novel-writer-fw-project-card.selected').forEach(c => c.classList.remove('selected'));
        };

        for (const project of projects) {
            const card = projectGrid.createDiv({ cls: 'novel-writer-fw-project-card' });

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

            info.createDiv({ text: `📖 ${project}`, cls: 'novel-writer-fw-card-name' });

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
            const openBtn = actions.createEl('button', { text: '✍️ 继续写作', cls: 'novel-writer-fw-card-action-btn' });
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
                    hidePreview();
                } else {
                    card.classList.add('selected');
                    renderPreviewFor(project);
                }
            };
        }
    }

    /**
     * 显示所有章选择弹窗
     */
    showAllChapters(project: string, chapters: ChapterItem[]): void {
        const modal = new Modal(this.app);
        modal.titleEl.setText(`📖 ${project} - 所有章节`);

        const list = modal.contentEl.createEl('div', { cls: 'novel-writer-chapter-selector' });

        const nextChapter = chapters.find(c => c.status !== 'written' && c.status !== 'settled');

        for (const ch of chapters) {
            const item = list.createEl('button', { cls: 'novel-writer-chapter-select-btn' });
            const isCompleted = ch.status === 'written' || ch.status === 'settled';
            const isNext = nextChapter && ch.chapter === nextChapter.chapter;

            if (isCompleted) item.classList.add('is-completed');
            if (isNext) item.classList.add('is-next');

            const stIcon = isCompleted ? ' ✅' : (isNext ? ' ✏️ 待写' : ' 📝');
            item.innerHTML = `<span class="novel-writer-chapter-num">${ch.chapter}</span><span class="novel-writer-chapter-title">${ch.title || '无标题'}${stIcon}</span>`;
            item.onclick = async () => {
                await this.deps.onSelectChapter(project, ch);
                modal.close();
            };
        }

        modal.open();
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
