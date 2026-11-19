/**
 * knowledge-section.ts — 设置页「写作知识库」分区
 *
 * 职责：知识库书卡列表、检索与状态筛选、批量导入、向量增强设置。
 * 来源：原 settings-tab.ts L2166-L3203（方法不连续，见清单）。
 */
import { Setting } from 'obsidian';
import { showErrorNotice, showSuccessNotice, showWarningNotice } from '@/ui/components/notice-helpers';
import { KnowledgeBaseManager, BookBasicInfo } from '@/services/knowledge-base-manager';
import { KnowledgeTagManager } from '@/engine/knowledge-tags';
import { DeconstructionScheduler } from '@/engine/deconstruction-scheduler';
import { BatchImportModal } from '@/ui/batch-import-modal';
import { KnowledgeMonitorModal } from '@/ui/knowledge-monitor-modal';
import { KnowledgeDetailModal } from '@/ui/knowledge-detail-modal';
import { RefillModal } from '@/ui/refill-modal';
import { kbKnowledgeBaseDir } from '@/shared/paths';
import { openKnowledgeFolder } from '@/ui/knowledge-folder-navigation';
import { ENGINE_NAMES } from '@/shared/engine-names';
import { createLogger } from '@/shared/logger';
import { OperationConfirmModal } from '@/ui/components/progress';
import { rebuildKnowledgeIndexWithConfirm } from '@/ui/knowledge-rebuild-action';
import { rebuildAllVectorsWithConfirm } from '@/ui/vector-rebuild-action';
import { SettingsSection } from './section-base';
import { describeSecretForInput } from '@/shared/secret-display';
import { t, getLocale } from '@/i18n';

const log = createLogger('SettingsTab');

/**
 * 知识分区。
 */
export class KnowledgeSection extends SettingsSection {
    /** 异步读盘分区：切回时可能已是旧数据 → 宿主显示统一刷新条 */
    readonly asyncLoad = true;

    private knowledgeBaseManager: KnowledgeBaseManager | null = null;
    private knowledgeTagManager: KnowledgeTagManager | null = null;
    private deconstructionScheduler: DeconstructionScheduler | null = null;
    private knowledgeBooks: BookBasicInfo[] = [];
    private knowledgeLoading = false;
    private knowledgeSearchKeyword = '';
    private knowledgeStatusFilter: string = 'all';
    /** 搜索框重建节流句柄：整分区 refresh 会销毁输入框，必须防抖 + 恢复焦点 */
    private knowledgeSearchTimer: ReturnType<typeof setTimeout> | null = null;

