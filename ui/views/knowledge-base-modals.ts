import { Modal, App, Notice, Setting, TFile } from 'obsidian';
import { KnowledgeBaseManager, type BookBasicInfo } from '@/services/knowledge-base-manager';
import { WebnovelKnowledgeBase, type GenreConfig, type SubGenreConfig, type TechniqueDef } from '@/shared/webnovel-knowledge-base';
import { kbBookDir } from '@/shared/paths';
import { createLogger } from '@/shared/logger';
import { OperationConfirmModal } from '@/ui/components/progress';
import { isImeComposing } from '@/shared/keyboard';

const log = createLogger('KnowledgeBaseModals');

/**
 * 导入书籍弹窗。
 */
export class ImportBookModal extends Modal {
    private kbManager: KnowledgeBaseManager | null;
    private onImported: (book: any) => void;
    private nameValue: string = '';
    private authorValue: string = '';
    private sourcePath: string = '';
    private step: 'select' | 'form' = 'select';
    /** 导入进行中：确认按钮不禁用的话，双击会建出「书名 (2)」 */
    private importInFlight = false;

    constructor(app: App, kbManager: KnowledgeBaseManager | null, onImported: (book: any) => void) {
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

        contentEl.createEl('h3', { text: '📥 导入参考书籍', cls: 'nw-modal-title' });

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
            { icon: '📂', label: '从 Vault 选择文件', desc: '选择 vault 中的 .txt 或 .md 文件', action: () => this.selectFromVault() },
            { icon: '📄', label: '从本地文件导入', desc: '从本地文件系统选择文件', action: () => this.importFromFile() },
            { icon: '✏️', label: '手动输入信息', desc: '手动填写书籍信息', action: () => { this.step = 'form'; this.render(); } },
        ];

