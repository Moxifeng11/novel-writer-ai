/**
 * project-side-panel-view.ts — 右侧「项目速览」面板
 *
 * 挂在右侧 dock（可折叠界面），跟随当前活动笔记：
 *  1. 本文件属性：按 frontmatter-schema 渲染可内联编辑的属性；
 *  2. 标签：展示当前文件全部标签，`nw/*` 高亮，点击复制 `tag:#…` 查询；
 *  3. 快捷动作：按文件类型给生成/协同/结算/看板入口。
 *
 * 设计取舍：属性面板本身只能看/改，不能触发生成；这里补齐「动作」这一层，
 * 同时沿用 Obsidian 原生属性与标签面板（双标签 + Bases 看板）。
 */
import { ItemView, Notice, TFile, WorkspaceLeaf, setIcon } from 'obsidian';
import type NovelWriterPlugin from '../main';
import { STORAGE_KEYS } from '../shared/storage-keys';
import {
    FILE_KIND_LABELS,
    FRONTMATTER_SCHEMAS,
    findMissingProperties,
    readTagList,
    resolveFileKind,
    type NotebookFileKind,
    type PropertySpec,
} from '../shared/frontmatter-schema';
import { isNamespaceTag } from '../shared/tag-taxonomy';
import {
    applyPropertyCompletion,
    planPropertyCompletionForFile,
    writeProjectBases,
} from '../engine/note-properties-service';
import { CommandIds } from '../shared/command-ids';
import { createLogger } from '../shared/logger';

const log = createLogger('ProjectSidePanel');

export const VIEW_TYPE_PROJECT_SIDE_PANEL = 'novel-writer-project-side-panel';

export interface PanelActionSpec {
    id: string;
    label: string;
    icon: string;
}

/**
 * 纯函数：按文件类型给出动作清单（单测直接验证，不需要 DOM）。
 * @param kind - 种类
 * @returns 结果数组
 */
export function actionsForKind(kind: NotebookFileKind): PanelActionSpec[] {
    switch (kind) {
        case 'body':
            return [
                { id: 'open-chapter', label: '打开章节工作台', icon: 'file-text' },
                { id: 'open-cowrite', label: '打开协同写作', icon: 'pen-line' },
                { id: 'settle', label: '章节结算', icon: 'check-check' },
                { id: 'open-board', label: '章节进度看板', icon: 'table' },
            ];
        case 'character':
        case 'location':
        case 'faction':
        case 'item':
            return [
                { id: 'open-board', label: '打开实体看板', icon: 'table' },
                { id: 'open-backlinks', label: '查看提及位置', icon: 'links-coming-in' },
            ];
        case 'worldview':
        case 'settingLib':
        case 'foreshadow':
        case 'timeline':
            return [{ id: 'open-board', label: '打开设定看板', icon: 'table' }];
        case 'step':
            return [{ id: 'open-chapter', label: '打开所属章节', icon: 'file-text' }];
        default:
            return [
                { id: 'open-selector', label: '项目与章节', icon: 'library' },
                { id: 'generate-bases', label: '生成项目看板', icon: 'layout-dashboard' },
            ];
    }
}

/**
 * 该类型下哪些属性可编辑（unknown/无 schema 则空）
 *
 * @param kind - 种类
 * @returns 结果数组
 */
export function editableProperties(kind: NotebookFileKind): PropertySpec[] {
    return FRONTMATTER_SCHEMAS[kind] || [];
}

