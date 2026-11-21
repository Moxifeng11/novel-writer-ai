import { Modal, App, Notice, Setting, TFile } from 'obsidian';
import { KnowledgeBaseManager, MAX_SOURCE_FILE_SIZE, type BookBasicInfo } from '@/services/knowledge-base-manager';
import { filterBookFiles, formatSourceFileSizeMb, isSourceFileTooLarge, resolveBookNameFromFile } from './kb-import-file-logic';
import { WebnovelKnowledgeBase, type GenreConfig, type SubGenreConfig, type TechniqueDef } from '@/shared/webnovel-knowledge-base';
import { kbBookDir, kbBookSourceFile } from '@/shared/paths';
import { createLogger } from '@/shared/logger';
import { OperationConfirmModal } from '@/ui/components/progress';
import { showErrorNotice, showSuccessNotice } from '@/ui/components/notice-helpers';
import { isImeComposing } from '@/shared/keyboard';
import { t } from '@/i18n';
import { ModalDirtyGuard } from '@/ui/components/modal-dirty-guard';
import { detectGenreChanges, isValidBookName } from './kb-modals-logic';

const log = createLogger('KnowledgeBaseModals');

/** 分类渠道下拉值；与 BookBasicInfo.genreChannel 共用同一联合类型，避免两处口径漂移 */
type GenreChannelKey = NonNullable<BookBasicInfo['genreChannel']>;

/** 桌面端 FileSystemAdapter 的目录能力；移动端 adapter 无 mkdir，沿用原运行时行为 */
type MkdirCapableAdapter = {
    mkdir(path: string): Promise<void>;
    write(path: string, data: string): Promise<void>;
};

/**
 * 写作技巧的分类选项；下拉框与只读标签共用一份键表，避免两处译名漂移。
 */
function techniqueCategories(): Array<{ value: TechniqueDef['category']; label: string }> {
    return [
        { value: 'structure', label: t('knowledgebase.modal.genre.cat.structure') },
        { value: 'cool_point', label: t('knowledgebase.modal.genre.cat.coolPoint') },
        { value: 'emotion', label: t('knowledgebase.modal.genre.cat.emotion') },
        { value: 'rhythm', label: t('knowledgebase.modal.genre.cat.rhythm') },
        { value: 'genre', label: t('knowledgebase.modal.genre.cat.genre') },
        { value: 'style', label: t('knowledgebase.modal.genre.cat.style') },
        { value: 'foreshadow', label: t('knowledgebase.modal.genre.cat.foreshadow') },
    ];
}

/**
 * 导入书籍弹窗。
 */
export class ImportBookModal extends Modal {
    private kbManager: KnowledgeBaseManager | null;
    private onImported: (book: BookBasicInfo) => void;
    private nameValue: string = '';
    private authorValue: string = '';
    private sourcePath: string = '';
    private step: 'select' | 'form' = 'select';
    /** 导入进行中：确认按钮不禁用的话，双击会建出「书名 (2)」 */
    private importInFlight = false;

    constructor(app: App, kbManager: KnowledgeBaseManager | null, onImported: (book: BookBasicInfo) => void) {
        super(app);
        this.kbManager = kbManager;
        this.onImported = onImported;
    }

    /**
     * 打开弹窗并渲染。
     */
    onOpen(): void {
        this.modalEl.addClass('nw-scope');
        this.modalEl.addClass('nw-modal');
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl('h3', { text: t('knowledgebase.modal.import.title'), cls: 'nw-modal-title' });

        if (this.step === 'select') {
            this.renderSelectStep();
        } else {
            this.renderFormStep();
        }
    }

    private render(): void {
        this.onOpen();
    }

    private renderSelectStep(): void {
        const { contentEl } = this;

        const options = [
            { icon: '📂', label: t('knowledgebase.modal.import.vaultOption'), desc: t('knowledgebase.modal.import.vaultOptionDesc'), action: () => this.selectFromVault() },
            { icon: '📄', label: t('knowledgebase.modal.import.fileOption'), desc: t('knowledgebase.modal.import.fileOptionDesc'), action: () => this.importFromFile() },
            { icon: '✏️', label: t('knowledgebase.modal.import.manualOption'), desc: t('knowledgebase.modal.import.manualOptionDesc'), action: () => { this.step = 'form'; this.render(); } },
        ];

        options.forEach(opt => {
            const card = contentEl.createDiv({ cls: 'nw-kb-modal-choice' });

            card.createSpan({ text: opt.icon, cls: 'nw-kb-modal-choice-icon' });
            const info = card.createDiv({ cls: 'nw-kb-modal-choice-body' });
            info.createDiv({ text: opt.label, cls: 'nw-kb-modal-choice-label' });
            info.createDiv({ text: opt.desc, cls: 'nw-kb-modal-choice-desc' });
            card.createSpan({ text: '→', cls: 'nw-kb-modal-choice-arrow' });

            card.addEventListener('click', opt.action);
        });
    }

    private async selectFromVault(): Promise<void> {
        try {
            const files = this.app.vault.getFiles().filter(f =>
                f.extension === 'txt' || f.extension === 'md'
            );

            if (files.length === 0) {
                new Notice(t('knowledgebase.modal.import.noFiles'));
                return;
            }

            const modal = new (class extends Modal {
                private files: TFile[];
                private onSelect: (file: TFile) => void;

                constructor(app: App, files: TFile[], onSelect: (file: TFile) => void) {
                    super(app);
                    this.files = files;
                    this.onSelect = onSelect;
                }

                onOpen() {
                    this.modalEl.addClass('nw-scope');
                    this.modalEl.addClass('nw-modal-sm');
                    const { contentEl } = this;
                    contentEl.empty();
                    // 文件选择是窄弹窗（nw-modal-sm），标题保持浏览器默认间距，不加 nw-modal-title(0 margin)
                    contentEl.createEl('h3', { text: t('knowledgebase.modal.import.selectTitle') });

                    const searchInput = contentEl.createEl('input', {
                        type: 'text',
                        cls: 'nw-kb-modal-search',
                        attr: { placeholder: t('knowledgebase.modal.import.searchPlaceholder') }
                    });

                    const list = contentEl.createDiv({ cls: 'nw-kb-modal-file-list' });

                    const renderList = (filter: string) => {
                        list.empty();
                        const filtered = filterBookFiles(this.files, filter);
                        filtered.forEach(file => {
                            const item = list.createDiv({ cls: 'nw-kb-modal-file-item' });
                            item.createSpan({ text: '📄 ' + file.name });
                            item.addEventListener('click', () => {
                                this.onSelect(file);
                                this.close();
                            });
                        });
                    };

                    renderList('');
                    searchInput.addEventListener('input', () => {
                        renderList(searchInput.value);
                    });
                }
            })(this.app, files, async (file: TFile) => {
                const content = await this.app.vault.read(file);
                await this.importBook(file.basename, '', file.path, content);
            });
            modal.open();
        } catch (e) {
            showErrorNotice(t('knowledgebase.modal.import.selectFailed'));
        }
    }

