import { App, Modal, Notice, TFile, MarkdownRenderer } from 'obsidian';
import NovelWriterPlugin from '../main';
import { ENTITY_CATEGORIES } from '../shared/entity-registry';
import {
    SUBDIR_CHARS,
    SUBDIR_LOCS,
    SUBDIR_FACTIONS,
    SUBDIR_ITEMS,
} from '../shared/paths';
import { ExistingEntityManagerModal } from './existing-entity-manager';
import { UnifiedEntityGenerateModal } from './unified-entity-generate-modal';
import { createLogger } from '../shared/logger';

const log = createLogger('UnifiedEntityManagerModal');
import {
    characterFromMarkdown,
    factionFromMarkdown,
    locationFromMarkdown,
    itemFromMarkdown,
    type AnyEntityDomainModel,
    type EntityCategory as ModelCategory,
} from '../shared/entity-models';

interface EntityItem {
    file: TFile;
    name: string;
    category: ModelCategory;
    model: AnyEntityDomainModel | null;
}

export class UnifiedEntityManagerModal extends Modal {
    private plugin: NovelWriterPlugin;
    private project: string;

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

    onOpen(): void {
        this.modalEl.addClass('nw-scope');
        const { contentEl } = this;
        contentEl.empty();

        const modalWrapper = contentEl.parentElement as HTMLElement;
        if (modalWrapper) {
            modalWrapper.addClass('nw-modal-xl');
            modalWrapper.style.setProperty('height', '75vh', 'important');
        }
        contentEl.style.width = '100%';
        contentEl.style.height = '75vh';
        contentEl.style.display = 'flex';
        contentEl.style.flexDirection = 'column';
        contentEl.style.overflow = 'hidden';

        this._renderHeader();
        this._renderToolbar();
        this._renderBody();
        this._loadEntities();
    }

    onClose(): void {
        this.contentEl.empty();
        this.entities = [];
        this.filteredEntities = [];
        this.selectedEntity = null;
    }

    private _renderHeader(): void {
        const { contentEl } = this;

        const header = contentEl.createDiv({
            attr: {
                style:
                    'padding:12px 16px; border-bottom:1px solid var(--background-modifier-border); display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;',
            },
        });

        const titleWrap = header.createDiv({
            attr: { style: 'display:flex; align-items:center; gap:10px;' },
        });
        titleWrap.createEl('h2', {
            text: `📚 实体管理 — ${this.project}`,
            attr: { style: 'margin:0; font-size:18px;' },
        });

        const actionBtns = header.createDiv({
            attr: { style: 'display:flex; gap:8px;' },
        });

        const genBtn = actionBtns.createEl('button', {
            text: '✨ 生成实体',
            cls: 'nw-btn nw-btn-primary novel-writer-primary-button',
        });
        genBtn.style.cssText = 'font-size:0.85em; padding:6px 14px;';
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
        mgrBtn.style.cssText =
            'font-size:0.85em; padding:6px 14px; border:1px solid var(--background-modifier-border); background:var(--background-secondary);';
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
    }

    private _renderToolbar(): void {
        const { contentEl } = this;

        const toolbar = contentEl.createDiv({
            attr: {
                style:
                    'padding:8px 16px; border-bottom:1px solid var(--background-modifier-border); display:flex; align-items:center; gap:10px; flex-wrap:wrap; background:var(--background-primary-alt);',
            },
        });

        this.searchInputEl = toolbar.createEl('input', {
            type: 'text',
            placeholder: '🔍 搜索实体名称或描述...',
            cls: 'nw-input novel-writer-input',
        });
        this.searchInputEl.style.cssText = 'flex:1; min-width:200px;';
        this.searchInputEl.addEventListener('input', () => {
            this.searchQuery = this.searchInputEl.value.trim();
            this._applyFilters();
        });

        const filterBtn = toolbar.createEl('button', {
            text: '🏷️ 标签筛选',
            cls: 'nw-btn',
        });
        filterBtn.style.cssText =
            'font-size:0.85em; padding:6px 12px; border:1px solid var(--background-modifier-border); background:var(--background-secondary);';
        filterBtn.onclick = () => {
            this.showAdvancedFilter = !this.showAdvancedFilter;
            this._toggleTagFilter();
        };

        const addBtn = toolbar.createEl('button', {
            text: '➕ 新建',
            cls: 'nw-btn',
        });
        addBtn.style.cssText =
            'font-size:0.85em; padding:6px 12px; border:1px solid var(--background-modifier-border); background:var(--background-secondary);';
        addBtn.onclick = () => {
            this.close();
            new UnifiedEntityGenerateModal(
                this.app,
                this.plugin,
                this.project,
                this.activeCategory,
            ).open();
        };
    }

