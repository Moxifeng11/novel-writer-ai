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
import { App, Notice, PluginSettingTab } from 'obsidian';
import NovelWriterPlugin, { DEFAULT_SETTINGS } from '../main';
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
    PromptsSection,
    RulesSection,
    AboutSection,
    RecognitionSection,
    SuggestionsSection,
} from './settings/general-sections';
import { AgentBackendSection } from './settings/agent-section';

const SETTINGS_TABS: ReadonlyArray<{ id: string; label: string }> = [
    { id: 'api', label: '🔌 API 配置' },
    { id: 'cowrite', label: '🖥 协同写作' },
    { id: 'writing', label: '✍️ 写作配置' },
    { id: 'recognition', label: '🎭 角色识别' },
    { id: 'suggestions', label: '💡 建议设置' },
    { id: 'template', label: '📋 模板管理' },
    { id: 'fingerprint', label: '🔍 写作指纹库' },
    { id: 'knowledge', label: '📚 写作知识库' },
    { id: 'deconstruction', label: '🧬 拆解引擎' },
    { id: 'foreshadow', label: '🔮 伏笔管理' },
    { id: 'rules', label: '📜 规则版本' },
    { id: 'appearance', label: '🎨 外观设置' },
    { id: 'layout', label: '🧩 工作台布局' },
    { id: 'projects', label: '🗂 项目库迁移' },
    { id: 'performance', label: '📈 性能监控' },
    { id: 'agent', label: '🤖 Agent 后端' },
    { id: 'about', label: 'ℹ️ 关于' },
];

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
    private template: TemplateSection;
    private appearance: AppearanceSection;
    private projectLibrary: ProjectLibrarySection;
    private layout: LayoutSection;
    private performance: PerformanceSection;
    private prompts: PromptsSection;
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
        this.template = new TemplateSection(host);
        this.appearance = new AppearanceSection(host);
        this.projectLibrary = new ProjectLibrarySection(host);
        this.layout = new LayoutSection(host);
        this.performance = new PerformanceSection(host);
        this.prompts = new PromptsSection(host);
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

    display(): void {
        const { containerEl } = this;

        containerEl.empty();

        containerEl.createEl('h2', { text: '📖 小说工坊 AI 设置' });

        this.performance.renderBanner(containerEl);

        this.tabBar = containerEl.createDiv({ cls: 'nw-settings-tabbar' });
        for (const tab of SETTINGS_TABS) {
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
                this.plugin._pendingReloadState = {
                    project: view.project || '',
                    chapterFileName: view.chapterName || '',
                    volume: view.volume || '',
                    chapDir: view.chapDir || ''
                };
            }
            this.app.plugins.disablePlugin('novel-writer-ai');
            await this.app.plugins.enablePlugin('novel-writer-ai');
            new Notice('✅ 插件已重新加载');
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

    async resetSettings(): Promise<void> {
        this.plugin.settings = Object.assign({}, DEFAULT_SETTINGS);
        await this.plugin.saveSettings();
        this.renderActiveTab();
        new Notice('✅ 设置已重置', 3000);
    }
}
