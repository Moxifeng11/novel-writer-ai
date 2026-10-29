/**
 * export-manuscript-modal.ts — 成稿导出（P0-1）
 *
 * 选择项目与格式，编译为 Markdown / TXT / HTML / EPUB / DOCX 稿件。
 * HTML 带打印样式，可在浏览器中打印为 PDF；EPUB/DOCX 由本地构建器生成二进制。
 */

import { App, Modal, Notice, Setting, TFolder, TFile } from 'obsidian';
import type NovelWriterPlugin from '../main';
import {
    compileManuscript,
    type ManuscriptChapter,
    type ManuscriptFormat,
} from '../engine/export/manuscript-compiler';
import { buildEpub } from '../engine/export/epub-builder';
import { buildDocx } from '../engine/export/docx-builder';
import type { BuiltBook, BookBuildOptions } from '../engine/export/epub-builder';
import { exportBinaryFile, exportTextFile } from '../shared/export-file';
import { createLogger } from '../shared/logger';
import { getProjectMeta } from './project-utils';
import type { CreationMode } from '../shared/creation-mode';
import { collectModeManuscript, listModeUnits } from '../shared/mode-content';
import { MODE_LIBRARY_ROOT_LIST } from '../domains/kernel/project-locator';

const log = createLogger('ExportManuscriptModal');

type ExportFormat = ManuscriptFormat | 'epub' | 'docx';

const FORMAT_OPTIONS: Record<ExportFormat, {
    label: string;
    ext: string;
    mime: string;
    hint: string;
    binary?: boolean;
}> = {
    markdown: {
        label: 'Markdown（.md）',
        ext: 'md',
        mime: 'text/markdown;charset=utf-8',
        hint: '保留标题层级，适合二次编辑或导入其他写作工具。',
    },
    text: {
        label: '纯文本 TXT（.txt）',
        ext: 'txt',
        mime: 'text/plain;charset=utf-8',
        hint: '通用纯文本，适合番茄/起点等平台的 TXT 投稿。',
    },
    html: {
        label: 'HTML（可打印为 PDF）',
        ext: 'html',
        mime: 'text/html;charset=utf-8',
        hint: '用浏览器打开后选择「打印 → 另存为 PDF」。',
    },
    epub: {
        label: 'EPUB 电子书（.epub）',
        ext: 'epub',
        mime: 'application/epub+zip',
        hint: '手机/阅读器/微信读书导入；Kindle 可用「发送到 Kindle」自动转换。',
        binary: true,
    },
    docx: {
        label: 'Word 文档（.docx）',
        ext: 'docx',
        mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        hint: '编辑与出版社常用格式；标题层级、首行缩进与分页已排好。',
        binary: true,
    },
};

export class ExportManuscriptModal extends Modal {
    private plugin: NovelWriterPlugin;
    private project: string;
    private format: ExportFormat = 'markdown';
    private includeVolumeHeadings = true;
    private includeChapterTitles = true;
    private unitLabel = '章';
    private creationMode: CreationMode = 'long';
    /** EPUB/DOCX 的元数据作者；留空则不写 creator */
    private author = '';
    /** TXT 是否加 UTF-8 BOM（旧版记事本兼容） */
    private textBom = false;

    private summaryEl!: HTMLElement;
    private hintEl!: HTMLElement;
    private authorRowEl: HTMLElement | null = null;
    private bomRowEl: HTMLElement | null = null;