    private importFromFile(): void {
        const input = createEl('input', {
            attr: { type: 'file', accept: '.txt,.md', style: 'display:none;' }
        });
        input.addEventListener('change', async (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) return;
            if (isSourceFileTooLarge(file.size, MAX_SOURCE_FILE_SIZE)) {
                // SEC-7：读前硬限（file.text() 是全量读，兜底截断为时已晚）
                showErrorNotice(t('knowledgebase.modal.import.tooLarge', { name: file.name, size: formatSourceFileSizeMb(file.size) }));
                return;
            }
            try {
                const text = await file.text();
                const name = resolveBookNameFromFile(file.name);
                await this.importBook(name, '', file.name, text);
            } catch (err) {
                showErrorNotice(t('knowledgebase.modal.import.readFailed'));
            }
        });
        document.body.appendChild(input);
        input.click();
        document.body.removeChild(input);
    }

    private renderFormStep(): void {
        const { contentEl } = this;

        new Setting(contentEl)
            .setName(t('knowledgebase.modal.import.nameLabel'))
            .addText(txt => txt
                .setPlaceholder(t('knowledgebase.modal.import.namePlaceholder'))
                .setValue(this.nameValue)
                .onChange(v => this.nameValue = v));

        new Setting(contentEl)
            .setName(t('knowledgebase.modal.import.authorLabel'))
            .addText(txt => txt
                .setPlaceholder(t('knowledgebase.modal.import.authorPlaceholder'))
                .setValue(this.authorValue)
                .onChange(v => this.authorValue = v));

        const actions = contentEl.createDiv({ cls: 'nw-kb-modal-actions' });

        const backBtn = actions.createEl('button', {
            text: t('knowledgebase.modal.import.back'),
            cls: 'nw-btn nw-btn-secondary'
        });
        backBtn.addEventListener('click', () => {
            this.step = 'select';
            this.render();
        });

        const confirmBtn = actions.createEl('button', {
            text: t('knowledgebase.modal.import.confirm'),
            cls: 'nw-btn nw-btn-primary'
        });
        confirmBtn.addEventListener('click', () => {
            if (!this.nameValue.trim()) {
                new Notice(t('knowledgebase.modal.import.needName'));
                return;
            }
            this.importBook(this.nameValue.trim(), this.authorValue.trim(), '', '');
        });
    }

    private async importBook(name: string, author: string, sourcePath: string, content: string): Promise<void> {
        if (!this.kbManager) {
            new Notice(t('knowledgebase.modal.import.notReady'));
            return;
        }
        // addBook 在第一个 await 之前就同步写入内存表，重复点击会生成同名副本
        if (this.importInFlight) return;
        this.importInFlight = true;

        try {
            const wordCount = content.length;
            const book = await this.kbManager.addBook({
                name,
                author,
                wordCount,
                themeTags: [],
                techniqueTags: [],
                customTags: [],
                synopsis: '',
                sourcePath,
            });

            if (content) {
                const fs = this.app.vault.adapter as unknown as MkdirCapableAdapter;
                const baseDir = this.kbManager.getBaseDir();
                // 必须用 book.name：addBook 遇到同名会自动加「(2)」后缀，
                // 沿用入参 name 会把源文本写进另一个目录，
                // 之后 getSourceText 按 book.name 拼路径 → 永远「源文本文件不存在」。
                const bookDir = kbBookDir(book.name, baseDir);
                await fs.mkdir(bookDir).catch(() => { });
                await fs.write(kbBookSourceFile(book.name, baseDir), content);
            }

            try {
                await this.kbManager.classifyBook(book.id);
            } catch (e) {
                log.warn('自动分类失败，继续导入:', e);
            }

            this.onImported(book);
            this.close();
        } catch (e) {
            log.error('导入失败:', e);
            showErrorNotice(e instanceof Error ? e.message : String(e), { title: t('knowledgebase.modal.import.failedTitle') });
        } finally {
            this.importInFlight = false;
        }
    }

    /**
     * 关闭弹窗并清空。
     */
    onClose(): void {
        this.contentEl.empty();
    }
}

/**
 * 编辑书籍弹窗。
 */
export class EditBookModal extends Modal {
    private book: BookBasicInfo;
    private kbManager: KnowledgeBaseManager | null;
    private kb: WebnovelKnowledgeBase | null;
    private onSaved: (book: BookBasicInfo) => void;

    private nameValue: string;
    private authorValue: string;
    private synopsisValue: string;
    private channelValue: GenreChannelKey | '';
    private genreValue: string;
    private subGenreValue: string;
    private customTagsList: string[];
    private customTagsInputValue: string = '';
    /** 误触 Esc / 点外部时确认未保存的编辑（审计 A-5 / C#3） */
    private dirtyGuard = new ModalDirtyGuard();

    constructor(
        app: App,
        book: BookBasicInfo,
        kbManager: KnowledgeBaseManager | null,
        kb: WebnovelKnowledgeBase | null,
        onSaved: (book: BookBasicInfo) => void
    ) {
        super(app);
        this.book = book;
        this.kbManager = kbManager;
        this.kb = kb;
        this.onSaved = onSaved;
        this.nameValue = book.name;
        this.authorValue = book.author || '';
        this.synopsisValue = book.synopsis || '';
        this.channelValue = book.genreChannel || '';
        this.genreValue = book.primaryGenre || '';
        this.subGenreValue = book.primarySubGenre || '';
        this.customTagsList = [...book.customTags];
    }

