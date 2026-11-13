/**
 * settings-tab.ts — 设置页宿主（tab 栏 + 分区调度 + DOM 缓存）
 *
 * 原文件 5,112 行、57 个方法，已按 tab 分区拆到 `ui/settings/` 下：
 *   api-section / knowledge-section / fingerprint-section / deconstruction-section /
 *   foreshadow-section / writing-sections / general-sections / provider-modals
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
import { SETTINGS_TAB_DEFINITIONS } from './settings/section-factory';
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
     * 渲染「语义关键词」设置（C 类词表可配置化）。
     *
     * 内置词表没覆盖某个说法时，用户在这里追加即可，无需改代码。
     * 判定顺序仍是「结构化字段 → 词表兜底」，追加词只影响兜底层。
     *
     * @param containerEl - 容器
     */
    private renderSemanticKeywords(containerEl: HTMLElement): void {
        const overrides = this.plugin.settings.semanticKeywordOverrides ?? {};
        const section = containerEl.createDiv({ cls: 'nw-settings-section' });
        new Setting(section)
            .setName('🧩 语义关键词（追加）')
            .setDesc('内置词表没覆盖的说法可在此补充，逗号分隔。仅影响「词表兜底」层，不改变结构化判定。')
            .setHeading();
        const fields: Array<{ key: keyof NonNullable<typeof overrides>; name: string }> = [
            { key: 'injury', name: '伤情词' },
            { key: 'action', name: '行动词' },
            { key: 'modern', name: '现代词（时代错位）' },
            { key: 'location', name: '地点词' },
            { key: 'drastic', name: '剧变词（死亡/重伤/能力变化）' },
        ];
        new Setting(section)
            .setName('AI 高频词（统计）')
            .setDesc('用于「AI 味」统计，逗号分隔。仅影响统计口径，不改变正文。')
            .addTextArea(text => text
                .setPlaceholder('逗号分隔，如：不禁, 仿佛')
                .setValue((this.plugin.settings.extraAiHighFreqWords ?? []).join(', '))
                .onChange(async value => {
                    this.plugin.settings.extraAiHighFreqWords = value
                        .split(/[,，\s]+/).map(w => w.trim()).filter(Boolean);
                    await this.plugin.saveSettings();
                }));
        for (const field of fields) {
            new Setting(section)
                .setName(field.name)
                .addTextArea(text => text
                    .setPlaceholder('逗号分隔，如：断魂, 气若游丝')
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

    display(): void {
        const { containerEl } = this;

        containerEl.empty();

        new Setting(containerEl).setName('📖 设置').setHeading();

        this.performance.renderBanner(containerEl);
        this.renderSemanticKeywords(containerEl);

        this.tabBar = containerEl.createDiv({ cls: 'nw-settings-tabbar' });
        const showAdvanced = this.plugin.settings.settingsUiShowAdvanced === true;
        if (!showAdvanced && SETTINGS_TABS.find(tab => tab.id === this.activeTab)?.group === 'advanced') {
            this.activeTab = 'api';
        }
        const renderTabBar = (): void => {
            if (!this.tabBar) return;
            this.tabBar.empty();
            const advancedOpen = this.plugin.settings.settingsUiShowAdvanced === true;
            const visible = SETTINGS_TABS.filter(tab => tab.group === 'primary' || advancedOpen);
            for (const tab of visible) {
                const tabEl = this.tabBar.createDiv({
                    cls: 'nw-settings-tab',
                    text: tab.label,
                    attr: { 'data-tab-id': tab.id },
                });
                if (tab.id === this.activeTab) tabEl.addClass('active');
                tabEl.addEventListener('click', () => {
                    // 重复点击当前 tab 不做任何事，避免无谓重建
                    if (this.activeTab === tab.id) return;
                    this.activeTab = tab.id;
                    this.renderActiveTab(false);
                });
            }
            const toggle = this.tabBar.createDiv({
                cls: 'nw-settings-tab nw-settings-tab-advanced-toggle',
                text: advancedOpen ? '⚙ 收起高级' : '⚙ 高级设置',
            });
            toggle.addEventListener('click', () => {
                this.plugin.settings.settingsUiShowAdvanced = !advancedOpen;
                void this.plugin.saveSettings();
                if (advancedOpen
                    && SETTINGS_TABS.find(tab => tab.id === this.activeTab)?.group === 'advanced') {
                    this.activeTab = 'api';
                    this.renderActiveTab(false);
                }
                renderTabBar();
            });
        };
        renderTabBar();

        this.tabContent = containerEl.createDiv({ cls: 'nw-settings-tab-content' });
        this.panelCache.clear();
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
            case 'fingerprint': void this.fingerprint.render(container); break;
            case 'knowledge': void this.knowledge.render(container); break;
            case 'deconstruction': this.deconstruction.render(container); break;
            case 'foreshadow': this.foreshadow.render(container); break;
            case 'template': void this.template.render(container); break;
            case 'rules': void this.rules.render(container); break;
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
