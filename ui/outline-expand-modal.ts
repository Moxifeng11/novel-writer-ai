/**
 * outline-expand-modal.ts — 大纲智能扩写编辑器
 *
 * 功能：
 * - 左侧：大纲/场景列表
 * - 右侧：扩写预览和编辑
 * - 支持逐段扩写、批量扩写、选择性扩写
 * - 扩写前后对比（diff 视图）
 */

import { App, Modal, Notice, TFile } from 'obsidian';
import NovelWriterPlugin from '@/main';
import {
    OutlineToTextExpander,
    type ExpansionStrategy,
    type SceneOutline,
    type ParagraphOutline,
    type ExpansionResult,
} from '@/engine/outline-to-text-expander';
import { lineDiff, countWords } from '@/shared/diff-utils';
import { createLogger } from '@/shared/logger';
import { pjStepFile } from '@/shared/paths';
import { BodyWriter } from '@/engine/body-writer';
import { DEFAULT_BODY_FORMAT, type BodyFormatContract } from '@/shared/body-format';
import { splitSceneSections } from '@/engine/scene-expander';
import { showErrorNotice, showSuccessNotice, showWarningNotice } from './components/notice-helpers';


const log = createLogger('OutlineExpandModal');
type ExpandMode = 'chapter' | 'scene' | 'paragraph';
type ViewMode = 'edit' | 'diff';

/** 章节上下文：正文为空时用于回退读取 Scene 展开 */
export interface OutlineExpandChapterContext {
    project: string;
    volumeNum: number;
    chapterNum: number;
}

/**
 * OutlineExpandModal 类。
 */
export class OutlineExpandModal extends Modal {
    private plugin: NovelWriterPlugin;
    private expander: OutlineToTextExpander;

    private sourceOutline: string;
    private expandMode: ExpandMode = 'chapter';
    private viewMode: ViewMode = 'edit';
    private strategy: ExpansionStrategy = 'standard';
    private targetWords: number = 3000;
    private wordTolerance: number = 0.2;

    private enhanceCoolPoints: boolean = true;
    private enhanceDialogue: boolean = true;
    private enhanceEnvironment: boolean = true;
    private plantForeshadows: boolean = false;

    private scenes: SceneOutline[] = [];
    /**
     * 逐场景扩写结果与采用状态（P-15）。
     * 键 = scenes 下标；采用状态决定「应用」时是否写入。
     */
    private sceneExpansions = new Map<number, { text: string; adopted: boolean }>();
    private selectedSceneIndex: number = -1;
    private paragraphs: ParagraphOutline[] = [];
    private selectedParagraphIndices: Set<number> = new Set();

    private originalText: string = '';
    private expandedText: string = '';
    private isExpanding: boolean = false;

    private leftPanel!: HTMLElement;
    private rightPanel!: HTMLElement;
    private headerEl: HTMLElement | null = null;
    private footerEl: HTMLElement | null = null;
    private sceneListEl!: HTMLElement;
    private paragraphListEl!: HTMLElement;
    private editorEl!: HTMLTextAreaElement;
    private statusEl!: HTMLElement;
    private progressEl!: HTMLElement;
    private chapterContext: OutlineExpandChapterContext | null = null;
    private bodyFormat: BodyFormatContract | null = null;
    /** 写回回调；为 null 表示当前入口没有写回目标（退化为复制到剪贴板） */
    private onApply: ((text: string) => void | Promise<void>) | null = null;

    constructor(
        app: App,
        plugin: NovelWriterPlugin,
        sourceOutline: string = '',
        options?: {
            mode?: ExpandMode;
            targetWords?: number;
            chapterContext?: OutlineExpandChapterContext;
            /**
             * 应用结果的写回目标（缺陷修复：此前「应用」只弹提示、不落盘）。
             *
             * 传了就由调用方负责把扩写结果写进自己的编辑器/正文，
             * 弹窗只负责「成功才关窗、失败留窗重试」；不传则退化为复制到剪贴板，
             * 绝不出现「提示已应用、实际什么都没变」。
             */
            onApply?: (text: string) => void | Promise<void>;
        }
    ) {
        super(app);
        this.plugin = plugin;
        this.sourceOutline = sourceOutline;
        if (options?.mode) this.expandMode = options.mode;
        if (options?.targetWords) this.targetWords = options.targetWords;
        if (options?.chapterContext) this.chapterContext = options.chapterContext;
        if (options?.onApply) this.onApply = options.onApply;

        this.expander = new OutlineToTextExpander(
            plugin.aiEngine,
            {
                knowledgeInjector: plugin.knowledgeInjector,
                notifier: {
                    showNotice: (msg: string) => {
                        log.info('[OutlineExpand]', msg);
                    },
                },
            }
        );
    }