    /**
     * 打开弹窗并渲染。
     */
    onOpen(): void {
        this.modalEl.addClass('nw-scope');
        this.modalEl.addClass('nw-modal');
        this.dirtyGuard.attach(this, this.app);
        this.contentEl.addEventListener('input', () => this.dirtyGuard.markDirty());
        this.contentEl.addEventListener('change', () => this.dirtyGuard.markDirty());
        this.renderContent();
    }

    private render(): void {
        this.renderContent();
    }

    private renderContent(): void {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl('h3', { text: t('knowledgebase.modal.edit.title'), cls: 'nw-modal-title' });

        new Setting(contentEl)
            .setName(t('knowledgebase.modal.edit.nameLabel'))
            .addText(txt => txt
                .setValue(this.nameValue)
                .onChange(v => this.nameValue = v));

        new Setting(contentEl)
            .setName(t('knowledgebase.modal.edit.authorLabel'))
            .addText(txt => txt
                .setValue(this.authorValue)
                .onChange(v => this.authorValue = v));

        new Setting(contentEl)
            .setName(t('knowledgebase.modal.edit.synopsisLabel'))
            .addTextArea(txt => txt
                .setValue(this.synopsisValue)
                .onChange(v => this.synopsisValue = v)
                .inputEl.rows = 4);

        contentEl.createEl('h4', { text: t('knowledgebase.modal.edit.genreSection'), cls: 'nw-kb-modal-section-title nw-kb-modal-section-title--spaced' });

        const channelSetting = new Setting(contentEl)
            .setName(t('knowledgebase.modal.edit.channelLabel'))
            .addDropdown(d => {
                d.addOption('', t('knowledgebase.modal.edit.choosePlaceholder'));
                d.addOption('male', t('knowledgebase.format.channel.male'));
                d.addOption('female', t('knowledgebase.format.channel.female'));
                d.addOption('neutral', t('knowledgebase.format.channel.neutral'));
                d.setValue(this.channelValue);
                d.onChange(v => {
                    this.channelValue = v as GenreChannelKey | '';
                    this.genreValue = '';
                    this.subGenreValue = '';
                    this.render();
                });
            });
        void channelSetting;

        const genreSetting = new Setting(contentEl)
            .setName(t('knowledgebase.modal.edit.majorLabel'))
            .addDropdown(d => {
                d.addOption('', t('knowledgebase.modal.edit.choosePlaceholder'));
                if (this.kb && this.channelValue) {
                    this.kb.getGenresByCategory(this.channelValue).forEach(g => {
                        d.addOption(g.id, g.name);
                    });
                } else if (this.kb) {
                    this.kb.getAllGenres().forEach(g => {
                        d.addOption(g.id, g.name);
                    });
                }
                d.setValue(this.genreValue);
                d.onChange(v => {
                    this.genreValue = v;
                    this.subGenreValue = '';
                    this.render();
                });
            });
        void genreSetting;

        if (this.genreValue && this.kb) {
            const genre = this.kb.getGenre(this.genreValue);
            if (genre?.subGenres && genre.subGenres.length > 0) {
                const subSetting = new Setting(contentEl)
                    .setName(t('knowledgebase.modal.edit.subLabel'))
                    .addDropdown(d => {
                        d.addOption('', t('knowledgebase.modal.edit.choosePlaceholder'));
                        genre.subGenres!.forEach(s => {
                            d.addOption(s.id, s.name);
                        });
                        d.setValue(this.subGenreValue);
                        d.onChange(v => {
                            this.subGenreValue = v;
                        });
                    });
                void subSetting;
            }
        }

        contentEl.createEl('h4', { text: t('knowledgebase.modal.edit.tagsSection'), cls: 'nw-kb-modal-section-title nw-kb-modal-section-title--spaced' });

        const tagsContainer = contentEl.createDiv({ cls: 'nw-kb-modal-tag-list' });
        this.renderCustomTags(tagsContainer);

        const addTagContainer = contentEl.createDiv({ cls: 'nw-kb-modal-inline-row nw-kb-modal-inline-row--mb' });
        const tagInput = addTagContainer.createEl('input', {
            type: 'text',
            cls: 'nw-kb-modal-input nw-kb-modal-input--md nw-kb-modal-input--flex',
            attr: { placeholder: t('knowledgebase.modal.edit.tagPlaceholder') }
        });
        const addTagBtn = addTagContainer.createEl('button', {
            text: t('knowledgebase.modal.edit.add'),
            cls: 'nw-btn nw-btn-primary nw-btn-sm'
        });
        const addTagHandler = () => {
            const tag = tagInput.value.trim();
            if (tag && !this.customTagsList.includes(tag)) {
                this.customTagsList.push(tag);
                tagInput.value = '';
                this.renderCustomTags(tagsContainer);
            }
        };
        addTagBtn.addEventListener('click', addTagHandler);
        tagInput.addEventListener('keydown', (e) => {
            if (isImeComposing(e)) return;
            if (e.key === 'Enter') addTagHandler();
        });

        const actions = contentEl.createDiv({ cls: 'nw-kb-modal-actions' });

        const cancelBtn = actions.createEl('button', {
            text: t('knowledgebase.common.cancel'),
            cls: 'nw-btn nw-btn-secondary'
        });
        cancelBtn.addEventListener('click', () => {
            this.dirtyGuard.markClean();
            this.close();
        });

        const saveBtn = actions.createEl('button', {
            text: t('knowledgebase.modal.edit.save'),
            cls: 'nw-btn nw-btn-primary'
        });
        saveBtn.addEventListener('click', () => this.save());
    }

    private renderCustomTags(container: HTMLElement): void {
        container.empty();
        if (this.customTagsList.length === 0) {
            container.createSpan({ text: t('knowledgebase.modal.edit.noTags'), cls: 'nw-kb-modal-tag-empty' });
            return;
        }
        this.customTagsList.forEach((tag, idx) => {
            const tagEl = container.createSpan({ cls: 'nw-kb-modal-tag' });
            tagEl.createSpan({ text: tag });
            const delBtn = tagEl.createSpan({ text: '×', cls: 'nw-kb-modal-tag-close' });
            delBtn.addEventListener('click', () => {
                this.customTagsList.splice(idx, 1);
                this.renderCustomTags(container);
            });
        });
    }

