import { App, Modal, Notice, TFolder, TFile } from 'obsidian';
import { KnowledgeBaseManager } from '@/services/knowledge-base-manager';
import { DeconstructionScheduler, type BreakdownDimension } from '@/engine/deconstruction-scheduler';
import { KnowledgeTagManager } from '@/engine/knowledge-tags';
import { BatchImportManager, type ImportBookPreview, type ImportHistoryItem, type ImportBatchSettings, type ImportPreset, type BatchImportProgress, type ImportTask } from '@/engine/batch-import-manager';
import { type BookRecognitionResult } from '@/services/chapter-recognizer';
import { ENGINE_NAMES } from '@/shared/engine-names';
import type { EngineRegistry } from '@/engine/engine-registry';
import { createLogger } from '@/shared/logger';
import { isImeComposing } from '@/shared/keyboard';
import { showSuccessNotice } from '@/ui/components/notice-helpers';


const log = createLogger('BatchImportModal');
interface ImportResult {
    success: number;
    failed: number;
    skipped: number;
    successItems: { bookId: string; bookName: string }[];
    failedItems: { filename: string; error: string }[];
}

interface BatchImportModalOptions {
    knowledgeBaseManager: KnowledgeBaseManager;
    deconstructionScheduler: DeconstructionScheduler;
    tagManager: KnowledgeTagManager;
    batchImportManager?: BatchImportManager;
    /** 引擎注册表，用于获取共享的 BatchImportManager 实例（推荐传入，避免多实例） */
    engineRegistry?: EngineRegistry;
    onComplete?: (result: ImportResult) => void;
    onViewDetail?: (bookId: string, bookName: string) => void;
}

type ImportStep = 1 | 2 | 3 | 4 | 5;

const STEP_LABELS: Record<ImportStep, string> = {
    1: '文件选择',
    2: '智能预览',
    3: '批量设置',
    4: '导入进度',
    5: '结果与历史',
};

const THEME_CATEGORIES = ['男频', '女频', '短篇', '衍生'];
const TECHNIQUE_CATEGORIES = ['结构类', '爽点类', '情绪类', '节奏类', '流派类'];

const DIMENSION_OPTIONS: { key: BreakdownDimension; label: string; icon: string }[] = [
    { key: 'style', label: '风格分析', icon: '🎨' },
    { key: 'rhythm', label: '节奏分析', icon: '📈' },
    { key: 'technique', label: '写作技巧', icon: '✍️' },
    { key: 'structure', label: '结构拆解', icon: '🏗️' },
    { key: 'character', label: '人设提取', icon: '👤' },
    { key: 'foreshadow', label: '伏笔梳理', icon: '🔮' },
];

function generateId(): string {
    return 'import_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
}

/**
 * BatchImportModal 类。
 */
export class BatchImportModal extends Modal {
    private options: BatchImportModalOptions;
    private currentStep: ImportStep = 1;
    private batchManager: BatchImportManager;

    private selectedThemeTagIds: string[] = [];
    private selectedTechniqueTagIds: string[] = [];
    private customTags: string[] = [];
    private customTagInput = '';
    private themeCategory = '男频';
    private techniqueCategory = '结构类';

    private selectedDimensions: BreakdownDimension[] = ['style', 'rhythm', 'technique', 'structure', 'character', 'foreshadow'];
    private autoStartDeconstruction = true;
    private autoClassify = true;
    private concurrency = 2;
    private priority = 0;

    private presetNameInput = '';
    private selectedPresetId: string | null = null;
    private showPresets = false;

    private historyTab: 'recent' | 'all' = 'recent';
    private selectedHistoryId: string | null = null;

    private isImporting = false;
    /** 是否已经开过批次（关闭兜底刷新只在导入后触发） */
    private batchStarted = false;
    /** onComplete 是否已上报（「完成」与关闭兜底只允许一次） */
    private completionReported = false;
    private progressUnsubscribe?: () => void;
    private taskUnsubscribe?: () => void;

    private totalProgressEl!: HTMLElement;
    private totalProgressBarEl!: HTMLElement;
    private totalProgressTextEl!: HTMLElement;
    private taskListEl!: HTMLElement;
    private logEl!: HTMLElement;

    constructor(app: App, options: BatchImportModalOptions) {
        super(app);
        this.options = options;
        // 优先使用调用方传入的实例；否则从 EngineRegistry 获取共享实例
        // 若二者均不可用，抛出错误以强制调用方提供其一（避免多实例状态不同步）
        const manager = options.batchImportManager
            ?? options.engineRegistry?.get(ENGINE_NAMES.BATCH_IMPORT_MANAGER);
        if (!manager) {
            throw new Error('[BatchImportModal] 必须提供 batchImportManager 或 engineRegistry 之一');
        }
        this.batchManager = manager;
    }

    /**
     * onOpen 方法。
     */
    async onOpen() {
        this.modalEl.addClass('nw-scope');
        this.modalEl.addClass('nw-modal');

        // registry 已在 initialize 阶段调用 init()，仅当调用方传入了自定义实例时才需手动初始化
        if (!this.options.batchImportManager && !this.options.engineRegistry) {
            await this.batchManager.init();
        }

        this.render();

        this.progressUnsubscribe = this.batchManager.onProgress(() => {
            if (this.currentStep === 4) {
                this.updateProgressView();
            }
        });

        this.taskUnsubscribe = this.batchManager.onTaskUpdate(() => {
            if (this.currentStep === 4) {
                this.updateTaskList();
            }
        });
    }

    /**
     * onClose 方法。
     */
    onClose() {
        if (this.progressUnsubscribe) {
            this.progressUnsubscribe();
        }
        if (this.taskUnsubscribe) {
            this.taskUnsubscribe();
        }
        // 用户按 ESC/✕ 直接关闭时不会走「完成」按钮，主视图的书籍列表与计数
        // 就永远停在导入前。已经开过批次的，关闭时补一次回调（回调本身幂等）。
        if (this.batchStarted && !this.completionReported) {
            this.completionReported = true;
            void this.reportCompletion();
        }
        this.contentEl.empty();
    }

    /** 把当前批次的终态任务汇总成 ImportResult 并回调（「完成」按钮与关闭兜底共用） */
    private async reportCompletion(): Promise<void> {
        const progress = this.batchManager.getProgress();
        const tasks = this.batchManager.getAllTasks();
        const result: ImportResult = {
            success: progress.completedTasks,
            failed: progress.failedTasks,
            skipped: 0,
            successItems: tasks.filter(t => t.status === 'completed' && t.bookId).map(t => ({
                bookId: t.bookId!,
                bookName: t.bookName,
            })),
            failedItems: tasks.filter(t => t.status === 'failed').map(t => ({
                filename: t.bookName,
                error: t.error || '未知错误',
            })),
        };
        if (!this.options.onComplete) return;
        try {
            await this.options.onComplete(result);
        } catch (error) {
            log.error('[BatchImportModal] onComplete callback failed:', error);
        }
    }

    private render(): void {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl('h3', { text: '📚 批量导入书籍', cls: 'nw-modal-title' });

        this.renderStepIndicator();

        const contentDiv = contentEl.createDiv({ cls: 'nw-u-margintop-16px-2 nw-u-maxh-60vh nw-u-ovy-auto-2' });

        switch (this.currentStep) {
            case 1:
                this.renderStep1(contentDiv);
                break;
            case 2:
                this.renderStep2(contentDiv);
                break;
            case 3:
                this.renderStep3(contentDiv);
                break;
            case 4:
                this.renderStep4(contentDiv);
                break;
            case 5:
                this.renderStep5(contentDiv);
                break;
        }

        this.renderFooter();
    }

    private renderStepIndicator(): void {
        const stepsDiv = this.contentEl.createDiv({
            cls: 'nw-u-d-flex-2 nw-u-gap-6px-2 nw-u-margintop-12px-2 nw-u-ai-center-2 nw-u-fwr-wrap-2'
        });

        const steps: ImportStep[] = [1, 2, 3, 4, 5];
        steps.forEach((step, index) => {
            const stepEl = stepsDiv.createEl('span', {
                text: `${step}. ${STEP_LABELS[step]}`,
                attr: {
                    style: `padding:4px 10px;border-radius:12px;font-size:11px;${
                        step === this.currentStep
                            ? 'background:var(--interactive-accent);color:var(--text-on-accent);'
                            : step < this.currentStep
                            ? 'background:var(--background-modifier-success);color:var(--text-on-accent);'
                            : 'background:var(--background-secondary);color:var(--text-muted);'
                    }`
                }
            });

            if (index < steps.length - 1) {
                stepsDiv.createEl('span', {
                    text: '→',
                    cls: 'nw-u-c-text-muted-2 nw-u-fs-11px-2'
                });
            }
        });
    }

