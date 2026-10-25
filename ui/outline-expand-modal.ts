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
import NovelWriterPlugin from '../main';
import {
    OutlineToTextExpander,
    type ExpansionStrategy,
    type SceneOutline,
    type ParagraphOutline,
    type ExpansionResult,
} from '../engine/outline-to-text-expander';
import { lineDiff, countWords } from '../shared/diff-utils';
import { createLogger } from '../shared/logger';
import { pjStepFile } from '../shared/paths';
import { BodyWriter } from '../engine/body-writer';
import { DEFAULT_BODY_FORMAT, type BodyFormatContract } from '../shared/body-format';
import { splitSceneSections } from '../engine/scene-expander';


const log = createLogger('OutlineExpandModal');
type ExpandMode = 'chapter' | 'scene' | 'paragraph';
type ViewMode = 'edit' | 'diff';

/** 章节上下文：正文为空时用于回退读取 Scene 展开 */
export interface OutlineExpandChapterContext {
    project: string;
    volumeNum: number;
    chapterNum: number;
}

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

    constructor(
        app: App,
        plugin: NovelWriterPlugin,
        sourceOutline: string = '',
        options?: {
            mode?: ExpandMode;
            targetWords?: number;
            chapterContext?: OutlineExpandChapterContext;
        }
    ) {
        super(app);
        this.plugin = plugin;
        this.sourceOutline = sourceOutline;
        if (options?.mode) this.expandMode = options.mode;
        if (options?.targetWords) this.targetWords = options.targetWords;
        if (options?.chapterContext) this.chapterContext = options.chapterContext;

        this.expander = new OutlineToTextExpander(
            plugin.aiEngine,
            {
                knowledgeInjector: (plugin as any).knowledgeInjector,
                notifier: {
                    showNotice: (msg: string) => {
                        log.info('[OutlineExpand]', msg);
                    },
                },
            }
        );
    }

    onOpen(): void {
        this.modalEl.addClass('nw-scope');
        this.modalEl.addClass('nw-modal-xl');
        this.modalEl.style.height = '80vh';
        this.modalEl.style.maxHeight = '90vh';

        const { contentEl } = this;
        contentEl.empty();
        contentEl.style.height = '100%';
        contentEl.style.display = 'flex';
        contentEl.style.flexDirection = 'column';
        contentEl.style.padding = '0';

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
            new Notice('⚠️ 读取 Scene 展开失败，请检查文件权限');
        }
    }

    private renderHeader(container: HTMLElement): void {
        // 切换模式时只重建标题栏，先移除旧的，避免重复堆叠（曾出现 3 层标题栏）
        this.headerEl?.remove();
        const header = container.createDiv({
            cls: 'nw-u-p-16px-20px nw-u-bb-1px-solid-background-m-2 nw-u-d-flex-2 nw-u-ai-center-2 nw-u-jc-space-between-2 nw-u-fsh-0-2 nw-u-fwr-wrap-2 nw-u-rg-10px nw-u-cg-12px'
        });
        this.headerEl = header;
        container.prepend(header);

        const left = header.createDiv({ cls: 'nw-u-d-flex-2 nw-u-ai-center-2 nw-u-gap-16px-2 nw-u-fwr-wrap-2 nw-u-rg-8px nw-u-minw-0-2' });
        left.createEl('h2', { text: '✍️ 智能扩写编辑器', cls: 'nw-u-m-0-2 nw-u-fs-18px-2 nw-u-ws-nowrap-2 nw-u-fsh-0-2' });

        const modeSelector = left.createDiv({ cls: 'nw-u-d-flex-2 nw-u-gap-4px-2 nw-u-bg-background-secondary-2 nw-u-brd-6px-2 nw-u-p-2px-2' });
        const modes: Array<{ key: ExpandMode; label: string }> = [
            { key: 'chapter', label: '整章扩写' },
            { key: 'scene', label: '场景扩写' },
            { key: 'paragraph', label: '段落扩写' },
        ];
        for (const mode of modes) {
            const btn = modeSelector.createEl('button', {
                text: mode.label,
                attr: { style: 'padding:4px 12px;border:none;background:transparent;border-radius:4px;cursor:pointer;font-size:13px;' + (this.expandMode === mode.key ? 'background:var(--interactive-accent);color:white;' : 'color:var(--text-muted);') }
            });
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

        const right = header.createDiv({ cls: 'nw-u-d-flex-2 nw-u-ai-center-2 nw-u-gap-8px-2 nw-u-fwr-wrap-2 nw-u-rg-8px nw-u-marginleft-auto-2' });

        const strategyLabel = right.createSpan({ text: '策略：', cls: "nw-text-muted nw-u-ws-nowrap-2 nw-u-fsh-0-2", attr: {} });
        const strategySelect = right.createEl('select', {
            attr: { style: 'padding:4px 8px;border-radius:4px;border:1px solid var(--background-modifier-border);background:var(--background-primary);font-size:13px;' }
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

        const wordInputWrap = right.createDiv({ cls: 'nw-u-d-flex-2 nw-u-ai-center-2 nw-u-gap-4px-2 nw-u-fsh-0-2' });
        wordInputWrap.createSpan({ text: '目标字数：', cls: "nw-text-muted nw-u-ws-nowrap-2 nw-u-fsh-0-2", attr: {} });
        const wordInput = wordInputWrap.createEl('input', {
            type: 'number',
            value: String(this.targetWords),
            attr: { style: 'width:80px;padding:4px 6px;border-radius:4px;border:1px solid var(--background-modifier-border);font-size:13px;' }
        }) as HTMLInputElement;
        wordInput.onchange = () => {
            const val = parseInt(wordInput.value, 10);
            if (!isNaN(val) && val > 0) {
                this.targetWords = val;
            }
        };

        right.createEl('button', {
            text: '✕',
            cls: "nw-btn nw-u-p-4px-10px-2 nw-u-fs-16px-2 nw-u-b-none nw-u-bg-transparent nw-u-cur-pointer-2 nw-u-c-text-muted-2",
            attr: {}
        }).onclick = () => this.close();
    }

    private renderMainContent(container: HTMLElement): void {
        const main = container.createDiv({
            cls: 'nw-u-flex-1-2 nw-u-d-flex-2 nw-u-ov-hidden-2 nw-u-minh-0-2'
        });

        this.leftPanel = main.createDiv({
            cls: 'nw-u-w-320px nw-u-brt-1px-solid-background-m-2 nw-u-d-flex-2 nw-u-fd-column-2 nw-u-ov-hidden-2'
        });
        this.rightPanel = main.createDiv({
            cls: 'nw-u-flex-1-2 nw-u-d-flex-2 nw-u-fd-column-2 nw-u-ov-hidden-2'
        });

        this.renderLeftPanel();
        this.renderRightPanel();
    }

    private renderLeftPanel(): void {
        this.leftPanel.empty();

        const leftHeader = this.leftPanel.createDiv({
            cls: 'nw-u-p-12px-16px-2 nw-u-bb-1px-solid-background-m-2 nw-u-d-flex-2 nw-u-ai-center-2 nw-u-jc-space-between-2 nw-u-fsh-0-2'
        });
        leftHeader.createSpan({
            text: this.expandMode === 'chapter' ? '📋 章节场景' : this.expandMode === 'scene' ? '📝 场景段落' : '📄 段落列表',
            cls: 'nw-u-fwt-500-2 nw-u-fs-14px-2'
        });

        if (this.expandMode === 'chapter') {
            const expandAllBtn = leftHeader.createEl('button', {
                text: '全部展开',
                cls: "nw-btn nw-u-fs-12px-2 nw-u-p-2px-8px-2",
                attr: {}
            });
            expandAllBtn.onclick = () => this.expandAllScenes();
        }

        const listContainer = this.leftPanel.createDiv({
            cls: 'nw-u-flex-1-2 nw-u-ovy-auto-2 nw-u-p-8px-2'
        });

        if (this.expandMode === 'chapter' || this.expandMode === 'scene') {
            this.sceneListEl = listContainer.createDiv({ cls: 'nw-u-d-flex-2 nw-u-fd-column-2 nw-u-gap-4px-2' });
            this.refreshSceneList();
        } else {
            this.paragraphListEl = listContainer.createDiv({ cls: 'nw-u-d-flex-2 nw-u-fd-column-2 nw-u-gap-4px-2' });
            this.refreshParagraphList();
        }

        const settingsPanel = this.leftPanel.createDiv({
            cls: 'nw-u-bt-1px-solid-background-m-2 nw-u-p-12px-16px-2 nw-u-fsh-0-2'
        });
        settingsPanel.createEl('h4', { text: '增强选项', cls: 'nw-u-m-0-0-8px-0-2 nw-u-fs-13px-2 nw-u-c-text-muted-2' });

        const enhancements: Array<{ key: string; label: string; value: boolean }> = [
            { key: 'coolPoints', label: '🎯 爽点增强', value: this.enhanceCoolPoints },
            { key: 'dialogue', label: '💬 对话优化', value: this.enhanceDialogue },
            { key: 'environment', label: '🌿 环境描写', value: this.enhanceEnvironment },
            { key: 'foreshadows', label: '🔮 伏笔埋设', value: this.plantForeshadows },
        ];

        for (const enh of enhancements) {
            const row = settingsPanel.createDiv({ cls: 'nw-u-d-flex-2 nw-u-ai-center-2 nw-u-gap-8px-2 nw-u-marginbottom-6px-2' });
            const checkbox = row.createEl('input', {
                type: 'checkbox',
                cls: 'nw-u-cur-pointer-2'
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
            row.createSpan({ text: enh.label, cls: 'nw-u-fs-13px-2 nw-u-cur-pointer-2' }).onclick = () => {
                checkbox.checked = !checkbox.checked;
                checkbox.dispatchEvent(new Event('change'));
            };
        }
    }

    private renderRightPanel(): void {
        this.rightPanel.empty();

        const rightHeader = this.rightPanel.createDiv({
            cls: 'nw-u-p-12px-16px-2 nw-u-bb-1px-solid-background-m-2 nw-u-d-flex-2 nw-u-ai-center-2 nw-u-jc-space-between-2 nw-u-fsh-0-2'
        });

        const viewTabs = rightHeader.createDiv({ cls: 'nw-u-d-flex-2 nw-u-gap-4px-2 nw-u-bg-background-secondary-2 nw-u-brd-6px-2 nw-u-p-2px-2' });
        const viewModes: Array<{ key: ViewMode; label: string }> = [
            { key: 'edit', label: '编辑' },
            { key: 'diff', label: '对比' },
        ];
        for (const vm of viewModes) {
            const btn = viewTabs.createEl('button', {
                text: vm.label,
                attr: { style: 'padding:4px 12px;border:none;background:transparent;border-radius:4px;cursor:pointer;font-size:13px;' + (this.viewMode === vm.key ? 'background:var(--interactive-accent);color:white;' : 'color:var(--text-muted);') }
            });
            btn.onclick = () => {
                this.viewMode = vm.key;
                this.renderRightPanel();
            };
        }

        this.statusEl = rightHeader.createSpan({
            text: `字数：${countWords(this.expandedText)}`,
            cls: 'nw-text-muted'
        });

        const editorContainer = this.rightPanel.createDiv({
            cls: 'nw-u-flex-1-2 nw-u-ov-hidden-2 nw-u-pos-relative'
        });

        if (this.viewMode === 'edit') {
            this.editorEl = editorContainer.createEl('textarea', {
                value: this.expandedText || this.sourceOutline,
                cls: 'nw-u-w-100-2 nw-u-h-100-2 nw-u-b-none nw-u-outline-none nw-u-resize-none nw-u-p-16px-2 nw-u-fontfamily-font-interface nw-u-fs-14px-2 nw-u-lh-1-8 nw-u-bg-background-primary-2 nw-u-c-text-normal-2 nw-u-bx-border-box'
            }) as HTMLTextAreaElement;
            this.editorEl.oninput = () => {
                this.expandedText = this.editorEl.value;
                this.updateStatus();
            };
        } else {
            this.renderDiffView(editorContainer);
        }

        this.progressEl = this.rightPanel.createDiv({
            cls: 'nw-u-p-8px-16px nw-u-bt-1px-solid-background-m-2 nw-u-fs-12px-2 nw-u-c-text-muted-2 nw-u-d-none nw-u-fsh-0-2'
        });
    }

    private renderDiffView(container: HTMLElement): void {
        const diffContainer = container.createDiv({
            cls: 'nw-u-d-flex-2 nw-u-h-100-2 nw-u-ov-hidden-2'
        });

        const origCol = diffContainer.createDiv({
            cls: 'nw-u-flex-1-2 nw-u-d-flex-2 nw-u-fd-column-2 nw-u-brt-1px-solid-background-m-2 nw-u-ov-hidden-2'
        });
        origCol.createDiv({ text: '原文', cls: 'nw-u-p-8px-12px-2 nw-u-bg-background-secondary-2 nw-u-fs-12px-2 nw-u-c-text-muted-2 nw-u-fwt-500-2 nw-u-fsh-0-2' });
        const origContent = origCol.createDiv({
            cls: 'nw-u-flex-1-2 nw-u-ovy-auto-2 nw-u-p-12px-2 nw-u-fs-14px-2 nw-u-lh-1-8 nw-u-fontfamily-font-monospace'
        });

        const newCol = diffContainer.createDiv({
            cls: 'nw-u-flex-1-2 nw-u-d-flex-2 nw-u-fd-column-2 nw-u-ov-hidden-2'
        });
        newCol.createDiv({ text: '扩写后', cls: 'nw-u-p-8px-12px-2 nw-u-bg-background-secondary-2 nw-u-fs-12px-2 nw-u-c-text-muted-2 nw-u-fwt-500-2 nw-u-fsh-0-2' });
        const newContent = newCol.createDiv({
            cls: 'nw-u-flex-1-2 nw-u-ovy-auto-2 nw-u-p-12px-2 nw-u-fs-14px-2 nw-u-lh-1-8 nw-u-fontfamily-font-monospace'
        });

        const diffs = lineDiff(this.originalText || this.sourceOutline, this.expandedText);

        for (const diff of diffs) {
            const line = document.createElement('div');
            line.style.whiteSpace = 'pre-wrap';
            line.style.wordBreak = 'break-word';
            line.style.padding = '2px 6px';
            line.style.borderRadius = '2px';
            line.style.marginBottom = '1px';

            const line2 = document.createElement('div');
            line2.style.whiteSpace = 'pre-wrap';
            line2.style.wordBreak = 'break-word';
            line2.style.padding = '2px 6px';
            line2.style.borderRadius = '2px';
            line2.style.marginBottom = '1px';

            if (diff.op === 'equal') {
                line.textContent = diff.content;
                line.style.opacity = '0.7';
                line2.textContent = diff.content;
                line2.style.opacity = '0.7';
            } else if (diff.op === 'delete') {
                line.textContent = diff.content;
                line.style.background = 'rgba(255, 100, 100, 0.15)';
                line.style.color = 'var(--text-error)';
                line.textContent = '- ' + diff.content;
                line2.textContent = '';
            } else if (diff.op === 'insert') {
                line.textContent = '';
                line2.textContent = '+ ' + diff.content;
                line2.style.background = 'rgba(100, 255, 100, 0.15)';
                line2.style.color = 'var(--text-success)';
            } else if (diff.op === 'replace') {
                line.textContent = '- ' + diff.content;
                line.style.background = 'rgba(255, 100, 100, 0.15)';
                line.style.color = 'var(--text-error)';
                line2.textContent = '+ (修改)';
                line2.style.background = 'rgba(100, 255, 100, 0.1)';
            }

            origContent.appendChild(line);
            newContent.appendChild(line2);
        }
    }

    private renderFooter(container: HTMLElement): void {
        this.footerEl?.remove();
        const footer = container.createDiv({
            cls: 'nw-u-p-12px-20px nw-u-bt-1px-solid-background-m-2 nw-u-d-flex-2 nw-u-ai-center-2 nw-u-jc-space-between-2 nw-u-fsh-0-2 nw-u-gap-12px-2'
        });
        this.footerEl = footer;

        const leftActions = footer.createDiv({ cls: 'nw-u-d-flex-2 nw-u-gap-8px-2' });

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

        const rightActions = footer.createDiv({ cls: 'nw-u-d-flex-2 nw-u-gap-8px-2' });

        rightActions.createEl('button', {
            text: '取消',
            cls: 'nw-btn',
        }).onclick = () => this.close();

        rightActions.createEl('button', {
            text: '✅ 应用',
            cls: 'nw-btn nw-btn-primary novel-writer-primary-button',
        }).onclick = () => this.applyResult();
    }

    private refreshSceneList(): void {
        if (!this.sceneListEl) return;
        this.sceneListEl.empty();

        if (this.scenes.length === 0) {
            this.sceneListEl.createDiv({
                text: '点击「开始扩写」生成场景列表',
                cls: 'nw-u-p-20px-2 nw-u-ta-center-2 nw-u-c-text-muted-2 nw-u-fs-13px-2'
            });

            const startBtn = this.sceneListEl.createEl('button', {
                text: '🚀 开始扩写',
                cls: "nw-btn nw-btn-primary novel-writer-primary-button nw-u-m-8px-auto nw-u-d-block",
                attr: {}
            });
            startBtn.onclick = () => this.runChapterExpansion();
            return;
        }

        for (let i = 0; i < this.scenes.length; i++) {
            const scene = this.scenes[i];
            const item = this.sceneListEl.createDiv({
                attr: {
                    style: 'padding:10px 12px;border-radius:6px;cursor:pointer;border:1px solid transparent;' +
                        (i === this.selectedSceneIndex
                            ? 'background:var(--background-modifier-hover);border-color:var(--interactive-accent);'
                            : 'hover:background:var(--background-modifier-hover);')
                }
            });

            const header = item.createDiv({ cls: 'nw-u-d-flex-2 nw-u-ai-center-2 nw-u-gap-6px-2 nw-u-marginbottom-4px-2' });
            header.createSpan({
                text: `${scene.isKeyScene ? '⭐' : '📍'} 场景${scene.index}`,
                cls: 'nw-u-fwt-500-2 nw-u-fs-13px-2 nw-u-fsh-0-2'
            });
            header.createSpan({
                text: scene.name,
                cls: 'nw-u-fs-13px-2 nw-u-ov-hidden-2 nw-u-textoverflow-ellipsis-2 nw-u-ws-nowrap-2 nw-u-flex-1-2 nw-u-minw-0-2'
            });

            item.createDiv({
                text: scene.summary?.slice(0, 60) + (scene.summary && scene.summary.length > 60 ? '...' : ''),
                cls: 'nw-u-fs-12px-2 nw-u-c-text-muted-2 nw-u-lh-1-5-2'
            });

            const actionRow = item.createDiv({ cls: 'nw-u-d-flex-2 nw-u-gap-4px-2 nw-u-margintop-6px' });
            const expandBtn = actionRow.createEl('button', {
                text: '展开',
                cls: "nw-btn nw-u-fs-11px-2 nw-u-p-2px-8px-2 nw-u-flex-1-2",
                attr: {}
            });
            expandBtn.onclick = (e) => {
                e.stopPropagation();
                this.expandSingleScene(i);
            };

            item.onclick = () => {
                this.selectedSceneIndex = i;
                if (this.expandMode === 'scene') {
                    this.loadSceneToEditor(i);
                }
                this.refreshSceneList();
            };
        }
    }

    private refreshParagraphList(): void {
        if (!this.paragraphListEl) return;
        this.paragraphListEl.empty();

        if (this.paragraphs.length === 0) {
            this.paragraphListEl.createDiv({
                text: '暂无段落，请先进行场景扩写',
                cls: 'nw-u-p-20px-2 nw-u-ta-center-2 nw-u-c-text-muted-2 nw-u-fs-13px-2'
            });
            return;
        }

        for (let i = 0; i < this.paragraphs.length; i++) {
            const para = this.paragraphs[i];
            const isSelected = this.selectedParagraphIndices.has(i);

            const item = this.paragraphListEl.createDiv({
                attr: {
                    style: 'padding:10px 12px;border-radius:6px;cursor:pointer;border:1px solid transparent;display:flex;gap:8px;' +
                        (isSelected
                            ? 'background:var(--background-modifier-hover);border-color:var(--interactive-accent);'
                            : 'hover:background:var(--background-modifier-hover);')
                }
            });

            const checkbox = item.createEl('input', {
                type: 'checkbox',
                cls: 'nw-u-margintop-3px nw-u-fsh-0-2 nw-u-cur-pointer-2'
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

            const content = item.createDiv({ cls: 'nw-u-flex-1-2 nw-u-minw-0-2' });
            content.createDiv({
                text: `第${para.index}段`,
                cls: 'nw-u-fwt-500-2 nw-u-fs-12px-2 nw-u-marginbottom-2px-2 nw-u-c-text-muted-2'
            });
            content.createDiv({
                text: para.content.slice(0, 80) + (para.content.length > 80 ? '...' : ''),
                cls: 'nw-u-fs-12px-2 nw-u-lh-1-5-2 nw-u-ov-hidden-2 nw-u-textoverflow-ellipsis-2 nw-u-d-webkit-box-2 nw-u-webkitlineclamp-2-2 nw-u-webkitboxorient-vertical-2'
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
                new Notice('✅ 场景拆分完成');
            } else {
                new Notice('❌ 扩写失败: ' + (result.error || '未知错误'));
            }
        } catch (e) {
            new Notice('❌ 扩写出错: ' + (e instanceof Error ? e.message : String(e)));
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
                this.refreshParagraphList();
                this.updateEditorContent();
                new Notice(`✅ 场景${scene.index}扩写完成`);
            } else {
                new Notice('❌ 扩写失败: ' + (result.error || '未知错误'));
            }
        } catch (e) {
            new Notice('❌ 扩写出错: ' + (e instanceof Error ? e.message : String(e)));
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
        new Notice('✅ 全部场景扩写完成');
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
        new Notice('✅ 选中段落扩写完成');
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
            this.progressEl.style.display = 'block';
            this.progressEl.textContent = text;
        }
    }

    private hideProgress(): void {
        if (this.progressEl) {
            this.progressEl.style.display = 'none';
        }
    }

    private applyResult(): void {
        if (!this.expandedText.trim()) {
            new Notice('没有可应用的内容');
            return;
        }
        new Notice('✅ 已应用扩写结果');
        this.close();
    }

    getExpandedText(): string {
        return this.expandedText;
    }

    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }
}
