/**
 * rewrite-suggestion-modal.ts — AI 改写建议（P0-2）
 *
 * 对编辑器中选中的文本生成 2-3 个改写方案，支持一键替换回正文。
 * AI 不可用时由 RewriteSuggestionEngine 自动降级为规则建议。
 */

import { App, Editor, Modal, Notice } from 'obsidian';
import type { EditorPosition } from 'obsidian';
import NovelWriterPlugin from '../main';
import { RewriteSuggestionEngine } from '../engine/quality/rewrite-suggestion-engine';
import {
    SUGGESTION_TYPES,
    SUGGESTION_TYPE_LABELS,
    SUGGESTION_TYPE_DESC,
} from '../engine/quality/rewrite-types';
import type {
    RewriteContext,
    RewriteResult,
    RewriteSuggestion,
    SuggestionType,
} from '../engine/quality/rewrite-types';

export class RewriteSuggestionModal extends Modal {
    private plugin: NovelWriterPlugin;
    private editor: Editor;
    private originalText: string;
    private from: EditorPosition;
    private to: EditorPosition;
    private suggestionType: SuggestionType = 'polish';
    private engine: RewriteSuggestionEngine;
    private resultEl?: HTMLElement;
    private typeButtons: HTMLButtonElement[] = [];
    private generating = false;

    constructor(app: App, plugin: NovelWriterPlugin, editor: Editor, selectedText: string) {
        super(app);
        this.plugin = plugin;
        this.editor = editor;
        this.originalText = selectedText;
        this.from = editor.getCursor('from');
        this.to = editor.getCursor('to');
        this.engine = new RewriteSuggestionEngine({
            maxSuggestions: 3,
            aiEngine: {
                callAI: async (system, user, options) => {
                    const response = await this.plugin.aiEngine.callAI(
                        system,
                        user,
                        undefined,
                        0.7,
                        2048,
                        { signal: options?.signal }
                    );
                    if (response.error) throw new Error(response.error);
                    return { content: response.content ?? '' };
                },
            },
        });
    }

    onOpen(): void {
        this.modalEl.addClass('nw-scope', 'nw-modal');
        this.titleEl.setText('✨ AI 改写建议');
        const { contentEl } = this;
        contentEl.empty();

        if (!this.originalText.trim()) {
            contentEl.createEl('p', {
                text: '❌ 请先在编辑器中选中需要改写的文本，再执行此命令。',
            });
            const closeBtn = contentEl.createEl('button', { text: '关闭', cls: 'nw-btn' });
            closeBtn.onclick = () => this.close();
            return;
        }

        contentEl.createEl('div', {
            text: this.originalText,
            cls: 'nw-rewrite-preview',
        });

        contentEl.createEl('h4', { text: '改写类型' });
        const typeRow = contentEl.createDiv({ cls: 'nw-rewrite-types' });
        for (const type of SUGGESTION_TYPES) {
            const btn = typeRow.createEl('button', {
                text: SUGGESTION_TYPE_LABELS[type],
                cls: 'nw-btn',
                attr: { type: 'button', title: SUGGESTION_TYPE_DESC[type] },
            });
            if (type === this.suggestionType) btn.addClass('is-active');
            btn.onclick = () => {
                this.suggestionType = type;
                for (const b of this.typeButtons) b.removeClass('is-active');
                btn.addClass('is-active');
            };
            this.typeButtons.push(btn);
        }

        this.resultEl = contentEl.createDiv({ cls: 'nw-rewrite-results' });

        const footer = contentEl.createDiv({ cls: 'nw-modal-footer' });
        const cancel = footer.createEl('button', {
            text: '取消',
            cls: 'nw-btn nw-btn-secondary',
            attr: { type: 'button' },
        });
        cancel.onclick = () => this.close();

        const generate = footer.createEl('button', {
            text: '生成建议',
            cls: 'nw-btn nw-btn-primary',
            attr: { type: 'button' },
        });
        generate.onclick = () => { void this.generate(); };
    }

    onClose(): void {
        if (this.generating) this.engine.cancel();
        this.contentEl.empty();
    }

    /** 生成本次改写建议（AI 失败时引擎内部自动降级） */
    private async generate(): Promise<void> {
        if (this.generating || !this.resultEl) return;
        this.generating = true;
        this.resultEl.empty();
        this.resultEl.createEl('p', { text: '⏳ 正在生成改写建议...' });

        const activeFile = this.app.workspace.getActiveFile();
        const context: RewriteContext = {
            projectId: activeFile?.path.split('/')[0] || '',
            chapterId: activeFile?.path || 'unknown',
            text: this.originalText,
            textStartOffset: this.editor.posToOffset(this.from),
            fullText: this.editor.getValue(),
            trigger: 'selection',
            suggestionType: this.suggestionType,
        };

        try {
            const result = await this.engine.generate(context);
            this.renderResult(result);
        } catch (e) {
            this.resultEl.empty();
            this.resultEl.createEl('p', {
                text: `❌ 生成失败：${e instanceof Error ? e.message : String(e)}`,
            });
        } finally {
            this.generating = false;
        }
    }

    private renderResult(result: RewriteResult): void {
        if (!this.resultEl) return;
        this.resultEl.empty();

        if (result.isFallback) {
            this.resultEl.createEl('p', {
                cls: 'nw-rewrite-fallback',
                text: `⚠️ AI 不可用，已降级为规则建议${result.fallbackReason ? `：${result.fallbackReason}` : ''}`,
            });
        }

        if (result.suggestions.length === 0) {
            this.resultEl.createEl('p', { text: '未生成可用建议，请调整选中文本后重试。' });
            return;
        }

        for (const suggestion of result.suggestions) {
            this.renderSuggestion(suggestion);
        }
    }

    private renderSuggestion(suggestion: RewriteSuggestion): void {
        if (!this.resultEl) return;
        const card = this.resultEl.createDiv({ cls: 'nw-rewrite-card' });

        const header = card.createDiv({ cls: 'nw-rewrite-card-header' });
        header.createEl('strong', { text: suggestion.title });
        header.createEl('span', {
            cls: 'nw-rewrite-confidence',
            text: `置信度 ${Math.round(suggestion.confidence * 100)}%`,
        });

        card.createEl('div', { cls: 'nw-rewrite-desc', text: suggestion.description });
        card.createEl('div', {
            cls: 'nw-rewrite-card-text',
            text: suggestion.rewrittenText,
        });

        const apply = card.createEl('button', {
            text: '应用此方案',
            cls: 'nw-btn nw-btn-primary',
            attr: { type: 'button' },
        });
        apply.onclick = () => this.applySuggestion(suggestion);
    }

    private applySuggestion(suggestion: RewriteSuggestion): void {
        try {
            this.editor.replaceRange(suggestion.rewrittenText, this.from, this.to);
            new Notice(`✅ 已应用「${suggestion.title}」`, 3000);
            this.close();
        } catch (e) {
            new Notice(`❌ 应用失败：${e instanceof Error ? e.message : String(e)}`, 4000);
        }
    }
}
