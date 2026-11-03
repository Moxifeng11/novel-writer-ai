/**
 * knowledge-section.ts — 设置页「写作知识库」分区
 *
 * 职责：知识库书卡列表、检索与状态筛选、批量导入、向量增强设置。
 * 来源：原 settings-tab.ts L2166-L3203（方法不连续，见清单）。
 */
import { Setting, Notice } from 'obsidian';
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

const log = createLogger('SettingsTab');

/**
 * 知识分区。
 */
export class KnowledgeSection extends SettingsSection {
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
        section.createEl('h3', { text: '📚 写作知识库' });

        section.createEl('p', {
            text: '管理你的写作知识库，导入小说进行深度拆解分析，提取写作技巧、结构、人设等宝贵经验。',
            cls: 'setting-item-description'
        });

        this.renderVectorEnhancementSettings(section);

        if (this.knowledgeLoading) {
            section.createDiv({
                cls: 'nw-u-p-40px-2 nw-u-ta-center-2 nw-u-c-text-faint-2 nw-u-fs-13px-2',
                text: '加载中...'
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

        const toolbar = section.createDiv({ cls: 'nw-u-marginbottom-16px-2' });

        new Setting(toolbar)
            .setName('知识库路径')
            .setDesc('知识库文件在 Vault 中的存储位置')
            .addText(text => text
                .setValue('写作知识库/')
                .setDisabled(true)
            )
            .addButton(btn => btn
                .setButtonText('打开')
                .onClick(() => {
                    const dirPath = kbKnowledgeBaseDir();
                    const file = this.app.vault.getAbstractFileByPath(dirPath);
                    if (file) {
                        void openKnowledgeFolder(this.app, dirPath);
                    } else {
                        new Notice('⚠️ 知识库目录不存在，请先导入书籍');
                    }
                }));

        const actionRow = toolbar.createDiv({ cls: 'nw-u-d-flex-2 nw-u-gap-8px-2 nw-u-margintop-8px-2 nw-u-marginbottom-16px-2' });

        const importBtn = actionRow.createEl('button', {
            text: '📥 批量导入',
            attr: {
                type: 'button',
                title: '从文件夹批量导入书籍',
                style: 'padding:6px 16px;cursor:pointer;background:var(--interactive-accent);color:var(--text-on-accent);border:none;border-radius:4px;font-size:13px;font-weight:500;'
            }
        });
        importBtn.addEventListener('click', () => this.showBatchImportModal());

        const monitorBtn = actionRow.createEl('button', {
            text: '📊 监控面板',
            attr: {
                type: 'button',
                title: '查看拆解任务监控面板',
                style: 'padding:6px 16px;cursor:pointer;border:1px solid var(--background-modifier-border);border-radius:4px;font-size:13px;background:var(--background-primary);'
            }
        });
        monitorBtn.addEventListener('click', () => this.showKnowledgeMonitorModal());

        const rebuildBtn = actionRow.createEl('button', {
            text: '🔄 重建索引',
            attr: {
                type: 'button',
                title: '重建向量索引（重新扫描所有向量文件）',
                style: 'padding:6px 16px;cursor:pointer;border:1px solid var(--background-modifier-border);border-radius:4px;font-size:13px;background:var(--background-primary);'
            }
        });
        rebuildBtn.addEventListener('click', () => rebuildKnowledgeIndexWithConfirm(this.app, this.plugin));

        const revectorizeBtn = actionRow.createEl('button', {
            text: '🧠 重向量化',
            attr: {
                type: 'button',
                title: '按当前向量提供商重新计算知识库与指纹向量（不调用 AI、不重新拆解）',
                style: 'padding:6px 16px;cursor:pointer;border:1px solid var(--background-modifier-border);border-radius:4px;font-size:13px;background:var(--background-primary);'
            }
        });
        revectorizeBtn.addEventListener('click', () => rebuildAllVectorsWithConfirm(this.app, this.plugin));

        const filterBar = section.createDiv({
            cls: 'nw-u-p-12px-2 nw-u-b-1px-solid-background-m-2 nw-u-brd-6px-2 nw-u-marginbottom-16px-2 nw-u-bg-background-secondary-2'
        });

        const searchRow = filterBar.createDiv({ cls: 'nw-u-d-flex-2 nw-u-gap-8px-2 nw-u-marginbottom-10px-2 nw-u-fwr-wrap-2' });

        const searchInput = searchRow.createEl('input', {
            attr: {
                type: 'text',
                placeholder: '🔍 搜索书名/作者/标签...',
                value: this.knowledgeSearchKeyword,
                style: 'flex:1;min-width:200px;padding:6px 10px;border:1px solid var(--background-modifier-border);border-radius:4px;font-size:13px;background:var(--background-primary);color:var(--text-normal);'
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
                const next = document.querySelector<HTMLInputElement>('input[placeholder="🔍 搜索书名/作者/标签..."]');
                if (next) {
                    next.focus();
                    next.setSelectionRange(caret, caret);
                }
            }, 250);
        });

        const statusSelect = searchRow.createEl('select', {
            cls: 'nw-u-p-6px-10px-2 nw-u-b-1px-solid-background-m-2 nw-u-brd-4px-2 nw-u-fs-13px-2 nw-u-bg-background-primary-2 nw-u-c-text-normal-2'
        });
        const statusOptions: { value: string; label: string }[] = [
            { value: 'all', label: '全部状态' },
            { value: 'pending', label: '待拆解' },
            { value: 'processing', label: '拆解中' },
            { value: 'completed', label: '已完成' },
            { value: 'failed', label: '失败' },
        ];
        statusOptions.forEach(opt => {
            const option = statusSelect.createEl('option', { text: opt.label, attr: { value: opt.value } });
            if (this.knowledgeStatusFilter === opt.value) option.selected = true;
        });
        statusSelect.addEventListener('change', (e) => {
            this.knowledgeStatusFilter = (e.target as HTMLSelectElement).value;
            this.refresh();
        });

        const tagFilterRow = filterBar.createDiv({ cls: 'nw-u-d-flex-2 nw-u-gap-12px-2 nw-u-fwr-wrap-2' });

        const themeFilterDiv = tagFilterRow.createDiv({ cls: 'nw-u-flex-1-2 nw-u-minw-200px-2' });
        themeFilterDiv.createEl('span', { text: '📖 题材：全部', cls: 'nw-u-fs-12px-2 nw-u-c-text-muted-2 nw-u-marginright-8px' });

        const techniqueFilterDiv = tagFilterRow.createDiv({ cls: 'nw-u-flex-1-2 nw-u-minw-200px-2' });
        techniqueFilterDiv.createEl('span', { text: '✍️ 技巧：全部', cls: 'nw-u-fs-12px-2 nw-u-c-text-muted-2 nw-u-marginright-8px' });

        const filteredBooks = this.filterKnowledgeBooks();

        if (filteredBooks.length === 0) {
            const emptyState = section.createDiv({
                cls: 'nw-u-p-60px-20px nw-u-ta-center-2 nw-u-b-1px-dashed-background- nw-u-brd-8px-2 nw-u-bg-background-secondary-2'
            });
            emptyState.createEl('div', {
                text: '📚',
                cls: 'nw-u-fs-48px nw-u-marginbottom-16px-2 nw-u-op-0-5'
            });
            emptyState.createEl('div', {
                text: this.knowledgeBooks.length === 0
                    ? '知识库暂无书籍，点击上方「批量导入」开始添加'
                    : '没有符合筛选条件的书籍',
                cls: 'nw-u-fs-14px-2 nw-u-c-text-muted-2 nw-u-marginbottom-8px-2'
            });
            if (this.knowledgeBooks.length === 0) {
                const emptyImportBtn = emptyState.createEl('button', {
                    text: '📥 批量导入书籍',
                    attr: {
                        type: 'button',
                        style: 'padding:8px 20px;cursor:pointer;background:var(--interactive-accent);color:var(--text-on-accent);border:none;border-radius:4px;font-size:13px;margin-top:8px;'
                    }
                });
                emptyImportBtn.addEventListener('click', () => this.showBatchImportModal());
            }
            return;
        }

        const countRow = section.createDiv({ cls: 'nw-status-row' });
        countRow.createEl('span', {
            text: `共 ${filteredBooks.length} 本书籍`,
            cls: 'nw-u-fs-13px-2 nw-u-c-text-muted-2'
        });

        const gridContainer = section.createDiv({
            cls: 'nw-u-d-grid-2 nw-u-gtc-repeat-auto-fill-minma-4 nw-u-gap-12px-2 nw-u-maxh-500px nw-u-ovy-auto-2 nw-u-p-4px'
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
            cls: 'nw-u-p-14px-2 nw-u-b-1px-solid-background-m-2 nw-u-brd-8px-2 nw-u-bg-background-primary-2 nw-u-cur-pointer-2 nw-u-transition-all-0-2s-ease nw-u-pos-relative nw-u-ov-hidden-2'
        });

        card.addEventListener('mouseenter', () => {
            card.style.borderColor = 'var(--interactive-accent)';
            card.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
            const actions = card.querySelector('.kb-card-actions') as HTMLElement;
            if (actions) actions.style.opacity = '1';
        });
        card.addEventListener('mouseleave', () => {
            card.style.borderColor = 'var(--background-modifier-border)';
            card.style.boxShadow = 'none';
            const actions = card.querySelector('.kb-card-actions') as HTMLElement;
            if (actions) actions.style.opacity = '0';
        });

        card.addEventListener('click', () => {
            if (!this.knowledgeBaseManager) return;
            new KnowledgeDetailModal(this.app, book.id, this.knowledgeBaseManager, {
                deconstructionScheduler: this.deconstructionScheduler ?? undefined
            }).open();
        });

        const actionsRow = card.createDiv({
            cls: "kb-card-actions nw-u-pos-absolute nw-u-t-8px nw-u-r-8px nw-u-d-flex-2 nw-u-gap-4px-2 nw-u-op-0 nw-u-transition-opacity-0-2s-ease nw-u-z-10",
            attr: {}
        });

        const retryBtn = actionsRow.createEl('button', {
            text: '🔄 重拆',
            attr: {
                type: 'button',
                title: '重新拆解',
                style: 'padding:4px 8px;cursor:pointer;border:1px solid var(--background-modifier-border);border-radius:4px;font-size:12px;background:var(--background-secondary);'
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
            text: '🗑 删除',
            attr: {
                type: 'button',
                title: '删除',
                style: 'padding:4px 8px;cursor:pointer;border:1px solid var(--background-modifier-error);border-radius:4px;font-size:12px;background:var(--background-secondary);color:var(--text-error);'
            }
        });
        deleteBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const confirmed = await OperationConfirmModal.confirm(this.app, {
                title: '删除书籍',
                description: `确定要删除《${book.name}》吗？`,
                warning: '此操作不可恢复',
                confirmText: '确认删除',
                cancelText: '取消',
            });
            if (!confirmed) return;
            if (this.knowledgeBaseManager) {
                // 先取消在途拆解，避免任务结束后把已删除的书目录/向量重新写回来
                await this.plugin.deconstructionScheduler?.cancelByBook(book.id);
                await this.knowledgeBaseManager.deleteBook(book.id);
                await this.loadKnowledgeBooks();
                this.refresh();
                new Notice(`已删除「${book.name}」`);
            }
        });

        const titleRow = card.createDiv({ cls: 'nw-u-marginbottom-6px-2 nw-u-paddingright-60px' });
        titleRow.createEl('div', {
            text: book.name,
            cls: 'nw-u-fs-15px-2 nw-u-fwt-600-2 nw-u-c-text-normal-2 nw-u-lh-1-4-2'
        });

        if (book.author) {
            titleRow.createEl('div', {
                text: book.author,
                cls: 'nw-u-fs-12px-2 nw-u-c-text-muted-2 nw-u-margintop-2px-2'
            });
        }

        const statusBadge = this.getStatusBadge(book.breakdownStatus);
        card.appendChild(statusBadge);

        const allTags = [...book.themeTags, ...book.techniqueTags, ...book.customTags];
        if (allTags.length > 0) {
            const tagRow = card.createDiv({
                cls: 'nw-u-d-flex-2 nw-u-gap-4px-2 nw-u-fwr-wrap-2 nw-u-m-10px-0'
            });
            const displayTags = allTags.slice(0, 3);
            displayTags.forEach(tag => {
                tagRow.createEl('span', {
                    text: tag,
                    cls: 'nw-u-p-2px-8px-2 nw-u-bg-background-secondary-2 nw-u-brd-10px-2 nw-u-fs-11px-2 nw-u-c-text-muted-2'
                });
            });
            if (allTags.length > 3) {
                tagRow.createEl('span', {
                    text: `+${allTags.length - 3}`,
                    cls: 'nw-u-p-2px-8px-2 nw-u-bg-background-secondary-2 nw-u-brd-10px-2 nw-u-fs-11px-2 nw-u-c-text-faint-2'
                });
            }
        }

        const metaRow = card.createDiv({
            cls: 'nw-u-d-flex-2 nw-u-gap-12px-2 nw-u-fs-11px-2 nw-u-c-text-faint-2 nw-u-paddingtop-8px-2 nw-u-bt-1px-solid-background-m-2'
        });

        if (book.wordCount) {
            metaRow.createEl('span', { text: `📝 ${this.formatKbWordCount(book.wordCount)}` });
        }

        const dateStr = new Date(book.updatedAt).toLocaleDateString('zh-CN');
        metaRow.createEl('span', { text: `🕐 ${dateStr}` });
    }

