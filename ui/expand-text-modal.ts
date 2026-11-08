/**
 * expand-text-modal.ts — 通用段落扩写模态框
 *
 * 功能：对编辑器中选中的任意段落进行 AI 扩写
 * 支持扩写倍数（1.5x / 2x / 3x）与风格（细节丰富 / 情节推进 / 情感深化 / 场景描写）
 */

import { App, Editor, Modal, Notice } from 'obsidian';
import NovelWriterPlugin from '@/main';

type ExpandStyle = '细节丰富' | '情节推进' | '情感深化' | '场景描写';

/**
 * 扩写文本弹窗。
 */
export class ExpandTextModal extends Modal {
    private plugin: NovelWriterPlugin;
    private selectedText: string;
    private editor: Editor;

    private multiplier: number = 2;
    private style: ExpandStyle = '细节丰富';
    private resultText: string = '';

    constructor(app: App, plugin: NovelWriterPlugin, selectedText: string, editor: Editor) {
        super(app);
        this.plugin = plugin;
        this.selectedText = selectedText;
        this.editor = editor;
    }

    /**
     * onOpen 方法。
     */
    onOpen(): void {
        this.modalEl.addClass('nw-scope');
        const { contentEl } = this;
        contentEl.empty();

        if (!this.selectedText || this.selectedText.trim().length === 0) {
            contentEl.createEl('h2', { text: '📝 段落扩写' });
            contentEl.createEl('p', {
                text: '❌ 请先在编辑器中选中需要扩写的段落，再执行此命令。',
            });
            const closeBtn = contentEl.createEl('button', { text: '关闭', cls: 'nw-btn' });
            closeBtn.onclick = () => this.close();
            return;
        }

        this.renderInputForm();
    }

    private renderInputForm(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: '📝 段落扩写' });

        // 选中文本预览
        const previewSection = contentEl.createDiv();
        previewSection.createEl('h4', { text: '选中文本预览' });
        const previewBox = previewSection.createEl('div');
        previewBox.setText(this.selectedText);
        previewBox.addClass('nw-preview-box');

        // 扩写倍数
        const multSection = contentEl.createDiv();
        multSection.addClass('nw-section-gap');
        multSection.createEl('h4', { text: '扩写倍数' });
        const multBtns = multSection.createDiv();
        multBtns.addClass('nw-btn-row');
        const multOptions: [number, string][] = [[1.5, '1.5x'], [2, '2x'], [3, '3x']];
        for (const [val, label] of multOptions) {
            const btn = multBtns.createEl('button', { text: label, cls: 'nw-btn' });
            if (val === this.multiplier) btn.addClass('is-active');
            btn.addClass('nw-btn-min-64');
            btn.onclick = () => {
                this.multiplier = val;
                multBtns.querySelectorAll('button').forEach(b => b.removeClass('is-active'));
                btn.addClass('is-active');
            };
        }

        // 扩写风格
        const styleSection = contentEl.createDiv();
        styleSection.addClass('nw-section-gap');
        styleSection.createEl('h4', { text: '扩写风格' });
        const styleBtns = styleSection.createDiv();
        styleBtns.addClass('nw-btn-row');
        const styleOptions: ExpandStyle[] = ['细节丰富', '情节推进', '情感深化', '场景描写'];
        for (const s of styleOptions) {
            const btn = styleBtns.createEl('button', { text: s, cls: 'nw-btn' });
            if (s === this.style) btn.addClass('is-active');
            btn.onclick = () => {
                this.style = s;
                styleBtns.querySelectorAll('button').forEach(b => b.removeClass('is-active'));
                btn.addClass('is-active');
            };
        }

        // 操作按钮
        const actions = contentEl.createDiv();
        actions.addClass('nw-btn-row-end');
        const startBtn = actions.createEl('button', {
            text: '开始扩写',
            cls: 'nw-btn nw-btn-primary novel-writer-primary-button',
        });
        startBtn.onclick = () => this.runExpand();
        const cancelBtn = actions.createEl('button', { text: '取消', cls: 'nw-btn' });
        cancelBtn.onclick = () => this.close();
    }

    private renderLoading(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: '📝 段落扩写' });
        contentEl.createEl('p', {
            text: `⏳ 正在调用 AI 扩写（${this.multiplier}x · ${this.style}），请稍候...`,
        });
    }

    private async runExpand(): Promise<void> {
        this.renderLoading();

        const systemPrompt =
            '你是专业小说写手，负责将给定段落扩写为更丰富的内容。保持原文的叙事风格、人称视角和语调，扩写内容需连贯自然。';
        const userPrompt = `请将以下段落扩写为原长度的约 ${this.multiplier} 倍。

风格要求：${this.style}

原文：
---
${this.selectedText}
---

要求：
1. 保持原文的叙事风格和人称视角
2. 扩写后内容连贯自然，不破坏原文核心结构与情节走向
3. 直接输出扩写后的正文，不要添加任何解释、标注或前后缀`;

        try {
            const maxTokens = Math.min(
                8000,
                Math.max(2048, this.selectedText.length * this.multiplier * 2),
            );
            const resp = await this.plugin.aiEngine.callAI(
                systemPrompt,
                userPrompt,
                this.plugin.settings.proModel,
                0.8,
                maxTokens,
                { isWritingTask: true },
            );
            if (resp.error || !resp.content) {
                new Notice(`扩写失败: ${resp.error || '返回为空'}`);
                this.renderInputForm();
                return;
            }
            this.resultText = resp.content.trim();
            this.renderResult();
        } catch (e) {
            new Notice(`扩写出错: ${e instanceof Error ? e.message : String(e)}`);
            this.renderInputForm();
        }
    }

    private renderResult(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: '📝 段落扩写结果' });

        // 对比预览（两列）
        const compare = contentEl.createDiv();
        compare.addClass('nw-compare-row');

        const origCol = compare.createDiv();
        origCol.addClass('nw-cols-280');
        origCol.createEl('h4', { text: '原文' });
        const origBox = origCol.createEl('div');
        origBox.setText(this.selectedText);
        origBox.addClass('nw-preview-box', 'nw-preview-box-lg');

        const newCol = compare.createDiv();
        newCol.addClass('nw-cols-280');
        newCol.createEl('h4', { text: '扩写后' });
        const newBox = newCol.createEl('div');
        newBox.setText(this.resultText);
        newBox.addClass('nw-preview-box', 'nw-preview-box-lg', 'nw-preview-box-accent');

        // 操作按钮
        const actions = contentEl.createDiv();
        actions.addClass('nw-btn-row-end');
        const applyBtn = actions.createEl('button', {
            text: '✅ 应用替换原文',
            cls: 'nw-btn nw-btn-primary novel-writer-primary-button',
        });
        applyBtn.onclick = () => {
            this.applyResult();
            new Notice('✅ 已替换原文', 2000);
            this.close();
        };
        const retryBtn = actions.createEl('button', { text: '🔄 重新扩写', cls: 'nw-btn' });
        retryBtn.onclick = () => this.renderInputForm();
        const cancelBtn = actions.createEl('button', { text: '取消', cls: 'nw-btn' });
        cancelBtn.onclick = () => this.close();
    }

    private applyResult(): void {
        const currentSelection = this.editor.getSelection();
        if (currentSelection === this.selectedText) {
            this.editor.replaceSelection(this.resultText);
        } else {
            // 选区已变化（如用户在弹窗打开后编辑了其他内容），回退为在当前光标处插入
            const cursor = this.editor.getCursor();
            this.editor.replaceRange(this.resultText, cursor);
        }
    }

    /**
     * onClose 方法。
     */
    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }
}
