import { App, Modal, Notice, TFolder, TFile } from 'obsidian';
import { getLocale, t } from '@/i18n';
import { KnowledgeBaseManager, MAX_SOURCE_FILE_SIZE } from '@/services/knowledge-base-manager';
import { DeconstructionScheduler, type BreakdownDimension } from '@/engine/deconstruction-scheduler';
import { KnowledgeTagManager } from '@/engine/knowledge-tags';
import { BatchImportManager, type ImportBatchSettings, type ImportPreset } from '@/engine/batch-import-manager';
import '@/services/chapter-recognizer';
import { ENGINE_NAMES } from '@/shared/engine-names';
import type { EngineRegistry } from '@/engine/engine-registry';
import { createLogger } from '@/shared/logger';
import { isImeComposing } from '@/shared/keyboard';
import { showErrorNotice, showSuccessNotice, showWarningNotice } from '@/ui/components/notice-helpers';
import { setSanitizedHtml } from '@/ui/rendering/safe-html';
import { dimensionLabel } from '@/shared/deconstruction-settings';


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

// 分类名是数据键（tagManager.getTagsByType 的入参），只在按钮文案处翻译
const THEME_CATEGORIES = ['男频', '女频', '短篇', '衍生'];
const TECHNIQUE_CATEGORIES = ['结构类', '爽点类', '情绪类', '节奏类', '流派类'];

const DIMENSION_OPTIONS: { key: BreakdownDimension; icon: string }[] = [
    { key: 'style', icon: '🎨' },
    { key: 'rhythm', icon: '📈' },
    { key: 'technique', icon: '✍️' },
    { key: 'structure', icon: '🏗️' },
    { key: 'character', icon: '👤' },
    { key: 'foreshadow', icon: '🔮' },
];

function stepLabel(step: ImportStep): string {
    switch (step) {
        case 1: return t('batchImport.steps.select');
        case 2: return t('batchImport.steps.preview');
        case 3: return t('batchImport.steps.settings');
        case 4: return t('batchImport.steps.progress');
        default: return t('batchImport.steps.result');
    }
}

function themeCategoryLabel(category: string): string {
    switch (category) {
        case '男频': return t('batchImport.themeCategory.male');
        case '女频': return t('batchImport.themeCategory.female');
        case '短篇': return t('batchImport.themeCategory.short');
        case '衍生': return t('batchImport.themeCategory.derivative');
        default: return category;
    }
}

