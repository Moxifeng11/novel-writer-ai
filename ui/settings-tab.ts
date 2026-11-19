/**
 * settings-tab.ts — 设置页宿主（一级分组栏 + 二级 tab 栏 + 搜索 + 分区调度 + DOM 缓存）
 *
 * 结构（v4.96，2026-11-16 重构）：
 *   - 一级分组 → 二级 tab 两级导航（20 个 tab，装配表见 `section-factory.ts`）
 *   - 顶部搜索：全局索引跳转 + 当前分区内过滤（见 `settings-search.ts`）
 *   - 装配统一：所有分区都通过 `createSettingsSection` 创建并缓存实例，
 *     不再在本文件手动 `new` 与 `switch` 硬编码（避免与设置弹窗漂移）
 *   - 一级分组记住该组上次停留的二级 tab（会话内记忆）
 *   - 异步分区（知识库/指纹库/拆解/伏笔）顶部显示统一「数据可能过期｜刷新」条
 *
 * tab 缓存策略（C3 性能）：
 *   - 纯切换 tab（没改任何设置）→ 复用上次渲染的 DOM，不重建；
 *   - 任何设置变更走 `refresh()` → 清空全部缓存并重绘当前 tab；
 *   - 异步加载类分区命中缓存时不会自动重新拉数据，用顶部的「刷新」条重新拉取。
 */
import { App, PluginSettingTab, Setting } from 'obsidian';
import NovelWriterPlugin from '@/main';
import type { SettingsSection, SettingsSectionHost } from './settings/section-base';
import { SETTINGS_GROUPS, SETTINGS_TAB_DEFINITIONS, createSettingsSection } from './settings/section-factory';
import { t } from '@/i18n';
import { renderAutoSaveHint } from './settings/autosave-hint';
import {
    buildStaticSearchIndex,
    entryLabel,
    collectRenderedItems,
    filterSettingsItems,
    highlightSettingItem,
    searchSettings,
    type SettingsSearchEntry,
} from './settings/settings-search';

/**
 * NovelWriterSettingTab 类。
 */
export class NovelWriterSettingTab extends PluginSettingTab {
    private plugin: NovelWriterPlugin;
    private activeTab: string = 'api';
    private tabContent!: HTMLElement;
    private tabBar!: HTMLElement;
    /** 一级分组栏（v4.96：6 个功能域） */
    private groupBar!: HTMLElement;
    /** 当前一级分组 id */
    private activeGroup: string = 'connect';
    /** 已渲染 tab 的 DOM 缓存，键为 tab id；`refresh()` 时整体清空 */
    private panelCache = new Map<string, HTMLElement>();
    /** 分区实例缓存：保留分区内部状态（如 API 配置当前选中的渠道） */
    private sections = new Map<string, SettingsSection>();
    /** 每个一级分组上次停留的二级 tab（会话内记忆，D1） */
    private groupTabMemory = new Map<string, string>();
    /** 搜索索引：静态（分组/tab/主题词）+ 动态（已渲染分区的真实项名） */
    private searchIndex: SettingsSearchEntry[] = [];
    private searchInput: HTMLInputElement | null = null;
    private searchResults: HTMLElement | null = null;

    constructor(app: App, plugin: NovelWriterPlugin) {
        super(app, plugin);
        this.plugin = plugin;
        this.searchIndex = buildStaticSearchIndex(SETTINGS_GROUPS, SETTINGS_TAB_DEFINITIONS);
    }

    /** 分区回调：设置项变更后清缓存并重绘当前 tab */
    refresh(): void {
        this.renderActiveTab(true);
    }

    /** 分区回调：整页重开（清缓存 + 重绘 tab 栏与内容） */
    reopen(): void {
        this.display();
    }

