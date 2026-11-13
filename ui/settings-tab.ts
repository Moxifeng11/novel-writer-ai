/**
 * settings-tab.ts — 设置页宿主（一级分组栏 + tab 栏 + 分区调度 + DOM 缓存）
 *
 * 原文件 5,112 行、57 个方法，已按 tab 分区拆到 `ui/settings/` 下：
 *   api-section / knowledge-section / fingerprint-section / deconstruction-section /
 *   foreshadow-section / mode-section / agent-section / writing-sections / general-sections
 * 装配关系唯一来源是 `ui/settings/section-factory.ts`：
 *   - SETTINGS_TAB_DEFINITIONS：18 个 tab 的 id/label/primary-advanced
 *   - SETTINGS_GROUPS：6 个一级功能域（v4.96 起「一级分组 → 二级 tab」两级结构）
 * 各分区只通过 `SettingsSectionHost`（app / plugin / refresh / reopen）与宿主交互。
 *
 * tab 缓存策略（C3 性能）：
 *   - 纯切换 tab（没改任何设置）→ 复用上次渲染的 DOM，不重建；
 *   - 任何设置变更走 `refresh()` → 清空全部缓存并重绘当前 tab，
 *     保证「A 分区改了设置、B 分区显示旧值」不会发生；
 *   - 异步加载类分区（知识库 / 指纹库 / 规则版本）命中缓存时不会自动重新拉数据，
 *     需要新鲜数据请点分区内的刷新按钮或重开设置页。
 */
import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import NovelWriterPlugin, { DEFAULT_SETTINGS } from '@/main';
import type { SettingsSectionHost } from './settings/section-base';
import { ApiSection } from './settings/api-section';
import { KnowledgeSection } from './settings/knowledge-section';
import { FingerprintSection } from './settings/fingerprint-section';
import { DeconstructionSection } from './settings/deconstruction-section';
import { ForeshadowSection } from './settings/foreshadow-section';
import {
    CoWriteSection,
    WritingSection,
    TemplateSection,
    AppearanceSection,
    ProjectLibrarySection,
    LayoutSection,
} from './settings/writing-sections';
import {
    PerformanceSection,
    RulesSection,
    AboutSection,
    RecognitionSection,
    SuggestionsSection,
} from './settings/general-sections';
import { AgentBackendSection } from './settings/agent-section';
import { ModeSection } from './settings/mode-section';
import { SETTINGS_GROUPS, SETTINGS_TAB_DEFINITIONS } from './settings/section-factory';
import { savePendingReloadState } from '@/shared/reload-state';