function techniqueCategoryLabel(category: string): string {
    switch (category) {
        case '结构类': return t('batchImport.techniqueCategory.structure');
        case '爽点类': return t('batchImport.techniqueCategory.hook');
        case '情绪类': return t('batchImport.techniqueCategory.emotion');
        case '节奏类': return t('batchImport.techniqueCategory.rhythm');
        case '流派类': return t('batchImport.techniqueCategory.genre');
        default: return category;
    }
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
            failedItems: tasks.filter(task => task.status === 'failed').map(task => ({
                filename: task.bookName,
                error: task.error || t('batchImport.result.unknownError'),
            })),
        };
        if (!this.options.onComplete) return;
        try {
            this.options.onComplete(result);
        } catch (error) {
            log.error('[BatchImportModal] onComplete callback failed:', error);
        }
    }

    private render(): void {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl('h3', { text: t('batchImport.title'), cls: 'nw-modal-title' });

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
            const stepEl = stepsDiv.createSpan({
                text: `${step}. ${stepLabel(step)}`,
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
                stepsDiv.createSpan({
                    text: '→',
                    cls: 'nw-bi-step-arrow'
                });
            }
        });
    }

    private renderStep1(container: HTMLElement): void {
        container.createDiv({
            text: t('batchImport.select.intro'),
            cls: 'nw-bi-intro'
        });

        const btnRow = container.createDiv({ cls: 'nw-bi-toolbar' });

        const selectFileBtn = btnRow.createEl('button', {
            text: t('batchImport.select.localFile'),
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
            text: t('batchImport.select.folder'),
            cls: 'nw-btn nw-btn-secondary nw-btn-sm',
        });
        selectFolderBtn.addEventListener('click', () => {
            this.showVaultFolderPicker();
        });

        const selectVaultBtn = btnRow.createEl('button', {
            text: t('batchImport.select.vault'),
            cls: 'nw-btn nw-btn-secondary nw-btn-sm',
        });
        selectVaultBtn.addEventListener('click', () => {
            this.showVaultFilePicker();
        });

        const historyBtn = btnRow.createEl('button', {
            text: t('batchImport.select.history'),
            cls: 'nw-btn nw-btn-ghost nw-btn-sm nw-bi-toolbar-end'
        });
        historyBtn.addEventListener('click', () => {
            this.currentStep = 5;
            this.render();
        });

        const dropArea = container.createDiv({
            cls: 'nw-bi-drop'
        });
        dropArea.createDiv({
            text: t('batchImport.select.dropTitle'),
            cls: 'nw-bi-drop-title'
        });
        dropArea.createDiv({
            text: t('batchImport.select.dropHint'),
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
        listHeader.createSpan({
            text: t('batchImport.select.selectedCount', { count: previews.length }),
            cls: 'nw-bi-list-title'
        });

        const actionBtns = listHeader.createDiv({ cls: 'nw-bi-list-actions' });

        const selectAllBtn = actionBtns.createEl('button', {
            text: t('batchImport.select.selectAll'),
            cls: 'nw-btn nw-btn-ghost nw-btn-xs',
        });
        selectAllBtn.addEventListener('click', () => {
            previews.forEach(p => this.batchManager.updatePreview(p.id, { selected: true }));
            this.render();
        });

        const deselectAllBtn = actionBtns.createEl('button', {
            text: t('batchImport.select.deselectAll'),
            cls: 'nw-btn nw-btn-ghost nw-btn-xs',
        });
        deselectAllBtn.addEventListener('click', () => {
            previews.forEach(p => this.batchManager.updatePreview(p.id, { selected: false }));
            this.render();
        });

        const clearBtn = actionBtns.createEl('button', {
            text: t('batchImport.select.clear'),
            cls: 'nw-btn nw-btn-ghost nw-btn-xs nw-bi-btn-danger-text'
        });
        clearBtn.addEventListener('click', () => {
            this.batchManager.clearPreviews();
            this.render();
        });

        const fileListContainer = container.createDiv({ cls: 'nw-bi-file-list' });

        if (previews.length === 0) {
            fileListContainer.createDiv({ cls: 'nw-bi-empty nw-bi-empty--sm' }).createSpan({ text: t('batchImport.select.empty') });
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
                nameRow.createSpan({
                    text: preview.filename,
                    cls: 'nw-bi-file-name'
                });
                const formatBadge = nameRow.createSpan({
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
                metaRow.createSpan({ text: t('batchImport.select.metaChapters', { count: preview.recognition.chapterCount }) });
                metaRow.createSpan({ text: t('batchImport.select.metaWords', { words: this.formatWordCount(preview.recognition.wordCount) }) });
                metaRow.createSpan({ text: `🎯 ${Math.round(preview.recognition.confidence * 100)}%` });

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

        container.createDiv({
            text: t('batchImport.preview.intro', { count: previews.length }),
            cls: 'nw-bi-intro'
        });

        if (previews.length === 0) {
            container.createDiv({ cls: 'nw-bi-empty' }).createSpan({ text: t('batchImport.preview.empty') });
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

            const confBadge = header.createSpan({
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

            this.addMetaItem(metaGrid, t('batchImport.preview.author'), preview.recognition.author || t('batchImport.preview.unknownAuthor'), true, (val) => {
                this.batchManager.updatePreview(preview.id, {
                    overrides: { ...preview.overrides, author: val }
                });
            });
            this.addMetaItem(metaGrid, t('batchImport.preview.wordCount'), this.formatWordCount(preview.recognition.wordCount));
            this.addMetaItem(metaGrid, t('batchImport.preview.chapterCount'), preview.recognition.chapterCount.toString());
            this.addMetaItem(metaGrid, t('batchImport.preview.format'), preview.recognition.format.toUpperCase());

            if (preview.recognition.chapters.length > 0) {
                const chapterPreview = card.createDiv({ cls: 'nw-bi-chapters' });
                chapterPreview.createDiv({
                    text: t('batchImport.preview.chapterPreview'),
                    cls: 'nw-bi-chapters-title'
                });
                preview.recognition.chapters.slice(0, 3).forEach(ch => {
                    const chRow = chapterPreview.createDiv({ cls: 'nw-bi-chapter-row' });
                    chRow.createSpan({ text: ch.title, cls: 'nw-bi-chapter-name' });
                    chRow.createSpan({ text: this.formatWordCount(ch.wordCount), cls: 'nw-bi-chapter-count' });
                });
                if (preview.recognition.chapters.length > 3) {
                    chapterPreview.createDiv({
                        text: t('batchImport.preview.moreChapters', { count: preview.recognition.chapters.length - 3 }),
                        cls: 'nw-bi-chapters-more'
                    });
                }
            }
        });
    }

    private addMetaItem(container: HTMLElement, label: string, value: string, editable?: boolean, onChange?: (val: string) => void): void {
        const item = container.createDiv({ cls: 'nw-bi-meta' });
        item.createDiv({ text: label, cls: 'nw-bi-meta-label' });
        if (editable && onChange) {
            const input = item.createEl('input', {
                type: 'text',
                value: value,
                cls: 'nw-bi-meta-input'
            });
            input.addEventListener('input', (e) => onChange((e.target as HTMLInputElement).value));
        } else {
            item.createDiv({ text: value, cls: 'nw-bi-meta-value' });
        }
    }

    private renderStep3(container: HTMLElement): void {
        container.createDiv({
            text: t('batchImport.setting.intro'),
            cls: 'nw-bi-intro nw-bi-intro--spaced'
        });

        const presetRow = container.createDiv({ cls: 'nw-bi-card nw-bi-card--spaced' });
        const presetHeader = presetRow.createDiv({ cls: 'nw-bi-list-header' });
        presetHeader.createSpan({ text: t('batchImport.setting.presets'), cls: 'nw-bi-list-title' });
        const toggleBtn = presetHeader.createEl('button', {
            text: this.showPresets ? t('batchImport.setting.collapse') : t('batchImport.setting.expand'),
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
                presetList.createSpan({ text: t('batchImport.setting.noPresets'), cls: 'nw-bi-hint' });
            } else {
                presets.forEach(preset => {
                    const presetEl = presetList.createSpan({
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
                placeholder: t('batchImport.setting.presetName'),
                value: this.presetNameInput,
                cls: 'nw-bi-input nw-bi-input--grow nw-bi-input--sm'
            });
            presetInput.addEventListener('input', (e) => {
                this.presetNameInput = (e.target as HTMLInputElement).value;
            });
            const savePresetBtn = savePresetRow.createEl('button', {
                text: t('batchImport.setting.savePreset'),
                cls: 'nw-btn nw-btn-secondary nw-btn-sm',
            });
            savePresetBtn.addEventListener('click', () => {
                this.saveCurrentAsPreset();
            });
        }

        const dimensionsSection = container.createDiv({ cls: 'nw-bi-section' });
        dimensionsSection.createDiv({
            text: t('batchImport.setting.dimensions'),
            cls: 'nw-bi-section-title'
        });
        const dimContainer = dimensionsSection.createDiv({ cls: 'nw-bi-dim-box' });
        DIMENSION_OPTIONS.forEach(dim => {
            const isSelected = this.selectedDimensions.includes(dim.key);
            const dimEl = dimContainer.createSpan({
                text: `${dim.icon} ${dimensionLabel(dim.key)}`,
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
        concurrencyItem.createDiv({ text: t('batchImport.setting.concurrency'), cls: 'nw-bi-field-label' });
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
        priorityItem.createDiv({ text: t('batchImport.setting.priority'), cls: 'nw-bi-field-label' });
        const prioritySelect = priorityItem.createEl('select', { cls: 'nw-bi-input nw-bi-input--block' });
        const priorityOptions = [
            { value: '2', label: t('batchImport.setting.priorityHigh') },
            { value: '1', label: t('batchImport.setting.priorityHigher') },
            { value: '0', label: t('batchImport.setting.priorityNormal') },
            { value: '-1', label: t('batchImport.setting.priorityLower') },
            { value: '-2', label: t('batchImport.setting.priorityLow') },
        ];
        priorityOptions.forEach(opt => {
            const option = prioritySelect.createEl('option', { value: opt.value, text: opt.label });
            if (parseInt(opt.value) === this.priority) option.selected = true;
        });
        prioritySelect.addEventListener('change', (e) => {
            this.priority = parseInt((e.target as HTMLSelectElement).value);
        });

        const togglesSection = container.createDiv({ cls: 'nw-bi-section' });
        togglesSection.createDiv({
            text: t('batchImport.setting.otherOptions'),
            cls: 'nw-bi-section-title'
        });

        const toggleList = togglesSection.createDiv({ cls: 'nw-bi-toggle-box' });

        const autoStartRow = toggleList.createDiv({ cls: 'nw-bi-toggle-row' });
        autoStartRow.createSpan({ text: t('batchImport.setting.autoStart'), cls: 'nw-bi-toggle-label' });
        const autoStartToggle = autoStartRow.createEl('input', {
            type: 'checkbox',
            cls: 'nw-bi-check'
        });
        autoStartToggle.checked = this.autoStartDeconstruction;
        autoStartToggle.addEventListener('change', (e) => {
            this.autoStartDeconstruction = (e.target as HTMLInputElement).checked;
        });

        const autoClassifyRow = toggleList.createDiv({ cls: 'nw-bi-toggle-row' });
        autoClassifyRow.createSpan({ text: t('batchImport.setting.autoClassify'), cls: 'nw-bi-toggle-label' });
        const autoClassifyToggle = autoClassifyRow.createEl('input', {
            type: 'checkbox',
            cls: 'nw-bi-check'
        });
        autoClassifyToggle.checked = this.autoClassify;
        autoClassifyToggle.addEventListener('change', (e) => {
            this.autoClassify = (e.target as HTMLInputElement).checked;
        });

        const tagsSection = container.createDiv({ cls: 'nw-bi-section nw-bi-section--tight' });
        tagsSection.createDiv({
            text: t('batchImport.setting.tags'),
            cls: 'nw-bi-section-title'
        });

        const themeCategoryRow = tagsSection.createDiv({ cls: 'nw-bi-cat-row' });
        THEME_CATEGORIES.forEach(cat => {
            const btn = themeCategoryRow.createEl('button', {
                text: themeCategoryLabel(cat),
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
            themeTagContainer.createSpan({ text: t('batchImport.setting.noThemeTags'), cls: 'nw-bi-hint' });
        } else {
            themeTags.forEach(tag => {
                const isSelected = this.selectedThemeTagIds.includes(tag.id);
                const tagEl = themeTagContainer.createSpan({
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
                text: techniqueCategoryLabel(cat),
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
            techniqueTagContainer.createSpan({ text: t('batchImport.setting.noTechniqueTags'), cls: 'nw-bi-hint' });
        } else {
            techniqueTags.forEach(tag => {
                const isSelected = this.selectedTechniqueTagIds.includes(tag.id);
                const tagEl = techniqueTagContainer.createSpan({
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
            placeholder: t('batchImport.setting.customTagPlaceholder'),
            value: this.customTagInput,
            cls: 'nw-bi-input nw-bi-input--grow nw-bi-input--sm'
        });
        customInput.addEventListener('input', (e) => {
            this.customTagInput = (e.target as HTMLInputElement).value;
        });
        const addCustomBtn = customInputRow.createEl('button', {
            text: t('batchImport.setting.add'),
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
            customTagsContainer.createSpan({ text: t('batchImport.setting.noCustomTags'), cls: 'nw-bi-hint' });
        } else {
            this.customTags.forEach(tag => {
                const tagEl = customTagsContainer.createSpan({
                    text: tag,
                    cls: 'nw-bi-tag nw-bi-tag--removable'
                });
                const removeBtn = tagEl.createSpan({
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

        container.createDiv({
            text: t('batchImport.progress.importing'),
            cls: 'nw-bi-intro nw-bi-intro--spaced'
        });

        this.totalProgressEl = container.createDiv({ cls: 'nw-bi-progress' });
        const totalHeader = this.totalProgressEl.createDiv({ cls: 'nw-bi-list-header' });
        totalHeader.createSpan({ text: t('batchImport.progress.total'), cls: 'nw-bi-list-title' });
        this.totalProgressTextEl = totalHeader.createSpan({
            text: `${progress.completedTasks}/${progress.totalTasks} (${progress.overallProgress}%)`,
            cls: 'nw-bi-hint'
        });
        const totalBarBg = this.totalProgressEl.createDiv({ cls: 'nw-bi-progress-bar' });
        this.totalProgressBarEl = totalBarBg.createDiv({ cls: 'nw-bi-progress-fill' });
        this.totalProgressBarEl.style.setProperty('--nw-bi-pct', `${progress.overallProgress}%`);

        const statsRow = container.createDiv({ cls: 'nw-bi-stats' });
        this.addStatCard(statsRow, t('batchImport.progress.statTotal'), progress.totalTasks.toString(), 'muted');
        this.addStatCard(statsRow, t('batchImport.progress.statActive'), progress.activeTasks.toString(), 'accent');
        this.addStatCard(statsRow, t('batchImport.progress.statDone'), progress.completedTasks.toString(), 'success');
        this.addStatCard(statsRow, t('batchImport.progress.statFailed'), progress.failedTasks.toString(), 'error');

        const taskListHeader = container.createDiv({ cls: 'nw-bi-list-header' });
        taskListHeader.createSpan({ text: t('batchImport.progress.taskList'), cls: 'nw-bi-list-title' });

        const actionBtns = taskListHeader.createDiv({ cls: 'nw-bi-list-actions' });
        const pauseAllBtn = actionBtns.createEl('button', {
            text: t('batchImport.progress.pauseAll'),
            cls: 'nw-btn nw-btn-ghost nw-btn-xs',
        });
        pauseAllBtn.addEventListener('click', () => {
            allTasks.filter(t => t.status === 'queued').forEach(t => this.batchManager.pauseTask(t.id));
        });
        const resumeAllBtn = actionBtns.createEl('button', {
            text: t('batchImport.progress.resumeAll'),
            cls: 'nw-btn nw-btn-ghost nw-btn-xs',
        });
        resumeAllBtn.addEventListener('click', () => {
            allTasks.filter(t => t.status === 'pending').forEach(t => this.batchManager.resumeTask(t.id));
        });

        this.taskListEl = container.createDiv({ cls: 'nw-bi-task-list' });

        this.updateTaskList();

        const logHeader = container.createDiv({ cls: 'nw-bi-log-header' });
        logHeader.createSpan({ text: t('batchImport.progress.logTitle') });
        const clearLogBtn = logHeader.createEl('button', {
            text: t('batchImport.progress.logClear'),
            cls: 'nw-btn nw-btn-ghost nw-btn-xs',
        });
        clearLogBtn.addEventListener('click', () => {
            if (this.logEl) this.logEl.empty();
        });

        this.logEl = container.createDiv({ cls: 'nw-bi-log' });

        this.appendLog(t('batchImport.progress.logStart', { count: progress.totalTasks }));
    }

    private addStatCard(
        container: HTMLElement,
        label: string,
        value: string,
        tone: 'muted' | 'accent' | 'success' | 'error'
    ): void {
        const card = container.createDiv({ cls: 'nw-bi-stat' });
        const valueEl = card.createDiv({ text: value, cls: 'nw-bi-stat-value' });
        valueEl.addClass(`nw-bi-stat-value--${tone}`);
        card.createDiv({ text: label, cls: 'nw-bi-stat-label' });
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
            setSanitizedHtml(this.taskListEl, `<div class="nw-bi-empty">${t('batchImport.progress.noTasks')}</div>`);
            return;
        }

        this.taskListEl.empty();
        tasks.forEach(task => {
            const row = this.taskListEl.createDiv({ cls: 'nw-bi-task' });

            const header = row.createDiv({ cls: 'nw-bi-task-head' });
            const titleWrap = header.createDiv({ cls: 'nw-bi-task-title-wrap' });

            const statusDot = titleWrap.createSpan({ cls: 'nw-bi-status-dot' });
            statusDot.addClass(`nw-bi-status-dot--${this.getStatusTone(task.status)}`);

            titleWrap.createSpan({
                text: task.bookName,
                cls: 'nw-bi-task-name'
            });

            const statusBadge = header.createSpan({
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
                row.createDiv({
                    text: task.error,
                    cls: 'nw-bi-task-error'
                });
            }

            const metaRow = row.createDiv({ cls: 'nw-bi-task-meta' });
            metaRow.createSpan({
                text: t('batchImport.progress.retry', { count: task.retryCount, max: task.maxRetries }),
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
        switch (status) {
            case 'queued': return t('batchImport.status.queued');
            case 'pending': return t('batchImport.status.pending');
            case 'processing': return t('batchImport.status.processing');
            case 'completed': return t('batchImport.status.completed');
            case 'failed': return t('batchImport.status.failed');
            case 'cancelled': return t('batchImport.status.cancelled');
            default: return status;
        }
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
            text: t('batchImport.result.tabRecent'),
            cls: 'nw-bi-tab'
        });
        recentTab.addClass(this.historyTab === 'recent' ? 'nw-bi-tab--active' : 'nw-bi-tab--idle');
        recentTab.addEventListener('click', () => {
            this.historyTab = 'recent';
            this.render();
        });

        const allTab = tabs.createEl('button', {
            text: t('batchImport.result.tabHistory'),
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
            container.createDiv({ cls: 'nw-bi-empty' }).createSpan({ text: t('batchImport.result.emptyRecent') });
            return;
        }

        const statsRow = container.createDiv({ cls: 'nw-bi-result-grid' });

        const successCard = statsRow.createDiv({
            cls: 'nw-bi-result-card nw-bi-result-card--success'
        });
        successCard.createDiv({
            text: progress.completedTasks.toString(),
            cls: 'nw-bi-result-number nw-bi-result-number--success'
        });
        successCard.createDiv({ text: t('batchImport.result.statSuccess'), cls: 'nw-bi-hint' });

        const failedCard = statsRow.createDiv({
            cls: 'nw-bi-result-card nw-bi-result-card--failed'
        });
        failedCard.createDiv({
            text: progress.failedTasks.toString(),
            cls: 'nw-bi-result-number nw-bi-result-number--error'
        });
        failedCard.createDiv({ text: t('batchImport.result.statFailed'), cls: 'nw-bi-hint' });

        const totalCard = statsRow.createDiv({ cls: 'nw-bi-result-card nw-bi-result-card--total' });
        totalCard.createDiv({
            text: progress.totalTasks.toString(),
            cls: 'nw-bi-result-number nw-bi-result-number--muted'
        });
        totalCard.createDiv({ text: t('batchImport.result.statTotal'), cls: 'nw-bi-hint' });

        const successTasks = tasks.filter(t => t.status === 'completed');
        if (successTasks.length > 0) {
            const successSection = container.createDiv({ cls: 'nw-bi-section' });
            successSection.createDiv({
                text: t('batchImport.result.successList'),
                cls: 'nw-bi-section-title'
            });
            const successList = successSection.createDiv({ cls: 'nw-bi-success-list' });
            successTasks.forEach(task => {
                const row = successList.createDiv({ cls: 'nw-bi-success-row' });
                row.createSpan({ text: `✅ ${task.bookName}`, cls: 'nw-bi-success-name' });
                const detailBtn = row.createEl('button', {
                    text: t('batchImport.result.viewDetail'),
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
            failedSection.createDiv({
                text: t('batchImport.result.failedList'),
                cls: 'nw-bi-section-title'
            });
            const failedList = failedSection.createDiv({ cls: 'nw-bi-failed-list' });
            failedTasks.forEach(task => {
                const row = failedList.createDiv({ cls: 'nw-bi-failed-row' });
                row.createDiv({
                    text: `❌ ${task.bookName}`,
                    cls: 'nw-bi-failed-name'
                });
                row.createDiv({
                    text: task.error || t('batchImport.result.unknownError'),
                    cls: 'nw-bi-failed-error'
                });
                const retryBtn = row.createEl('button', {
                    text: t('batchImport.result.reimport'),
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
            container.createDiv({ cls: 'nw-bi-empty' }).createSpan({ text: t('batchImport.result.emptyHistory') });
            return;
        }

        const listContainer = container.createDiv({ cls: 'nw-bi-history-list' });

        history.forEach(item => {
            const card = listContainer.createDiv({ cls: 'nw-bi-history' });
            if (this.selectedHistoryId === item.id) card.addClass('nw-bi-history--selected');

            const header = card.createDiv({ cls: 'nw-bi-history-head' });
            header.createSpan({
                text: this.formatDateTime(item.importTime),
                cls: 'nw-bi-history-time'
            });
            const statsWrap = header.createDiv({ cls: 'nw-bi-history-stats' });
            statsWrap.createSpan({
                text: `✅ ${item.successCount}`,
                cls: 'nw-bi-ok-count'
            });
            statsWrap.createSpan({
                text: `❌ ${item.failedCount}`,
                cls: 'nw-bi-fail-count'
            });

            const metaRow = card.createDiv({ cls: 'nw-bi-history-meta' });
            metaRow.createSpan({ text: t('batchImport.result.historyTotal', { count: item.totalCount }) });
            metaRow.createSpan({
                text: t('batchImport.result.historyDimensions', { count: item.settings.dimensions.length })
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
                    bookRow.createSpan({ text: `${statusIcon} ${book.bookName}` });
                    if (book.status === 'failed') {
                        bookRow.createSpan({
                            text: book.error || t('batchImport.status.failed'),
                            cls: 'nw-bi-book-error'
                        });
                    }
                });

                const btnRow = detail.createDiv({ cls: 'nw-bi-history-actions' });
                if (item.failedCount > 0) {
                    const retryBtn = btnRow.createEl('button', {
                        text: t('batchImport.result.retryFailed'),
                        cls: 'nw-btn nw-btn-secondary nw-btn-sm',
                    });
                    retryBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        // DSH-20261113-25 ③：tasks 只存本会话任务——重启/换批后对应
                        // 任务已不存在，不得静默空转让用户白等。
                        const { retried, missing } = this.batchManager.retryFailedFromHistory(item.id);
                        if (retried === 0 && missing.length > 0) {
                            showWarningNotice(t('batchImport.result.expired'), { timeout: 5000 });
                            return;
                        }
                        if (missing.length > 0) {
                            showWarningNotice(t('batchImport.result.partialRetry', { retried, missing: missing.length }), { timeout: 5000 });
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
                text: t('batchImport.footer.cancel'),
                cls: 'nw-btn nw-btn-secondary',
            }).addEventListener('click', () => this.close());

            const nextBtn = rightBtns.createEl('button', {
                text: t('batchImport.footer.next'),
                cls: 'nw-btn nw-btn-primary',
            });
            nextBtn.addEventListener('click', () => this.goToStep(2));

        } else if (this.currentStep === 2) {
            leftBtns.createEl('button', {
                text: t('batchImport.footer.prev'),
                cls: 'nw-btn nw-btn-secondary',
            }).addEventListener('click', () => this.goToStep(1));

            rightBtns.createEl('button', {
                text: t('batchImport.footer.cancel'),
                cls: 'nw-btn nw-btn-secondary',
            }).addEventListener('click', () => this.close());

            const nextBtn = rightBtns.createEl('button', {
                text: t('batchImport.footer.next'),
                cls: 'nw-btn nw-btn-primary',
            });
            nextBtn.addEventListener('click', () => this.goToStep(3));

        } else if (this.currentStep === 3) {
            leftBtns.createEl('button', {
                text: t('batchImport.footer.prev'),
                cls: 'nw-btn nw-btn-secondary',
            }).addEventListener('click', () => this.goToStep(2));

            rightBtns.createEl('button', {
                text: t('batchImport.footer.cancel'),
                cls: 'nw-btn nw-btn-secondary',
            }).addEventListener('click', () => this.close());

            const startBtn = rightBtns.createEl('button', {
                text: t('batchImport.footer.start'),
                cls: 'nw-btn nw-btn-primary',
            });
            startBtn.addEventListener('click', () => this.startImport());

        } else if (this.currentStep === 4) {
            const cancelBtn = rightBtns.createEl('button', {
                text: t('batchImport.footer.cancelAll'),
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
                text: t('batchImport.footer.viewResults'),
                cls: 'nw-btn nw-btn-primary',
            });
            doneBtn.addEventListener('click', () => {
                this.currentStep = 5;
                this.historyTab = 'recent';
                this.render();
            });

        } else if (this.currentStep === 5) {
            const continueBtn = leftBtns.createEl('button', {
                text: t('batchImport.footer.continueImport'),
                cls: 'nw-btn nw-btn-secondary',
            });
            continueBtn.addEventListener('click', () => {
                this.currentStep = 1;
                this.batchManager.clearPreviews();
                this.render();
            });

            const doneBtn = rightBtns.createEl('button', {
                text: t('batchImport.footer.done'),
                cls: 'nw-btn nw-btn-primary',
            });
            doneBtn.addEventListener('click', () => { void (async () => {
                this.completionReported = true;
                await this.reportCompletion();
                this.close();
            })(); });
        }
    }

    private goToStep(step: ImportStep): void {
        if (step === 2) {
            const selected = this.batchManager.getSelectedPreviews();
            if (selected.length === 0) {
                new Notice(t('batchImport.notice.needFile'));
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
                showWarningNotice(t('batchImport.notice.tooLarge', { name: file.name, size: Math.round(file.size / 1024 / 1024) }));
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
                        showWarningNotice(t('batchImport.notice.epubSkipped'));
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
                showSuccessNotice(t('batchImport.notice.added', { count: addedCount }));
            }
        });
    }

    private showVaultFilePicker(): void {
        const allFiles = this.app.vault.getFiles().filter(f =>
            f.extension.toLowerCase() === 'txt' || f.extension.toLowerCase() === 'md'
        );

        if (allFiles.length === 0) {
            new Notice(t('batchImport.notice.vaultNoFiles'));
            return;
        }

        const pickerModal = new Modal(this.app);
        pickerModal.modalEl.addClass('nw-scope');
        pickerModal.modalEl.addClass('nw-modal-sm');
        pickerModal.titleEl.setText(t('batchImport.picker.fileTitle'));

        const content = pickerModal.contentEl;
        content.addClass('nw-bi-picker-body');

        const searchInput = content.createEl('input', {
            type: 'text',
            placeholder: t('batchImport.picker.searchFiles'),
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
                    text: t('batchImport.picker.noMatchFiles'),
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

                row.createSpan({
                    text: `📄 ${file.name}`,
                    cls: 'nw-bi-picker-name'
                });
                row.createSpan({
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
            text: t('common.cancel'),
            cls: 'nw-btn nw-btn-secondary',
        });
        cancelBtn.addEventListener('click', () => pickerModal.close());

        const confirmBtn = btnRow.createEl('button', {
            text: t('batchImport.picker.confirmAdd'),
            cls: 'nw-btn nw-btn-primary',
        });
        confirmBtn.addEventListener('click', () => { void (async () => {
            if (selectedPaths.size === 0) {
                new Notice(t('batchImport.notice.needSelectFile'));
                return;
            }

            let addedCount = 0;
            for (const path of selectedPaths) {
                const abstractFile = this.app.vault.getAbstractFileByPath(path);
                if (abstractFile instanceof TFile) {
                    try {
                        const content = await this.app.vault.cachedRead(abstractFile);
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
                showSuccessNotice(t('batchImport.notice.added', { count: addedCount }));
            }
        })(); });

        pickerModal.open();
    }

    private getFilesInFolder(folder: TFolder): TFile[] {
        const result: TFile[] = [];
        const validExtensions = ['txt', 'md'];

        for (const child of folder.children) {
            if (child instanceof TFolder) {
                result.push(...this.getFilesInFolder(child));
            } else if (child instanceof TFile && validExtensions.includes(child.extension.toLowerCase())) {
                result.push(child);
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
            new Notice(t('batchImport.notice.vaultNoFolderFiles'));
            return;
        }

        const pickerModal = new Modal(this.app);
        pickerModal.modalEl.addClass('nw-scope');
        pickerModal.modalEl.addClass('nw-modal-sm');
        pickerModal.titleEl.setText(t('batchImport.picker.folderTitle'));

        const content = pickerModal.contentEl;
        content.addClass('nw-bi-picker-body');

        const searchInput = content.createEl('input', {
            type: 'text',
            placeholder: t('batchImport.picker.searchFolders'),
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
                    text: t('batchImport.picker.noMatchFolders'),
                    cls: 'nw-bi-picker-empty'
                });
                return;
            }

            filtered.forEach(item => {
                const row = folderList.createDiv({
                    cls: 'nw-bi-picker-row'
                });

                row.toggleClass('nw-bi-picker-row--selected', selectedFolderPath === item.folder.path);

                row.createSpan({ text: '📁', cls: 'nw-bi-picker-icon' });
                row.createSpan({
                    text: item.folder.path || t('batchImport.picker.root'),
                    cls: 'nw-bi-picker-name'
                });
                row.createSpan({
                    text: t('batchImport.picker.fileCount', { count: item.fileCount }),
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
            text: t('common.cancel'),
            cls: 'nw-btn nw-btn-secondary',
        });
        cancelBtn.addEventListener('click', () => pickerModal.close());

        const confirmBtn = btnRow.createEl('button', {
            text: t('batchImport.picker.confirmImport'),
            cls: 'nw-btn nw-btn-primary',
        });
        confirmBtn.addEventListener('click', () => { void (async () => {
            if (!selectedFolderPath) {
                new Notice(t('batchImport.notice.needSelectFolder'));
                return;
            }

            const abstractFile = this.app.vault.getAbstractFileByPath(selectedFolderPath);
            if (!abstractFile || !(abstractFile instanceof TFolder)) {
                showErrorNotice(t('batchImport.picker.folderMissing'));
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
                showSuccessNotice(t('batchImport.notice.addedFromFolder', { count: addedCount }));
            } else {
                new Notice(t('batchImport.notice.noNewFiles'));
            }
        })(); });

        pickerModal.open();
    }

    private addCustomTag(): void {
        const tag = this.customTagInput.trim();
        if (!tag) return;
        if (this.customTags.includes(tag)) {
            new Notice(t('batchImport.notice.tagExists'));
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
        showSuccessNotice(t('batchImport.notice.presetApplied', { name: preset.name }));
        this.render();
    }

    private saveCurrentAsPreset(): void {
        const name = this.presetNameInput.trim();
        if (!name) {
            new Notice(t('batchImport.notice.needPresetName'));
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
        showSuccessNotice(t('batchImport.notice.presetSaved', { name }));
        this.render();
    }

    private startImport(): void {
        const selected = this.batchManager.getSelectedPreviews();
        if (selected.length === 0) {
            new Notice(t('batchImport.notice.noneSelected'));
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
        const logLine = this.logEl.createDiv({
            text: `[${new Date().toLocaleTimeString()}] ${message}`,
            cls: 'nw-bi-log-line'
        });
        this.logEl.scrollTop = this.logEl.scrollHeight;
        void logLine;
    }

    private formatWordCount(count?: number): string {
        if (!count) return '0';
        // 英文按 1k / 1M 记，中文按 1 万记：4 位数以上才压缩
        if (getLocale() === 'en-US') {
            const trim = (value: number): string => {
                const text = value.toFixed(1);
                // 只有三位数以上才去掉末尾的 .0（532.0k → 532k），
                // 小数值保留一位小数，免得 2.98k 显示成 3k 与邻近条目不一致
                return value >= 100 && text.endsWith('.0') ? text.slice(0, -2) : text;
            };
            if (count >= 1_000_000) {
                return t('batchImport.wordCount.million', { n: trim(count / 1_000_000) });
            }
            if (count >= 1_000) {
                return t('batchImport.wordCount.wan', { n: trim(count / 1_000) });
            }
        } else if (count >= 10_000) {
            return t('batchImport.wordCount.wan', { n: (count / 10_000).toFixed(1) });
        }
        return t('batchImport.wordCount.chars', { n: count.toLocaleString() });
    }

    private formatDateTime(timestamp: number): string {
        const date = new Date(timestamp);
        const pad = (n: number) => n.toString().padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }
}