    private save(): void {
        if (!this.kbManager || !isValidBookName(this.nameValue)) {
            new Notice(t('knowledgebase.modal.edit.needName'));
            return;
        }

        // 分类变更检测抽到 kb-modals-logic（undefined 与 '' 的等价性易错）
        const changes = detectGenreChanges(
            {
                genreChannel: this.book.genreChannel,
                primaryGenre: this.book.primaryGenre,
                primarySubGenre: this.book.primarySubGenre,
            },
            {
                genreChannel: this.channelValue,
                primaryGenre: this.genreValue,
                primarySubGenre: this.subGenreValue,
            },
        );

        this.kbManager.updateBook(this.book.id, {
            name: this.nameValue.trim(),
            author: this.authorValue.trim(),
            synopsis: this.synopsisValue.trim(),
            genreChannel: this.channelValue || undefined,
            primaryGenre: this.genreValue || undefined,
            primarySubGenre: this.subGenreValue || undefined,
            customTags: this.customTagsList,
        }).then(async () => {
            if (changes.anyChanged) {
                try {
                    await this.kbManager!.recordGenreCorrection(this.book.id, {
                        channel: this.channelValue || undefined,
                        primaryGenre: this.genreValue || undefined,
                        primarySubGenre: this.subGenreValue || undefined,
                    });
                } catch (e) {
                    log.warn('记录分类偏好失败:', e);
                }
            }
            const updated = await this.kbManager!.getBook(this.book.id);
            if (updated) {
                this.onSaved(updated);
            }
            this.dirtyGuard.markClean();
            this.close();
            showSuccessNotice(t('knowledgebase.modal.edit.saveSuccess'));
        }).catch((e: unknown) => {
            log.error('[KnowledgeBaseModals] 书籍保存失败:', e);
            showErrorNotice(e instanceof Error ? e.message : String(e), { title: t('knowledgebase.modal.edit.saveFailedTitle'), timeout: 8000 });
        });
    }

    /**
     * 关闭弹窗并清空。
     */
    onClose(): void {
        this.contentEl.empty();
    }
}

/**
 * 题材编辑弹窗。
 */
export class GenreEditModal extends Modal {
    private mode: 'create' | 'edit' | 'view';
    private genre: GenreConfig;
    private onSave?: (genre: GenreConfig) => void;
    private onDelete?: (id: string) => void;

    private tempGenre: GenreConfig;
    private newTagInput: HTMLInputElement | null = null;
    /** 误触 Esc / 点外部时确认未保存的编辑（审计 A-5 / C#3） */
    private dirtyGuard = new ModalDirtyGuard();

    constructor(
        app: App,
        mode: 'create' | 'edit' | 'view',
        genre: GenreConfig,
        onSave?: (genre: GenreConfig) => void,
        onDelete?: (id: string) => void
    ) {
        super(app);
        this.mode = mode;
        this.genre = { ...genre };
        this.tempGenre = JSON.parse(JSON.stringify(genre));
        this.onSave = onSave;
        this.onDelete = onDelete;
    }

    /**
     * 打开弹窗并渲染。
     */
    onOpen(): void {
        this.modalEl.addClass('nw-scope');
        this.modalEl.addClass('nw-modal');
        this.modalEl.addClass('nw-modal-85');
        this.dirtyGuard.attach(this, this.app);
        this.contentEl.addEventListener('input', () => this.dirtyGuard.markDirty());
        this.contentEl.addEventListener('change', () => this.dirtyGuard.markDirty());
        this.render();
    }

    private isEditable(): boolean {
        return this.mode === 'create' || this.mode === 'edit';
    }

    private render(): void {
        const { contentEl } = this;
        contentEl.empty();

        const titleMap = {
            create: t('knowledgebase.modal.genre.titleCreate'),
            edit: t('knowledgebase.modal.genre.titleEdit'),
            view: t('knowledgebase.modal.genre.titleView'),
        };
        contentEl.createEl('h3', { text: titleMap[this.mode], cls: 'nw-modal-title' });

        this.renderBasicInfo(contentEl);
        this.renderTagSection(contentEl, t('knowledgebase.modal.genre.tag.personality'), 'personalityTags');
        this.renderTagSection(contentEl, t('knowledgebase.modal.genre.tag.ability'), 'abilityTypes');
        this.renderTagSection(contentEl, t('knowledgebase.modal.genre.tag.role'), 'roleTypes');
        this.renderTagSection(contentEl, t('knowledgebase.modal.genre.tag.background'), 'backgroundTypes');
        this.renderTechniquesSection(contentEl);
        this.renderSubGenresSection(contentEl);
        this.renderWeightsSection(contentEl);
        this.renderActions(contentEl);
    }

    private renderBasicInfo(container: HTMLElement): void {
        const section = container.createDiv({ cls: 'nw-kb-modal-section' });
        section.createEl('h4', { text: t('knowledgebase.modal.genre.basicInfo'), cls: 'nw-kb-modal-section-title nw-kb-modal-section-title--roomy' });

        const form = section.createDiv({ cls: 'nw-kb-modal-form' });

        const nameRow = form.createDiv({ cls: 'nw-kb-modal-field' });
        nameRow.createSpan({ text: t('knowledgebase.modal.genre.name'), cls: 'nw-kb-modal-field-label' });
        if (this.isEditable()) {
            const input = nameRow.createEl('input', {
                type: 'text',
                value: this.tempGenre.name,
                cls: 'nw-kb-modal-input nw-kb-modal-input--lg'
            });
            input.addEventListener('input', () => {
                this.tempGenre.name = input.value.trim();
            });
        } else {
            nameRow.createDiv({ text: this.tempGenre.name, cls: 'nw-kb-modal-field-value' });
        }

        const categoryRow = form.createDiv({ cls: 'nw-kb-modal-field' });
        categoryRow.createSpan({ text: t('knowledgebase.modal.genre.channel'), cls: 'nw-kb-modal-field-label' });
        if (this.isEditable()) {
            const select = categoryRow.createEl('select', { cls: 'nw-kb-modal-select nw-kb-modal-select--lg' });
            const options = [
                { value: 'male', label: t('knowledgebase.format.channel.male') },
                { value: 'female', label: t('knowledgebase.format.channel.female') },
                { value: 'neutral', label: t('knowledgebase.format.channel.neutral') },
            ];
            options.forEach(opt => {
                const option = select.createEl('option', { value: opt.value, text: opt.label });
                if (this.tempGenre.category === opt.value) option.selected = true;
            });
            select.addEventListener('change', () => {
                this.tempGenre.category = select.value as 'male' | 'female' | 'neutral';
            });
        } else {
            const labelMap: Record<string, string> = {
                male: t('knowledgebase.format.channel.male'),
                female: t('knowledgebase.format.channel.female'),
                neutral: t('knowledgebase.format.channel.neutral'),
            };
            categoryRow.createDiv({ text: labelMap[this.tempGenre.category] || this.tempGenre.category });
        }

        const descRow = form.createDiv({ cls: 'nw-kb-modal-field' });
        descRow.createSpan({ text: t('knowledgebase.modal.genre.description'), cls: 'nw-kb-modal-field-label' });
        if (this.isEditable()) {
            const textarea = descRow.createEl('textarea', {
                value: this.tempGenre.description,
                cls: 'nw-kb-modal-textarea nw-kb-modal-textarea--lg',
                attr: {
                    rows: '3',
                    placeholder: t('knowledgebase.modal.genre.descriptionPlaceholder')
                }
            });
            textarea.addEventListener('input', () => {
                this.tempGenre.description = textarea.value.trim();
            });
        } else {
            descRow.createDiv({ text: this.tempGenre.description, cls: 'nw-kb-modal-field-text' });
        }
    }