const SETTINGS_TABS: ReadonlyArray<{ id: string; label: string; group: 'primary' | 'advanced' }> =
    SETTINGS_TAB_DEFINITIONS.map(({ id, label, group }) => ({ id, label, group }));


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

    private api: ApiSection;
    private knowledge: KnowledgeSection;
    private fingerprint: FingerprintSection;
    private deconstruction: DeconstructionSection;
    private foreshadow: ForeshadowSection;
    private coWrite: CoWriteSection;
    private writing: WritingSection;
    private modes: ModeSection;
    private template: TemplateSection;
    private appearance: AppearanceSection;
    private projectLibrary: ProjectLibrarySection;
    private layout: LayoutSection;
    private performance: PerformanceSection;
    private rules: RulesSection;
    private about: AboutSection;
    private recognition: RecognitionSection;
    private suggestions: SuggestionsSection;
    private agentBackend: AgentBackendSection;

    constructor(app: App, plugin: NovelWriterPlugin) {
        super(app, plugin);
        this.plugin = plugin;

        const host: SettingsSectionHost = {
            app: this.app,
            plugin: this.plugin,
            refresh: () => this.refresh(),
            reopen: () => this.reopen(),
        };
        this.api = new ApiSection(host);
        this.knowledge = new KnowledgeSection(host);
        this.fingerprint = new FingerprintSection(host);
        this.deconstruction = new DeconstructionSection(host);
        this.foreshadow = new ForeshadowSection(host);
        this.coWrite = new CoWriteSection(host);
        this.writing = new WritingSection(host);
        this.modes = new ModeSection(host);
        this.template = new TemplateSection(host);
        this.appearance = new AppearanceSection(host);
        this.projectLibrary = new ProjectLibrarySection(host);
        this.layout = new LayoutSection(host);
        this.performance = new PerformanceSection(host);
        this.rules = new RulesSection(host);
        this.about = new AboutSection(host);
        this.recognition = new RecognitionSection(host);
        this.suggestions = new SuggestionsSection(host);
        this.agentBackend = new AgentBackendSection(host);
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
     * display 方法。
     */
    /**
     * 渲染「关键词兜底」设置（规则层用）。
     *
     * 内置词表没覆盖某个说法时用户可追加；只影响「词表兜底」层，不改变结构化判定。
     *
     * @param containerEl - 容器
     */
    private renderRuleKeywords(containerEl: HTMLElement): void {
        const overrides = this.plugin.settings.semanticKeywordOverrides ?? {};
        const section = containerEl.createDiv({ cls: 'nw-settings-section' });
        new Setting(section)
            .setName('🧩 关键词兜底（追加）')
            .setDesc('内置词表没覆盖的说法可在此补充（逗号分隔）。只影响「词表兜底」层，不改变结构化判定。')
            .setHeading();
        const fields: Array<{
            key: keyof NonNullable<typeof overrides>;
            name: string;
            hint: string;
        }> = [
            { key: 'injury', name: '伤情词', hint: '逗号分隔，如：气若游丝, 命悬一线' },
            { key: 'action', name: '行动词', hint: '逗号分隔，如：疾掠, 腾挪' },
            { key: 'modern', name: '现代词（时代错位）', hint: '逗号分隔，如：平板, 智能机' },
            { key: 'location', name: '地点词', hint: '逗号分隔，如：坊市, 渡口' },
            { key: 'drastic', name: '剧变词（死亡/重伤/能力变化）', hint: '逗号分隔，如：形神俱灭, 灰飞烟灭' },
        ];
        for (const field of fields) {
            new Setting(section)
                .setName(field.name)
                .addTextArea(text => text
                    .setPlaceholder(field.hint)
                    .setValue((overrides[field.key] ?? []).join(', '))
                    .onChange(async value => {
                        const words = value.split(/[,，\s]+/).map(w => w.trim()).filter(Boolean);
                        const next = { ...(this.plugin.settings.semanticKeywordOverrides ?? {}) };
                        next[field.key] = words;
                        this.plugin.settings.semanticKeywordOverrides = next;
                        await this.plugin.saveSettings();
                    }));
        }
    }

    /**
     * 渲染「统计词表」设置（风格统计口径用）。
     *
     * 与规则兜底分开：这些词只影响统计数字（AI 味、情绪分布），不参与正文正确性判定。
     *
     * @param containerEl - 容器
     */
    private renderStatKeywords(containerEl: HTMLElement): void {
        const section = containerEl.createDiv({ cls: 'nw-settings-section' });
        new Setting(section)
            .setName('📊 统计词表（追加）')
            .setDesc('只影响风格与 AI 味统计口径，不改变正文判定。')
            .setHeading();
        new Setting(section)
            .setName('AI 高频词')
            .setDesc('用于「AI 味」统计，逗号分隔。')
            .addTextArea(text => text
                .setPlaceholder('逗号分隔，如：不禁, 仿佛')
                .setValue((this.plugin.settings.extraAiHighFreqWords ?? []).join(', '))
                .onChange(async value => {
                    this.plugin.settings.extraAiHighFreqWords = value
                        .split(/[,，\s]+/).map(w => w.trim()).filter(Boolean);
                    await this.plugin.saveSettings();
                }));
        const styleFields: Array<{ key: 'positiveEmotion' | 'negativeEmotion' | 'highIntensity'; name: string; hint: string }> = [
            { key: 'positiveEmotion', name: '正面情绪词', hint: '逗号分隔，如：欣悦, 释然' },
            { key: 'negativeEmotion', name: '负面情绪词', hint: '逗号分隔，如：郁结, 惶然' },
            { key: 'highIntensity', name: '高强度情绪词', hint: '逗号分隔，如：暴怒, 狂喜' },
        ];
        for (const field of styleFields) {
            new Setting(section)
                .setName(field.name)
                .addTextArea(text => text
                    .setPlaceholder(field.hint)
                    .setValue(((this.plugin.settings.styleKeywordOverrides ?? {})[field.key] ?? []).join(', '))
                    .onChange(async value => {
                        const next = { ...(this.plugin.settings.styleKeywordOverrides ?? {}) };
                        next[field.key] = value.split(/[,，\s]+/).map(w => w.trim()).filter(Boolean);
                        this.plugin.settings.styleKeywordOverrides = next;
                        await this.plugin.saveSettings();
                    }));
        }
    }

    display(): void {
        const { containerEl } = this;

        containerEl.empty();

        new Setting(containerEl).setName('📖 设置').setHeading();

        this.performance.renderBanner(containerEl);

        const showAdvanced = this.plugin.settings.settingsUiShowAdvanced === true;
        const groupOfTab = (tabId: string): string =>
            SETTINGS_GROUPS.find(group => group.tabs.includes(tabId))?.id ?? SETTINGS_GROUPS[0].id;
        const visibleTabsOfGroup = (groupId: string): Array<(typeof SETTINGS_TABS)[number]> => {
            const group = SETTINGS_GROUPS.find(item => item.id === groupId) ?? SETTINGS_GROUPS[0];
            const advancedOpen = this.plugin.settings.settingsUiShowAdvanced === true;
            const tabs: Array<(typeof SETTINGS_TABS)[number]> = [];
            for (const id of group.tabs) {
                const tab = SETTINGS_TABS.find(item => item.id === id);
                if (!tab) continue;
                if (!advancedOpen && tab.group === 'advanced') continue;
                tabs.push(tab);
            }
            return tabs;
        };
        this.activeGroup = groupOfTab(this.activeTab);
        if (!visibleTabsOfGroup(this.activeGroup).some(tab => tab.id === this.activeTab)) {
            this.activeTab = visibleTabsOfGroup(this.activeGroup)[0]?.id ?? 'api';
        }

        this.groupBar = containerEl.createDiv({ cls: 'nw-settings-groupbar' });
        this.tabBar = containerEl.createDiv({ cls: 'nw-settings-tabbar' });
        // settings-tab-regroup-fix 修复：renderBars 此前只在分组/tab 的 click 回调里调用，
        // 初次 display() 时 groupBar/tabBar 是空 div——6 个一级分组 pill 与二级 tab
        // 在 Obsidian 里全部不显示。必须在首屏主动渲染一次。
        const renderBars = (): void => {
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
                    this.activeGroup = group.id;
                    this.activeTab = visibleTabsOfGroup(group.id)[0]?.id ?? 'api';
                    renderBars();
                    this.renderActiveTab(false);
                });
            }
            this.tabBar.empty();
            for (const tab of visibleTabsOfGroup(this.activeGroup)) {
                const tabEl = this.tabBar.createDiv({
                    cls: 'nw-settings-tab',
                    text: tab.label,
                    attr: { 'data-tab-id': tab.id },
                });
                if (tab.id === this.activeTab) tabEl.addClass('active');
                tabEl.addEventListener('click', () => {
                    if (this.activeTab === tab.id) return;
                    this.activeTab = tab.id;
                    this.renderActiveTab(false);
                });
            }
            const advancedOpen = this.plugin.settings.settingsUiShowAdvanced === true;
            const toggle = this.tabBar.createDiv({
                cls: 'nw-settings-tab nw-settings-tab-advanced-toggle',
                text: advancedOpen ? '⚙ 收起高级' : '⚙ 高级设置',
            });
            toggle.addEventListener('click', () => {
                this.plugin.settings.settingsUiShowAdvanced = !advancedOpen;
                void this.plugin.saveSettings();
                if (!visibleTabsOfGroup(this.activeGroup).some(tab => tab.id === this.activeTab)) {
                    this.activeTab = visibleTabsOfGroup(this.activeGroup)[0]?.id ?? 'api';
                }
                renderBars();
                this.renderActiveTab(false);
            });
        };

        this.tabContent = containerEl.createDiv({ cls: 'nw-settings-tab-content' });
        this.panelCache.clear();
        // 首屏渲染一级分组栏与二级 tab 栏（修复：此前只有点击后才渲染，初屏为空）
        renderBars();
        this.renderActiveTab(true);

        const reloadBtn = containerEl.createEl('button', {
            text: '🔄 热重载插件',
            attr: { type: 'button', style: 'margin-top:16px;padding:8px 20px;cursor:pointer;background:var(--background-modifier-error);color:var(--text-on-accent);border:none;border-radius:6px;font-size:13px;font-weight:600;' }
        });
        reloadBtn.addEventListener('click', async () => {
            await this.plugin.saveSettings();
            const leaves = this.app.workspace.getLeavesOfType('novel-writer-full-writer');
            if (leaves.length > 0) {
                const view = leaves[0].view as unknown as { project?: string; chapterName?: string; volume?: string; chapDir?: string };
                const pending = {
                    project: view.project || '',
                    chapterFileName: view.chapterName || '',
                    volume: view.volume || '',
                    chapDir: view.chapDir || ''
                };
                this.plugin._pendingReloadState = pending;
                // O-3：新实例拿不到旧实例的内存字段，必须落到同一窗口的
                // sessionStorage（10 分钟 TTL、读取即删），否则「自动恢复」是空话。
                if (pending.project) savePendingReloadState(pending);
            }
            // Obsidian 开发者政策禁止插件自行 disable/enable 自身（会被判为
            // 「静默执行新下载代码」而拒绝上架）。改为提示用户手动切换；
            // _pendingReloadState 已在上面写入，手动切换后 onload 会恢复工作台。
            await this.plugin.saveSettings();
            new Notice('请在「设置 → 第三方插件」中关闭再启用「小说工坊 AI」完成重载（工作台状态会自动恢复）', 6000);
        });
    }

    /**
     * 渲染当前 tab。
     * @param rebuild 为 true 时清空全部 tab 缓存（设置变更后的默认行为）；
     *                为 false 时仅切换显示，命中缓存则不重建 DOM。
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

    private renderSection(tabId: string, container: HTMLElement): void {
        switch (tabId) {
            case 'api': this.api.render(container); break;
            case 'cowrite': this.coWrite.render(container); break;
            case 'writing': this.writing.render(container); break;
            case 'modes': this.modes.render(container); break;
            case 'recognition': this.recognition.render(container); break;
            case 'suggestions': this.suggestions.render(container); break;
            case 'fingerprint':
                void this.fingerprint.render(container);
                // 统计口径词表与风格指纹同处一个 tab
                this.renderStatKeywords(container);
                break;
            case 'knowledge': void this.knowledge.render(container); break;
            case 'deconstruction': this.deconstruction.render(container); break;
            case 'foreshadow': this.foreshadow.render(container); break;
            case 'template': void this.template.render(container); break;
            case 'rules':
                void this.rules.render(container);
                // 语义关键词属于规则层兜底配置，收进「规则」tab（不再堆在设置页顶部）
                this.renderRuleKeywords(container);
                break;
            case 'appearance': this.appearance.render(container); break;
            case 'layout': this.layout.render(container); break;
            case 'projects': this.projectLibrary.render(container); break;
            case 'performance': this.performance.render(container); break;
            case 'agent': this.agentBackend.render(container); break;
            case 'about': this.about.render(container); break;
        }
    }

    /**
     * 重置设置列表。
     */
    async resetSettings(): Promise<void> {
        this.plugin.settings = Object.assign({}, DEFAULT_SETTINGS);
        await this.plugin.saveSettings();
        this.renderActiveTab();
        new Notice('✅ 设置已重置', 3000);
    }
}
