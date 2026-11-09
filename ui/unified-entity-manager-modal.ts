import { App, Component, Modal, Notice, TFile, MarkdownRenderer } from 'obsidian';
import NovelWriterPlugin from '@/main';
import { ENTITY_CATEGORIES } from '@/shared/entity-registry';
import {
    SUBDIR_CHARS,
    SUBDIR_LOCS,
    SUBDIR_FACTIONS,
    SUBDIR_ITEMS,
} from '@/shared/paths';
import { ExistingEntityManagerModal } from './existing-entity-manager';
import { UnifiedEntityGenerateModal } from './unified-entity-generate-modal';
import { ensureEntityIntegrity } from '@/shared/entity-integrity';
import { auditEntityFiles, overwriteEntityIfComplete, readProjectWorldview } from '@/shared/entity-audit';
import { createLogger } from '@/shared/logger';
import { createEmptyState } from './components/empty-state';

const log = createLogger('UnifiedEntityManagerModal');
import {
    characterFromMarkdown,
    factionFromMarkdown,
    locationFromMarkdown,
    itemFromMarkdown,
    type AnyEntityDomainModel,
    type EntityCategory as ModelCategory,
} from '@/shared/entity-models';
import { ENTITY_FIELD_MAPPINGS } from '@/shared/entity-field-mappings';
import { listEntityFiles, type EntityKind } from '@/shared/entity-reader';

/** 实体管理器分类 → 实体读取器目录类别 */
const KIND_BY_CATEGORY: Record<ModelCategory, EntityKind> = {
    character: 'characters',
    faction: 'factions',
    location: 'locations',
    item: 'items',
};

interface EntityItem {
    file: TFile;
    name: string;
    category: ModelCategory;
    model: AnyEntityDomainModel | null;
}

/**
 * 跨类别实体总览：按 `ENTITY_CATEGORIES` 聚合四类实体，提供筛选、
 * 完整性审计 / 原地补全，以及「管理文件 / 编辑实体」跳转。
 *
 * 跳转目标 `ExistingEntityManagerModal` 负责**单类别**文件操作（改名 /
 * 编辑全文 / 删除 / 智能猜名），按 `subdir + label` 被 7 个入口复用；
 * 本弹窗不做文件级操作，两者职责分离，不要合并。
 */
export class UnifiedEntityManagerModal extends Modal {
    private plugin: NovelWriterPlugin;
    private project: string;
    /** Markdown 渲染宿主：Modal 不是 Component，必须自管 load/unload */
    private renderHost = new Component();

    private activeCategory: ModelCategory = 'character';
    private entities: EntityItem[] = [];
    private filteredEntities: EntityItem[] = [];
    private selectedEntity: EntityItem | null = null;
    private searchQuery: string = '';
    private selectedTags: Set<string> = new Set();
    private allTags: Set<string> = new Set();
    private showAdvancedFilter: boolean = false;

    private categoryTabMap: Record<ModelCategory, typeof ENTITY_CATEGORIES[number]>;
    private subdirMap: Record<ModelCategory, string> = {
        character: SUBDIR_CHARS,
        faction: SUBDIR_FACTIONS,
        location: SUBDIR_LOCS,
        item: SUBDIR_ITEMS,
    };

    private listEl!: HTMLElement;
    private detailEl!: HTMLElement;
    private searchInputEl!: HTMLInputElement;
    private tagFilterEl!: HTMLElement;

    constructor(app: App, plugin: NovelWriterPlugin, project: string) {
        super(app);
        this.plugin = plugin;
        this.project = project;

        this.categoryTabMap = {
            character: ENTITY_CATEGORIES[0],
            location: ENTITY_CATEGORIES[1],
            faction: ENTITY_CATEGORIES[2],
            item: ENTITY_CATEGORIES[3],
        };
    }

    /**
     * onOpen 方法。
     */
    onOpen(): void {
        this.renderHost.load();
        this.modalEl.addClass('nw-scope');
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('nw-entity-scope');

        const modalWrapper = contentEl.parentElement as HTMLElement;
        if (modalWrapper) {
            modalWrapper.addClass('nw-modal-xl');
            // Rev 184：固定 75vh 在小屏挤压内容，改为上限约束（样式见 24-unified-entity.css）
            modalWrapper.addClass('nw-uem-modal');
        }
        contentEl.addClass('nw-uem-content');

        this._renderHeader();
        this._renderToolbar();
        this._renderBody();
        this._loadEntities();
    }