    /**
     * onOpen 方法。
     */
    onOpen(): void {
        this.modalEl.addClass('nw-scope');
        this.modalEl.addClass('nw-modal-xl');
        this.modalEl.addClass('nw-oe-modal');

        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('nw-oe-content');

        this.renderHeader(contentEl);
        this.renderMainContent(contentEl);
        this.renderFooter(contentEl);

        if (!this.sourceOutline.trim() && this.chapterContext) {
            void this.loadFallbackSource();
        }
    }

    /** 正文/选区为空时，以本章 Scene 展开作为扩写来源，避免左栏空白无法联想 */
    private async loadFallbackSource(): Promise<void> {
        const ctx = this.chapterContext;
        if (!ctx) return;
        const path = pjStepFile(ctx.project, ctx.volumeNum, ctx.chapterNum, 'Scene展开');
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) {
            new Notice(`⚠️ 未找到「第${ctx.chapterNum}章_Scene展开.md」，请先完成 Scene 展开步骤`, 6000);
            return;
        }
        try {
            const raw = await this.app.vault.read(file);
            const body = raw.replace(/^---[\s\S]*?---\s*/, '').replace(/^#\s+[^\n]*\n+/, '').trim();
            if (!body) {
                new Notice('⚠️ Scene 展开内容为空，请先在步骤 6 重新生成', 6000);
                return;
            }
            this.sourceOutline = body;
            if (this.editorEl && !this.editorEl.value.trim()) {
                this.editorEl.value = body;
            }
            // 本地解析 Scene 展开结构，直接填充左栏场景列表（无需先调 AI 拆分）
            const sections = splitSceneSections(body);
            if (sections.length > 0) {
                this.scenes = sections.map(({ heading, body: block }) => ({
                    index: heading.index,
                    name: heading.name,
                    summary: block.trim(),
                    isKeyScene: /key_scene|名场面/.test(block),
                }));
                this.refreshSceneList();
            }
            this.updateStatus();
            new Notice('📋 已载入本章 Scene 展开作为扩写来源', 3000);
        } catch (e) {
            log.warn('[OutlineExpand] 读取 Scene 展开失败:', e);
            showWarningNotice('读取 Scene 展开失败，请检查文件权限');
        }
    }

    private renderHeader(container: HTMLElement): void {
        // 切换模式时只重建标题栏，先移除旧的，避免重复堆叠（曾出现 3 层标题栏）
        this.headerEl?.remove();
        const header = container.createDiv({
            cls: 'nw-oe-header'
        });
        this.headerEl = header;
        container.prepend(header);

        const left = header.createDiv({ cls: 'nw-oe-header-left' });
        left.createEl('h2', { text: '✍️ 智能扩写编辑器', cls: 'nw-oe-title' });

        const modeSelector = left.createDiv({ cls: 'nw-oe-switch' });
        const modes: Array<{ key: ExpandMode; label: string }> = [
            { key: 'chapter', label: '整章扩写' },
            { key: 'scene', label: '场景扩写' },
            { key: 'paragraph', label: '段落扩写' },
        ];
        for (const mode of modes) {
            const btn = modeSelector.createEl('button', {
                text: mode.label,
                cls: 'nw-oe-tab',
            });
            btn.toggleClass('nw-is-active', this.expandMode === mode.key);
            btn.onclick = () => {
                if (this.expandMode === mode.key) return;
                this.expandMode = mode.key;
                this.renderHeader(container);
                // 左栏与底部按钮随模式变化，必须同步重建（否则切到段落模式仍是场景列表）
                this.renderLeftPanel();
                this.renderFooter(container);
                this.refreshSceneList();
            };
        }

        const right = header.createDiv({ cls: 'nw-oe-header-right' });

        const strategyLabel = right.createSpan({ text: '策略：', cls: "nw-oe-label", attr: {} });
        const strategySelect = right.createEl('select', {
            cls: 'nw-oe-select',
        }) as HTMLSelectElement;
        const strategies: Array<{ key: ExpansionStrategy; label: string }> = [
            { key: 'conservative', label: '保守扩写' },
            { key: 'standard', label: '标准扩写' },
            { key: 'aggressive', label: '激进扩写' },
        ];
        for (const s of strategies) {
            const opt = strategySelect.createEl('option', { text: s.label, value: s.key });
            if (s.key === this.strategy) opt.selected = true;
        }
        strategySelect.onchange = () => {
            this.strategy = strategySelect.value as ExpansionStrategy;
        };

        const wordInputWrap = right.createDiv({ cls: 'nw-oe-word-wrap' });
        wordInputWrap.createSpan({ text: '目标字数：', cls: "nw-oe-label", attr: {} });
        const wordInput = wordInputWrap.createEl('input', {
            type: 'number',
            value: String(this.targetWords),
            cls: 'nw-oe-word-input',
        }) as HTMLInputElement;
        wordInput.onchange = () => {
            const val = parseInt(wordInput.value, 10);
            if (!isNaN(val) && val > 0) {
                this.targetWords = val;
            }
        };

        right.createEl('button', {
            text: '✕',
            cls: "nw-btn nw-oe-close",
            attr: {}
        }).onclick = () => this.close();
    }

