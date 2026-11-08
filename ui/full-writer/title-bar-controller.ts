import { App, TFile } from 'obsidian';
import NovelWriterPlugin from '@/main';
import { ContextManager } from '@/engine/context-manager';
import type { ChapterListEntry } from '@/ui/project-utils';
import { MiniSettingsModal } from '@/ui/mini-settings-modal';
import { FullWriterStore } from './full-writer-store';
import { renderQuickToolsPanel } from './quick-tools-panel';
import type { ChapterRunMode } from '@/shared/chapter-run';
import { CHAPTER_QUICK_TOOL_IDS, findLongToolByCommandId } from './tool-catalog';

/**
 * TitleBarControllerDeps 类型定义。
 */
export interface TitleBarControllerDeps {
    app: App;
    plugin: NovelWriterPlugin;
    state: FullWriterStore;
    contextManager: ContextManager;
    activateTab: (tabId: string) => Promise<void>;
    switchProjectQuick: () => Promise<void>;
    getChaptersForProject: (project: string) => ChapterListEntry[];
    sortChaptersByNumber: (chapters: ChapterListEntry[]) => ChapterListEntry[];
    selectChapter: (project: string, chapter: { chapter: string; volume: string; file: TFile | null }) => Promise<void>;
    openCurrentChapterInCoWriting: () => void;
    openKnowledgeBase: () => void;
    openFingerprintLibrary: () => void;
    executeCommand: (commandId: string) => void;
    runChapterOneClick: (mode?: ChapterRunMode) => void;
    getRemainingChapterActions: () => number;
}

/**
 * TitleBarController 类。
 */
export class TitleBarController {
    private deps: TitleBarControllerDeps;

    constructor(deps: TitleBarControllerDeps) {
        this.deps = deps;
    }