        options.forEach(opt => {
            const card = contentEl.createDiv({
                cls: 'nw-u-p-16px nw-u-b-1px-solid-background-m nw-u-brd-8px nw-u-marginbottom-12px nw-u-cur-pointer nw-u-d-flex nw-u-ai-center nw-u-gap-12px nw-u-transition-all-0-15s'
            });
            card.addEventListener('mouseenter', () => {
                card.style.borderColor = 'var(--interactive-accent)';
            });
            card.addEventListener('mouseleave', () => {
                card.style.borderColor = 'var(--background-modifier-border)';
            });

            card.createSpan({ text: opt.icon, cls: 'nw-u-fs-28px' });
            const info = card.createDiv({ cls: 'nw-u-flex-1' });
            info.createDiv({ text: opt.label, cls: 'nw-u-fs-14px nw-u-fwt-500 nw-u-marginbottom-4px' });
            info.createDiv({ text: opt.desc, cls: 'nw-text-sm-muted' });
            card.createSpan({ text: '→', cls: 'nw-u-c-text-muted nw-u-fs-16px' });

            card.addEventListener('click', opt.action);
        });
    }

    private async selectFromVault(): Promise<void> {
        try {
            const files = this.app.vault.getFiles().filter(f =>
                f.extension === 'txt' || f.extension === 'md'
            );

            if (files.length === 0) {
                new Notice('Vault 中没有找到 .txt 或 .md 文件');
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
                    contentEl.style.width = '100%';
                    contentEl.createEl('h3', { text: '选择文件' });

                    const searchInput = contentEl.createEl('input', {
                        type: 'text',
                        attr: {
                            placeholder: '搜索文件...',
                            style: 'width:100%;padding:8px;margin-bottom:12px;border:1px solid var(--background-modifier-border);border-radius:4px;'
                        }
                    });

                    const list = contentEl.createDiv({
                        cls: 'nw-u-maxh-300px nw-u-ovy-auto nw-u-b-1px-solid-background-m nw-u-brd-6px'
                    });

                    const renderList = (filter: string) => {
                        list.empty();
                        const filtered = this.files.filter(f =>
                            f.name.toLowerCase().includes(filter.toLowerCase())
                        );
                        filtered.forEach(file => {
                            const item = list.createDiv({
                                attr: { style: 'padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--background-modifier-border);&:last-child{border-bottom:none;}' }
                            });
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
            new Notice('选择文件失败');
        }
    }

    private importFromFile(): void {
        const input = createEl('input', {
            attr: { type: 'file', accept: '.txt,.md', style: 'display:none;' }
        });
        input.addEventListener('change', async (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) return;
            try {
                const text = await file.text();
                const name = file.name.replace(/\.(txt|md)$/i, '');
                await this.importBook(name, '', file.name, text);
            } catch (err) {
                new Notice('读取文件失败');
            }
        });
        document.body.appendChild(input);
        input.click();
        document.body.removeChild(input);
    }

    private renderFormStep(): void {
        const { contentEl } = this;

        new Setting(contentEl)
            .setName('书名')
            .addText(t => t
                .setPlaceholder('请输入书名')
                .setValue(this.nameValue)
                .onChange(v => this.nameValue = v));

        new Setting(contentEl)
            .setName('作者')
            .addText(t => t
                .setPlaceholder('请输入作者（可选）')
                .setValue(this.authorValue)
                .onChange(v => this.authorValue = v));

        const actions = contentEl.createDiv({
            cls: "nw-flex-end nw-u-margintop-20px", attr: {}
        });

        const backBtn = actions.createEl('button', {
            text: '返回',
            cls: 'nw-btn nw-btn-secondary'
        });
        backBtn.addEventListener('click', () => {
            this.step = 'select';
            this.render();
        });

        const confirmBtn = actions.createEl('button', {
            text: '确认导入',
            cls: 'nw-btn nw-btn-primary'
        });
        confirmBtn.addEventListener('click', () => {
            if (!this.nameValue.trim()) {
                new Notice('请输入书名');
                return;
            }
            this.importBook(this.nameValue.trim(), this.authorValue.trim(), '', '');
        });
    }

    private async importBook(name: string, author: string, sourcePath: string, content: string): Promise<void> {
        if (!this.kbManager) {
            new Notice('知识库管理器未初始化');
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
                const fs = (this.app.vault.adapter as any);
                const baseDir = this.kbManager.getBaseDir();
                // 必须用 book.name：addBook 遇到同名会自动加「(2)」后缀，
                // 沿用入参 name 会把源文本写进另一个目录，
                // 之后 getSourceText 按 book.name 拼路径 → 永远「源文本文件不存在」。
                const bookDir = kbBookDir(book.name, baseDir);
                await fs.mkdir(bookDir).catch(() => { });
                await fs.write(`${bookDir}/${book.name}.txt`, content);
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
            new Notice(`导入失败: ${e instanceof Error ? e.message : String(e)}`);
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
    private channelValue: string;
    private genreValue: string;
    private subGenreValue: string;
    private customTagsList: string[];
    private customTagsInputValue: string = '';

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
        this.renderContent();
    }

    private render(): void {
        this.renderContent();
    }

    private renderContent(): void {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl('h3', { text: '✏️ 编辑书籍信息' });

        new Setting(contentEl)
            .setName('书名')
            .addText(t => t
                .setValue(this.nameValue)
                .onChange(v => this.nameValue = v));

        new Setting(contentEl)
            .setName('作者')
            .addText(t => t
                .setValue(this.authorValue)
                .onChange(v => this.authorValue = v));

        new Setting(contentEl)
            .setName('简介')
            .addTextArea(t => t
                .setValue(this.synopsisValue)
                .onChange(v => this.synopsisValue = v)
                .inputEl.rows = 4);

        contentEl.createEl('h4', { text: '题材分类', cls: 'nw-u-margintop-20px nw-u-marginbottom-8px nw-u-fs-14px' });

        const channelSetting = new Setting(contentEl)
            .setName('频道')
            .addDropdown(d => {
                d.addOption('', '请选择');
                d.addOption('male', '男频');
                d.addOption('female', '女频');
                d.addOption('neutral', '中性');
                d.setValue(this.channelValue);
                d.onChange(v => {
                    this.channelValue = v;
                    this.genreValue = '';
                    this.subGenreValue = '';
                    this.render();
                });
            });
        void channelSetting;

        const genreSetting = new Setting(contentEl)
            .setName('大类')
            .addDropdown(d => {
                d.addOption('', '请选择');
                if (this.kb && this.channelValue) {
                    this.kb.getGenresByCategory(this.channelValue as any).forEach(g => {
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
                    .setName('细分')
                    .addDropdown(d => {
                        d.addOption('', '请选择');
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

        contentEl.createEl('h4', { text: '自定义标签', cls: 'nw-u-margintop-20px nw-u-marginbottom-8px nw-u-fs-14px' });

        const tagsContainer = contentEl.createDiv({
            cls: 'nw-u-d-flex nw-u-fwr-wrap nw-u-gap-6px nw-u-marginbottom-12px nw-u-minh-30px'
        });
        this.renderCustomTags(tagsContainer);

        const addTagContainer = contentEl.createDiv({
            cls: 'nw-u-d-flex nw-u-gap-8px nw-u-marginbottom-12px'
        });
        const tagInput = addTagContainer.createEl('input', {
            type: 'text',
            attr: {
                placeholder: '输入标签，按回车添加',
                style: 'flex:1;padding:6px 10px;border:1px solid var(--background-modifier-border);border-radius:4px;font-size:13px;'
            }
        });
        const addTagBtn = addTagContainer.createEl('button', {
            text: '添加',
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

        const actions = contentEl.createDiv({
            cls: "nw-flex-end nw-u-margintop-20px", attr: {}
        });

        const cancelBtn = actions.createEl('button', {
            text: '取消',
            cls: 'nw-btn nw-btn-secondary'
        });
        cancelBtn.addEventListener('click', () => this.close());

        const saveBtn = actions.createEl('button', {
            text: '保存',
            cls: 'nw-btn nw-btn-primary'
        });
        saveBtn.addEventListener('click', () => this.save());
    }

    private renderCustomTags(container: HTMLElement): void {
        container.empty();
        if (this.customTagsList.length === 0) {
            container.createSpan({
                text: '暂无标签',
                cls: 'nw-u-c-text-muted nw-u-fs-13px'
            });
            return;
        }
        this.customTagsList.forEach((tag, idx) => {
            const tagEl = container.createSpan({
                cls: "nw-flex-row-sm nw-u-p-4px-10px nw-u-fs-12px nw-u-bg-background-secondary nw-u-brd-12px",
                attr: {}
            });
            tagEl.createSpan({ text: tag });
            const delBtn = tagEl.createSpan({
                text: '×',
                cls: 'nw-u-cur-pointer nw-u-c-text-muted nw-u-fs-14px nw-u-lh-1'
            });
            delBtn.addEventListener('click', () => {
                this.customTagsList.splice(idx, 1);
                this.renderCustomTags(container);
            });
        });
    }

    private save(): void {
        if (!this.kbManager || !this.nameValue.trim()) {
            new Notice('请填写书名');
            return;
        }

        const channelChanged = (this.channelValue as any) !== (this.book.genreChannel || '');
        const genreChanged = (this.genreValue || '') !== (this.book.primaryGenre || '');
        const subGenreChanged = (this.subGenreValue || '') !== (this.book.primarySubGenre || '');

        this.kbManager.updateBook(this.book.id, {
            name: this.nameValue.trim(),
            author: this.authorValue.trim(),
            synopsis: this.synopsisValue.trim(),
            genreChannel: (this.channelValue as any) || undefined,
            primaryGenre: this.genreValue || undefined,
            primarySubGenre: this.subGenreValue || undefined,
            customTags: this.customTagsList,
        }).then(async () => {
            if (channelChanged || genreChanged || subGenreChanged) {
                try {
                    await this.kbManager!.recordGenreCorrection(this.book.id, {
                        channel: (this.channelValue as any) || undefined,
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
            this.close();
            new Notice('✅ 保存成功');
        }).catch((e: unknown) => {
            log.error('[KnowledgeBaseModals] 书籍保存失败:', e);
            new Notice(`⚠️ 保存失败：${e instanceof Error ? e.message : String(e)}`, 8000);
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
        this.modalEl.style.maxHeight = '85vh';
        this.modalEl.style.overflowY = 'auto';
        this.render();
    }

    private isEditable(): boolean {
        return this.mode === 'create' || this.mode === 'edit';
    }

    private render(): void {
        const { contentEl } = this;
        contentEl.empty();

        const titleMap = {
            create: '➕ 新增题材',
            edit: '✏️ 编辑题材',
            view: '📖 题材详情',
        };
        contentEl.createEl('h3', { text: titleMap[this.mode], cls: 'nw-modal-title' });

        this.renderBasicInfo(contentEl);
        this.renderTagSection(contentEl, '性格标签', 'personalityTags');
        this.renderTagSection(contentEl, '能力类型', 'abilityTypes');
        this.renderTagSection(contentEl, '角色定位', 'roleTypes');
        this.renderTagSection(contentEl, '背景类型', 'backgroundTypes');
        this.renderTechniquesSection(contentEl);
        this.renderSubGenresSection(contentEl);
        this.renderWeightsSection(contentEl);
        this.renderActions(contentEl);
    }

    private renderBasicInfo(container: HTMLElement): void {
        const section = container.createDiv({ cls: 'nw-u-marginbottom-20px' });
        section.createEl('h4', { text: '基本信息', cls: 'nw-u-m-0-0-12px-0 nw-u-fs-14px' });

        const form = section.createDiv({ cls: 'nw-u-d-flex nw-u-fd-column nw-u-gap-12px' });

        const nameRow = form.createDiv({ cls: 'nw-u-d-flex nw-u-fd-column nw-u-gap-4px' });
        nameRow.createSpan({ text: '名称', cls: 'nw-text-sm-muted' });
        if (this.isEditable()) {
            const input = nameRow.createEl('input', {
                type: 'text',
                value: this.tempGenre.name,
                cls: 'nw-u-p-8px-12px nw-u-b-1px-solid-background-m nw-u-brd-6px nw-u-fs-13px nw-u-bg-background-primary nw-u-c-text-normal'
            });
            input.addEventListener('input', () => {
                this.tempGenre.name = input.value.trim();
            });
        } else {
            nameRow.createDiv({ text: this.tempGenre.name, cls: 'nw-u-fs-14px nw-u-fwt-500' });
        }

        const categoryRow = form.createDiv({ cls: 'nw-u-d-flex nw-u-fd-column nw-u-gap-4px' });
        categoryRow.createSpan({ text: '频道', cls: 'nw-text-sm-muted' });
        if (this.isEditable()) {
            const select = categoryRow.createEl('select', {
                cls: 'nw-u-p-8px-12px nw-u-b-1px-solid-background-m nw-u-brd-6px nw-u-fs-13px nw-u-bg-background-primary nw-u-c-text-normal'
            });
            const options = [
                { value: 'male', label: '男频' },
                { value: 'female', label: '女频' },
                { value: 'neutral', label: '中性' },
            ];
            options.forEach(opt => {
                const option = select.createEl('option', { value: opt.value, text: opt.label });
                if (this.tempGenre.category === opt.value) option.selected = true;
            });
            select.addEventListener('change', () => {
                this.tempGenre.category = select.value as 'male' | 'female' | 'neutral';
            });
        } else {
            const labelMap: Record<string, string> = { male: '男频', female: '女频', neutral: '中性' };
            categoryRow.createDiv({ text: labelMap[this.tempGenre.category] || this.tempGenre.category });
        }

        const descRow = form.createDiv({ cls: 'nw-u-d-flex nw-u-fd-column nw-u-gap-4px' });
        descRow.createSpan({ text: '描述', cls: 'nw-text-sm-muted' });
        if (this.isEditable()) {
            const textarea = descRow.createEl('textarea', {
                value: this.tempGenre.description,
                attr: {
                    rows: '3',
                    placeholder: '描述该题材的读者群体、爽点、常见元素等（可选）',
                    style: 'padding:8px 12px;border:1px solid var(--background-modifier-border);border-radius:6px;font-size:13px;background:var(--background-primary);color:var(--text-normal);resize:vertical;'
                }
            });
            textarea.addEventListener('input', () => {
                this.tempGenre.description = textarea.value.trim();
            });
        } else {
            descRow.createDiv({
                text: this.tempGenre.description,
                cls: 'nw-u-fs-13px nw-u-lh-1-6 nw-u-c-text-normal'
            });
        }
    }

    private renderTagSection(container: HTMLElement, label: string, field: 'personalityTags' | 'abilityTypes' | 'roleTypes' | 'backgroundTypes'): void {
        const section = container.createDiv({ cls: 'nw-u-marginbottom-20px' });
        section.createEl('h4', {
            text: `${label} (${this.tempGenre[field].length})`,
            cls: 'nw-u-m-0-0-8px-0 nw-u-fs-14px'
        });

        const tagsWrap = section.createDiv({
            cls: 'nw-u-d-flex nw-u-fwr-wrap nw-u-gap-6px nw-u-p-12px nw-u-bg-background-secondary nw-u-brd-6px nw-u-minh-48px'
        });

        this.tempGenre[field].forEach((tag, idx) => {
            const tagEl = tagsWrap.createSpan({
                text: tag,
                cls: 'nw-u-p-3px-10px nw-u-fs-12px nw-u-bg-background-primary nw-u-brd-10px nw-u-c-text-normal nw-u-d-flex nw-u-ai-center nw-u-gap-4px'
            });
            if (this.isEditable()) {
                const removeBtn = tagEl.createSpan({
                    text: '×',
                    cls: 'nw-u-cur-pointer nw-u-c-text-muted nw-u-fs-14px nw-u-lh-1'
                });
                removeBtn.addEventListener('click', () => {
                    this.tempGenre[field].splice(idx, 1);
                    this.render();
                });
            }
        });

        if (this.isEditable()) {
            const inputRow = section.createDiv({ cls: 'nw-u-d-flex nw-u-gap-6px nw-u-margintop-8px' });
            const input = inputRow.createEl('input', {
                type: 'text',
                attr: {
                    placeholder: `添加${label}...`,
                    style: 'flex:1;padding:6px 10px;border:1px solid var(--background-modifier-border);border-radius:6px;font-size:12px;background:var(--background-primary);color:var(--text-normal);'
                }
            });
            const addBtn = inputRow.createEl('button', {
                text: '添加',
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
        const section = container.createDiv({ cls: 'nw-u-marginbottom-20px' });
        section.createEl('h4', {
            text: `写作技巧 (${this.tempGenre.techniques.length})`,
            cls: 'nw-u-m-0-0-8px-0 nw-u-fs-14px'
        });

        if (this.tempGenre.techniques.length < 5 && this.isEditable()) {
            section.createDiv({
                text: '⚠️ 至少需要 5 个写作技巧',
                cls: 'nw-u-fs-12px nw-u-c-e74c3c nw-u-marginbottom-8px'
            });
        }

        const techniquesList = section.createDiv({
            cls: 'nw-u-d-flex nw-u-fd-column nw-u-gap-8px nw-u-maxh-300px nw-u-ovy-auto'
        });

        this.tempGenre.techniques.forEach((tech, idx) => {
            const techItem = techniquesList.createDiv({
                cls: 'nw-u-p-10px-12px nw-u-bg-background-secondary nw-u-brd-6px'
            });

            if (this.isEditable()) {
                const headerRow = techItem.createDiv({ cls: 'nw-u-d-flex nw-u-ai-center nw-u-jc-space-between nw-u-marginbottom-8px nw-u-gap-8px' });
                const nameInput = headerRow.createEl('input', {
                    type: 'text',
                    value: tech.name,
                    attr: {
                        placeholder: '技巧名称',
                        style: 'flex:1;padding:4px 8px;border:1px solid var(--background-modifier-border);border-radius:4px;font-size:12px;background:var(--background-primary);color:var(--text-normal);'
                    }
                });
                nameInput.addEventListener('input', () => {
                    this.tempGenre.techniques[idx].name = nameInput.value.trim();
                });

                const categorySelect = headerRow.createEl('select', {
                    cls: 'nw-u-p-4px-8px nw-u-b-1px-solid-background-m nw-u-brd-4px nw-u-fs-12px nw-u-bg-background-primary nw-u-c-text-normal'
                });
                const categories = [
                    { value: 'structure', label: '结构' },
                    { value: 'cool_point', label: '爽点' },
                    { value: 'emotion', label: '情感' },
                    { value: 'rhythm', label: '节奏' },
                    { value: 'genre', label: '题材' },
                    { value: 'style', label: '风格' },
                    { value: 'foreshadow', label: '伏笔' },
                ];
                categories.forEach(cat => {
                    const opt = categorySelect.createEl('option', { value: cat.value, text: cat.label });
                    if (tech.category === cat.value) opt.selected = true;
                });
                categorySelect.addEventListener('change', () => {
                    this.tempGenre.techniques[idx].category = categorySelect.value as TechniqueDef['category'];
                });

                const deleteBtn = headerRow.createEl('button', {
                    text: '🗑️',
                    cls: "nw-btn nw-btn-ghost nw-btn-xs nw-u-p-4px-8px",
                    attr: {}
                });
                deleteBtn.addEventListener('click', () => {
                    this.tempGenre.techniques.splice(idx, 1);
                    this.render();
                });
            } else {
                const categoryMap: Record<string, string> = {
                    structure: '结构', cool_point: '爽点', emotion: '情感', rhythm: '节奏',
                    genre: '题材', style: '风格', foreshadow: '伏笔'
                };
                const headerRow = techItem.createDiv({ cls: 'nw-u-d-flex nw-u-ai-center nw-u-jc-space-between nw-u-marginbottom-4px' });
                headerRow.createDiv({ text: tech.name, cls: 'nw-u-fs-13px nw-u-fwt-500' });
                headerRow.createSpan({
                    text: categoryMap[tech.category] || tech.category,
                    cls: 'nw-u-fs-11px nw-u-p-2px-8px nw-u-bg-background-primary nw-u-brd-8px nw-u-c-text-muted'
                });
            }

            if (this.isEditable()) {
                const descInput = techItem.createEl('textarea', {
                    value: tech.description,
                    attr: {
                        rows: '2',
                        placeholder: '技巧描述',
                        style: 'width:100%;padding:4px 8px;border:1px solid var(--background-modifier-border);border-radius:4px;font-size:12px;background:var(--background-primary);color:var(--text-normal);resize:vertical;margin-bottom:6px;box-sizing:border-box;'
                    }
                });
                descInput.addEventListener('input', () => {
                    this.tempGenre.techniques[idx].description = descInput.value.trim();
                });

                const kwInput = techItem.createEl('input', {
                    type: 'text',
                    value: tech.keywords.join(', '),
                    attr: {
                        placeholder: '关键词（用逗号分隔）',
                        style: 'width:100%;padding:4px 8px;border:1px solid var(--background-modifier-border);border-radius:4px;font-size:12px;background:var(--background-primary);color:var(--text-normal);box-sizing:border-box;'
                    }
                });
                kwInput.addEventListener('input', () => {
                    this.tempGenre.techniques[idx].keywords = kwInput.value.split(',').map(k => k.trim()).filter(k => k);
                });
            } else {
                techItem.createDiv({
                    text: tech.description,
                    cls: 'nw-u-fs-12px nw-u-c-text-muted nw-u-lh-1-5 nw-u-marginbottom-4px'
                });
                if (tech.keywords.length > 0) {
                    const kwWrap = techItem.createDiv({ cls: 'nw-u-d-flex nw-u-fwr-wrap nw-u-gap-4px' });
                    tech.keywords.forEach(kw => {
                        kwWrap.createSpan({
                            text: kw,
                            cls: 'nw-u-fs-11px nw-u-p-1px-6px nw-u-bg-background-primary nw-u-brd-8px nw-u-c-text-muted'
                        });
                    });
                }
            }
        });

        if (this.isEditable()) {
            const addTechBtn = section.createEl('button', {
                text: '➕ 添加技巧',
                cls: "nw-btn nw-btn-secondary nw-btn-sm nw-u-margintop-8px nw-u-w-100",
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
        const section = container.createDiv({ cls: 'nw-u-marginbottom-20px' });
        const subGenres = this.tempGenre.subGenres || [];
        section.createEl('h4', {
            text: `细分题材 (${subGenres.length}) - 可选`,
            cls: 'nw-u-m-0-0-8px-0 nw-u-fs-14px'
        });

        if (subGenres.length > 0) {
            const subList = section.createDiv({
                cls: 'nw-u-d-flex nw-u-fd-column nw-u-gap-6px nw-u-maxh-200px nw-u-ovy-auto'
            });
            subGenres.forEach((sub, idx) => {
                const subItem = subList.createDiv({
                    cls: 'nw-u-p-8px-10px nw-u-bg-background-secondary nw-u-brd-6px'
                });

                if (this.isEditable()) {
                    const row1 = subItem.createDiv({ cls: 'nw-u-d-flex nw-u-gap-6px nw-u-marginbottom-4px' });
                    const nameInput = row1.createEl('input', {
                        type: 'text',
                        value: sub.name,
                        attr: {
                            placeholder: '子题材名称',
                            style: 'flex:1;padding:4px 8px;border:1px solid var(--background-modifier-border);border-radius:4px;font-size:12px;background:var(--background-primary);color:var(--text-normal);'
                        }
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
                        attr: {
                            placeholder: '描述',
                            style: 'width:100%;padding:4px 8px;border:1px solid var(--background-modifier-border);border-radius:4px;font-size:12px;background:var(--background-primary);color:var(--text-normal);box-sizing:border-box;'
                        }
                    });
                    descInput.addEventListener('input', () => {
                        if (this.tempGenre.subGenres) {
                            this.tempGenre.subGenres[idx].description = descInput.value.trim();
                        }
                    });
                } else {
                    subItem.createDiv({ text: sub.name, cls: 'nw-u-fs-13px nw-u-fwt-500 nw-u-marginbottom-2px' });
                    subItem.createDiv({
                        text: sub.description,
                        cls: "nw-text-muted-11 nw-u-fs-12px", attr: {}
                    });
                }
            });
        }

        if (this.isEditable()) {
            const addSubBtn = section.createEl('button', {
                text: '➕ 添加细分题材',
                cls: "nw-btn nw-btn-secondary nw-btn-sm nw-u-margintop-8px nw-u-w-100",
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
        const section = container.createDiv({ cls: 'nw-u-marginbottom-20px' });
        section.createEl('h4', { text: '权重配置', cls: 'nw-u-m-0-0-12px-0 nw-u-fs-14px' });

        const weightsGrid = section.createDiv({
            cls: 'nw-u-d-grid nw-u-gtc-repeat-2-1fr nw-u-gap-12px'
        });

        const weightLabels: { key: keyof GenreConfig['weights']; label: string }[] = [
            { key: 'character', label: '人设' },
            { key: 'foreshadow', label: '伏笔' },
            { key: 'technique', label: '技巧' },
            { key: 'style', label: '风格' },
            { key: 'rhythm', label: '节奏' },
            { key: 'structure', label: '结构' },
        ];

        weightLabels.forEach(({ key, label }) => {
            const weightItem = weightsGrid.createDiv({
                cls: 'nw-u-p-10px nw-u-bg-background-secondary nw-u-brd-6px'
            });
            const labelRow = weightItem.createDiv({ cls: 'nw-u-d-flex nw-u-jc-space-between nw-u-marginbottom-6px' });
            labelRow.createSpan({ text: label, cls: 'nw-u-fs-12px' });
            labelRow.createSpan({
                text: (this.tempGenre.weights[key] * 100).toFixed(0) + '%',
                cls: 'nw-u-fs-12px nw-u-fwt-600 nw-u-c-interactive-accent'
            });

            if (this.isEditable()) {
                const slider = weightItem.createEl('input', {
                    type: 'range',
                    attr: {
                        min: '0',
                        max: '1',
                        step: '0.05',
                        value: this.tempGenre.weights[key].toString(),
                        style: 'width:100%;'
                    }
                });
                slider.addEventListener('input', () => {
                    this.tempGenre.weights[key] = parseFloat(slider.value);
                    this.render();
                });
            } else {
                const barBg = weightItem.createDiv({
                    cls: 'nw-u-h-6px nw-u-bg-background-primary nw-u-brd-3px nw-u-ov-hidden'
                });
                barBg.createDiv({
                    attr: {
                        style: `height:100%;width:${this.tempGenre.weights[key] * 100}%;background:var(--interactive-accent);border-radius:3px;`
                    }
                });
            }
        });
    }

    private renderActions(container: HTMLElement): void {
        const actions = container.createDiv({
            cls: "nw-flex-end nw-u-margintop-20px nw-u-d-flex nw-u-gap-8px nw-u-pos-sticky nw-u-bot-0 nw-u-bg-background-primary nw-u-paddingtop-12px nw-u-bt-1px-solid-background-m",
            attr: {}
        });

        if (this.mode === 'view') {
            const saveAsBtn = actions.createEl('button', {
                text: '💾 另存为自定义',
                cls: 'nw-btn nw-btn-primary'
            });
            saveAsBtn.addEventListener('click', () => {
                const newGenre: GenreConfig = {
                    ...JSON.parse(JSON.stringify(this.tempGenre)),
                    id: `custom_${Date.now()}`,
                    isCustom: true,
                    name: `${this.tempGenre.name} (副本)`,
                };
                this.onSave?.(newGenre);
                this.close();
            });

            const closeBtn = actions.createEl('button', {
                text: '关闭',
                cls: 'nw-btn nw-btn-secondary'
            });
            closeBtn.addEventListener('click', () => this.close());
        } else if (this.mode === 'edit') {
            const deleteBtn = actions.createEl('button', {
                text: '🗑️ 删除',
                cls: 'nw-btn nw-btn-danger'
            });
            deleteBtn.addEventListener('click', async () => {
                const confirmed = await OperationConfirmModal.confirm(this.app, {
                    title: '删除题材',
                    description: `确定要删除题材「${this.tempGenre.name}」吗？`,
                    warning: '此操作不可恢复',
                    confirmText: '确认删除',
                    cancelText: '取消',
                });
                if (confirmed) {
                    this.onDelete?.(this.tempGenre.id);
                    this.close();
                }
            });

            const cancelBtn = actions.createEl('button', {
                text: '取消',
                cls: 'nw-btn nw-btn-secondary'
            });
            cancelBtn.addEventListener('click', () => this.close());

            const saveBtn = actions.createEl('button', {
                text: '保存',
                cls: 'nw-btn nw-btn-primary'
            });
            saveBtn.addEventListener('click', () => {
                if (this.validate()) {
                    this.tempGenre.isCustom = true;
                    this.onSave?.(this.tempGenre);
                    this.close();
                }
            });
        } else {
            const cancelBtn = actions.createEl('button', {
                text: '取消',
                cls: 'nw-btn nw-btn-secondary'
            });
            cancelBtn.addEventListener('click', () => this.close());

            const createBtn = actions.createEl('button', {
                text: '创建',
                cls: 'nw-btn nw-btn-primary'
            });
            createBtn.addEventListener('click', () => {
                if (this.validate()) {
                    this.tempGenre.id = `custom_${Date.now()}`;
                    this.tempGenre.isCustom = true;
                    this.onSave?.(this.tempGenre);
                    this.close();
                }
            });
        }
    }

    private validate(): boolean {
        if (!this.tempGenre.name.trim()) {
            new Notice('请输入题材名称');
            return false;
        }
        if (!this.tempGenre.category) {
            new Notice('请选择频道');
            return false;
        }
        if (this.tempGenre.techniques.length < 5) {
            new Notice('写作技巧至少需要 5 个');
            return false;
        }
        for (let i = 0; i < this.tempGenre.techniques.length; i++) {
            if (!this.tempGenre.techniques[i].name.trim()) {
                new Notice(`第 ${i + 1} 个技巧名称不能为空`);
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

        contentEl.createEl('h3', { text: '⚙️ 批量操作', cls: 'nw-modal-title' });

        if (this.loading) {
            contentEl.createDiv({
                text: '加载中...',
                cls: 'nw-u-p-40px nw-u-ta-center nw-u-c-text-muted nw-u-fs-13px'
            });
            return;
        }

        const opsRow = contentEl.createDiv({
            cls: 'nw-u-d-flex nw-u-gap-8px nw-u-marginbottom-16px'
        });

        const operations = [
            { key: 'classify', label: '🏷️ 自动分类', desc: '自动识别书籍分类' },
        ];

        operations.forEach(op => {
            const btn = opsRow.createEl('button', {
                text: op.label,
                cls: `nw-btn ${this.operation === op.key ? 'nw-btn-primary' : 'nw-btn-secondary'}`,
                attr: { style: 'flex:1;padding:12px;text-align:left;' }
            });
            btn.addEventListener('click', () => {
                this.operation = op.key as any;
                this.render();
            });
        });

        const books = this.books;
        const uncategorizedCount = books.filter(b => !b.primaryGenre).length;

        const selectRow = contentEl.createDiv({
            cls: "nw-flex-between nw-u-marginbottom-12px", attr: {}
        });
        selectRow.createSpan({
            text: `共 ${books.length} 本书籍（未分类 ${uncategorizedCount} 本）`,
            cls: 'nw-text-sm-muted'
        });

        const selectBtns = selectRow.createDiv({ cls: 'nw-u-d-flex nw-u-gap-6px' });

        const selectAllBtn = selectBtns.createEl('button', {
            text: '全选',
            cls: 'nw-btn nw-btn-secondary nw-btn-xs',
        });
        selectAllBtn.addEventListener('click', () => {
            books.forEach(b => this.selectedBooks.add(b.id));
            this.render();
        });

        const selectUncategorizedBtn = selectBtns.createEl('button', {
            text: '选择未分类',
            cls: 'nw-btn nw-btn-secondary nw-btn-xs',
        });
        selectUncategorizedBtn.addEventListener('click', () => {
            this.selectedBooks.clear();
            books.filter(b => !b.primaryGenre).forEach(b => this.selectedBooks.add(b.id));
            this.render();
        });

        const clearBtn = selectBtns.createEl('button', {
            text: '清空',
            cls: 'nw-btn nw-btn-secondary nw-btn-xs',
        });
        clearBtn.addEventListener('click', () => {
            this.selectedBooks.clear();
            this.render();
        });

        const bookList = contentEl.createDiv({
            cls: 'nw-u-maxh-300px nw-u-ovy-auto nw-u-b-1px-solid-background-m nw-u-brd-6px'
        });

        if (books.length === 0) {
            bookList.createDiv({
                text: '暂无书籍',
                cls: 'nw-u-p-40px nw-u-ta-center nw-u-c-text-muted nw-u-fs-13px'
            });
        } else {
            books.forEach((book, idx) => {
                const isSelected = this.selectedBooks.has(book.id);
                const item = bookList.createDiv({
                    attr: {
                        style: `padding:8px 12px;display:flex;align-items:center;gap:8px;cursor:pointer;${idx < books.length - 1 ? 'border-bottom:1px solid var(--background-modifier-border);' : ''}${isSelected ? 'background:rgba(var(--interactive-accent-rgb),0.08);' : ''}`
                    }
                });
                item.addEventListener('click', () => {
                    if (isSelected) {
                        this.selectedBooks.delete(book.id);
                    } else {
                        this.selectedBooks.add(book.id);
                    }
                    this.render();
                });

                const checkbox = item.createSpan({
                    text: isSelected ? '☑' : '☐',
                    cls: "nw-flex-shrink-0 nw-u-fs-14px nw-u-w-16px", attr: {}
                });
                void checkbox;

                const info = item.createDiv({ cls: 'nw-u-flex-1 nw-u-minw-0' });
                info.createDiv({
                    text: book.name,
                    cls: "nw-ellipsis nw-u-fs-13px nw-u-c-text-normal", attr: {}
                });
                info.createDiv({
                    text: book.author || '未知作者',
                    cls: 'nw-text-muted-11'
                });

                const genreText = book.primaryGenre
                    ? this.getGenreLabel(book.primaryGenre, book.primarySubGenre)
                    : '未分类';
                item.createSpan({
                    text: genreText,
                    cls: 'nw-text-muted-11 nw-flex-shrink-0'
                });
            });
        }

        const actions = contentEl.createDiv({
            cls: "nw-flex-between nw-u-margintop-16px nw-u-paddingtop-12px nw-u-bt-1px-solid-background-m", attr: {}
        });

        actions.createSpan({
            text: `已选择 ${this.selectedBooks.size} 本`,
            cls: 'nw-text-sm-muted'
        });

        const btnGroup = actions.createDiv({ cls: 'nw-u-d-flex nw-u-gap-8px' });

        const cancelBtn = btnGroup.createEl('button', {
            text: '取消',
            cls: 'nw-btn nw-btn-secondary',
        });
        cancelBtn.addEventListener('click', () => this.close());

        const executeBtn = btnGroup.createEl('button', {
            text: this.processing ? '处理中...' : '执行',
            cls: 'nw-btn nw-btn-primary',
            attr: { disabled: this.selectedBooks.size === 0 || this.processing ? 'true' : null as any }
        });
        executeBtn.addEventListener('click', async () => {
            if (this.selectedBooks.size === 0 || this.processing) return;
            this.processing = true;
            this.render();

            try {
                if (this.operation === 'classify') {
                    new Notice(`正在分类 ${this.selectedBooks.size} 本书籍...`);
                    await this.kbManager?.classifyBatch(Array.from(this.selectedBooks));
                    new Notice(`✅ 批量分类完成`);
                }
                this.onCompleted();
                this.close();
            } catch (e) {
                log.error('批量操作失败:', e);
                new Notice('批量操作失败');
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