    private renderMainContent(container: HTMLElement): void {
        const main = container.createDiv({
            cls: 'nw-oe-main'
        });

        this.leftPanel = main.createDiv({
            cls: 'nw-oe-left'
        });
        this.rightPanel = main.createDiv({
            cls: 'nw-oe-right'
        });

        this.renderLeftPanel();
        this.renderRightPanel();
    }

    private renderLeftPanel(): void {
        this.leftPanel.empty();

        const leftHeader = this.leftPanel.createDiv({
            cls: 'nw-oe-left-header'
        });
        leftHeader.createSpan({
            text: this.expandMode === 'chapter' ? '📋 章节场景' : this.expandMode === 'scene' ? '📝 场景段落' : '📄 段落列表',
            cls: 'nw-oe-left-title'
        });

        if (this.expandMode === 'chapter') {
            const expandAllBtn = leftHeader.createEl('button', {
                text: '全部展开',
                cls: "nw-btn nw-oe-left-action",
                attr: {}
            });
            expandAllBtn.onclick = () => this.expandAllScenes();
        }

        const listContainer = this.leftPanel.createDiv({
            cls: 'nw-oe-list'
        });

        if (this.expandMode === 'chapter' || this.expandMode === 'scene') {
            this.sceneListEl = listContainer.createDiv({ cls: 'nw-oe-list-inner' });
            this.refreshSceneList();
        } else {
            this.paragraphListEl = listContainer.createDiv({ cls: 'nw-oe-list-inner' });
            this.refreshParagraphList();
        }

        const settingsPanel = this.leftPanel.createDiv({
            cls: 'nw-oe-settings'
        });
        settingsPanel.createEl('h4', { text: '增强选项', cls: 'nw-oe-settings-title' });

        const enhancements: Array<{ key: string; label: string; value: boolean }> = [
            { key: 'coolPoints', label: '🎯 爽点增强', value: this.enhanceCoolPoints },
            { key: 'dialogue', label: '💬 对话优化', value: this.enhanceDialogue },
            { key: 'environment', label: '🌿 环境描写', value: this.enhanceEnvironment },
            { key: 'foreshadows', label: '🔮 伏笔埋设', value: this.plantForeshadows },
        ];

        for (const enh of enhancements) {
            const row = settingsPanel.createDiv({ cls: 'nw-oe-enhance-row' });
            const checkbox = row.createEl('input', {
                type: 'checkbox',
                cls: 'nw-oe-enhance-check'
            }) as HTMLInputElement;
            checkbox.checked = enh.value;
            checkbox.onchange = () => {
                switch (enh.key) {
                    case 'coolPoints': this.enhanceCoolPoints = checkbox.checked; break;
                    case 'dialogue': this.enhanceDialogue = checkbox.checked; break;
                    case 'environment': this.enhanceEnvironment = checkbox.checked; break;
                    case 'foreshadows': this.plantForeshadows = checkbox.checked; break;
                }
            };
            row.createSpan({ text: enh.label, cls: 'nw-oe-enhance-label' }).onclick = () => {
                checkbox.checked = !checkbox.checked;
                checkbox.dispatchEvent(new Event('change'));
            };
        }
    }

