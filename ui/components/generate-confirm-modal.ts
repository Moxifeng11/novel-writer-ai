/**
 * generate-confirm-modal.ts — 生成结果确认弹窗（2026-11-27，云笔「四态」的本仓实现）
 *
 * ## 为什么需要它
 *
 * 本仓正文生成后 `BodyWriter.write()` 直接覆盖原稿。AI 写坏了只能手动回滚。
 * 云笔的做法：生成结果先进「待确认」，用户点了「采用」才落库。
 *
 * 引擎侧已就绪（commit `d8210792`）：
 * - `BodyWriteRequest.requireConfirm` → 写 `.pending/` 而非正文
 * - `BodyWriteResult.pendingPath` → 待确认文件路径
 * - `BodyWriter.adoptPending()` / `discardPending()`
 *
 * 本文件补 UI 入口：展示预览 + 三态选择。
 *
 * ## 三态（不是二态）
 *
 * 除了「采用 / 弃用」，还提供「稍后决定」——关掉弹窗但**不删待确认文件**。
 * 理由：用户可能在忙、需要对比原稿、或想先看看别处。
 * 强制二选一会造成「随手点了弃用然后后悔」。
 */
import { App, Modal } from 'obsidian';
import { t } from '@/i18n';
import { truncatePreview, formatDelta } from './generate-confirm-format';

/** 用户选择结果 */
export type GenerateConfirmChoice = 'adopt' | 'discard' | 'later';

/** 弹窗选项 */
export interface GenerateConfirmOptions {
    /** 章节名（如「第12章 暗巷」） */
    chapterName: string;
    /** 待确认正文内容（用于预览） */
    preview: string;
    /** 字数 */
    wordCount: number;
    /** 原正文内容（可选；用于「相比原稿」的信息展示） */
    originalPreview?: string;
    /** 待确认文件的 vault 路径（展示在弹窗里，便于用户手动打开） */
    pendingPath?: string;
}

/**
 * 生成结果确认弹窗。
 *
 * @example
 * ```ts
 * const choice = await new GenerateConfirmModal(app, {
 *     chapterName: '第12章 暗巷',
 *     preview: pendingContent,
 *     wordCount: 2650,
 *     pendingPath: '书A/正文/第1卷/.pending/第12章_正文.md',
 * }).openAndWait();
 * if (choice === 'adopt') await writer.adoptPending(pendingPath, { writingMode: 'continue' });
 * if (choice === 'discard') await writer.discardPending(pendingPath);
 * // 'later' → 什么都不做，文件留着下次再决定
 * ```
 */
export class GenerateConfirmModal extends Modal {
    private readonly options: GenerateConfirmOptions;
    private resolve: ((choice: GenerateConfirmChoice) => void) | null = null;
    /** 用户是否已做出选择（避免 onClose 时重复 resolve） */
    private settled = false;

    constructor(app: App, options: GenerateConfirmOptions) {
        super(app);
        this.options = options;
    }

    /**
     * 打开弹窗并等待用户选择。
     *
     * @returns 用户选择（关掉弹窗但没点按钮 = 'later'）
     */
    openAndWait(): Promise<GenerateConfirmChoice> {
        return new Promise((resolve) => {
            this.resolve = resolve;
            this.open();
        });
    }

    /** 完成选择（幂等） */
    private settle(choice: GenerateConfirmChoice): void {
        if (this.settled) return;
        this.settled = true;
        this.resolve?.(choice);
        this.close();
    }

    /**
     * 渲染弹窗内容（Obsidian Modal 生命周期钩子）。
     *
     * 布局：标题 → 字数变化 → 「正文尚未修改」提示 → 正文预览 → 待确认路径 → 三态按钮。
     *
     * @example
     * // 由 open() 自动调用，无需手动触发
     */
    onOpen(): void {
        const { contentEl, options } = this;
        contentEl.empty();
        contentEl.addClass('nw-generate-confirm');

        // ── 头部 ──
        contentEl.createEl('h2', {
            text: t('cowrite.generateConfirm.title', { chapter: options.chapterName }),
            cls: 'nw-generate-confirm-title',
        });
        contentEl.createDiv({
            cls: 'nw-generate-confirm-meta',
            text: t('cowrite.generateConfirm.meta', {
                words: String(options.wordCount),
                delta: options.originalPreview
                    ? formatDelta(options.wordCount, options.originalPreview.length)
                    : t('cowrite.generateConfirm.noOriginal'),
            }),
        });

        // ── 提示：正文尚未修改 ──
        contentEl.createDiv({
            cls: 'nw-generate-confirm-note',
            text: t('cowrite.generateConfirm.notWritten'),
        });

        // ── 预览 ──
        const previewWrap = contentEl.createDiv({ cls: 'nw-generate-confirm-preview' });
        const { text: shown, truncated } = truncatePreview(options.preview);
        previewWrap.createEl('pre', { text: shown, cls: 'nw-generate-confirm-pre' });
        if (truncated) {
            previewWrap.createDiv({
                cls: 'nw-generate-confirm-truncated',
                text: t('cowrite.generateConfirm.truncated', {
                    shown: String(shown.length),
                    total: String(options.preview.length),
                }),
            });
        }

        // ── 待确认文件路径（便于手动对比） ──
        if (options.pendingPath) {
            const pathRow = contentEl.createDiv({ cls: 'nw-generate-confirm-path' });
            pathRow.createSpan({ text: t('cowrite.generateConfirm.pendingFile') + ' ' });
            pathRow.createEl('code', { text: options.pendingPath });
        }

        // ── 按钮区（三态） ──
        const btns = contentEl.createDiv({ cls: 'nw-generate-confirm-actions' });

        const adoptBtn = btns.createEl('button', {
            text: t('cowrite.generateConfirm.adopt'),
            cls: 'nw-btn nw-btn-primary mod-cta',
        });
        adoptBtn.addEventListener('click', () => this.settle('adopt'));

        const laterBtn = btns.createEl('button', {
            text: t('cowrite.generateConfirm.later'),
            cls: 'nw-btn nw-btn-secondary',
        });
        laterBtn.addEventListener('click', () => this.settle('later'));

        const discardBtn = btns.createEl('button', {
            text: t('cowrite.generateConfirm.discard'),
            cls: 'nw-btn nw-btn-danger',
        });
        discardBtn.addEventListener('click', () => this.settle('discard'));

        // Esc / 点击外部 → 视为「稍后决定」（不删文件）
        // Modal.close() 是唯一出口，override 它来兜底
        const originalClose = this.close.bind(this);
        this.close = () => {
            if (!this.settled) {
                this.settled = true;
                this.resolve?.('later');
            }
            originalClose();
        };
    }

    /**
     * 清理弹窗内容（Obsidian Modal 生命周期钩子）。
     *
     * @example
     * // 由 close() 自动调用，无需手动触发
     */
    onClose(): void {
        this.contentEl.empty();
    }
}
