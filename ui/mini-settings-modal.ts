/**
 * mini-settings-modal.ts — 设置弹窗（与设置页共用同一批分区）
 *
 * 旧实现 2755 行，内联复制了 API/协同/写作/指纹/知识库/拆解等分区，
 * 与 ui/settings-tab.ts 双份维护，字段校验与保存语义经常漂移。
 * 现在弹窗只负责外壳 + tab 调度，分区实现统一来自
 * `ui/settings/section-factory.ts`。
 *
 * 2026-11-16：tab 栏改为「一级分组 + 组内 tab」两行布局，并接入同一套搜索
 * （全局索引跳转 + 当前分区过滤），与设置页语义一致。
 */
import { App, Modal } from 'obsidian';
import type NovelWriterPlugin from '@/main';
import type { SettingsSectionHost } from './settings/section-base';
import { SETTINGS_GROUPS, SETTINGS_TAB_DEFINITIONS, createSettingsSection } from './settings/section-factory';
import {
    buildStaticSearchIndex,
    filterSettingsItems,
    highlightSettingItem,
    searchSettings,
} from './settings/settings-search';

/** 设置弹窗。 */
export class MiniSettingsModal extends Modal {
    private readonly plugin: NovelWriterPlugin;
    private activeTab: string;
    private tabContent: HTMLElement | null = null;
    private tabBar: HTMLElement | null = null;
    private searchResults: HTMLElement | null = null;
    private searchInput: HTMLInputElement | null = null;
    private panel: HTMLElement | null = null;

    /**
     * @param app - Obsidian 应用实例
     * @param plugin - 插件实例
     * @param initialTab - 初始页签 id
     */
    constructor(app: App, plugin: NovelWriterPlugin, initialTab = 'api') {
        super(app);
        this.plugin = plugin;
        this.activeTab = SETTINGS_TAB_DEFINITIONS.some(item => item.id === initialTab) ? initialTab : 'api';
    }

    /** 打开弹窗：构建搜索 + 分组 tab 外壳并渲染当前分区。 */
    onOpen(): void {
        this.modalEl.addClass('nw-scope', 'nw-modal', 'nw-settings-modal');
        this.titleEl.setText('⚙️ 设置');
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('nw-mini-settings');

        const searchWrap = contentEl.createDiv({ cls: 'nw-settings-search nw-settings-search-compact' });
        this.searchInput = searchWrap.createEl('input', {
            cls: 'nw-settings-search-input',
            attr: { type: 'search', placeholder: '搜索设置项…', spellcheck: 'false' },
        });
        this.searchResults = searchWrap.createDiv({ cls: 'nw-settings-search-results' });
        this.searchResults.toggleClass('nw-u-d-none', true);
        const index = buildStaticSearchIndex(SETTINGS_GROUPS, SETTINGS_TAB_DEFINITIONS);
        this.searchInput.addEventListener('input', () => {
            const query = (this.searchInput?.value || '').trim();
            if (this.panel) filterSettingsItems(this.panel, query);
            const results = this.searchResults;
            if (!results) return;
            results.empty();
            if (!query) {
                results.toggleClass('nw-u-d-none', true);
                return;
            }
            const hits = searchSettings(index, query, 10);
            if (hits.length === 0) {
                results.createDiv({ cls: 'nw-settings-search-empty', text: '没有匹配的设置项' });
            } else {
                for (const hit of hits) {
                    const row = results.createDiv({ cls: 'nw-settings-search-hit' });
                    row.createSpan({ cls: 'nw-settings-search-path', text: `${hit.entry.groupLabel} › ${hit.entry.tabLabel}` });
                    if (hit.entry.itemName) {
                        row.createSpan({ cls: 'nw-settings-search-item', text: hit.entry.itemName });
                    }
                    row.onclick = () => {
                        this.switchTab(hit.entry.tabId);
                        if (hit.entry.itemName && this.panel) {
                            setTimeout(() => this.panel && highlightSettingItem(this.panel, hit.entry.itemName || ''), 260);
                        }
                        results.toggleClass('nw-u-d-none', true);
                        if (this.searchInput) this.searchInput.value = '';
                    };
                }
            }
            results.toggleClass('nw-u-d-none', false);
        });

        this.tabBar = contentEl.createDiv({ cls: 'nw-mini-settings-tabs' });
        this.tabContent = contentEl.createDiv({ cls: 'nw-mini-settings-content' });
        this.renderTabs();
        this.renderActive();
    }