    /**
     * 打开指定设置页签（供命令面板 / 工作台入口调用）。
     *
     * @param tabId - 设置页签 id
     * @param itemName - 可选：跳转后定位并高亮的设置项名
     * @returns 是否跳转成功
     * @example
     * plugin.openSettingsTab('mcp');
     */
    openTab(tabId: string, itemName?: string): boolean {
        const definition = SETTINGS_TAB_DEFINITIONS.find(tab => tab.id === tabId);
        if (!definition) return false;
        this.activeTab = tabId;
        this.activeGroup = this.groupOfTab(tabId);
        if (!this.groupBar) return true;
        this.renderBars();
        this.renderActiveTab(false);
        if (itemName) {
            // 异步分区（知识库等）要等内容渲染完才能定位
            setTimeout(() => {
                const panel = this.panelCache.get(tabId);
                if (panel) highlightSettingItem(panel, itemName);
            }, 320);
        }
        return true;
    }

    private host(): SettingsSectionHost {
        return {
            app: this.app,
            plugin: this.plugin,
            refresh: () => this.refresh(),
            reopen: () => this.reopen(),
        };
    }

    /** 取（或创建并缓存）分区实例；不使用手动 new，装配唯一来源是 section-factory */
    private getSection(tabId: string): SettingsSection | null {
        const cached = this.sections.get(tabId);
        if (cached) return cached;
        const section = createSettingsSection(tabId, this.host());
        if (section) this.sections.set(tabId, section);
        return section;
    }

    private groupOfTab(tabId: string): string {
        return SETTINGS_GROUPS.find(group => group.tabs.includes(tabId))?.id ?? SETTINGS_GROUPS[0].id;
    }

    private visibleTabsOfGroup(groupId: string): Array<(typeof SETTINGS_TAB_DEFINITIONS)[number]> {
        const group = SETTINGS_GROUPS.find(item => item.id === groupId) ?? SETTINGS_GROUPS[0];
        const advancedOpen = this.plugin.settings.settingsUiShowAdvanced === true;
        const tabs: Array<(typeof SETTINGS_TAB_DEFINITIONS)[number]> = [];
        for (const id of group.tabs) {
            const tab = SETTINGS_TAB_DEFINITIONS.find(item => item.id === id);
            if (!tab) continue;
            if (!advancedOpen && tab.group === 'advanced') continue;
            tabs.push(tab);
        }
        return tabs;
    }

    display(): void {
        const { containerEl } = this;

        containerEl.empty();
        containerEl.addClass('nw-settings-root');

        new Setting(containerEl).setName(t('settings.shell.title')).setHeading();

        this.renderSearch(containerEl);

        this.groupBar = containerEl.createDiv({ cls: 'nw-settings-groupbar' });
        this.tabBar = containerEl.createDiv({ cls: 'nw-settings-tabbar' });
        this.tabContent = containerEl.createDiv({ cls: 'nw-settings-tab-content' });

        this.activeGroup = this.groupOfTab(this.activeTab);
        if (!this.visibleTabsOfGroup(this.activeGroup).some(tab => tab.id === this.activeTab)) {
            this.activeTab = this.visibleTabsOfGroup(this.activeGroup)[0]?.id ?? 'api';
        }

        this.panelCache.clear();
        this.renderBars();
        this.renderActiveTab(true);
    }

    /**
     * 搜索区：全局索引跳转 + 当前分区过滤（A3）。
     *
     * @param containerEl - 设置页容器
     */
    private renderSearch(containerEl: HTMLElement): void {
        const wrap = containerEl.createDiv({ cls: 'nw-settings-search' });
        this.searchInput = wrap.createEl('input', {
            cls: 'nw-settings-search-input',
            attr: {
                type: 'search',
                placeholder: t('settings.shell.searchPlaceholder'),
                spellcheck: 'false',
            },
        });
        this.searchResults = wrap.createDiv({ cls: 'nw-settings-search-results' });
        this.searchResults.toggleClass('nw-u-d-none', true);

        const input = this.searchInput;
        input.addEventListener('input', () => {
            this.applySearch(input.value);
        });
        input.addEventListener('keydown', event => {
            if (event.key === 'Enter') {
                const first = this.searchResults?.querySelector<HTMLElement>('.nw-settings-search-hit');
                first?.click();
            } else if (event.key === 'Escape') {
                input.value = '';
                this.applySearch('');
                input.blur();
            }
        });
    }