    private renderRightPanel(): void {
        this.rightPanel.empty();

        const rightHeader = this.rightPanel.createDiv({
            cls: 'nw-oe-right-header'
        });

        const viewTabs = rightHeader.createDiv({ cls: 'nw-oe-switch' });
        const viewModes: Array<{ key: ViewMode; label: string }> = [
            { key: 'edit', label: '编辑' },
            { key: 'diff', label: '对比' },
        ];
        for (const vm of viewModes) {
            const btn = viewTabs.createEl('button', {
                text: vm.label,
                cls: 'nw-oe-tab',
            });
            btn.toggleClass('nw-is-active', this.viewMode === vm.key);
            btn.onclick = () => {
                this.viewMode = vm.key;
                this.renderRightPanel();
            };
        }

        this.statusEl = rightHeader.createSpan({
            text: `字数：${countWords(this.expandedText)}`,
            cls: 'nw-oe-status'
        });

        const editorContainer = this.rightPanel.createDiv({
            cls: 'nw-oe-editor-wrap'
        });

        if (this.viewMode === 'edit') {
            this.editorEl = editorContainer.createEl('textarea', {
                value: this.expandedText || this.sourceOutline,
                cls: 'nw-oe-editor'
            }) as HTMLTextAreaElement;
            this.editorEl.oninput = () => {
                this.expandedText = this.editorEl.value;
                this.updateStatus();
            };
        } else {
            this.renderDiffView(editorContainer);
        }

        this.progressEl = this.rightPanel.createDiv({
            cls: 'nw-oe-progress nw-is-hidden'
        });
    }

    private renderDiffView(container: HTMLElement): void {
        const diffContainer = container.createDiv({
            cls: 'nw-oe-diff'
        });

        const origCol = diffContainer.createDiv({
            cls: 'nw-oe-diff-col nw-oe-diff-col--orig'
        });
        origCol.createDiv({ text: '原文', cls: 'nw-oe-diff-head' });
        const origContent = origCol.createDiv({
            cls: 'nw-oe-diff-body'
        });

        const newCol = diffContainer.createDiv({
            cls: 'nw-oe-diff-col'
        });
        newCol.createDiv({ text: '扩写后', cls: 'nw-oe-diff-head' });
        const newContent = newCol.createDiv({
            cls: 'nw-oe-diff-body'
        });

        const diffs = lineDiff(this.originalText || this.sourceOutline, this.expandedText);

        for (const diff of diffs) {
            const line = origContent.createDiv({ cls: 'nw-oe-diff-line' });
            const line2 = newContent.createDiv({ cls: 'nw-oe-diff-line' });

            if (diff.op === 'equal') {
                line.textContent = diff.content;
                line.addClass('nw-is-equal');
                line2.textContent = diff.content;
                line2.addClass('nw-is-equal');
            } else if (diff.op === 'delete') {
                line.textContent = '- ' + diff.content;
                line.addClass('nw-is-delete');
                line2.textContent = '';
            } else if (diff.op === 'insert') {
                line.textContent = '';
                line2.textContent = '+ ' + diff.content;
                line2.addClass('nw-is-insert');
            } else if (diff.op === 'replace') {
                line.textContent = '- ' + diff.content;
                line.addClass('nw-is-delete');
                line2.textContent = '+ (修改)';
                line2.addClass('nw-is-replace-new');
            }
        }
    }

    private renderFooter(container: HTMLElement): void {
        this.footerEl?.remove();
        const footer = container.createDiv({
            cls: 'nw-oe-footer'
        });
        this.footerEl = footer;

        const leftActions = footer.createDiv({ cls: 'nw-oe-footer-actions' });

        if (this.expandMode === 'paragraph') {
            leftActions.createEl('button', {
                text: '🎯 扩写选中段落',
                cls: 'nw-btn',
            }).onclick = () => this.expandSelectedParagraphs();
        }

        leftActions.createEl('button', {
            text: '🔄 重新生成',
            cls: 'nw-btn',
        }).onclick = () => this.runExpansion();

        const rightActions = footer.createDiv({ cls: 'nw-oe-footer-actions' });

        rightActions.createEl('button', {
            text: '取消',
            cls: 'nw-btn',
        }).onclick = () => this.close();

        // 按钮文案跟着写回能力走：没有写回目标就别承诺「应用」，改说「复制」
        rightActions.createEl('button', {
            text: this.onApply ? '✅ 写入正文' : '📋 复制到剪贴板',
            cls: 'nw-btn nw-btn-primary novel-writer-primary-button',
        }).onclick = () => void this.applyResult();
    }

