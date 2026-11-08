import { App, Modal, Notice } from 'obsidian';
import NovelWriterPlugin from '@/main';
import { ReviewAgent } from '@/engine/review-agent';

/**
 * ReviewChapterModal 类。
 */
export class ReviewChapterModal extends Modal {
    private plugin: NovelWriterPlugin;
    private reviewAgent: ReviewAgent;

    constructor(app: App, plugin: NovelWriterPlugin) {
        super(app);
        this.plugin = plugin;
        this.reviewAgent = plugin.reviewAgent;
    }

    /**
     * onOpen 方法。
     */
    onOpen(): void {
    this.modalEl.addClass('nw-scope');
        const { contentEl } = this;

        // ═══ v3.4.8: 两层CSS规则 — 见 docs/CSS变量注入与两层规则_全插件避坑指南.md ═══
        const wrapper = contentEl.parentElement as HTMLElement;
        if (wrapper) {
            wrapper.addClass('nw-modal');
        }

        // 工作台/项目页没有 activeFile：优先用界面当前章节，避免「请先打开正文文件」
        const target = this.plugin.getActiveChapterTarget();

        contentEl.empty();
        contentEl.createEl('h2', { text: '🔍 连贯性审查' });

        if (!target) {
            contentEl.createEl('p', { text: '❌ 请先在完整写作工作台选择章节，或打开章节正文文件' });
            return;
        }

        const { project, volume: volumeName, chapterName, bodyPath } = target;

        contentEl.createEl('p', { text: `正在审查 ${project} → ${chapterName}` });

        const singleButton = contentEl.createEl('button', { text: '审查当前一章', cls: 'nw-btn nw-btn-primary novel-writer-primary-button' });
        singleButton.onclick = async () => {
            await this.reviewAgent.reviewChapter(project, bodyPath);
            this.close();
        };

        const volumeButton = contentEl.createEl('button', { text: '审查整卷连贯性', cls: 'nw-btn nw-btn-secondary novel-writer-button' });
        volumeButton.onclick = async () => {
            await this.reviewAgent.reviewVolume(project, volumeName);
            this.close();
        };
    }

    /**
     * onClose 方法。
     */
    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }
}