    /**
     * onClose 方法。
     */
    onClose(): void {
        this.renderHost.unload();
        this.contentEl.empty();
        this.entities = [];
        this.filteredEntities = [];
        this.selectedEntity = null;
    }

    private _renderHeader(): void {
        const { contentEl } = this;

        const header = contentEl.createDiv({ cls: 'nw-uem-header' });

        const titleWrap = header.createDiv({ cls: 'nw-uem-title-wrap' });
        titleWrap.createEl('h2', {
            text: `📚 实体管理 — ${this.project}`,
            cls: 'nw-uem-title',
        });

        const actionBtns = header.createDiv({ cls: 'nw-uem-actions' });

        const genBtn = actionBtns.createEl('button', {
            text: '✨ 生成实体',
            cls: 'nw-btn nw-btn-primary novel-writer-primary-button',
        });
        genBtn.addClass('nw-uem-action-btn');
        genBtn.onclick = () => {
            this.close();
            new UnifiedEntityGenerateModal(
                this.app,
                this.plugin,
                this.project,
                this.activeCategory,
            ).open();
        };

        const mgrBtn = actionBtns.createEl('button', {
            text: '📂 管理文件',
            cls: 'nw-btn',
        });
        mgrBtn.addClass('nw-uem-action-btn', 'nw-uem-action-btn-secondary');
        mgrBtn.onclick = () => {
            const subdir = this.subdirMap[this.activeCategory];
            const catInfo = this.categoryTabMap[this.activeCategory];
            this.close();
            new ExistingEntityManagerModal(
                this.app,
                this.plugin,
                this.project,
                subdir,
                `${catInfo.icon} ${catInfo.label}`,
            ).open();
        };

        const repairBtn = actionBtns.createEl('button', {
            text: '🩹 补全不完整实体',
            cls: 'nw-btn',
        });
        repairBtn.addClass('nw-uem-action-btn', 'nw-uem-action-btn-secondary');
        repairBtn.onclick = () => { void this._repairIncompleteEntities(repairBtn); };
    }