    /**
     * renderTitleBar 方法。
     * @param container - 容器元素
     */
    async renderTitleBar(container: HTMLElement): Promise<void> {
        const bar = container.createDiv({ cls: 'novel-writer-fw-titlebar' });

        const titleRow = bar.createDiv({ cls: 'novel-writer-fw-title-row' });

        const backBtn = titleRow.createEl('button', {
            text: '← 返回',
            cls: 'nw-btn-back',
            attr: {
                style: 'padding:4px 10px; border:1px solid var(--background-modifier-border); border-radius:4px; cursor:pointer; background:var(--background-secondary); color:var(--text-muted); font-size:13px; margin-right:6px; white-space:nowrap;',
                title: '返回项目与章节选择界面'
            }
        });
        backBtn.onclick = () => {
            this.deps.activateTab('project-selector');
        };

        const projectSelect = titleRow.createEl('select', { cls: 'nw-select novel-writer-fw-title' });
        projectSelect.addClass('nw-title-project-select');

        const projects = await this.deps.contextManager.detectProjects();

        if (projects.length === 0) {
            projectSelect.createEl('option', { text: '📖 无项目' });
        } else {
            for (const name of projects) {
                const opt = projectSelect.createEl('option', { text: `📖 ${name}` });
                if (name === this.deps.state.project) {
                    opt.selected = true;
                }
            }
        }

        projectSelect.addEventListener('change', async () => {
            const rawText = projectSelect.value;
            const selected = rawText.replace('📖 ', '');
            if (selected !== this.deps.state.project && selected !== '无项目') {
                this.deps.state.project = selected;
                await this.deps.switchProjectQuick();
            }
        });

        if (this.deps.state.project) {
            titleRow.createSpan({ text: ' · ', cls: 'novel-writer-fw-title-sep' });

            const selectContainer = titleRow.createDiv({ cls: 'novel-writer-fw-chapter-select-container' });
            const chapterSelectEl = selectContainer.createEl('select', { cls: 'nw-select novel-writer-fw-chapter-select' });

            const chapters = this.deps.getChaptersForProject(this.deps.state.project);
            const sortedChapters = this.deps.sortChaptersByNumber(chapters);
            for (const ch of sortedChapters) {
                const isDone = ch.hasBody && (ch.status === 'written' || ch.status === 'settled');
                const statusIcon = isDone ? ' ✅' : ' 📝';
                const label = `${ch.chapter} ${ch.title || ''}${statusIcon}`.replace(/\s+/g, ' ').trim();
                const option = chapterSelectEl.createEl('option', {
                    text: label,
                    value: `${ch.chapter}|${ch.volume}|${ch.file?.path ?? ''}`
                });
                if (ch.chapter === this.deps.state.chapterName && (!ch.volume || ch.volume === this.deps.state.volume)) {
                    option.selected = true;
                }
            }

            chapterSelectEl.onchange = async () => {
                const [chapterName, volume, filePath] = chapterSelectEl.value.split('|');
                const abstract = filePath ? this.deps.app.vault.getAbstractFileByPath(filePath) : null;
                const file = abstract instanceof TFile ? abstract : null;
                // 正文路径存在但解析失败时保持旧行为（不切换），避免打开已被移动的章
                if (filePath && !file) return;
                await this.deps.selectChapter(this.deps.state.project, { chapter: chapterName, volume, file });
            };

            titleRow.createSpan({ text: ' 正文写作', cls: 'novel-writer-fw-title-suffix' });
            titleRow.createDiv({ cls: 'novel-writer-fw-title-spacer' });
        }

        const secondaryRow = titleRow.createDiv({ cls: 'novel-writer-fw-title-secondary' });

        if (this.deps.state.project && this.deps.state.chapterName) {
            const remaining = this.deps.getRemainingChapterActions();
            const runBtn = secondaryRow.createEl('button', {
                text: remaining > 0 ? `🚀 一键完成本章（剩余 ${remaining} 步）` : '✅ 本章已完成',
                cls: 'novel-writer-settings-btn',
            });
            runBtn.setAttribute('title', '一次点击跑完剩余步骤；步骤仍可见、可编辑、可单独重生成');
            runBtn.disabled = remaining === 0;
            runBtn.onclick = () => this.deps.runChapterOneClick('recommended');

            const stepBtn = secondaryRow.createEl('button', {
                text: '🐢 逐步完成',
                cls: 'novel-writer-settings-btn',
            });
            stepBtn.setAttribute('title', '一次点击启动，但逐步执行、每步可见');
            stepBtn.onclick = () => this.deps.runChapterOneClick('step');

            const coBtn = secondaryRow.createEl('button', { text: '✍️ 句级协同', cls: 'novel-writer-settings-btn' });
            coBtn.setAttribute('title', '进入句级协同写作工作台（当前章节）');
            coBtn.onclick = () => this.deps.openCurrentChapterInCoWriting();
        }

        const kbBtn = secondaryRow.createEl('button', { text: '📚 知识库管理', cls: 'novel-writer-settings-btn' });
        kbBtn.setAttribute('title', '打开知识库管理视图');
        kbBtn.onclick = () => this.deps.openKnowledgeBase();

        const fpBtn = secondaryRow.createEl('button', { text: '🔍 指纹库', cls: 'novel-writer-settings-btn' });
        fpBtn.setAttribute('title', '打开写作指纹库');
        fpBtn.onclick = () => this.deps.openFingerprintLibrary();

        const settingsBtn = secondaryRow.createEl('button', { text: '⚙️ 设置', cls: 'novel-writer-settings-btn' });
        settingsBtn.onclick = () => {
            new MiniSettingsModal(this.deps.app, this.deps.plugin).open();
        };

        // 常驻快捷工具条：章节相关高频工具直接可见，不再藏进弹窗
        if (this.deps.state.project) {
            const toolsRow = bar.createDiv({ cls: 'novel-writer-fw-quick-tools-row' });
            const tools = CHAPTER_QUICK_TOOL_IDS
                .map(findLongToolByCommandId)
                .filter((t): t is NonNullable<typeof t> => !!t);
            renderQuickToolsPanel(toolsRow, {
                compact: true,
                tools,
                project: this.deps.state.project,
                executeCommand: (commandId) => this.deps.executeCommand(commandId),
            });
        }

        // P0-4（v4.27）：版本历史入口——覆盖前自动备份已有，但用户需要一键查看/回滚
        if (this.deps.state.project && this.deps.state.chapterName) {
            const verBtn = secondaryRow.createEl('button', { text: '📜 版本', cls: 'novel-writer-settings-btn' });
            verBtn.setAttribute('title', '查看当前章节的正文版本历史（含覆盖前自动备份），可回滚');
            verBtn.onclick = async () => {
                const { ChapterVersionModal } = await import('@/ui/chapter-version-modal');
                new ChapterVersionModal(this.deps.app, {
                    project: this.deps.state.project,
                    contentType: 'chapter' as const,
                    contentKey: this.deps.state.chapterName,
                    sourcePath: this.deps.state.chapDir || '',
                    currentContent: '',
                    onSaveVersion: async () => null,
                    onRollback: async () => {},
                }).open();
            };
        }
    }
}