    private renderTagSection(container: HTMLElement, label: string, field: 'personalityTags' | 'abilityTypes' | 'roleTypes' | 'backgroundTypes'): void {
        const section = container.createDiv({ cls: 'nw-kb-modal-section' });
        section.createEl('h4', {
            text: `${label} (${this.tempGenre[field].length})`,
            cls: 'nw-kb-modal-section-title'
        });

        const tagsWrap = section.createDiv({ cls: 'nw-kb-modal-tag-field' });

        this.tempGenre[field].forEach((tag, idx) => {
            const tagEl = tagsWrap.createSpan({ text: tag, cls: 'nw-kb-modal-tag nw-kb-modal-tag--chip' });
            if (this.isEditable()) {
                const removeBtn = tagEl.createSpan({ text: '×', cls: 'nw-kb-modal-tag-close' });
                removeBtn.addEventListener('click', () => {
                    this.tempGenre[field].splice(idx, 1);
                    this.render();
                });
            }
        });

        if (this.isEditable()) {
            const inputRow = section.createDiv({ cls: 'nw-kb-modal-inline-row nw-kb-modal-inline-row--mt' });
            const input = inputRow.createEl('input', {
                type: 'text',
                cls: 'nw-kb-modal-input nw-kb-modal-input--md nw-kb-modal-input--flex',
                attr: { placeholder: t('knowledgebase.modal.genre.tagPlaceholder', { label }) }
            });
            const addBtn = inputRow.createEl('button', {
                text: t('knowledgebase.modal.genre.add'),
                cls: 'nw-btn nw-btn-secondary nw-btn-xs'
            });
            addBtn.addEventListener('click', () => {
                const value = input.value.trim();
                if (value && !this.tempGenre[field].includes(value)) {
                    this.tempGenre[field].push(value);
                    input.value = '';
                    this.render();
                }
            });
            input.addEventListener('keydown', (e) => {
                if (isImeComposing(e)) return;
                if (e.key === 'Enter') {
                    e.preventDefault();
                    addBtn.click();
                }
            });
        }
    }