    constructor(
        app: App,
        plugin: NovelWriterPlugin,
        project: string,
        private readonly options: { onExported?: () => void } = {},
    ) {
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
        if (projects.length === 0 && !this.project) {
            contentEl.createEl('p', { text: '⚠️ 未找到可导出的项目目录。' });
            return;
        }
        // 外部入口（创作流程/命令）传进来的项目可能不在 listProjects 的识别范围内
        // （例如旧版根目录项目），不能静默切换到别的项目去导出。
        if (this.project && !projects.includes(this.project)) projects.unshift(this.project);
        if (!this.project) this.project = projects[0];

        new Setting(contentEl)
            .setName('项目')
            .addDropdown((dropdown) => {
                for (const project of projects) dropdown.addOption(project, project);
                dropdown.setValue(this.project);
                dropdown.onChange((value) => {
                    this.project = value;
                    void this.refreshSummary();
                });
            });

        new Setting(contentEl)
            .setName('格式')
            .setDesc('EPUB 适合阅读器；DOCX 适合编辑/投稿；HTML 可打印为 PDF')
            .addDropdown((dropdown) => {
                for (const [value, option] of Object.entries(FORMAT_OPTIONS)) {
                    dropdown.addOption(value, option.label);
                }
                dropdown.setValue(this.format);
                dropdown.onChange((value) => {
                    this.format = value as ExportFormat;
                    this.syncFormatRows();
                    this.refreshHint();
                });
            });

        const authorSetting = new Setting(contentEl)
            .setName('作者（EPUB/DOCX 元数据）')
            .setDesc('可留空；只影响电子书/Word 的作者字段，不写进正文')
            .addText((text) => text
                .setPlaceholder('笔名或真名')
                .setValue(this.author)
                .onChange((value) => { this.author = value.trim(); }));
        this.authorRowEl = authorSetting.settingEl;

        const bomSetting = new Setting(contentEl)
            .setName('TXT 带 UTF-8 BOM')
            .setDesc('旧版 Windows 记事本识别中文更稳；多数投稿平台不需要')
            .addToggle((toggle) => toggle
                .setValue(this.textBom)
                .onChange((value) => { this.textBom = value; }));
        this.bomRowEl = bomSetting.settingEl;

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

        this.syncFormatRows();
        void this.refreshSummary();
        this.refreshHint();
    }

    onClose(): void {
        this.contentEl.empty();
    }

    private refreshHint(): void {
        const option = FORMAT_OPTIONS[this.format];
        const modeHint = this.creationMode === 'short'
            ? '短篇按「节」输出，适合番茄短篇投稿。'
            : this.creationMode === 'script'
                ? '剧本按「集」输出，保留场次/人物/动作/对白格式。'
                : '';
        this.hintEl.setText(
            `将导出 .${option.ext}。${option.hint}${modeHint ? ` ${modeHint}` : ''}`
        );
    }

    /**
     * 短篇/剧本没有「卷」的概念，隐藏卷标题开关；章标题按模式改称节/集标题。
     * 作者与 BOM 选项只在对应格式下出现。
     */
    private syncFormatRows(): void {
        const isLong = this.creationMode === 'long';
        const chapterHeading = this.creationMode === 'short'
            ? '包含节标题'
            : this.creationMode === 'script'
                ? '包含集标题'
                : '包含章标题';
        if (this.authorRowEl) {
            this.authorRowEl.style.display = this.format === 'epub' || this.format === 'docx' ? '' : 'none';
        }
        if (this.bomRowEl) {
            this.bomRowEl.style.display = this.format === 'text' ? '' : 'none';
        }
        // 直接操作 Setting 行 DOM：不同 Obsidian 版本 Setting.addToggle 的返回值不稳定，
        // 保存实例再 setName 会静默失效。
        for (const row of Array.from(this.contentEl.querySelectorAll<HTMLElement>('.setting-item'))) {
            const nameEl = row.querySelector('.setting-item-name');
            const name = nameEl?.textContent?.trim();
            if (name === '包含卷标题') row.style.display = isLong ? '' : 'none';
            if (name === '包含章标题' || name === '包含节标题' || name === '包含集标题') {
                nameEl!.textContent = chapterHeading;
            }
        }
    }

    private async refreshSummary(): Promise<void> {
        try {
            const meta = await getProjectMeta(this.app, this.project);
            this.creationMode = meta.creationMode;
            this.unitLabel = meta.unitLabel;
        } catch {
            this.creationMode = 'long';
            this.unitLabel = '章';
        }
        this.refreshHint();
        this.syncFormatRows();
        const files = this.creationMode === 'long'
            ? listChapterFiles(this.app, this.project)
            : listModeUnits(this.app, this.project, this.creationMode).map(unit => unit.file);
        const words = files.reduce((sum, file) => {
            const cache = this.app.metadataCache.getFileCache(file);
            const count = cache?.frontmatter?.['word_count'];
            return sum + (typeof count === 'number' ? count : 0);
        }, 0);
        this.summaryEl.setText(
            files.length === 0
                ? '⚠️ 该项目下未找到正文文件。'
                : `📄 共 ${files.length} ${this.unitLabel}${words > 0 ? ` · 约 ${words} 字（frontmatter 统计）` : ''}`
        );
    }