    private renderStep1(container: HTMLElement): void {
        container.createEl('div', {
            text: '选择要导入的小说文件（支持 .txt、.md 格式）',
            cls: "nw-text-muted nw-u-marginbottom-12px-2", attr: {}
        });

        const btnRow = container.createDiv({ cls: 'nw-u-d-flex-2 nw-u-gap-8px-2 nw-u-marginbottom-12px-2 nw-u-fwr-wrap-2' });

        const selectFileBtn = btnRow.createEl('button', {
            text: '📁 选择本地文件',
            cls: 'nw-btn nw-btn-secondary nw-btn-sm',
        });
        // 隐藏 input 必须挂在容器上，不能挂在按钮里：
        // input.click() 派发的事件会冒泡回父按钮，再次进入本监听 → 同步递归（栈溢出）。
        const fileInput = btnRow.createEl('input', {
            attr: { type: 'file', multiple: '', accept: '.txt,.md,.epub', style: 'display:none;' }
        });
        selectFileBtn.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', (e) => {
            const files = (e.target as HTMLInputElement).files;
            if (files) this.handleLocalFiles(files);
        });

        const selectFolderBtn = btnRow.createEl('button', {
            text: '📂 选择文件夹',
            cls: 'nw-btn nw-btn-secondary nw-btn-sm',
        });
        selectFolderBtn.addEventListener('click', () => {
            this.showVaultFolderPicker();
        });

        const selectVaultBtn = btnRow.createEl('button', {
            text: '📝 从库内选择',
            cls: 'nw-btn nw-btn-secondary nw-btn-sm',
        });
        selectVaultBtn.addEventListener('click', () => {
            this.showVaultFilePicker();
        });

        const historyBtn = btnRow.createEl('button', {
            text: '📜 导入历史',
            cls: "nw-btn nw-btn-ghost nw-btn-sm nw-u-marginleft-auto-2",
            attr: {}
        });
        historyBtn.addEventListener('click', () => {
            this.currentStep = 5;
            this.render();
        });

        const dropArea = container.createDiv({
            cls: 'nw-u-p-32px nw-u-b-2px-dashed-background- nw-u-brd-8px-2 nw-u-ta-center-2 nw-u-cur-pointer-2 nw-u-bg-background-secondary-2 nw-u-marginbottom-12px-2 nw-u-transition-all-0-2s'
        });
        dropArea.createEl('div', {
            text: '📥 拖拽文件到此处',
            cls: 'nw-u-fs-15px-2 nw-u-c-text-muted-2 nw-u-marginbottom-6px-2'
        });
        dropArea.createEl('div', {
            text: '支持 .txt、.md、.epub 格式',
            cls: 'nw-u-fs-12px-2 nw-u-c-text-faint-2'
        });

        dropArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropArea.style.borderColor = 'var(--interactive-accent)';
            dropArea.style.background = 'rgba(var(--interactive-accent-rgb),0.05)';
        });
        dropArea.addEventListener('dragleave', () => {
            dropArea.style.borderColor = 'var(--background-modifier-border)';
            dropArea.style.background = 'var(--background-secondary)';
        });
        dropArea.addEventListener('drop', (e) => {
            e.preventDefault();
            dropArea.style.borderColor = 'var(--background-modifier-border)';
            dropArea.style.background = 'var(--background-secondary)';
            const files = e.dataTransfer?.files;
            if (files && files.length > 0) this.handleLocalFiles(files);
        });

        const previews = this.batchManager.getPreviews();

        const listHeader = container.createDiv({
            cls: "nw-flex-between nw-u-marginbottom-8px-2", attr: {}
        });
        listHeader.createEl('span', {
            text: `已选文件 (${previews.length})`,
            cls: 'nw-label-md'
        });

        const actionBtns = listHeader.createDiv({ cls: 'nw-flex-row' });

        const selectAllBtn = actionBtns.createEl('button', {
            text: '全选',
            cls: 'nw-btn nw-btn-ghost nw-btn-xs',
        });
        selectAllBtn.addEventListener('click', () => {
            previews.forEach(p => this.batchManager.updatePreview(p.id, { selected: true }));
            this.render();
        });

        const deselectAllBtn = actionBtns.createEl('button', {
            text: '取消全选',
            cls: 'nw-btn nw-btn-ghost nw-btn-xs',
        });
        deselectAllBtn.addEventListener('click', () => {
            previews.forEach(p => this.batchManager.updatePreview(p.id, { selected: false }));
            this.render();
        });

        const clearBtn = actionBtns.createEl('button', {
            text: '清空',
            cls: "nw-btn nw-btn-ghost nw-btn-xs nw-u-c-text-error",
            attr: {}
        });
        clearBtn.addEventListener('click', () => {
            this.batchManager.clearPreviews();
            this.render();
        });

        const fileListContainer = container.createDiv({
            cls: "nw-scroll-box nw-u-maxh-260px", attr: {}
        });

        if (previews.length === 0) {
            fileListContainer.createDiv({
                cls: "nw-empty-hint nw-u-fs-13px-2", attr: {}
            }).createEl('span', { text: '暂无文件，请添加要导入的小说文件' });
        } else {
            previews.forEach((preview, index) => {
                const row = fileListContainer.createDiv({
                    attr: {
                        style: `display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid var(--background-modifier-border);${
                            index === previews.length - 1 ? 'border-bottom:none;' : ''
                        }`
                    }
                });

                const checkbox = row.createEl('input', {
                    attr: { type: 'checkbox', style: 'cursor:pointer;flex-shrink:0;' }
                });
                checkbox.checked = preview.selected;
                checkbox.addEventListener('change', (e) => {
                    this.batchManager.updatePreview(preview.id, { selected: (e.target as HTMLInputElement).checked });
                });

                const infoWrap = row.createDiv({ cls: 'nw-u-flex-1-2 nw-u-minw-0-2' });
                const nameRow = infoWrap.createDiv({ cls: 'nw-u-d-flex-2 nw-u-ai-center-2 nw-u-gap-8px-2 nw-u-marginbottom-2px-2' });
                nameRow.createEl('span', {
                    text: preview.filename,
                    cls: 'nw-u-fs-12px-2 nw-u-fwt-500-2 nw-u-ov-hidden-2 nw-u-textoverflow-ellipsis-2 nw-u-ws-nowrap-2'
                });
                const formatBadge = nameRow.createEl('span', {
                    text: preview.recognition.format.toUpperCase(),
                    attr: {
                        style: `padding:1px 6px;font-size:10px;border-radius:8px;flex-shrink:0;${
                            preview.recognition.format === 'md'
                                ? 'background:rgba(59,130,246,0.15);color:#3b82f6;'
                                : preview.recognition.format === 'txt'
                                ? 'background:rgba(34,197,94,0.15);color:#22c55e;'
                                : 'background:var(--background-secondary);color:var(--text-muted);'
                        }`
                    }
                });
                void formatBadge;

                const metaRow = infoWrap.createDiv({ cls: 'nw-u-d-flex-2 nw-u-gap-12px-2 nw-u-fs-11px-2 nw-u-c-text-muted-2' });
                metaRow.createEl('span', { text: `📖 ${preview.recognition.chapterCount} 章` });
                metaRow.createEl('span', { text: `📝 ${this.formatWordCount(preview.recognition.wordCount)}` });
                metaRow.createEl('span', { text: `🎯 ${Math.round(preview.recognition.confidence * 100)}%` });

                const deleteBtn = row.createEl('button', {
                    text: '✕',
                    cls: "nw-btn nw-btn-ghost nw-btn-xs nw-u-fsh-0-2 nw-u-c-text-muted-2",
                    attr: {}
                });
                deleteBtn.addEventListener('click', () => {
                    this.batchManager.removePreview(preview.id);
                    this.render();
                });
            });
        }
    }

    private renderStep2(container: HTMLElement): void {
        const previews = this.batchManager.getSelectedPreviews();

        container.createEl('div', {
            text: `智能识别预览（共 ${previews.length} 本）`,
            cls: "nw-text-muted nw-u-marginbottom-12px-2", attr: {}
        });

        if (previews.length === 0) {
            container.createDiv({
                cls: 'nw-empty-hint'
            }).createEl('span', { text: '没有选中的文件，请返回上一步选择' });
            return;
        }

        const listContainer = container.createDiv({
            cls: "nw-scroll-box nw-u-maxh-400px-2", attr: {}
        });

        previews.forEach((preview, index) => {
            const card = listContainer.createDiv({
                attr: {
                    style: `padding:12px;border-bottom:1px solid var(--background-modifier-border);${
                        index === previews.length - 1 ? 'border-bottom:none;' : ''
                    }`
                }
            });

            const header = card.createDiv({ cls: 'nw-u-d-flex-2 nw-u-jc-space-between-2 nw-u-ai-flex-start-2 nw-u-gap-12px-2 nw-u-marginbottom-10px-2' });

            const titleInput = header.createEl('input', {
                type: 'text',
                value: preview.overrides.name || preview.recognition.title,
                cls: 'nw-u-flex-1-2 nw-u-p-6px-10px-2 nw-u-b-1px-solid-background-m-2 nw-u-brd-4px-2 nw-u-fs-13px-2 nw-u-fwt-500-2 nw-u-bg-background-primary-2 nw-u-c-text-normal-2'
            });
            titleInput.addEventListener('input', (e) => {
                const name = (e.target as HTMLInputElement).value;
                this.batchManager.updatePreview(preview.id, {
                    overrides: { ...preview.overrides, name }
                });
            });

            const confBadge = header.createEl('span', {
                text: `${Math.round(preview.recognition.confidence * 100)}%`,
                attr: {
                    style: `padding:2px 8px;font-size:11px;border-radius:10px;flex-shrink:0;${
                        preview.recognition.confidence >= 0.7
                            ? 'background:rgba(46,204,113,0.15);color:#2ecc71;'
                            : preview.recognition.confidence >= 0.4
                            ? 'background:rgba(241,196,15,0.15);color:#f1c40f;'
                            : 'background:rgba(231,76,60,0.15);color:#e74c3c;'
                    }`
                }
            });
            void confBadge;

            const metaGrid = card.createDiv({
                cls: 'nw-u-d-grid-2 nw-u-gtc-repeat-auto-fit-minmax-7 nw-u-gap-8px-2 nw-u-marginbottom-10px-2'
            });

            this.addMetaItem(metaGrid, '作者', preview.recognition.author || '未识别', true, (val) => {
                this.batchManager.updatePreview(preview.id, {
                    overrides: { ...preview.overrides, author: val }
                });
            });
            this.addMetaItem(metaGrid, '字数', this.formatWordCount(preview.recognition.wordCount));
            this.addMetaItem(metaGrid, '章节数', preview.recognition.chapterCount.toString());
            this.addMetaItem(metaGrid, '格式', preview.recognition.format.toUpperCase());

            if (preview.recognition.chapters.length > 0) {
                const chapterPreview = card.createDiv({
                    cls: 'nw-u-bg-background-secondary-2 nw-u-brd-4px-2 nw-u-p-8px-2'
                });
                chapterPreview.createEl('div', {
                    text: '章节预览（前3章）',
                    cls: 'nw-u-fs-11px-2 nw-u-c-text-muted-2 nw-u-marginbottom-6px-2'
                });
                preview.recognition.chapters.slice(0, 3).forEach(ch => {
                    const chRow = chapterPreview.createDiv({
                        cls: 'nw-u-fs-12px-2 nw-u-c-text-normal-2 nw-u-p-2px-0 nw-u-d-flex-2 nw-u-jc-space-between-2'
                    });
                    chRow.createEl('span', { text: ch.title, cls: 'nw-u-ov-hidden-2 nw-u-textoverflow-ellipsis-2 nw-u-ws-nowrap-2 nw-u-flex-1-2' });
                    chRow.createEl('span', { text: this.formatWordCount(ch.wordCount), cls: 'nw-u-c-text-muted-2 nw-u-fsh-0-2 nw-u-marginleft-8px' });
                });
                if (preview.recognition.chapters.length > 3) {
                    chapterPreview.createEl('div', {
                        text: `... 还有 ${preview.recognition.chapters.length - 3} 章`,
                        cls: 'nw-u-fs-11px-2 nw-u-c-text-muted-2 nw-u-ta-center-2 nw-u-margintop-4px-3'
                    });
                }
            }
        });
    }

    private addMetaItem(container: HTMLElement, label: string, value: string, editable?: boolean, onChange?: (val: string) => void): void {
        const item = container.createDiv({
            cls: 'nw-u-p-8px-2 nw-u-bg-background-secondary-2 nw-u-brd-4px-2'
        });
        item.createEl('div', { text: label, cls: 'nw-u-fs-10px-2 nw-u-c-text-muted-2 nw-u-marginbottom-2px-2' });
        if (editable && onChange) {
            const input = item.createEl('input', {
                type: 'text',
                value: value,
                cls: 'nw-u-w-100-2 nw-u-p-0 nw-u-b-none nw-u-bg-transparent nw-u-fs-12px-2 nw-u-c-text-normal-2 nw-u-outline-none'
            });
            input.addEventListener('input', (e) => onChange((e.target as HTMLInputElement).value));
        } else {
            item.createEl('div', { text: value, cls: 'nw-u-fs-12px-2 nw-u-c-text-normal-2 nw-u-fwt-500-2' });
        }
    }

    private renderStep3(container: HTMLElement): void {
        container.createEl('div', {
            text: '为所有导入的书籍统一设置',
            cls: "nw-text-muted nw-u-marginbottom-16px-2", attr: {}
        });

        const presetRow = container.createDiv({ cls: "nw-setting-card nw-u-marginbottom-16px-2", attr: {} });
        const presetHeader = presetRow.createDiv({ cls: "nw-flex-between nw-u-marginbottom-8px-2", attr: {} });
        presetHeader.createEl('span', { text: '📋 预设方案', cls: 'nw-label-md' });
        const toggleBtn = presetHeader.createEl('button', {
            text: this.showPresets ? '收起' : '展开',
            cls: 'nw-btn nw-btn-ghost nw-btn-xs',
        });
        toggleBtn.addEventListener('click', () => {
            this.showPresets = !this.showPresets;
            this.render();
        });

        if (this.showPresets) {
            const presets = this.batchManager.getPresets();
            const presetList = presetRow.createDiv({
                cls: 'nw-u-d-flex-2 nw-u-gap-6px-2 nw-u-fwr-wrap-2 nw-u-marginbottom-8px-2'
            });
            if (presets.length === 0) {
                presetList.createEl('span', { text: '暂无预设', cls: 'nw-text-sm-muted' });
            } else {
                presets.forEach(preset => {
                    const presetEl = presetList.createEl('span', {
                        text: preset.name,
                        attr: {
                            style: `padding:4px 10px;border-radius:12px;font-size:11px;cursor:pointer;${
                                this.selectedPresetId === preset.id
                                    ? 'background:var(--interactive-accent);color:var(--text-on-accent);'
                                    : 'background:var(--background-primary);color:var(--text-normal);border:1px solid var(--background-modifier-border);'
                            }`
                        }
                    });
                    presetEl.addEventListener('click', () => {
                        this.applyPreset(preset);
                    });
                });
            }

            const savePresetRow = presetRow.createDiv({ cls: 'nw-flex-row' });
            const presetInput = savePresetRow.createEl('input', {
                type: 'text',
                placeholder: '预设名称',
                value: this.presetNameInput,
                cls: 'nw-u-flex-1-2 nw-u-p-6px-10px-2 nw-u-b-1px-solid-background-m-2 nw-u-brd-4px-2 nw-u-fs-12px-2 nw-u-bg-background-primary-2 nw-u-c-text-normal-2'
            });
            presetInput.addEventListener('input', (e) => {
                this.presetNameInput = (e.target as HTMLInputElement).value;
            });
            const savePresetBtn = savePresetRow.createEl('button', {
                text: '保存为预设',
                cls: 'nw-btn nw-btn-secondary nw-btn-sm',
            });
            savePresetBtn.addEventListener('click', () => {
                this.saveCurrentAsPreset();
            });
        }

        const dimensionsSection = container.createDiv({ cls: 'nw-u-marginbottom-16px-2' });
        dimensionsSection.createEl('div', {
            text: '🔍 拆解维度',
            cls: "nw-label-md nw-u-marginbottom-8px-2", attr: {}
        });
        const dimContainer = dimensionsSection.createDiv({
            cls: 'nw-u-d-flex-2 nw-u-gap-8px-2 nw-u-fwr-wrap-2 nw-u-p-10px-2 nw-u-b-1px-solid-background-m-2 nw-u-brd-6px-2'
        });
        DIMENSION_OPTIONS.forEach(dim => {
            const isSelected = this.selectedDimensions.includes(dim.key);
            const dimEl = dimContainer.createEl('span', {
                text: `${dim.icon} ${dim.label}`,
                attr: {
                    style: `padding:6px 12px;border-radius:16px;font-size:12px;cursor:pointer;${
                        isSelected
                            ? 'background:var(--interactive-accent);color:var(--text-on-accent);'
                            : 'background:var(--background-secondary);color:var(--text-normal);'
                    }`
                }
            });
            dimEl.addEventListener('click', () => {
                if (isSelected) {
                    this.selectedDimensions = this.selectedDimensions.filter(d => d !== dim.key);
                } else {
                    this.selectedDimensions.push(dim.key);
                }
                this.render();
            });
        });

        const optionsGrid = container.createDiv({
            cls: 'nw-u-d-grid-2 nw-u-gtc-1fr-1fr-2 nw-u-gap-12px-2 nw-u-marginbottom-16px-2'
        });

        const concurrencyItem = optionsGrid.createDiv({
            cls: 'nw-setting-card'
        });
        concurrencyItem.createEl('div', { text: '⚡ 并发数', cls: "nw-text-sm-muted nw-u-marginbottom-6px-2", attr: {} });
        const concurrencyInput = concurrencyItem.createEl('input', {
            type: 'number',
            value: this.concurrency.toString(),
            attr: {
                min: '1',
                max: '10',
                style: 'width:100%;padding:6px 10px;border:1px solid var(--background-modifier-border);border-radius:4px;font-size:13px;background:var(--background-primary);color:var(--text-normal);'
            }
        });
        concurrencyInput.addEventListener('change', (e) => {
            this.concurrency = Math.max(1, Math.min(10, parseInt((e.target as HTMLInputElement).value) || 2));
        });

        const priorityItem = optionsGrid.createDiv({
            cls: 'nw-setting-card'
        });
        priorityItem.createEl('div', { text: '⭐ 优先级', cls: "nw-text-sm-muted nw-u-marginbottom-6px-2", attr: {} });
        const prioritySelect = priorityItem.createEl('select', {
            cls: 'nw-u-w-100-2 nw-u-p-6px-10px-2 nw-u-b-1px-solid-background-m-2 nw-u-brd-4px-2 nw-u-fs-13px-2 nw-u-bg-background-primary-2 nw-u-c-text-normal-2'
        });
        const priorityOptions = [
            { value: '2', label: '高优先级' },
            { value: '1', label: '较高优先级' },
            { value: '0', label: '普通优先级' },
            { value: '-1', label: '较低优先级' },
            { value: '-2', label: '低优先级' },
        ];
        priorityOptions.forEach(opt => {
            const option = prioritySelect.createEl('option', { value: opt.value, text: opt.label });
            if (parseInt(opt.value) === this.priority) option.selected = true;
        });
        prioritySelect.addEventListener('change', (e) => {
            this.priority = parseInt((e.target as HTMLSelectElement).value);
        });

        const togglesSection = container.createDiv({ cls: 'nw-u-marginbottom-16px-2' });
        togglesSection.createEl('div', {
            text: '⚙️ 其他选项',
            cls: "nw-label-md nw-u-marginbottom-8px-2", attr: {}
        });

        const toggleList = togglesSection.createDiv({
            cls: 'nw-u-d-flex-2 nw-u-fd-column-2 nw-u-gap-8px-2 nw-u-p-10px-2 nw-u-b-1px-solid-background-m-2 nw-u-brd-6px-2'
        });

        const autoStartRow = toggleList.createDiv({ cls: 'nw-u-d-flex-2 nw-u-ai-center-2 nw-u-jc-space-between-2' });
        autoStartRow.createEl('span', { text: '导入后自动开始拆解', cls: 'nw-u-fs-13px-2' });
        const autoStartToggle = autoStartRow.createEl('input', {
            type: 'checkbox',
            cls: 'nw-u-cur-pointer-2'
        });
        autoStartToggle.checked = this.autoStartDeconstruction;
        autoStartToggle.addEventListener('change', (e) => {
            this.autoStartDeconstruction = (e.target as HTMLInputElement).checked;
        });

        const autoClassifyRow = toggleList.createDiv({ cls: 'nw-u-d-flex-2 nw-u-ai-center-2 nw-u-jc-space-between-2' });
        autoClassifyRow.createEl('span', { text: '自动识别题材分类', cls: 'nw-u-fs-13px-2' });
        const autoClassifyToggle = autoClassifyRow.createEl('input', {
            type: 'checkbox',
            cls: 'nw-u-cur-pointer-2'
        });
        autoClassifyToggle.checked = this.autoClassify;
        autoClassifyToggle.addEventListener('change', (e) => {
            this.autoClassify = (e.target as HTMLInputElement).checked;
        });

        const tagsSection = container.createDiv({ cls: 'nw-u-marginbottom-8px-2' });
        tagsSection.createEl('div', {
            text: '🏷️ 标签设置',
            cls: "nw-label-md nw-u-marginbottom-8px-2", attr: {}
        });

        const themeCategoryRow = tagsSection.createDiv({ cls: 'nw-u-d-flex-2 nw-u-gap-6px-2 nw-u-marginbottom-8px-2 nw-u-fwr-wrap-2' });
        THEME_CATEGORIES.forEach(cat => {
            const btn = themeCategoryRow.createEl('button', {
                text: cat,
                cls: `nw-btn nw-btn-xs ${this.themeCategory === cat ? 'nw-btn-primary' : 'nw-btn-secondary'}`,
            });
            btn.addEventListener('click', () => {
                this.themeCategory = cat;
                this.render();
            });
        });

        const themeTags = this.options.tagManager.getTagsByType(this.themeCategory).filter(t => t.parentId);
        const themeTagContainer = tagsSection.createDiv({
            cls: "nw-tag-container nw-u-marginbottom-8px-2", attr: {}
        });
        if (themeTags.length === 0) {
            themeTagContainer.createEl('span', { text: '暂无题材标签', cls: 'nw-text-sm-muted' });
        } else {
            themeTags.forEach(tag => {
                const isSelected = this.selectedThemeTagIds.includes(tag.id);
                const tagEl = themeTagContainer.createEl('span', {
                    text: tag.name,
                    cls: 'nw-chip',
                    attr: {
                        style: `cursor:pointer;${
                            isSelected
                                ? 'background:var(--interactive-accent);color:var(--text-on-accent);'
                                : 'background:var(--background-secondary);color:var(--text-normal);'
                        }`
                    }
                });
                tagEl.addEventListener('click', () => {
                    if (isSelected) {
                        this.selectedThemeTagIds = this.selectedThemeTagIds.filter(id => id !== tag.id);
                    } else {
                        this.selectedThemeTagIds.push(tag.id);
                    }
                    this.render();
                });
            });
        }

        const techniqueCategoryRow = tagsSection.createDiv({ cls: 'nw-u-d-flex-2 nw-u-gap-6px-2 nw-u-marginbottom-8px-2 nw-u-fwr-wrap-2' });
        TECHNIQUE_CATEGORIES.forEach(cat => {
            const btn = techniqueCategoryRow.createEl('button', {
                text: cat,
                cls: `nw-btn nw-btn-xs ${this.techniqueCategory === cat ? 'nw-btn-primary' : 'nw-btn-secondary'}`,
            });
            btn.addEventListener('click', () => {
                this.techniqueCategory = cat;
                this.render();
            });
        });

        const techniqueTags = this.options.tagManager.getTagsByType(this.techniqueCategory).filter(t => t.parentId);
        const techniqueTagContainer = tagsSection.createDiv({
            cls: "nw-tag-container nw-u-marginbottom-8px-2", attr: {}
        });
        if (techniqueTags.length === 0) {
            techniqueTagContainer.createEl('span', { text: '暂无技巧标签', cls: 'nw-text-sm-muted' });
        } else {
            techniqueTags.forEach(tag => {
                const isSelected = this.selectedTechniqueTagIds.includes(tag.id);
                const tagEl = techniqueTagContainer.createEl('span', {
                    text: tag.name,
                    cls: 'nw-chip',
                    attr: {
                        style: `cursor:pointer;${
                            isSelected
                                ? 'background:var(--interactive-accent);color:var(--text-on-accent);'
                                : 'background:var(--background-secondary);color:var(--text-normal);'
                        }`
                    }
                });
                tagEl.addEventListener('click', () => {
                    if (isSelected) {
                        this.selectedTechniqueTagIds = this.selectedTechniqueTagIds.filter(id => id !== tag.id);
                    } else {
                        this.selectedTechniqueTagIds.push(tag.id);
                    }
                    this.render();
                });
            });
        }

        const customInputRow = tagsSection.createDiv({ cls: 'nw-u-d-flex-2 nw-u-gap-8px-2 nw-u-marginbottom-8px-2' });
        const customInput = customInputRow.createEl('input', {
            type: 'text',
            placeholder: '输入自定义标签名',
            value: this.customTagInput,
            cls: 'nw-u-flex-1-2 nw-u-p-6px-10px-2 nw-u-b-1px-solid-background-m-2 nw-u-brd-4px-2 nw-u-fs-12px-2 nw-u-bg-background-primary-2 nw-u-c-text-normal-2'
        });
        customInput.addEventListener('input', (e) => {
            this.customTagInput = (e.target as HTMLInputElement).value;
        });
        const addCustomBtn = customInputRow.createEl('button', {
            text: '添加',
            cls: 'nw-btn nw-btn-secondary nw-btn-sm',
        });
        addCustomBtn.addEventListener('click', () => this.addCustomTag());
        customInput.addEventListener('keydown', (e) => {
            if (isImeComposing(e)) return;
            if (e.key === 'Enter') {
                e.preventDefault();
                this.addCustomTag();
            }
        });

        const customTagsContainer = tagsSection.createDiv({
            cls: 'nw-tag-container'
        });
        if (this.customTags.length === 0) {
            customTagsContainer.createEl('span', { text: '暂无自定义标签', cls: 'nw-text-sm-muted' });
        } else {
            this.customTags.forEach(tag => {
                const tagEl = customTagsContainer.createEl('span', {
                    text: tag,
                    cls: "nw-chip nw-u-bg-background-secondary-2 nw-u-c-text-normal-2 nw-u-d-flex-2 nw-u-ai-center-2 nw-u-gap-4px-2",
                    attr: {}
                });
                const removeBtn = tagEl.createEl('span', {
                    text: '×',
                    cls: 'nw-u-cur-pointer-2 nw-u-fs-13px-2 nw-u-lh-1-2'
                });
                removeBtn.addEventListener('click', () => {
                    this.customTags = this.customTags.filter(t => t !== tag);
                    this.render();
                });
            });
        }
    }

    private renderStep4(container: HTMLElement): void {
        const progress = this.batchManager.getProgress();
        const allTasks = this.batchManager.getAllTasks();

        container.createEl('div', {
            text: '正在导入书籍，请稍候...',
            cls: "nw-text-muted nw-u-marginbottom-16px-2", attr: {}
        });

        this.totalProgressEl = container.createDiv({ cls: 'nw-u-marginbottom-16px-2' });
        const totalHeader = this.totalProgressEl.createDiv({
            cls: "nw-flex-between nw-u-marginbottom-8px-2", attr: {}
        });
        totalHeader.createEl('span', { text: '总体进度', cls: 'nw-label-md' });
        this.totalProgressTextEl = totalHeader.createEl('span', {
            text: `${progress.completedTasks}/${progress.totalTasks} (${progress.overallProgress}%)`,
            cls: 'nw-text-sm-muted'
        });
        const totalBarBg = this.totalProgressEl.createDiv({
            cls: 'nw-u-w-100-2 nw-u-h-12px nw-u-bg-background-modifier-bo-3 nw-u-brd-6px-2 nw-u-ov-hidden-2'
        });
        this.totalProgressBarEl = totalBarBg.createDiv({
            attr: {
                style: `height:100%;width:${progress.overallProgress}%;background:var(--interactive-accent);border-radius:6px;transition:width 0.3s ease;`
            }
        });

        const statsRow = container.createDiv({
            cls: 'nw-u-d-grid-2 nw-u-gtc-repeat-4-1fr-2 nw-u-gap-8px-2 nw-u-marginbottom-16px-2'
        });
        this.addStatCard(statsRow, '总计', progress.totalTasks.toString(), 'var(--text-muted)');
        this.addStatCard(statsRow, '进行中', progress.activeTasks.toString(), 'var(--interactive-accent)');
        this.addStatCard(statsRow, '已完成', progress.completedTasks.toString(), 'var(--text-success)');
        this.addStatCard(statsRow, '失败', progress.failedTasks.toString(), 'var(--text-error)');

        const taskListHeader = container.createDiv({
            cls: "nw-flex-between nw-u-marginbottom-8px-2", attr: {}
        });
        taskListHeader.createEl('span', { text: '任务列表', cls: 'nw-label-md' });

        const actionBtns = taskListHeader.createDiv({ cls: 'nw-u-d-flex-2 nw-u-gap-6px-2' });
        const pauseAllBtn = actionBtns.createEl('button', {
            text: '⏸ 全部暂停',
            cls: 'nw-btn nw-btn-ghost nw-btn-xs',
        });
        pauseAllBtn.addEventListener('click', () => {
            allTasks.filter(t => t.status === 'queued').forEach(t => this.batchManager.pauseTask(t.id));
        });
        const resumeAllBtn = actionBtns.createEl('button', {
            text: '▶ 全部继续',
            cls: 'nw-btn nw-btn-ghost nw-btn-xs',
        });
        resumeAllBtn.addEventListener('click', () => {
            allTasks.filter(t => t.status === 'pending').forEach(t => this.batchManager.resumeTask(t.id));
        });

        this.taskListEl = container.createDiv({
            cls: "nw-scroll-box nw-u-maxh-240px", attr: {}
        });

        this.updateTaskList();

        const logHeader = container.createDiv({
            cls: 'nw-u-fs-13px-2 nw-u-fwt-500-2 nw-u-m-16px-0-6px-0 nw-u-d-flex-2 nw-u-jc-space-between-2 nw-u-ai-center-2'
        });
        logHeader.createEl('span', { text: '📋 导入日志' });
        const clearLogBtn = logHeader.createEl('button', {
            text: '清空',
            cls: 'nw-btn nw-btn-ghost nw-btn-xs',
        });
        clearLogBtn.addEventListener('click', () => {
            if (this.logEl) this.logEl.empty();
        });

        this.logEl = container.createDiv({
            cls: 'nw-u-h-120px nw-u-ovy-auto-2 nw-u-p-8px-12px-2 nw-u-b-1px-solid-background-m-2 nw-u-brd-4px-2 nw-u-bg-background-secondary-2 nw-u-fs-12px-2 nw-u-fontfamily-font-interface nw-u-lh-1-6-2'
        });

        this.appendLog(`开始导入，共 ${progress.totalTasks} 本书籍`);
    }

    private addStatCard(container: HTMLElement, label: string, value: string, color: string): void {
        const card = container.createDiv({
            cls: 'nw-u-p-10px-2 nw-u-ta-center-2 nw-u-bg-background-secondary-2 nw-u-brd-6px-2'
        });
        card.createEl('div', { text: value, attr: { style: `font-size:18px;font-weight:bold;color:${color};margin-bottom:2px;` } });
        card.createEl('div', { text: label, cls: 'nw-u-fs-11px-2 nw-u-c-text-muted-2' });
    }

    private updateProgressView(): void {
        const progress = this.batchManager.getProgress();
        if (this.totalProgressTextEl) {
            this.totalProgressTextEl.textContent = `${progress.completedTasks}/${progress.totalTasks} (${progress.overallProgress}%)`;
        }
        if (this.totalProgressBarEl) {
            this.totalProgressBarEl.style.width = `${progress.overallProgress}%`;
        }
    }

    private updateTaskList(): void {
        if (!this.taskListEl) return;
        const tasks = this.batchManager.getAllTasks();
        if (tasks.length === 0) {
            this.taskListEl.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:12px;">暂无任务</div>';
            return;
        }

        this.taskListEl.empty();
        tasks.forEach((task, index) => {
            const row = this.taskListEl.createDiv({
                attr: {
                    style: `padding:10px 12px;border-bottom:1px solid var(--background-modifier-border);${
                        index === tasks.length - 1 ? 'border-bottom:none;' : ''
                    }`
                }
            });

            const header = row.createDiv({ cls: 'nw-u-d-flex-2 nw-u-jc-space-between-2 nw-u-ai-center-2 nw-u-marginbottom-6px-2' });
            const titleWrap = header.createDiv({ cls: 'nw-u-d-flex-2 nw-u-ai-center-2 nw-u-gap-8px-2 nw-u-minw-0-2 nw-u-flex-1-2' });

            const statusDot = titleWrap.createEl('span', {
                attr: {
                    style: `width:8px;height:8px;border-radius:50%;flex-shrink:0;${
                        task.status === 'processing' ? 'background:var(--interactive-accent);animation: pulse 1.5s infinite;' :
                        task.status === 'completed' ? 'background:var(--text-success);' :
                        task.status === 'failed' ? 'background:var(--text-error);' :
                        task.status === 'cancelled' ? 'background:var(--text-muted);' :
                        'background:var(--text-faint);'
                    }`
                }
            });
            void statusDot;

            titleWrap.createEl('span', {
                text: task.bookName,
                cls: 'nw-u-fs-12px-2 nw-u-fwt-500-2 nw-u-ov-hidden-2 nw-u-textoverflow-ellipsis-2 nw-u-ws-nowrap-2'
            });

            const statusBadge = header.createEl('span', {
                text: this.getTaskStatusLabel(task.status),
                attr: {
                    style: `padding:2px 8px;font-size:10px;border-radius:10px;flex-shrink:0;${
                        task.status === 'processing' ? 'background:rgba(59,130,246,0.15);color:#3b82f6;' :
                        task.status === 'completed' ? 'background:rgba(46,204,113,0.15);color:#2ecc71;' :
                        task.status === 'failed' ? 'background:rgba(231,76,60,0.15);color:#e74c3c;' :
                        task.status === 'cancelled' ? 'background:var(--background-secondary);color:var(--text-muted);' :
                        'background:var(--background-secondary);color:var(--text-muted);'
                    }`
                }
            });
            void statusBadge;

            if (task.status === 'processing' || task.status === 'queued') {
                const barBg = row.createDiv({
                    cls: 'nw-u-h-4px-2 nw-u-bg-background-modifier-bo-3 nw-u-brd-2px-2 nw-u-ov-hidden-2 nw-u-marginbottom-4px-2'
                });
                barBg.createDiv({
                    attr: {
                        style: `height:100%;width:${task.progress}%;background:var(--interactive-accent);transition:width 0.3s;`
                    }
                });
            }

            if (task.error) {
                row.createEl('div', {
                    text: task.error,
                    cls: 'nw-u-fs-11px-2 nw-u-c-text-error nw-u-marginbottom-4px-2'
                });
            }

            const metaRow = row.createDiv({ cls: 'nw-u-d-flex-2 nw-u-jc-space-between-2 nw-u-ai-center-2' });
            metaRow.createEl('span', {
                text: `重试 ${task.retryCount}/${task.maxRetries}`,
                cls: 'nw-u-fs-10px-2 nw-u-c-text-muted-2'
            });

            const btnRow = metaRow.createDiv({ cls: 'nw-u-d-flex-2 nw-u-gap-4px-2' });
            if (task.status === 'queued') {
                const pauseBtn = btnRow.createEl('button', {
                    text: '⏸',
                    cls: 'nw-btn nw-btn-ghost nw-btn-xs nw-btn-icon-xs'
                });
                pauseBtn.addEventListener('click', () => this.batchManager.pauseTask(task.id));
            }
            if (task.status === 'pending') {
                const resumeBtn = btnRow.createEl('button', {
                    text: '▶',
                    cls: 'nw-btn nw-btn-ghost nw-btn-xs nw-btn-icon-xs'
                });
                resumeBtn.addEventListener('click', () => this.batchManager.resumeTask(task.id));
            }
            if (task.status === 'failed' || task.status === 'cancelled') {
                const retryBtn = btnRow.createEl('button', {
                    text: '🔄',
                    cls: 'nw-btn nw-btn-ghost nw-btn-xs nw-btn-icon-xs'
                });
                retryBtn.addEventListener('click', () => this.batchManager.retryTask(task.id));
            }
            if (task.status !== 'completed') {
                const cancelBtn = btnRow.createEl('button', {
                    text: '✕',
                    cls: "nw-btn nw-btn-ghost nw-btn-xs nw-btn-icon-xs nw-u-c-text-error", attr: {}
                });
                cancelBtn.addEventListener('click', () => this.batchManager.cancelTask(task.id));
            }
        });
    }

    private getTaskStatusLabel(status: string): string {
        const labels: Record<string, string> = {
            queued: '排队中',
            pending: '已暂停',
            processing: '处理中',
            completed: '已完成',
            failed: '失败',
            cancelled: '已取消',
        };
        return labels[status] || status;
    }

    private renderStep5(container: HTMLElement): void {
        const tabs = container.createDiv({
            cls: 'nw-u-d-flex-2 nw-u-bb-1px-solid-background-m-2 nw-u-marginbottom-12px-2'
        });

        const recentTab = tabs.createEl('button', {
            text: '本次结果',
            attr: {
                style: `padding:8px 16px;font-size:13px;cursor:pointer;background:none;border:none;border-bottom:2px solid ${
                    this.historyTab === 'recent' ? 'var(--interactive-accent)' : 'transparent'
                };color:${this.historyTab === 'recent' ? 'var(--interactive-accent)' : 'var(--text-muted)'};font-weight:${this.historyTab === 'recent' ? '500' : '400'};`
            }
        });
        recentTab.addEventListener('click', () => {
            this.historyTab = 'recent';
            this.render();
        });

        const allTab = tabs.createEl('button', {
            text: '历史记录',
            attr: {
                style: `padding:8px 16px;font-size:13px;cursor:pointer;background:none;border:none;border-bottom:2px solid ${
                    this.historyTab === 'all' ? 'var(--interactive-accent)' : 'transparent'
                };color:${this.historyTab === 'all' ? 'var(--interactive-accent)' : 'var(--text-muted)'};font-weight:${this.historyTab === 'all' ? '500' : '400'};`
            }
        });
        allTab.addEventListener('click', () => {
            this.historyTab = 'all';
            this.render();
        });

        if (this.historyTab === 'recent') {
            this.renderRecentResult(container);
        } else {
            this.renderHistoryList(container);
        }
    }

    private renderRecentResult(container: HTMLElement): void {
        const progress = this.batchManager.getProgress();
        const tasks = this.batchManager.getAllTasks();

        if (tasks.length === 0) {
            container.createDiv({
                cls: 'nw-empty-hint'
            }).createEl('span', { text: '还没有导入记录，返回第一步开始导入吧' });
            return;
        }

        const statsRow = container.createDiv({
            cls: 'nw-u-d-grid-2 nw-u-gtc-repeat-3-1fr-2 nw-u-gap-12px-2 nw-u-marginbottom-16px-2'
        });

        const successCard = statsRow.createDiv({
            cls: "nw-result-card nw-u-b-1px-solid-background-m-3", attr: {}
        });
        successCard.createEl('div', {
            text: progress.completedTasks.toString(),
            cls: "nw-result-number nw-u-c-text-success", attr: {}
        });
        successCard.createEl('div', { text: '✅ 成功', cls: 'nw-text-sm-muted' });

        const failedCard = statsRow.createDiv({
            cls: "nw-result-card nw-u-b-1px-solid-background-m-4", attr: {}
        });
        failedCard.createEl('div', {
            text: progress.failedTasks.toString(),
            cls: "nw-result-number nw-u-c-text-error", attr: {}
        });
        failedCard.createEl('div', { text: '❌ 失败', cls: 'nw-text-sm-muted' });

        const totalCard = statsRow.createDiv({
            cls: "nw-result-card nw-u-b-1px-solid-background-m-2", attr: {}
        });
        totalCard.createEl('div', {
            text: progress.totalTasks.toString(),
            cls: "nw-result-number nw-u-c-text-muted-2", attr: {}
        });
        totalCard.createEl('div', { text: '📚 总计', cls: 'nw-text-sm-muted' });

        const successTasks = tasks.filter(t => t.status === 'completed');
        if (successTasks.length > 0) {
            const successSection = container.createDiv({ cls: 'nw-u-marginbottom-16px-2' });
            successSection.createEl('div', {
                text: '成功列表',
                cls: "nw-label-md nw-u-marginbottom-8px-2", attr: {}
            });
            const successList = successSection.createDiv({
                cls: 'nw-u-maxh-160px nw-u-ovy-auto-2 nw-u-b-1px-solid-background-m-2 nw-u-brd-4px-2'
            });
            successTasks.forEach((task, index) => {
                const row = successList.createDiv({
                    attr: {
                        style: `display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border-bottom:1px solid var(--background-modifier-border);${
                            index === successTasks.length - 1 ? 'border-bottom:none;' : ''
                        }`
                    }
                });
                row.createEl('span', { text: `✅ ${task.bookName}`, cls: 'nw-u-fs-12px-2' });
                const detailBtn = row.createEl('button', {
                    text: '查看详情',
                    cls: 'nw-btn nw-btn-ghost nw-btn-xs',
                });
                detailBtn.addEventListener('click', () => {
                    if (task.bookId && this.options.onViewDetail) {
                        // 跳详情由视图自己 loadBooks + 挂详情容器；
                        // 这里若再让 onClose 走 onComplete，会把刚建好的详情面板重建回列表。
                        this.completionReported = true;
                        this.options.onViewDetail(task.bookId, task.bookName);
                        this.close();
                    }
                });
            });
        }

        const failedTasks = tasks.filter(t => t.status === 'failed');
        if (failedTasks.length > 0) {
            const failedSection = container.createDiv({ cls: 'nw-u-marginbottom-8px-2' });
            failedSection.createEl('div', {
                text: '失败列表',
                cls: "nw-label-md nw-u-marginbottom-8px-2", attr: {}
            });
            const failedList = failedSection.createDiv({
                cls: 'nw-u-maxh-160px nw-u-ovy-auto-2 nw-u-b-1px-solid-background-m-4 nw-u-brd-4px-2'
            });
            failedTasks.forEach((task, index) => {
                const row = failedList.createDiv({
                    attr: {
                        style: `padding:8px 12px;border-bottom:1px solid var(--background-modifier-error-hover);${
                            index === failedTasks.length - 1 ? 'border-bottom:none;' : ''
                        }`
                    }
                });
                row.createEl('div', {
                    text: `❌ ${task.bookName}`,
                    cls: 'nw-u-fs-12px-2 nw-u-fwt-500-2 nw-u-marginbottom-2px-2'
                });
                row.createEl('div', {
                    text: task.error || '未知错误',
                    cls: 'nw-u-fs-11px-2 nw-u-c-text-error nw-u-marginbottom-4px-2'
                });
                const retryBtn = row.createEl('button', {
                    text: '🔄 重新导入',
                    cls: 'nw-btn nw-btn-secondary nw-btn-xs',
                });
                retryBtn.addEventListener('click', () => {
                    this.batchManager.retryTask(task.id);
                    this.currentStep = 4;
                    this.render();
                });
            });
        }
    }

    private renderHistoryList(container: HTMLElement): void {
        const history = this.batchManager.getHistory();

        if (history.length === 0) {
            container.createDiv({
                cls: 'nw-empty-hint'
            }).createEl('span', { text: '暂无导入历史记录' });
            return;
        }

        const listContainer = container.createDiv({
            cls: "nw-scroll-box nw-u-maxh-400px-2", attr: {}
        });

        history.forEach((item, index) => {
            const card = listContainer.createDiv({
                attr: {
                    style: `padding:12px;border-bottom:1px solid var(--background-modifier-border);cursor:pointer;${
                        index === history.length - 1 ? 'border-bottom:none;' : ''
                    }${this.selectedHistoryId === item.id ? 'background:var(--background-secondary-alt);' : ''}`
                }
            });

            const header = card.createDiv({
                cls: "nw-flex-between nw-u-marginbottom-8px-2", attr: {}
            });
            header.createEl('span', {
                text: this.formatDateTime(item.importTime),
                cls: 'nw-u-fs-12px-2 nw-u-fwt-500-2'
            });
            const statsWrap = header.createDiv({ cls: 'nw-flex-row' });
            statsWrap.createEl('span', {
                text: `✅ ${item.successCount}`,
                cls: 'nw-u-fs-11px-2 nw-u-c-text-success'
            });
            statsWrap.createEl('span', {
                text: `❌ ${item.failedCount}`,
                cls: 'nw-u-fs-11px-2 nw-u-c-text-error'
            });

            const metaRow = card.createDiv({
                cls: 'nw-u-d-flex-2 nw-u-gap-12px-2 nw-u-fs-11px-2 nw-u-c-text-muted-2'
            });
            metaRow.createEl('span', { text: `总计 ${item.totalCount} 本` });
            metaRow.createEl('span', {
                text: `拆解维度: ${item.settings.dimensions.length} 个`
            });

            card.addEventListener('click', () => {
                this.selectedHistoryId = this.selectedHistoryId === item.id ? null : item.id;
                this.render();
            });

            if (this.selectedHistoryId === item.id) {
                const detail = card.createDiv({
                    cls: 'nw-u-margintop-10px nw-u-paddingtop-10px nw-u-bt-1px-solid-background-m-2'
                });

                const bookList = detail.createDiv({
                    cls: 'nw-u-maxh-150px-2 nw-u-ovy-auto-2 nw-u-marginbottom-8px-2'
                });
                item.books.forEach(book => {
                    const bookRow = bookList.createDiv({
                        cls: 'nw-u-d-flex-2 nw-u-jc-space-between-2 nw-u-ai-center-2 nw-u-p-4px-0-2 nw-u-fs-11px-2'
                    });
                    const statusIcon = book.status === 'success' ? '✅' : book.status === 'failed' ? '❌' : '⏭️';
                    bookRow.createEl('span', { text: `${statusIcon} ${book.bookName}` });
                    if (book.status === 'failed') {
                        bookRow.createEl('span', {
                            text: book.error || '失败',
                            cls: 'nw-u-c-text-error'
                        });
                    }
                });

                const btnRow = detail.createDiv({ cls: 'nw-u-d-flex-2 nw-u-gap-8px-2 nw-u-jc-flex-end-2' });
                if (item.failedCount > 0) {
                    const retryBtn = btnRow.createEl('button', {
                        text: '🔄 重试失败项',
                        cls: 'nw-btn nw-btn-secondary nw-btn-sm',
                    });
                    retryBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.batchManager.retryFailedFromHistory(item.id);
                        this.currentStep = 4;
                        this.render();
                    });
                }
            }
        });
    }

    private renderFooter(): void {
        const btnRow = this.contentEl.createDiv({
            cls: 'nw-u-d-flex-2 nw-u-gap-8px-2 nw-u-margintop-20px-2 nw-u-jc-space-between-2'
        });

        const leftBtns = btnRow.createDiv({ cls: 'nw-flex-row' });
        const rightBtns = btnRow.createDiv({ cls: 'nw-flex-row' });

        if (this.currentStep === 1) {
            rightBtns.createEl('button', {
                text: '取消',
                cls: 'nw-btn nw-btn-secondary',
            }).addEventListener('click', () => this.close());

            const nextBtn = rightBtns.createEl('button', {
                text: '下一步 →',
                cls: 'nw-btn nw-btn-primary',
            });
            nextBtn.addEventListener('click', () => this.goToStep(2));

        } else if (this.currentStep === 2) {
            leftBtns.createEl('button', {
                text: '← 上一步',
                cls: 'nw-btn nw-btn-secondary',
            }).addEventListener('click', () => this.goToStep(1));

            rightBtns.createEl('button', {
                text: '取消',
                cls: 'nw-btn nw-btn-secondary',
            }).addEventListener('click', () => this.close());

            const nextBtn = rightBtns.createEl('button', {
                text: '下一步 →',
                cls: 'nw-btn nw-btn-primary',
            });
            nextBtn.addEventListener('click', () => this.goToStep(3));

        } else if (this.currentStep === 3) {
            leftBtns.createEl('button', {
                text: '← 上一步',
                cls: 'nw-btn nw-btn-secondary',
            }).addEventListener('click', () => this.goToStep(2));

            rightBtns.createEl('button', {
                text: '取消',
                cls: 'nw-btn nw-btn-secondary',
            }).addEventListener('click', () => this.close());

            const startBtn = rightBtns.createEl('button', {
                text: '🚀 开始导入',
                cls: 'nw-btn nw-btn-primary',
            });
            startBtn.addEventListener('click', () => this.startImport());

        } else if (this.currentStep === 4) {
            const cancelBtn = rightBtns.createEl('button', {
                text: '取消全部',
                cls: 'nw-btn nw-btn-danger',
            });
            cancelBtn.addEventListener('click', () => {
                const tasks = this.batchManager.getAllTasks();
                tasks.forEach(t => {
                    if (t.status !== 'completed') {
                        this.batchManager.cancelTask(t.id);
                    }
                });
            });

            const doneBtn = rightBtns.createEl('button', {
                text: '查看结果 →',
                cls: 'nw-btn nw-btn-primary',
            });
            doneBtn.addEventListener('click', () => {
                this.currentStep = 5;
                this.historyTab = 'recent';
                this.render();
            });

        } else if (this.currentStep === 5) {
            const continueBtn = leftBtns.createEl('button', {
                text: '📂 继续导入',
                cls: 'nw-btn nw-btn-secondary',
            });
            continueBtn.addEventListener('click', () => {
                this.currentStep = 1;
                this.batchManager.clearPreviews();
                this.render();
            });

            const doneBtn = rightBtns.createEl('button', {
                text: '完成',
                cls: 'nw-btn nw-btn-primary',
            });
            doneBtn.addEventListener('click', async () => {
                this.completionReported = true;
                await this.reportCompletion();
                this.close();
            });
        }
    }

    private goToStep(step: ImportStep): void {
        if (step === 2) {
            const selected = this.batchManager.getSelectedPreviews();
            if (selected.length === 0) {
                new Notice('❌ 请至少选择一个文件');
                return;
            }
        }
        this.currentStep = step;
        this.render();
    }

    private handleLocalFiles(fileList: FileList): void {
        const validExtensions = ['.txt', '.md', '.epub'];
        let addedCount = 0;
        const jobs: Array<Promise<void>> = [];

        Array.from(fileList).forEach(file => {
            const ext = '.' + file.name.split('.').pop()?.toLowerCase();
            if (!validExtensions.includes(ext)) return;

            const reader = new FileReader();
            // 等所有 FileReader 完成后统一计数并重绘：旧实现用 setTimeout(100ms)
            // 猜完成时间，大文件会漏报，且每读一个文件就整页重绘。
            const job = new Promise<void>((resolve) => {
                reader.onload = (e) => {
                    const content = e.target?.result as string || '';
                    if (ext !== '.epub') {
                        this.batchManager.addPreview({
                            filename: file.name,
                            content,
                            source: 'local-file',
                        });
                        addedCount++;
                    } else {
                        new Notice('⚠️ EPUB 格式暂不支持，已跳过');
                    }
                    resolve();
                };
                reader.onerror = () => resolve();
            });
            jobs.push(job);
            reader.readAsText(file);
        });

        void Promise.all(jobs).then(() => {
            if (addedCount > 0) {
                this.render();
                showSuccessNotice(`已添加 ${addedCount} 个文件`);
            }
        });
    }

    private showVaultFilePicker(): void {
        const allFiles = this.app.vault.getFiles().filter(f =>
            f.extension.toLowerCase() === 'txt' || f.extension.toLowerCase() === 'md'
        );

        if (allFiles.length === 0) {
            new Notice('⚠️ 库中没有找到 .txt 或 .md 文件');
            return;
        }

        const pickerModal = new Modal(this.app);
        pickerModal.modalEl.addClass('nw-scope');
        pickerModal.modalEl.addClass('nw-modal-sm');
        pickerModal.titleEl.setText('从库内选择文件');

        const content = pickerModal.contentEl;
        content.style.padding = '12px';

        const searchInput = content.createEl('input', {
            type: 'text',
            attr: {
                placeholder: '搜索文件...',
                style: 'width:100%;padding:8px;margin-bottom:12px;border:1px solid var(--background-modifier-border);border-radius:4px;background:var(--background-primary);color:var(--text-normal);'
            }
        });

        const fileList = content.createDiv({
            cls: 'nw-u-b-1px-solid-background-m-2 nw-u-brd-4px-2 nw-u-maxh-300px-2 nw-u-ovy-auto-2'
        });

        const selectedPaths = new Set<string>();

        const renderFileList = (filter: string = '') => {
            fileList.empty();
            const filtered = allFiles.filter(f =>
                f.name.toLowerCase().includes(filter.toLowerCase()) ||
                f.path.toLowerCase().includes(filter.toLowerCase())
            );

            if (filtered.length === 0) {
                fileList.createDiv({
                    text: '没有找到匹配的文件',
                    cls: 'nw-u-p-20px-2 nw-u-ta-center-2 nw-u-c-text-faint-2 nw-u-fs-13px-2'
                });
                return;
            }

            filtered.forEach(file => {
                const row = fileList.createDiv({
                    cls: 'nw-u-d-flex-2 nw-u-ai-center-2 nw-u-gap-8px-2 nw-u-p-8px-10px-2 nw-u-bb-1px-solid-background-m-2 nw-u-cur-pointer-2'
                });

                const checkbox = row.createEl('input', {
                    type: 'checkbox',
                    cls: 'nw-u-cur-pointer-2'
                });
                checkbox.checked = selectedPaths.has(file.path);
                checkbox.addEventListener('change', () => {
                    if (checkbox.checked) {
                        selectedPaths.add(file.path);
                    } else {
                        selectedPaths.delete(file.path);
                    }
                });

                row.createEl('span', {
                    text: `📄 ${file.name}`,
                    cls: 'nw-u-fs-12px-2 nw-u-flex-1-2'
                });
                row.createEl('span', {
                    text: file.parent?.path || '',
                    cls: 'nw-u-fs-10px-2 nw-u-c-text-faint-2'
                });

                row.addEventListener('click', (e) => {
                    if (e.target !== checkbox) {
                        checkbox.checked = !checkbox.checked;
                        if (checkbox.checked) {
                            selectedPaths.add(file.path);
                        } else {
                            selectedPaths.delete(file.path);
                        }
                    }
                });
            });
        };

        searchInput.addEventListener('input', () => {
            renderFileList(searchInput.value);
        });

        renderFileList();

        const btnRow = content.createDiv({ cls: 'nw-u-d-flex-2 nw-u-jc-flex-end-2 nw-u-gap-8px-2 nw-u-margintop-16px-2' });

        const cancelBtn = btnRow.createEl('button', {
            text: '取消',
            cls: 'nw-btn nw-btn-secondary',
        });
        cancelBtn.addEventListener('click', () => pickerModal.close());

        const confirmBtn = btnRow.createEl('button', {
            text: '确认添加',
            cls: 'nw-btn nw-btn-primary',
        });
        confirmBtn.addEventListener('click', async () => {
            if (selectedPaths.size === 0) {
                new Notice('⚠️ 请至少选择一个文件');
                return;
            }

            let addedCount = 0;
            for (const path of selectedPaths) {
                const abstractFile = this.app.vault.getAbstractFileByPath(path);
                if (abstractFile) {
                    try {
                        const content = await this.app.vault.cachedRead(abstractFile as TFile);
                        this.batchManager.addPreview({
                            filename: abstractFile.name,
                            content,
                            source: 'vault-file',
                            sourcePath: path,
                        });
                        addedCount++;
                    } catch (e) {
                        log.error('[BatchImportModal] 读取文件失败:', path, e);
                    }
                }
            }

            pickerModal.close();
            this.render();

            if (addedCount > 0) {
                showSuccessNotice(`已添加 ${addedCount} 个文件`);
            }
        });

        pickerModal.open();
    }

    private getFilesInFolder(folder: TFolder): TFile[] {
        const result: TFile[] = [];
        const validExtensions = ['txt', 'md'];

        for (const child of folder.children) {
            if (child instanceof TFolder) {
                result.push(...this.getFilesInFolder(child));
            } else if (validExtensions.includes((child as TFile).extension?.toLowerCase())) {
                result.push(child as TFile);
            }
        }

        return result;
    }

    private showVaultFolderPicker(): void {
        const allFolders = this.app.vault.getAllLoadedFiles().filter(f => f instanceof TFolder) as TFolder[];

        const foldersWithFiles: { folder: TFolder; fileCount: number }[] = [];
        for (const folder of allFolders) {
            const files = this.getFilesInFolder(folder);
            if (files.length > 0) {
                foldersWithFiles.push({ folder, fileCount: files.length });
            }
        }

        foldersWithFiles.sort((a, b) => a.folder.path.localeCompare(b.folder.path));

        if (foldersWithFiles.length === 0) {
            new Notice('⚠️ 库中没有找到包含 .txt 或 .md 文件的文件夹');
            return;
        }

        const pickerModal = new Modal(this.app);
        pickerModal.modalEl.addClass('nw-scope');
        pickerModal.modalEl.addClass('nw-modal-sm');
        pickerModal.titleEl.setText('从库内选择文件夹');

        const content = pickerModal.contentEl;
        content.style.padding = '12px';

        const searchInput = content.createEl('input', {
            type: 'text',
            attr: {
                placeholder: '搜索文件夹...',
                style: 'width:100%;padding:8px;margin-bottom:12px;border:1px solid var(--background-modifier-border);border-radius:4px;background:var(--background-primary);color:var(--text-normal);'
            }
        });

        const folderList = content.createDiv({
            cls: 'nw-u-b-1px-solid-background-m-2 nw-u-brd-4px-2 nw-u-maxh-300px-2 nw-u-ovy-auto-2'
        });

        let selectedFolderPath: string | null = null;

        const renderFolderList = (filter: string = '') => {
            folderList.empty();
            const filtered = foldersWithFiles.filter(item =>
                item.folder.path.toLowerCase().includes(filter.toLowerCase()) ||
                item.folder.name.toLowerCase().includes(filter.toLowerCase())
            );

            if (filtered.length === 0) {
                folderList.createDiv({
                    text: '没有找到匹配的文件夹',
                    cls: 'nw-u-p-20px-2 nw-u-ta-center-2 nw-u-c-text-faint-2 nw-u-fs-13px-2'
                });
                return;
            }

            filtered.forEach(item => {
                const row = folderList.createDiv({
                    cls: 'nw-u-d-flex-2 nw-u-ai-center-2 nw-u-gap-8px-2 nw-u-p-8px-10px-2 nw-u-bb-1px-solid-background-m-2 nw-u-cur-pointer-2'
                });

                if (selectedFolderPath === item.folder.path) {
                    row.style.backgroundColor = 'var(--background-modifier-hover)';
                }

                row.createEl('span', { text: '📁', cls: 'nw-u-fs-14px-2' });
                row.createEl('span', {
                    text: item.folder.path || '(根目录)',
                    cls: 'nw-u-fs-12px-2 nw-u-flex-1-2'
                });
                row.createEl('span', {
                    text: `${item.fileCount} 个文件`,
                    cls: 'nw-u-fs-10px-2 nw-u-c-text-faint-2'
                });

                row.addEventListener('click', () => {
                    selectedFolderPath = item.folder.path;
                    renderFolderList(searchInput.value);
                });
            });
        };

        searchInput.addEventListener('input', () => {
            renderFolderList(searchInput.value);
        });

        renderFolderList();

        const btnRow = content.createDiv({ cls: 'nw-u-d-flex-2 nw-u-jc-flex-end-2 nw-u-gap-8px-2 nw-u-margintop-16px-2' });

        const cancelBtn = btnRow.createEl('button', {
            text: '取消',
            cls: 'nw-btn nw-btn-secondary',
        });
        cancelBtn.addEventListener('click', () => pickerModal.close());

        const confirmBtn = btnRow.createEl('button', {
            text: '确认导入',
            cls: 'nw-btn nw-btn-primary',
        });
        confirmBtn.addEventListener('click', async () => {
            if (!selectedFolderPath) {
                new Notice('⚠️ 请选择一个文件夹');
                return;
            }

            const abstractFile = this.app.vault.getAbstractFileByPath(selectedFolderPath);
            if (!abstractFile || !(abstractFile instanceof TFolder)) {
                new Notice('⚠️ 文件夹不存在');
                return;
            }

            const files = this.getFilesInFolder(abstractFile);
            let addedCount = 0;

            for (const file of files) {
                try {
                    const content = await this.app.vault.cachedRead(file);
                    this.batchManager.addPreview({
                        filename: file.name,
                        content,
                        source: 'vault-folder',
                        sourcePath: file.path,
                    });
                    addedCount++;
                } catch (e) {
                    log.error('[BatchImportModal] 读取文件失败:', file.path, e);
                }
            }

            pickerModal.close();
            this.render();

            if (addedCount > 0) {
                showSuccessNotice(`已从文件夹添加 ${addedCount} 个文件`);
            } else {
                new Notice('⚠️ 没有新增文件（可能已存在）');
            }
        });

        pickerModal.open();
    }

    private addCustomTag(): void {
        const tag = this.customTagInput.trim();
        if (!tag) return;
        if (this.customTags.includes(tag)) {
            new Notice('⚠️ 该标签已存在');
            return;
        }
        this.customTags.push(tag);
        this.customTagInput = '';
        this.render();
    }

    private applyPreset(preset: ImportPreset): void {
        this.selectedPresetId = preset.id;
        const s = preset.settings;
        this.selectedDimensions = [...s.dimensions];
        this.autoStartDeconstruction = s.autoStartDeconstruction;
        this.autoClassify = s.autoClassify;
        this.priority = s.priority;
        this.concurrency = s.concurrency;
        this.customTags = [...s.customTags];
        showSuccessNotice(`已应用预设：${preset.name}`);
        this.render();
    }

    private saveCurrentAsPreset(): void {
        const name = this.presetNameInput.trim();
        if (!name) {
            new Notice('⚠️ 请输入预设名称');
            return;
        }

        const settings: ImportBatchSettings = {
            themeTags: [],
            techniqueTags: [],
            customTags: [...this.customTags],
            dimensions: [...this.selectedDimensions],
            autoStartDeconstruction: this.autoStartDeconstruction,
            autoClassify: this.autoClassify,
            priority: this.priority,
            concurrency: this.concurrency,
        };

        this.batchManager.savePreset(name, settings);
        this.presetNameInput = '';
        showSuccessNotice(`预设已保存：${name}`);
        this.render();
    }

    private startImport(): void {
        const selected = this.batchManager.getSelectedPreviews();
        if (selected.length === 0) {
            new Notice('❌ 没有选中的文件');
            return;
        }

        const themeTagNames = this.selectedThemeTagIds
            .map(id => this.options.tagManager.getTagById(id)?.name)
            .filter((n): n is string => !!n);
        const techniqueTagNames = this.selectedTechniqueTagIds
            .map(id => this.options.tagManager.getTagById(id)?.name)
            .filter((n): n is string => !!n);

        this.batchManager.setSettings({
            themeTags: themeTagNames,
            techniqueTags: techniqueTagNames,
            customTags: [...this.customTags],
            dimensions: [...this.selectedDimensions],
            autoStartDeconstruction: this.autoStartDeconstruction,
            autoClassify: this.autoClassify,
            priority: this.priority,
            concurrency: this.concurrency,
        });

        this.batchManager.startImport();
        this.currentStep = 4;
        this.isImporting = true;
        this.batchStarted = true;
        this.completionReported = false;
        this.render();
    }

    private appendLog(message: string): void {
        if (!this.logEl) return;
        const logLine = this.logEl.createEl('div', {
            text: `[${new Date().toLocaleTimeString()}] ${message}`,
            cls: 'nw-u-marginbottom-2px-2'
        });
        this.logEl.scrollTop = this.logEl.scrollHeight;
        void logLine;
    }

    private formatWordCount(count?: number): string {
        if (!count) return '0';
        if (count >= 10000) {
            return (count / 10000).toFixed(1) + '万字';
        }
        return count.toLocaleString() + '字';
    }

    private formatDateTime(timestamp: number): string {
        const date = new Date(timestamp);
        const pad = (n: number) => n.toString().padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }
}