    private getStatusBadge(status: string): HTMLElement {
        const statusMap: Record<string, { label: string; color: string; bg: string }> = {
            pending: { label: '待拆解', color: 'var(--text-muted)', bg: 'var(--background-secondary)' },
            processing: { label: '拆解中', color: 'var(--text-accent)', bg: 'rgba(var(--interactive-accent-rgb), 0.1)' },
            completed: { label: '已完成', color: 'var(--text-success)', bg: 'rgba(var(--background-modifier-success-rgb), 0.1)' },
            failed: { label: '失败', color: 'var(--text-error)', bg: 'rgba(var(--background-modifier-error-rgb), 0.1)' },
        };

        const info = statusMap[status] || statusMap.pending;
        const badge = createDiv({
            attr: {
                style: `display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:500;color:${info.color};background:${info.bg};margin-top:8px;`
            },
            text: info.label
        });
        return badge;
    }

    private formatKbWordCount(count: number): string {
        if (count >= 10000) {
            const wan = count / 10000;
            return wan % 1 === 0 ? `${wan}万字` : `${wan.toFixed(1)}万字`;
        }
        return `${count}字`;
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
            cls: 'nw-u-p-12px-16px-2 nw-u-b-1px-solid-background-m-2 nw-u-brd-6px-2 nw-u-marginbottom-16px-2 nw-u-bg-background-secondary-2'
        });

        vectorSection.createEl('h4', {
            text: '🧠 向量增强设置',
            cls: 'nw-u-m-0-0-12px-0-2 nw-u-fs-14px-2'
        });

        new Setting(vectorSection)
            .setName('向量增强拆解')
            .setDesc('启用后，知识库拆解时使用向量相似度匹配辅助定位相关内容，提升拆解质量')
            .addToggle(toggle => {
                toggle.setValue(this.plugin.settings.vectorEnhancedDeconstruction ?? true);
                toggle.onChange(async (value) => {
                    this.plugin.settings.vectorEnhancedDeconstruction = value;
                    await this.plugin.saveSettings();
                });
            });

        new Setting(vectorSection)
            .setName('置信度阈值')
            .setDesc(`向量匹配的最低置信度，低于此值的结果将被过滤（当前: ${(this.plugin.settings.vectorDeconstructionThreshold ?? 0.3).toFixed(2)}）`)
            .addSlider(slider => {
                slider.setLimits(0.1, 0.9, 0.05);
                slider.setValue(this.plugin.settings.vectorDeconstructionThreshold ?? 0.3);
                slider.setDynamicTooltip();
                slider.onChange(async (value) => {
                    this.plugin.settings.vectorDeconstructionThreshold = value;
                    const descEl = slider.sliderEl.closest('.setting-item')?.querySelector('.setting-item-description');
                    if (descEl) {
                        descEl.textContent = `向量匹配的最低置信度，低于此值的结果将被过滤（当前: ${value.toFixed(2)}）`;
                    }
                    await this.plugin.saveSettings();
                });
            });

        const providerSetting = new Setting(vectorSection)
            .setName('向量模型提供商')
            .setDesc('选择向量嵌入模型的提供商')
            .addDropdown(dropdown => {
                dropdown.addOption('ollama', '🖥 本地 Ollama');
                dropdown.addOption('openai', '☁️ OpenAI 兼容');
                dropdown.addOption('doubao', '☁️ 豆包/火山引擎');
                dropdown.addOption('qwen', '☁️ 通义千问');
                dropdown.setValue(this.plugin.settings.vectorProviderType || 'ollama');
                dropdown.onChange(async (value) => {
                    this.plugin.settings.vectorProviderType = value as 'ollama' | 'openai' | 'doubao' | 'qwen';
                    await this.plugin.saveSettings();
                    this.refresh();
                });
            });

        new Setting(vectorSection)
            .setName('向量服务不可用时的回退')
            .setDesc('local-only=只允许回退到本地 Ollama；never=直接失败；allow-cloud=允许回退到云端（可能把本地文本发到云端）')
            .addDropdown(dropdown => {
                dropdown.addOption('local-only', '仅本地（推荐）');
                dropdown.addOption('never', '不回退');
                dropdown.addOption('allow-cloud', '允许云端（谨慎）');
                dropdown.setValue(this.plugin.settings.embeddingFallbackPolicy || 'local-only');
                dropdown.onChange(async (value) => {
                    this.plugin.settings.embeddingFallbackPolicy = value as 'never' | 'local-only' | 'allow-cloud';
                    await this.plugin.saveSettings();
                });
            });

        const providerType = this.plugin.settings.vectorProviderType || 'ollama';

        if (providerType === 'ollama') {
            new Setting(vectorSection)
                .setName('Ollama 端点')
                .setDesc('Ollama 服务的 API 端点地址')
                .addText(text => {
                    text.setValue(this.plugin.settings.vectorOllamaBaseUrl || 'http://localhost:11434');
                    text.setPlaceholder('http://localhost:11434');
                    text.onChange(async (value) => {
                        this.plugin.settings.vectorOllamaBaseUrl = value;
                        await this.plugin.saveSettings();
                    });
                });

            new Setting(vectorSection)
                .setName('Ollama 模型')
                .setDesc('用于向量嵌入的 Ollama 模型名称')
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
                .setName('API 端点')
                .setDesc('OpenAI 兼容 API 的基础 URL（如豆包、通义、智谱等）')
                .addText(text => {
                    text.setValue(this.plugin.settings.vectorOpenaiBaseUrl || 'https://ark.cn-beijing.volces.com/api/v3');
                    text.setPlaceholder('https://api.openai.com/v1');
                    text.onChange(async (value) => {
                        this.plugin.settings.vectorOpenaiBaseUrl = value;
                        await this.plugin.saveSettings();
                    });
                });

            new Setting(vectorSection)
                .setName('模型名称')
                .setDesc('用于向量嵌入的模型名称')
                .addText(text => {
                    text.setValue(this.plugin.settings.vectorOpenaiModel || 'doubao-embedding-text-240915');
                    text.setPlaceholder('text-embedding-3-small');
                    text.onChange(async (value) => {
                        this.plugin.settings.vectorOpenaiModel = value;
                        await this.plugin.saveSettings();
                    });
                });

            new Setting(vectorSection)
                .setName('API Key')
                .setDesc('OpenAI 兼容 API 的密钥')
                .addText(text => {
                    text.inputEl.type = 'password';
                    const secretDisplay = describeSecretForInput(this.plugin.settings.vectorOpenaiApiKey || '');
                    text.setValue(secretDisplay.value);
                    text.setPlaceholder(secretDisplay.placeholder || '请输入 API Key');
                    text.inputEl.title = secretDisplay.title;
                    // 空值 = 未修改：加密锁定态输入框为空，写回会抹掉已加密密钥
                    text.inputEl.addEventListener('change', () => {
                        const next = text.inputEl.value.trim();
                        if (!next) return;
                        this.plugin.settings.vectorOpenaiApiKey = next;
                        void this.plugin.saveSettings().catch((e: unknown) => {
                            new Notice(`保存密钥失败：${e instanceof Error ? e.message : String(e)}`, 6000);
                        });
                    });
                    const toggleBtn = text.inputEl.parentElement?.createEl('button', {
                        text: '👁',
                        cls: 'novel-writer-key-toggle',
                        attr: { type: 'button', title: '显示/隐藏密钥' }
                    });
                    if (toggleBtn) {
                        toggleBtn.style.cssText = 'margin-left:4px;padding:2px 6px;cursor:pointer;border:none;background:var(--background-modifier-border);border-radius:3px;font-size:12px;';
                        toggleBtn.addEventListener('click', () => {
                            text.inputEl.type = text.inputEl.type === 'password' ? 'text' : 'password';
                            toggleBtn.textContent = text.inputEl.type === 'password' ? '👁' : '🙈';
                        });
                    }
                });
        }

        if (providerType === 'doubao') {
            new Setting(vectorSection)
                .setName('API 端点')
                .setDesc('豆包/火山引擎向量 API 的基础 URL')
                .addText(text => {
                    text.setValue(this.plugin.settings.vectorDoubaoBaseUrl || 'https://ark.cn-beijing.volces.com/api/v3');
                    text.setPlaceholder('https://ark.cn-beijing.volces.com/api/v3');
                    text.onChange(async (value) => {
                        this.plugin.settings.vectorDoubaoBaseUrl = value;
                        await this.plugin.saveSettings();
                    });
                });

            new Setting(vectorSection)
                .setName('模型名称')
                .setDesc('用于向量嵌入的豆包模型名称')
                .addText(text => {
                    text.setValue(this.plugin.settings.vectorDoubaoModel || 'doubao-embedding-text-240915');
                    text.setPlaceholder('doubao-embedding-text-240915');
                    text.onChange(async (value) => {
                        this.plugin.settings.vectorDoubaoModel = value;
                        await this.plugin.saveSettings();
                    });
                });

            new Setting(vectorSection)
                .setName('API Key')
                .setDesc('豆包/火山引擎 API 的密钥')
                .addText(text => {
                    text.inputEl.type = 'password';
                    const secretDisplay = describeSecretForInput(this.plugin.settings.vectorDoubaoApiKey || '');
                    text.setValue(secretDisplay.value);
                    text.setPlaceholder(secretDisplay.placeholder || '请输入 API Key');
                    text.inputEl.title = secretDisplay.title;
                    // 空值 = 未修改：加密锁定态输入框为空，写回会抹掉已加密密钥
                    text.inputEl.addEventListener('change', () => {
                        const next = text.inputEl.value.trim();
                        if (!next) return;
                        this.plugin.settings.vectorDoubaoApiKey = next;
                        void this.plugin.saveSettings().catch((e: unknown) => {
                            new Notice(`保存密钥失败：${e instanceof Error ? e.message : String(e)}`, 6000);
                        });
                    });
                    const toggleBtn = text.inputEl.parentElement?.createEl('button', {
                        text: '👁',
                        cls: 'novel-writer-key-toggle',
                        attr: { type: 'button', title: '显示/隐藏密钥' }
                    });
                    if (toggleBtn) {
                        toggleBtn.style.cssText = 'margin-left:4px;padding:2px 6px;cursor:pointer;border:none;background:var(--background-modifier-border);border-radius:3px;font-size:12px;';
                        toggleBtn.addEventListener('click', () => {
                            text.inputEl.type = text.inputEl.type === 'password' ? 'text' : 'password';
                            toggleBtn.textContent = text.inputEl.type === 'password' ? '👁' : '🙈';
                        });
                    }
                });
        }

        if (providerType === 'qwen') {
            new Setting(vectorSection)
                .setName('API 端点')
                .setDesc('通义千问向量 API 的基础 URL（兼容模式）')
                .addText(text => {
                    text.setValue(this.plugin.settings.vectorQwenBaseUrl || 'https://dashscope.aliyuncs.com/compatible-mode/v1');
                    text.setPlaceholder('https://dashscope.aliyuncs.com/compatible-mode/v1');
                    text.onChange(async (value) => {
                        this.plugin.settings.vectorQwenBaseUrl = value;
                        await this.plugin.saveSettings();
                    });
                });

            new Setting(vectorSection)
                .setName('模型名称')
                .setDesc('用于向量嵌入的通义千问模型名称')
                .addText(text => {
                    text.setValue(this.plugin.settings.vectorQwenModel || 'text-embedding-v3');
                    text.setPlaceholder('text-embedding-v3');
                    text.onChange(async (value) => {
                        this.plugin.settings.vectorQwenModel = value;
                        await this.plugin.saveSettings();
                    });
                });

            new Setting(vectorSection)
                .setName('API Key')
                .setDesc('通义千问 API 的密钥')
                .addText(text => {
                    text.inputEl.type = 'password';
                    const secretDisplay = describeSecretForInput(this.plugin.settings.vectorQwenApiKey || '');
                    text.setValue(secretDisplay.value);
                    text.setPlaceholder(secretDisplay.placeholder || '请输入 API Key');
                    text.inputEl.title = secretDisplay.title;
                    // 空值 = 未修改：加密锁定态输入框为空，写回会抹掉已加密密钥
                    text.inputEl.addEventListener('change', () => {
                        const next = text.inputEl.value.trim();
                        if (!next) return;
                        this.plugin.settings.vectorQwenApiKey = next;
                        void this.plugin.saveSettings().catch((e: unknown) => {
                            new Notice(`保存密钥失败：${e instanceof Error ? e.message : String(e)}`, 6000);
                        });
                    });
                    const toggleBtn = text.inputEl.parentElement?.createEl('button', {
                        text: '👁',
                        cls: 'novel-writer-key-toggle',
                        attr: { type: 'button', title: '显示/隐藏密钥' }
                    });
                    if (toggleBtn) {
                        toggleBtn.style.cssText = 'margin-left:4px;padding:2px 6px;cursor:pointer;border:none;background:var(--background-modifier-border);border-radius:3px;font-size:12px;';
                        toggleBtn.addEventListener('click', () => {
                            text.inputEl.type = text.inputEl.type === 'password' ? 'text' : 'password';
                            toggleBtn.textContent = text.inputEl.type === 'password' ? '👁' : '🙈';
                        });
                    }
                });
        }

        const statusColors: Record<string, string> = {
            idle: 'var(--text-muted)',
            checking: 'var(--text-muted)',
            connected: 'var(--text-success)',
            disconnected: 'var(--text-error)',
        };

        const statusLabels: Record<string, string> = {
            idle: '未检测',
            checking: '检测中...',
            connected: '已连接',
            disconnected: '未连接',
        };

        let statusDot: HTMLElement | null = null;
        let statusText: HTMLElement | null = null;

        const updateStatusDisplay = () => {
            if (statusDot && statusText) {
                statusDot.style.backgroundColor = statusColors[this.vectorConnectionStatus] || 'var(--text-muted)';
                statusText.textContent = statusLabels[this.vectorConnectionStatus] || '未检测';
                statusText.style.color = statusColors[this.vectorConnectionStatus] || 'var(--text-muted)';
            }
        };

        const statusSetting = new Setting(vectorSection)
            .setName('连接状态')
            .setDesc('检测向量嵌入服务是否可用')
            .addButton(btn => {
                btn
                    .setButtonText('检测连接')
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
                            new Notice('✅ 向量服务连接正常');
                        } else {
                            new Notice('❌ 无法连接到向量服务，请检查配置');
                        }
                    });
            });

        const statusDesc = statusSetting.descEl;
        if (statusDesc) {
            statusDesc.style.display = 'flex';
            statusDesc.style.alignItems = 'center';
            statusDesc.style.gap = '6px';
            statusDot = statusDesc.createSpan({
                attr: {
                    style: `width:8px;height:8px;border-radius:50%;background-color:${statusColors[this.vectorConnectionStatus]};display:inline-block;`
                }
            });
            statusText = statusDesc.createSpan({
                text: statusLabels[this.vectorConnectionStatus],
                attr: { style: `color:${statusColors[this.vectorConnectionStatus]};font-weight:500;` }
            });
        }
    }
}
