import { App, PluginSettingTab, Setting, Notice, Modal } from 'obsidian';
import NovelWriterPlugin, { NovelWriterSettings, DEFAULT_SETTINGS, CustomProvider, DEFAULT_DECONSTRUCTION_ENGINE_SETTINGS, ALL_BREAKDOWN_DIMENSIONS, DIMENSION_LABELS } from '../main';
import type { DeconstructionEngineSettings } from '../main';
import { renderAppearanceSettings } from './appearance-settings';
import { ManageProvidersModal } from './manage-providers-modal';
import { TemplateManager } from './template-manager';
import { getOllamaModelsWithFallback } from '../engine/co-writer-engine';
import { StyleFingerprintLibrary, StyleFingerprint } from '../engine/style-fingerprint-library';
import { FingerprintExtractor } from '../engine/fingerprint-extractor';
import { createFingerprintEmbedding } from './fingerprint-embedding';
import { AddFingerprintModal } from './fingerprint-library-modal';
import { FingerprintDetailModal } from './fingerprint-detail-modal';
import { renderFingerprintList } from './fingerprint-utils';
import { KnowledgeBaseManager, BookBasicInfo } from '../services/knowledge-base-manager';
import { KnowledgeTagManager } from '../engine/knowledge-tags';
import { DeconstructionScheduler } from '../services/deconstruction-scheduler';
import { VectorEnhancer } from '../engine/vector-enhancer';
import { BatchImportModal } from './batch-import-modal';
import { KnowledgeMonitorModal } from './knowledge-monitor-modal';
import { KnowledgeDetailModal } from './knowledge-detail-modal';
import { RefillModal } from './refill-modal';
import { kbKnowledgeBaseDir } from '../shared/paths';
import { openKnowledgeFolder } from './knowledge-folder-navigation';
import { performanceMonitor, PerformanceCategory } from '../services/performance-monitor';
import { ENGINE_NAMES } from '../engine/engine-registry';
import { WorldviewCacheService } from '../services/worldview-cache-service';
import { UpdateChecker } from '../services/update-checker';
import { ChangelogModal } from './changelog-modal';
import { BUILTIN_CHANGELOG } from '../shared/changelog-data';
import { PromptManagerSettings } from './prompt-manager-settings';
import { RulesService } from '../services/rules-service';
import { createLogger } from '../shared/logger';
import { exportTextFile } from '../shared/export-file';
import { OperationConfirmModal } from './components/progress';
import { rebuildKnowledgeIndexWithConfirm } from './knowledge-rebuild-action';
import { rebuildAllVectorsWithConfirm } from './vector-rebuild-action';
import { ForeshadowConfigManager, ForeshadowTypeConfig, DEFAULT_FORESHADOW_CONFIG } from '../engine/foreshadow-config-manager';
import { AntiAIDetector } from '../engine/anti-ai-detector';
import { setBusinessThresholdOverrides } from '../shared/thresholds';


const log = createLogger('SettingsTab');
export class NovelWriterSettingTab extends PluginSettingTab {
    private plugin: NovelWriterPlugin;
    private activeTab: string = 'api';
    private tabContent!: HTMLElement;
    private tabBar!: HTMLElement;
    private fingerprintLibrary: StyleFingerprintLibrary | null = null;
    private templateFingerprints: StyleFingerprint[] = [];
    private globalFingerprints: StyleFingerprint[] = [];
    private projectFingerprints: StyleFingerprint[] = [];
    private fingerprintLoading = false;
    private knowledgeBaseManager: KnowledgeBaseManager | null = null;
    private knowledgeTagManager: KnowledgeTagManager | null = null;
    private deconstructionScheduler: DeconstructionScheduler | null = null;
    private knowledgeBooks: BookBasicInfo[] = [];
    private knowledgeLoading = false;
    private knowledgeSearchKeyword = '';
    private knowledgeStatusFilter: string = 'all';