    private renderTechniquesSection(container: HTMLElement): void {
        const section = container.createDiv({ cls: 'nw-kb-modal-section' });
        section.createEl('h4', {
            text: t('knowledgebase.modal.genre.techniques', { count: this.tempGenre.techniques.length }),
            cls: 'nw-kb-modal-section-title'
        });

        if (this.tempGenre.techniques.length < 5 && this.isEditable()) {
            section.createDiv({ text: t('knowledgebase.modal.genre.techniqueHint'), cls: 'nw-kb-modal-hint-error' });
        }

        const techniquesList = section.createDiv({ cls: 'nw-kb-modal-list' });

        this.tempGenre.techniques.forEach((tech, idx) => {
            const techItem = techniquesList.createDiv({ cls: 'nw-kb-modal-item nw-kb-modal-item--roomy' });

            if (this.isEditable()) {
                const headerRow = techItem.createDiv({ cls: 'nw-kb-modal-item-head' });
                const nameInput = headerRow.createEl('input', {
                    type: 'text',
                    value: tech.name,
                    cls: 'nw-kb-modal-input nw-kb-modal-input--flex',
                    attr: { placeholder: t('knowledgebase.modal.genre.techniqueName') }
                });
                nameInput.addEventListener('input', () => {
                    this.tempGenre.techniques[idx].name = nameInput.value.trim();
                });

                const categorySelect = headerRow.createEl('select', { cls: 'nw-kb-modal-select' });
                const categories = techniqueCategories();
                categories.forEach(cat => {
                    const opt = categorySelect.createEl('option', { value: cat.value, text: cat.label });
                    if (tech.category === cat.value) opt.selected = true;
                });
                categorySelect.addEventListener('change', () => {
                    this.tempGenre.techniques[idx].category = categorySelect.value as TechniqueDef['category'];
                });

                const deleteBtn = headerRow.createEl('button', {
                    text: '🗑️',
                    cls: 'nw-btn nw-btn-ghost nw-btn-xs nw-kb-modal-btn--padded',
                    attr: {}
                });
                deleteBtn.addEventListener('click', () => {
                    this.tempGenre.techniques.splice(idx, 1);
                    this.render();
                });
            } else {
                const categoryMap: Record<string, string> = Object.fromEntries(
                    techniqueCategories().map(cat => [cat.value, cat.label]),
                );
                const headerRow = techItem.createDiv({ cls: 'nw-kb-modal-item-head nw-kb-modal-item-head--readonly' });
                headerRow.createDiv({ text: tech.name, cls: 'nw-kb-modal-item-name' });
                headerRow.createSpan({
                    text: categoryMap[tech.category] || tech.category,
                    cls: 'nw-kb-modal-item-chip'
                });
            }

            if (this.isEditable()) {
                const descInput = techItem.createEl('textarea', {
                    value: tech.description,
                    cls: 'nw-kb-modal-textarea nw-kb-modal-textarea--mb',
                    attr: {
                        rows: '2',
                        placeholder: t('knowledgebase.modal.genre.techniqueDesc')
                    }
                });
                descInput.addEventListener('input', () => {
                    this.tempGenre.techniques[idx].description = descInput.value.trim();
                });

                const kwInput = techItem.createEl('input', {
                    type: 'text',
                    value: tech.keywords.join(', '),
                    cls: 'nw-kb-modal-input nw-kb-modal-input--full',
                    attr: { placeholder: t('knowledgebase.modal.genre.keywordsPlaceholder') }
                });
                kwInput.addEventListener('input', () => {
                    this.tempGenre.techniques[idx].keywords = kwInput.value.split(',').map(k => k.trim()).filter(k => k);
                });
            } else {
                techItem.createDiv({ text: tech.description, cls: 'nw-kb-modal-item-meta' });
                if (tech.keywords.length > 0) {
                    const kwWrap = techItem.createDiv({ cls: 'nw-kb-modal-kw-wrap' });
                    tech.keywords.forEach(kw => {
                        kwWrap.createSpan({ text: kw, cls: 'nw-kb-modal-kw' });
                    });
                }
            }
        });

        if (this.isEditable()) {
            const addTechBtn = section.createEl('button', {
                text: t('knowledgebase.modal.genre.addTechnique'),
                cls: 'nw-btn nw-btn-secondary nw-btn-sm nw-kb-modal-btn--block',
                attr: {}
            });
            addTechBtn.addEventListener('click', () => {
                const newTech: TechniqueDef = {
                    id: `tech_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                    name: '',
                    category: 'structure',
                    description: '',
                    keywords: [],
                    baseConfidence: 0.5,
                    genreWeight: 1.0,
                };
                this.tempGenre.techniques.push(newTech);
                this.render();
            });
        }
    }

    private renderSubGenresSection(container: HTMLElement): void {
        const section = container.createDiv({ cls: 'nw-kb-modal-section' });
        const subGenres = this.tempGenre.subGenres || [];
        section.createEl('h4', {
            text: t('knowledgebase.modal.genre.subGenres', { count: subGenres.length }),
            cls: 'nw-kb-modal-section-title'
        });

        if (subGenres.length > 0) {
            const subList = section.createDiv({ cls: 'nw-kb-modal-list nw-kb-modal-list--sm' });
            subGenres.forEach((sub, idx) => {
                const subItem = subList.createDiv({ cls: 'nw-kb-modal-item nw-kb-modal-item--compact' });

                if (this.isEditable()) {
                    const row1 = subItem.createDiv({ cls: 'nw-kb-modal-item-row' });
                    const nameInput = row1.createEl('input', {
                        type: 'text',
                        value: sub.name,
                        cls: 'nw-kb-modal-input nw-kb-modal-input--flex',
                        attr: { placeholder: t('knowledgebase.modal.genre.subGenreName') }
                    });
                    nameInput.addEventListener('input', () => {
                        if (this.tempGenre.subGenres) {
                            this.tempGenre.subGenres[idx].name = nameInput.value.trim();
                        }
                    });
                    const delBtn = row1.createEl('button', {
                        text: '🗑️',
                        cls: 'nw-btn nw-btn-ghost nw-btn-xs'
                    });
                    delBtn.addEventListener('click', () => {
                        this.tempGenre.subGenres?.splice(idx, 1);
                        this.render();
                    });

                    const descInput = subItem.createEl('input', {
                        type: 'text',
                        value: sub.description,
                        cls: 'nw-kb-modal-input nw-kb-modal-input--full',
                        attr: { placeholder: t('knowledgebase.modal.genre.subGenreDesc') }
                    });
                    descInput.addEventListener('input', () => {
                        if (this.tempGenre.subGenres) {
                            this.tempGenre.subGenres[idx].description = descInput.value.trim();
                        }
                    });
                } else {
                    subItem.createDiv({ text: sub.name, cls: 'nw-kb-modal-item-name' });
                    subItem.createDiv({ text: sub.description, cls: 'nw-kb-modal-item-desc' });
                }
            });
        }

        if (this.isEditable()) {
            const addSubBtn = section.createEl('button', {
                text: t('knowledgebase.modal.genre.addSubGenre'),
                cls: 'nw-btn nw-btn-secondary nw-btn-sm nw-kb-modal-btn--block',
                attr: {}
            });
            addSubBtn.addEventListener('click', () => {
                if (!this.tempGenre.subGenres) {
                    this.tempGenre.subGenres = [];
                }
                const newSub: SubGenreConfig = {
                    id: `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                    name: '',
                    description: '',
                    keywords: [],
                    exampleTitles: [],
                };
                this.tempGenre.subGenres.push(newSub);
                this.render();
            });
        }
    }

    private renderWeightsSection(container: HTMLElement): void {
        const section = container.createDiv({ cls: 'nw-kb-modal-section' });
        section.createEl('h4', { text: t('knowledgebase.modal.genre.weights'), cls: 'nw-kb-modal-section-title nw-kb-modal-section-title--roomy' });

        const weightsGrid = section.createDiv({ cls: 'nw-kb-modal-grid' });

        const weightLabels: { key: keyof GenreConfig['weights']; label: string }[] = [
            { key: 'character', label: t('knowledgebase.dim.character') },
            { key: 'foreshadow', label: t('knowledgebase.dim.foreshadow') },
            { key: 'technique', label: t('knowledgebase.dim.technique') },
            { key: 'style', label: t('knowledgebase.dim.style') },
            { key: 'rhythm', label: t('knowledgebase.dim.rhythm') },
            { key: 'structure', label: t('knowledgebase.dim.structure') },
        ];

        weightLabels.forEach(({ key, label }) => {
            const weightItem = weightsGrid.createDiv({ cls: 'nw-kb-modal-item' });
            const labelRow = weightItem.createDiv({ cls: 'nw-kb-modal-item-row nw-kb-modal-item-row--between' });
            labelRow.createSpan({ text: label, cls: 'nw-kb-modal-weight-name' });
            labelRow.createSpan({
                text: (this.tempGenre.weights[key] * 100).toFixed(0) + '%',
                cls: 'nw-kb-modal-weight-value'
            });

            if (this.isEditable()) {
                const slider = weightItem.createEl('input', {
                    type: 'range',
                    cls: 'nw-kb-modal-range',
                    attr: {
                        min: '0',
                        max: '1',
                        step: '0.05',
                        value: this.tempGenre.weights[key].toString()
                    }
                });
                slider.addEventListener('input', () => {
                    this.tempGenre.weights[key] = parseFloat(slider.value);
                    this.render();
                });
            } else {
                const barBg = weightItem.createDiv({ cls: 'nw-kb-modal-bar' });
                const barFill = barBg.createDiv({ cls: 'nw-kb-modal-bar-fill' });
                barFill.style.setProperty('--nw-kb-pct', `${this.tempGenre.weights[key] * 100}%`);
            }
        });
    }