    /**
     * 执行搜索：更新结果列表并过滤当前分区。
     *
     * @param query - 搜索词
     */
    private applySearch(query: string): void {
        const value = query.trim();
        // 当前分区内过滤（A3 第二半）：只切 display，不重建 DOM
        const panel = this.panelCache.get(this.activeTab);
        if (panel) filterSettingsItems(panel, value);
        const results = this.searchResults;
        if (!results) return;
        results.empty();
        if (!value) {
            results.toggleClass('nw-u-d-none', true);
            return;
        }
        const hits = searchSettings(this.searchIndex, value, 12);
        if (hits.length === 0) {
            results.createDiv({ cls: 'nw-settings-search-empty', text: t('settings.shell.searchEmpty') });
            results.toggleClass('nw-u-d-none', false);
            return;
        }
        for (const hit of hits) {
            const row = results.createDiv({ cls: 'nw-settings-search-hit' });
            row.createSpan({ cls: 'nw-settings-search-path', text: `${hit.entry.groupLabel} › ${hit.entry.tabLabel}` });
            const label = entryLabel(hit.entry);
            if (label) {
                row.createSpan({ cls: 'nw-settings-search-item', text: label });
            }
            row.onclick = () => {
                this.openTab(hit.entry.tabId, label || undefined);
                if (this.searchInput) this.searchInput.value = '';
                results.toggleClass('nw-u-d-none', true);
            };
        }
        results.toggleClass('nw-u-d-none', false);
    }

    /** 渲染分组栏与 tab 栏（首屏必须主动调用一次） */
    private renderBars(): void {
        if (!this.groupBar || !this.tabBar) return;
        this.groupBar.empty();
        for (const group of SETTINGS_GROUPS) {
            const groupEl = this.groupBar.createDiv({
                cls: 'nw-settings-group',
                text: group.label,
                attr: { 'data-group-id': group.id },
            });
            if (group.id === this.activeGroup) groupEl.addClass('active');
            groupEl.addEventListener('click', () => {
                if (this.activeGroup === group.id) return;
                // D1：离开前记住该组上次停留的 tab，回来时恢复
                this.groupTabMemory.set(this.activeGroup, this.activeTab);
                this.activeGroup = group.id;
                this.activeTab = this.groupTabMemory.get(group.id)
                    ?? this.visibleTabsOfGroup(group.id)[0]?.id
                    ?? 'api';
                this.clearSearch();
                this.renderBars();
                this.renderActiveTab(false);
            });
        }
        this.tabBar.empty();
        for (const tab of this.visibleTabsOfGroup(this.activeGroup)) {
            const tabEl = this.tabBar.createDiv({
                cls: 'nw-settings-tab',
                text: tab.label,
                attr: { 'data-tab-id': tab.id },
            });
            if (tab.id === this.activeTab) tabEl.addClass('active');
            tabEl.addEventListener('click', () => {
                if (this.activeTab === tab.id) return;
                this.activeTab = tab.id;
                this.groupTabMemory.set(this.activeGroup, tab.id);
                this.clearSearch();
                this.renderActiveTab(false);
            });
        }
        const advancedOpen = this.plugin.settings.settingsUiShowAdvanced === true;
        const toggle = this.tabBar.createDiv({
            cls: 'nw-settings-tab nw-settings-tab-advanced-toggle',
            text: advancedOpen ? t('settings.shell.hideAdvanced') : t('settings.shell.showAdvanced'),
        });
        toggle.addEventListener('click', () => {
            this.plugin.settings.settingsUiShowAdvanced = !advancedOpen;
            void this.plugin.saveSettings();
            if (!this.visibleTabsOfGroup(this.activeGroup).some(tab => tab.id === this.activeTab)) {
                this.activeTab = this.visibleTabsOfGroup(this.activeGroup)[0]?.id ?? 'api';
            }
            this.renderBars();
            this.renderActiveTab(false);
        });
    }