    private refreshSceneList(): void {
        if (!this.sceneListEl) return;
        this.sceneListEl.empty();

        if (this.scenes.length === 0) {
            this.sceneListEl.createDiv({
                text: '点击「开始扩写」生成场景列表',
                cls: 'nw-oe-empty'
            });

            const startBtn = this.sceneListEl.createEl('button', {
                text: '🚀 开始扩写',
                cls: "nw-btn nw-btn-primary novel-writer-primary-button nw-oe-start",
                attr: {}
            });
            startBtn.onclick = () => this.runChapterExpansion();
            return;
        }

        for (let i = 0; i < this.scenes.length; i++) {
            const scene = this.scenes[i];
            const expansion = this.sceneExpansions.get(i);
            // P-13：内联样式改为类名 + 状态类
            const item = this.sceneListEl.createDiv({
                cls: `nw-oe-scene-item${i === this.selectedSceneIndex ? ' nw-oe-scene-item--active' : ''}${expansion ? (expansion.adopted ? ' nw-oe-scene-item--adopted' : ' nw-oe-scene-item--skipped') : ''}`,
            });

            const header = item.createDiv({ cls: 'nw-oe-scene-head' });
            header.createSpan({
                text: `${scene.isKeyScene ? '⭐' : '📍'} 场景${scene.index}`,
                cls: 'nw-oe-scene-index'
            });
            header.createSpan({
                text: scene.name,
                cls: 'nw-oe-scene-name'
            });

            item.createDiv({
                text: scene.summary?.slice(0, 60) + (scene.summary && scene.summary.length > 60 ? '...' : ''),
                cls: 'nw-oe-scene-summary'
            });

            const actionRow = item.createDiv({ cls: 'nw-oe-scene-actions' });
            const expandBtn = actionRow.createEl('button', {
                text: '展开',
                cls: "nw-btn nw-oe-scene-expand",
                attr: {}
            });
            expandBtn.onclick = (e) => {
                e.stopPropagation();
                this.expandSingleScene(i);
            };

            // P-15：逐段采纳 —— 已扩写的场景可以单独跳过，不影响其它场景
            if (expansion) {
                const toggleBtn = actionRow.createEl('button', {
                    text: expansion.adopted ? '✓ 采用中' : '✕ 已跳过',
                    cls: `nw-btn nw-oe-adopt${expansion.adopted ? ' nw-oe-adopt--on' : ''}`,
                    attr: { title: expansion.adopted ? '点击跳过该场景（应用时不写入）' : '点击重新采用该场景' },
                });
                toggleBtn.onclick = (e) => {
                    e.stopPropagation();
                    this.toggleSceneAdoption(i);
                };
            }

            item.onclick = () => {
                this.selectedSceneIndex = i;
                if (this.expandMode === 'scene') {
                    this.loadSceneToEditor(i);
                }
                this.refreshSceneList();
            };
        }
    }

    /**
     * 切换某场景的采用状态（P-15）。
     *
     * @param sceneIndex - 场景下标
     */
    private toggleSceneAdoption(sceneIndex: number): void {
        const expansion = this.sceneExpansions.get(sceneIndex);
        if (!expansion) return;
        expansion.adopted = !expansion.adopted;
        this.refreshSceneList();
        this.rebuildAdoptedText();
        const scene = this.scenes[sceneIndex];
        new Notice(
            expansion.adopted
                ? `已采用场景${scene?.index ?? sceneIndex + 1}`
                : `已跳过场景${scene?.index ?? sceneIndex + 1}（应用时不写入）`,
            2000,
        );
    }

    /**
     * 按当前采用状态重建待应用正文（P-15）。
     *
     * 未扩写的场景保留原始场景文本，避免整篇丢内容。
     */
    private rebuildAdoptedText(): void {
        if (this.sceneExpansions.size === 0) return;
        const parts: string[] = [];
        for (let i = 0; i < this.scenes.length; i += 1) {
            const scene = this.scenes[i];
            const expansion = this.sceneExpansions.get(i);
            if (expansion && expansion.adopted) {
                parts.push(expansion.text);
                continue;
            }
            if (expansion && !expansion.adopted) continue;
            // 未扩写的场景：保留原场景大纲文本，提示用户这不是成品
            parts.push(`## 场景${scene.index}：${scene.name}\n${scene.summary}`);
        }
        this.expandedText = parts.join('\n\n').trim();
        this.updateEditorContent();
    }