    /** 关闭弹窗：清空内容。 */
    onClose(): void {
        this.contentEl.empty();
    }

    private get host(): SettingsSectionHost {
        return {
            app: this.app,
            plugin: this.plugin,
            refresh: () => this.renderActive(),
            reopen: () => this.renderActive(),
        };
    }

    /**
     * 切换页签（同时更新分组高亮与内容）。
     *
     * @param tabId - 页签 id
     */
    private switchTab(tabId: string): void {
        if (!SETTINGS_TAB_DEFINITIONS.some(item => item.id === tabId)) return;
        this.activeTab = tabId;
        this.renderTabs();
        this.renderActive();
    }

    private renderTabs(): void {
        if (!this.tabBar) return;
        this.tabBar.empty();
        const showAdvanced = this.plugin.settings.settingsUiShowAdvanced === true;
        if (!showAdvanced && SETTINGS_TAB_DEFINITIONS.find(tab => tab.id === this.activeTab)?.group === 'advanced') {
            this.activeTab = 'api';
        }
        // 两行布局：一级分组标题 + 组内 tab（与设置页语义一致，S-07）
        for (const group of SETTINGS_GROUPS) {
            const tabs = group.tabs
                .map(id => SETTINGS_TAB_DEFINITIONS.find(tab => tab.id === id))
                .filter((tab): tab is (typeof SETTINGS_TAB_DEFINITIONS)[number] => !!tab)
                .filter(tab => showAdvanced || tab.group !== 'advanced');
            if (tabs.length === 0) continue;
            const row = this.tabBar.createDiv({ cls: 'nw-mini-settings-group' });
            row.createDiv({ cls: 'nw-mini-settings-group-title', text: group.label });
            const items = row.createDiv({ cls: 'nw-mini-settings-group-tabs' });
            for (const tab of tabs) {
                const btn = items.createEl('button', {
                    text: tab.label,
                    cls: `nw-mini-settings-tab${tab.id === this.activeTab ? ' is-active' : ''}`,
                });
                btn.addEventListener('click', () => this.switchTab(tab.id));
            }
        }
        const toggle = this.tabBar.createEl('button', {
            text: showAdvanced ? '⚙ 收起高级' : '⚙ 高级设置',
            cls: 'nw-mini-settings-tab nw-mini-settings-tab-advanced-toggle',
        });
        toggle.addEventListener('click', () => {
            this.plugin.settings.settingsUiShowAdvanced = !showAdvanced;
            void this.plugin.saveSettings();
            if (showAdvanced
                && SETTINGS_TAB_DEFINITIONS.find(tab => tab.id === this.activeTab)?.group === 'advanced') {
                this.activeTab = 'api';
            }
            this.renderTabs();
            this.renderActive();
        });
    }

    private renderActive(): void {
        if (!this.tabContent) return;
        this.tabContent.empty();
        const panel = this.tabContent.createDiv({ cls: 'nw-settings-panel' });
        this.panel = panel;
        const section = createSettingsSection(this.activeTab, this.host);
        if (!section) {
            panel.createEl('p', { text: `未知设置页签：${this.activeTab}` });
            return;
        }
        if (section.asyncLoad) {
            const bar = panel.createDiv({ cls: 'nw-settings-async-bar' });
            bar.createSpan({ text: '数据为加载时快照，可能已过期' });
            const btn = bar.createEl('button', { cls: 'nw-settings-async-refresh', text: '🔄 刷新' });
            btn.onclick = () => this.renderActive();
        }
        void section.render(panel);
    }
}