    /** 清空搜索框、结果列表与当前分区过滤 */
    private clearSearch(): void {
        if (this.searchInput) this.searchInput.value = '';
        this.searchResults?.toggleClass('nw-u-d-none', true);
        const panel = this.panelCache.get(this.activeTab);
        if (panel) filterSettingsItems(panel, '');
    }

    /**
     * 渲染当前 tab。
     *
     * @param rebuild - 为 true 时清空全部 tab 缓存（设置变更后的默认行为）；
     *                  为 false 时仅切换显示，命中缓存则不重建 DOM
     */
    private renderActiveTab(rebuild: boolean = true): void {
        if (!this.tabContent) return;
        if (rebuild) this.panelCache.clear();

        this.tabContent.empty();
        this.groupBar?.querySelectorAll('.nw-settings-group').forEach(el => {
            el.toggleClass('active', el.getAttribute('data-group-id') === this.activeGroup);
        });
        this.tabBar.querySelectorAll('.nw-settings-tab').forEach(el => {
            el.toggleClass('active', el.getAttribute('data-tab-id') === this.activeTab);
        });

        let panel = this.panelCache.get(this.activeTab);
        if (!panel) {
            panel = document.createElement('div');
            panel.className = 'nw-settings-panel';
            this.panelCache.set(this.activeTab, panel);
            this.renderSection(this.activeTab, panel);
        }
        this.tabContent.appendChild(panel);
    }

    /**
     * 渲染指定 tab 的分区内容。
     *
     * @param tabId - 页签 id
     * @param container - 目标容器
     */
    private renderSection(tabId: string, container: HTMLElement): void {
        const section = this.getSection(tabId);
        if (!section) {
            container.createEl('p', { text: t('settings.shell.unknownTab', { tabId }) });
            return;
        }
        renderAutoSaveHint(container);
        if (section.asyncLoad) {
            // 统一「数据可能过期」条：异步分区命中缓存时不会自动重拉，用户需要知道能刷新
            const bar = container.createDiv({ cls: 'nw-settings-async-bar' });
            bar.createSpan({ text: t('settings.shell.asyncStale') });
            const btn = bar.createEl('button', { cls: 'nw-settings-async-refresh', text: t('settings.shell.asyncRefresh') });
            btn.onclick = () => this.refresh();
        }
        void section.render(container);
        // 动态索引：把该分区真实设置项名并入搜索索引（静态索引只覆盖主题词）
        setTimeout(() => {
            const group = SETTINGS_GROUPS.find(item => item.tabs.includes(tabId));
            const tab = SETTINGS_TAB_DEFINITIONS.find(item => item.id === tabId);
            if (!group || !tab) return;
            const dynamic = collectRenderedItems(container, {
                groupId: group.id,
                groupLabel: group.label,
                tabId: tab.id,
                tabLabel: tab.label,
            });
            this.mergeDynamicEntries(dynamic);
        }, 400);
    }

    /**
     * 合并动态索引（同一分组/tab/项名只保留一条）。
     *
     * @param entries - 采集到的条目
     */
    private mergeDynamicEntries(entries: SettingsSearchEntry[]): void {
        const seen = new Set(this.searchIndex.map(entry => `${entry.tabId}|${entryLabel(entry)}`));
        let added = false;
        for (const entry of entries) {
            const key = `${entry.tabId}|${entryLabel(entry)}`;
            if (seen.has(key)) continue;
            seen.add(key);
            this.searchIndex.push(entry);
            added = true;
        }
        if (added) this.searchIndex.sort((a, b) => a.tabId.localeCompare(b.tabId));
    }
}