    /**
     * 审计项目内全部实体，逐条「校验 → AI 补全 → 复检」，通过后原地覆写。
     * 复检仍不完整的实体保持原样，并在结束提示中列出。
     */
    private async _repairIncompleteEntities(btn: HTMLButtonElement): Promise<void> {
        if (!this.plugin.hasAiCredentials) {
            new Notice('❌ 请先配置 API 密钥或本地模型端点，再执行补全', 5000);
            return;
        }

        btn.disabled = true;
        btn.setText('⏳ 检查中...');
        try {
            const items = await auditEntityFiles(this.app, this.project);
            if (items.length === 0) {
                new Notice('✅ 所有实体均通过完整性校验', 4000);
                return;
            }

            const preview = items.slice(0, 8)
                .map(i => `${i.name}（缺 ${i.missingFields.length} 项）`)
                .join('、');
            const confirmed = window.confirm(
                `发现 ${items.length} 个不完整实体：\n${preview}${items.length > 8 ? ' 等' : ''}\n\n` +
                '将逐条调用 AI 补全，复检通过后原地覆写；仍不完整的保持原文件不变。是否继续？'
            );
            if (!confirmed) return;

            const worldview = await readProjectWorldview(this.app, this.project);
            let repaired = 0;
            const failed: string[] = [];

            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                btn.setText(`⏳ 补全 ${i + 1}/${items.length}...`);

                const result = await ensureEntityIntegrity(
                    item.kind,
                    item.name,
                    item.content,
                    (req) => this.plugin.aiEngine.repairEntity(
                        req.kind,
                        req.name,
                        req.content,
                        req.missingFields,
                        worldview
                    )
                );

                if (!result.valid) {
                    failed.push(`${item.name}（缺 ${result.missingFields.slice(0, 3).join('、')}）`);
                    continue;
                }

                const write = await overwriteEntityIfComplete(this.app, item, result.content);
                if (write.ok) {
                    repaired++;
                } else {
                    failed.push(`${item.name}（复检未通过）`);
                }
            }

            await this._loadEntities();

            const failHint = failed.length > 0
                ? `；未修复 ${failed.length} 个：${failed.slice(0, 5).join('；')}${failed.length > 5 ? ' 等' : ''}`
                : '';
            new Notice(`🩹 已补全 ${repaired} 个实体${failHint}`, failed.length > 0 ? 12000 : 6000);
        } catch (e) {
            log.error('[实体管理] 批量补全失败:', e);
            new Notice(`❌ 补全失败：${e instanceof Error ? e.message : String(e)}`, 8000);
        } finally {
            btn.disabled = false;
            btn.setText('🩹 补全不完整实体');
        }
    }

    private _renderToolbar(): void {
        const { contentEl } = this;

        const toolbar = contentEl.createDiv({ cls: 'nw-uem-toolbar' });

        this.searchInputEl = toolbar.createEl('input', {
            type: 'text',
            placeholder: '🔍 搜索实体名称或描述...',
            cls: 'nw-input novel-writer-input',
        });
        this.searchInputEl.addClass('nw-uem-search');
        this.searchInputEl.addEventListener('input', () => {
            this.searchQuery = this.searchInputEl.value.trim();
            this._applyFilters();
        });

        const filterBtn = toolbar.createEl('button', {
            text: '🏷️ 标签筛选',
            cls: 'nw-btn',
        });
        filterBtn.addClass('nw-uem-tool-btn');
        filterBtn.onclick = () => {
            this.showAdvancedFilter = !this.showAdvancedFilter;
            this._toggleTagFilter();
        };

        const addBtn = toolbar.createEl('button', {
            text: '➕ 新建',
            cls: 'nw-btn',
        });
        addBtn.addClass('nw-uem-tool-btn');
        addBtn.onclick = () => this.openCreateEntityModal();
    }

    private openCreateEntityModal(): void {
        this.close();
        new UnifiedEntityGenerateModal(
            this.app,
            this.plugin,
            this.project,
            this.activeCategory,
        ).open();
    }

    private _toggleTagFilter(): void {
        if (!this.tagFilterEl) return;
        this.tagFilterEl.toggleClass('nw-u-d-none', !this.showAdvancedFilter);
    }

    private _renderTagFilter(): void {
        if (this.tagFilterEl) {
            this.tagFilterEl.remove();
        }

        const toolbar = this.contentEl.querySelector(
            '.nw-entity-tag-filter-container',
        ) as HTMLElement | null;
        if (toolbar) toolbar.remove();

        const filterRow = this.contentEl.createDiv({
            cls: 'nw-entity-tag-filter-container nw-uem-tag-filter nw-u-d-none',
        });
        this.tagFilterEl = filterRow;

        filterRow.createSpan({ text: '标签：', cls: 'nw-ue-muted-sm' });

        const allTagsArr = Array.from(this.allTags).sort();
        if (allTagsArr.length === 0) {
            filterRow.createSpan({ text: '（暂无标签）', cls: 'nw-ue-muted-sm' });
            return;
        }

        for (const tag of allTagsArr) {
            const tagBtn = filterRow.createEl('button', { text: tag, cls: 'nw-uem-tag-btn' });
            const updateTagStyle = () => {
                tagBtn.toggleClass('nw-is-active', this.selectedTags.has(tag));
            };
            updateTagStyle();
            tagBtn.onclick = () => {
                if (this.selectedTags.has(tag)) {
                    this.selectedTags.delete(tag);
                } else {
                    this.selectedTags.add(tag);
                }
                updateTagStyle();
                this._applyFilters();
            };
        }

        const clearBtn = filterRow.createEl('button', {
            text: '清除筛选',
            cls: 'nw-uem-tag-clear',
        });
        clearBtn.onclick = () => {
            this.selectedTags.clear();
            this._applyFilters();
            this._renderTagFilter();
        };
    }

    private _renderBody(): void {
        const { contentEl } = this;

        const body = contentEl.createDiv({ cls: 'nw-entity-manager-body' });

        const sidebar = body.createDiv({ cls: 'nw-entity-manager-side' });

        const tabBar = sidebar.createDiv({ cls: 'nw-uem-tabbar' });

        (Object.keys(this.categoryTabMap) as ModelCategory[]).forEach((cat) => {
            const info = this.categoryTabMap[cat];
            const tabBtn = tabBar.createEl('button', {
                text: `${info.icon} ${info.label}`,
                cls: 'nw-uem-tab',
                attr: { 'data-category': cat },
            });

            const updateTabStyle = () => {
                tabBtn.toggleClass('nw-is-active', this.activeCategory === cat);
            };
            updateTabStyle();

            tabBtn.onclick = () => {
                this.activeCategory = cat;
                this.selectedEntity = null;
                this.searchQuery = '';
                this.selectedTags.clear();
                if (this.searchInputEl) this.searchInputEl.value = '';
                this._loadEntities();
                tabBar
                    .querySelectorAll('button')
                    .forEach(() => { });
                this._updateAllTabStyles();
            };

        });

        this.listEl = sidebar.createDiv({ cls: 'nw-uem-list' });
        const rightPanel = body.createDiv({ cls: 'nw-uem-right' });
        this.detailEl = rightPanel.createDiv({ cls: 'nw-uem-detail' });
        this._renderEmptyDetail();
    }

    private _updateAllTabStyles(): void {
        const tabBar = this.listEl.parentElement?.querySelector('.nw-uem-tabbar');
        if (!tabBar) return;
        tabBar.querySelectorAll('button[data-category]').forEach((btn) => {
            const cat = btn.getAttribute('data-category') as ModelCategory;
            btn.toggleClass('nw-is-active', cat === this.activeCategory);
        });
    }

    private async _loadEntities(): Promise<void> {
        // P0-3：列表来源统一到 entity-reader（排除模板 + 路径升序），与统计/上下文口径一致
        const files = listEntityFiles(this.app, this.project, KIND_BY_CATEGORY[this.activeCategory]);

        this.entities = [];
        this.allTags = new Set();

        for (const file of files) {
            try {
                const content = await this.app.vault.read(file);
                let model: AnyEntityDomainModel | null = null;

                switch (this.activeCategory) {
                    case 'character':
                        model = characterFromMarkdown(content, file.path);
                        break;
                    case 'faction':
                        model = factionFromMarkdown(content, file.path);
                        break;
                    case 'location':
                        model = locationFromMarkdown(content, file.path);
                        break;
                    case 'item':
                        model = itemFromMarkdown(content, file.path);
                        break;
                }

                if (model) {
                    model.tags.forEach((t) => this.allTags.add(t));
                }

                const name =
                    model?.name || file.basename;

                this.entities.push({
                    file,
                    name,
                    category: this.activeCategory,
                    model,
                });
            } catch (e) {
                log.warn(`[实体管理] 读取文件失败: ${file.path}`, e);
                this.entities.push({
                    file,
                    name: file.basename,
                    category: this.activeCategory,
                    model: null,
                });
            }
        }

        this.entities.sort((a, b) =>
            a.name.localeCompare(b.name, 'zh-Hans-CN'),
        );

        this._applyFilters();
        this._renderTagFilter();
        this._updateTabCounts();
    }

    private _updateTabCounts(): void {
        const sidebar = this.listEl.parentElement;
        if (!sidebar) return;
        const buttons = sidebar.querySelectorAll('button[data-category]');
        buttons.forEach((btn) => {
            const cat = btn.getAttribute('data-category') as ModelCategory;
            const info = this.categoryTabMap[cat];
            const count = cat === this.activeCategory
                ? this.entities.length
                : this._getCountForCategory(cat);
            const baseText = `${info.icon} ${info.label}`;
            btn.setText(`${baseText} (${count})`);
        });
    }

    private _getCountForCategory(cat: ModelCategory): number {
        return listEntityFiles(this.app, this.project, KIND_BY_CATEGORY[cat]).length;
    }

    private _applyFilters(): void {
        let filtered = [...this.entities];

        if (this.searchQuery) {
            const query = this.searchQuery.toLowerCase();
            filtered = filtered.filter((e) => {
                if (e.name.toLowerCase().includes(query)) return true;
                if (e.model?.body?.toLowerCase().includes(query)) return true;
                const fmStr = JSON.stringify(e.model?.frontmatter || {}).toLowerCase();
                if (fmStr.includes(query)) return true;
                return false;
            });
        }

        if (this.selectedTags.size > 0) {
            filtered = filtered.filter((e) => {
                if (!e.model) return false;
                return Array.from(this.selectedTags).some((tag) =>
                    e.model!.tags.includes(tag),
                );
            });
        }

        this.filteredEntities = filtered;
        this._renderEntityList();
    }

    private _renderEntityList(): void {
        this.listEl.empty();

        if (this.filteredEntities.length === 0) {
            const isFiltering = Boolean(this.searchQuery) || this.selectedTags.size > 0;
            this.listEl.appendChild(createEmptyState({
                icon: isFiltering ? 'search' : 'folder',
                title: isFiltering ? '没有匹配的实体' : '暂无实体',
                description: isFiltering
                    ? '试试清空搜索条件或取消标签筛选。'
                    : '当前项目还没有人物、地点、势力或物品。可以先生成一个，或让 AI 从正文中识别。',
                actionText: isFiltering ? undefined : '新建实体',
                onAction: isFiltering ? undefined : () => this.openCreateEntityModal(),
            }));
            return;
        }

        for (const entity of this.filteredEntities) {
            const item = this.listEl.createDiv({ cls: 'nw-uem-item' });
            item.toggleClass(
                'nw-is-selected',
                this.selectedEntity?.file.path === entity.file.path,
            );

            const catInfo = this.categoryTabMap[entity.category];
            item.createSpan({ text: catInfo.icon, cls: 'nw-uem-item-icon' });
            item.createSpan({ text: entity.name, cls: 'nw-uem-item-name' });

            item.onclick = () => {
                this.selectedEntity = entity;
                this._renderEntityList();
                this._renderEntityDetail(entity);
            };
        }
    }

    private _renderEmptyDetail(): void {
        this.detailEl.empty();
        const wrapper = this.detailEl.createDiv({ cls: 'nw-uem-empty' });
        wrapper.appendChild(createEmptyState({
            icon: 'data',
            title: '选择左侧实体查看详情',
            description: '从左侧列表选择一个人物、地点、势力或物品。',
        }));
    }

    private async _renderEntityDetail(entity: EntityItem): Promise<void> {
        this.detailEl.empty();

        const header = this.detailEl.createDiv({ cls: 'nw-uem-detail-header' });
        const titleRow = header.createDiv({ cls: 'nw-uem-detail-title-row' });

        const catInfo = this.categoryTabMap[entity.category];
        titleRow.createSpan({ text: catInfo.icon, cls: 'nw-uem-detail-icon' });
        titleRow.createEl('h3', { text: entity.name, cls: 'nw-uem-detail-title' });

        header.createSpan({
            text: `${catInfo.label} · ${entity.file.path}`,
            cls: 'nw-ue-muted-sm',
        });

        const actionRow = header.createDiv({ cls: 'nw-uem-detail-actions' });

        const openBtn = actionRow.createEl('button', {
            text: '📄 打开文件',
            cls: 'nw-btn',
        });
        openBtn.addClass('nw-uem-detail-btn');
        openBtn.onclick = () => {
            const file = entity.file;
            this.app.workspace.getLeaf().openFile(file);
        };

        const editBtn = actionRow.createEl('button', {
            text: '✏️ 编辑实体',
            cls: 'nw-btn',
        });
        editBtn.addClass('nw-uem-detail-btn');
        editBtn.onclick = () => {
            const subdir = this.subdirMap[entity.category];
            this.close();
            new ExistingEntityManagerModal(
                this.app,
                this.plugin,
                this.project,
                subdir,
                `${catInfo.icon} ${catInfo.label}`,
            ).open();
        };

        if (entity.model?.tags && entity.model.tags.length > 0) {
            const tagsRow = header.createDiv({ cls: 'nw-uem-tags' });
            tagsRow.createSpan({ text: '🏷️', cls: 'nw-uem-tags-icon' });
            for (const tag of entity.model.tags) {
                tagsRow.createEl('span', { text: tag, cls: 'nw-uem-tag-chip' });
            }
        }

        const model = entity.model;
        if (model) {
            this._renderEntityFields(model);
        }

        const content = await this.app.vault.read(entity.file);
        const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim();

        if (body) {
            const bodySection = this.detailEl.createDiv({ cls: 'nw-uem-section' });
            bodySection.createEl('h4', { text: '📖 详细描述', cls: 'nw-uem-section-title' });
            const bodyDiv = bodySection.createDiv({ cls: 'nw-uem-body-text' });
            await MarkdownRenderer.render(
                this.app,
                body,
                bodyDiv,
                entity.file.path,
                this.renderHost,
            );
        }

        this._renderRelations(entity);
    }

    private _renderEntityFields(model: AnyEntityDomainModel): void {
        const section = this.detailEl.createDiv({ cls: 'nw-uem-fields' });
        section.createEl('h4', { text: '📋 基本信息', cls: 'nw-uem-section-title' });
        const grid = section.createDiv({ cls: 'nw-uem-fields-grid' });

        const addField = (label: string, value: string | undefined) => {
            if (!value) return;
            grid.createSpan({ text: label, cls: 'nw-uem-field-label' });
            grid.createSpan({ text: value, cls: 'nw-uem-field-value' });
        };

        const mapping = ENTITY_FIELD_MAPPINGS[model.category];
        const record = model as unknown as Record<string, unknown>;
        const metaKeys = new Set([
            'name',
            'entityStatus',
            'createdAt',
            'lastChangedAt',
            'lastChangedReason',
        ]);

        for (const field of mapping.fields) {
            if (metaKeys.has(field.modelKey)) continue;
            const value = record[field.modelKey];
            if (typeof value === 'string' || typeof value === 'number') {
                addField(field.label, String(value));
            }
        }

        addField('创建时间', model.createdAt);
        addField('最后变更', model.lastChangedAt);
        addField('变更原因', model.lastChangedReason);
    }

    private _renderRelations(entity: EntityItem): void {
        const model = entity.model;
        if (!model) return;

        const relations: { label: string; value: string; targetCategory: ModelCategory | null }[] = [];

        if (model.category === 'character') {
            if (model.faction) {
                relations.push({
                    label: '所属势力',
                    value: model.faction,
                    targetCategory: 'faction',
                });
            }
            if (model.currentLocation) {
                relations.push({
                    label: '所在地点',
                    value: model.currentLocation,
                    targetCategory: 'location',
                });
            }
        }

        if (model.category === 'item' && model.owner) {
            relations.push({
                label: '持有者',
                value: model.owner,
                targetCategory: 'character',
            });
        }

        if (model.category === 'location' && model.inhabitants) {
            relations.push({
                label: '主要势力',
                value: model.inhabitants,
                targetCategory: 'faction',
            });
        }

        if (relations.length === 0) return;

        const section = this.detailEl.createDiv({ cls: 'nw-uem-relations' });
        section.createEl('h4', { text: '🔗 实体关联', cls: 'nw-uem-section-title' });

        for (const rel of relations) {
            const relRow = section.createDiv({ cls: 'nw-uem-rel-row' });
            relRow.createSpan({ text: rel.label, cls: 'nw-uem-rel-label' });
            const linkBtn = relRow.createEl('button', {
                text: `${rel.value} →`,
                cls: 'nw-uem-rel-link',
            });

            linkBtn.onclick = () => {
                this._jumpToRelated(rel.value, rel.targetCategory);
            };
        }
    }

    private _jumpToRelated(name: string, category: ModelCategory | null): void {
        if (!category) {
            new Notice('⚠️ 无法确定关联实体类型', 2000);
            return;
        }

        this.activeCategory = category;
        this._updateAllTabStyles();

        this._loadEntities().then(() => {
            const found = this.filteredEntities.find(
                (e) => e.name === name || e.file.basename === name,
            );
            if (found) {
                this.selectedEntity = found;
                this._renderEntityList();
                this._renderEntityDetail(found);
            } else {
                new Notice(`🔍 未找到「${name}」实体`, 2000);
            }
        });
    }
}
