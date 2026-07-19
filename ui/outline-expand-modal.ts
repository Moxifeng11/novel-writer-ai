/**
 * outline-expand-modal.ts — 大纲智能扩写编辑器
 *
 * 功能：
 * - 左侧：大纲/场景列表
 * - 右侧：扩写预览和编辑
 * - 支持逐段扩写、批量扩写、选择性扩写
 * - 扩写前后对比（diff 视图）
 */

import { App, Modal, Notice } from 'obsidian';
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


const log = createLogger('OutlineExpandModal');
type ExpandMode = 'chapter' | 'scene' | 'paragraph';
type ViewMode = 'edit' | 'diff';

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
    private sceneListEl!: HTMLElement;
    private paragraphListEl!: HTMLElement;
    private editorEl!: HTMLTextAreaElement;
    private statusEl!: HTMLElement;
    private progressEl!: HTMLElement;

    constructor(
        app: App,
        plugin: NovelWriterPlugin,
        sourceOutline: string = '',
        options?: {
            mode?: ExpandMode;
            targetWords?: number;
        }
    ) {
        super(app);
        this.plugin = plugin;
        this.sourceOutline = sourceOutline;
        if (options?.mode) this.expandMode = options.mode;
        if (options?.targetWords) this.targetWords = options.targetWords;

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
    }

    private renderHeader(container: HTMLElement): void {
        const header = container.createDiv({
            attr: { style: 'padding:16px 20px;border-bottom:1px solid var(--background-modifier-border);display:flex;align-items:center;justify-content:space-between;flex-shrink:0;' }
        });

        const left = header.createDiv({ attr: { style: 'display:flex;align-items:center;gap:16px;' } });
        left.createEl('h2', { text: '✍️ 智能扩写编辑器', attr: { style: 'margin:0;font-size:18px;' } });

        const modeSelector = left.createDiv({ attr: { style: 'display:flex;gap:4px;background:var(--background-secondary);border-radius:6px;padding:2px;' } });
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
                this.expandMode = mode.key;
                this.renderHeader(container);
                this.refreshSceneList();
            };
        }

        const right = header.createDiv({ attr: { style: 'display:flex;align-items:center;gap:8px;' } });

        const strategyLabel = right.createSpan({ text: '策略：', cls: 'nw-text-muted' });
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

        const wordInputWrap = right.createDiv({ attr: { style: 'display:flex;align-items:center;gap:4px;' } });
        wordInputWrap.createSpan({ text: '目标字数：', cls: 'nw-text-muted' });
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
            cls: 'nw-btn',
            attr: { style: 'padding:4px 10px;font-size:16px;border:none;background:transparent;cursor:pointer;color:var(--text-muted);' }
        }).onclick = () => this.close();
    }

    private renderMainContent(container: HTMLElement): void {
        const main = container.createDiv({
            attr: { style: 'flex:1;display:flex;overflow:hidden;min-height:0;' }
        });

        this.leftPanel = main.createDiv({
            attr: { style: 'width:320px;border-right:1px solid var(--background-modifier-border);display:flex;flex-direction:column;overflow:hidden;' }
        });
        this.rightPanel = main.createDiv({
            attr: { style: 'flex:1;display:flex;flex-direction:column;overflow:hidden;' }
        });

        this.renderLeftPanel();
        this.renderRightPanel();
    }

    private renderLeftPanel(): void {
        this.leftPanel.empty();

        const leftHeader = this.leftPanel.createDiv({
            attr: { style: 'padding:12px 16px;border-bottom:1px solid var(--background-modifier-border);display:flex;align-items:center;justify-content:space-between;flex-shrink:0;' }
        });
        leftHeader.createSpan({
            text: this.expandMode === 'chapter' ? '📋 章节场景' : this.expandMode === 'scene' ? '📝 场景段落' : '📄 段落列表',
            attr: { style: 'font-weight:500;font-size:14px;' }
        });

        if (this.expandMode === 'chapter') {
            const expandAllBtn = leftHeader.createEl('button', {
                text: '全部展开',
                cls: 'nw-btn',
                attr: { style: 'font-size:12px;padding:2px 8px;' }
            });
            expandAllBtn.onclick = () => this.expandAllScenes();
        }

        const listContainer = this.leftPanel.createDiv({
            attr: { style: 'flex:1;overflow-y:auto;padding:8px;' }
        });

        if (this.expandMode === 'chapter' || this.expandMode === 'scene') {
            this.sceneListEl = listContainer.createDiv({ attr: { style: 'display:flex;flex-direction:column;gap:4px;' } });
            this.refreshSceneList();
        } else {
            this.paragraphListEl = listContainer.createDiv({ attr: { style: 'display:flex;flex-direction:column;gap:4px;' } });
            this.refreshParagraphList();
        }

        const settingsPanel = this.leftPanel.createDiv({
            attr: { style: 'border-top:1px solid var(--background-modifier-border);padding:12px 16px;flex-shrink:0;' }
        });
        settingsPanel.createEl('h4', { text: '增强选项', attr: { style: 'margin:0 0 8px 0;font-size:13px;color:var(--text-muted);' } });

        const enhancements: Array<{ key: string; label: string; value: boolean }> = [
            { key: 'coolPoints', label: '🎯 爽点增强', value: this.enhanceCoolPoints },
            { key: 'dialogue', label: '💬 对话优化', value: this.enhanceDialogue },
            { key: 'environment', label: '🌿 环境描写', value: this.enhanceEnvironment },
            { key: 'foreshadows', label: '🔮 伏笔埋设', value: this.plantForeshadows },
        ];

        for (const enh of enhancements) {
            const row = settingsPanel.createDiv({ attr: { style: 'display:flex;align-items:center;gap:8px;margin-bottom:6px;' } });
            const checkbox = row.createEl('input', {
                type: 'checkbox',
                attr: { style: 'cursor:pointer;' }
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
            row.createSpan({ text: enh.label, attr: { style: 'font-size:13px;cursor:pointer;' } }).onclick = () => {
                checkbox.checked = !checkbox.checked;
                checkbox.dispatchEvent(new Event('change'));
            };
        }
    }

    private renderRightPanel(): void {
        this.rightPanel.empty();

        const rightHeader = this.rightPanel.createDiv({
            attr: { style: 'padding:12px 16px;border-bottom:1px solid var(--background-modifier-border);display:flex;align-items:center;justify-content:space-between;flex-shrink:0;' }
        });

        const viewTabs = rightHeader.createDiv({ attr: { style: 'display:flex;gap:4px;background:var(--background-secondary);border-radius:6px;padding:2px;' } });
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
            attr: { style: 'flex:1;overflow:hidden;position:relative;' }
        });

        if (this.viewMode === 'edit') {
            this.editorEl = editorContainer.createEl('textarea', {
                value: this.expandedText || this.sourceOutline,
                attr: {
                    style: 'width:100%;height:100%;border:none;outline:none;resize:none;padding:16px;font-family:var(--font-interface);font-size:14px;line-height:1.8;background:var(--background-primary);color:var(--text-normal);box-sizing:border-box;'
                }
            }) as HTMLTextAreaElement;
            this.editorEl.oninput = () => {
                this.expandedText = this.editorEl.value;
                this.updateStatus();
            };
        } else {
            this.renderDiffView(editorContainer);
        }

        this.progressEl = this.rightPanel.createDiv({
            attr: { style: 'padding:8px 16px;border-top:1px solid var(--background-modifier-border);font-size:12px;color:var(--text-muted);display:none;flex-shrink:0;' }
        });
    }

    private renderDiffView(container: HTMLElement): void {
        const diffContainer = container.createDiv({
            attr: { style: 'display:flex;height:100%;overflow:hidden;' }
        });

        const origCol = diffContainer.createDiv({
            attr: { style: 'flex:1;display:flex;flex-direction:column;border-right:1px solid var(--background-modifier-border);overflow:hidden;' }
        });
        origCol.createDiv({ text: '原文', attr: { style: 'padding:8px 12px;background:var(--background-secondary);font-size:12px;color:var(--text-muted);font-weight:500;flex-shrink:0;' } });
        const origContent = origCol.createDiv({
            attr: { style: 'flex:1;overflow-y:auto;padding:12px;font-size:14px;line-height:1.8;font-family:var(--font-monospace);' }
        });

        const newCol = diffContainer.createDiv({
            attr: { style: 'flex:1;display:flex;flex-direction:column;overflow:hidden;' }
        });
        newCol.createDiv({ text: '扩写后', attr: { style: 'padding:8px 12px;background:var(--background-secondary);font-size:12px;color:var(--text-muted);font-weight:500;flex-shrink:0;' } });
        const newContent = newCol.createDiv({
            attr: { style: 'flex:1;overflow-y:auto;padding:12px;font-size:14px;line-height:1.8;font-family:var(--font-monospace);' }
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
        const footer = container.createDiv({
            attr: { style: 'padding:12px 20px;border-top:1px solid var(--background-modifier-border);display:flex;align-items:center;justify-content:space-between;flex-shrink:0;gap:12px;' }
        });

        const leftActions = footer.createDiv({ attr: { style: 'display:flex;gap:8px;' } });

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

        const rightActions = footer.createDiv({ attr: { style: 'display:flex;gap:8px;' } });

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
                attr: { style: 'padding:20px;text-align:center;color:var(--text-muted);font-size:13px;' }
            });

            const startBtn = this.sceneListEl.createEl('button', {
                text: '🚀 开始扩写',
                cls: 'nw-btn nw-btn-primary novel-writer-primary-button',
                attr: { style: 'margin:8px auto;display:block;' }
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

            const header = item.createDiv({ attr: { style: 'display:flex;align-items:center;gap:6px;margin-bottom:4px;' } });
            header.createSpan({
                text: `${scene.isKeyScene ? '⭐' : '📍'} 场景${scene.index}`,
                attr: { style: 'font-weight:500;font-size:13px;flex-shrink:0;' }
            });
            header.createSpan({
                text: scene.name,
                attr: { style: 'font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0;' }
            });

            item.createDiv({
                text: scene.summary?.slice(0, 60) + (scene.summary && scene.summary.length > 60 ? '...' : ''),
                attr: { style: 'font-size:12px;color:var(--text-muted);line-height:1.5;' }
            });

            const actionRow = item.createDiv({ attr: { style: 'display:flex;gap:4px;margin-top:6px;' } });
            const expandBtn = actionRow.createEl('button', {
                text: '展开',
                cls: 'nw-btn',
                attr: { style: 'font-size:11px;padding:2px 8px;flex:1;' }
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
                attr: { style: 'padding:20px;text-align:center;color:var(--text-muted);font-size:13px;' }
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
                attr: { style: 'margin-top:3px;flex-shrink:0;cursor:pointer;' }
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

            const content = item.createDiv({ attr: { style: 'flex:1;min-width:0;' } });
            content.createDiv({
                text: `第${para.index}段`,
                attr: { style: 'font-weight:500;font-size:12px;margin-bottom:2px;color:var(--text-muted);' }
            });
            content.createDiv({
                text: para.content.slice(0, 80) + (para.content.length > 80 ? '...' : ''),
                attr: { style: 'font-size:12px;line-height:1.5;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;' }
            });

            item.onclick = () => {
                this.loadParagraphToEditor(i);
            };
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
                    }
                );

                if (result.success && result.paragraphs) {
                    const adjustedParas = result.paragraphs.map(p => ({
                        ...p,
                        index: allParagraphs.length + p.index,
                    }));
                    allParagraphs.push(...adjustedParas);
                    fullText += result.content + '\n\n';
                } else {
                    fullText += sceneText + '\n\n';
                }
            } catch (e) {
                log.warn(`场景${scene.index}扩写失败:`, e);
                fullText += `## 场景${scene.index}：${scene.name}\n${scene.summary}\n\n`;
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
                    }
                );

                if (result.success) {
                    this.paragraphs[idx] = { ...para, content: result.content };
                }
            } catch (e) {
                log.warn(`段落${idx}扩写失败:`, e);
            }
        }

        const fullText = this.paragraphs.map(p => p.content).join('\n\n');
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