    private async exportManuscript(): Promise<void> {
        const chapters = this.creationMode === 'long'
            ? await collectChapters(this.app, this.project)
            : await collectModeManuscript(this.app, this.project, this.creationMode);
        if (chapters.length === 0) {
            new Notice('⚠️ 未找到可导出的正文');
            return;
        }

        const bookTitle = this.project.split('/').pop() || this.project;
        const includeVolumeHeadings = this.creationMode === 'long' ? this.includeVolumeHeadings : false;
        const bookOptions: BookBuildOptions = {
            includeVolumeHeadings,
            includeChapterTitles: this.includeChapterTitles,
            unitLabel: this.unitLabel,
            metadata: {
                title: bookTitle,
                author: this.author || undefined,
                language: 'zh-CN',
            },
        };

        const option = FORMAT_OPTIONS[this.format];
        const date = new Date().toISOString().slice(0, 10);
        const modeSuffix = this.creationMode === 'short' ? '短篇' : this.creationMode === 'script' ? '剧本' : '全稿';
        const filename = `${this.project}-${modeSuffix}-${date}.${option.ext}`;

        let chapterCount = 0;
        let wordCount = 0;
        let emptyChapters = 0;
        let result;

        if (this.format === 'epub' || this.format === 'docx') {
            const built = this.format === 'epub'
                ? buildEpub(chapters, bookOptions)
                : buildDocx(chapters, bookOptions);
            chapterCount = built.chapterCount;
            wordCount = built.wordCount;
            emptyChapters = built.emptyChapters;
            result = await exportBinaryFile(this.app, filename, built.data, { mime: option.mime });
        } else {
            const compiled = compileManuscript(chapters, {
                format: this.format,
                includeVolumeHeadings,
                includeChapterTitles: this.includeChapterTitles,
                bookTitle,
                unitLabel: this.unitLabel,
            });
            chapterCount = compiled.chapterCount;
            wordCount = compiled.wordCount;
            emptyChapters = compiled.emptyChapters;
            const content = this.format === 'text' && this.textBom
                ? `\uFEFF${compiled.content}`
                : compiled.content;
            result = await exportTextFile(this.app, filename, content, { mime: option.mime });
        }

        if (!result.ok) return;

        const emptyNote = emptyChapters > 0 ? `，其中 ${emptyChapters} ${this.unitLabel}为空` : '';
        new Notice(
            `✅ 已导出 ${chapterCount} ${this.unitLabel} / ${wordCount} 字${emptyNote}`,
            6000
        );
        log.info('[ExportManuscript] 导出完成:', {
            project: this.project,
            format: this.format,
            chapters: chapterCount,
            words: wordCount,
            mode: result.mode,
        });
        // 流程页用它标记「导出阶段完成」；只在真正成功时回调，取消/失败不算
        this.options.onExported?.();
        this.close();
    }
}

/** 列出长篇/短篇/剧本三库中的项目目录 */
/**
 * 非项目根目录：模板、导出产物、协同草稿、资料库等。
 * 它们可能带上「03-大纲与章节」之类的子目录（模板骨架会被复制进去），
 * 不能按「有章节目录就是项目」的旧判据识别，否则会出现在项目卡里。
 */
const NON_PROJECT_ROOTS = new Set([
    '元文件', '导出文件', '协同文件', '写作知识库', '指纹资料库',
    'deepseek-harness', 'node_modules', 'apps',
]);

export function listProjects(app: App): string[] {
    const root = app.vault.getRoot();
    const projects: string[] = [];
    for (const folder of root.children) {
        if (!(folder instanceof TFolder)) continue;
        if (NON_PROJECT_ROOTS.has(folder.name)) continue;
        if (folder.name.startsWith('.') || folder.name.startsWith('_')) continue;
        if (MODE_LIBRARY_ROOT_LIST.includes(folder.name)) {
            for (const child of folder.children) {
                if (child instanceof TFolder && !NON_PROJECT_ROOTS.has(child.name)) projects.push(child.path);
            }
            continue;
        }
        if (app.vault.getAbstractFileByPath(`${folder.path}/03-大纲与章节`) != null
            || app.vault.getAbstractFileByPath(`${folder.path}/短篇创作`) != null
            || app.vault.getAbstractFileByPath(`${folder.path}/剧本创作`) != null) {
            projects.push(folder.path);
        }
    }
    return projects.sort();
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
