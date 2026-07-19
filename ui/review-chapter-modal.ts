import { App, Modal, Notice } from 'obsidian';
import NovelWriterPlugin from '../main';
import { ReviewAgent } from '../engine/review-agent';

export class ReviewChapterModal extends Modal {
    private plugin: NovelWriterPlugin;
    private reviewAgent: ReviewAgent;

    constructor(app: App, plugin: NovelWriterPlugin) {
        super(app);
        this.plugin = plugin;
        this.reviewAgent = plugin.reviewAgent;
    }

    onOpen(): void {
    this.modalEl.addClass('nw-scope');
        const { contentEl } = this;

        // ═══ v3.4.8: 两层CSS规则 — 见 docs/CSS变量注入与两层规则_全插件避坑指南.md ═══
        const wrapper = contentEl.parentElement as HTMLElement;
        if (wrapper) {
            wrapper.addClass('nw-modal');
            wrapper.style.setProperty('margin', 'auto', 'important');
        }
        contentEl.style.width = '100%';
        contentEl.style.setProperty('overflow-y', 'auto', 'important');

        const activeFile = this.app.workspace.getActiveFile();

        contentEl.empty();
        contentEl.createEl('h2', { text: '🔍 连贯性审查' });

        if (!activeFile) {
            contentEl.createEl('p', { text: '❌ 请先打开要审查的章节正文文件' });
            return;
        }

        const path = activeFile.path;
        // v4.0：正文位于 03-大纲与章节/正文/第N卷/第M章_正文.md。
        // 与 ReviewAgent.reviewChapter 的解析保持一致（仅接受标准正文文件）。
        const chapMatch = path.match(/03-大纲与章节\/正文\/(第\d+卷)\/(第\d+章)_正文\.md$/);

        if (!chapMatch) {
            contentEl.createEl('p', { text: '❌ 请先打开章节正文文件（03-大纲与章节/正文/第N卷/第M章_正文.md）' });
            return;
        }
        const volumeName = chapMatch[1];
        const chapterName = chapMatch[2];

        const project = path.split('/')[0];

        contentEl.createEl('p', { text: `正在审查 ${project} → ${chapterName}` });

        const singleButton = contentEl.createEl('button', { text: '审查当前一章', cls: 'nw-btn nw-btn-primary novel-writer-primary-button' });
        singleButton.onclick = async () => {
            await this.reviewAgent.reviewChapter(project, path);
            this.close();
        };

        const volumeButton = contentEl.createEl('button', { text: '审查整卷连贯性', cls: 'nw-btn nw-btn-secondary novel-writer-button' });
        volumeButton.onclick = async () => {
            await this.reviewAgent.reviewVolume(project, volumeName);
            this.close();
        };
    }

    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }
}