    private refreshParagraphList(): void {
        if (!this.paragraphListEl) return;
        this.paragraphListEl.empty();

        if (this.paragraphs.length === 0) {
            this.paragraphListEl.createDiv({
                text: '暂无段落，请先进行场景扩写',
                cls: 'nw-oe-empty'
            });
            return;
        }

        for (let i = 0; i < this.paragraphs.length; i++) {
            const para = this.paragraphs[i];
            const isSelected = this.selectedParagraphIndices.has(i);

            const item = this.paragraphListEl.createDiv({
                cls: `nw-oe-para-item${isSelected ? ' nw-oe-para-item--selected' : ''}`,
            });

            const checkbox = item.createEl('input', {
                type: 'checkbox',
                cls: 'nw-oe-para-check'
            }) as HTMLInputElement;
            checkbox.checked = isSelected;
            checkbox.onclick = (e) => {
                e.stopPropagation();
                if (isSelected) {
                    this.selectedParagraphIndices.delete(i);
                } else {
                    this.selectedParagraphIndices.add(i);
                }
                this.refreshParagraphList();
            };

            const content = item.createDiv({ cls: 'nw-oe-para-body' });
            content.createDiv({
                text: `第${para.index}段`,
                cls: 'nw-oe-para-index'
            });
            content.createDiv({
                text: para.content.slice(0, 80) + (para.content.length > 80 ? '...' : ''),
                cls: 'nw-oe-para-text'
            });

            item.onclick = () => {
                this.loadParagraphToEditor(i);
            };
        }
    }

    /** 扩写输出与正文落盘共用同一份格式契约（来自项目「写作规则.md」） */
    private async getBodyFormat(): Promise<BodyFormatContract | undefined> {
        if (this.bodyFormat) return this.bodyFormat;
        if (!this.chapterContext?.project) return undefined;
        try {
            this.bodyFormat = await new BodyWriter({ app: this.app }).resolveContract(this.chapterContext.project);
            return this.bodyFormat;
        } catch (e) {
            log.warn('读取正文格式契约失败，使用默认契约:', e);
            return undefined;
        }
    }

    private async runChapterExpansion(): Promise<void> {
        if (this.isExpanding) return;
        this.isExpanding = true;
        this.showProgress('正在拆分章节为场景...');

        try {
            const result = await this.expander.expandChapterToScenes(
                this.sourceOutline,
                {
                    strategy: this.strategy,
                    targetWords: this.targetWords,
                    wordTolerance: this.wordTolerance,
                    enhanceCoolPoints: this.enhanceCoolPoints,
                    enhanceDialogue: this.enhanceDialogue,
                    enhanceEnvironment: this.enhanceEnvironment,
                    plantForeshadows: this.plantForeshadows,
                }
            );

            if (result.success && result.scenes) {
                this.scenes = result.scenes;
                this.expandedText = result.content;
                this.originalText = this.sourceOutline;
                this.refreshSceneList();
                this.updateEditorContent();
                showSuccessNotice('场景拆分完成');
            } else {
                showErrorNotice(result.error || '未知错误', { title: '扩写失败' });
            }
        } catch (e) {
            showErrorNotice(e instanceof Error ? e.message : String(e), { title: '扩写出错' });
        } finally {
            this.isExpanding = false;
            this.hideProgress();
        }
    }