    private renderActions(container: HTMLElement): void {
        const actions = container.createDiv({ cls: 'nw-kb-modal-actions nw-kb-modal-actions--sticky' });

        if (this.mode === 'view') {
            const saveAsBtn = actions.createEl('button', {
                text: t('knowledgebase.modal.genre.saveAsCustom'),
                cls: 'nw-btn nw-btn-primary'
            });
            saveAsBtn.addEventListener('click', () => {
                const newGenre: GenreConfig = {
                    ...JSON.parse(JSON.stringify(this.tempGenre)),
                    id: `custom_${Date.now()}`,
                    isCustom: true,
                    name: t('knowledgebase.modal.genre.copyName', { name: this.tempGenre.name }),
                };
                this.onSave?.(newGenre);
                this.dirtyGuard.markClean();
                this.close();
            });

            const closeBtn = actions.createEl('button', {
                text: t('knowledgebase.modal.genre.close'),
                cls: 'nw-btn nw-btn-secondary'
            });
            closeBtn.addEventListener('click', () => this.close());
        } else if (this.mode === 'edit') {
            const deleteBtn = actions.createEl('button', {
                text: t('knowledgebase.modal.genre.delete'),
                cls: 'nw-btn nw-btn-danger'
            });
            deleteBtn.addEventListener('click', async () => {
                const confirmed = await OperationConfirmModal.confirm(this.app, {
                    title: t('knowledgebase.modal.genre.deleteTitle'),
                    description: t('knowledgebase.modal.genre.deleteDesc', { name: this.tempGenre.name }),
                    warning: t('knowledgebase.common.irreversible'),
                    confirmText: t('knowledgebase.common.confirmDelete'),
                    cancelText: t('knowledgebase.common.cancel'),
                });
                if (confirmed) {
                    this.onDelete?.(this.tempGenre.id);
                    this.dirtyGuard.markClean();
                    this.close();
                }
            });

            const cancelBtn = actions.createEl('button', {
                text: t('knowledgebase.common.cancel'),
                cls: 'nw-btn nw-btn-secondary'
            });
            cancelBtn.addEventListener('click', () => {
                this.dirtyGuard.markClean();
                this.close();
            });

            const saveBtn = actions.createEl('button', {
                text: t('knowledgebase.modal.genre.save'),
                cls: 'nw-btn nw-btn-primary'
            });
            saveBtn.addEventListener('click', () => {
                if (this.validate()) {
                    this.tempGenre.isCustom = true;
                    this.onSave?.(this.tempGenre);
                    this.dirtyGuard.markClean();
                    this.close();
                }
            });
        } else {
            const cancelBtn = actions.createEl('button', {
                text: t('knowledgebase.common.cancel'),
                cls: 'nw-btn nw-btn-secondary'
            });
            cancelBtn.addEventListener('click', () => {
                this.dirtyGuard.markClean();
                this.close();
            });

            const createBtn = actions.createEl('button', {
                text: t('knowledgebase.modal.genre.create'),
                cls: 'nw-btn nw-btn-primary'
            });
            createBtn.addEventListener('click', () => {
                if (this.validate()) {
                    this.tempGenre.id = `custom_${Date.now()}`;
                    this.tempGenre.isCustom = true;
                    this.onSave?.(this.tempGenre);
                    this.dirtyGuard.markClean();
                    this.close();
                }
            });
        }
    }

    private validate(): boolean {
        if (!this.tempGenre.name.trim()) {
            new Notice(t('knowledgebase.modal.genre.needName'));
            return false;
        }
        if (!this.tempGenre.category) {
            new Notice(t('knowledgebase.modal.genre.needChannel'));
            return false;
        }
        if (this.tempGenre.techniques.length < 5) {
            new Notice(t('knowledgebase.modal.genre.needTechniques'));
            return false;
        }
        for (let i = 0; i < this.tempGenre.techniques.length; i++) {
            if (!this.tempGenre.techniques[i].name.trim()) {
                new Notice(t('knowledgebase.modal.genre.techniqueNameRequired', { count: i + 1 }));
                return false;
            }
        }
        return true;
    }

    /**
     * 关闭弹窗并清空。
     */
    onClose(): void {
        this.contentEl.empty();
    }
}

/**
 * 批量操作弹窗。
 */
export class BatchOperationsModal extends Modal {
    private kbManager: KnowledgeBaseManager | null;
    private onCompleted: () => void;
    private selectedBooks: Set<string> = new Set();
    private operation: 'classify' | 'delete' | 'export' = 'classify';
    private processing: boolean = false;
    private books: BookBasicInfo[] = [];
    private loading: boolean = true;

    constructor(app: App, kbManager: KnowledgeBaseManager | null, onCompleted: () => void) {
        super(app);
        this.kbManager = kbManager;
        this.onCompleted = onCompleted;
    }

    /**
     * 打开弹窗并渲染。
     */
    async onOpen(): Promise<void> {
        this.modalEl.addClass('nw-scope');
        this.modalEl.addClass('nw-modal');
        this.render();
        await this.loadBooks();
    }

    private async loadBooks(): Promise<void> {
        if (!this.kbManager) {
            this.loading = false;
            this.render();
            return;
        }
        try {
            this.books = await this.kbManager.listBooks();
        } catch (e) {
            log.error('加载书籍列表失败:', e);
            this.books = [];
        }
        this.loading = false;
        this.render();
    }