    /**
     * 渲染。
     * @param container - 容器元素
     */
    async render(container: HTMLElement): Promise<void> {
        const section = container.createEl('section');
        section.createEl('h3', { text: t('settings.knowledge.title') });

        section.createEl('p', {
            text: t('settings.knowledge.lead'),
            cls: 'setting-item-description'
        });

        this.renderVectorEnhancementSettings(section);

        if (this.knowledgeLoading) {
            section.createDiv({
                cls: 'nw-st-kb-loading',
                text: t('settings.knowledge.loading')
            });
            return;
        }

        if (!this.knowledgeBaseManager) {
            // 通过 EngineRegistry 获取共享实例（registry 已在初始化时赋值给 plugin.knowledgeBaseManager/knowledgeTagManager）
            // 避免多实例状态不同步
            this.knowledgeBaseManager = this.plugin.engineRegistry.get(ENGINE_NAMES.KNOWLEDGE_BASE_MANAGER);
            this.knowledgeTagManager = this.plugin.engineRegistry.get(ENGINE_NAMES.KNOWLEDGE_TAG_MANAGER);
            this.deconstructionScheduler = this.plugin.deconstructionScheduler ?? null;
            // registry 已在 initialize 阶段调用 init()，无需重复初始化
            await this.loadKnowledgeBooks();
        }

        // 知识库根目录以管理器实例为准（自定义 baseDir 时不再显示默认路径）
        const kbBaseDir = this.knowledgeBaseManager?.getBaseDir() ?? kbKnowledgeBaseDir();

        const toolbar = section.createDiv({ cls: 'nw-st-kb-toolbar' });

        new Setting(toolbar)
            .setName(t('settings.knowledge.pathName'))
            .setDesc(t('settings.knowledge.pathDesc'))
            .addText(text => text
                .setValue(`${kbBaseDir}/`)
                .setDisabled(true)
            )
            .addButton(btn => btn
                .setButtonText(t('settings.knowledge.openFolder'))
                .onClick(() => {
                    const dirPath = kbBaseDir;
                    const file = this.app.vault.getAbstractFileByPath(dirPath);
                    if (file) {
                        void openKnowledgeFolder(this.app, dirPath);
                    } else {
                        showWarningNotice(t('settings.knowledge.pathMissing'));
                    }
                }));

        const actionRow = toolbar.createDiv({ cls: 'nw-st-kb-actions' });

        const importBtn = actionRow.createEl('button', {
            text: t('settings.knowledge.importBtn'),
            cls: 'nw-st-kb-btn nw-st-kb-btn--primary nw-st-kb-btn--fw500',
            attr: {
                type: 'button',
                title: t('settings.knowledge.importTitle')
            }
        });
        importBtn.addEventListener('click', () => this.showBatchImportModal());

        const monitorBtn = actionRow.createEl('button', {
            text: t('settings.knowledge.monitorBtn'),
            cls: 'nw-st-kb-btn',
            attr: {
                type: 'button',
                title: t('settings.knowledge.monitorTitle')
            }
        });
        monitorBtn.addEventListener('click', () => this.showKnowledgeMonitorModal());

        const rebuildBtn = actionRow.createEl('button', {
            text: t('settings.knowledge.rebuildBtn'),
            cls: 'nw-st-kb-btn',
            attr: {
                type: 'button',
                title: t('settings.knowledge.rebuildTitle')
            }
        });
        rebuildBtn.addEventListener('click', () => rebuildKnowledgeIndexWithConfirm(this.app, this.plugin));

        const revectorizeBtn = actionRow.createEl('button', {
            text: t('settings.knowledge.revectorizeBtn'),
            cls: 'nw-st-kb-btn',
            attr: {
                type: 'button',
                title: t('settings.knowledge.revectorizeTitle')
            }
        });
        revectorizeBtn.addEventListener('click', () => rebuildAllVectorsWithConfirm(this.app, this.plugin));

        const filterBar = section.createDiv({
            cls: 'nw-st-kb-filters'
        });

        const searchRow = filterBar.createDiv({ cls: 'nw-st-kb-search-row' });

        // 选择器与 placeholder 必须用同一个值，否则重建后无法把焦点放回搜索框
        const searchPlaceholder = t('settings.knowledge.searchPlaceholder');
        const searchInput = searchRow.createEl('input', {
            cls: 'nw-st-kb-search-input',
            attr: {
                type: 'text',
                placeholder: searchPlaceholder,
                value: this.knowledgeSearchKeyword
            }
        });
        searchInput.addEventListener('input', (e) => {
            this.knowledgeSearchKeyword = (e.target as HTMLInputElement).value;
            // 宿主 refresh() 会清空并重建整个分区 → 每敲一个字符输入框就失焦。
            // 防抖到停顿后再重建，并在重建后把焦点/光标放回搜索框。
            if (this.knowledgeSearchTimer) clearTimeout(this.knowledgeSearchTimer);
            this.knowledgeSearchTimer = setTimeout(() => {
                this.knowledgeSearchTimer = null;
                const caret = this.knowledgeSearchKeyword.length;
                this.refresh();
                const next = document.querySelector<HTMLInputElement>(`input[placeholder="${searchPlaceholder}"]`);
                if (next) {
                    next.focus();
                    next.setSelectionRange(caret, caret);
                }
            }, 250);
        });

        const statusSelect = searchRow.createEl('select', {
            cls: 'nw-st-kb-status-select'
        });
        const statusOptions: { value: string; label: string }[] = [
            { value: 'all', label: t('settings.knowledge.statusAll') },
            { value: 'pending', label: t('settings.knowledge.statusPending') },
            { value: 'processing', label: t('settings.knowledge.statusProcessing') },
            { value: 'completed', label: t('settings.knowledge.statusCompleted') },
            { value: 'failed', label: t('settings.knowledge.statusFailed') },
        ];
        statusOptions.forEach(opt => {
            const option = statusSelect.createEl('option', { text: opt.label, attr: { value: opt.value } });
            if (this.knowledgeStatusFilter === opt.value) option.selected = true;
        });
        statusSelect.addEventListener('change', (e) => {
            this.knowledgeStatusFilter = (e.target as HTMLSelectElement).value;
            this.refresh();
        });

        const tagFilterRow = filterBar.createDiv({ cls: 'nw-st-kb-tag-row' });

        const themeFilterDiv = tagFilterRow.createDiv({ cls: 'nw-st-kb-tag-filter' });
        themeFilterDiv.createEl('span', { text: t('settings.knowledge.themeFilter'), cls: 'nw-st-kb-tag-label' });

        const techniqueFilterDiv = tagFilterRow.createDiv({ cls: 'nw-st-kb-tag-filter' });
        techniqueFilterDiv.createEl('span', { text: t('settings.knowledge.techniqueFilter'), cls: 'nw-st-kb-tag-label' });

        const filteredBooks = this.filterKnowledgeBooks();

        if (filteredBooks.length === 0) {
            const emptyState = section.createDiv({
                cls: 'nw-st-kb-empty'
            });
            emptyState.createEl('div', {
                text: '📚',
                cls: 'nw-st-kb-empty-icon'
            });
            emptyState.createEl('div', {
                text: this.knowledgeBooks.length === 0
                    ? t('settings.knowledge.emptyNone')
                    : t('settings.knowledge.emptyFiltered'),
                cls: 'nw-st-kb-empty-text'
            });
            if (this.knowledgeBooks.length === 0) {
                const emptyImportBtn = emptyState.createEl('button', {
                    text: t('settings.knowledge.emptyImportBtn'),
                    cls: 'nw-st-kb-btn nw-st-kb-btn--primary nw-st-kb-btn--lg',
                    attr: {
                        type: 'button'
                    }
                });
                emptyImportBtn.addEventListener('click', () => this.showBatchImportModal());
            }
            return;
        }

        const countRow = section.createDiv({ cls: 'nw-status-row' });
        countRow.createEl('span', {
            text: t('settings.knowledge.count', { count: filteredBooks.length }),
            cls: 'nw-st-kb-count'
        });

        const gridContainer = section.createDiv({
            cls: 'nw-st-kb-grid'
        });

        filteredBooks.forEach(book => {
            this.renderKnowledgeBookCard(gridContainer, book);
        });
    }

