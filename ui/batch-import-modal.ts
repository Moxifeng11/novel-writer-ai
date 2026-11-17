import { App, Modal, Notice, TFolder, TFile } from 'obsidian';
import { KnowledgeBaseManager, MAX_SOURCE_FILE_SIZE } from '@/services/knowledge-base-manager';
import { DeconstructionScheduler, type BreakdownDimension } from '@/engine/deconstruction-scheduler';
import { KnowledgeTagManager } from '@/engine/knowledge-tags';
import { BatchImportManager, type ImportBookPreview, type ImportHistoryItem, type ImportBatchSettings, type ImportPreset, type BatchImportProgress, type ImportTask } from '@/engine/batch-import-manager';
import { type BookRecognitionResult } from '@/services/chapter-recognizer';
import { ENGINE_NAMES } from '@/shared/engine-names';
import type { EngineRegistry } from '@/engine/engine-registry';
import { createLogger } from '@/shared/logger';
import { isImeComposing } from '@/shared/keyboard';
import { showErrorNotice, showSuccessNotice, showWarningNotice } from '@/ui/components/notice-helpers';
import { setSanitizedHtml } from '@/ui/rendering/safe-html';


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

        // SLICE-H-CAPTURE-HOOK（截图临时钩子，提交前删除）
        (activeWindow as unknown as Record<string, unknown>).__nwBi = this;
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

        const contentDiv = contentEl.createDiv({ cls: 'nw-bi-body' });

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
        const stepsDiv = this.contentEl.createDiv({ cls: 'nw-bi-steps' });

        const steps: ImportStep[] = [1, 2, 3, 4, 5];
        steps.forEach((step, index) => {
            const stepEl = stepsDiv.createEl('span', {
                text: `${step}. ${STEP_LABELS[step]}`,
                cls: 'nw-bi-step'
            });
            stepEl.addClass(
                step === this.currentStep
                    ? 'nw-bi-step--current'
                    : step < this.currentStep
                    ? 'nw-bi-step--done'
                    : 'nw-bi-step--todo'
            );

            if (index < steps.length - 1) {
                stepsDiv.createEl('span', {
                    text: '→',
                    cls: 'nw-bi-step-arrow'
                });
            }
        });
    }

    private renderStep1(container: HTMLElement): void {
        container.createEl('div', {
            text: '选择要导入的小说文件（支持 .txt、.md 格式）',
            cls: 'nw-bi-intro'
        });

        const btnRow = container.createDiv({ cls: 'nw-bi-toolbar' });

        const selectFileBtn = btnRow.createEl('button', {
            text: '📁 选择本地文件',
            cls: 'nw-btn nw-btn-secondary nw-btn-sm',
        });
        // 隐藏 input 必须挂在容器上，不能挂在按钮里：
        // input.click() 派发的事件会冒泡回父按钮，再次进入本监听 → 同步递归（栈溢出）。
        const fileInput = btnRow.createEl('input', {
            attr: { type: 'file', multiple: '', accept: '.txt,.md,.epub' },
            cls: 'nw-bi-hidden'
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
            cls: 'nw-btn nw-btn-ghost nw-btn-sm nw-bi-toolbar-end'
        });
        historyBtn.addEventListener('click', () => {
            this.currentStep = 5;
            this.render();
        });

        const dropArea = container.createDiv({
            cls: 'nw-bi-drop'
        });
        dropArea.createEl('div', {
            text: '📥 拖拽文件到此处',
            cls: 'nw-bi-drop-title'
        });
        dropArea.createEl('div', {
            text: '支持 .txt、.md、.epub 格式',
            cls: 'nw-bi-drop-hint'
        });

        dropArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropArea.addClass('nw-bi-drop--over');
        });
        dropArea.addEventListener('dragleave', () => {
            dropArea.removeClass('nw-bi-drop--over');
        });
        dropArea.addEventListener('drop', (e) => {
            e.preventDefault();
            dropArea.removeClass('nw-bi-drop--over');
            const files = e.dataTransfer?.files;
            if (files && files.length > 0) this.handleLocalFiles(files);
        });

        const previews = this.batchManager.getPreviews();

        const listHeader = container.createDiv({
            cls: 'nw-bi-list-header'
        });
        listHeader.createEl('span', {
            text: `已选文件 (${previews.length})`,
            cls: 'nw-bi-list-title'
        });

        const actionBtns = listHeader.createDiv({ cls: 'nw-bi-list-actions' });

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
            cls: 'nw-btn nw-btn-ghost nw-btn-xs nw-bi-btn-danger-text'
        });
        clearBtn.addEventListener('click', () => {
            this.batchManager.clearPreviews();
            this.render();
        });

        const fileListContainer = container.createDiv({ cls: 'nw-bi-file-list' });

        if (previews.length === 0) {
            fileListContainer.createDiv({ cls: 'nw-bi-empty nw-bi-empty--sm' })
                .createEl('span', { text: '暂无文件，请添加要导入的小说文件' });
        } else {
            previews.forEach(preview => {
                const row = fileListContainer.createDiv({ cls: 'nw-bi-file' });

                const checkbox = row.createEl('input', {
                    attr: { type: 'checkbox' },
                    cls: 'nw-bi-file-check'
                });
                checkbox.checked = preview.selected;
                checkbox.addEventListener('change', (e) => {
                    this.batchManager.updatePreview(preview.id, { selected: (e.target as HTMLInputElement).checked });
                });

                const infoWrap = row.createDiv({ cls: 'nw-bi-file-info' });
                const nameRow = infoWrap.createDiv({ cls: 'nw-bi-file-head' });
                nameRow.createEl('span', {
                    text: preview.filename,
                    cls: 'nw-bi-file-name'
                });
                const formatBadge = nameRow.createEl('span', {
                    text: preview.recognition.format.toUpperCase(),
                    cls: 'nw-bi-file-badge'
                });
                formatBadge.addClass(
                    preview.recognition.format === 'md'
                        ? 'nw-bi-file-badge--md'
                        : preview.recognition.format === 'txt'
                        ? 'nw-bi-file-badge--txt'
                        : 'nw-bi-file-badge--other'
                );

                const metaRow = infoWrap.createDiv({ cls: 'nw-bi-file-meta' });
                metaRow.createEl('span', { text: `📖 ${preview.recognition.chapterCount} 章` });
                metaRow.createEl('span', { text: `📝 ${this.formatWordCount(preview.recognition.wordCount)}` });
                metaRow.createEl('span', { text: `🎯 ${Math.round(preview.recognition.confidence * 100)}%` });

                const deleteBtn = row.createEl('button', {
                    text: '✕',
                    cls: 'nw-btn nw-btn-ghost nw-btn-xs nw-bi-file-remove'
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
            cls: 'nw-bi-intro'
        });

        if (previews.length === 0) {
            container.createDiv({ cls: 'nw-bi-empty' })
                .createEl('span', { text: '没有选中的文件，请返回上一步选择' });
            return;
        }

        const listContainer = container.createDiv({ cls: 'nw-bi-preview-list' });

        previews.forEach(preview => {
            const card = listContainer.createDiv({ cls: 'nw-bi-preview' });

            const header = card.createDiv({ cls: 'nw-bi-preview-head' });

            const titleInput = header.createEl('input', {
                type: 'text',
                value: preview.overrides.name || preview.recognition.title,
                cls: 'nw-bi-input nw-bi-preview-title'
            });
            titleInput.addEventListener('input', (e) => {
                const name = (e.target as HTMLInputElement).value;
                this.batchManager.updatePreview(preview.id, {
                    overrides: { ...preview.overrides, name }
                });
            });

            const confBadge = header.createEl('span', {
                text: `${Math.round(preview.recognition.confidence * 100)}%`,
                cls: 'nw-bi-badge'
            });
            confBadge.addClass(
                preview.recognition.confidence >= 0.7
                    ? 'nw-bi-badge--high'
                    : preview.recognition.confidence >= 0.4
                    ? 'nw-bi-badge--mid'
                    : 'nw-bi-badge--low'
            );

            const metaGrid = card.createDiv({ cls: 'nw-bi-meta-grid' });

            this.addMetaItem(metaGrid, '作者', preview.recognition.author || '未识别', true, (val) => {
                this.batchManager.updatePreview(preview.id, {
                    overrides: { ...preview.overrides, author: val }
                });
            });
            this.addMetaItem(metaGrid, '字数', this.formatWordCount(preview.recognition.wordCount));
            this.addMetaItem(metaGrid, '章节数', preview.recognition.chapterCount.toString());
            this.addMetaItem(metaGrid, '格式', preview.recognition.format.toUpperCase());

            if (preview.recognition.chapters.length > 0) {
                const chapterPreview = card.createDiv({ cls: 'nw-bi-chapters' });
                chapterPreview.createEl('div', {
                    text: '章节预览（前3章）',
                    cls: 'nw-bi-chapters-title'
                });
                preview.recognition.chapters.slice(0, 3).forEach(ch => {
                    const chRow = chapterPreview.createDiv({ cls: 'nw-bi-chapter-row' });
                    chRow.createEl('span', { text: ch.title, cls: 'nw-bi-chapter-name' });
                    chRow.createEl('span', { text: this.formatWordCount(ch.wordCount), cls: 'nw-bi-chapter-count' });
                });
                if (preview.recognition.chapters.length > 3) {
                    chapterPreview.createEl('div', {
                        text: `... 还有 ${preview.recognition.chapters.length - 3} 章`,
                        cls: 'nw-bi-chapters-more'
                    });
                }
            }
        });
    }

    private addMetaItem(container: HTMLElement, label: string, value: string, editable?: boolean, onChange?: (val: string) => void): void {
        const item = container.createDiv({ cls: 'nw-bi-meta' });
        item.createEl('div', { text: label, cls: 'nw-bi-meta-label' });
        if (editable && onChange) {
            const input = item.createEl('input', {
                type: 'text',
                value: value,
                cls: 'nw-bi-meta-input'
            });
            input.addEventListener('input', (e) => onChange((e.target as HTMLInputElement).value));
        } else {
            item.createEl('div', { text: value, cls: 'nw-bi-meta-value' });
        }
    }

    private renderStep3(container: HTMLElement): void {
        container.createEl('div', {
            text: '为所有导入的书籍统一设置',
            cls: 'nw-bi-intro nw-bi-intro--spaced'
        });

        const presetRow = container.createDiv({ cls: 'nw-bi-card nw-bi-card--spaced' });
        const presetHeader = presetRow.createDiv({ cls: 'nw-bi-list-header' });
        presetHeader.createEl('span', { text: '📋 预设方案', cls: 'nw-bi-list-title' });
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
            const presetList = presetRow.createDiv({ cls: 'nw-bi-preset-list' });
            if (presets.length === 0) {
                presetList.createEl('span', { text: '暂无预设', cls: 'nw-bi-hint' });
            } else {
                presets.forEach(preset => {
                    const presetEl = presetList.createEl('span', {
                        text: preset.name,
                        cls: 'nw-bi-pill'
                    });
                    if (this.selectedPresetId === preset.id) presetEl.addClass('nw-bi-pill--selected');
                    presetEl.addEventListener('click', () => {
                        this.applyPreset(preset);
                    });
                });
            }

            const savePresetRow = presetRow.createDiv({ cls: 'nw-bi-inline-row' });
            const presetInput = savePresetRow.createEl('input', {
                type: 'text',
                placeholder: '预设名称',
                value: this.presetNameInput,
                cls: 'nw-bi-input nw-bi-input--grow nw-bi-input--sm'
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

        const dimensionsSection = container.createDiv({ cls: 'nw-bi-section' });
        dimensionsSection.createEl('div', {
            text: '🔍 拆解维度',
            cls: 'nw-bi-section-title'
        });
        const dimContainer = dimensionsSection.createDiv({ cls: 'nw-bi-dim-box' });
        DIMENSION_OPTIONS.forEach(dim => {
            const isSelected = this.selectedDimensions.includes(dim.key);
            const dimEl = dimContainer.createEl('span', {
                text: `${dim.icon} ${dim.label}`,
                cls: 'nw-bi-chip'
            });
            if (isSelected) dimEl.addClass('nw-bi-chip--selected');
            dimEl.addEventListener('click', () => {
                if (isSelected) {
                    this.selectedDimensions = this.selectedDimensions.filter(d => d !== dim.key);
                } else {
                    this.selectedDimensions.push(dim.key);
                }
                this.render();
            });
        });

        const optionsGrid = container.createDiv({ cls: 'nw-bi-options-grid' });

        const concurrencyItem = optionsGrid.createDiv({ cls: 'nw-bi-card' });
        concurrencyItem.createEl('div', { text: '⚡ 并发数', cls: 'nw-bi-field-label' });
        const concurrencyInput = concurrencyItem.createEl('input', {
            type: 'number',
            value: this.concurrency.toString(),
            attr: { min: '1', max: '10' },
            cls: 'nw-bi-input nw-bi-input--block'
        });
        concurrencyInput.addEventListener('change', (e) => {
            this.concurrency = Math.max(1, Math.min(10, parseInt((e.target as HTMLInputElement).value) || 2));
        });

        const priorityItem = optionsGrid.createDiv({ cls: 'nw-bi-card' });
        priorityItem.createEl('div', { text: '⭐ 优先级', cls: 'nw-bi-field-label' });
        const prioritySelect = priorityItem.createEl('select', { cls: 'nw-bi-input nw-bi-input--block' });
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

        const togglesSection = container.createDiv({ cls: 'nw-bi-section' });
        togglesSection.createEl('div', {
            text: '⚙️ 其他选项',
            cls: 'nw-bi-section-title'
        });

        const toggleList = togglesSection.createDiv({ cls: 'nw-bi-toggle-box' });

        const autoStartRow = toggleList.createDiv({ cls: 'nw-bi-toggle-row' });
        autoStartRow.createEl('span', { text: '导入后自动开始拆解', cls: 'nw-bi-toggle-label' });
        const autoStartToggle = autoStartRow.createEl('input', {
            type: 'checkbox',
            cls: 'nw-bi-check'
        });
        autoStartToggle.checked = this.autoStartDeconstruction;
        autoStartToggle.addEventListener('change', (e) => {
            this.autoStartDeconstruction = (e.target as HTMLInputElement).checked;
        });

        const autoClassifyRow = toggleList.createDiv({ cls: 'nw-bi-toggle-row' });
        autoClassifyRow.createEl('span', { text: '自动识别题材分类', cls: 'nw-bi-toggle-label' });
        const autoClassifyToggle = autoClassifyRow.createEl('input', {
            type: 'checkbox',
            cls: 'nw-bi-check'
        });
        autoClassifyToggle.checked = this.autoClassify;
        autoClassifyToggle.addEventListener('change', (e) => {
            this.autoClassify = (e.target as HTMLInputElement).checked;
        });

        const tagsSection = container.createDiv({ cls: 'nw-bi-section nw-bi-section--tight' });
        tagsSection.createEl('div', {
            text: '🏷️ 标签设置',
            cls: 'nw-bi-section-title'
        });

        const themeCategoryRow = tagsSection.createDiv({ cls: 'nw-bi-cat-row' });
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
        const themeTagContainer = tagsSection.createDiv({ cls: 'nw-bi-tag-box nw-bi-tag-box--spaced' });
        if (themeTags.length === 0) {
            themeTagContainer.createEl('span', { text: '暂无题材标签', cls: 'nw-bi-hint' });
        } else {
            themeTags.forEach(tag => {
                const isSelected = this.selectedThemeTagIds.includes(tag.id);
                const tagEl = themeTagContainer.createEl('span', {
                    text: tag.name,
                    cls: 'nw-bi-tag'
                });
                if (isSelected) tagEl.addClass('nw-bi-tag--selected');
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

        const techniqueCategoryRow = tagsSection.createDiv({ cls: 'nw-bi-cat-row' });
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
        const techniqueTagContainer = tagsSection.createDiv({ cls: 'nw-bi-tag-box nw-bi-tag-box--spaced' });
        if (techniqueTags.length === 0) {
            techniqueTagContainer.createEl('span', { text: '暂无技巧标签', cls: 'nw-bi-hint' });
        } else {
            techniqueTags.forEach(tag => {
                const isSelected = this.selectedTechniqueTagIds.includes(tag.id);
                const tagEl = techniqueTagContainer.createEl('span', {
                    text: tag.name,
                    cls: 'nw-bi-tag'
                });
                if (isSelected) tagEl.addClass('nw-bi-tag--selected');
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

        const customInputRow = tagsSection.createDiv({ cls: 'nw-bi-inline-row nw-bi-inline-row--mb' });
        const customInput = customInputRow.createEl('input', {
            type: 'text',
            placeholder: '输入自定义标签名',
            value: this.customTagInput,
            cls: 'nw-bi-input nw-bi-input--grow nw-bi-input--sm'
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

        const customTagsContainer = tagsSection.createDiv({ cls: 'nw-bi-tag-box' });
        if (this.customTags.length === 0) {
            customTagsContainer.createEl('span', { text: '暂无自定义标签', cls: 'nw-bi-hint' });
        } else {
            this.customTags.forEach(tag => {
                const tagEl = customTagsContainer.createEl('span', {
                    text: tag,
                    cls: 'nw-bi-tag nw-bi-tag--removable'
                });
                const removeBtn = tagEl.createEl('span', {
                    text: '×',
                    cls: 'nw-bi-tag-close'
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
            cls: 'nw-bi-intro nw-bi-intro--spaced'
        });

        this.totalProgressEl = container.createDiv({ cls: 'nw-bi-progress' });
        const totalHeader = this.totalProgressEl.createDiv({ cls: 'nw-bi-list-header' });
        totalHeader.createEl('span', { text: '总体进度', cls: 'nw-bi-list-title' });
        this.totalProgressTextEl = totalHeader.createEl('span', {
            text: `${progress.completedTasks}/${progress.totalTasks} (${progress.overallProgress}%)`,
            cls: 'nw-bi-hint'
        });
        const totalBarBg = this.totalProgressEl.createDiv({ cls: 'nw-bi-progress-bar' });
        this.totalProgressBarEl = totalBarBg.createDiv({ cls: 'nw-bi-progress-fill' });
        this.totalProgressBarEl.style.setProperty('--nw-bi-pct', `${progress.overallProgress}%`);

        const statsRow = container.createDiv({ cls: 'nw-bi-stats' });
        this.addStatCard(statsRow, '总计', progress.totalTasks.toString(), 'muted');
        this.addStatCard(statsRow, '进行中', progress.activeTasks.toString(), 'accent');
        this.addStatCard(statsRow, '已完成', progress.completedTasks.toString(), 'success');
        this.addStatCard(statsRow, '失败', progress.failedTasks.toString(), 'error');

        const taskListHeader = container.createDiv({ cls: 'nw-bi-list-header' });
        taskListHeader.createEl('span', { text: '任务列表', cls: 'nw-bi-list-title' });

        const actionBtns = taskListHeader.createDiv({ cls: 'nw-bi-list-actions' });
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

        this.taskListEl = container.createDiv({ cls: 'nw-bi-task-list' });

        this.updateTaskList();

        const logHeader = container.createDiv({ cls: 'nw-bi-log-header' });
        logHeader.createEl('span', { text: '📋 导入日志' });
        const clearLogBtn = logHeader.createEl('button', {
            text: '清空',
            cls: 'nw-btn nw-btn-ghost nw-btn-xs',
        });
        clearLogBtn.addEventListener('click', () => {
            if (this.logEl) this.logEl.empty();
        });

        this.logEl = container.createDiv({ cls: 'nw-bi-log' });

        this.appendLog(`开始导入，共 ${progress.totalTasks} 本书籍`);
    }

    private addStatCard(
        container: HTMLElement,
        label: string,
        value: string,
        tone: 'muted' | 'accent' | 'success' | 'error'
    ): void {
        const card = container.createDiv({ cls: 'nw-bi-stat' });
        const valueEl = card.createEl('div', { text: value, cls: 'nw-bi-stat-value' });
        valueEl.addClass(`nw-bi-stat-value--${tone}`);
        card.createEl('div', { text: label, cls: 'nw-bi-stat-label' });
    }

    private updateProgressView(): void {
        const progress = this.batchManager.getProgress();
        if (this.totalProgressTextEl) {
            this.totalProgressTextEl.textContent = `${progress.completedTasks}/${progress.totalTasks} (${progress.overallProgress}%)`;
        }
        if (this.totalProgressBarEl) {
            this.totalProgressBarEl.style.setProperty('--nw-bi-pct', `${progress.overallProgress}%`);
        }
    }

    private updateTaskList(): void {
        if (!this.taskListEl) return;
        const tasks = this.batchManager.getAllTasks();
        if (tasks.length === 0) {
            setSanitizedHtml(this.taskListEl, '<div class="nw-bi-empty">暂无任务</div>');
            return;
        }

        this.taskListEl.empty();
        tasks.forEach(task => {
            const row = this.taskListEl.createDiv({ cls: 'nw-bi-task' });

            const header = row.createDiv({ cls: 'nw-bi-task-head' });
            const titleWrap = header.createDiv({ cls: 'nw-bi-task-title-wrap' });

            const statusDot = titleWrap.createEl('span', { cls: 'nw-bi-status-dot' });
            statusDot.addClass(`nw-bi-status-dot--${this.getStatusTone(task.status)}`);

            titleWrap.createEl('span', {
                text: task.bookName,
                cls: 'nw-bi-task-name'
            });

            const statusBadge = header.createEl('span', {
                text: this.getTaskStatusLabel(task.status),
                cls: 'nw-bi-task-badge'
            });
            const badgeTone =
                task.status === 'processing' || task.status === 'completed' || task.status === 'failed'
                    ? task.status
                    : 'muted';
            statusBadge.addClass(`nw-bi-task-badge--${badgeTone}`);

            if (task.status === 'processing' || task.status === 'queued') {
                const barBg = row.createDiv({ cls: 'nw-bi-task-bar' });
                const fill = barBg.createDiv({ cls: 'nw-bi-task-bar-fill' });
                fill.style.setProperty('--nw-bi-pct', `${task.progress}%`);
            }

            if (task.error) {
                row.createEl('div', {
                    text: task.error,
                    cls: 'nw-bi-task-error'
                });
            }

            const metaRow = row.createDiv({ cls: 'nw-bi-task-meta' });
            metaRow.createEl('span', {
                text: `重试 ${task.retryCount}/${task.maxRetries}`,
                cls: 'nw-bi-task-retry'
            });

            const btnRow = metaRow.createDiv({ cls: 'nw-bi-task-actions' });
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
                    cls: 'nw-btn nw-btn-ghost nw-btn-xs nw-btn-icon-xs nw-bi-btn-danger-text'
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

    private getStatusTone(status: string): string {
        switch (status) {
            case 'processing':
                return 'processing';
            case 'completed':
                return 'completed';
            case 'failed':
                return 'failed';
            case 'cancelled':
                return 'cancelled';
            default:
                return 'pending';
        }
    }

    private renderStep5(container: HTMLElement): void {
        const tabs = container.createDiv({ cls: 'nw-bi-tabs' });

        const recentTab = tabs.createEl('button', {
            text: '本次结果',
            cls: 'nw-bi-tab'
        });
        recentTab.addClass(this.historyTab === 'recent' ? 'nw-bi-tab--active' : 'nw-bi-tab--idle');
        recentTab.addEventListener('click', () => {
            this.historyTab = 'recent';
            this.render();
        });

        const allTab = tabs.createEl('button', {
            text: '历史记录',
            cls: 'nw-bi-tab'
        });
        allTab.addClass(this.historyTab === 'all' ? 'nw-bi-tab--active' : 'nw-bi-tab--idle');
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
            container.createDiv({ cls: 'nw-bi-empty' })
                .createEl('span', { text: '还没有导入记录，返回第一步开始导入吧' });
            return;
        }

        const statsRow = container.createDiv({ cls: 'nw-bi-result-grid' });

        const successCard = statsRow.createDiv({
            cls: 'nw-bi-result-card nw-bi-result-card--success'
        });
        successCard.createEl('div', {
            text: progress.completedTasks.toString(),
            cls: 'nw-bi-result-number nw-bi-result-number--success'
        });
        successCard.createEl('div', { text: '✅ 成功', cls: 'nw-bi-hint' });

        const failedCard = statsRow.createDiv({
            cls: 'nw-bi-result-card nw-bi-result-card--failed'
        });
        failedCard.createEl('div', {
            text: progress.failedTasks.toString(),
            cls: 'nw-bi-result-number nw-bi-result-number--error'
        });
        failedCard.createEl('div', { text: '❌ 失败', cls: 'nw-bi-hint' });

        const totalCard = statsRow.createDiv({ cls: 'nw-bi-result-card nw-bi-result-card--total' });
        totalCard.createEl('div', {
            text: progress.totalTasks.toString(),
            cls: 'nw-bi-result-number nw-bi-result-number--muted'
        });
        totalCard.createEl('div', { text: '📚 总计', cls: 'nw-bi-hint' });

        const successTasks = tasks.filter(t => t.status === 'completed');
        if (successTasks.length > 0) {
            const successSection = container.createDiv({ cls: 'nw-bi-section' });
            successSection.createEl('div', {
                text: '成功列表',
                cls: 'nw-bi-section-title'
            });
            const successList = successSection.createDiv({ cls: 'nw-bi-success-list' });
            successTasks.forEach(task => {
                const row = successList.createDiv({ cls: 'nw-bi-success-row' });
                row.createEl('span', { text: `✅ ${task.bookName}`, cls: 'nw-bi-success-name' });
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
            const failedSection = container.createDiv({ cls: 'nw-bi-section' });
            failedSection.createEl('div', {
                text: '失败列表',
                cls: 'nw-bi-section-title'
            });
            const failedList = failedSection.createDiv({ cls: 'nw-bi-failed-list' });
            failedTasks.forEach(task => {
                const row = failedList.createDiv({ cls: 'nw-bi-failed-row' });
                row.createEl('div', {
                    text: `❌ ${task.bookName}`,
                    cls: 'nw-bi-failed-name'
                });
                row.createEl('div', {
                    text: task.error || '未知错误',
                    cls: 'nw-bi-failed-error'
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
            container.createDiv({ cls: 'nw-bi-empty' })
                .createEl('span', { text: '暂无导入历史记录' });
            return;
        }

        const listContainer = container.createDiv({ cls: 'nw-bi-history-list' });

        history.forEach(item => {
            const card = listContainer.createDiv({ cls: 'nw-bi-history' });
            if (this.selectedHistoryId === item.id) card.addClass('nw-bi-history--selected');

            const header = card.createDiv({ cls: 'nw-bi-history-head' });
            header.createEl('span', {
                text: this.formatDateTime(item.importTime),
                cls: 'nw-bi-history-time'
            });
            const statsWrap = header.createDiv({ cls: 'nw-bi-history-stats' });
            statsWrap.createEl('span', {
                text: `✅ ${item.successCount}`,
                cls: 'nw-bi-ok-count'
            });
            statsWrap.createEl('span', {
                text: `❌ ${item.failedCount}`,
                cls: 'nw-bi-fail-count'
            });

            const metaRow = card.createDiv({ cls: 'nw-bi-history-meta' });
            metaRow.createEl('span', { text: `总计 ${item.totalCount} 本` });
            metaRow.createEl('span', {
                text: `拆解维度: ${item.settings.dimensions.length} 个`
            });

            card.addEventListener('click', () => {
                this.selectedHistoryId = this.selectedHistoryId === item.id ? null : item.id;
                this.render();
            });

            if (this.selectedHistoryId === item.id) {
                const detail = card.createDiv({ cls: 'nw-bi-history-detail' });

                const bookList = detail.createDiv({ cls: 'nw-bi-book-list' });
                item.books.forEach(book => {
                    const bookRow = bookList.createDiv({ cls: 'nw-bi-book-row' });
                    const statusIcon = book.status === 'success' ? '✅' : book.status === 'failed' ? '❌' : '⏭️';
                    bookRow.createEl('span', { text: `${statusIcon} ${book.bookName}` });
                    if (book.status === 'failed') {
                        bookRow.createEl('span', {
                            text: book.error || '失败',
                            cls: 'nw-bi-book-error'
                        });
                    }
                });

                const btnRow = detail.createDiv({ cls: 'nw-bi-history-actions' });
                if (item.failedCount > 0) {
                    const retryBtn = btnRow.createEl('button', {
                        text: '🔄 重试失败项',
                        cls: 'nw-btn nw-btn-secondary nw-btn-sm',
                    });
                    retryBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        // DSH-20261113-25 ③：tasks 只存本会话任务——重启/换批后对应
                        // 任务已不存在，不得静默空转让用户白等。
                        const { retried, missing } = this.batchManager.retryFailedFromHistory(item.id);
                        if (retried === 0 && missing.length > 0) {
                            showWarningNotice('任务记录已过期，请重新添加文件导入', { timeout: 5000 });
                            return;
                        }
                        if (missing.length > 0) {
                            showWarningNotice(`已重试 ${retried} 项；${missing.length} 项任务记录已过期`, { timeout: 5000 });
                        }
                        this.currentStep = 4;
                        this.render();
                    });
                }
            }
        });
    }

    private renderFooter(): void {
        const btnRow = this.contentEl.createDiv({ cls: 'nw-bi-footer' });

        const leftBtns = btnRow.createDiv({ cls: 'nw-bi-footer-group' });
        const rightBtns = btnRow.createDiv({ cls: 'nw-bi-footer-group' });

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
            // SEC-7：读前硬限，避免超大文件全量读入拖垮内存
            if (file.size > MAX_SOURCE_FILE_SIZE) {
                showWarningNotice(`文件过大已跳过: ${file.name}（${Math.round(file.size / 1024 / 1024)}MB，上限 10MB）`);
                return;
            }

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
                        showWarningNotice('EPUB 格式暂不支持，已跳过');
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
        content.addClass('nw-bi-picker-body');

        const searchInput = content.createEl('input', {
            type: 'text',
            placeholder: '搜索文件...',
            cls: 'nw-bi-search'
        });

        const fileList = content.createDiv({
            cls: 'nw-bi-picker-list'
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
                    cls: 'nw-bi-picker-empty'
                });
                return;
            }

            filtered.forEach(file => {
                const row = fileList.createDiv({
                    cls: 'nw-bi-picker-row'
                });

                const checkbox = row.createEl('input', {
                    type: 'checkbox',
                    cls: 'nw-bi-picker-check'
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
                    cls: 'nw-bi-picker-name'
                });
                row.createEl('span', {
                    text: file.parent?.path || '',
                    cls: 'nw-bi-picker-path'
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

        const btnRow = content.createDiv({ cls: 'nw-bi-picker-actions' });

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
        content.addClass('nw-bi-picker-body');

        const searchInput = content.createEl('input', {
            type: 'text',
            placeholder: '搜索文件夹...',
            cls: 'nw-bi-search'
        });

        const folderList = content.createDiv({
            cls: 'nw-bi-picker-list'
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
                    cls: 'nw-bi-picker-empty'
                });
                return;
            }

            filtered.forEach(item => {
                const row = folderList.createDiv({
                    cls: 'nw-bi-picker-row'
                });

                row.toggleClass('nw-bi-picker-row--selected', selectedFolderPath === item.folder.path);

                row.createEl('span', { text: '📁', cls: 'nw-bi-picker-icon' });
                row.createEl('span', {
                    text: item.folder.path || '(根目录)',
                    cls: 'nw-bi-picker-name'
                });
                row.createEl('span', {
                    text: `${item.fileCount} 个文件`,
                    cls: 'nw-bi-picker-path'
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

        const btnRow = content.createDiv({ cls: 'nw-bi-picker-actions' });

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
                showErrorNotice('文件夹不存在');
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
            cls: 'nw-bi-log-line'
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