    private async expandSingleScene(sceneIndex: number): Promise<void> {
        if (this.isExpanding) return;
        const scene = this.scenes[sceneIndex];
        if (!scene) return;

        this.isExpanding = true;
        this.showProgress(`正在扩写场景${scene.index}：${scene.name}...`);

        try {
            const sceneText = `## 场景${scene.index}：${scene.name}\n${scene.summary}`;
            const sceneWords = Math.max(500, Math.floor(this.targetWords / this.scenes.length));
            const bodyFormat = await this.getBodyFormat();

            const result = await this.expander.expandSceneToParagraphs(
                sceneText,
                {
                    strategy: this.strategy,
                    targetWords: sceneWords,
                    wordTolerance: this.wordTolerance,
                    enhanceCoolPoints: this.enhanceCoolPoints,
                    enhanceDialogue: this.enhanceDialogue,
                    enhanceEnvironment: this.enhanceEnvironment,
                    plantForeshadows: this.plantForeshadows,
                    bodyFormat,
                }
            );

            if (result.success && result.paragraphs) {
                this.paragraphs = result.paragraphs;
                this.expandedText = result.content;
                this.originalText = sceneText;
                // P-15：记住该场景的扩写结果，供逐段采纳/跳过
                this.sceneExpansions.set(sceneIndex, { text: result.content, adopted: true });
                this.refreshParagraphList();
                this.refreshSceneList();
                this.updateEditorContent();
                showSuccessNotice(`场景${scene.index}扩写完成（可单独跳过）`);
            } else {
                showErrorNotice(result.error || '未知错误', { title: '扩写失败' });
            }
        } catch (e) {
            showErrorNotice(e instanceof Error ? e.message : String(e), { title: '扩写出错' });
        } finally {
            this.isExpanding = false;
            this.hideProgress();
        }
    }

    private async expandAllScenes(): Promise<void> {
        if (this.isExpanding || this.scenes.length === 0) return;
        this.isExpanding = true;

        let fullText = '';
        const allParagraphs: ParagraphOutline[] = [];
        const bodyFormat = await this.getBodyFormat();
        const sep = bodyFormat?.separator ?? DEFAULT_BODY_FORMAT.separator;

        for (let i = 0; i < this.scenes.length; i++) {
            const scene = this.scenes[i];
            this.showProgress(`正在扩写场景 ${i + 1}/${this.scenes.length}：${scene.name}...`);

            try {
                const sceneText = `## 场景${scene.index}：${scene.name}\n${scene.summary}`;
                const sceneWords = Math.max(500, Math.floor(this.targetWords / this.scenes.length));

                const result = await this.expander.expandSceneToParagraphs(
                    sceneText,
                    {
                        strategy: this.strategy,
                        targetWords: sceneWords,
                        wordTolerance: this.wordTolerance,
                        enhanceCoolPoints: this.enhanceCoolPoints,
                        enhanceDialogue: this.enhanceDialogue,
                        enhanceEnvironment: this.enhanceEnvironment,
                        plantForeshadows: this.plantForeshadows,
                        bodyFormat,
                    }
                );

                if (result.success && result.paragraphs) {
                    const adjustedParas = result.paragraphs.map(p => ({
                        ...p,
                        index: allParagraphs.length + p.index,
                    }));
                    allParagraphs.push(...adjustedParas);
                    // P-15：逐场景留存，默认采用
                    this.sceneExpansions.set(i, { text: result.content, adopted: true });
                    fullText += result.content + sep;
                } else {
                    fullText += sceneText + sep;
                }
            } catch (e) {
                log.warn(`场景${scene.index}扩写失败:`, e);
                fullText += `## 场景${scene.index}：${scene.name}\n${scene.summary}${sep}`;
            }
        }

        this.paragraphs = allParagraphs;
        this.expandedText = fullText.trim();
        this.originalText = this.sourceOutline;
        this.updateEditorContent();
        this.refreshParagraphList();

        this.isExpanding = false;
        this.hideProgress();
        showSuccessNotice('全部场景扩写完成');
    }

    private async expandSelectedParagraphs(): Promise<void> {
        if (this.isExpanding || this.selectedParagraphIndices.size === 0) {
            if (this.selectedParagraphIndices.size === 0) {
                new Notice('请先选择要扩写的段落');
            }
            return;
        }

        this.isExpanding = true;
        const selectedIndices = Array.from(this.selectedParagraphIndices).sort((a, b) => a - b);
        const bodyFormat = await this.getBodyFormat();
        const sep = bodyFormat?.separator ?? DEFAULT_BODY_FORMAT.separator;

        for (let i = 0; i < selectedIndices.length; i++) {
            const idx = selectedIndices[i];
            const para = this.paragraphs[idx];
            if (!para) continue;

            this.showProgress(`正在扩写第 ${i + 1}/${selectedIndices.length} 个段落...`);

            try {
                const paraWords = Math.max(200, Math.floor(para.content.length * 2));
                const result = await this.expander.expandParagraph(
                    para.content,
                    {
                        strategy: this.strategy,
                        targetWords: paraWords,
                        wordTolerance: this.wordTolerance,
                        enhanceCoolPoints: this.enhanceCoolPoints,
                        enhanceDialogue: this.enhanceDialogue,
                        enhanceEnvironment: this.enhanceEnvironment,
                        bodyFormat,
                    }
                );

                if (result.success) {
                    this.paragraphs[idx] = { ...para, content: result.content };
                }
            } catch (e) {
                log.warn(`段落${idx}扩写失败:`, e);
            }
        }

        const fullText = this.paragraphs.map(p => p.content).join(sep);
        this.expandedText = fullText;
        this.originalText = this.sourceOutline;
        this.updateEditorContent();
        this.refreshParagraphList();

        this.isExpanding = false;
        this.hideProgress();
        showSuccessNotice('选中段落扩写完成');
    }

