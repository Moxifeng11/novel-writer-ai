/**
 * mini-settings-modal.ts — 设置弹窗（与设置页共用同一批分区）
 *
 * 旧实现 2755 行，内联复制了 API/协同/写作/指纹/知识库/拆解等分区，
 * 与 ui/settings-tab.ts 双份维护，字段校验与保存语义经常漂移。
 * 现在弹窗只负责外壳 + tab 调度，分区实现统一来自
 * `ui/settings/section-factory.ts`。
 */
import { App, Modal } from 'obsidian';
import type NovelWriterPlugin from '@/main';
import type { SettingsSectionHost } from './settings/section-base';
import { SETTINGS_TAB_DEFINITIONS, createSettingsSection } from './settings/section-factory';

/** 设置弹窗。 */
export class MiniSettingsModal extends Modal {
    private readonly plugin: NovelWriterPlugin;
    private activeTab: string;
    private tabContent: HTMLElement | null = null;
    private tabBar: HTMLElement | null = null;

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

    /** 打开弹窗：构建 tab 外壳并渲染当前分区。 */
    onOpen(): void {
        this.modalEl.addClass('nw-scope', 'nw-modal', 'nw-settings-modal');
        this.titleEl.setText('⚙️ 设置');
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('nw-mini-settings');

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

    private renderTabs(): void {
        if (!this.tabBar) return;
        this.tabBar.empty();
        for (const tab of SETTINGS_TAB_DEFINITIONS) {
            const btn = this.tabBar.createEl('button', {
                text: tab.label,
                cls: `nw-mini-settings-tab${tab.id === this.activeTab ? ' is-active' : ''}`,
            });
            btn.addEventListener('click', () => {
                if (tab.id === this.activeTab) return;
                this.activeTab = tab.id;
                this.renderTabs();
                this.renderActive();
            });
        }
    }

    private renderActive(): void {
        if (!this.tabContent) return;
        this.tabContent.empty();
        const section = createSettingsSection(this.activeTab, this.host);
        if (!section) {
            this.tabContent.createEl('p', { text: `未知设置页签：${this.activeTab}` });
            return;
        }
        section.render(this.tabContent);
    }
}