    constructor(app: App, plugin: NovelWriterPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    private getCurrentProviderModels(): string[] {
        const customProviders = this.plugin.settings.customProviders || [];
        const endpoint = this.plugin.settings.apiEndpoint;
        const provider = customProviders.find(c => c.endpoint === endpoint);
        if (provider && provider.models?.length > 0) {
            return [...provider.models];
        }
        return [...this.plugin.settings.availableModels];
    }

    display(): void {
        const { containerEl } = this;

        containerEl.empty();

        containerEl.createEl('h2', { text: '📖 小说工坊 AI 设置' });

        this.renderUpdateBanner(containerEl);

        this.tabBar = containerEl.createDiv({ cls: 'nw-settings-tabbar' });
        const tabs = [
            { id: 'api', label: '🔌 API 配置' },
            { id: 'cowrite', label: '🖥 协同写作' },
            { id: 'writing', label: '✍️ 写作配置' },
            { id: 'recognition', label: '🎭 角色识别' },
            { id: 'suggestions', label: '💡 建议设置' },
            { id: 'charts', label: '📊 图表设置' },
            { id: 'template', label: '📋 模板管理' },
            { id: 'fingerprint', label: '🔍 写作指纹库' },
            { id: 'knowledge', label: '📚 写作知识库' },
            { id: 'deconstruction', label: '🧬 拆解引擎' },
            { id: 'foreshadow', label: '🔮 伏笔管理' },
            { id: 'rules', label: '📜 规则版本' },
            { id: 'appearance', label: '🎨 外观设置' },
            { id: 'layout', label: '🧩 工作台布局' },
            { id: 'performance', label: '📈 性能监控' },
            { id: 'about', label: 'ℹ️ 关于' },
        ];
        for (const tab of tabs) {
            const tabEl = this.tabBar.createDiv({
                cls: 'nw-settings-tab',
                text: tab.label,
                attr: { 'data-tab-id': tab.id }
            });
            if (tab.id === this.activeTab) tabEl.addClass('active');
            tabEl.addEventListener('click', () => {
                this.activeTab = tab.id;
                this.renderActiveTab();
            });
        }

        this.tabContent = containerEl.createDiv({ cls: 'nw-settings-tab-content' });
        this.renderActiveTab();

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

    private renderActiveTab() {
        this.tabContent.empty();
        this.tabBar.querySelectorAll('.nw-settings-tab').forEach(el => {
            el.toggleClass('active', el.getAttribute('data-tab-id') === this.activeTab);
        });
        switch (this.activeTab) {
            case 'api': this.renderApiSection(); break;
            case 'cowrite': this.renderCoWriteSection(); break;
            case 'writing': this.renderWritingSection(); break;
            case 'recognition': this.renderRecognitionSection(); break;
            case 'suggestions': this.renderSuggestionsSection(); break;
            case 'charts': this.renderChartsSection(); break;
            case 'fingerprint': this.renderFingerprintSection(); break;
            case 'knowledge': this.renderKnowledgeSection(); break;
            case 'deconstruction': this.renderDeconstructionSection(); break;
            case 'foreshadow': this.renderForeshadowSection(); break;
            case 'template': this.renderTemplateSection(); break;
            case 'rules': this.renderRulesSection(); break;
            case 'appearance': this.renderAppearanceSection(); break;
            case 'layout': this.renderWorkspaceLayoutSection(); break;
            case 'performance': this.renderPerformanceSection(); break;
            case 'about': this.renderAboutSection(); break;
        }
    }

    private renderApiSection(): void {
        const section = this.tabContent.createEl('section');

        const currentProviderId = this.plugin.getCurrentProviderId();
        const customProviders = this.plugin.settings.customProviders || [];
        const currentProvider = customProviders.find(c => c.id === currentProviderId);
        const isPreset = currentProvider ? !!currentProvider.isDefault : false;
        const isCustom = !isPreset;
        const isLegacyCustom = isCustom && !currentProvider;

        const dirtyState = {
            endpoint: false,
            name: false,
            models: false,
            context: false,
            output: false
        };

        let providerDropdown: any;
        new Setting(section)
            .setName('API 提供商')
            .setDesc('选择 AI API 提供商，或添加自定义提供商')
            .addDropdown(dropdown => {
                providerDropdown = dropdown;
                const allProviders = this.plugin.getAllProviders();
                allProviders.forEach(p => {
                    const sourceIcon = p.sourceType === 'local' ? '💻' : '☁️';
                    const label = `${sourceIcon} ${p.name}`;
                    dropdown.addOption(p.id, label);
                });
                dropdown.addOption('__manage__', '⚙️ 管理全部提供商...');
                dropdown.setValue(currentProviderId || '__manage__');
                dropdown.onChange(async (value) => {
                    if (value === '__manage__') {
                        dropdown.setValue(currentProviderId || '__manage__');
                        this.showManageProvidersModal();
                        return;
                    }
                    const all = this.plugin.getAllProviders();
                    const match = all.find(p => p.id === value);
                    if (match && this.plugin.switchProviderByEndpoint(match.endpoint)) {
                        await this.plugin.saveSettings();
                        this.plugin.updateStatusBarText();
                        this.renderActiveTab();
                    }
                });
            });

        const manageRow = section.createDiv({ attr: { style: 'display:flex;justify-content:flex-end;margin-top:-4px;margin-bottom:8px;' } });
        const manageBtn = manageRow.createEl('button', {
            text: '🔧 管理全部提供商',
            attr: { type: 'button', title: '添加/编辑/删除/恢复 API 提供商', style: 'padding:4px 12px;font-size:12px;cursor:pointer;border:1px solid var(--background-modifier-border);border-radius:4px;background:var(--background-secondary);color:var(--text-normal);' }
        });
        manageBtn.onclick = () => this.showManageProvidersModal();

        if (isLegacyCustom) {
            new Setting(section)
                .setName('提供商名称')
                .setDesc('用于状态栏和工作台显示')
                .addText(text => text
                    .setPlaceholder('我的代理')
                    .setValue(this.plugin.settings.customProviderName)
                    .onChange(value => {
                        this.plugin.settings.customProviderName = value;
                    }));

            new Setting(section)
                .setName('API 端点')
                .setDesc('OpenAI 兼容 API 基础 URL')
                .addText(text => text
                    .setPlaceholder('https://api.example.com/v1/chat/completions')
                    .setValue(this.plugin.settings.apiEndpoint)
                    .onChange(value => {
                        this.plugin.settings.apiEndpoint = value.trim();
                    }));
        }

        const activeCustom = currentProviderId ? (this.plugin.settings.customProviders || []).find(c => c.id === currentProviderId) : null;
        if (isCustom || activeCustom) {
            if (activeCustom) {
                section.createDiv({ attr: { style: 'padding:8px 12px;margin:8px 0;background:var(--background-modifier-hover);border-radius:6px;font-size:12px;' } })
                    .createEl('span', { text: `🔧 ${activeCustom.name} · ${activeCustom.endpoint} · ${activeCustom.models.length} 个模型` });

                const mgmtRow = section.createDiv({ attr: { style: 'display:flex;gap:8px;margin-bottom:8px;' } });
                const editBtn = mgmtRow.createEl('button', {
                    text: '✏️ 编辑',
                    attr: { style: 'padding:4px 12px;font-size:12px;cursor:pointer;border:1px solid var(--background-modifier-border);border-radius:4px;' }
                });
                const deleteBtn = mgmtRow.createEl('button', {
                    text: '🗑 删除',
                    attr: { style: 'padding:4px 12px;font-size:12px;cursor:pointer;border:1px solid var(--background-modifier-border);border-radius:4px;color:var(--text-error);' }
                });
                editBtn.onclick = () => this.showEditCustomProviderForm(activeCustom);
                deleteBtn.onclick = async () => {
                    const confirmed = await OperationConfirmModal.confirm(this.app, {
                        title: '删除自定义提供商',
                        description: `确定要删除自定义提供商 "${activeCustom.name}" 吗？`,
                        warning: '此操作不可恢复',
                        confirmText: '确认删除',
                        cancelText: '取消',
                    });
                    if (!confirmed) return;
                    this.plugin.deleteCustomProvider(activeCustom.id);
                    await this.plugin.saveSettings();
                    this.plugin.updateStatusBarText();
                    this.renderActiveTab();
                    new Notice(`已删除 "${activeCustom.name}"`);
                };
            } else {
                section.createDiv({ attr: { style: 'padding:8px 12px;margin:8px 0;background:var(--background-modifier-warning);border-radius:6px;font-size:12px;' } })
                    .createEl('span', { text: '⚠️ 当前使用未保存的自定义配置。建议点击"⚙️ 管理全部提供商..."保存。' });
            }
        }

        const providerLabel = isCustom
            ? (this.plugin.settings.customProviderName || '自定义')
            : (currentProvider ? currentProvider.name : (currentProviderId || 'API'));
        new Setting(section)
            .setName(`${providerLabel} 密钥`)
            .setDesc(isCustom ? '自定义提供商的 API 密钥' : `仅用于 ${providerLabel}`)
            .addText(text => {
                text.inputEl.type = 'password';
                text.setPlaceholder('请输入 API 密钥')
                    .setValue(this.plugin.settings.apiKey)
                    .onChange(value => {
                        this.plugin.settings.apiKey = value;
                        if (currentProviderId) {
                            this.plugin.settings.providerKeys[currentProviderId] = value;
                        }
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

        const modelsContainer = section.createDiv({ attr: { style: 'margin: 8px 0;' } });
        const modelsHeader = modelsContainer.createDiv({ attr: { style: 'display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;' } });
        modelsHeader.createEl('span', { text: '🤖 可用模型', attr: { style: 'font-weight:600;' } });

        const addModelBtn = modelsHeader.createEl('button', {
            text: '＋ 添加',
            cls: 'novel-writer-add-model-btn',
            attr: { type: 'button' }
        });
        addModelBtn.style.cssText = 'padding:2px 8px;cursor:pointer;border:1px solid var(--interactive-accent);background:var(--interactive-accent);color:var(--text-on-accent);border-radius:3px;font-size:11px;';

        const modelListEl = modelsContainer.createDiv({ attr: { style: 'display:flex;flex-wrap:wrap;gap:4px;min-height:28px;padding:4px;border:1px solid var(--background-modifier-border);border-radius:4px;' } });

        const inputRow = modelsContainer.createDiv({
            attr: { style: 'display:flex;gap:6px;margin-top:6px;align-items:center;' }
        });
        const modelInput = inputRow.createEl('input', {
            type: 'text',
            attr: { placeholder: '输入新模型名称（如 gpt-4o），按 Enter 或点击 ✓', style: 'flex:1;padding:4px 8px;border:1px solid var(--background-modifier-border);border-radius:4px;background:var(--background-primary);color:var(--text-normal);font-size:12px;' }
        });
        const confirmBtn = inputRow.createEl('button', {
            text: '✓ 确认',
            attr: { type: 'button', style: 'padding:4px 10px;cursor:pointer;border:1px solid var(--interactive-accent);background:var(--interactive-accent);color:var(--text-on-accent);border-radius:4px;font-size:12px;' }
        });

        const renderModelChips = () => {
            modelListEl.empty();
            const models = this.getCurrentProviderModels();
            models.forEach((model, idx) => {
                const chip = modelListEl.createDiv({ attr: { style: 'display:inline-flex;align-items:center;gap:2px;padding:2px 6px;background:var(--background-modifier-hover);border-radius:3px;font-size:12px;' } });
                chip.createSpan({ text: model });
                const delBtn = chip.createEl('button', { text: '✕', attr: { type: 'button', title: '删除此模型' } });
                delBtn.style.cssText = 'border:none;background:none;cursor:pointer;font-size:10px;padding:0 2px;color:var(--text-muted);';
                delBtn.addEventListener('click', async () => {
                    const currProviderId = this.plugin.getCurrentProviderId();
                    const customProviders = this.plugin.settings.customProviders || [];
                    const currentModels = this.getCurrentProviderModels();
                    currentModels.splice(idx, 1);
                    if (currentModels.length === 0) {
                        currentModels.push('default-model');
                    }
                    if (currProviderId && customProviders.find(c => c.id === currProviderId)) {
                        const cp = customProviders.find(c => c.id === currProviderId)!;
                        cp.models = [...currentModels];
                    }
                    this.plugin.settings.availableModels = [...currentModels];
                    if (!this.plugin.settings.availableModels.includes(this.plugin.settings.defaultModel)) {
                        this.plugin.settings.defaultModel = this.plugin.settings.availableModels[0];
                    }
                    if (!this.plugin.settings.availableModels.includes(this.plugin.settings.flashModel)) {
                        this.plugin.settings.flashModel = this.plugin.settings.availableModels[0];
                    }
                    if (!this.plugin.settings.availableModels.includes(this.plugin.settings.proModel)) {
                        this.plugin.settings.proModel = this.plugin.settings.availableModels[0];
                    }
                    await this.plugin.saveSettings();
                    dirtyState.models = true;
                    renderModelChips();
                    this.renderActiveTab();
                });
            });
        };
        renderModelChips();

        addModelBtn.addEventListener('click', () => {
            modelInput.focus();
        });

        const handleAddModel = async () => {
            const modelName = modelInput.value.trim();
            if (!modelName) {
                new Notice('请输入模型名称');
                modelInput.focus();
                return;
            }
            const currentModels = this.getCurrentProviderModels();
            if (currentModels.includes(modelName)) {
                new Notice('模型已存在');
                return;
            }
            currentModels.push(modelName);
            const currProviderId = this.plugin.getCurrentProviderId();
            const customProviders = this.plugin.settings.customProviders || [];
            if (currProviderId && customProviders.find(c => c.id === currProviderId)) {
                const cp = customProviders.find(c => c.id === currProviderId)!;
                cp.models = [...currentModels];
            }
            this.plugin.settings.availableModels = [...currentModels];
            await this.plugin.saveSettings();
            dirtyState.models = true;
            modelInput.value = '';
            new Notice(`✅ 已添加模型：${modelName}`);
            renderModelChips();
            this.renderActiveTab();
        };

        confirmBtn.addEventListener('click', handleAddModel);
        modelInput.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleAddModel();
            }
        });

        new Setting(section)
            .setName('默认模型')
            .setDesc('默认使用的 AI 模型')
            .addDropdown(dropdown => {
                const models = this.getCurrentProviderModels();
                models.forEach(model => {
                    dropdown.addOption(model, model);
                });
                dropdown.setValue(this.plugin.settings.defaultModel);
                dropdown.onChange(async (value) => {
                    this.plugin.settings.defaultModel = value;
                    this.plugin.updateModelLimitsFromModel(value);
                    await this.plugin.saveSettings();
                    this.renderActiveTab();
                });
            });

        new Setting(section)
            .setName('Flash 模型（大纲/分析/规划）')
            .setDesc('大纲骨架、分析报告、元素提取、规划类任务使用')
            .addDropdown(dropdown => {
                const models = this.getCurrentProviderModels();
                models.forEach(model => {
                    dropdown.addOption(model, model);
                });
                dropdown.setValue(this.plugin.settings.flashModel);
                dropdown.onChange(async (value) => {
                    this.plugin.settings.flashModel = value;
                    this.plugin.updateModelLimitsFromModel(value);
                    await this.plugin.saveSettings();
                    this.renderActiveTab();
                });
            });

        new Setting(section)
            .setName('Pro 模型（正文/角色/实体）')
            .setDesc('正文创作、角色生成、势力/地点/物品设定任务使用')
            .addDropdown(dropdown => {
                const models = this.getCurrentProviderModels();
                models.forEach(model => {
                    dropdown.addOption(model, model);
                });
                dropdown.setValue(this.plugin.settings.proModel);
                dropdown.onChange(async (value) => {
                    this.plugin.settings.proModel = value;
                    this.plugin.updateModelLimitsFromModel(value);
                    await this.plugin.saveSettings();
                    this.renderActiveTab();
                });
            });

        const currentModel = this.plugin.settings.defaultModel;
        const endpoint = this.plugin.settings.apiEndpoint;
        const override = this.plugin.settings.modelOverrides[endpoint]?.[currentModel];
        const caps = this.plugin.settings.maxContext > 0
            ? { maxContext: this.plugin.settings.maxContext, maxOutput: this.plugin.settings.maxOutput }
            : this.plugin.resolveModelLimits(currentModel);
        const modelDefaults = this.plugin.resolveModelLimits(currentModel);
        const hasCtxOverride = override?.maxContext !== undefined;
        const hasOutOverride = override?.maxOutput !== undefined;

        const ctxRow = new Setting(section)
            .setName('最大上下文')
            .setDesc(`AI 模型的最大上下文长度（token）。${currentModel} 默认: ${modelDefaults.maxContext.toLocaleString()} tokens${hasCtxOverride ? ' · ⚠️ 已设置自定义值' : ''}`)
            .addText(text => text
                .setPlaceholder(modelDefaults.maxContext.toString())
                .setValue(override?.maxContext !== undefined ? String(override.maxContext) : modelDefaults.maxContext.toString())
                .onChange(value => {
                    const parsed = parseInt(value) || modelDefaults.maxContext;
                    this.plugin.setCurrentModelOverride('maxContext', parsed);
                    dirtyState.context = true;
                    ctxRow.setDesc(`AI 模型的最大上下文长度（token）。${currentModel} 默认: ${modelDefaults.maxContext.toLocaleString()} tokens${parsed !== modelDefaults.maxContext ? ' · ⚠️ 已设置自定义值' : ''}`);
                }));

        const outRow = new Setting(section)
            .setName('最大输出')
            .setDesc(`AI 最大输出长度（token）。${currentModel} 默认: ${modelDefaults.maxOutput.toLocaleString()} tokens${hasOutOverride ? ' · ⚠️ 已设置自定义值' : ''}`)
            .addText(text => text
                .setPlaceholder(modelDefaults.maxOutput.toString())
                .setValue(override?.maxOutput !== undefined ? String(override.maxOutput) : modelDefaults.maxOutput.toString())
                .onChange(value => {
                    const parsed = parseInt(value) || modelDefaults.maxOutput;
                    this.plugin.setCurrentModelOverride('maxOutput', parsed);
                    dirtyState.output = true;
                    outRow.setDesc(`AI 最大输出长度（token）。${currentModel} 默认: ${modelDefaults.maxOutput.toLocaleString()} tokens${parsed !== modelDefaults.maxOutput ? ' · ⚠️ 已设置自定义值' : ''}`);
                }));

        const historyContainer = section.createDiv({ attr: { style: 'margin-top:12px;' } });
        const historyHeader = historyContainer.createDiv({ attr: { style: 'display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;' } });
        historyHeader.createEl('span', { text: '📜 渠道-模型配置修改历史', attr: { style: 'font-weight:600;font-size:12px;' } });

        const showHistoryBtn = historyHeader.createEl('button', {
            text: '查看',
            attr: { type: 'button', style: 'padding:2px 8px;font-size:11px;cursor:pointer;border:1px solid var(--background-modifier-border);border-radius:3px;' }
        });

        const renderHistory = () => {
            const historyEl = historyContainer.querySelector('.history-list');
            if (historyEl) historyEl.remove();
            const list = historyContainer.createDiv({ cls: 'history-list', attr: { style: 'max-height:200px;overflow-y:auto;font-size:11px;color:var(--text-muted);padding:4px 0;' } });
            const history = this.plugin.settings.modelOverrideHistory;
            if (history.length === 0) {
                list.createEl('span', { text: '暂无修改记录' });
                return;
            }
            const recent = [...history].reverse().slice(0, 20);
            for (const h of recent) {
                const time = new Date(h.timestamp).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
                const change = h.oldValue === 0 ? '设置' : `${h.oldValue.toLocaleString()} → ${h.newValue.toLocaleString()}`;
                const color = h.newValue < h.oldValue ? 'var(--text-muted)' : (h.newValue > h.oldValue ? 'var(--text-accent)' : 'var(--text-normal)');
                list.createEl('div', {
                    text: `${time} · ${h.providerId}/${h.model} · ${h.field} = ${change}`,
                    attr: { style: `padding:2px 0;color:${color};` }
                });
            }
        };

        showHistoryBtn.addEventListener('click', () => renderHistory());

        const saveBtnContainer = section.createDiv({ attr: { style: 'margin-top:16px;display:flex;gap:8px;' } });
        const saveBtn = saveBtnContainer.createEl('button', {
            text: '💾 保存设置',
            attr: { type: 'button' }
        });
        saveBtn.style.cssText = 'padding:8px 20px;cursor:pointer;background:var(--interactive-accent);color:var(--text-on-accent);border:none;border-radius:6px;font-size:13px;font-weight:600;';
        saveBtn.addEventListener('click', async () => {
            if (currentProviderId) {
                this.plugin.settings.providerKeys[currentProviderId] = this.plugin.settings.apiKey;
            }
            const endpoint = this.plugin.settings.apiEndpoint;
            const customProviders = this.plugin.settings.customProviders || [];
            const isPresetEndpoint = customProviders.some(c => c.isDefault && c.endpoint === endpoint);
            const isRegisteredCustom = customProviders.some(c => c.endpoint === endpoint);
            if (endpoint && !isPresetEndpoint && !isRegisteredCustom) {
                const name = this.plugin.settings.customProviderName || '自定义';
                const models = this.plugin.settings.availableModels?.length
                    ? [...this.plugin.settings.availableModels]
                    : ['default-model'];
                this.plugin.addCustomProvider(
                    name,
                    endpoint,
                    models,
                    this.plugin.settings.maxContext || 128000,
                    this.plugin.settings.maxOutput || 32768,
                    this.plugin.settings.apiKey
                );
                new Notice('✅ 已自动保存为自定义提供商', 3000);
            }
            if (currentProviderId && customProviders.find(c => c.id === currentProviderId)) {
                const cp = customProviders.find(c => c.id === currentProviderId)!;
                cp.models = [...this.plugin.settings.availableModels];
                cp.maxContext = this.plugin.settings.maxContext || cp.maxContext;
                cp.maxOutput = this.plugin.settings.maxOutput || cp.maxOutput;
            }
            await this.plugin.saveSettings();
            this.plugin.updateStatusBarText();
            new Notice('✅ API 设置已保存');
            this.renderActiveTab();
        });

        const resetBtn = saveBtnContainer.createEl('button', {
            text: '🔄 重置',
            attr: { type: 'button' }
        });
        resetBtn.style.cssText = 'padding:8px 16px;cursor:pointer;background:var(--background-modifier-border);color:var(--text-normal);border:none;border-radius:6px;font-size:13px;';
        resetBtn.addEventListener('click', () => {
            this.renderActiveTab();
        });
    }

    private renderCoWriteSection(): void {
        const section = this.tabContent.createEl('section');

        section.createEl('p', {
            text: '配置协同写作使用的模型。可在本地 Ollama 和云端 API 之间自由切换。',
            cls: 'setting-item-description'
        });

        let localModelDropdown: any = null;
        let cloudProviderDropdown: any = null;
        let cloudModelDropdown: any = null;
        let localModelSetting: Setting | null = null;
        let cloudProviderSetting: Setting | null = null;
        let cloudModelSetting: Setting | null = null;

        const updateVisibility = () => {
            const mode = this.plugin.settings.coWriteModelMode || 'local';
            if (localModelSetting) {
                localModelSetting.settingEl.style.display = mode === 'local' ? '' : 'none';
            }
            if (cloudProviderSetting) {
                cloudProviderSetting.settingEl.style.display = mode === 'cloud' ? '' : 'none';
            }
            if (cloudModelSetting) {
                cloudModelSetting.settingEl.style.display = mode === 'cloud' ? '' : 'none';
            }
        };

        const loadLocalModels = async () => {
            if (!localModelDropdown) return;
            localModelDropdown.selectEl.innerHTML = '';
            localModelDropdown.addOption('', '加载中...');
            localModelDropdown.setValue('');
            const models = await getOllamaModelsWithFallback(this.plugin.settings);
            localModelDropdown.selectEl.innerHTML = '';
            localModelDropdown.addOption('', '（未设置 — 协同写作将无法使用）');
            for (const m of models) {
                localModelDropdown.addOption(m, `🖥 ${m}`);
            }
            localModelDropdown.setValue(this.plugin.settings.coWriteModel || '');
        };

        const refreshCloudModelDropdown = () => {
            if (!cloudModelDropdown) return;
            cloudModelDropdown.selectEl.innerHTML = '';
            cloudModelDropdown.addOption('', '（使用默认模型）');
            const providerId = this.plugin.settings.coWriteCloudProvider || '';
            if (providerId) {
                const custom = this.plugin.settings.customProviders?.find(p => p.id === providerId);
                if (custom?.models) {
                    for (const m of custom.models) {
                        cloudModelDropdown.addOption(m, m);
                    }
                }
            }
            cloudModelDropdown.setValue(this.plugin.settings.coWriteCloudModel || '');
        };

        new Setting(section)
            .setName('模型模式')
            .setDesc('选择协同写作使用本地模型还是云端模型')
            .addDropdown(dropdown => {
                dropdown.addOption('local', '🖥 本地模型（Ollama）');
                dropdown.addOption('cloud', '☁️ 云端模型');
                dropdown.setValue(this.plugin.settings.coWriteModelMode || 'local');
                dropdown.onChange(async (value) => {
                    this.plugin.settings.coWriteModelMode = value as 'local' | 'cloud';
                    await this.plugin.saveSettings();
                    updateVisibility();
                });
            });

        localModelSetting = new Setting(section)
            .setName('本地模型')
            .setDesc('选择协同写作使用的 Ollama 本地模型')
            .addDropdown(dropdown => {
                localModelDropdown = dropdown;
                dropdown.addOption('', '加载中...');
                dropdown.setValue(this.plugin.settings.coWriteModel || '');
                dropdown.onChange(async (value) => {
                    this.plugin.settings.coWriteModel = value;
                    await this.plugin.saveSettings();
                });
            })
            .addButton(btn => {
                btn
                    .setButtonText('刷新')
                    .setTooltip('重新加载 Ollama 模型列表')
                    .onClick(() => {
                        loadLocalModels();
                    });
            });
        loadLocalModels();

        cloudProviderSetting = new Setting(section)
            .setName('云端供应商')
            .setDesc('选择云端模型的供应商')
            .addDropdown(dropdown => {
                cloudProviderDropdown = dropdown;
                dropdown.addOption('', '（未选择）');
                const allProviders = this.plugin.getAllProviders();
                for (const p of allProviders) {
                    if (p.id !== 'ollama') {
                        dropdown.addOption(p.id, p.name);
                    }
                }
                dropdown.setValue(this.plugin.settings.coWriteCloudProvider || '');
                dropdown.onChange(async (value) => {
                    this.plugin.settings.coWriteCloudProvider = value;
                    await this.plugin.saveSettings();
                    refreshCloudModelDropdown();
                });
            });

        cloudModelSetting = new Setting(section)
            .setName('云端模型')
            .setDesc('选择协同写作使用的云端模型（留空则使用默认模型）')
            .addDropdown(dropdown => {
                cloudModelDropdown = dropdown;
                refreshCloudModelDropdown();
                dropdown.onChange(async (value) => {
                    this.plugin.settings.coWriteCloudModel = value;
                    await this.plugin.saveSettings();
                });
            });

        new Setting(section)
            .setName('Temperature')
            .setDesc('模型的创造性参数（0-2，默认 0.7）')
            .addSlider(slider => {
                slider.setLimits(0, 2, 0.05);
                slider.setValue(this.plugin.settings.coWriteTemperature ?? 0.7);
                slider.setDynamicTooltip();
                slider.onChange(async (value) => {
                    this.plugin.settings.coWriteTemperature = value;
                    await this.plugin.saveSettings();
                });
            });

        new Setting(section)
            .setName('最大输出 Token')
            .setDesc('单次生成的最大 token 数（默认 600）')
            .addText(text => {
                text.setValue(String(this.plugin.settings.coWriteMaxTokens ?? 600));
                text.onChange(async (value) => {
                    const num = parseInt(value, 10);
                    if (!isNaN(num) && num > 0) {
                        this.plugin.settings.coWriteMaxTokens = num;
                        await this.plugin.saveSettings();
                    }
                });
            });

        new Setting(section)
            .setName('自动剧情评估')
            .setDesc('输入正文时自动评估剧情完成度（建议开启以获得实时反馈，关闭可节省 AI 调用）')
            .addToggle(toggle => {
                toggle.setValue(this.plugin.settings.autoPlotEvaluation ?? true);
                toggle.onChange(async (value) => {
                    this.plugin.settings.autoPlotEvaluation = value;
                    await this.plugin.saveSettings();
                });
            });

        new Setting(section)
            .setName('自动联想（幽灵建议）')
            .setDesc('输入停顿后自动生成后续联想，按 Tab 接受（每 4 秒最多一次；关闭可节省 AI 调用，手动联想仍可用）')
            .addToggle(toggle => {
                toggle.setValue(this.plugin.settings.autoGhostAssociation ?? true);
                toggle.onChange(async (value) => {
                    this.plugin.settings.autoGhostAssociation = value;
                    await this.plugin.saveSettings();
                });
            });

        updateVisibility();
    }

    private renderWritingSection(): void {
        const section = this.tabContent.createEl('section');

        new Setting(section)
            .setName('默认字数')
            .setDesc('每章默认字数')
            .addText(text => text
                .setPlaceholder('3000')
                .setValue(String(this.plugin.settings.defaultWordCount))
                .onChange(async (value) => {
                    this.plugin.settings.defaultWordCount = parseInt(value) || 3000;
                    await this.plugin.saveSettings();
                }));

        new Setting(section)
            .setName('最小字数')
            .setDesc('每章最小字数')
            .addText(text => text
                .setPlaceholder('2500')
                .setValue(String(this.plugin.settings.minWordCount))
                .onChange(async (value) => {
                    this.plugin.settings.minWordCount = parseInt(value) || 2500;
                    await this.plugin.saveSettings();
                }));

        new Setting(section)
            .setName('最大字数')
            .setDesc('每章最大字数')
            .addText(text => text
                .setPlaceholder('5000')
                .setValue(String(this.plugin.settings.maxWordCount))
                .onChange(async (value) => {
                    this.plugin.settings.maxWordCount = parseInt(value) || 5000;
                    await this.plugin.saveSettings();
                }));

        new Setting(section)
            .setName('断联自动切换模型')
            .setDesc('API断联/超时/503时，自动尝试同端点下其他可用模型（写作类任务会注入文风接续保护）')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableAutoModelFallback !== false)
                .onChange(async (value) => {
                    this.plugin.settings.enableAutoModelFallback = value;
                    await this.plugin.saveSettings();
                }));

        // P0-4: 精修迭代轮数参数化（原硬编码 3，spec p0-api-efficiency-optimization AC-4.3）
        new Setting(section)
            .setName('精修迭代轮数')
            .setDesc('「迭代精修」的最大审查-修复轮数（0-5，0=跳过精修，默认 3）。首轮审查通过时自动短路，不额外消耗调用。')
            .addText(text => text
                .setPlaceholder('3')
                .setValue(String(this.plugin.settings.refineRounds ?? 3))
                .onChange(async (value) => {
                    const n = Math.max(0, Math.min(5, parseInt(value) || 0));
                    this.plugin.settings.refineRounds = n;
                    await this.plugin.saveSettings();
                }));

        // R2: 反AI 检测词表扩充（默认空 → 检测结果与内置词表一致，无行为变化）
        new Setting(section)
            .setName('AI 味词表扩充')
            .setDesc('每行一个词。这些词会同时加入「AI 味检测」的 L1 词频命中、写作避用词黑名单，以及拆解引擎的连接词密度统计。留空则只用内置词表。')
            .addTextArea(area => {
                area.setPlaceholder('例如：\n话说\n说白了\n不妨\n')
                    .setValue((this.plugin.settings.antiAiExtraWords ?? []).join('\n'))
                    .onChange(async (value) => {
                        const words = value.split('\n').map(w => w.trim()).filter(w => w.length > 0);
                        this.plugin.settings.antiAiExtraWords = words;
                        AntiAIDetector.setExtraHighFreqWords(words);
                        await this.plugin.saveSettings();
                    });
                area.inputEl.rows = 4;
            });

        // R1: 业务阈值设置项化（默认值与 shared/thresholds.ts 内置常量一致，不改变默认行为）
        new Setting(section)
            .setName('步骤最低字数比例')
            .setDesc('步骤输出低于「目标字数 × 此比例」即判定字数不足（0-1，默认 0.70）。')
            .addText(text => text
                .setPlaceholder('0.70')
                .setValue(String(this.plugin.settings.wordMinRatio ?? 0.7))
                .onChange(async (value) => {
                    const ratio = Number.parseFloat(value);
                    if (!Number.isFinite(ratio) || ratio <= 0 || ratio > 1) return;
                    this.plugin.settings.wordMinRatio = ratio;
                    setBusinessThresholdOverrides({ wordMinRatio: ratio });
                    await this.plugin.saveSettings();
                }));

        new Setting(section)
            .setName('超长提示词分片比例')
            .setDesc('提示词超出上下文安全线时，保留头部的比例（0-1，默认 0.67；越小保留的中段资料越少）。')
            .addText(text => text
                .setPlaceholder('0.67')
                .setValue(String(this.plugin.settings.promptSplitRatio ?? 0.67))
                .onChange(async (value) => {
                    const ratio = Number.parseFloat(value);
                    if (!Number.isFinite(ratio) || ratio <= 0 || ratio > 1) return;
                    this.plugin.settings.promptSplitRatio = ratio;
                    setBusinessThresholdOverrides({ promptSplitRatio: ratio });
                    await this.plugin.saveSettings();
                }));

        new Setting(section)
            .setName('上下文范围')
            .setDesc('紧凑模式仅注入本章涉及实体（节省上下文），完整模式遍历全部实体（质量优先）')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.contextScope === 'full')
                .onChange(async (value) => {
                    this.plugin.settings.contextScope = value ? 'full' : 'compact';
                    await this.plugin.saveSettings();
                }));
    }

    private async renderFingerprintSection(): Promise<void> {
        const section = this.tabContent.createEl('section');
        section.createEl('h3', { text: '🔍 写作指纹库' });

        section.createEl('p', {
            text: '管理模板、全局和项目级写作指纹库，用于保持风格一致性。',
            cls: 'setting-item-description'
        });

        if (this.fingerprintLoading) {
            section.createDiv({
                attr: { style: 'padding:40px;text-align:center;color:var(--text-faint);font-size:13px;' },
                text: '加载中...'
            });
            return;
        }

        const activeProject = this.plugin.getActiveProject();

        if (!this.fingerprintLibrary) {
            this.fingerprintLibrary = new StyleFingerprintLibrary(this.app, activeProject || undefined);
            await this.loadTemplateFingerprints();
            await this.loadGlobalFingerprints();
            await this.loadProjectFingerprints();
        }

        const templateSection = section.createDiv({ attr: { style: 'margin-bottom:24px;' } });
        this.renderFingerprintGroup(templateSection, '模板指纹库', this.templateFingerprints, 'template');

        const globalSection = section.createDiv({ attr: { style: 'margin-bottom:24px;' } });
        this.renderFingerprintGroup(globalSection, '全局指纹库', this.globalFingerprints, 'global');

        const projectSection = section.createDiv();
        this.renderFingerprintGroup(projectSection, '项目指纹库', this.projectFingerprints, 'project', activeProject);
    }

    private renderFingerprintGroup(
        container: HTMLElement,
        title: string,
        fingerprints: StyleFingerprint[],
        scope: 'template' | 'global' | 'project',
        activeProject?: string | null
    ): void {
        const headerRow = container.createDiv({ attr: { style: 'display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;' } });
        
        if (scope === 'project') {
            const titleText = activeProject ? `${title}（${fingerprints.length} 个）· ${activeProject}` : `${title}（${fingerprints.length} 个）`;
            headerRow.createEl('span', { text: titleText, attr: { style: 'font-weight:600;font-size:13px;' } });
        } else {
            headerRow.createEl('span', { text: `${title}（${fingerprints.length} 个）`, attr: { style: 'font-weight:600;font-size:13px;' } });
        }

        const isProjectWithoutProject = scope === 'project' && !activeProject;
        const headerRight = scope === 'project' && activeProject
            ? headerRow.createDiv({ attr: { style: 'display:flex;align-items:center;gap:10px;' } })
            : headerRow;

        const addBtn = headerRight.createEl('button', {
            text: scope === 'template' ? '➕ 添加模板指纹' : scope === 'global' ? '➕ 添加全局指纹' : '➕ 添加项目指纹',
            attr: {
                type: 'button',
                style: isProjectWithoutProject
                    ? 'padding:6px 14px;cursor:not-allowed;background:var(--background-modifier-border);color:var(--text-faint);border:none;border-radius:4px;font-size:12px;'
                    : 'padding:6px 14px;cursor:pointer;background:var(--interactive-accent);color:var(--text-on-accent);border:none;border-radius:4px;font-size:12px;'
            }
        });

        if (!isProjectWithoutProject) {
            addBtn.addEventListener('click', () => {
                if (scope === 'template') {
                    this.showAddTemplateFingerprintModal();
                } else if (scope === 'global') {
                    this.showAddGlobalFingerprintModal();
                } else {
                    this.showAddProjectFingerprintModal();
                }
            });
        }

        if (scope === 'project' && activeProject) {
            const syncBtn = headerRight.createEl('button', {
                text: '🔄 从模板同步',
                attr: {
                    type: 'button',
                    title: '从模板指纹库同步到项目指纹库',
                    style: 'padding:2px 8px;cursor:pointer;border:1px solid var(--background-modifier-border);border-radius:4px;font-size:11px;background:transparent;'
                }
            });
            syncBtn.addEventListener('click', async () => {
                if (!this.fingerprintLibrary) return;
                try {
                    const result = await this.fingerprintLibrary.syncFromTemplate(activeProject);
                    await this.loadProjectFingerprints();
                    this.renderActiveTab();
                    new Notice(`✅ 同步完成：新增 ${result.added.length} 个，更新 ${result.updated.length} 个`);
                } catch (e) {
                    log.warn('[SettingsTab] 同步失败:', e);
                    new Notice('❌ 同步失败，请查看控制台');
                }
            });
        }

        if (isProjectWithoutProject) {
            container.createDiv({
                attr: { style: 'padding:20px;text-align:center;color:var(--text-muted);font-size:13px;background:var(--background-secondary);border-radius:6px;' },
                text: '请先打开一个项目查看项目级指纹'
            });
            return;
        }

        const listContainer = container.createDiv();
        renderFingerprintList(listContainer, fingerprints, {
            showDelete: true,
            onToggle: async (fp) => {
                if (!this.fingerprintLibrary) return;
                // 模板层不参与注入，列表已隐藏其开关；这里只处理 global / project
                if (fp.scope === 'template') return;
                fp.enabled = !fp.enabled;
                if (scope === 'global') {
                    await this.fingerprintLibrary.updateGlobal(fp);
                    await this.loadGlobalFingerprints();
                } else {
                    await this.fingerprintLibrary.updateProject(fp);
                    await this.loadProjectFingerprints();
                }
                this.renderActiveTab();
            },
            onDetail: (fp) => {
                if (scope === 'template') {
                    this.showTemplateFingerprintDetail(fp);
                } else if (scope === 'global') {
                    this.showGlobalFingerprintDetail(fp);
                } else {
                    this.showProjectFingerprintDetail(fp);
                }
            },
            onDelete: async (fp) => {
                if (!this.fingerprintLibrary) return;
                const scopeLabel = scope === 'template' ? '模板' : scope === 'global' ? '全局' : '项目';
                const confirmed = await OperationConfirmModal.confirm(this.app, {
                    title: '删除指纹',
                    description: `确定要删除${scopeLabel}指纹「${fp.name}」吗？`,
                    warning: '此操作不可恢复',
                    confirmText: '确认删除',
                    cancelText: '取消',
                });
                if (!confirmed) return;
                if (scope === 'template') {
                    await this.fingerprintLibrary.deleteTemplate(fp.id);
                    await this.loadTemplateFingerprints();
                } else if (scope === 'global') {
                    await this.fingerprintLibrary.deleteGlobal(fp.id);
                    await this.loadGlobalFingerprints();
                } else {
                    await this.fingerprintLibrary.deleteProject(fp.id);
                    await this.loadProjectFingerprints();
                }
                this.renderActiveTab();
                new Notice(`已删除「${fp.name}」`);
            },
        });
    }

    private async loadTemplateFingerprints(): Promise<void> {
        if (!this.fingerprintLibrary) return;
        try {
            this.templateFingerprints = await this.fingerprintLibrary.loadTemplate();
        } catch (e) {
            log.warn('[SettingsTab] 加载模板指纹库失败:', e);
        }
    }

    private showTemplateFingerprintDetail(fp: StyleFingerprint): void {
        new FingerprintDetailModal(this.app, {
            fingerprint: fp,
            canEdit: true,
            onToggle: async (fingerprint) => {
                if (!this.fingerprintLibrary) return;
                fingerprint.enabled = !fingerprint.enabled;
                await this.fingerprintLibrary.updateTemplate(fingerprint);
                await this.loadTemplateFingerprints();
                this.renderActiveTab();
            },
            onReextract: (fingerprint) => {
                if (!this.fingerprintLibrary) return;
                new RefillModal(this.app, {
                    type: 'fingerprint',
                    fingerprint,
                    fingerprintLibrary: this.fingerprintLibrary,
                    aiEngine: this.plugin.aiEngine,
                    embeddingSettings: this.plugin.settings,
                }).open();
            },
            onDelete: async (fingerprint) => {
                if (!this.fingerprintLibrary) return;
                await this.fingerprintLibrary.deleteTemplate(fingerprint.id);
                await this.loadTemplateFingerprints();
                this.renderActiveTab();
                new Notice(`已删除「${fingerprint.name}」`);
            },
        }).open();
    }

    private showAddTemplateFingerprintModal(): void {
        const { provider, vectorStore } = createFingerprintEmbedding(
            this.app, 'global', this.plugin.settings,
        );
        const extractor = new FingerprintExtractor(this.plugin.aiEngine, provider, vectorStore);

        new AddFingerprintModal(this.app, {
            scope: 'template',
            extractor,
            onCompleted: async (fingerprint) => {
                if (!this.fingerprintLibrary) return;
                await this.fingerprintLibrary.addTemplate(fingerprint);
                await this.loadTemplateFingerprints();
                this.renderActiveTab();
            }
        }).open();
    }

    private async loadGlobalFingerprints(): Promise<void> {
        if (!this.fingerprintLibrary) return;
        this.fingerprintLoading = true;
        try {
            this.globalFingerprints = await this.fingerprintLibrary.loadGlobal();
        } catch (e) {
            log.warn('[SettingsTab] 加载全局指纹库失败:', e);
        } finally {
            this.fingerprintLoading = false;
        }
    }

    private async loadProjectFingerprints(): Promise<void> {
        if (!this.fingerprintLibrary) return;
        try {
            this.projectFingerprints = await this.fingerprintLibrary.loadProject();
        } catch (e) {
            log.warn('[SettingsTab] 加载项目指纹库失败:', e);
        }
    }

    private showGlobalFingerprintDetail(fp: StyleFingerprint): void {
        new FingerprintDetailModal(this.app, {
            fingerprint: fp,
            canEdit: true,
            onToggle: async (fingerprint) => {
                if (!this.fingerprintLibrary) return;
                fingerprint.enabled = !fingerprint.enabled;
                await this.fingerprintLibrary.updateGlobal(fingerprint);
                await this.loadGlobalFingerprints();
                this.renderActiveTab();
            },
            onReextract: (fingerprint) => {
                if (!this.fingerprintLibrary) return;
                new RefillModal(this.app, {
                    type: 'fingerprint',
                    fingerprint,
                    fingerprintLibrary: this.fingerprintLibrary,
                    aiEngine: this.plugin.aiEngine,
                    embeddingSettings: this.plugin.settings,
                }).open();
            },
            onDelete: async (fingerprint) => {
                if (!this.fingerprintLibrary) return;
                await this.fingerprintLibrary.deleteGlobal(fingerprint.id);
                await this.loadGlobalFingerprints();
                this.renderActiveTab();
                new Notice(`已删除「${fingerprint.name}」`);
            },
        }).open();
    }

    private showAddGlobalFingerprintModal(): void {
        const { provider, vectorStore } = createFingerprintEmbedding(
            this.app, 'global', this.plugin.settings,
        );
        const extractor = new FingerprintExtractor(this.plugin.aiEngine, provider, vectorStore);

        new AddFingerprintModal(this.app, {
            scope: 'global',
            extractor,
            onCompleted: async (fingerprint) => {
                if (!this.fingerprintLibrary) return;
                await this.fingerprintLibrary.addGlobal(fingerprint);
                await this.loadGlobalFingerprints();
                this.renderActiveTab();
            }
        }).open();
    }

    private showAddProjectFingerprintModal(): void {
        const activeProject = this.plugin.getActiveProject();
        if (!activeProject) {
            new Notice('请先打开一个项目');
            return;
        }
        const { provider, vectorStore } = createFingerprintEmbedding(
            this.app, 'project', this.plugin.settings, activeProject,
        );
        const extractor = new FingerprintExtractor(this.plugin.aiEngine, provider, vectorStore);

        new AddFingerprintModal(this.app, {
            scope: 'project',
            extractor,
            onCompleted: async (fingerprint) => {
                if (!this.fingerprintLibrary) return;
                await this.fingerprintLibrary.addProject(fingerprint);
                await this.loadProjectFingerprints();
                this.renderActiveTab();
            }
        }).open();
    }

    private showProjectFingerprintDetail(fp: StyleFingerprint): void {
        new FingerprintDetailModal(this.app, {
            fingerprint: fp,
            canEdit: true,
            onToggle: async (fingerprint) => {
                if (!this.fingerprintLibrary) return;
                fingerprint.enabled = !fingerprint.enabled;
                await this.fingerprintLibrary.updateProject(fingerprint);
                await this.loadProjectFingerprints();
                this.renderActiveTab();
            },
            onReextract: (fingerprint) => {
                if (!this.fingerprintLibrary) return;
                new RefillModal(this.app, {
                    type: 'fingerprint',
                    fingerprint,
                    fingerprintLibrary: this.fingerprintLibrary,
                    aiEngine: this.plugin.aiEngine,
                    embeddingSettings: this.plugin.settings,
                }).open();
            },
            onDelete: async (fingerprint) => {
                if (!this.fingerprintLibrary) return;
                await this.fingerprintLibrary.deleteProject(fingerprint.id);
                await this.loadProjectFingerprints();
                this.renderActiveTab();
                new Notice(`已删除「${fingerprint.name}」`);
            },
        }).open();
    }

    private async renderKnowledgeSection(): Promise<void> {
        const section = this.tabContent.createEl('section');
        section.createEl('h3', { text: '📚 写作知识库' });

        section.createEl('p', {
            text: '管理你的写作知识库，导入小说进行深度拆解分析，提取写作技巧、结构、人设等宝贵经验。',
            cls: 'setting-item-description'
        });

        this.renderVectorEnhancementSettings(section);

        if (this.knowledgeLoading) {
            section.createDiv({
                attr: { style: 'padding:40px;text-align:center;color:var(--text-faint);font-size:13px;' },
                text: '加载中...'
            });
            return;
        }

        if (!this.knowledgeBaseManager) {
            // 通过 EngineRegistry 获取共享实例（registry 已在初始化时赋值给 plugin.knowledgeBaseManager/knowledgeTagManager）
            // 避免多实例状态不同步
            this.knowledgeBaseManager = this.plugin.engineRegistry.get<KnowledgeBaseManager>(ENGINE_NAMES.KNOWLEDGE_BASE_MANAGER);
            this.knowledgeTagManager = this.plugin.engineRegistry.get<KnowledgeTagManager>(ENGINE_NAMES.KNOWLEDGE_TAG_MANAGER);
            this.deconstructionScheduler = this.plugin.deconstructionScheduler ?? null;
            // registry 已在 initialize 阶段调用 init()，无需重复初始化
            await this.loadKnowledgeBooks();
        }

        const toolbar = section.createDiv({ attr: { style: 'margin-bottom:16px;' } });

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

        const actionRow = toolbar.createDiv({ attr: { style: 'display:flex;gap:8px;margin-top:8px;margin-bottom:16px;' } });

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
            attr: { style: 'padding:12px;border:1px solid var(--background-modifier-border);border-radius:6px;margin-bottom:16px;background:var(--background-secondary);' }
        });

        const searchRow = filterBar.createDiv({ attr: { style: 'display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap;' } });

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
            this.renderActiveTab();
        });

        const statusSelect = searchRow.createEl('select', {
            attr: {
                style: 'padding:6px 10px;border:1px solid var(--background-modifier-border);border-radius:4px;font-size:13px;background:var(--background-primary);color:var(--text-normal);'
            }
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
            this.renderActiveTab();
        });

        const tagFilterRow = filterBar.createDiv({ attr: { style: 'display:flex;gap:12px;flex-wrap:wrap;' } });

        const themeFilterDiv = tagFilterRow.createDiv({ attr: { style: 'flex:1;min-width:200px;' } });
        themeFilterDiv.createEl('span', { text: '📖 题材：全部', attr: { style: 'font-size:12px;color:var(--text-muted);margin-right:8px;' } });

        const techniqueFilterDiv = tagFilterRow.createDiv({ attr: { style: 'flex:1;min-width:200px;' } });
        techniqueFilterDiv.createEl('span', { text: '✍️ 技巧：全部', attr: { style: 'font-size:12px;color:var(--text-muted);margin-right:8px;' } });

        const filteredBooks = this.filterKnowledgeBooks();

        if (filteredBooks.length === 0) {
            const emptyState = section.createDiv({
                attr: { style: 'padding:60px 20px;text-align:center;border:1px dashed var(--background-modifier-border);border-radius:8px;background:var(--background-secondary);' }
            });
            emptyState.createEl('div', {
                text: '📚',
                attr: { style: 'font-size:48px;margin-bottom:16px;opacity:0.5;' }
            });
            emptyState.createEl('div', {
                text: this.knowledgeBooks.length === 0
                    ? '知识库暂无书籍，点击上方「批量导入」开始添加'
                    : '没有符合筛选条件的书籍',
                attr: { style: 'font-size:14px;color:var(--text-muted);margin-bottom:8px;' }
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
            attr: { style: 'font-size:13px;color:var(--text-muted);' }
        });

        const gridContainer = section.createDiv({
            attr: {
                style: 'display:grid;grid-template-columns:repeat(auto-fill, minmax(280px, 1fr));gap:12px;max-height:500px;overflow-y:auto;padding:4px;'
            }
        });

        filteredBooks.forEach(book => {
            this.renderKnowledgeBookCard(gridContainer, book);
        });
    }

    private getDeconstructionEngineSettings(): DeconstructionEngineSettings {
        const userDe = this.plugin.settings.deconstructionEngine;
        if (!userDe) {
            this.plugin.settings.deconstructionEngine = { ...DEFAULT_DECONSTRUCTION_ENGINE_SETTINGS };
            return this.plugin.settings.deconstructionEngine;
        }
        const merged: DeconstructionEngineSettings = {
            ...DEFAULT_DECONSTRUCTION_ENGINE_SETTINGS,
            ...userDe,
            enabledDimensions: Array.isArray(userDe.enabledDimensions) && userDe.enabledDimensions.length > 0
                ? [...userDe.enabledDimensions]
                : [...DEFAULT_DECONSTRUCTION_ENGINE_SETTINGS.enabledDimensions],
        };
        this.plugin.settings.deconstructionEngine = merged;
        return merged;
    }

    private async ensureDeconstructionEngineSettingsPersists(update: (s: DeconstructionEngineSettings) => void): Promise<void> {
        const s = this.getDeconstructionEngineSettings();
        update(s);
        this.plugin.settings.deconstructionEngine = s;
        await this.plugin.saveSettings();
    }

    private renderDeconstructionSection(): void {
        const section = this.tabContent.createEl('section');
        section.createEl('h3', { text: '🧬 拆解引擎' });
        section.createEl('p', {
            text: '配置小说拆解引擎的行为，包括增强级别、拆解维度、向量与 LLM 增强等。设置将在下一次拆解任务时生效。',
            cls: 'setting-item-description'
        });

        const cfg = this.getDeconstructionEngineSettings();

        const qualityCard = section.createDiv({
            attr: { style: 'padding:12px 16px;border:1px solid var(--background-modifier-border);border-radius:6px;margin-bottom:16px;background:var(--background-secondary);' }
        });
        qualityCard.createEl('h4', { text: '🎯 增强级别', attr: { style: 'margin:0 0 12px 0;font-size:14px;' } });

        new Setting(qualityCard)
            .setName('默认质量级别')
            .setDesc('快速=仅基础分析；标准=完整维度；深度=含向量+LLM 增强（耗时最长）')
            .addDropdown(dropdown => {
                dropdown.addOption('fast', '⚡ 快速');
                dropdown.addOption('standard', '✅ 标准');
                dropdown.addOption('deep', '🔬 深度');
                dropdown.setValue(cfg.defaultQualityLevel);
                dropdown.onChange(async (value) => {
                    await this.ensureDeconstructionEngineSettingsPersists(s => {
                        s.defaultQualityLevel = value as DeconstructionEngineSettings['defaultQualityLevel'];
                    });
                });
            });

        new Setting(qualityCard)
            .setName('低质量自动升级')
            .setDesc('检测到拆解质量较低时，自动升级到更高级别重跑')
            .addToggle(toggle => {
                toggle.setValue(cfg.enableAutoUpgrade);
                toggle.onChange(async (value) => {
                    await this.ensureDeconstructionEngineSettingsPersists(s => {
                        s.enableAutoUpgrade = value;
                    });
                });
            });

        const dimCard = section.createDiv({
            attr: { style: 'padding:12px 16px;border:1px solid var(--background-modifier-border);border-radius:6px;margin-bottom:16px;background:var(--background-secondary);' }
        });
        dimCard.createEl('h4', { text: '🧩 拆解维度', attr: { style: 'margin:0 0 12px 0;font-size:14px;' } });
        dimCard.createEl('div', {
            text: '选择默认启用的拆解维度（调用方未显式指定维度时使用）',
            attr: { style: 'font-size:12px;color:var(--text-muted);margin-bottom:10px;' }
        });

        const dimList = dimCard.createDiv({ attr: { style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:6px;' } });
        const dimSet = new Set(cfg.enabledDimensions);
        const DIMENSION_DESC: Record<string, string> = {
            style: '分析文笔风格与语言特色',
            rhythm: '分析叙事节奏与张弛变化',
            technique: '提取写作技巧与手法',
            structure: '拆解情节结构与章节组织',
            character: '提取人物设定与性格弧线',
            foreshadow: '梳理伏笔铺设与回收',
            commercial: '分析商业卖点与爽点',
            readability: '分析可读性与流畅度',
        };
        ALL_BREAKDOWN_DIMENSIONS.forEach(dim => {
            const item = new Setting(dimList)
                .setName(DIMENSION_LABELS[dim])
                .setDesc(DIMENSION_DESC[dim] || '')
                .addToggle(toggle => {
                    toggle.setValue(dimSet.has(dim));
                    toggle.onChange(async (value) => {
                        await this.ensureDeconstructionEngineSettingsPersists(s => {
                            const set = new Set(s.enabledDimensions);
                            if (value) set.add(dim);
                            else set.delete(dim);
                            s.enabledDimensions = ALL_BREAKDOWN_DIMENSIONS.filter(d => set.has(d));
                            if (dim === 'commercial') s.includeCommercial = value;
                            if (dim === 'readability') s.includeReadability = value;
                        });
                    });
                });
            item.settingEl.style.borderBottom = 'none';
            item.settingEl.style.padding = '6px 0';
        });

        new Setting(dimCard)
            .setName('包含商业价值分析')
            .setDesc('即使未在维度列表中勾选 commercial，也自动追加商业维度')
            .addToggle(toggle => {
                toggle.setValue(cfg.includeCommercial);
                toggle.onChange(async (value) => {
                    await this.ensureDeconstructionEngineSettingsPersists(s => {
                        s.includeCommercial = value;
                    });
                });
            });

        new Setting(dimCard)
            .setName('包含可读性分析')
            .setDesc('即使未在维度列表中勾选 readability，也自动追加可读性维度')
            .addToggle(toggle => {
                toggle.setValue(cfg.includeReadability);
                toggle.onChange(async (value) => {
                    await this.ensureDeconstructionEngineSettingsPersists(s => {
                        s.includeReadability = value;
                    });
                });
            });

        const vectorCard = section.createDiv({
            attr: { style: 'padding:12px 16px;border:1px solid var(--background-modifier-border);border-radius:6px;margin-bottom:16px;background:var(--background-secondary);' }
        });
        vectorCard.createEl('h4', { text: '🧠 向量增强', attr: { style: 'margin:0 0 12px 0;font-size:14px;' } });

        new Setting(vectorCard)
            .setName('启用向量增强')
            .setDesc('使用向量相似度匹配辅助定位相关内容，提升拆解质量')
            .addToggle(toggle => {
                toggle.setValue(cfg.vectorEnabled);
                toggle.onChange(async (value) => {
                    await this.ensureDeconstructionEngineSettingsPersists(s => {
                        s.vectorEnabled = value;
                    });
                });
            });

        new Setting(vectorCard)
            .setName('向量模型名称')
            .setDesc('用于向量嵌入的模型名称（实际提供商端点请在「写作知识库」标签页配置）')
            .addText(text => {
                text.setValue(cfg.vectorModel);
                text.setPlaceholder('bge-m3');
                text.onChange(async (value) => {
                    const trimmed = value.trim();
                    await this.ensureDeconstructionEngineSettingsPersists(s => {
                        s.vectorModel = trimmed;
                    });
                });
            });

        new Setting(vectorCard)
            .setName('向量缓存大小')
            .setDesc(`向量缓存条目上限（当前: ${cfg.vectorCacheSize}）`)
            .addSlider(slider => {
                slider.setLimits(100, 50000, 100);
                slider.setValue(cfg.vectorCacheSize);
                slider.setDynamicTooltip();
                slider.onChange(async (value) => {
                    await this.ensureDeconstructionEngineSettingsPersists(s => {
                        s.vectorCacheSize = value;
                    });
                    const descEl = slider.sliderEl.closest('.setting-item')?.querySelector('.setting-item-description');
                    if (descEl) descEl.textContent = `向量缓存条目上限（当前: ${value}）`;
                });
            });

        new Setting(vectorCard)
            .setName('批处理大小')
            .setDesc(`单次向量请求的文本条数（当前: ${cfg.vectorBatchSize}）`)
            .addSlider(slider => {
                slider.setLimits(1, 256, 1);
                slider.setValue(cfg.vectorBatchSize);
                slider.setDynamicTooltip();
                slider.onChange(async (value) => {
                    await this.ensureDeconstructionEngineSettingsPersists(s => {
                        s.vectorBatchSize = value;
                    });
                    const descEl = slider.sliderEl.closest('.setting-item')?.querySelector('.setting-item-description');
                    if (descEl) descEl.textContent = `单次向量请求的文本条数（当前: ${value}）`;
                });
            });

        const llmCard = section.createDiv({
            attr: { style: 'padding:12px 16px;border:1px solid var(--background-modifier-border);border-radius:6px;margin-bottom:16px;background:var(--background-secondary);' }
        });
        llmCard.createEl('h4', {
            text: '🤖 LLM 增强 · 实验性',
            attr: { style: 'margin:0 0 12px 0;font-size:14px;' }
        });
        llmCard.createEl('div', {
            text: '⚠️ 实验性功能：调用大模型对拆解结果做二次提炼，会增加 API 调用成本',
            attr: { style: 'font-size:12px;color:var(--text-warning);margin-bottom:10px;' }
        });

        new Setting(llmCard)
            .setName('启用 LLM 增强')
            .setDesc('使用大模型对拆解结果做二次提炼与归因')
            .addToggle(toggle => {
                toggle.setValue(cfg.llmEnabled);
                toggle.onChange(async (value) => {
                    await this.ensureDeconstructionEngineSettingsPersists(s => {
                        s.llmEnabled = value;
                    });
                });
            });

        new Setting(llmCard)
            .setName('LLM 模型名称')
            .setDesc('用于增强的 LLM 模型名称（使用当前 API 提供商）')
            .addText(text => {
                text.setValue(cfg.llmModel);
                text.setPlaceholder('deepseek-r1:7b');
                text.onChange(async (value) => {
                    const trimmed = value.trim();
                    await this.ensureDeconstructionEngineSettingsPersists(s => {
                        s.llmModel = trimmed;
                    });
                });
            });

        const perfCard = section.createDiv({
            attr: { style: 'padding:12px 16px;border:1px solid var(--background-modifier-border);border-radius:6px;margin-bottom:16px;background:var(--background-secondary);' }
        });
        perfCard.createEl('h4', { text: '⚙️ 性能', attr: { style: 'margin:0 0 12px 0;font-size:14px;' } });

        new Setting(perfCard)
            .setName('最大并发拆解数')
            .setDesc(`同时执行的拆解任务数（当前: ${cfg.maxConcurrency}）`)
            .addSlider(slider => {
                slider.setLimits(1, 8, 1);
                slider.setValue(cfg.maxConcurrency);
                slider.setDynamicTooltip();
                slider.onChange(async (value) => {
                    await this.ensureDeconstructionEngineSettingsPersists(s => {
                        s.maxConcurrency = value;
                    });
                    const descEl = slider.sliderEl.closest('.setting-item')?.querySelector('.setting-item-description');
                    if (descEl) descEl.textContent = `同时执行的拆解任务数（当前: ${value}）`;
                });
            });

        new Setting(perfCard)
            .setName('采样模式（仅分析前 N 字）')
            .setDesc('默认关闭：全本智能分段拆解，逐段覆盖全部剧情。开启后仅分析开头“文本采样上限”字数，用于快速预览。')
            .addToggle(toggle => {
                toggle.setValue(cfg.sampleMode === true);
                toggle.onChange(async (value) => {
                    await this.ensureDeconstructionEngineSettingsPersists(s => {
                        s.sampleMode = value;
                    });
                });
            });

        new Setting(perfCard)
            .setName('文本采样上限')
            .setDesc(`仅采样模式生效：采样模式下参与拆解的最大字数（当前: ${cfg.textSampleLimit.toLocaleString()}）。全本模式下此项不生效。`)
            .addText(text => {
                text.setValue(String(cfg.textSampleLimit));
                text.setPlaceholder('100000');
                text.inputEl.type = 'number';
                text.onChange(async (value) => {
                    const n = parseInt(value, 10);
                    if (!Number.isFinite(n) || n <= 0) {
                        new Notice('⚠️ 文本采样上限必须为正整数');
                        text.setValue(String(cfg.textSampleLimit));
                        return;
                    }
                    await this.ensureDeconstructionEngineSettingsPersists(s => {
                        s.textSampleLimit = n;
                    });
                });
            });

        const resetRow = section.createDiv({ attr: { style: 'display:flex;justify-content:flex-end;margin-top:12px;' } });
        const resetBtn = resetRow.createEl('button', {
            text: '↩️ 恢复默认',
            attr: { type: 'button', title: '将拆解引擎所有配置恢复为默认值', style: 'padding:6px 16px;cursor:pointer;border:1px solid var(--background-modifier-border);border-radius:4px;font-size:13px;background:var(--background-primary);' }
        });
        resetBtn.addEventListener('click', async () => {
            const confirmed = await OperationConfirmModal.confirm(this.app, {
                title: '恢复默认配置',
                description: '确定要将拆解引擎所有配置恢复为默认值吗？',
                warning: '所有自定义配置将丢失',
                confirmText: '确认恢复',
                cancelText: '取消',
            });
            if (!confirmed) return;
            this.plugin.settings.deconstructionEngine = { ...DEFAULT_DECONSTRUCTION_ENGINE_SETTINGS };
            await this.plugin.saveSettings();
            this.renderActiveTab();
            new Notice('✅ 已恢复默认配置');
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
            attr: {
                style: 'padding:14px;border:1px solid var(--background-modifier-border);border-radius:8px;background:var(--background-primary);cursor:pointer;transition:all 0.2s ease;position:relative;overflow:hidden;'
            }
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
            cls: 'kb-card-actions',
            attr: {
                style: 'position:absolute;top:8px;right:8px;display:flex;gap:4px;opacity:0;transition:opacity 0.2s ease;z-index:10;'
            }
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
                this.renderActiveTab();
                new Notice(`已删除「${book.name}」`);
            }
        });

        const titleRow = card.createDiv({ attr: { style: 'margin-bottom:6px;padding-right:60px;' } });
        titleRow.createEl('div', {
            text: book.name,
            attr: { style: 'font-size:15px;font-weight:600;color:var(--text-normal);line-height:1.4;' }
        });

        if (book.author) {
            titleRow.createEl('div', {
                text: book.author,
                attr: { style: 'font-size:12px;color:var(--text-muted);margin-top:2px;' }
            });
        }

        const statusBadge = this.getStatusBadge(book.breakdownStatus);
        card.appendChild(statusBadge);

        const allTags = [...book.themeTags, ...book.techniqueTags, ...book.customTags];
        if (allTags.length > 0) {
            const tagRow = card.createDiv({
                attr: { style: 'display:flex;gap:4px;flex-wrap:wrap;margin:10px 0;' }
            });
            const displayTags = allTags.slice(0, 3);
            displayTags.forEach(tag => {
                tagRow.createEl('span', {
                    text: tag,
                    attr: {
                        style: 'padding:2px 8px;background:var(--background-secondary);border-radius:10px;font-size:11px;color:var(--text-muted);'
                    }
                });
            });
            if (allTags.length > 3) {
                tagRow.createEl('span', {
                    text: `+${allTags.length - 3}`,
                    attr: {
                        style: 'padding:2px 8px;background:var(--background-secondary);border-radius:10px;font-size:11px;color:var(--text-faint);'
                    }
                });
            }
        }

        const metaRow = card.createDiv({
            attr: { style: 'display:flex;gap:12px;font-size:11px;color:var(--text-faint);padding-top:8px;border-top:1px solid var(--background-modifier-border);' }
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
                this.renderActiveTab();
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
            attr: { style: 'padding:12px 16px;border:1px solid var(--background-modifier-border);border-radius:6px;margin-bottom:16px;background:var(--background-secondary);' }
        });

        vectorSection.createEl('h4', {
            text: '🧠 向量增强设置',
            attr: { style: 'margin:0 0 12px 0;font-size:14px;' }
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
                    this.renderActiveTab();
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
                    text.setValue(this.plugin.settings.vectorOpenaiApiKey || '');
                    text.setPlaceholder('请输入 API Key');
                    text.onChange(async (value) => {
                        this.plugin.settings.vectorOpenaiApiKey = value;
                        await this.plugin.saveSettings();
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
                    text.setValue(this.plugin.settings.vectorDoubaoApiKey || '');
                    text.setPlaceholder('请输入 API Key');
                    text.onChange(async (value) => {
                        this.plugin.settings.vectorDoubaoApiKey = value;
                        await this.plugin.saveSettings();
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
                    text.setValue(this.plugin.settings.vectorQwenApiKey || '');
                    text.setPlaceholder('请输入 API Key');
                    text.onChange(async (value) => {
                        this.plugin.settings.vectorQwenApiKey = value;
                        await this.plugin.saveSettings();
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
                            const { EmbeddingProviderFactory } = await import('../engine/embedding/provider-factory');
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

    private renderForeshadowSection(): void {
        const section = this.tabContent.createEl('section');
        section.createEl('h3', { text: '🔮 伏笔管理' });

        new Setting(section)
            .setName('最大未揭示伏笔')
            .setDesc('允许的最大未揭示伏笔数量')
            .addText(text => text
                .setPlaceholder('20')
                .setValue(String(this.plugin.settings.maxUnrevealedForeshadow))
                .onChange(async (value) => {
                    this.plugin.settings.maxUnrevealedForeshadow = parseInt(value) || 20;
                    await this.plugin.saveSettings();
                }));

        section.createEl('h4', { text: '📝 伏笔类型配置' });
        const descP = section.createEl('p', { cls: 'setting-item-description' });
        descP.setText('自定义伏笔类型及其关键词，系统会根据配置自动识别和分类伏笔。');

        const configManager = this.getForeshadowConfigManager();
        const types = configManager.getAllTypes();

        const typeList = section.createDiv({ cls: 'nw-foreshadow-type-list' });
        types.forEach(type => {
            const typeRow = typeList.createDiv({ cls: 'nw-foreshadow-type-row' });
            
            const colorDot = typeRow.createDiv({ 
                cls: 'nw-foreshadow-color-dot',
                attr: { style: `background-color: ${type.color || '#999'}` }
            });
            
            const infoDiv = typeRow.createDiv({ cls: 'nw-foreshadow-type-info' });
            infoDiv.createEl('span', { cls: 'nw-foreshadow-type-name', text: type.name });
            infoDiv.createEl('span', { cls: 'nw-foreshadow-type-desc', text: type.description });
            
            const keywordsBadge = infoDiv.createEl('span', { cls: 'nw-foreshadow-keywords-count' });
            keywordsBadge.setText(`${type.keywords.length} 关键词`);
            
            const actionsDiv = typeRow.createDiv({ cls: 'nw-foreshadow-type-actions' });
            
            const toggleBtn = actionsDiv.createEl('button', {
                cls: 'nw-foreshadow-toggle-btn',
                text: type.enabled ? '✅' : '❌',
                attr: { title: type.enabled ? '点击禁用' : '点击启用' }
            });
            toggleBtn.onclick = async () => {
                configManager.toggleType(type.id, !type.enabled);
                this.saveForeshadowConfig(configManager);
                this.renderActiveTab();
            };
            
            const editBtn = actionsDiv.createEl('button', {
                cls: 'nw-foreshadow-action-btn',
                text: '编辑'
            });
            editBtn.onclick = () => {
                this.showForeshadowTypeModal(type);
            };
            
            const deleteBtn = actionsDiv.createEl('button', {
                cls: 'nw-foreshadow-action-btn nw-foreshadow-delete-btn',
                text: '删除'
            });
            deleteBtn.onclick = async () => {
                const confirmed = await OperationConfirmModal.confirm(this.app, {
                    title: '删除伏笔类型',
                    description: `确定删除伏笔类型 "${type.name}" 吗？`,
                    warning: '此操作不可恢复',
                    confirmText: '确认删除',
                    cancelText: '取消',
                });
                if (confirmed) {
                    configManager.deleteType(type.id);
                    this.saveForeshadowConfig(configManager);
                    this.renderActiveTab();
                }
            };
        });

        const addBtn = section.createEl('button', {
            cls: 'nw-foreshadow-add-btn',
            text: '+ 添加新伏笔类型'
        });
        addBtn.onclick = () => {
            this.showForeshadowTypeModal();
        };

        const importExportDiv = section.createDiv({ cls: 'nw-foreshadow-import-export' });
        
        const exportBtn = importExportDiv.createEl('button', {
            cls: 'nw-foreshadow-ie-btn',
            text: '📥 导出配置'
        });
        exportBtn.onclick = () => {
            const json = configManager.exportConfig();
            navigator.clipboard.writeText(json).then(() => {
                new Notice('配置已复制到剪贴板');
            });
        };
        
        const importBtn = importExportDiv.createEl('button', {
            cls: 'nw-foreshadow-ie-btn',
            text: '📤 导入配置'
        });
        importBtn.onclick = async () => {
            const modal = new Modal(this.app);
            modal.titleEl.setText('导入伏笔配置');
            
            const textarea = modal.contentEl.createEl('textarea', {
                attr: { 
                    placeholder: '粘贴导出的 JSON 配置...',
                    style: 'width: 100%; height: 200px; margin: 10px 0;'
                }
            });
            
            const importBtn = modal.contentEl.createEl('button', {
                cls: 'mod-cta',
                text: '导入'
            });
            importBtn.onclick = async () => {
                const result = configManager.importConfig(textarea.value);
                if (result.success) {
                    this.saveForeshadowConfig(configManager);
                    new Notice('配置导入成功');
                    modal.close();
                    this.renderActiveTab();
                } else {
                    new Notice('导入失败: ' + result.errors.join(', '));
                }
            };
            
            modal.open();
        };
        
        const resetBtn = importExportDiv.createEl('button', {
            cls: 'nw-foreshadow-ie-btn nw-foreshadow-reset-btn',
            text: '🔄 重置为默认'
        });
        resetBtn.onclick = async () => {
            const confirmed = await OperationConfirmModal.confirm(this.app, {
                title: '重置伏笔类型',
                description: '确定重置所有伏笔类型配置为默认值吗？',
                warning: '所有自定义伏笔类型配置将丢失',
                confirmText: '确认重置',
                cancelText: '取消',
            });
            if (confirmed) {
                configManager.resetToDefault();
                this.saveForeshadowConfig(configManager);
                new Notice('已重置为默认配置');
                this.renderActiveTab();
            }
        };
    }

    private getForeshadowConfigManager(): ForeshadowConfigManager {
        if (!this.plugin._foreshadowConfigManager) {
            const savedConfig = this.plugin.settings.foreshadowConfig;
            this.plugin._foreshadowConfigManager = new ForeshadowConfigManager(savedConfig);
        }
        return this.plugin._foreshadowConfigManager;
    }

    private saveForeshadowConfig(configManager: ForeshadowConfigManager): void {
        this.plugin.settings.foreshadowConfig = configManager.getConfig();
        this.plugin.saveSettings();
    }

    private showForeshadowTypeModal(existingType?: ForeshadowTypeConfig): void {
        const modal = new Modal(this.app);
        modal.titleEl.setText(existingType ? `编辑伏笔类型: ${existingType.name}` : '添加新伏笔类型');
        
        const form = modal.contentEl.createDiv({ cls: 'nw-foreshadow-type-form' });
        
        let nameValue = existingType?.name || '';
        let descValue = existingType?.description || '';
        let priorityValue = String(existingType?.priority || 50);
        let colorValue = existingType?.color || '#4CAF50';
        let keywordsValue = existingType?.keywords.join(', ') || '';

        new Setting(form)
            .setName('类型名称')
            .setDesc('伏笔类型的显示名称')
            .addText(text => text
                .setPlaceholder('如：物品')
                .setValue(nameValue)
                .onChange(value => { nameValue = value; }));
        
        new Setting(form)
            .setName('类型描述')
            .setDesc('描述该类型的含义和用途')
            .addText(text => text
                .setPlaceholder('如：武器、道具、丹药等实体物品')
                .setValue(descValue)
                .onChange(value => { descValue = value; }));
        
        new Setting(form)
            .setName('优先级')
            .setDesc('数值越大优先级越高，匹配时优先选择高优先级类型')
            .addText(text => text
                .setPlaceholder('100')
                .setValue(priorityValue)
                .onChange(value => { priorityValue = value; }));
        
        new Setting(form)
            .setName('显示颜色')
            .setDesc('用于在界面中标识该类型的颜色')
            .addText(text => text
                .setPlaceholder('#4CAF50')
                .setValue(colorValue)
                .onChange(value => { colorValue = value; }));
        
        new Setting(form)
            .setName('关键词（逗号分隔）')
            .setDesc('用于匹配伏笔的关键词，支持部分匹配')
            .addTextArea(textarea => textarea
                .setPlaceholder('剑,刀,枪,玉佩')
                .setValue(keywordsValue)
                .onChange(value => { keywordsValue = value; }));
        
        const saveBtn = modal.contentEl.createEl('button', {
            cls: 'mod-cta',
            text: '保存'
        });
        saveBtn.onclick = async () => {
            const name = nameValue.trim();
            const desc = descValue.trim();
            const priority = parseInt(priorityValue) || 50;
            const color = colorValue.trim();
            const keywords = keywordsValue.split(/[,，]/).map(k => k.trim()).filter(k => k);
            
            if (!name) {
                new Notice('请输入类型名称');
                return;
            }
            
            const configManager = this.getForeshadowConfigManager();
            
            if (existingType) {
                configManager.updateType(existingType.id, {
                    name,
                    description: desc,
                    priority,
                    color,
                    keywords
                });
                new Notice('类型更新成功');
            } else {
                configManager.addType({
                    name,
                    description: desc,
                    priority,
                    enabled: true,
                    color,
                    keywords
                });
                new Notice('类型添加成功');
            }
            
            this.saveForeshadowConfig(configManager);
            modal.close();
            this.renderActiveTab();
        };
        
        modal.open();
    }

    private async renderTemplateSection(): Promise<void> {
        const section = this.tabContent.createEl('section');
        const templateManager = this.plugin.engineRegistry.get<TemplateManager>(ENGINE_NAMES.TEMPLATE_MANAGER);
        await templateManager.renderTemplateList(section);

        // 提示词策略配置子分区
        section.createEl('hr', { attr: { style: 'margin:20px 0;border:none;border-top:1px solid var(--background-modifier-border);' } });
        section.createEl('h3', { text: '💬 提示词策略', attr: { style: 'margin-top:16px;' } });
        if (this.plugin.promptManager) {
            const manager = new PromptManagerSettings(this.app, this.plugin, section);
            manager.render();
        } else {
            section.createDiv({ text: '提示词管理器未初始化', cls: 'nw-text-error' });
        }
    }

    private renderAppearanceSection(): void {
        const section = this.tabContent.createEl('section');
        renderAppearanceSettings(section, this.plugin, {
            compact: false,
            rerender: () => this.renderActiveTab(),
        });
    }

    private renderWorkspaceLayoutSection(): void {
        const section = this.tabContent.createEl('section');
        section.createEl('h3', { text: '🧩 工作台布局' });
        section.createEl('p', {
            text: '控制浮窗工作台是否在 Obsidian 启动后恢复上次布局。面板位置由浮窗系统自动记录。',
            cls: 'setting-item-description'
        });

        const panelLayout = this.plugin.settings.panelLayout || { panels: [], autoRestore: true, lastWorkspaceOpen: false };
        this.plugin.settings.panelLayout = panelLayout;

        new Setting(section)
            .setName('启动时恢复上次工作台')
            .setDesc('开启后，如果上次关闭 Obsidian 时工作台处于打开状态，插件加载后会自动恢复。')
            .addToggle(toggle => toggle
                .setValue(panelLayout.autoRestore !== false)
                .onChange(async (value) => {
                    if (!this.plugin.settings.panelLayout) {
                        this.plugin.settings.panelLayout = { panels: [], autoRestore: true, lastWorkspaceOpen: false };
                    }
                    this.plugin.settings.panelLayout.autoRestore = value;
                    await this.plugin.saveSettings();
                }));

        const savedCount = Array.isArray(panelLayout.panels) ? panelLayout.panels.length : 0;
        new Setting(section)
            .setName('清除已保存浮窗位置')
            .setDesc('当前已保存 ' + savedCount + ' 个面板位置。')
            .addButton(btn => btn
                .setButtonText('清除布局记忆')
                .setWarning()
                .onClick(async () => {
                    if (!this.plugin.settings.panelLayout) {
                        this.plugin.settings.panelLayout = { panels: [], autoRestore: true, lastWorkspaceOpen: false };
                    }
                    this.plugin.settings.panelLayout.panels = [];
                    this.plugin.settings.panelLayout.lastWorkspaceOpen = false;
                    await this.plugin.saveSettings();
                    this.renderActiveTab();
                    new Notice('✅ 已清除浮窗布局记忆');
                }));
    }

    private showEditCustomProviderForm(cp: { id: string; name: string; endpoint: string; models: string[]; maxContext: number; maxOutput: number }): void {
        const plugin = this.plugin;
        const onSaved = () => this.renderActiveTab();
        class EditCustomProviderModal extends Modal {
            plugin: NovelWriterPlugin; cp: CustomProvider; onSaved: () => void;
            constructor(app: App, plugin: NovelWriterPlugin, cp: CustomProvider, onSaved: () => void) { super(app); this.plugin = plugin; this.cp = cp; this.onSaved = onSaved; }
            onOpen() {
    this.modalEl.addClass('nw-scope');
                const { contentEl } = this;
                contentEl.empty();
                contentEl.createEl('h3', { text: `✏️ 编辑 "${this.cp.name}"` });
                const formDiv = contentEl.createDiv({ attr: { style: 'margin-top:16px;' } });
                let nameV = this.cp.name;
                let endpointV = this.cp.endpoint;
                let modelsStr = this.cp.models.join(', ');
                let maxCtxV = this.cp.maxContext;
                let maxOutV = this.cp.maxOutput;
                let apiKeyV = this.plugin.settings.providerKeys[this.cp.id] || '';

                new Setting(formDiv).setName('提供商名称').addText(t => t.setValue(nameV).onChange(v => nameV = v));
                new Setting(formDiv).setName('API 端点').addText(t => t.setValue(endpointV).onChange(v => endpointV = v.trim()));
                new Setting(formDiv).setName('模型列表').addText(t => t.setValue(modelsStr).onChange(v => modelsStr = v));
                new Setting(formDiv).setName('上下文上限').addText(t => t.setValue(String(maxCtxV)).onChange(v => maxCtxV = parseInt(v) || 128000));
                new Setting(formDiv).setName('输出上限').addText(t => t.setValue(String(maxOutV)).onChange(v => maxOutV = parseInt(v) || 32768));
                new Setting(formDiv).setName('API 密钥').addText(t => { t.inputEl.type = 'password'; t.setValue(apiKeyV).onChange(v => apiKeyV = v); });

                const btnRow = contentEl.createDiv({ attr: { style: 'display:flex;gap:8px;margin-top:16px;justify-content:flex-end;' } });
                btnRow.createEl('button', { text: '取消' }).onclick = () => this.close();
                btnRow.createEl('button', { text: '💾 保存', attr: { style: 'background:var(--interactive-accent);color:var(--text-on-accent);border:none;border-radius:4px;padding:6px 16px;cursor:pointer;' } }).onclick = async () => {
                    if (!nameV.trim() || !endpointV.trim()) { new Notice('名称和端点不能为空'); return; }
                    const models = modelsStr.split(/[,，]/).map((m: string) => m.trim()).filter((m: string) => m);
                    if (models.length === 0) { new Notice('请至少输入一个模型名'); return; }
                    const idx = this.plugin.settings.customProviders.findIndex((c: CustomProvider) => c.id === this.cp.id);
                    if (idx >= 0) {
                        this.plugin.settings.customProviders[idx] = { id: this.cp.id, name: nameV.trim(), endpoint: endpointV.trim(), models, maxContext: maxCtxV, maxOutput: maxOutV };
                    }
                    this.plugin.settings.providerKeys[this.cp.id] = apiKeyV;
                    await this.plugin.saveSettings();
                    this.plugin.updateStatusBarText();
                    this.close();
                    new Notice(`✅ 已更新 "${nameV.trim()}"`);
                    this.onSaved();
                };
            }
            onClose() { this.contentEl.empty(); }
        }
        new EditCustomProviderModal(this.app, plugin, cp, onSaved).open();
    }

    async resetSettings(): Promise<void> {
        this.plugin.settings = Object.assign({}, DEFAULT_SETTINGS);
        await this.plugin.saveSettings();
        this.renderActiveTab();
        new Notice('✅ 设置已重置', 3000);
    }

    private showManageProvidersModal(): void {
        new ManageProvidersModal(this.app, this.plugin, () => this.renderActiveTab()).open();
    }

    private showAddCustomProviderForm(_section: HTMLElement): void {
        const plugin = this.plugin;
        const onSaved = () => this.renderActiveTab();
        class AddCustomProviderModal extends Modal {
            plugin: NovelWriterPlugin;
            onSaved: () => void;
            constructor(app: App, plugin: NovelWriterPlugin, onSaved: () => void) {
                super(app);
                this.plugin = plugin;
                this.onSaved = onSaved;
            }
            onOpen() {
    this.modalEl.addClass('nw-scope');
                const { contentEl } = this;
                contentEl.empty();
                contentEl.createEl('h3', { text: '➕ 添加自定义 API 提供商' });

                const formDiv = contentEl.createDiv({ attr: { style: 'margin-top:16px;' } });
                let nameValue = '';
                let endpointValue = '';
                let modelsStr = '';
                let maxCtxValue = 128000;
                let maxOutValue = 32768;
                let apiKeyValue = '';

                new Setting(formDiv)
                    .setName('提供商名称')
                    .setDesc('用于下拉列表和状态栏显示')
                    .addText(text => text.setPlaceholder('例如：我的私有代理').onChange(v => nameValue = v));

                new Setting(formDiv)
                    .setName('API 端点')
                    .setDesc('OpenAI 兼容 API 的基础 URL')
                    .addText(text => text.setPlaceholder('https://api.example.com/v1/chat/completions').onChange(v => endpointValue = v.trim()));

                new Setting(formDiv)
                    .setName('模型列表')
                    .setDesc('逗号分隔，第一个为默认模型')
                    .addText(text => text.setPlaceholder('model-a, model-b').onChange(v => modelsStr = v));

                new Setting(formDiv)
                    .setName('上下文上限 (tokens)')
                    .addText(text => text.setValue('128000').onChange(v => maxCtxValue = parseInt(v) || 128000));

                new Setting(formDiv)
                    .setName('输出上限 (tokens)')
                    .addText(text => text.setValue('32768').onChange(v => maxOutValue = parseInt(v) || 32768));

                new Setting(formDiv)
                    .setName('API 密钥')
                    .addText(text => { text.inputEl.type = 'password'; text.setPlaceholder('sk-...').onChange(v => apiKeyValue = v); });

                const btnRow = contentEl.createDiv({ attr: { style: 'display:flex;gap:8px;margin-top:16px;justify-content:flex-end;' } });
                btnRow.createEl('button', { text: '取消', attr: { style: 'padding:6px 16px;' } }).onclick = () => this.close();
                const saveBtn = btnRow.createEl('button', {
                    text: '✅ 添加并切换',
                    attr: { style: 'padding:6px 16px;background:var(--interactive-accent);color:var(--text-on-accent);border:none;border-radius:4px;cursor:pointer;' }
                });
                saveBtn.onclick = async () => {
                    if (!nameValue.trim()) { new Notice('❌ 请输入提供商名称'); return; }
                    if (!endpointValue.trim()) { new Notice('❌ 请输入 API 端点'); return; }
                    const models = modelsStr.split(/[,，]/).map((m: string) => m.trim()).filter((m: string) => m);
                    if (models.length === 0) { new Notice('❌ 请至少输入一个模型名'); return; }

                    this.plugin.addCustomProvider(nameValue.trim(), endpointValue.trim(), models, maxCtxValue, maxOutValue, apiKeyValue);
                    await this.plugin.saveSettings();
                    this.plugin.updateStatusBarText();
                    this.close();
                    new Notice(`✅ 已添加并切换到 "${nameValue.trim()}"`, 3000);
                    this.onSaved();
                };
            }
            onClose() { this.contentEl.empty(); }
        }
        new AddCustomProviderModal(this.app, plugin, onSaved).open();
    }

    private renderPerformanceSection(): void {
        const section = this.tabContent.createEl('section');

        section.createEl('h3', { text: '📊 性能监控' });
        section.createEl('p', { text: '监控插件关键操作的性能，识别性能瓶颈并优化。', attr: { style: 'color:var(--text-muted);font-size:13px;margin-bottom:16px;' } });

        const perfEnabled = performanceMonitor.isEnabled();
        new Setting(section)
            .setName('启用性能监控')
            .setDesc('开启后将记录关键操作的耗时和内存使用，用于性能分析和优化')
            .addToggle(toggle => toggle
                .setValue(perfEnabled)
                .onChange(value => {
                    performanceMonitor.setEnabled(value);
                    this.renderActiveTab();
                })
            );

        if (!performanceMonitor.isEnabled()) {
            section.createEl('div', {
                text: '⚠️  性能监控已关闭',
                cls: 'nw-empty-info-card', attr: { style: 'margin-top:16px;' }
            });
            return;
        }

        const log = performanceMonitor.getLog(50);
        const categoryStats = performanceMonitor.getCategoryStats();
        const slowOps = performanceMonitor.getSlowOperations();
        const memoryInfo = performanceMonitor.getMemoryInfo();

        let cacheStats: { hitRate: number; totalEntries: number; totalSize: number } | undefined;
        try {
            const cacheService = this.plugin.engineRegistry.getOrNull<WorldviewCacheService>(ENGINE_NAMES.WORLDVIEW_CACHE_SERVICE);
            if (cacheService) {
                const s = cacheService.getStats();
                cacheStats = {
                    hitRate: s.hitRate,
                    totalEntries: s.totalEntries,
                    totalSize: s.totalSize,
                };
            }
        } catch {
        }

        section.createEl('h4', { text: '📈 概览统计', cls: 'nw-h4-section' });

        const statsGrid = section.createEl('div', {
            attr: { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:20px;' }
        });

        const totalOps = Object.values(categoryStats).reduce((sum, c) => sum + c.count, 0);
        const totalDuration = Object.values(categoryStats).reduce((sum, c) => sum + c.totalDuration, 0);

        this.addStatCard(statsGrid, '总操作数', totalOps.toString());
        this.addStatCard(statsGrid, '总耗时', this.formatDuration(totalDuration));
        this.addStatCard(statsGrid, '平均耗时', totalOps > 0 ? this.formatDuration(totalDuration / totalOps) : 'N/A');
        this.addStatCard(statsGrid, '慢操作', slowOps.length.toString());

        if (memoryInfo.current || memoryInfo.peak) {
            this.addStatCard(statsGrid, '当前内存', memoryInfo.current ? this.formatBytes(memoryInfo.current) : 'N/A');
            this.addStatCard(statsGrid, '峰值内存', memoryInfo.peak ? this.formatBytes(memoryInfo.peak) : 'N/A');
        }

        if (cacheStats) {
            this.addStatCard(statsGrid, '缓存命中率', (cacheStats.hitRate * 100).toFixed(1) + '%');
            this.addStatCard(statsGrid, '缓存条目', cacheStats.totalEntries.toString());
        }

        section.createEl('h4', { text: '📂 分类统计', cls: 'nw-h4-section' });

        const catTable = section.createEl('table', {
            attr: { style: 'width:100%;border-collapse:collapse;margin-bottom:20px;font-size:13px;' }
        });
        const thead = catTable.createEl('thead');
        const headRow = thead.createEl('tr');
        ['分类', '次数', '总耗时', '平均耗时', '占比'].forEach(h => {
            const th = headRow.createEl('th');
            th.textContent = h;
            th.setAttribute('style', 'padding:8px 12px;text-align:left;background:var(--background-secondary);border-bottom:1px solid var(--background-modifier-border);');
        });
        const tbody = catTable.createEl('tbody');
        for (const [cat, stats] of Object.entries(categoryStats)) {
            if (stats.count === 0) continue;
            const row = tbody.createEl('tr');
            const percent = totalDuration > 0 ? ((stats.totalDuration / totalDuration) * 100).toFixed(1) + '%' : '0%';
            [cat, stats.count.toString(), this.formatDuration(stats.totalDuration), this.formatDuration(stats.avgDuration), percent].forEach((v, i) => {
                const td = row.createEl('td');
                td.textContent = v;
                td.setAttribute('style', 'padding:8px 12px;border-bottom:1px solid var(--background-modifier-border);');
                if (i === 0) td.style.fontWeight = '600';
            });
        }

        section.createEl('h4', { text: '🐢 最近慢操作', cls: 'nw-h4-section' });

        if (slowOps.length === 0) {
            section.createEl('div', {
                text: '✅ 暂无慢操作记录',
                cls: 'nw-empty-info-card'
            });
        } else {
            const slowList = section.createEl('div', {
                attr: { style: 'max-height:240px;overflow-y:auto;border:1px solid var(--background-modifier-border);border-radius:8px;' }
            });
            for (const op of slowOps.slice(0, 20)) {
                const item = slowList.createEl('div', {
                    attr: { style: 'padding:10px 14px;border-bottom:1px solid var(--background-modifier-border);' }
                });
                const top = item.createEl('div', { attr: { style: 'display:flex;justify-content:space-between;align-items:center;' } });
                top.createEl('span', { text: op.name, attr: { style: 'font-weight:600;' } });
                top.createEl('span', {
                    text: this.formatDuration(op.duration),
                    attr: { style: 'color:var(--text-error);font-weight:600;' }
                });
                const bottom = item.createEl('div', {
                    text: `${op.category} · ${new Date(op.timestamp).toLocaleString()} · 阈值: ${this.formatDuration(op.threshold)}`,
                    attr: { style: 'font-size:12px;color:var(--text-muted);margin-top:4px;' }
                });
            }
        }

        section.createEl('h4', { text: '📝 最近操作日志', cls: 'nw-h4-section' });

        if (log.length === 0) {
            section.createEl('div', {
                text: '暂无性能数据，请先使用插件功能',
                cls: 'nw-empty-info-card'
            });
        } else {
            const logContainer = section.createEl('div', {
                attr: { style: 'max-height:300px;overflow-y:auto;border:1px solid var(--background-modifier-border);border-radius:8px;font-family:var(--font-monospace);font-size:12px;' }
            });
            for (const entry of log.slice(0, 50)) {
                const item = logContainer.createEl('div', {
                    attr: { style: 'padding:6px 12px;border-bottom:1px solid var(--background-modifier-border);display:flex;justify-content:space-between;gap:12px;' }
                });
                const left = item.createEl('span');
                left.textContent = `[${entry.category}] ${entry.name}`;
                const right = item.createEl('span', {
                    attr: { style: 'color:var(--text-muted);white-space:nowrap;' }
                });
                right.textContent = this.formatDuration(entry.duration);
            }
        }

        section.createEl('h4', { text: '⚙️ 操作', cls: 'nw-h4-section' });

        const btnRow = section.createEl('div', {
            attr: { style: 'display:flex;gap:10px;flex-wrap:wrap;' }
        });

        const reportBtn = btnRow.createEl('button', {
            text: '📄 生成性能报告',
            attr: {
                type: 'button',
                style: 'padding:8px 16px;cursor:pointer;background:var(--interactive-accent);color:var(--text-on-accent);border:none;border-radius:6px;font-size:13px;font-weight:500;'
            }
        });
        reportBtn.onclick = () => {
            const report = performanceMonitor.generateTextReport(cacheStats);
            this.showPerformanceReport(report);
        };

        const exportBtn = btnRow.createEl('button', {
            text: '📤 导出日志',
            attr: {
                type: 'button',
                style: 'padding:8px 16px;cursor:pointer;background:var(--background-secondary);color:var(--text-normal);border:1px solid var(--background-modifier-border);border-radius:6px;font-size:13px;'
            }
        });
        exportBtn.onclick = async () => {
            const json = performanceMonitor.exportLog();
            await exportTextFile(this.app, `performance-log-${new Date().toISOString().slice(0, 10)}.json`, json, {
                mime: 'application/json',
                successMessage: '✅ 性能日志已导出',
            });
        };

        const clearBtn = btnRow.createEl('button', {
            text: '🗑️ 清空日志',
            attr: {
                type: 'button',
                style: 'padding:8px 16px;cursor:pointer;background:var(--background-secondary);color:var(--text-error);border:1px solid var(--background-modifier-error);border-radius:6px;font-size:13px;'
            }
        });
        clearBtn.onclick = async () => {
            const confirmed = await OperationConfirmModal.confirm(this.app, {
                title: '清空性能日志',
                description: '确定要清空所有性能日志吗？',
                warning: '此操作不可恢复',
                confirmText: '确认清空',
                cancelText: '取消',
            });
            if (confirmed) {
                performanceMonitor.clearLog();
                this.renderActiveTab();
                new Notice('✅ 性能日志已清空', 2000);
            }
        };

        const refreshBtn = btnRow.createEl('button', {
            text: '🔄 刷新',
            attr: {
                type: 'button',
                style: 'padding:8px 16px;cursor:pointer;background:var(--background-secondary);color:var(--text-normal);border:1px solid var(--background-modifier-border);border-radius:6px;font-size:13px;'
            }
        });
        refreshBtn.onclick = () => {
            this.renderActiveTab();
        };
    }

    private addStatCard(container: HTMLElement, label: string, value: string): void {
        const card = container.createEl('div', {
            attr: { style: 'padding:14px;background:var(--background-secondary);border-radius:8px;' }
        });
        card.createEl('div', {
            text: label,
            attr: { style: 'font-size:12px;color:var(--text-muted);margin-bottom:6px;' }
        });
        card.createEl('div', {
            text: value,
            attr: { style: 'font-size:18px;font-weight:700;' }
        });
    }

    private showPerformanceReport(report: string): void {
        const modal = new Modal(this.app);
        modal.modalEl.addClass('nw-scope');
        modal.modalEl.addClass('nw-modal');
        const { contentEl } = modal;
        contentEl.empty();
        contentEl.createEl('h3', { text: '📊 性能报告' });
        const textarea = contentEl.createEl('textarea', {
            attr: {
                style: 'width:100%;height:400px;font-family:var(--font-monospace);font-size:12px;padding:12px;border:1px solid var(--background-modifier-border);border-radius:6px;background:var(--background-primary);color:var(--text-normal);resize:vertical;',
                readonly: 'readonly'
            }
        });
        textarea.value = report;
        const btnRow = contentEl.createEl('div', {
            attr: { style: 'display:flex;gap:10px;justify-content:flex-end;margin-top:16px;' }
        });
        const copyBtn = btnRow.createEl('button', {
            text: '📋 复制报告',
            attr: {
                type: 'button',
                style: 'padding:8px 16px;cursor:pointer;background:var(--interactive-accent);color:var(--text-on-accent);border:none;border-radius:6px;font-size:13px;'
            }
        });
        copyBtn.onclick = async () => {
            try {
                await navigator.clipboard.writeText(report);
                new Notice('✅ 报告已复制到剪贴板', 2000);
            } catch {
                new Notice('❌ 复制失败', 2000);
            }
        };
        const closeBtn = btnRow.createEl('button', {
            text: '关闭',
            attr: {
                type: 'button',
                style: 'padding:8px 16px;cursor:pointer;background:var(--background-secondary);color:var(--text-normal);border:1px solid var(--background-modifier-border);border-radius:6px;font-size:13px;'
            }
        });
        closeBtn.onclick = () => modal.close();
        modal.open();
    }

    private formatDuration(ms: number): string {
        if (ms < 1) return `${(ms * 1000).toFixed(2)}μs`;
        if (ms < 1000) return `${ms.toFixed(2)}ms`;
        if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
        return `${(ms / 60000).toFixed(2)}min`;
    }

    private formatBytes(bytes: number): string {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
        if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
        return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    }

    private renderUpdateBanner(container: HTMLElement): void {
        try {
            const cacheManager = this.plugin.engineRegistry.getOrNull<any>(ENGINE_NAMES.CACHE_MANAGER);
            if (!cacheManager) return;

            const lastResult = cacheManager.getUpdateLastResult();
            if (!lastResult?.hasUpdate || !lastResult.latestVersion) return;

            const latestVersion = lastResult.latestVersion;
            const updateChecker = this.plugin.engineRegistry.getOrNull<any>(ENGINE_NAMES.UPDATE_CHECKER);
            if (updateChecker && updateChecker.hasNotifiedVersion(latestVersion)) return;

            const banner = container.createDiv({
                attr: {
                    style: 'margin-bottom:16px;padding:14px 18px;background:linear-gradient(135deg, var(--background-modifier-success) 0%, var(--interactive-accent) 100%);border-radius:10px;color:white;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;'
                }
            });

            const left = banner.createDiv({ attr: { style: 'flex:1;min-width:200px;' } });
            left.createEl('div', {
                text: `🎉 发现新版本 v${latestVersion}`,
                attr: { style: 'font-weight:600;font-size:15px;margin-bottom:4px;' }
            });
            left.createEl('div', {
                text: lastResult.releaseNotes
                    ? lastResult.releaseNotes.substring(0, 80) + (lastResult.releaseNotes.length > 80 ? '...' : '')
                    : '点击查看详情了解新功能和改进',
                attr: { style: 'font-size:12px;opacity:0.9;' }
            });

            const right = banner.createDiv({ attr: { style: 'display:flex;gap:8px;flex-shrink:0;' } });

            const detailBtn = right.createEl('button', {
                text: '查看详情',
                attr: {
                    type: 'button',
                    style: 'padding:6px 14px;cursor:pointer;background:white;color:var(--interactive-accent);border:none;border-radius:6px;font-size:12px;font-weight:600;'
                }
            });
            detailBtn.addEventListener('click', () => {
                new ChangelogModal(this.app, {
                    highlightVersion: latestVersion,
                }).open();
            });

            const laterBtn = right.createEl('button', {
                text: '稍后提醒',
                attr: {
                    type: 'button',
                    style: 'padding:6px 14px;cursor:pointer;background:rgba(255,255,255,0.2);color:white;border:1px solid rgba(255,255,255,0.3);border-radius:6px;font-size:12px;'
                }
            });
            laterBtn.addEventListener('click', () => {
                if (updateChecker) {
                    updateChecker.markUpdateNotified(latestVersion);
                }
                this.display();
            });
        } catch {
        }
    }

    private renderPromptsSection(): void {
        const section = this.tabContent.createEl('section');
        if (!this.plugin.promptManager) {
            section.createDiv({ text: '提示词管理器未初始化', cls: 'nw-text-error' });
            return;
        }
        const manager = new PromptManagerSettings(this.app, this.plugin, section);
        manager.render();
    }

    private async renderRulesSection(): Promise<void> {
        const section = this.tabContent.createEl('section');

        section.createEl('h3', { text: '📜 写作规则版本管理', attr: { style: 'margin-top:0;' } });

        section.createEl('p', {
            text: '写作规则是 AI 生成正文时遵循的核心准则。版本不匹配可能导致生成质量下降或出现不一致行为。',
            attr: { style: 'color:var(--text-muted);font-size:13px;margin-bottom:20px;' }
        });

        const statusCard = section.createDiv({
            attr: {
                style: 'padding:20px;background:var(--background-secondary);border-radius:10px;margin-bottom:20px;'
            }
        });

        try {
            const rulesService = RulesService.getInstance(this.app);
            const { current, expected } = await rulesService.checkRulesVersion();
            const isPresent = await rulesService.isRulesFilePresent();
            const config = await rulesService.getRulesConfig();

            const statusRow1 = statusCard.createDiv({ cls: 'nw-status-row' });
            statusRow1.createDiv({ text: '规则文件状态:', cls: 'nw-status-label' });
            const statusBadge = statusRow1.createDiv({
                text: isPresent ? '✅ 已检测到' : '⚠️ 未找到',
                attr: {
                    style: `padding:4px 12px;border-radius:12px;font-size:12px;font-weight:600;${
                        isPresent ? 'background:var(--text-accent);color:var(--background-primary);' : 'background:var(--background-modifier-warning);color:var(--text-warning);'
                    }`
                }
            });

            const statusRow2 = statusCard.createDiv({ cls: 'nw-status-row' });
            statusRow2.createDiv({ text: '当前规则版本:', cls: 'nw-status-label' });
            statusRow2.createDiv({ text: current === 'unknown' ? '无法检测' : `v${current}`, attr: { style: 'font-family:monospace;' } });

            const statusRow3 = statusCard.createDiv({ cls: 'nw-status-row' });
            statusRow3.createDiv({ text: '期望规则版本:', cls: 'nw-status-label' });
            statusRow3.createDiv({ text: `v${expected}`, attr: { style: 'font-family:monospace;' } });

            if (config.lastModified > 0) {
                const statusRow4 = statusCard.createDiv({ cls: 'nw-status-row' });
                statusRow4.createDiv({ text: '最后修改时间:', cls: 'nw-status-label' });
                statusRow4.createDiv({ text: new Date(config.lastModified).toLocaleString(), attr: { style: 'font-size:12px;color:var(--text-muted);' } });
            }

            if (!isPresent) {
                section.createDiv({
                    text: '❌ 警告：未找到写作规则文件！AI 将使用内置的默认规则。建议在项目根目录创建「00-系统模板/写作规则.md」文件。',
                    attr: { style: 'padding:12px;background:var(--background-modifier-error);color:var(--text-error);border-radius:6px;margin-bottom:16px;' }
                });
            } else if (current !== expected && current !== 'unknown') {
                section.createDiv({
                    text: `⚠️ 警告：规则版本不匹配！当前 v${current}，期望 v${expected}。建议更新写作规则文件以确保生成质量。`,
                    attr: { style: 'padding:12px;background:var(--background-modifier-warning);color:var(--text-warning);border-radius:6px;margin-bottom:16px;' }
                });
            } else {
                section.createDiv({
                    text: '✅ 规则版本正常',
                    attr: { style: 'padding:12px;background:var(--background-modifier-success);color:var(--text-success);border-radius:6px;margin-bottom:16px;' }
                });
            }

            const refreshBtn = section.createEl('button', {
                text: '🔄 重新检查',
                attr: {
                    type: 'button',
                    style: 'padding:8px 20px;cursor:pointer;background:var(--background-secondary);color:var(--text-primary);border:1px solid var(--background-modifier-border);border-radius:6px;font-size:13px;margin-right:10px;'
                }
            });
            refreshBtn.addEventListener('click', () => {
                rulesService.invalidateCache();
                this.renderRulesSection();
            });

            const viewBtn = section.createEl('button', {
                text: '📝 查看规则内容',
                attr: {
                    type: 'button',
                    style: 'padding:8px 20px;cursor:pointer;background:var(--text-accent);color:var(--background-primary);border:none;border-radius:6px;font-size:13px;font-weight:600;'
                }
            });
            viewBtn.addEventListener('click', async () => {
                const rules = await rulesService.getWritingRules();
                const modal = new (class extends Modal {
                    constructor(app: any) { super(app); }
                    onOpen() {
                        const { contentEl } = this;
                        contentEl.createEl('h3', { text: '写作规则内容' });
                        const textarea = contentEl.createEl('textarea', {
                            attr: {
                                style: 'width:100%;height:400px;padding:12px;font-family:monospace;font-size:12px;border:1px solid var(--background-modifier-border);border-radius:6px;background:var(--background-primary);color:var(--text-primary);resize:none;'
                            }
                        });
                        textarea.value = rules;
                    }
                })(this.app);
                modal.open();
            });

        } catch (e) {
            statusCard.createDiv({
                text: `❌ 检查失败: ${(e as Error).message}`,
                cls: 'nw-text-error'
            });
        }
    }

    private renderAboutSection(): void {
        const section = this.tabContent.createEl('section');

        section.createEl('h3', { text: '📖 小说工坊 AI', attr: { style: 'margin-top:0;' } });

        const currentVersion = PLUGIN_VERSION;

        const versionCard = section.createDiv({
            attr: {
                style: 'padding:20px;background:var(--background-secondary);border-radius:10px;margin-bottom:20px;text-align:center;'
            }
        });

        versionCard.createEl('div', {
            text: '当前版本',
            attr: { style: 'font-size:13px;color:var(--text-muted);margin-bottom:4px;' }
        });
        versionCard.createEl('div', {
            text: `v${currentVersion}`,
            attr: { style: 'font-size:32px;font-weight:700;color:var(--text-normal);margin-bottom:8px;' }
        });

        let lastCheckInfo = '从未检查';
        let latestVersionInfo = '—';
        try {
            const cacheManager = this.plugin.engineRegistry.getOrNull<any>(ENGINE_NAMES.CACHE_MANAGER);
            if (cacheManager) {
                const lastCheck = cacheManager.getUpdateLastCheck();
                if (lastCheck) {
                    lastCheckInfo = new Date(lastCheck).toLocaleString('zh-CN');
                }
                const lastResult = cacheManager.getUpdateLastResult();
                if (lastResult?.latestVersion) {
                    latestVersionInfo = `v${lastResult.latestVersion}` + (lastResult.hasUpdate ? ' (有更新)' : ' (已是最新)');
                } else if (lastResult?.error) {
                    latestVersionInfo = `检查失败：${lastResult.error}`;
                }
            }
        } catch {
        }

        const infoGrid = versionCard.createDiv({
            attr: { style: 'display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:16px;text-align:left;' }
        });

        this.renderInfoItem(infoGrid, '最新版本', latestVersionInfo);
        this.renderInfoItem(infoGrid, '上次检查', lastCheckInfo);

        const btnRow = section.createDiv({
            attr: { style: 'display:flex;gap:10px;margin-bottom:24px;flex-wrap:wrap;' }
        });

        const checkBtn = btnRow.createEl('button', {
            text: '🔍 检查更新',
            attr: {
                type: 'button',
                style: 'padding:8px 18px;cursor:pointer;background:var(--interactive-accent);color:var(--text-on-accent);border:none;border-radius:6px;font-size:13px;font-weight:500;'
            }
        });
        checkBtn.addEventListener('click', async () => {
            checkBtn.disabled = true;
            checkBtn.textContent = '检查中...';
            try {
                const updateChecker = this.plugin.engineRegistry.getOrNull<any>(ENGINE_NAMES.UPDATE_CHECKER);
                if (updateChecker) {
                    const result = await updateChecker.checkForUpdates(true);
                    if (result.hasUpdate) {
                        new Notice(`🎉 发现新版本 v${result.latestVersion}`, 4000);
                    } else if (result.error) {
                        new Notice(`检查失败: ${result.error}`, 3000);
                    } else {
                        new Notice('✅ 已是最新版本', 2000);
                    }
                }
            } catch (e) {
                new Notice('检查更新失败', 2000);
            }
            checkBtn.disabled = false;
            checkBtn.textContent = '🔍 检查更新';
            this.renderActiveTab();
        });

        const changelogBtn = btnRow.createEl('button', {
            text: '📜 更新日志',
            attr: {
                type: 'button',
                style: 'padding:8px 18px;cursor:pointer;border:1px solid var(--background-modifier-border);background:var(--background-primary);color:var(--text-normal);border-radius:6px;font-size:13px;'
            }
        });
        changelogBtn.addEventListener('click', () => {
            new ChangelogModal(this.app, {
                highlightVersion: currentVersion,
            }).open();
        });

        section.createEl('h4', { text: '⚙️ 更新设置', attr: { style: 'margin-bottom:12px;' } });

        new Setting(section)
            .setName('自动检查更新')
            .setDesc('定期检查插件更新，仅在后台静默检查，不打扰使用')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoCheckUpdates ?? false)
                .onChange(async (value) => {
                    this.plugin.settings.autoCheckUpdates = value;
                    await this.plugin.saveSettings();
                    const updateChecker = this.plugin.engineRegistry.getOrNull<any>(ENGINE_NAMES.UPDATE_CHECKER);
                    if (updateChecker) {
                        updateChecker.updateConfig({ enabled: value });
                    }
                    this.renderActiveTab();
                })
            );

        const updateSourceSetting = new Setting(section)
            .setName('更新源')
            .setDesc('选择检查更新的来源')
            .addDropdown(dropdown => {
                dropdown.addOption('github', 'GitHub Releases');
                dropdown.addOption('custom', '自定义服务器');
                dropdown.setValue(this.plugin.settings.updateSource || 'github');
                dropdown.onChange(async (value) => {
                    this.plugin.settings.updateSource = value as 'github' | 'custom';
                    await this.plugin.saveSettings();
                    const updateChecker = this.plugin.engineRegistry.getOrNull<any>(ENGINE_NAMES.UPDATE_CHECKER);
                    if (updateChecker) {
                        updateChecker.updateConfig({ source: value as 'github' | 'custom' });
                    }
                    this.renderActiveTab();
                });
            });

        if (this.plugin.settings.updateSource === 'github') {
            new Setting(section)
                .setName('GitHub 仓库')
                .setDesc('格式：owner/repo')
                .addText(text => text
                    .setPlaceholder('Moxifeng11/novel-writer-ai')
                    .setValue(this.plugin.settings.updateGithubRepo || 'Moxifeng11/novel-writer-ai')
                    .onChange(async (value) => {
                        this.plugin.settings.updateGithubRepo = value;
                        await this.plugin.saveSettings();
                        const updateChecker = this.plugin.engineRegistry.getOrNull<any>(ENGINE_NAMES.UPDATE_CHECKER);
                        if (updateChecker) {
                            updateChecker.updateConfig({ githubRepo: value });
                        }
                    })
                );
        } else {
            new Setting(section)
                .setName('自定义更新 URL')
                .setDesc('返回 JSON 格式的最新版本信息')
                .addText(text => text
                    .setPlaceholder('https://example.com/version.json')
                    .setValue(this.plugin.settings.updateCustomUrl || '')
                    .onChange(async (value) => {
                        this.plugin.settings.updateCustomUrl = value;
                        await this.plugin.saveSettings();
                        const updateChecker = this.plugin.engineRegistry.getOrNull<any>(ENGINE_NAMES.UPDATE_CHECKER);
                        if (updateChecker) {
                            updateChecker.updateConfig({ customUrl: value });
                        }
                    })
                );
        }

        new Setting(section)
            .setName('检查间隔')
            .setDesc('自动检查更新的频率（小时）')
            .addDropdown(dropdown => {
                const options: Record<string, string> = {
                    '24': '每天',
                    '72': '每 3 天',
                    '168': '每周',
                    '720': '每月',
                };
                for (const [k, v] of Object.entries(options)) {
                    dropdown.addOption(k, v);
                }
                dropdown.setValue(String(this.plugin.settings.updateCheckIntervalHours || 168));
                dropdown.onChange(async (value) => {
                    this.plugin.settings.updateCheckIntervalHours = parseInt(value, 10);
                    await this.plugin.saveSettings();
                    const updateChecker = this.plugin.engineRegistry.getOrNull<any>(ENGINE_NAMES.UPDATE_CHECKER);
                    if (updateChecker) {
                        updateChecker.updateConfig({ checkIntervalHours: parseInt(value, 10) });
                    }
                });
            });

        section.createEl('h4', { text: '📌 关于插件', attr: { style: 'margin:24px 0 12px 0;' } });

        const aboutCard = section.createDiv({
            attr: {
                style: 'padding:16px;background:var(--background-secondary);border-radius:8px;font-size:13px;line-height:1.7;color:var(--text-muted);'
            }
        });

        aboutCard.createEl('p', {
            text: '全流程 AI 长篇小说创作系统 — 协同写作工作台 + 多模型智能引擎 + 数据安全架构。',
            attr: { style: 'margin:0 0 12px 0;' }
        });

        aboutCard.createEl('div', { text: '作者：南柯一梦', attr: { style: 'margin-bottom:4px;' } });
        aboutCard.createEl('div', { text: '许可证：MIT', attr: { style: 'margin-bottom:4px;' } });
    }

    private renderRecognitionSection(): void {
        const section = this.tabContent.createEl('section');

        section.createEl('h3', { text: '🎭 角色识别设置' });
        section.createEl('p', {
            text: '配置角色识别三层流水线的各层参数。',
            cls: 'setting-item-description'
        });

        section.createEl('h4', { text: '启用的识别层', attr: { style: 'margin-top:20px;margin-bottom:8px;' } });

        const layers = this.plugin.settings.characterRecognitionLayers || ['rule', 'vector'];

        new Setting(section)
            .setName('规则层')
            .setDesc('基于统计规则的角色提取（提及次数、频率过滤等）')
            .addToggle(toggle => toggle
                .setValue(layers.includes('rule'))
                .onChange(async (value) => {
                    const current = [...(this.plugin.settings.characterRecognitionLayers || [])];
                    if (value && !current.includes('rule')) {
                        current.push('rule');
                    } else if (!value) {
                        const idx = current.indexOf('rule');
                        if (idx > -1) current.splice(idx, 1);
                    }
                    this.plugin.settings.characterRecognitionLayers = current;
                    await this.plugin.saveSettings();
                }));

        new Setting(section)
            .setName('向量层')
            .setDesc('基于语义向量的角色过滤与同指消解')
            .addToggle(toggle => toggle
                .setValue(layers.includes('vector'))
                .onChange(async (value) => {
                    const current = [...(this.plugin.settings.characterRecognitionLayers || [])];
                    if (value && !current.includes('vector')) {
                        current.push('vector');
                    } else if (!value) {
                        const idx = current.indexOf('vector');
                        if (idx > -1) current.splice(idx, 1);
                    }
                    this.plugin.settings.characterRecognitionLayers = current;
                    await this.plugin.saveSettings();
                }));

        new Setting(section)
            .setName('LLM 层')
            .setDesc('⚠️ 启用后会消耗额外的 token，用于角色校验和称号抽取')
            .addToggle(toggle => toggle
                .setValue(layers.includes('llm'))
                .onChange(async (value) => {
                    const current = [...(this.plugin.settings.characterRecognitionLayers || [])];
                    if (value && !current.includes('llm')) {
                        const confirmed = await OperationConfirmModal.confirm(this.app, {
                            title: '启用 LLM 层',
                            description: '启用 LLM 层会显著增加 token 消耗，确定要开启吗？',
                            confirmText: '确认开启',
                            cancelText: '取消',
                        });
                        if (!confirmed) {
                            return;
                        }
                        current.push('llm');
                    } else if (!value) {
                        const idx = current.indexOf('llm');
                        if (idx > -1) current.splice(idx, 1);
                    }
                    this.plugin.settings.characterRecognitionLayers = current;
                    await this.plugin.saveSettings();
                    this.renderActiveTab();
                }));

        const ruleLayer = this.plugin.settings.ruleLayer || {
            minMentionCount: 5,
            enableFreqFilter: true,
            enableContextCheck: true,
            enableVerbFilter: true,
        };

        section.createEl('h4', { text: '📋 规则层配置', attr: { style: 'margin-top:24px;margin-bottom:8px;' } });

        new Setting(section)
            .setName('最小提及次数')
            .setDesc('角色名在文本中出现的最少次数才会被识别为角色候选')
            .addText(text => text
                .setPlaceholder('5')
                .setValue(String(ruleLayer.minMentionCount))
                .onChange(async (value) => {
                    const num = parseInt(value, 10);
                    if (!isNaN(num) && num > 0) {
                        this.plugin.settings.ruleLayer = {
                            ...this.plugin.settings.ruleLayer!,
                            minMentionCount: num,
                        };
                        await this.plugin.saveSettings();
                    }
                }));

        new Setting(section)
            .setName('启用频率过滤')
            .setDesc('过滤掉出现频率异常高或异常低的候选词')
            .addToggle(toggle => toggle
                .setValue(ruleLayer.enableFreqFilter)
                .onChange(async (value) => {
                    this.plugin.settings.ruleLayer = {
                        ...this.plugin.settings.ruleLayer!,
                        enableFreqFilter: value,
                    };
                    await this.plugin.saveSettings();
                }));

        new Setting(section)
            .setName('启用上下文虚词检查')
            .setDesc('检查候选词前后是否为虚词，排除非人名用法')
            .addToggle(toggle => toggle
                .setValue(ruleLayer.enableContextCheck)
                .onChange(async (value) => {
                    this.plugin.settings.ruleLayer = {
                        ...this.plugin.settings.ruleLayer!,
                        enableContextCheck: value,
                    };
                    await this.plugin.saveSettings();
                }));

        new Setting(section)
            .setName('启用动词前后缀过滤')
            .setDesc('过滤掉前后紧跟动词的候选词（通常不是人名）')
            .addToggle(toggle => toggle
                .setValue(ruleLayer.enableVerbFilter)
                .onChange(async (value) => {
                    this.plugin.settings.ruleLayer = {
                        ...this.plugin.settings.ruleLayer!,
                        enableVerbFilter: value,
                    };
                    await this.plugin.saveSettings();
                }));

        const vectorLayer = this.plugin.settings.vectorLayer || {
            enabled: true,
            semanticFilterThreshold: 0.5,
            mergeSimilarityThreshold: 0.85,
        };

        section.createEl('h4', { text: '🔗 向量层配置', attr: { style: 'margin-top:24px;margin-bottom:8px;' } });

        new Setting(section)
            .setName('启用向量层')
            .setDesc('启用语义向量过滤和同指消解功能')
            .addToggle(toggle => toggle
                .setValue(vectorLayer.enabled)
                .onChange(async (value) => {
                    this.plugin.settings.vectorLayer = {
                        ...this.plugin.settings.vectorLayer!,
                        enabled: value,
                    };
                    await this.plugin.saveSettings();
                    this.renderActiveTab();
                }));

        if (vectorLayer.enabled) {
            new Setting(section)
                .setName('语义过滤阈值')
                .setDesc(`候选词与"角色"语义的相似度阈值，低于此值将被过滤。当前: ${vectorLayer.semanticFilterThreshold.toFixed(2)}`)
                .addSlider(slider => {
                    slider.setLimits(0, 1, 0.01);
                    slider.setValue(vectorLayer.semanticFilterThreshold);
                    slider.setDynamicTooltip();
                    slider.onChange(async (value) => {
                        this.plugin.settings.vectorLayer = {
                            ...this.plugin.settings.vectorLayer!,
                            semanticFilterThreshold: value,
                        };
                        await this.plugin.saveSettings();
                    });
                });

            new Setting(section)
                .setName('合并相似度阈值')
                .setDesc(`两个角色候选的语义相似度高于此值时将被合并。当前: ${vectorLayer.mergeSimilarityThreshold.toFixed(2)}`)
                .addSlider(slider => {
                    slider.setLimits(0, 1, 0.01);
                    slider.setValue(vectorLayer.mergeSimilarityThreshold);
                    slider.setDynamicTooltip();
                    slider.onChange(async (value) => {
                        this.plugin.settings.vectorLayer = {
                            ...this.plugin.settings.vectorLayer!,
                            mergeSimilarityThreshold: value,
                        };
                        await this.plugin.saveSettings();
                    });
                });
        }

        const llmLayer = this.plugin.settings.llmLayer || {
            enabled: false,
            verifyBatchSize: 20,
            titleBatchSize: 8,
            minConfidence: 0.3,
        };

        section.createEl('h4', { text: '🤖 LLM 层配置', attr: { style: 'margin-top:24px;margin-bottom:8px;' } });

        new Setting(section)
            .setName('启用 LLM 层')
            .setDesc('⚠️ 启用后会消耗额外 token，用于角色校验和称号抽取')
            .addToggle(toggle => toggle
                .setValue(llmLayer.enabled)
                .onChange(async (value) => {
                    if (value) {
                        const confirmed = await OperationConfirmModal.confirm(this.app, {
                            title: '启用 LLM 层',
                            description: '启用 LLM 层会显著增加 token 消耗，确定要开启吗？',
                            confirmText: '确认开启',
                            cancelText: '取消',
                        });
                        if (!confirmed) return;
                    }
                    this.plugin.settings.llmLayer = {
                        ...this.plugin.settings.llmLayer!,
                        enabled: value,
                    };
                    await this.plugin.saveSettings();
                    this.renderActiveTab();
                }));

        if (llmLayer.enabled) {
            new Setting(section)
                .setName('校验批处理大小')
                .setDesc('每批发送给 LLM 进行角色校验的候选数量')
                .addText(text => text
                    .setPlaceholder('20')
                    .setValue(String(llmLayer.verifyBatchSize))
                    .onChange(async (value) => {
                        const num = parseInt(value, 10);
                        if (!isNaN(num) && num > 0) {
                            this.plugin.settings.llmLayer = {
                                ...this.plugin.settings.llmLayer!,
                                verifyBatchSize: num,
                            };
                            await this.plugin.saveSettings();
                        }
                    }));

            new Setting(section)
                .setName('称号抽取批处理大小')
                .setDesc('每批发送给 LLM 进行称号抽取的角色数量')
                .addText(text => text
                    .setPlaceholder('8')
                    .setValue(String(llmLayer.titleBatchSize))
                    .onChange(async (value) => {
                        const num = parseInt(value, 10);
                        if (!isNaN(num) && num > 0) {
                            this.plugin.settings.llmLayer = {
                                ...this.plugin.settings.llmLayer!,
                                titleBatchSize: num,
                            };
                            await this.plugin.saveSettings();
                        }
                    }));

            new Setting(section)
                .setName('最小置信度')
                .setDesc(`LLM 确认角色身份的最低置信度阈值。当前: ${llmLayer.minConfidence.toFixed(2)}`)
                .addSlider(slider => {
                    slider.setLimits(0, 1, 0.01);
                    slider.setValue(llmLayer.minConfidence);
                    slider.setDynamicTooltip();
                    slider.onChange(async (value) => {
                        this.plugin.settings.llmLayer = {
                            ...this.plugin.settings.llmLayer!,
                            minConfidence: value,
                        };
                        await this.plugin.saveSettings();
                    });
                });
        }
    }

    private renderSuggestionsSection(): void {
        const section = this.tabContent.createEl('section');

        section.createEl('h3', { text: '💡 建议采纳设置' });
        section.createEl('p', {
            text: '配置分析建议的自动采纳和显示方式。',
            cls: 'setting-item-description'
        });

        const suggestions = this.plugin.settings.suggestions || {
            autoAdoptHighConfidence: false,
            autoAdoptThreshold: 0.9,
            showEvidenceByDefault: false,
            batchAdoptThreshold: 0.7,
        };

        new Setting(section)
            .setName('自动采纳高置信度建议')
            .setDesc('自动采纳置信度高于阈值的建议，无需手动确认')
            .addToggle(toggle => toggle
                .setValue(suggestions.autoAdoptHighConfidence)
                .onChange(async (value) => {
                    this.plugin.settings.suggestions = {
                        ...this.plugin.settings.suggestions!,
                        autoAdoptHighConfidence: value,
                    };
                    await this.plugin.saveSettings();
                    this.renderActiveTab();
                }));

        if (suggestions.autoAdoptHighConfidence) {
            new Setting(section)
                .setName('自动采纳阈值')
                .setDesc(`置信度高于此值的建议将被自动采纳。当前: ${suggestions.autoAdoptThreshold.toFixed(2)}`)
                .addSlider(slider => {
                    slider.setLimits(0.5, 1, 0.01);
                    slider.setValue(suggestions.autoAdoptThreshold);
                    slider.setDynamicTooltip();
                    slider.onChange(async (value) => {
                        this.plugin.settings.suggestions = {
                            ...this.plugin.settings.suggestions!,
                            autoAdoptThreshold: value,
                        };
                        await this.plugin.saveSettings();
                    });
                });
        }

        new Setting(section)
            .setName('默认展开证据')
            .setDesc('建议列表中默认展开证据详情（关闭可节省界面空间）')
            .addToggle(toggle => toggle
                .setValue(suggestions.showEvidenceByDefault)
                .onChange(async (value) => {
                    this.plugin.settings.suggestions = {
                        ...this.plugin.settings.suggestions!,
                        showEvidenceByDefault: value,
                    };
                    await this.plugin.saveSettings();
                }));

        new Setting(section)
            .setName('批量采纳默认阈值')
            .setDesc(`批量采纳时的默认置信度阈值。当前: ${suggestions.batchAdoptThreshold.toFixed(2)}`)
            .addSlider(slider => {
                slider.setLimits(0.5, 1, 0.01);
                slider.setValue(suggestions.batchAdoptThreshold);
                slider.setDynamicTooltip();
                slider.onChange(async (value) => {
                    this.plugin.settings.suggestions = {
                        ...this.plugin.settings.suggestions!,
                        batchAdoptThreshold: value,
                    };
                    await this.plugin.saveSettings();
                });
            });
    }

    private renderChartsSection(): void {
        const section = this.tabContent.createEl('section');

        section.createEl('h3', { text: '📊 图表可视化设置' });
        section.createEl('p', {
            text: '配置数据可视化图表的显示方式和交互效果。',
            cls: 'setting-item-description'
        });

        const charts = this.plugin.settings.charts || {
            defaultDensity: 'normal',
            enableAnimations: true,
            defaultChartType: 'scatter',
            labelRotationThreshold: 8,
        };

        new Setting(section)
            .setName('默认密度模式')
            .setDesc('图表元素的疏密程度')
            .addDropdown(dropdown => {
                dropdown.addOption('compact', '紧凑');
                dropdown.addOption('normal', '正常');
                dropdown.addOption('spacious', '宽松');
                dropdown.setValue(charts.defaultDensity);
                dropdown.onChange(async (value) => {
                    this.plugin.settings.charts = {
                        ...this.plugin.settings.charts!,
                        defaultDensity: value as 'compact' | 'normal' | 'spacious',
                    };
                    await this.plugin.saveSettings();
                });
            });

        new Setting(section)
            .setName('启用动画')
            .setDesc('图表加载和交互时显示动画效果（关闭可提升性能）')
            .addToggle(toggle => toggle
                .setValue(charts.enableAnimations)
                .onChange(async (value) => {
                    this.plugin.settings.charts = {
                        ...this.plugin.settings.charts!,
                        enableAnimations: value,
                    };
                    await this.plugin.saveSettings();
                }));

        new Setting(section)
            .setName('默认图表类型')
            .setDesc('散点图等可切换图表的默认显示类型')
            .addDropdown(dropdown => {
                dropdown.addOption('scatter', '散点图');
                dropdown.addOption('bubble', '气泡图');
                dropdown.addOption('heatmap', '热力图');
                dropdown.setValue(charts.defaultChartType);
                dropdown.onChange(async (value) => {
                    this.plugin.settings.charts = {
                        ...this.plugin.settings.charts!,
                        defaultChartType: value,
                    };
                    await this.plugin.saveSettings();
                });
            });

        new Setting(section)
            .setName('标签旋转阈值')
            .setDesc('当数据标签数量超过此值时自动旋转标签以避免重叠')
            .addText(text => text
                .setPlaceholder('8')
                .setValue(String(charts.labelRotationThreshold))
                .onChange(async (value) => {
                    const num = parseInt(value, 10);
                    if (!isNaN(num) && num > 0) {
                        this.plugin.settings.charts = {
                            ...this.plugin.settings.charts!,
                            labelRotationThreshold: num,
                        };
                        await this.plugin.saveSettings();
                    }
                }));
    }

    private renderInfoItem(container: HTMLElement, label: string, value: string): void {
        const item = container.createDiv({
            attr: { style: 'padding:10px 12px;background:var(--background-primary);border-radius:6px;' }
        });
        item.createEl('div', {
            text: label,
            attr: { style: 'font-size:11px;color:var(--text-muted);margin-bottom:2px;' }
        });
        item.createEl('div', {
            text: value,
            attr: { style: 'font-size:14px;font-weight:600;color:var(--text-normal);' }
        });
    }
}