    private filterKnowledgeBooks(): BookBasicInfo[] {
        let books = [...this.knowledgeBooks];

        if (this.knowledgeSearchKeyword) {
            const kw = this.knowledgeSearchKeyword.toLowerCase();
            books = books.filter(book =>
                book.name.toLowerCase().includes(kw) ||
                (book.author?.toLowerCase().includes(kw)) ||
                book.themeTags.some(t => t.toLowerCase().includes(kw)) ||
                book.techniqueTags.some(t => t.toLowerCase().includes(kw)) ||
                book.customTags.some(t => t.toLowerCase().includes(kw))
            );
        }

        if (this.knowledgeStatusFilter !== 'all') {
            books = books.filter(book => book.breakdownStatus === this.knowledgeStatusFilter);
        }

        return books;
    }

    private renderKnowledgeBookCard(container: HTMLElement, book: BookBasicInfo): void {
        const card = container.createDiv({
            cls: 'nw-kb-book-card nw-st-kb-card'
        });

        card.addEventListener('click', () => {
            if (!this.knowledgeBaseManager) return;
            new KnowledgeDetailModal(this.app, book.id, this.knowledgeBaseManager, {
                deconstructionScheduler: this.deconstructionScheduler ?? undefined,
                plugin: this.plugin,
            }).open();
        });

        const actionsRow = card.createDiv({ cls: 'nw-kb-card-actions nw-st-kb-card-actions' });

        const retryBtn = actionsRow.createEl('button', {
            text: t('settings.knowledge.retryBtn'),
            cls: 'nw-st-kb-mini-btn',
            attr: {
                type: 'button',
                title: t('settings.knowledge.retryTitle')
            }
        });
        retryBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!this.knowledgeBaseManager || !this.deconstructionScheduler) return;
            new RefillModal(this.app, {
                    type: 'knowledge',
                    bookId: book.id,
                    bookName: book.name,
                    knowledgeBaseManager: this.knowledgeBaseManager,
                    deconstructionScheduler: this.deconstructionScheduler,
                }).open();
        });

        const deleteBtn = actionsRow.createEl('button', {
            text: t('settings.knowledge.deleteBtn'),
            cls: 'nw-st-kb-mini-btn nw-st-kb-mini-btn--danger',
            attr: {
                type: 'button',
                title: t('settings.knowledge.deleteTitle')
            }
        });
        deleteBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const confirmed = await OperationConfirmModal.confirm(this.app, {
                title: t('settings.knowledge.deleteConfirmTitle'),
                description: t('settings.knowledge.deleteConfirmDesc', { name: book.name }),
                warning: t('settings.knowledge.deleteConfirmWarning'),
                confirmText: t('settings.knowledge.deleteConfirmOk'),
                cancelText: t('common.cancel'),
            });
            if (!confirmed) return;
            if (this.knowledgeBaseManager) {
                // 先取消在途拆解，避免任务结束后把已删除的书目录/向量重新写回来
                await this.plugin.deconstructionScheduler?.cancelByBook(book.id);
                await this.knowledgeBaseManager.deleteBook(book.id);
                await this.loadKnowledgeBooks();
                this.refresh();
                showSuccessNotice(t('settings.knowledge.deletedNotice', { name: book.name }));
            }
        });

        const titleRow = card.createDiv({ cls: 'nw-st-kb-card-title-row' });
        titleRow.createEl('div', {
            text: book.name,
            cls: 'nw-st-kb-card-name'
        });

        if (book.author) {
            titleRow.createEl('div', {
                text: book.author,
                cls: 'nw-st-kb-card-author'
            });
        }

        const statusBadge = this.getStatusBadge(book.breakdownStatus);
        card.appendChild(statusBadge);

        const allTags = [...book.themeTags, ...book.techniqueTags, ...book.customTags];
        if (allTags.length > 0) {
            const tagRow = card.createDiv({
                cls: 'nw-st-kb-tags'
            });
            const displayTags = allTags.slice(0, 3);
            displayTags.forEach(tag => {
                tagRow.createEl('span', {
                    text: tag,
                    cls: 'nw-st-kb-tag'
                });
            });
            if (allTags.length > 3) {
                tagRow.createEl('span', {
                    text: `+${allTags.length - 3}`,
                    cls: 'nw-st-kb-tag nw-st-kb-tag--more'
                });
            }
        }

        const metaRow = card.createDiv({
            cls: 'nw-st-kb-meta'
        });

        if (book.wordCount) {
            metaRow.createEl('span', { text: `📝 ${this.formatKbWordCount(book.wordCount)}` });
        }

        const dateStr = new Date(book.updatedAt).toLocaleDateString(getLocale() === 'en-US' ? 'en-US' : 'zh-CN');
        metaRow.createEl('span', { text: `🕐 ${dateStr}` });
    }

    private getStatusBadge(status: string): HTMLElement {
        // 状态徽标：配色与底色全部交给 nw-st-kb-badge--<状态> 修饰类（Slice U）
        const statusMap: Record<string, { label: string; tone: string }> = {
            pending: { label: t('settings.knowledge.statusPending'), tone: 'pending' },
            processing: { label: t('settings.knowledge.statusProcessing'), tone: 'processing' },
            completed: { label: t('settings.knowledge.statusCompleted'), tone: 'completed' },
            failed: { label: t('settings.knowledge.statusFailed'), tone: 'failed' },
        };

        const info = statusMap[status] || statusMap.pending;
        const badge = createDiv({
            cls: `nw-st-kb-badge nw-st-kb-badge--${info.tone}`,
            text: info.label
        });
        return badge;
    }

    private formatKbWordCount(count: number): string {
        if (count >= 10000) {
            const wan = count / 10000;
            return t('settings.knowledge.wordCountWan', { n: wan % 1 === 0 ? String(wan) : wan.toFixed(1) });
        }
        return t('settings.knowledge.wordCount', { n: count });
    }

    private async loadKnowledgeBooks(): Promise<void> {
        if (!this.knowledgeBaseManager) return;
        this.knowledgeLoading = true;
        try {
            this.knowledgeBooks = await this.knowledgeBaseManager.getAllBooks();
        } catch (e) {
            log.warn('[SettingsTab] 加载知识库失败:', e);
        } finally {
            this.knowledgeLoading = false;
        }
    }

    private showBatchImportModal(): void {
        if (!this.knowledgeBaseManager || !this.knowledgeTagManager || !this.deconstructionScheduler) return;
        new BatchImportModal(this.app, {
            knowledgeBaseManager: this.knowledgeBaseManager,
            deconstructionScheduler: this.deconstructionScheduler,
            tagManager: this.knowledgeTagManager,
            engineRegistry: this.plugin.engineRegistry,
            onComplete: async () => {
                await this.loadKnowledgeBooks();
                this.refresh();
            },
            onViewDetail: (bookId, bookName) => {
                const book = this.knowledgeBooks?.find(b => b.id === bookId || b.name === bookName);
                if (book) {
                    new KnowledgeDetailModal(this.app, book.id, this.knowledgeBaseManager!, {
                        deconstructionScheduler: this.deconstructionScheduler!,
                        plugin: this.plugin,
                    }).open();
                }
            }
        }).open();
    }

    private showKnowledgeMonitorModal(): void {
        if (!this.deconstructionScheduler || !this.knowledgeBaseManager) return;
        new KnowledgeMonitorModal(this.app, this.deconstructionScheduler, this.knowledgeBaseManager).open();
    }

    private vectorConnectionStatus: 'idle' | 'checking' | 'connected' | 'disconnected' = 'idle';

    private renderVectorEnhancementSettings(container: HTMLElement): void {
        const vectorSection = container.createDiv({
            cls: 'nw-st-kb-vector'
        });

        vectorSection.createEl('h4', {
            text: t('settings.knowledge.vectorTitle'),
            cls: 'nw-st-kb-vector-title'
        });

        new Setting(vectorSection)
            .setName(t('settings.knowledge.vectorEnhanceName'))
            .setDesc(t('settings.knowledge.vectorEnhanceDesc'))
            .addToggle(toggle => {
                toggle.setValue(this.plugin.settings.vectorEnhancedDeconstruction ?? true);
                toggle.onChange(async (value) => {
                    this.plugin.settings.vectorEnhancedDeconstruction = value;
                    await this.plugin.saveSettings();
                });
            });

        new Setting(vectorSection)
            .setName(t('settings.knowledge.thresholdName'))
            .setDesc(t('settings.knowledge.thresholdDesc', { value: (this.plugin.settings.vectorDeconstructionThreshold ?? 0.3).toFixed(2) }))
            .addSlider(slider => {
                slider.setLimits(0.1, 0.9, 0.05);
                slider.setValue(this.plugin.settings.vectorDeconstructionThreshold ?? 0.3);
                slider.setDynamicTooltip();
                slider.onChange(async (value) => {
                    this.plugin.settings.vectorDeconstructionThreshold = value;
                    const descEl = slider.sliderEl.closest('.setting-item')?.querySelector('.setting-item-description');
                    if (descEl) {
                        descEl.textContent = t('settings.knowledge.thresholdDesc', { value: value.toFixed(2) });
                    }
                    await this.plugin.saveSettings();
                });
            });

        const providerSetting = new Setting(vectorSection)
            .setName(t('settings.knowledge.providerName'))
            .setDesc(t('settings.knowledge.providerDesc'))
            .addDropdown(dropdown => {
                dropdown.addOption('ollama', t('settings.knowledge.providerOllama'));
                dropdown.addOption('openai', t('settings.knowledge.providerOpenai'));
                dropdown.addOption('doubao', t('settings.knowledge.providerDoubao'));
                dropdown.addOption('qwen', t('settings.knowledge.providerQwen'));
                dropdown.setValue(this.plugin.settings.vectorProviderType || 'ollama');
                dropdown.onChange(async (value) => {
                    this.plugin.settings.vectorProviderType = value as 'ollama' | 'openai' | 'doubao' | 'qwen';
                    await this.plugin.saveSettings();
                    this.refresh();
                });
            });

        new Setting(vectorSection)
            .setName(t('settings.knowledge.fallbackName'))
            .setDesc(t('settings.knowledge.fallbackDesc'))
            .addDropdown(dropdown => {
                dropdown.addOption('local-only', t('settings.knowledge.fallbackLocal'));
                dropdown.addOption('never', t('settings.knowledge.fallbackNever'));
                dropdown.addOption('allow-cloud', t('settings.knowledge.fallbackCloud'));
                dropdown.setValue(this.plugin.settings.embeddingFallbackPolicy || 'local-only');
                dropdown.onChange(async (value) => {
                    this.plugin.settings.embeddingFallbackPolicy = value as 'never' | 'local-only' | 'allow-cloud';
                    await this.plugin.saveSettings();
                });
            });

        const providerType = this.plugin.settings.vectorProviderType || 'ollama';

        if (providerType === 'ollama') {
            new Setting(vectorSection)
                .setName(t('settings.knowledge.ollamaEndpoint'))
                .setDesc(t('settings.knowledge.ollamaEndpointDesc'))
                .addText(text => {
                    text.setValue(this.plugin.settings.vectorOllamaBaseUrl || 'http://localhost:11434');
                    text.setPlaceholder('http://localhost:11434');
                    text.onChange(async (value) => {
                        this.plugin.settings.vectorOllamaBaseUrl = value;
                        await this.plugin.saveSettings();
                    });
                });

            new Setting(vectorSection)
                .setName(t('settings.knowledge.ollamaModel'))
                .setDesc(t('settings.knowledge.ollamaModelDesc'))
                .addText(text => {
                    text.setValue(this.plugin.settings.vectorOllamaModel || 'bge-m3');
                    text.setPlaceholder('bge-m3');
                    text.onChange(async (value) => {
                        this.plugin.settings.vectorOllamaModel = value;
                        await this.plugin.saveSettings();
                    });
                });
        }

        if (providerType === 'openai') {
            new Setting(vectorSection)
                .setName(t('settings.knowledge.endpointName'))
                .setDesc(t('settings.knowledge.openaiEndpointDesc'))
                .addText(text => {
                    text.setValue(this.plugin.settings.vectorOpenaiBaseUrl || 'https://ark.cn-beijing.volces.com/api/v3');
                    text.setPlaceholder('https://api.openai.com/v1');
                    text.onChange(async (value) => {
                        this.plugin.settings.vectorOpenaiBaseUrl = value;
                        await this.plugin.saveSettings();
                    });
                });

            new Setting(vectorSection)
                .setName(t('settings.knowledge.modelName'))
                .setDesc(t('settings.knowledge.openaiModelDesc'))
                .addText(text => {
                    text.setValue(this.plugin.settings.vectorOpenaiModel || 'doubao-embedding-text-240915');
                    text.setPlaceholder('text-embedding-3-small');
                    text.onChange(async (value) => {
                        this.plugin.settings.vectorOpenaiModel = value;
                        await this.plugin.saveSettings();
                    });
                });

            new Setting(vectorSection)
                .setName(t('settings.knowledge.apiKeyName'))
                .setDesc(t('settings.knowledge.openaiKeyDesc'))
                .addText(text => {
                    text.inputEl.type = 'password';
                    const secretDisplay = describeSecretForInput(this.plugin.settings.vectorOpenaiApiKey || '');
                    text.setValue(secretDisplay.value);
                    text.setPlaceholder(secretDisplay.placeholder || t('settings.knowledge.keyPlaceholder'));
                    text.inputEl.title = secretDisplay.title;
                    // 空值 = 未修改：加密锁定态输入框为空，写回会抹掉已加密密钥
                    text.inputEl.addEventListener('change', () => {
                        const next = text.inputEl.value.trim();
                        if (!next) return;
                        this.plugin.settings.vectorOpenaiApiKey = next;
                        void this.plugin.saveSettings().catch((e: unknown) => {
                            showErrorNotice(e instanceof Error ? e.message : String(e), { title: t('settings.knowledge.keySaveFailed'), timeout: 6000 });
                        });
                    });
                    const toggleBtn = text.inputEl.parentElement?.createEl('button', {
                        text: '👁',
                        cls: 'novel-writer-key-toggle',
                        attr: { type: 'button', title: t('settings.knowledge.keyToggle') },
                    });
                    if (toggleBtn) {
                        toggleBtn.addClass('nw-kb-toggle-btn');
                        toggleBtn.addEventListener('click', () => {
                            text.inputEl.type = text.inputEl.type === 'password' ? 'text' : 'password';
                            toggleBtn.textContent = text.inputEl.type === 'password' ? '👁' : '🙈';
                        });
                    }
                });
        }

        if (providerType === 'doubao') {
            new Setting(vectorSection)
                .setName(t('settings.knowledge.endpointName'))
                .setDesc(t('settings.knowledge.doubaoEndpointDesc'))
                .addText(text => {
                    text.setValue(this.plugin.settings.vectorDoubaoBaseUrl || 'https://ark.cn-beijing.volces.com/api/v3');
                    text.setPlaceholder('https://ark.cn-beijing.volces.com/api/v3');
                    text.onChange(async (value) => {
                        this.plugin.settings.vectorDoubaoBaseUrl = value;
                        await this.plugin.saveSettings();
                    });
                });

            new Setting(vectorSection)
                .setName(t('settings.knowledge.modelName'))
                .setDesc(t('settings.knowledge.doubaoModelDesc'))
                .addText(text => {
                    text.setValue(this.plugin.settings.vectorDoubaoModel || 'doubao-embedding-text-240915');
                    text.setPlaceholder('doubao-embedding-text-240915');
                    text.onChange(async (value) => {
                        this.plugin.settings.vectorDoubaoModel = value;
                        await this.plugin.saveSettings();
                    });
                });

            new Setting(vectorSection)
                .setName(t('settings.knowledge.apiKeyName'))
                .setDesc(t('settings.knowledge.doubaoKeyDesc'))
                .addText(text => {
                    text.inputEl.type = 'password';
                    const secretDisplay = describeSecretForInput(this.plugin.settings.vectorDoubaoApiKey || '');
                    text.setValue(secretDisplay.value);
                    text.setPlaceholder(secretDisplay.placeholder || t('settings.knowledge.keyPlaceholder'));
                    text.inputEl.title = secretDisplay.title;
                    // 空值 = 未修改：加密锁定态输入框为空，写回会抹掉已加密密钥
                    text.inputEl.addEventListener('change', () => {
                        const next = text.inputEl.value.trim();
                        if (!next) return;
                        this.plugin.settings.vectorDoubaoApiKey = next;
                        void this.plugin.saveSettings().catch((e: unknown) => {
                            showErrorNotice(e instanceof Error ? e.message : String(e), { title: t('settings.knowledge.keySaveFailed'), timeout: 6000 });
                        });
                    });
                    const toggleBtn = text.inputEl.parentElement?.createEl('button', {
                        text: '👁',
                        cls: 'novel-writer-key-toggle',
                        attr: { type: 'button', title: t('settings.knowledge.keyToggle') },
                    });
                    if (toggleBtn) {
                        toggleBtn.addClass('nw-kb-toggle-btn');
                        toggleBtn.addEventListener('click', () => {
                            text.inputEl.type = text.inputEl.type === 'password' ? 'text' : 'password';
                            toggleBtn.textContent = text.inputEl.type === 'password' ? '👁' : '🙈';
                        });
                    }
                });
        }

        if (providerType === 'qwen') {
            new Setting(vectorSection)
                .setName(t('settings.knowledge.endpointName'))
                .setDesc(t('settings.knowledge.qwenEndpointDesc'))
                .addText(text => {
                    text.setValue(this.plugin.settings.vectorQwenBaseUrl || 'https://dashscope.aliyuncs.com/compatible-mode/v1');
                    text.setPlaceholder('https://dashscope.aliyuncs.com/compatible-mode/v1');
                    text.onChange(async (value) => {
                        this.plugin.settings.vectorQwenBaseUrl = value;
                        await this.plugin.saveSettings();
                    });
                });

            new Setting(vectorSection)
                .setName(t('settings.knowledge.modelName'))
                .setDesc(t('settings.knowledge.qwenModelDesc'))
                .addText(text => {
                    text.setValue(this.plugin.settings.vectorQwenModel || 'text-embedding-v3');
                    text.setPlaceholder('text-embedding-v3');
                    text.onChange(async (value) => {
                        this.plugin.settings.vectorQwenModel = value;
                        await this.plugin.saveSettings();
                    });
                });

            new Setting(vectorSection)
                .setName(t('settings.knowledge.apiKeyName'))
                .setDesc(t('settings.knowledge.qwenKeyDesc'))
                .addText(text => {
                    text.inputEl.type = 'password';
                    const secretDisplay = describeSecretForInput(this.plugin.settings.vectorQwenApiKey || '');
                    text.setValue(secretDisplay.value);
                    text.setPlaceholder(secretDisplay.placeholder || t('settings.knowledge.keyPlaceholder'));
                    text.inputEl.title = secretDisplay.title;
                    // 空值 = 未修改：加密锁定态输入框为空，写回会抹掉已加密密钥
                    text.inputEl.addEventListener('change', () => {
                        const next = text.inputEl.value.trim();
                        if (!next) return;
                        this.plugin.settings.vectorQwenApiKey = next;
                        void this.plugin.saveSettings().catch((e: unknown) => {
                            showErrorNotice(e instanceof Error ? e.message : String(e), { title: t('settings.knowledge.keySaveFailed'), timeout: 6000 });
                        });
                    });
                    const toggleBtn = text.inputEl.parentElement?.createEl('button', {
                        text: '👁',
                        cls: 'novel-writer-key-toggle',
                        attr: { type: 'button', title: t('settings.knowledge.keyToggle') },
                    });
                    if (toggleBtn) {
                        toggleBtn.addClass('nw-kb-toggle-btn');
                        toggleBtn.addEventListener('click', () => {
                            text.inputEl.type = text.inputEl.type === 'password' ? 'text' : 'password';
                            toggleBtn.textContent = text.inputEl.type === 'password' ? '👁' : '🙈';
                        });
                    }
                });
        }

        // 圆点/文字配色走修饰类（Slice U）：旧的动态内联 color/background 已删除
        const statusLabels: Record<string, string> = {
            idle: t('settings.knowledge.statusIdle'),
            checking: t('settings.knowledge.statusChecking'),
            connected: t('settings.knowledge.statusConnected'),
            disconnected: t('settings.knowledge.statusDisconnected'),
        };

        let statusDot: HTMLElement | null = null;
        let statusText: HTMLElement | null = null;

        const updateStatusDisplay = () => {
            if (statusDot && statusText) {
                const tone = this.vectorConnectionStatus;
                statusDot.className = `nw-st-kb-dot nw-st-kb-dot--${tone}`;
                statusText.className = `nw-st-kb-status-text nw-st-kb-status-text--${tone}`;
                statusText.textContent = statusLabels[tone] || t('settings.knowledge.statusIdle');
            }
        };

        const statusSetting = new Setting(vectorSection)
            .setName(t('settings.knowledge.connectionName'))
            .setDesc(t('settings.knowledge.connectionDesc'))
            .addButton(btn => {
                btn
                    .setButtonText(t('settings.knowledge.checkBtn'))
                    .onClick(async () => {
                        if (this.vectorConnectionStatus === 'checking') return;
                        this.vectorConnectionStatus = 'checking';
                        updateStatusDisplay();
                        try {
                            const { EmbeddingProviderFactory } = await import('@/engine/embedding/provider-factory');
                            const provider = EmbeddingProviderFactory.create({
                                vectorProviderType: this.plugin.settings.vectorProviderType as 'ollama' | 'openai' | 'doubao' | 'qwen',
                                vectorOllamaBaseUrl: this.plugin.settings.vectorOllamaBaseUrl,
                                vectorOllamaModel: this.plugin.settings.vectorOllamaModel,
                                vectorOpenaiBaseUrl: this.plugin.settings.vectorOpenaiBaseUrl,
                                vectorOpenaiModel: this.plugin.settings.vectorOpenaiModel,
                                vectorOpenaiApiKey: this.plugin.settings.vectorOpenaiApiKey,
                                vectorDoubaoBaseUrl: this.plugin.settings.vectorDoubaoBaseUrl,
                                vectorDoubaoModel: this.plugin.settings.vectorDoubaoModel,
                                vectorDoubaoApiKey: this.plugin.settings.vectorDoubaoApiKey,
                                vectorQwenBaseUrl: this.plugin.settings.vectorQwenBaseUrl,
                                vectorQwenModel: this.plugin.settings.vectorQwenModel,
                                vectorQwenApiKey: this.plugin.settings.vectorQwenApiKey,
                            });
                            const result = await provider.isAvailable();
                            this.vectorConnectionStatus = result.available ? 'connected' : 'disconnected';
                            if (result.reason && !result.available) {
                                log.warn('[VectorSettings] 连接检测失败:', result.reason);
                            }
                        } catch (e) {
                            log.warn('[VectorSettings] 连接检测异常:', e);
                            this.vectorConnectionStatus = 'disconnected';
                        }
                        updateStatusDisplay();
                        if (this.vectorConnectionStatus === 'connected') {
                            showSuccessNotice(t('settings.knowledge.checkOk'));
                        } else {
                            showErrorNotice(t('settings.knowledge.checkFail'), { title: t('settings.knowledge.checkFailTitle') });
                        }
                    });
            });

        const statusDesc = statusSetting.descEl;
        if (statusDesc) {
            statusDesc.addClass('nw-kb-status-desc');
            statusDot = statusDesc.createSpan({
                cls: `nw-st-kb-dot nw-st-kb-dot--${this.vectorConnectionStatus}`
            });
            statusText = statusDesc.createSpan({
                text: statusLabels[this.vectorConnectionStatus],
                cls: `nw-st-kb-status-text nw-st-kb-status-text--${this.vectorConnectionStatus}`
            });
        }
    }
}
