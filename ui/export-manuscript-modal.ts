/**
 * export-manuscript-modal.ts — 成稿导出（P0-1）
 *
 * 选择项目与格式，编译为 Markdown / TXT / HTML 稿件。
 * HTML 带打印样式，可在浏览器中打印为 PDF。
 */

import { App, Modal, Notice, Setting, TFolder, TFile } from 'obsidian';
import type NovelWriterPlugin from '../main';
import {
    compileManuscript,
    type ManuscriptChapter,
    type ManuscriptFormat,
} from '../engine/export/manuscript-compiler';
import { exportTextFile } from '../shared/export-file';
import { createLogger } from '../shared/logger';

const log = createLogger('ExportManuscriptModal');

const FORMAT_OPTIONS: Record<ManuscriptFormat, { label: string; ext: string; mime: string }> = {
    markdown: { label: 'Markdown（.md）', ext: 'md', mime: 'text/markdown;charset=utf-8' },
    text: { label: '纯文本（.txt）', ext: 'txt', mime: 'text/plain;charset=utf-8' },
    html: { label: 'HTML（可打印为 PDF）', ext: 'html', mime: 'text/html;charset=utf-8' },
};

export class ExportManuscriptModal extends Modal {
    private plugin: NovelWriterPlugin;
    private project: string;
    private format: ManuscriptFormat = 'markdown';
    private includeVolumeHeadings = true;
    private includeChapterTitles = true;

    private summaryEl!: HTMLElement;
    private hintEl!: HTMLElement;

    constructor(app: App, plugin: NovelWriterPlugin, project: string) {
        super(app);
        this.plugin = plugin;
        this.project = project;
    }

    onOpen(): void {
        this.modalEl.addClass('nw-scope', 'nw-modal');
        this.titleEl.setText('📦 成稿导出');
        const { contentEl } = this;
        contentEl.empty();

        const projects = listProjects(this.app);
        if (projects.length === 0) {
            contentEl.createEl('p', { text: '⚠️ 未找到含「03-大纲与章节」的项目目录。' });
            return;
        }
        if (!projects.includes(this.project)) this.project = projects[0];

        new Setting(contentEl)
            .setName('项目')
            .addDropdown((dropdown) => {
                for (const project of projects) dropdown.addOption(project, project);
                dropdown.setValue(this.project);
                dropdown.onChange((value) => {
                    this.project = value;
                    this.refreshSummary();
                });
            });

        new Setting(contentEl)
            .setName('格式')
            .setDesc('HTML 可在浏览器中打开后打印为 PDF')
            .addDropdown((dropdown) => {
                for (const [value, option] of Object.entries(FORMAT_OPTIONS)) {
                    dropdown.addOption(value, option.label);
                }
                dropdown.setValue(this.format);
                dropdown.onChange((value) => {
                    this.format = value as ManuscriptFormat;
                    this.refreshHint();
                });
            });

        new Setting(contentEl)
            .setName('包含卷标题')
            .addToggle((toggle) =>
                toggle.setValue(this.includeVolumeHeadings).onChange((value) => {
                    this.includeVolumeHeadings = value;
                })
            );

        new Setting(contentEl)
            .setName('包含章标题')
            .addToggle((toggle) =>
                toggle.setValue(this.includeChapterTitles).onChange((value) => {
                    this.includeChapterTitles = value;
                })
            );

        this.summaryEl = contentEl.createDiv({ cls: 'nw-export-summary' });
        this.hintEl = contentEl.createDiv({ cls: 'nw-export-hint' });

        const footer = contentEl.createDiv({ cls: 'nw-modal-footer' });
        const cancel = footer.createEl('button', {
            text: '取消',
            cls: 'nw-btn nw-btn-secondary',
            attr: { type: 'button' },
        });
        cancel.onclick = () => this.close();

        const exportBtn = footer.createEl('button', {
            text: '导出',
            cls: 'nw-btn nw-btn-primary',
            attr: { type: 'button' },
        });
        exportBtn.onclick = async () => {
            exportBtn.disabled = true;
            exportBtn.setText('正在编译...');
            try {
                await this.exportManuscript();
            } finally {
                exportBtn.disabled = false;
                exportBtn.setText('导出');
            }
        };

        this.refreshSummary();
        this.refreshHint();
    }