    private _toggleTagFilter(): void {
        if (!this.tagFilterEl) return;
        this.tagFilterEl.style.display = this.showAdvancedFilter ? 'flex' : 'none';
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
            attr: {
                style:
                    'padding:8px 16px; border-bottom:1px solid var(--background-modifier-border); display:none; align-items:center; gap:8px; flex-wrap:wrap; background:var(--background-primary-alt);',
                class: 'nw-entity-tag-filter-container',
            },
        });
        this.tagFilterEl = filterRow;

        filterRow.createSpan({
            text: '标签：',
            attr: { style: 'font-size:0.85em; color:var(--text-muted);' },
        });

        const allTagsArr = Array.from(this.allTags).sort();
        if (allTagsArr.length === 0) {
            filterRow.createSpan({
                text: '（暂无标签）',
                attr: { style: 'font-size:0.85em; color:var(--text-muted);' },
            });
            return;
        }

        for (const tag of allTagsArr) {
            const tagBtn = filterRow.createEl('button', {
                text: tag,
                attr: { style: 'font-size:0.8em; padding:3px 10px; border-radius:12px; cursor:pointer; border:1px solid var(--background-modifier-border); background:var(--background-secondary);' },
            });
            const updateTagStyle = () => {
                if (this.selectedTags.has(tag)) {
                    tagBtn.style.background = 'var(--text-accent)';
                    tagBtn.style.color = 'white';
                    tagBtn.style.borderColor = 'var(--text-accent)';
                } else {
                    tagBtn.style.background = 'var(--background-secondary)';
                    tagBtn.style.color = '';
                    tagBtn.style.borderColor = 'var(--background-modifier-border)';
                }
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
            attr: { style: 'font-size:0.8em; padding:3px 10px; border-radius:12px; cursor:pointer; border:1px solid var(--background-modifier-border); background:var(--background-secondary); margin-left:auto;' },
        });
        clearBtn.onclick = () => {
            this.selectedTags.clear();
            this._applyFilters();
            this._renderTagFilter();
        };
    }

    private _renderBody(): void {
        const { contentEl } = this;

        const body = contentEl.createDiv({
            attr: { style: 'display:flex; flex:1; overflow:hidden; min-height:0;' },
        });

        const sidebar = body.createDiv({
            attr: {
                style:
                    'width:240px; min-width:240px; border-right:1px solid var(--background-modifier-border); display:flex; flex-direction:column; background:var(--background-primary-alt);',
            },
        });

        const tabBar = sidebar.createDiv({
            attr: {
                style:
                    'display:flex; flex-direction:column; border-bottom:1px solid var(--background-modifier-border);',
            },
        });

        (Object.keys(this.categoryTabMap) as ModelCategory[]).forEach((cat) => {
            const info = this.categoryTabMap[cat];
            const tabBtn = tabBar.createEl('button', {
                text: `${info.icon} ${info.label}`,
                attr: {
                    'data-category': cat,
                    style:
                        'padding:10px 16px; text-align:left; cursor:pointer; border:none; background:transparent; font-size:0.95em; border-bottom:1px solid var(--background-modifier-border);',
                },
            });

            const updateTabStyle = () => {
                if (this.activeCategory === cat) {
                    tabBtn.style.background = 'var(--background-primary)';
                    tabBtn.style.fontWeight = '600';
                    tabBtn.style.borderLeft = '3px solid var(--text-accent)';
                    tabBtn.style.paddingLeft = '13px';
                } else {
                    tabBtn.style.background = 'transparent';
                    tabBtn.style.fontWeight = 'normal';
                    tabBtn.style.borderLeft = '3px solid transparent';
                    tabBtn.style.paddingLeft = '16px';
                }
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

            const updateCount = () => {
                const count = this.entities.filter((e) => e.category === cat).length;
                tabBtn.setText(`${info.icon} ${info.label} (${count})`);
            };
            (tabBtn as any)._updateCount = updateCount;
        });

        this.listEl = sidebar.createDiv({
            attr: {
                style:
                    'flex:1; overflow-y:auto; padding:8px;',
            },
        });

        const rightPanel = body.createDiv({
            attr: { style: 'flex:1; display:flex; flex-direction:column; overflow:hidden;' },
        });

        this.detailEl = rightPanel.createDiv({
            attr: { style: 'flex:1; overflow-y:auto; padding:16px;' },
        });
        this._renderEmptyDetail();
    }

    private _updateAllTabStyles(): void {
        const tabBar = this.listEl.parentElement?.querySelector(
            'div[style*="flex-direction:column"]',
        );
        if (!tabBar) return;
        const buttons = tabBar.querySelectorAll('button[data-category]');
        buttons.forEach((btn) => {
            const cat = btn.getAttribute('data-category') as ModelCategory;
            if (cat === this.activeCategory) {
                (btn as HTMLElement).style.background = 'var(--background-primary)';
                (btn as HTMLElement).style.fontWeight = '600';
                (btn as HTMLElement).style.borderLeft = '3px solid var(--text-accent)';
                (btn as HTMLElement).style.paddingLeft = '13px';
            } else {
                (btn as HTMLElement).style.background = 'transparent';
                (btn as HTMLElement).style.fontWeight = 'normal';
                (btn as HTMLElement).style.borderLeft = '3px solid transparent';
                (btn as HTMLElement).style.paddingLeft = '16px';
            }
        });
    }

    private async _loadEntities(): Promise<void> {
        const subdir = this.subdirMap[this.activeCategory];
        const dirPath = `${this.project}/${subdir}`;
        const files = this.app.vault.getFiles().filter(
            (f) =>
                f.path.startsWith(dirPath + '/') &&
                f.name.endsWith('.md') &&
                !f.name.includes('模板'),
        );

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
        const subdir = this.subdirMap[cat];
        const dirPath = `${this.project}/${subdir}`;
        return this.app.vault.getFiles().filter(
            (f) =>
                f.path.startsWith(dirPath + '/') &&
                f.name.endsWith('.md') &&
                !f.name.includes('模板'),
        ).length;
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
            this.listEl.createEl('p', {
                text: this.searchQuery || this.selectedTags.size > 0
                    ? '没有匹配的实体'
                    : '暂无实体',
                attr: {
                    style:
                        'color:var(--text-muted); padding:20px 8px; font-size:0.85em; text-align:center;',
                },
            });
            return;
        }

        for (const entity of this.filteredEntities) {
            const item = this.listEl.createDiv({
                attr: {
                    style:
                        'padding:8px 10px; cursor:pointer; border-radius:6px; font-size:0.9em; margin-bottom:2px; display:flex; align-items:center; gap:6px;',
                },
            });

            const catInfo = this.categoryTabMap[entity.category];
            item.createSpan({
                text: catInfo.icon,
                attr: { style: 'font-size:1em;' },
            });

            const nameSpan = item.createSpan({
                text: entity.name,
                attr: { style: 'flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;' },
            });

            if (this.selectedEntity?.file.path === entity.file.path) {
                item.style.background = 'var(--text-accent)';
                item.style.color = 'white';
            }

            item.onmouseenter = () => {
                if (this.selectedEntity?.file.path !== entity.file.path) {
                    item.style.background = 'var(--background-modifier-hover)';
                }
            };
            item.onmouseleave = () => {
                if (this.selectedEntity?.file.path !== entity.file.path) {
                    item.style.background = '';
                }
            };

            item.onclick = () => {
                this.selectedEntity = entity;
                this._renderEntityList();
                this._renderEntityDetail(entity);
            };
        }
    }

    private _renderEmptyDetail(): void {
        this.detailEl.empty();
        const empty = this.detailEl.createDiv({
            attr: {
                style:
                    'display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; color:var(--text-muted);',
            },
        });
        empty.createSpan({
            text: '📝',
            attr: { style: 'font-size:48px; margin-bottom:16px; opacity:0.5;' },
        });
        empty.createSpan({
            text: '选择左侧实体查看详情',
            attr: { style: 'font-size:0.95em;' },
        });
    }

    private async _renderEntityDetail(entity: EntityItem): Promise<void> {
        this.detailEl.empty();

        const header = this.detailEl.createDiv({
            attr: {
                style:
                    'margin-bottom:16px; border-bottom:1px solid var(--background-modifier-border); padding-bottom:12px;',
            },
        });

        const titleRow = header.createDiv({
            attr: { style: 'display:flex; align-items:center; gap:10px; margin-bottom:4px;' },
        });

        const catInfo = this.categoryTabMap[entity.category];
        titleRow.createSpan({
            text: catInfo.icon,
            attr: { style: 'font-size:24px;' },
        });
        titleRow.createEl('h3', {
            text: entity.name,
            attr: { style: 'margin:0; font-size:20px;' },
        });

        header.createSpan({
            text: `${catInfo.label} · ${entity.file.path}`,
            attr: { style: 'color:var(--text-muted); font-size:0.8em;' },
        });

        const actionRow = header.createDiv({
            attr: { style: 'display:flex; gap:8px; margin-top:10px; flex-wrap:wrap;' },
        });

        const openBtn = actionRow.createEl('button', {
            text: '📄 打开文件',
            cls: 'nw-btn',
        });
        openBtn.style.cssText =
            'font-size:0.82em; padding:5px 12px; border:1px solid var(--background-modifier-border); background:var(--background-secondary);';
        openBtn.onclick = () => {
            const file = entity.file;
            this.app.workspace.getLeaf().openFile(file);
        };

        const editBtn = actionRow.createEl('button', {
            text: '✏️ 编辑实体',
            cls: 'nw-btn',
        });
        editBtn.style.cssText =
            'font-size:0.82em; padding:5px 12px; border:1px solid var(--background-modifier-border); background:var(--background-secondary);';
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
            const tagsRow = header.createDiv({
                attr: { style: 'display:flex; gap:6px; margin-top:10px; flex-wrap:wrap;' },
            });
            tagsRow.createSpan({
                text: '🏷️',
                attr: { style: 'font-size:0.9em;' },
            });
            for (const tag of entity.model.tags) {
                tagsRow.createEl('span', {
                    text: tag,
                    attr: {
                        style:
                            'font-size:0.8em; padding:2px 8px; border-radius:10px; background:var(--background-secondary); color:var(--text-muted);',
                    },
                });
            }
        }

        const model = entity.model;
        if (model) {
            this._renderEntityFields(model);
        }

        const content = await this.app.vault.read(entity.file);
        const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim();

        if (body) {
            const bodySection = this.detailEl.createDiv({
                attr: { style: 'margin-top:16px;' },
            });
            bodySection.createEl('h4', {
                text: '📖 详细描述',
                attr: {
                    style:
                        'margin:0 0 8px 0; font-size:1em; color:var(--text-accent);',
                },
            });
            const bodyDiv = bodySection.createDiv({
                attr: { style: 'font-size:0.92em; line-height:1.6;' },
            });
            await MarkdownRenderer.render(
                this.app,
                body,
                bodyDiv,
                entity.file.path,
                this.plugin,
            );
        }

        this._renderRelations(entity);
    }

    private _renderEntityFields(model: AnyEntityDomainModel): void {
        const section = this.detailEl.createDiv({
            attr: { style: 'margin-bottom:16px;' },
        });

        section.createEl('h4', {
            text: '📋 基本信息',
            attr: {
                style:
                    'margin:0 0 10px 0; font-size:1em; color:var(--text-accent);',
            },
        });

        const grid = section.createDiv({
            attr: {
                style:
                    'display:grid; grid-template-columns:auto 1fr; gap:6px 16px; font-size:0.9em;',
            },
        });

        const addField = (label: string, value: string | undefined) => {
            if (!value) return;
            grid.createSpan({
                text: label,
                attr: {
                    style:
                        'color:var(--text-muted); font-weight:500; white-space:nowrap;',
                },
            });
            grid.createSpan({ text: value, attr: { style: 'color:var(--text-normal);' } });
        };

        switch (model.category) {
            case 'character':
                addField('年龄', model.age);
                addField('身份', model.identity);
                addField('性别', model.gender);
                addField('所属势力', model.faction);
                addField('当前位置', model.currentLocation);
                addField('修为等级', model.cultivationLevel);
                addField('金手指', model.specialAbility);
                addField('首次出场', model.firstAppearance);
                addField('核心动机', model.coreMotivation);
                addField('当前状态', model.currentStatus);
                break;
            case 'faction':
                addField('别称', model.alias);
                addField('类型', model.type);
                addField('领袖', model.leader);
                addField('地位排名', model.rank);
                break;
            case 'location':
                addField('别称', model.alias);
                addField('类型', model.type);
                addField('重要程度', model.importance);
                addField('地理特征', model.geography);
                addField('主要居民', model.inhabitants);
                addField('所在区域', model.worldRegion);
                break;
            case 'item':
                addField('类型', model.type);
                addField('品阶', model.grade);
                addField('效果', model.effect);
                addField('持有者', model.owner);
                break;
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

        const section = this.detailEl.createDiv({
            attr: { style: 'margin-top:16px; padding-top:16px; border-top:1px solid var(--background-modifier-border);' },
        });

        section.createEl('h4', {
            text: '🔗 实体关联',
            attr: {
                style:
                    'margin:0 0 10px 0; font-size:1em; color:var(--text-accent);',
            },
        });

        for (const rel of relations) {
            const relRow = section.createDiv({
                attr: {
                    style:
                        'display:flex; align-items:center; gap:8px; padding:6px 0; font-size:0.9em;',
                },
            });

            relRow.createSpan({
                text: rel.label,
                attr: { style: 'color:var(--text-muted); min-width:80px;' },
            });

            const linkBtn = relRow.createEl('button', {
                text: `${rel.value} →`,
                attr: {
                    style:
                        'cursor:pointer; border:none; background:var(--background-secondary); color:var(--text-accent); padding:2px 10px; border-radius:4px; font-size:0.9em;',
                },
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