    private render(): void {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl('h3', { text: t('knowledgebase.modal.batch.title'), cls: 'nw-modal-title' });

        if (this.loading) {
            contentEl.createDiv({ text: t('knowledgebase.modal.batch.loading'), cls: 'nw-kb-modal-empty' });
            return;
        }

        const opsRow = contentEl.createDiv({ cls: 'nw-kb-modal-ops' });

        const operations: Array<{ key: 'classify'; label: string; desc: string }> = [
            { key: 'classify', label: t('knowledgebase.modal.batch.classify'), desc: t('knowledgebase.modal.batch.classifyDesc') },
        ];

        operations.forEach(op => {
            const btn = opsRow.createEl('button', {
                text: op.label,
                cls: `nw-btn nw-kb-modal-op ${this.operation === op.key ? 'nw-btn-primary' : 'nw-btn-secondary'}`
            });
            btn.addEventListener('click', () => {
                this.operation = op.key;
                this.render();
            });
        });

        const books = this.books;
        const uncategorizedCount = books.filter(b => !b.primaryGenre).length;

        const selectRow = contentEl.createDiv({ cls: 'nw-kb-modal-row nw-kb-modal-row--between nw-kb-modal-row--mb' });
        selectRow.createSpan({
            text: t('knowledgebase.modal.batch.count', { books: books.length, uncategorized: uncategorizedCount }),
            cls: 'nw-kb-modal-count'
        });

        const selectBtns = selectRow.createDiv({ cls: 'nw-kb-modal-btn-group' });

        const selectAllBtn = selectBtns.createEl('button', {
            text: t('knowledgebase.modal.batch.selectAll'),
            cls: 'nw-btn nw-btn-secondary nw-btn-xs',
        });
        selectAllBtn.addEventListener('click', () => {
            books.forEach(b => this.selectedBooks.add(b.id));
            this.render();
        });

        const selectUncategorizedBtn = selectBtns.createEl('button', {
            text: t('knowledgebase.modal.batch.selectUncategorized'),
            cls: 'nw-btn nw-btn-secondary nw-btn-xs',
        });
        selectUncategorizedBtn.addEventListener('click', () => {
            this.selectedBooks.clear();
            books.filter(b => !b.primaryGenre).forEach(b => this.selectedBooks.add(b.id));
            this.render();
        });

        const clearBtn = selectBtns.createEl('button', {
            text: t('knowledgebase.modal.batch.clear'),
            cls: 'nw-btn nw-btn-secondary nw-btn-xs',
        });
        clearBtn.addEventListener('click', () => {
            this.selectedBooks.clear();
            this.render();
        });

        const bookList = contentEl.createDiv({ cls: 'nw-kb-modal-file-list' });

        if (books.length === 0) {
            bookList.createDiv({ text: t('knowledgebase.modal.batch.empty'), cls: 'nw-kb-modal-empty' });
        } else {
            books.forEach((book) => {
                const isSelected = this.selectedBooks.has(book.id);
                const item = bookList.createDiv({
                    cls: `nw-kb-modal-file-item nw-kb-modal-file-item--selectable${isSelected ? ' nw-kb-modal-file-item--selected' : ''}`
                });
                item.addEventListener('click', () => {
                    if (isSelected) {
                        this.selectedBooks.delete(book.id);
                    } else {
                        this.selectedBooks.add(book.id);
                    }
                    this.render();
                });

                item.createSpan({ text: isSelected ? '☑' : '☐', cls: 'nw-kb-modal-check' });

                const info = item.createDiv({ cls: 'nw-kb-modal-book-info' });
                info.createDiv({ text: book.name, cls: 'nw-kb-modal-book-name' });
                info.createDiv({ text: book.author || t('knowledgebase.card.unknownAuthor'), cls: 'nw-kb-modal-meta' });

                const genreText = book.primaryGenre
                    ? this.getGenreLabel(book.primaryGenre, book.primarySubGenre)
                    : t('knowledgebase.modal.batch.uncategorized');
                item.createSpan({ text: genreText, cls: 'nw-kb-modal-meta nw-kb-modal-meta--shrink' });
            });
        }

        const actions = contentEl.createDiv({ cls: 'nw-kb-modal-row nw-kb-modal-row--between nw-kb-modal-footer' });

        actions.createSpan({
            text: t('knowledgebase.modal.batch.selected', { count: this.selectedBooks.size }),
            cls: 'nw-kb-modal-count'
        });

        const btnGroup = actions.createDiv({ cls: 'nw-kb-modal-btn-group' });

        const cancelBtn = btnGroup.createEl('button', {
            text: t('knowledgebase.common.cancel'),
            cls: 'nw-btn nw-btn-secondary',
        });
        cancelBtn.addEventListener('click', () => this.close());

        const executeBtn = btnGroup.createEl('button', {
            text: this.processing ? t('knowledgebase.modal.batch.processing') : t('knowledgebase.modal.batch.execute'),
            cls: 'nw-btn nw-btn-primary',
            attr: { disabled: this.selectedBooks.size === 0 || this.processing ? 'true' : null }
        });
        executeBtn.addEventListener('click', async () => {
            if (this.selectedBooks.size === 0 || this.processing) return;
            this.processing = true;
            this.render();

            try {
                if (this.operation === 'classify') {
                    new Notice(t('knowledgebase.modal.batch.classifying', { count: this.selectedBooks.size }));
                    await this.kbManager?.classifyBatch(Array.from(this.selectedBooks));
                    showSuccessNotice(t('knowledgebase.modal.batch.classifyDone'));
                }
                this.onCompleted();
                this.close();
            } catch (e) {
                log.error('批量操作失败:', e);
                showErrorNotice(t('knowledgebase.modal.batch.failed'));
                this.processing = false;
                this.render();
            }
        });
    }

    private getGenreLabel(genreId: string, subGenreId?: string): string {
        if (!this.kbManager) return genreId;
        const kb = this.kbManager.getKnowledgeBase();
        const genre = kb.getGenre(genreId);
        if (!genre) return genreId;
        if (!subGenreId) return genre.name;
        const sub = kb.getSubGenre(genreId, subGenreId);
        return sub ? `${genre.name}·${sub.name}` : genre.name;
    }

    /**
     * 关闭弹窗并清空。
     */
    onClose(): void {
        this.contentEl.empty();
    }
}