    onClose(): void {
        this.contentEl.empty();
    }

    private refreshHint(): void {
        const option = FORMAT_OPTIONS[this.format];
        this.hintEl.setText(
            this.format === 'html'
                ? `将导出 .${option.ext}；用浏览器打开后选择「打印 → 另存为 PDF」。`
                : `将导出 .${option.ext}（${option.mime.split(';')[0]}）。`
        );
    }

    private refreshSummary(): void {
        const files = listChapterFiles(this.app, this.project);
        const words = files.reduce((sum, file) => {
            const cache = this.app.metadataCache.getFileCache(file);
            const count = cache?.frontmatter?.['word_count'];
            return sum + (typeof count === 'number' ? count : 0);
        }, 0);
        this.summaryEl.setText(
            files.length === 0
                ? '⚠️ 该项目下未找到正文文件。'
                : `📄 共 ${files.length} 章${words > 0 ? ` · 约 ${words} 字（frontmatter 统计）` : ''}`
        );
    }

    private async exportManuscript(): Promise<void> {
        const chapters = await collectChapters(this.app, this.project);
        if (chapters.length === 0) {
            new Notice('⚠️ 未找到可导出的正文');
            return;
        }

        const compiled = compileManuscript(chapters, {
            format: this.format,
            includeVolumeHeadings: this.includeVolumeHeadings,
            includeChapterTitles: this.includeChapterTitles,
            bookTitle: this.project,
        });

        const option = FORMAT_OPTIONS[this.format];
        const date = new Date().toISOString().slice(0, 10);
        const result = await exportTextFile(
            this.app,
            `${this.project}-全稿-${date}.${option.ext}`,
            compiled.content,
            { mime: option.mime }
        );

        if (!result.ok) return;

        const emptyNote = compiled.emptyChapters > 0 ? `，其中 ${compiled.emptyChapters} 章为空` : '';
        new Notice(
            `✅ 已导出 ${compiled.chapterCount} 章 / ${compiled.wordCount} 字${emptyNote}`,
            6000
        );
        log.info('[ExportManuscript] 导出完成:', {
            project: this.project,
            format: this.format,
            chapters: compiled.chapterCount,
            words: compiled.wordCount,
            mode: result.mode,
        });
        this.close();
    }
}

/** 列出含 `03-大纲与章节` 的项目目录 */
export function listProjects(app: App): string[] {
    const root = app.vault.getRoot();
    return root.children
        .filter((child): child is TFolder => child instanceof TFolder)
        .filter((folder) => app.vault.getAbstractFileByPath(`${folder.path}/03-大纲与章节`) != null)
        .map((folder) => folder.path)
        .sort();
}

/** 列出项目正文文件（正文/第N卷/第N章_正文.md） */
export function listChapterFiles(app: App, project: string): TFile[] {
    const prefix = `${project}/03-大纲与章节/正文/`;
    return app.vault.getFiles().filter(
        (file) => file.path.startsWith(prefix) && /第\d+章_正文\.md$/.test(file.name)
    );
}

/** 读取并解析章节元数据 + 正文 */
export async function collectChapters(app: App, project: string): Promise<ManuscriptChapter[]> {
    const files = listChapterFiles(app, project);
    const chapters: ManuscriptChapter[] = [];

    for (const file of files) {
        const match = file.path.match(/\/正文\/(第\d+卷)\/(第(\d+)章)_正文\.md$/);
        if (!match) continue;
        const cache = app.metadataCache.getFileCache(file);
        const title = cache?.frontmatter?.['标题'];
        chapters.push({
            volume: match[1],
            chapter: match[2],
            chapterNum: parseInt(match[3], 10),
            title: typeof title === 'string' ? title.trim() : '',
            content: await app.vault.read(file),
            path: file.path,
        });
    }

    return chapters;
}