export class ProjectSidePanelView extends ItemView {
    private readonly plugin: NovelWriterPlugin;
    private collapsed = new Set<string>();
    private fileListener: (() => void) | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: NovelWriterPlugin) {
        super(leaf);
        this.plugin = plugin;
        this.loadCollapsed();
    }

    getViewType(): string {
        return VIEW_TYPE_PROJECT_SIDE_PANEL;
    }

    getDisplayText(): string {
        return '小说工坊 · 项目速览';
    }

    getIcon(): string {
        return 'sidebar-right';
    }

    async onOpen(): Promise<void> {
        this.contentEl.empty();
        this.contentEl.addClass('nw-scope', 'nw-side-panel');

        const refresh = (): void => { void this.render(); };
        this.registerEvent(this.app.workspace.on('file-open', refresh));
        this.registerEvent(this.app.metadataCache.on('changed', (file) => {
            if (file.path === this.app.workspace.getActiveFile()?.path) refresh();
        }));

        await this.render();
    }

    private loadCollapsed(): void {
        try {
            const raw = localStorage.getItem(STORAGE_KEYS.sidePanelCollapsed);
            if (raw) this.collapsed = new Set(JSON.parse(raw) as string[]);
        } catch {
            this.collapsed = new Set();
        }
    }

    private saveCollapsed(): void {
        try {
            localStorage.setItem(STORAGE_KEYS.sidePanelCollapsed, JSON.stringify([...this.collapsed]));
        } catch {
            // 忽略：折叠状态只是体验优化
        }
    }

    private section(container: HTMLElement, id: string, title: string): HTMLElement {
        const wrap = container.createDiv({ cls: 'nw-side-panel-section' });
        const header = wrap.createDiv({ cls: 'nw-side-panel-section-head' });
        const isCollapsed = this.collapsed.has(id);
        const toggle = header.createSpan({
            cls: 'nw-side-panel-toggle',
            text: isCollapsed ? '▶' : '▼',
        });
        header.createSpan({ cls: 'nw-side-panel-section-title', text: title });
        const body = wrap.createDiv({ cls: 'nw-side-panel-section-body' });
        body.toggleClass('is-collapsed', isCollapsed);
        header.addEventListener('click', () => {
            const nowCollapsed = !this.collapsed.has(id);
            if (nowCollapsed) this.collapsed.add(id);
            else this.collapsed.delete(id);
            toggle.setText(nowCollapsed ? '▶' : '▼');
            body.toggleClass('is-collapsed', nowCollapsed);
            this.saveCollapsed();
        });
        return body;
    }

    async render(): Promise<void> {
        const container = this.contentEl;
        container.empty();

        const file = this.app.workspace.getActiveFile();
        const head = container.createDiv({ cls: 'nw-side-panel-head' });
        head.createSpan({ cls: 'nw-side-panel-title', text: '项目速览' });
        const refreshBtn = head.createEl('button', { cls: 'nw-side-panel-icon-btn', attr: { 'aria-label': '刷新' } });
        setIcon(refreshBtn, 'refresh-cw');
        refreshBtn.addEventListener('click', () => { void this.render(); });

        if (!file || !(file instanceof TFile)) {
            container.createDiv({ cls: 'nw-side-panel-empty', text: '未打开笔记。打开章节或实体卡后，这里会显示可编辑属性与快捷动作。' });
            const actions = this.section(container, 'actions', '快捷动作');
            this.renderActions(actions, actionsForKind('unknown'), null);
            return;
        }

        const cache = this.app.metadataCache.getFileCache(file);
        const frontmatter = (cache?.frontmatter as Record<string, unknown> | undefined) || {};
        const kind = resolveFileKind(frontmatter, file.path);

        const meta = container.createDiv({ cls: 'nw-side-panel-file' });
        meta.createDiv({ cls: 'nw-side-panel-file-name', text: file.basename });
        meta.createDiv({ cls: 'nw-side-panel-file-kind', text: FILE_KIND_LABELS[kind] });

        await this.renderProperties(container, file, kind, frontmatter);
        this.renderTags(container, cache?.tags?.map((tag) => tag.tag) || readTagList(frontmatter['tags']));
        this.renderActions(this.section(container, 'actions', '快捷动作'), actionsForKind(kind), file);
    }

    private async renderProperties(
        container: HTMLElement,
        file: TFile,
        kind: NotebookFileKind,
        frontmatter: Record<string, unknown>,
    ): Promise<void> {
        const body = this.section(container, 'props', '本文件属性');
        const specs = editableProperties(kind);
        if (specs.length === 0) {
            body.createDiv({ cls: 'nw-side-panel-empty', text: '该类型没有插件管理的属性。' });
            return;
        }

        const missing = findMissingProperties(kind, frontmatter);
        if (missing.length > 0) {
            const warn = body.createDiv({ cls: 'nw-side-panel-warn' });
            warn.setText(`缺少必填属性：${missing.map((spec) => spec.label).join('、')}`);
            const fix = warn.createEl('button', { cls: 'nw-side-panel-link', text: '补齐' });
            fix.addEventListener('click', async () => {
                const plan = planPropertyCompletionForFile(file.path, frontmatter);
                if (!plan) return;
                await applyPropertyCompletion(this.app, [plan]);
                new Notice('✅ 已补齐缺失属性', 3000);
                await this.render();
            });
        }

        for (const spec of specs) {
            const row = body.createDiv({ cls: 'nw-side-panel-prop' });
            row.createSpan({ cls: 'nw-side-panel-prop-label', text: spec.label });
            const raw = frontmatter[spec.key];
            if (spec.type === 'select' && spec.options) {
                const select = row.createEl('select', { cls: 'dropdown' });
                for (const option of spec.options) {
                    select.createEl('option', { value: option, text: option });
                }
                select.value = typeof raw === 'string' ? raw : String(spec.defaultValue ?? spec.options[0]);
                select.addEventListener('change', () => { void this.writeProperty(file, spec.key, select.value); });
                continue;
            }
            if (spec.type === 'number') {
                const input = row.createEl('input', { cls: 'nw-side-panel-input', attr: { type: 'number' } });
                input.value = raw === undefined || raw === null ? '' : String(raw);
                input.addEventListener('change', () => {
                    const value = Number(input.value);
                    void this.writeProperty(file, spec.key, Number.isFinite(value) ? value : 0);
                });
                continue;
            }
            const input = row.createEl('input', { cls: 'nw-side-panel-input', attr: { type: 'text' } });
            const text = Array.isArray(raw) ? raw.join('、') : raw === undefined || raw === null ? '' : String(raw);
            input.value = text;
            if (spec.describe) input.setAttr('title', spec.describe);
            input.addEventListener('change', () => {
                const value = input.value.trim();
                if (spec.type === 'list') {
                    const list = value.split(/[、,，;；]/).map((item) => item.trim()).filter(Boolean);
                    void this.writeProperty(file, spec.key, list);
                } else {
                    void this.writeProperty(file, spec.key, value);
                }
            });
        }
    }

    private renderTags(container: HTMLElement, tags: string[]): void {
        const body = this.section(container, 'tags', `标签（${tags.length}）`);
        if (tags.length === 0) {
            body.createDiv({ cls: 'nw-side-panel-empty', text: '该笔记没有标签。' });
            return;
        }
        const row = body.createDiv({ cls: 'nw-side-panel-tags' });
        for (const tag of tags) {
            const normalized = tag.replace(/^#/, '');
            const chip = row.createSpan({
                cls: isNamespaceTag(normalized) ? 'nw-side-panel-tag is-ns' : 'nw-side-panel-tag',
                text: `#${normalized}`,
            });
            chip.addEventListener('click', () => {
                const query = `tag:#${normalized}`;
                void navigator.clipboard.writeText(query).then(
                    () => new Notice(`已复制检索式：${query}（粘贴到搜索框即可筛出同类笔记）`, 5000),
                    () => new Notice(`检索式：${query}`, 5000),
                );
            });
        }
        body.createDiv({
            cls: 'nw-side-panel-hint',
            text: '层级标签（nw/*）在 Obsidian 标签面板里会折叠成组；点击可复制检索式。',
        });
    }

    private renderActions(body: HTMLElement, actions: PanelActionSpec[], file: TFile | null): void {
        const row = body.createDiv({ cls: 'nw-side-panel-actions' });
        for (const action of actions) {
            const button = row.createEl('button', { cls: 'nw-side-panel-action' });
            const iconEl = button.createSpan({ cls: 'nw-side-panel-action-icon' });
            setIcon(iconEl, action.icon);
            button.createSpan({ text: action.label });
            button.addEventListener('click', () => { void this.runAction(action.id, file); });
        }
    }

    private async writeProperty(file: TFile, key: string, value: string | number | string[]): Promise<void> {
        try {
            const manager = this.app.fileManager as unknown as {
                processFrontMatter?: (target: TFile, fn: (fm: Record<string, unknown>) => void) => Promise<void>;
            };
            if (typeof manager.processFrontMatter === 'function') {
                await manager.processFrontMatter(file, (fm) => { fm[key] = value; });
            } else {
                new Notice('当前环境不支持直接编辑属性，请在笔记属性面板修改', 5000);
                return;
            }
            new Notice(`已更新「${key}」`, 2000);
        } catch (e) {
            log.warn('[ProjectSidePanel] 写入属性失败:', e);
            new Notice(`写入属性失败：${e instanceof Error ? e.message : String(e)}`, 5000);
        }
    }

    private async runAction(actionId: string, file: TFile | null): Promise<void> {
        const project = this.plugin.getActiveProject() ?? '';
        switch (actionId) {
            case 'open-chapter': {
                if (file) {
                    await this.app.workspace.getLeaf('tab').openFile(file);
                } else {
                    await this.plugin.openFullWriterHome();
                }
                return;
            }
            case 'open-cowrite':
                this.plugin.registry.execute(CommandIds.CO_WRITING);
                return;
            case 'settle':
                this.plugin.registry.execute(CommandIds.CHAPTER_SETTLEMENT);
                return;
            case 'open-board': {
                if (!project) {
                    new Notice('请先在工作台选择一个项目', 4000);
                    return;
                }
                await this.openBase(project);
                return;
            }
            case 'generate-bases': {
                if (!project) {
                    new Notice('请先在工作台选择一个项目', 4000);
                    return;
                }
                const written = await writeProjectBases(this.app, project);
                new Notice(`✅ 已生成 ${written.length} 个看板到「${project}/.看板/」`, 6000);
                return;
            }
            case 'open-backlinks': {
                if (!file) return;
                const cache = (this.app.metadataCache as unknown as {
                    getBacklinksForFile?: (target: TFile) => { data?: Record<string, unknown> } | null;
                }).getBacklinksForFile?.(file);
                const links = cache?.data ? Object.keys(cache.data) : [];
                new Notice(
                    links.length > 0
                        ? `被 ${links.length} 处提及：\n${links.slice(0, 8).join('\n')}`
                        : '没有其他笔记提及这个文件',
                    8000,
                );
                return;
            }
            case 'open-selector':
            default:
                await this.plugin.openFullWriterHome();
        }
    }

    /** 打开（必要时生成）章节进度看板 */
    private async openBase(project: string): Promise<void> {
        const path = `${project}/.看板/章节进度.base`;
        let file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) {
            await writeProjectBases(this.app, project);
            file = this.app.vault.getAbstractFileByPath(path);
        }
        if (file instanceof TFile) {
            await this.app.workspace.getLeaf('tab').openFile(file);
            return;
        }
        new Notice('未找到看板文件，请先在命令面板运行「生成项目看板」', 5000);
    }
}