    private async runExpansion(): Promise<void> {
        if (this.expandMode === 'chapter') {
            await this.runChapterExpansion();
        } else if (this.expandMode === 'scene' && this.selectedSceneIndex >= 0) {
            await this.expandSingleScene(this.selectedSceneIndex);
        } else if (this.expandMode === 'paragraph') {
            if (this.selectedParagraphIndices.size > 0) {
                await this.expandSelectedParagraphs();
            } else {
                new Notice('请先选择要扩写的段落');
            }
        }
    }

    private loadSceneToEditor(sceneIndex: number): void {
        const scene = this.scenes[sceneIndex];
        if (!scene) return;
        const text = `## 场景${scene.index}：${scene.name}\n${scene.summary}`;
        this.originalText = text;
        this.expandedText = text;
        this.updateEditorContent();
    }

    private loadParagraphToEditor(paraIndex: number): void {
        const para = this.paragraphs[paraIndex];
        if (!para) return;
        this.originalText = para.content;
        this.expandedText = para.content;
        this.updateEditorContent();
    }

    private updateEditorContent(): void {
        if (this.editorEl) {
            this.editorEl.value = this.expandedText;
        }
        this.updateStatus();
        if (this.viewMode === 'diff') {
            this.renderRightPanel();
        }
    }

    private updateStatus(): void {
        if (this.statusEl) {
            const words = countWords(this.expandedText);
            const target = this.targetWords;
            const diff = words - target;
            const percent = Math.round((words / target) * 100);
            this.statusEl.textContent = `字数：${words} / ${target} (${percent}%)${diff > 0 ? ` +${diff}` : diff < 0 ? ` ${diff}` : ''}`;
        }
    }

    private showProgress(text: string): void {
        if (this.progressEl) {
            this.progressEl.removeClass('nw-is-hidden');
            this.progressEl.textContent = text;
        }
    }

    private hideProgress(): void {
        if (this.progressEl) {
            this.progressEl.addClass('nw-is-hidden');
        }
    }

    /**
     * 应用扩写结果。
     *
     * 有写回目标时由回调真正落盘：成功才关窗，失败留窗（结果不丢，可重试或手动复制）。
     * 没有写回目标时退化为复制到剪贴板，避免「点了应用什么都没有发生」。
     */
    private async applyResult(): Promise<void> {
        const text = this.expandedText.trim();
        if (!text) {
            new Notice('没有可应用的内容');
            return;
        }

        if (!this.onApply) {
            const copied = await this.copyToClipboard(text);
            if (copied) {
                showSuccessNotice('已复制扩写结果到剪贴板');
            } else {
                showWarningNotice('当前入口不支持写回，且复制到剪贴板失败，请手动复制右侧内容');
                return;
            }
            this.close();
            return;
        }

        try {
            await this.onApply(text);
        } catch (e) {
            log.warn('[OutlineExpand] 写回正文失败:', e);
            showErrorNotice('写回正文失败', {
                detail: e instanceof Error ? e.message : String(e),
            });
            return;
        }
        showSuccessNotice('已写入正文（Ctrl+Z 可撤销）');
        this.close();
    }

    /** 复制到剪贴板；环境不支持时返回 false，由调用方给出手动复制的提示 */
    private async copyToClipboard(text: string): Promise<boolean> {
        try {
            if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return false;
            await navigator.clipboard.writeText(text);
            return true;
        } catch (e) {
            log.warn('[OutlineExpand] 复制到剪贴板失败:', e);
            return false;
        }
    }

    /**
     * getExpandedText 方法。
     * @returns 文本结果
     */
    getExpandedText(): string {
        return this.expandedText;
    }

    /**
     * onClose 方法。
     */
    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }
}