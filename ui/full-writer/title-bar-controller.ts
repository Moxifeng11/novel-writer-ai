import { App, TFile } from 'obsidian';
import NovelWriterPlugin from '../../main';
import { ContextManager } from '../../engine/context-manager';
import { MiniSettingsModal } from '../mini-settings-modal';
import { FullWriterStore } from './full-writer-store';
import { UnifiedEntityManagerModal } from '../unified-entity-manager-modal';
import { UnifiedEntityGenerateModal } from '../unified-entity-generate-modal';

export interface TitleBarControllerDeps {
    app: App;
    plugin: NovelWriterPlugin;
    state: FullWriterStore;
    contextManager: ContextManager;
    activateTab: (tabId: string) => Promise<void>;
    switchProjectQuick: () => Promise<void>;
    getChaptersForProject: (project: string) => Array<{ chapter: string; volume: string; title: string; status: string; file: TFile }>;
    sortChaptersByNumber: (chapters: Array<{ chapter: string; volume: string; title: string; status: string; file: TFile }>) => Array<{ chapter: string; volume: string; title: string; status: string; file: TFile }>;
    selectChapter: (project: string, chapter: { chapter: string; volume: string; file: TFile }) => Promise<void>;
    openCurrentChapterInCoWriting: () => void;
    openKnowledgeBase: () => void;
}

export class TitleBarController {
    private deps: TitleBarControllerDeps;

    constructor(deps: TitleBarControllerDeps) {
        this.deps = deps;
    }

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
        projectSelect.style.cssText = 'width:auto;height:28px;line-height:26px;font-size:14px;font-weight:bold;background:var(--background-primary);border:1px solid var(--background-modifier-border);border-radius:4px;padding:0 8px;color:var(--text-normal);min-width:120px;';

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
                const statusIcon = ch.status === 'written' || ch.status === 'settled' ? ' ✅' : ' 📝';
                const option = chapterSelectEl.createEl('option', {
                    text: `${ch.chapter} ${ch.title || ''}${statusIcon}`,
                    value: `${ch.chapter}|${ch.volume}|${ch.file.path}`
                });
                if (ch.chapter === this.deps.state.chapterName && (!ch.volume || ch.volume === this.deps.state.volume)) {
                    option.selected = true;
                }
            }

            chapterSelectEl.onchange = async () => {
                const [chapterName, volume, filePath] = chapterSelectEl.value.split('|');
                if (!filePath) return;

                const file = this.deps.app.vault.getAbstractFileByPath(filePath);
                if (file && file instanceof TFile) {
                    await this.deps.selectChapter(this.deps.state.project, { chapter: chapterName, volume, file });
                }
            };

            titleRow.createSpan({ text: ' 正文写作', cls: 'novel-writer-fw-title-suffix' });
            titleRow.createDiv({ cls: 'novel-writer-fw-title-spacer' });
        }

        const secondaryRow = titleRow.createDiv({ cls: 'novel-writer-fw-title-secondary' });

        if (this.deps.state.project && this.deps.state.chapterName) {
            const coBtn = secondaryRow.createEl('button', { text: '✍️ 句级协同', cls: 'novel-writer-settings-btn' });
            coBtn.setAttribute('title', '进入句级协同写作工作台（当前章节）');
            coBtn.onclick = () => this.deps.openCurrentChapterInCoWriting();
        }

        const kbBtn = secondaryRow.createEl('button', { text: '📚 知识库', cls: 'novel-writer-settings-btn' });
        kbBtn.setAttribute('title', '打开知识库管理视图');
        kbBtn.onclick = () => this.deps.openKnowledgeBase();

        if (this.deps.state.project) {
            const entityBtn = secondaryRow.createEl('button', { text: '👥 实体管理', cls: 'novel-writer-settings-btn' });
            entityBtn.setAttribute('title', '打开统一实体管理（人物/地点/势力/物品）');
            entityBtn.onclick = () => {
                new UnifiedEntityManagerModal(this.deps.app, this.deps.plugin, this.deps.state.project).open();
            };
        }

        const settingsBtn = secondaryRow.createEl('button', { text: '⚙️ 设置', cls: 'novel-writer-settings-btn' });
        settingsBtn.onclick = () => {
            new MiniSettingsModal(this.deps.app, this.deps.plugin).open();
        };
    }
}
