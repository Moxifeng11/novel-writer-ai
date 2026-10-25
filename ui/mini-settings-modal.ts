import { App, Modal, Setting, DropdownComponent, Notice, TFolder } from 'obsidian';
import NovelWriterPlugin, { CustomProvider, DEFAULT_DECONSTRUCTION_ENGINE_SETTINGS, ALL_BREAKDOWN_DIMENSIONS, DIMENSION_LABELS } from '../main';
import type { DeconstructionEngineSettings } from '../main';
import { renderAppearanceSettings } from './appearance-settings';
import { ManageProvidersModal } from './manage-providers-modal';
import { TemplateManager } from './template-manager';
import { ENGINE_NAMES } from '../engine/engine-registry';
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
import { performanceMonitor } from '../services/performance-monitor';
import { VectorEnhancer } from '../engine/vector-enhancer';
import { UpdateChecker } from '../services/update-checker';
import { ChangelogModal } from './changelog-modal';
import { BUILTIN_CHANGELOG } from '../shared/changelog-data';
import { RulesService } from '../services/rules-service';
import { RefillModal } from './refill-modal';
import { WorldviewCacheService } from '../services/worldview-cache-service';
import { BatchImportModal } from './batch-import-modal';
import { KnowledgeMonitorModal } from './knowledge-monitor-modal';
import { KnowledgeDetailModal } from './knowledge-detail-modal';
import { kbKnowledgeBaseDir } from '../shared/paths';
import { openKnowledgeFolder } from './knowledge-folder-navigation';
import { createLogger } from '../shared/logger';
import { exportTextFile } from '../shared/export-file';
import { OperationConfirmModal } from './components/progress';
import { rebuildKnowledgeIndexWithConfirm } from './knowledge-rebuild-action';
import { rebuildAllVectorsWithConfirm } from './vector-rebuild-action';
import { renderCollapsibleSection } from './settings-utils';


const log = createLogger('MiniSettingsModal');
export class MiniSettingsModal extends Modal {
    private plugin: NovelWriterPlugin;
    private proDropdown: DropdownComponent | null = null;
    private flashDropdown: DropdownComponent | null = null;
    private defaultDropdown: DropdownComponent | null = null;
    private activeTab: string = 'api';
    private tabContent!: HTMLElement;
    private tabBar!: HTMLElement;
    private fingerprintLibrary: StyleFingerprintLibrary | null = null;
    private templateFingerprints: StyleFingerprint[] = [];
    private globalFingerprints: StyleFingerprint[] = [];
    private projectFingerprints: StyleFingerprint[] = [];
    private globalFpEnabledState: Record<string, boolean> = {};
    private fingerprintLoading = false;
    private knowledgeBaseManager: KnowledgeBaseManager | null = null;
    private knowledgeTagManager: KnowledgeTagManager | null = null;
    private deconstructionSchedulerInstance: DeconstructionScheduler | null = null;
    private knowledgeBooks: BookBasicInfo[] = [];
    private knowledgeLoading = false;
    private knowledgeSearchKeyword = '';
    private knowledgeStatusFilter: string = 'all';
    private knowledgeThemeFilter: string = 'all';
    private knowledgeTechniqueFilter: string = 'all';
    private vectorConnectionStatus: 'idle' | 'checking' | 'connected' | 'disconnected' = 'idle';

    constructor(app: App, plugin: NovelWriterPlugin, initialTab?: string) {
        super(app);
        this.plugin = plugin;
        if (initialTab) {
            this.activeTab = initialTab;
        }
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

    async onOpen() {
        this.modalEl.addClass('nw-scope', 'nw-modal-xl');
        this.modalEl.style.setProperty('margin', 'auto', 'important');
        const { contentEl } = this;
        contentEl.style.width = '100%';
        contentEl.style.setProperty('overflow-y', 'auto', 'important');
        contentEl.empty();
        contentEl.addClass('novel-writer-mini-settings');

        contentEl.createEl('h3', { text: '⚙️ 工作台设置', cls: 'nw-u-margintop-0 nw-u-marginbottom-8px-2' });

        this.tabBar = contentEl.createDiv({ cls: 'nw-settings-tabbar' });
        const tabs = [
            { id: 'api', label: '🔌 API 配置' },
            { id: 'cowrite', label: '🖥 协同写作' },
            { id: 'writing', label: '✍️ 写作配置' },
            { id: 'template', label: '📋 模板管理' },
            { id: 'fingerprint', label: '🔍 写作指纹库' },
            { id: 'knowledge', label: '📚 写作知识库' },
            { id: 'deconstruction', label: '🧬 拆解引擎' },
            { id: 'foreshadow', label: '🔮 伏笔管理' },
            { id: 'rules', label: '📜 规则版本' },
            { id: 'appearance', label: '🎨 外观设置' },
            { id: 'layout', label: '🧩 工作台布局' },
            { id: 'performance', label: '📊 性能监控' },
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

        this.tabContent = contentEl.createDiv({ cls: 'nw-settings-tab-content' });
        this.renderActiveTab();

        const btnRow = contentEl.createDiv({ cls: 'nw-settings-btn-row' });
        const saveBtn = btnRow.createEl('button', {
            cls: 'nw-settings-primary-btn',
            text: '💾 保存设置',
            attr: { type: 'button' }
        });
        saveBtn.addEventListener('click', async () => {
            await this.saveAllSettings();
            new Notice('✅ 设置已保存');
            this.close();
        });

        const closeBtn = btnRow.createEl('button', {
            cls: 'nw-settings-secondary-btn',
            text: '取消',
            attr: { type: 'button' }
        });
        closeBtn.addEventListener('click', () => this.close());

        const reloadBtn = contentEl.createEl('button', {
            cls: 'nw-settings-danger-btn',
            text: '🔄 热重载插件',
            attr: { type: 'button' }
        });
        reloadBtn.addEventListener('click', async () => {
            this.plugin.saveSettings();
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

    onClose() {
        this.contentEl.empty();
    }

    private renderActiveTab() {
        this.tabContent.empty();
        this.tabBar.querySelectorAll('.nw-settings-tab').forEach(el => {
            el.toggleClass('active', el.getAttribute('data-tab-id') === this.activeTab);
        });
        switch (this.activeTab) {
            case 'api': this.renderApiTab(); break;
            case 'cowrite': this.renderCoWriteTab(); break;
            case 'writing': this.renderWritingTab(); break;
            case 'fingerprint': this.renderFingerprintTab(); break;
            case 'knowledge': void this.renderKnowledgeTab(); break;
            case 'deconstruction': this.renderDeconstructionTab(); break;
            case 'foreshadow': this.renderForeshadowTab(); break;
            case 'template': this.renderTemplateTab(); break;
            case 'appearance': this.renderAppearanceTab(); break;
            case 'layout': this.renderLayoutTab(); break;
            case 'rules': void this.renderRulesTab(); break;
            case 'performance': this.renderPerformanceTab(); break;
            case 'about': this.renderAboutTab(); break;
        }
    }

    private renderApiTab() {
        const section = this.tabContent.createDiv();
        const currentProviderId = this.plugin.getCurrentProviderId();
        const customProviders = this.plugin.settings.customProviders || [];
        const currentProvider = customProviders.find(c => c.id === currentProviderId);
        const isPreset = currentProvider ? !!currentProvider.isDefault : false;
        const isCustom = !isPreset;
        const isLegacyCustom = isCustom && !currentProvider;

        const updateModelDropdown = (dd: DropdownComponent, selectedModel: string) => {
            const selectEl = dd.selectEl;
            selectEl.empty();
            const models = this.getCurrentProviderModels();
            models.forEach(model => {
                const opt = selectEl.createEl('option', { text: model });
                if (model === selectedModel) opt.selected = true;
            });
        };

        new Setting(section)
            .setName('API 提供商')
            .setDesc('选择 AI API 提供商，或管理全部提供商')
            .addDropdown(dropdown => {
                const allProviders = this.plugin.getAllProviders();
                const currentId = this.plugin.getCurrentProviderId();
                allProviders.sort((a, b) => {
                    if (a.id === currentId) return -1;
                    if (b.id === currentId) return 1;
                    if (a.isPreset && !b.isPreset) return -1;
                    if (!a.isPreset && b.isPreset) return 1;
                    return a.name.localeCompare(b.name);
                });
                allProviders.forEach(p => {
                    const sourceIcon = p.sourceType === 'local' ? '💻' : '☁️';
                    const label = `${sourceIcon} ${p.name}`;
                    dropdown.addOption(p.id, label);
                });
                dropdown.addOption('__manage__', '⚙️ 管理全部提供商...');
                dropdown.setValue(currentProviderId || '__manage__');
                dropdown.onChange((value) => {
                    if (value === '__manage__') {
                        dropdown.setValue(currentProviderId || '__manage__');
                        this.showManageProvidersModal();
                        return;
                    }
                    const all = this.plugin.getAllProviders();
                    const match = all.find(p => p.id === value);
                    if (match && this.plugin.switchProviderByEndpoint(match.endpoint)) {
                        this.plugin.updateStatusBarText();
                        this.onOpen();
                    }
                });
            });

        const manageRow = section.createDiv({ cls: 'nw-u-d-flex-2 nw-u-jc-flex-end-2 nw-u-margintop-4px-2 nw-u-marginbottom-8px-2' });
        const manageBtn = manageRow.createEl('button', {
            cls: 'nw-settings-section-btn',
            text: '🔧 管理全部提供商',
            attr: { type: 'button', title: '添加/编辑/删除/恢复 API 提供商' }
        });
        manageBtn.addEventListener('click', () => this.showManageProvidersModal());

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

        const providerLabel = isCustom
            ? (this.plugin.settings.customProviderName || '自定义')
            : (currentProvider ? currentProvider.name : (currentProviderId || 'API'));
        new Setting(section)
            .setName(`${providerLabel} 密钥`)
            .setDesc(isCustom ? '自定义提供商的 API 密钥' : `仅用于 ${providerLabel}`)
            .addText(text => {
                text.inputEl.type = 'password';
                text.setPlaceholder('请输入 API 密钥')
                    .setValue(this.plugin.settings.apiKey);
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

        const modelsContainer = section.createDiv({ cls: 'nw-settings-models-container' });
        const modelsHeader = modelsContainer.createDiv({ cls: 'nw-settings-models-header' });
        modelsHeader.createEl('span', { text: '🤖 可用模型' });

        const addModelBtn = modelsHeader.createEl('button', {
            cls: 'nw-settings-models-add-btn',
            text: '＋ 添加',
            attr: { type: 'button' }
        });

        const modelListEl = modelsContainer.createDiv({ cls: 'nw-settings-models-list' });

        const inputRow = modelsContainer.createDiv({ cls: 'nw-settings-models-input-row' });
        const modelInput = inputRow.createEl('input', {
            type: 'text',
            cls: 'nw-settings-models-input',
            attr: { placeholder: '输入新模型名称（如 gpt-4o），按 Enter 或点击 ✓' }
        });
        const confirmBtn = inputRow.createEl('button', {
            cls: 'nw-settings-models-confirm-btn',
            text: '✓ 确认',
            attr: { type: 'button' }
        });

        const renderModelChips = () => {
            modelListEl.empty();
            const models = this.getCurrentProviderModels();
            models.forEach((model, idx) => {
                const chip = modelListEl.createDiv({ cls: 'nw-settings-model-chip' });
                chip.createSpan({ text: model });
                const delBtn = chip.createEl('button', { text: '✕', attr: { type: 'button', title: '删除此模型' } });
                delBtn.addEventListener('click', async () => {
                    const currProviderId = this.plugin.getCurrentProviderId();
                    const customProvs = this.plugin.settings.customProviders || [];
                    const currentModels = this.getCurrentProviderModels();
                    currentModels.splice(idx, 1);
                    if (currentModels.length === 0) {
                        currentModels.push('default-model');
                    }
                    if (currProviderId && customProvs.find(c => c.id === currProviderId)) {
                        const cp = customProvs.find(c => c.id === currProviderId)!;
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
                    renderModelChips();
                    if (this.defaultDropdown) updateModelDropdown(this.defaultDropdown, this.plugin.settings.defaultModel);
                    if (this.proDropdown) updateModelDropdown(this.proDropdown, this.plugin.settings.proModel);
                    if (this.flashDropdown) updateModelDropdown(this.flashDropdown, this.plugin.settings.flashModel);
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
            const customProvs = this.plugin.settings.customProviders || [];
            if (currProviderId && customProvs.find(c => c.id === currProviderId)) {
                const cp = customProvs.find(c => c.id === currProviderId)!;
                cp.models = [...currentModels];
            }
            this.plugin.settings.availableModels = [...currentModels];
            await this.plugin.saveSettings();
            modelInput.value = '';
            new Notice(`✅ 已添加模型：${modelName}`);
            renderModelChips();
            if (this.defaultDropdown) updateModelDropdown(this.defaultDropdown, this.plugin.settings.defaultModel);
            if (this.proDropdown) updateModelDropdown(this.proDropdown, this.plugin.settings.proModel);
            if (this.flashDropdown) updateModelDropdown(this.flashDropdown, this.plugin.settings.flashModel);
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
            .setDesc('写作时默认使用的模型（可在写作中随时切换）')
            .addDropdown(dropdown => {
                this.defaultDropdown = dropdown;
                const models = this.getCurrentProviderModels();
                models.forEach(model => {
                    dropdown.addOption(model, model);
                });
                dropdown.setValue(this.plugin.settings.defaultModel);
                dropdown.onChange(value => {
                    this.plugin.settings.defaultModel = value;
                });
            });

        new Setting(section)
            .setName('Pro 模型（正文/角色/实体）')
            .setDesc('正文创作、角色生成、势力/地点/物品设定任务使用')
            .addDropdown(dropdown => {
                this.proDropdown = dropdown;
                const models = this.getCurrentProviderModels();
                models.forEach(model => {
                    dropdown.addOption(model, model);
                });
                dropdown.setValue(this.plugin.settings.proModel);
                dropdown.onChange(value => {
                    this.plugin.settings.proModel = value;
                    this.plugin.updateModelLimitsFromModel(value);
                });
            });

        new Setting(section)
            .setName('Flash 模型（大纲/分析/规划）')
            .setDesc('大纲骨架、分析报告、元素提取、规划类任务使用')
            .addDropdown(dropdown => {
                this.flashDropdown = dropdown;
                const models = this.getCurrentProviderModels();
                models.forEach(model => {
                    dropdown.addOption(model, model);
                });
                dropdown.setValue(this.plugin.settings.flashModel);
                dropdown.onChange(value => {
                    this.plugin.settings.flashModel = value;
                    this.plugin.updateModelLimitsFromModel(value);
                });
            });

        const currentModel = this.plugin.settings.defaultModel;
        const endpoint = this.plugin.settings.apiEndpoint;
        const override = this.plugin.settings.modelOverrides[endpoint]?.[currentModel];
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
                    outRow.setDesc(`AI 最大输出长度（token）。${currentModel} 默认: ${modelDefaults.maxOutput.toLocaleString()} tokens${parsed !== modelDefaults.maxOutput ? ' · ⚠️ 已设置自定义值' : ''}`);
                }));

        const historyContainer = section.createDiv({ cls: 'nw-u-margintop-12px-2' });
        const historyHeader = historyContainer.createDiv({ cls: 'nw-u-d-flex-2 nw-u-ai-center-2 nw-u-jc-space-between-2 nw-u-marginbottom-4px-2' });
        historyHeader.createEl('span', { text: '📜 渠道-模型配置修改历史', cls: 'nw-u-fwt-600-2 nw-u-fs-12px-2' });

        const showHistoryBtn = historyHeader.createEl('button', {
            text: '查看',
            attr: { type: 'button', style: 'padding:2px 8px;font-size:11px;cursor:pointer;border:1px solid var(--background-modifier-border);border-radius:3px;' }
        });

        const renderHistory = () => {
            const historyEl = historyContainer.querySelector('.history-list');
            if (historyEl) historyEl.remove();
            const list = historyContainer.createDiv({ cls: "history-list nw-u-maxh-200px-2 nw-u-ovy-auto-2 nw-u-fs-11px-2 nw-u-c-text-muted-2 nw-u-p-4px-0-2", attr: {} });
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
    }

    private renderWritingTab() {
        const section = this.tabContent.createDiv();

        new Setting(section)
            .setName('默认字数')
            .setDesc('每章默认字数')
            .addText(text => text
                .setPlaceholder('3000')
                .setValue(String(this.plugin.settings.defaultWordCount))
                .onChange((value) => {
                    this.plugin.settings.defaultWordCount = parseInt(value) || 3000;
                }));

        new Setting(section)
            .setName('最小字数')
            .setDesc('每章最小字数')
            .addText(text => text
                .setPlaceholder('2500')
                .setValue(String(this.plugin.settings.minWordCount))
                .onChange((value) => {
                    this.plugin.settings.minWordCount = parseInt(value) || 2500;
                }));

        new Setting(section)
            .setName('最大字数')
            .setDesc('每章最大字数')
            .addText(text => text
                .setPlaceholder('5000')
                .setValue(String(this.plugin.settings.maxWordCount))
                .onChange((value) => {
                    this.plugin.settings.maxWordCount = parseInt(value) || 5000;
                }));

        new Setting(section)
            .setName('断联自动切换模型')
            .setDesc('API断联/超时/503时，自动尝试同端点下其他可用模型（写作类任务会注入文风接续保护）')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableAutoModelFallback !== false)
                .onChange((value) => {
                    this.plugin.settings.enableAutoModelFallback = value;
                }));

        new Setting(section)
            .setName('上下文范围')
            .setDesc('紧凑模式仅注入本章涉及实体（节省上下文），完整模式遍历全部实体（质量优先）')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.contextScope === 'full')
                .onChange((value) => {
                    this.plugin.settings.contextScope = value ? 'full' : 'compact';
                }));
    }

    private async renderFingerprintTab(): Promise<void> {
        const section = this.tabContent.createDiv();

        section.createEl('p', {
            text: '管理模板、全局和项目级写作指纹库，用于保持风格一致性。',
            cls: 'setting-item-description'
        });

        if (this.fingerprintLoading) {
            section.createDiv({
                cls: 'nw-u-p-40px-2 nw-u-ta-center-2 nw-u-c-text-faint-2 nw-u-fs-13px-2',
                text: '加载中...'
            });
            return;
        }

        const activeProject = this.getActiveProject();
        if (!activeProject) {
            section.createDiv({
                cls: 'nw-u-p-20px-2 nw-u-ta-center-2 nw-u-c-text-muted-2 nw-u-fs-13px-2 nw-u-bg-background-secondary-2 nw-u-brd-6px-2',
                text: '请先打开一个项目，以便管理项目指纹。'
            });
        }

        if (!this.fingerprintLibrary) {
            this.fingerprintLibrary = new StyleFingerprintLibrary(this.app, activeProject || undefined);
            await this.loadFingerprints();
        }

        // 模板指纹库
        const templateGroup = section.createDiv({ cls: 'nw-u-marginbottom-20px-2' });
        const templateHeader = templateGroup.createDiv({ cls: 'nw-u-d-flex-2 nw-u-ai-center-2 nw-u-jc-space-between-2 nw-u-marginbottom-8px-2' });
        templateHeader.createEl('span', { text: '📋 模板指纹库', cls: 'nw-u-fwt-600-2 nw-u-fs-13px-2' });
        templateHeader.createEl('span', { text: `共 ${this.templateFingerprints.length} 个`, cls: 'nw-u-fs-11px-2 nw-u-c-text-muted-2' });

        const addTemplateBtn = templateGroup.createEl('button', {
            text: '➕ 添加模板指纹',
            attr: {
                type: 'button',
                style: 'margin-bottom:8px;padding:6px 14px;cursor:pointer;background:var(--interactive-accent);color:var(--text-on-accent);border:none;border-radius:4px;font-size:12px;'
            }
        });
        addTemplateBtn.addEventListener('click', () => this.showAddFingerprintModal('template'));

        const templateList = templateGroup.createDiv();
        renderFingerprintList(templateList, this.templateFingerprints, {
            showDelete: true,
            onToggle: async (fp) => {
                if (!this.fingerprintLibrary) return;
                fp.enabled = !fp.enabled;
                await this.fingerprintLibrary.updateTemplate(fp);
                await this.loadFingerprints();
                this.renderActiveTab();
            },
            onDetail: (fp) => this.showFingerprintDetail(fp, true),
            onDelete: async (fp) => {
                if (!this.fingerprintLibrary) return;
                const confirmed = await OperationConfirmModal.confirm(this.app, {
                    title: '删除模板指纹',
                    description: `确定要删除模板指纹「${fp.name}」吗？`,
                    warning: '此操作不可恢复',
                    confirmText: '确认删除',
                    cancelText: '取消',
                });
                if (!confirmed) return;
                await this.fingerprintLibrary.deleteTemplate(fp.id);
                await this.loadFingerprints();
                this.renderActiveTab();
                new Notice(`已删除「${fp.name}」`);
            },
        });

        // 全局指纹库
        const globalGroup = section.createDiv({ cls: 'nw-u-marginbottom-20px-2' });
        const globalHeader = globalGroup.createDiv({ cls: 'nw-u-d-flex-2 nw-u-ai-center-2 nw-u-jc-space-between-2 nw-u-marginbottom-8px-2' });
        globalHeader.createEl('span', { text: '🌐 全局指纹库', cls: 'nw-u-fwt-600-2 nw-u-fs-13px-2' });
        globalHeader.createEl('span', { text: `共 ${this.globalFingerprints.length} 个`, cls: 'nw-u-fs-11px-2 nw-u-c-text-muted-2' });

        const addGlobalBtn = globalGroup.createEl('button', {
            text: '➕ 添加全局指纹',
            attr: {
                type: 'button',
                style: 'margin-bottom:8px;padding:6px 14px;cursor:pointer;background:var(--interactive-accent);color:var(--text-on-accent);border:none;border-radius:4px;font-size:12px;'
            }
        });
        addGlobalBtn.addEventListener('click', () => this.showAddFingerprintModal('global'));

        const globalList = globalGroup.createDiv();
        const globalFpWithProjectState = this.globalFingerprints.map(fp => ({
            ...fp,
            enabled: activeProject
                ? this.fingerprintLibrary?.isGlobalEnabledForProject(fp.id, activeProject) ?? fp.enabled
                : fp.enabled,
        }));
        renderFingerprintList(globalList, globalFpWithProjectState, {
            showDelete: true,
            onToggle: async (fp) => {
                if (!this.fingerprintLibrary || !activeProject) return;
                const newEnabled = !this.fingerprintLibrary.isGlobalEnabledForProject(fp.id, activeProject);
                await this.fingerprintLibrary.setGlobalEnabledForProject(fp.id, newEnabled, activeProject);
                this.globalFpEnabledState[fp.id] = newEnabled;
                this.renderActiveTab();
            },
            onDetail: (fp) => this.showFingerprintDetail(fp, true),
            onDelete: async (fp) => {
                if (!this.fingerprintLibrary) return;
                const confirmed = await OperationConfirmModal.confirm(this.app, {
                    title: '删除全局指纹',
                    description: `确定要删除全局指纹「${fp.name}」吗？`,
                    warning: '此操作不可恢复',
                    confirmText: '确认删除',
                    cancelText: '取消',
                });
                if (!confirmed) return;
                await this.fingerprintLibrary.deleteGlobal(fp.id);
                await this.loadFingerprints();
                this.renderActiveTab();
                new Notice(`已删除「${fp.name}」`);
            },
        });

        if (activeProject) {
            const projectGroup = section.createDiv({ cls: 'nw-u-marginbottom-12px-2' });
            const projectHeader = projectGroup.createDiv({ cls: 'nw-u-d-flex-2 nw-u-ai-center-2 nw-u-jc-space-between-2 nw-u-marginbottom-8px-2' });
            projectHeader.createEl('span', { text: '📁 项目指纹库', cls: 'nw-u-fwt-600-2 nw-u-fs-13px-2' });
            const projectHeaderRight = projectHeader.createDiv({ cls: 'nw-u-d-flex-2 nw-u-ai-center-2 nw-u-gap-10px-2' });
            projectHeaderRight.createEl('span', { text: `共 ${this.projectFingerprints.length} 个`, cls: 'nw-u-fs-11px-2 nw-u-c-text-muted-2' });
            const syncBtn = projectHeaderRight.createEl('button', {
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
                    await this.loadFingerprints();
                    this.renderActiveTab();
                    new Notice(`✅ 同步完成：新增 ${result.added.length} 个，更新 ${result.updated.length} 个`);
                } catch (e) {
                    log.warn('[MiniSettings] 同步失败:', e);
                    new Notice('❌ 同步失败，请查看控制台');
                }
            });

            const addBtn = projectGroup.createEl('button', {
                text: '➕ 添加项目指纹',
                attr: {
                    type: 'button',
                    style: 'margin-bottom:8px;padding:6px 14px;cursor:pointer;background:var(--interactive-accent);color:var(--text-on-accent);border:none;border-radius:4px;font-size:12px;'
                }
            });
            addBtn.addEventListener('click', () => this.showAddFingerprintModal('project'));

            const projectList = projectGroup.createDiv();
            renderFingerprintList(projectList, this.projectFingerprints, {
                showDelete: true,
                onToggle: async (fp) => {
                    if (!this.fingerprintLibrary) return;
                    fp.enabled = !fp.enabled;
                    await this.fingerprintLibrary.updateProject(fp);
                    this.renderActiveTab();
                },
                onDetail: (fp) => this.showFingerprintDetail(fp, true),
                onDelete: async (fp) => {
                    if (!this.fingerprintLibrary) return;
                    const confirmed = await OperationConfirmModal.confirm(this.app, {
                        title: '删除项目指纹',
                        description: `确定要删除项目指纹「${fp.name}」吗？`,
                        warning: '此操作不可恢复',
                        confirmText: '确认删除',
                        cancelText: '取消',
                    });
                    if (!confirmed) return;
                    await this.fingerprintLibrary.deleteProject(fp.id);
                    await this.loadFingerprints();
                    this.renderActiveTab();
                    new Notice(`已删除「${fp.name}」`);
                },
            });
        }
    }

    private async loadFingerprints(): Promise<void> {
        if (!this.fingerprintLibrary) return;
        this.fingerprintLoading = true;
        try {
            this.templateFingerprints = await this.fingerprintLibrary.loadTemplate();
            this.globalFingerprints = await this.fingerprintLibrary.loadGlobal();
            this.projectFingerprints = await this.fingerprintLibrary.loadProject();
            const activeProject = this.getActiveProject();
            if (activeProject) {
                this.globalFpEnabledState = await this.fingerprintLibrary.loadGlobalState(activeProject);
            } else {
                this.globalFpEnabledState = {};
            }
        } catch (e) {
            log.warn('[MiniSettings] 加载指纹库失败:', e);
        } finally {
            this.fingerprintLoading = false;
        }
    }

    private showFingerprintDetail(fp: StyleFingerprint, canEdit: boolean): void {
        const activeProject = this.getActiveProject();
        const isGlobal = fp.scope === 'global';
        const isTemplate = fp.scope === 'template';

        const detailFp = isGlobal && activeProject
            ? { ...fp, enabled: this.fingerprintLibrary?.isGlobalEnabledForProject(fp.id, activeProject) ?? fp.enabled }
            : fp;

        new FingerprintDetailModal(this.app, {
            fingerprint: detailFp,
            canEdit,
            // 模板层不参与注入：不提供无效的启用开关（三个入口统一）
            onToggle: isTemplate ? undefined : async (fingerprint) => {
                if (!this.fingerprintLibrary) return;
                if (isGlobal) {
                    if (!activeProject) return;
                    const newEnabled = !this.fingerprintLibrary.isGlobalEnabledForProject(fp.id, activeProject);
                    await this.fingerprintLibrary.setGlobalEnabledForProject(fp.id, newEnabled, activeProject);
                    this.globalFpEnabledState[fp.id] = newEnabled;
                } else {
                    fingerprint.enabled = !fingerprint.enabled;
                    await this.fingerprintLibrary.updateProject(fingerprint);
                }
                await this.loadFingerprints();
                this.renderActiveTab();
            },
            onReextract: isTemplate || isGlobal ? (fingerprint) => {
                if (!this.fingerprintLibrary) return;
                new RefillModal(this.app, {
                    type: 'fingerprint',
                    fingerprint,
                    fingerprintLibrary: this.fingerprintLibrary,
                    aiEngine: this.plugin.aiEngine,
                    embeddingSettings: this.plugin.settings,
                }).open();
            } : undefined,
            onDelete: async (fingerprint) => {
                if (!this.fingerprintLibrary) return;
                if (fingerprint.scope === 'template') {
                    await this.fingerprintLibrary.deleteTemplate(fingerprint.id);
                } else if (fingerprint.scope === 'global') {
                    await this.fingerprintLibrary.deleteGlobal(fingerprint.id);
                } else {
                    await this.fingerprintLibrary.deleteProject(fingerprint.id);
                }
                await this.loadFingerprints();
                this.renderActiveTab();
                new Notice(`已删除「${fingerprint.name}」`);
            },
        }).open();
    }

    private showAddFingerprintModal(scope: 'global' | 'project' | 'template'): void {
        const activeProject = this.getActiveProject();
        if (scope === 'project' && !activeProject) {
            new Notice('请先打开一个项目');
            return;
        }

        const targetScope: 'global' | 'project' = scope === 'template' ? 'global' : scope;
        const { provider, vectorStore } = createFingerprintEmbedding(
            this.app,
            targetScope,
            this.plugin.settings,
            activeProject || undefined,
        );
        const extractor = new FingerprintExtractor(this.plugin.aiEngine, provider, vectorStore);

        new AddFingerprintModal(this.app, {
            scope,
            extractor,
            onCompleted: async (fingerprint) => {
                if (!this.fingerprintLibrary) return;
                if (scope === 'template') {
                    await this.fingerprintLibrary.addTemplate(fingerprint);
                } else if (scope === 'global') {
                    await this.fingerprintLibrary.addGlobal(fingerprint);
                } else {
                    await this.fingerprintLibrary.addProject(fingerprint);
                }
                await this.loadFingerprints();
                this.renderActiveTab();
            }
        }).open();
    }

    private getActiveProject(): string | null {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) return null;
        const project = activeFile.path.split('/')[0];
        if (project === '元文件' || project.startsWith('.')) return null;
        const folder = this.app.vault.getAbstractFileByPath(project);
        return folder instanceof TFolder ? project : null;
    }

    private async renderKnowledgeTab(): Promise<void> {
        const section = this.tabContent.createDiv();

        section.createEl('p', {
            text: '管理你的写作知识库，导入小说进行深度拆解分析，提取写作技巧、结构、人设等宝贵经验。',
            cls: 'setting-item-description'
        });

        this.renderVectorEnhancementSettings(section);

        if (this.knowledgeLoading) {
            section.createDiv({
                cls: 'nw-u-p-40px-2 nw-u-ta-center-2 nw-u-c-text-faint-2 nw-u-fs-13px-2',
                text: '加载中...'
            });
            return;
        }

        if (!this.knowledgeBaseManager && this.plugin.knowledgeBaseManager) {
            this.knowledgeBaseManager = this.plugin.knowledgeBaseManager;
        }
        if (!this.knowledgeTagManager && this.plugin.knowledgeTagManager) {
            this.knowledgeTagManager = this.plugin.knowledgeTagManager;
        }
        if (!this.deconstructionSchedulerInstance && this.plugin.deconstructionScheduler) {
            this.deconstructionSchedulerInstance = this.plugin.deconstructionScheduler;
        }

        if (!this.knowledgeBaseManager || !this.knowledgeTagManager || !this.deconstructionSchedulerInstance) {
            section.createDiv({
                cls: 'nw-u-p-20px-2 nw-u-ta-center-2 nw-u-c-text-muted-2 nw-u-fs-13px-2 nw-u-bg-background-secondary-2 nw-u-brd-6px-2',
                text: '知识库管理器尚未初始化，请等待插件加载完成后再试。'
            });
            return;
        }

        if (this.knowledgeBooks.length === 0 && !this.knowledgeLoading) {
            await this.loadKnowledgeBooks();
        }

        const toolbar = section.createDiv({ cls: 'nw-u-marginbottom-16px-2' });

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

        const actionRow = toolbar.createDiv({ cls: 'nw-u-d-flex-2 nw-u-gap-8px-2 nw-u-margintop-8px-2 nw-u-marginbottom-16px-2' });

        const importBtn = actionRow.createEl('button', {
            text: '📥 批量导入',
            attr: {
                type: 'button',
                style: 'padding:6px 16px;cursor:pointer;background:var(--interactive-accent);color:var(--text-on-accent);border:none;border-radius:4px;font-size:13px;font-weight:500;'
            }
        });
        importBtn.addEventListener('click', () => this.showKnowledgeBatchImport());

        const monitorBtn = actionRow.createEl('button', {
            text: '📊 监控面板',
            attr: {
                type: 'button',
                style: 'padding:6px 16px;cursor:pointer;border:1px solid var(--background-modifier-border);border-radius:4px;font-size:13px;background:var(--background-primary);'
            }
        });
        monitorBtn.addEventListener('click', () => this.showKnowledgeMonitorModal());

        const rebuildBtn = actionRow.createEl('button', {
            text: '🔄 重建索引',
            attr: {
                type: 'button',
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
            cls: 'nw-u-p-12px-2 nw-u-b-1px-solid-background-m-2 nw-u-brd-6px-2 nw-u-marginbottom-16px-2 nw-u-bg-background-secondary-2'
        });

        const searchRow = filterBar.createDiv({ cls: 'nw-u-d-flex-2 nw-u-gap-8px-2 nw-u-marginbottom-10px-2 nw-u-fwr-wrap-2' });

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
            this.renderKnowledgeBooksList();
        });

        const statusSelect = searchRow.createEl('select', {
            cls: 'nw-u-p-6px-10px-2 nw-u-b-1px-solid-background-m-2 nw-u-brd-4px-2 nw-u-fs-13px-2 nw-u-bg-background-primary-2 nw-u-c-text-normal-2'
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
            this.renderKnowledgeBooksList();
        });

        const tagFilterRow = filterBar.createDiv({ cls: 'nw-u-d-flex-2 nw-u-gap-12px-2 nw-u-fwr-wrap-2' });

        const themeFilterDiv = tagFilterRow.createDiv({ cls: 'nw-u-flex-1-2 nw-u-minw-200px-2' });
        themeFilterDiv.createEl('span', { text: '📖 题材：全部', cls: 'nw-u-fs-12px-2 nw-u-c-text-muted-2 nw-u-marginright-8px' });

        const techniqueFilterDiv = tagFilterRow.createDiv({ cls: 'nw-u-flex-1-2 nw-u-minw-200px-2' });
        techniqueFilterDiv.createEl('span', { text: '✍️ 技巧：全部', cls: 'nw-u-fs-12px-2 nw-u-c-text-muted-2 nw-u-marginright-8px' });

        this.renderKnowledgeBooksList(section);
    }

    private renderVectorEnhancementSettings(container: HTMLElement): void {
        const vectorSection = container.createDiv({
            cls: 'nw-u-p-12px-16px-2 nw-u-b-1px-solid-background-m-2 nw-u-brd-6px-2 nw-u-marginbottom-16px-2 nw-u-bg-background-secondary-2'
        });

        vectorSection.createEl('h4', {
            text: '🧠 向量增强设置',
            cls: 'nw-u-m-0-0-12px-0-2 nw-u-fs-14px-2'
        });

        new Setting(vectorSection)
            .setName('向量增强拆解')
            .setDesc('启用后，知识库拆解时使用向量相似度匹配辅助定位相关内容，提升拆解质量')
            .addToggle(toggle => {
                toggle.setValue(this.plugin.settings.vectorEnhancedDeconstruction ?? true);
                toggle.onChange((value) => {
                    this.plugin.settings.vectorEnhancedDeconstruction = value;
                });
            });

        new Setting(vectorSection)
            .setName('置信度阈值')
            .setDesc(`向量匹配的最低置信度，低于此值的结果将被过滤（当前: ${(this.plugin.settings.vectorDeconstructionThreshold ?? 0.3).toFixed(2)}）`)
            .addSlider(slider => {
                slider.setLimits(0.1, 0.9, 0.05);
                slider.setValue(this.plugin.settings.vectorDeconstructionThreshold ?? 0.3);
                slider.setDynamicTooltip();
                slider.onChange((value) => {
                    this.plugin.settings.vectorDeconstructionThreshold = value;
                    const descEl = slider.sliderEl.closest('.setting-item')?.querySelector('.setting-item-description');
                    if (descEl) {
                        descEl.textContent = `向量匹配的最低置信度，低于此值的结果将被过滤（当前: ${value.toFixed(2)}）`;
                    }
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
                dropdown.onChange((value) => {
                    this.plugin.settings.vectorProviderType = value as 'ollama' | 'openai' | 'doubao' | 'qwen';
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
                    text.onChange((value) => {
                        this.plugin.settings.vectorOllamaBaseUrl = value;
                    });
                });

            new Setting(vectorSection)
                .setName('Ollama 模型')
                .setDesc('用于向量嵌入的 Ollama 模型名称')
                .addText(text => {
                    text.setValue(this.plugin.settings.vectorOllamaModel || 'bge-m3');
                    text.setPlaceholder('bge-m3');
                    text.onChange((value) => {
                        this.plugin.settings.vectorOllamaModel = value;
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
                    text.onChange((value) => {
                        this.plugin.settings.vectorOpenaiBaseUrl = value;
                    });
                });

            new Setting(vectorSection)
                .setName('模型名称')
                .setDesc('用于向量嵌入的模型名称')
                .addText(text => {
                    text.setValue(this.plugin.settings.vectorOpenaiModel || 'doubao-embedding-text-240915');
                    text.setPlaceholder('text-embedding-3-small');
                    text.onChange((value) => {
                        this.plugin.settings.vectorOpenaiModel = value;
                    });
                });

            new Setting(vectorSection)
                .setName('API Key')
                .setDesc('OpenAI 兼容 API 的密钥')
                .addText(text => {
                    text.inputEl.type = 'password';
                    text.setValue(this.plugin.settings.vectorOpenaiApiKey || '');
                    text.setPlaceholder('请输入 API Key');
                    text.onChange((value) => {
                        this.plugin.settings.vectorOpenaiApiKey = value;
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
                    text.onChange((value) => {
                        this.plugin.settings.vectorDoubaoBaseUrl = value;
                    });
                });

            new Setting(vectorSection)
                .setName('模型名称')
                .setDesc('用于向量嵌入的豆包模型名称')
                .addText(text => {
                    text.setValue(this.plugin.settings.vectorDoubaoModel || 'doubao-embedding-text-240915');
                    text.setPlaceholder('doubao-embedding-text-240915');
                    text.onChange((value) => {
                        this.plugin.settings.vectorDoubaoModel = value;
                    });
                });

            new Setting(vectorSection)
                .setName('API Key')
                .setDesc('豆包/火山引擎 API 的密钥')
                .addText(text => {
                    text.inputEl.type = 'password';
                    text.setValue(this.plugin.settings.vectorDoubaoApiKey || '');
                    text.setPlaceholder('请输入 API Key');
                    text.onChange((value) => {
                        this.plugin.settings.vectorDoubaoApiKey = value;
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
                    text.onChange((value) => {
                        this.plugin.settings.vectorQwenBaseUrl = value;
                    });
                });

            new Setting(vectorSection)
                .setName('模型名称')
                .setDesc('用于向量嵌入的通义千问模型名称')
                .addText(text => {
                    text.setValue(this.plugin.settings.vectorQwenModel || 'text-embedding-v3');
                    text.setPlaceholder('text-embedding-v3');
                    text.onChange((value) => {
                        this.plugin.settings.vectorQwenModel = value;
                    });
                });

            new Setting(vectorSection)
                .setName('API Key')
                .setDesc('通义千问 API 的密钥')
                .addText(text => {
                    text.inputEl.type = 'password';
                    text.setValue(this.plugin.settings.vectorQwenApiKey || '');
                    text.setPlaceholder('请输入 API Key');
                    text.onChange((value) => {
                        this.plugin.settings.vectorQwenApiKey = value;
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

    private renderKnowledgeBooksList(section?: HTMLElement): void {
        const container = section ?? this.tabContent;
        const existing = container.querySelector('.nw-knowledge-books-section');
        if (existing) existing.remove();

        const wrap = container.createDiv({ cls: 'nw-knowledge-books-section' });
        const filteredBooks = this.filterKnowledgeBooks();

        if (filteredBooks.length === 0) {
            const emptyState = wrap.createDiv({
                cls: 'nw-u-p-40px-16px nw-u-ta-center-2 nw-u-b-1px-dashed-background- nw-u-brd-8px-2 nw-u-bg-background-secondary-2'
            });
            emptyState.createEl('div', {
                text: '📚',
                cls: 'nw-u-fs-40px nw-u-marginbottom-12px-2 nw-u-op-0-5'
            });
            emptyState.createEl('div', {
                text: this.knowledgeBooks.length === 0
                    ? '知识库暂无书籍，点击上方「批量导入」开始添加'
                    : '没有符合筛选条件的书籍',
                cls: 'nw-u-fs-13px-2 nw-u-c-text-muted-2 nw-u-marginbottom-8px-2'
            });
            if (this.knowledgeBooks.length === 0) {
                const emptyImportBtn = emptyState.createEl('button', {
                    text: '📥 批量导入书籍',
                    attr: {
                        type: 'button',
                        style: 'padding:6px 16px;cursor:pointer;background:var(--interactive-accent);color:var(--text-on-accent);border:none;border-radius:4px;font-size:12px;margin-top:8px;'
                    }
                });
                emptyImportBtn.addEventListener('click', () => this.showKnowledgeBatchImport());
            }
            return;
        }

        const countRow = wrap.createDiv({
            cls: 'nw-u-d-flex-2 nw-u-jc-space-between-2 nw-u-ai-center-2 nw-u-marginbottom-8px-2'
        });
        countRow.createEl('span', {
            text: `共 ${filteredBooks.length} 本书籍`,
            cls: 'nw-u-fs-12px-2 nw-u-c-text-muted-2'
        });

        const gridContainer = wrap.createDiv({
            cls: 'nw-u-d-grid-2 nw-u-gtc-repeat-auto-fill-minma-6 nw-u-gap-10px-2 nw-u-maxh-420px nw-u-ovy-auto-2 nw-u-p-4px'
        });

        filteredBooks.forEach(book => {
            this.renderKnowledgeBookCard(gridContainer, book);
        });
    }

    private renderKnowledgeBookCard(container: HTMLElement, book: BookBasicInfo): void {
        const card = container.createDiv({
            cls: 'nw-u-p-12px-2 nw-u-b-1px-solid-background-m-2 nw-u-brd-8px-2 nw-u-bg-background-primary-2 nw-u-cur-pointer-2 nw-u-transition-all-0-2s-ease nw-u-pos-relative nw-u-ov-hidden-2'
        });

        card.addEventListener('mouseenter', () => {
            card.style.borderColor = 'var(--interactive-accent)';
            card.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
        });
        card.addEventListener('mouseleave', () => {
            card.style.borderColor = 'var(--background-modifier-border)';
            card.style.boxShadow = 'none';
        });

        card.addEventListener('click', () => this.openKnowledgeBookDetail(book.id));

        const titleRow = card.createDiv({ cls: 'nw-u-marginbottom-6px-2 nw-u-paddingright-8px' });
        titleRow.createEl('div', {
            text: book.name,
            cls: 'nw-u-fs-14px-2 nw-u-fwt-600-2 nw-u-c-text-normal-2 nw-u-lh-1-4-2'
        });

        if (book.author) {
            titleRow.createEl('div', {
                text: book.author,
                cls: 'nw-u-fs-11px-2 nw-u-c-text-muted-2 nw-u-margintop-2px-2'
            });
        }

        const statusBadge = this.getKbStatusBadge(book.breakdownStatus);
        card.appendChild(statusBadge);

        const allTags = [...book.themeTags, ...book.techniqueTags, ...book.customTags];
        if (allTags.length > 0) {
            const tagRow = card.createDiv({
                cls: 'nw-u-d-flex-2 nw-u-gap-4px-2 nw-u-fwr-wrap-2 nw-u-m-8px-0'
            });
            const displayTags = allTags.slice(0, 3);
            displayTags.forEach(tag => {
                tagRow.createEl('span', {
                    text: tag,
                    cls: 'nw-u-p-2px-8px-2 nw-u-bg-background-secondary-2 nw-u-brd-10px-2 nw-u-fs-10px-2 nw-u-c-text-muted-2'
                });
            });
            if (allTags.length > 3) {
                tagRow.createEl('span', {
                    text: `+${allTags.length - 3}`,
                    cls: 'nw-u-p-2px-8px-2 nw-u-bg-background-secondary-2 nw-u-brd-10px-2 nw-u-fs-10px-2 nw-u-c-text-faint-2'
                });
            }
        }

        const metaRow = card.createDiv({
            cls: 'nw-u-d-flex-2 nw-u-gap-10px-2 nw-u-fs-10px-2 nw-u-c-text-faint-2 nw-u-paddingtop-6px nw-u-bt-1px-solid-background-m-2'
        });

        if (book.wordCount) {
            metaRow.createEl('span', { text: `📝 ${this.formatKbWordCount(book.wordCount)}` });
        }

        const dateStr = new Date(book.updatedAt).toLocaleDateString('zh-CN');
        metaRow.createEl('span', { text: `🕐 ${dateStr}` });
    }

    private getKbStatusBadge(status: string): HTMLElement {
        const statusMap: Record<string, { label: string; color: string; bg: string }> = {
            pending: { label: '待拆解', color: 'var(--text-muted)', bg: 'var(--background-secondary)' },
            processing: { label: '拆解中', color: 'var(--text-accent)', bg: 'rgba(var(--interactive-accent-rgb), 0.1)' },
            completed: { label: '已完成', color: 'var(--text-success)', bg: 'rgba(var(--background-modifier-success-rgb), 0.1)' },
            failed: { label: '失败', color: 'var(--text-error)', bg: 'rgba(var(--background-modifier-error-rgb), 0.1)' },
        };

        const info = statusMap[status] || statusMap.pending;
        const badge = createDiv({
            attr: {
                style: `display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:500;color:${info.color};background:${info.bg};margin-top:6px;`
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
            log.warn('[MiniSettings] 加载知识库失败:', e);
        } finally {
            this.knowledgeLoading = false;
        }
    }

    private openKnowledgeBookDetail(bookId: string): void {
        if (!this.knowledgeBaseManager) {
            new Notice('知识库未初始化');
            return;
        }
        new KnowledgeDetailModal(this.app, bookId, this.knowledgeBaseManager).open();
    }

    private showKnowledgeBatchImport(): void {
        if (!this.knowledgeBaseManager || !this.knowledgeTagManager || !this.deconstructionSchedulerInstance) {
            new Notice('知识库未初始化');
            return;
        }
        new BatchImportModal(this.app, {
            knowledgeBaseManager: this.knowledgeBaseManager,
            deconstructionScheduler: this.deconstructionSchedulerInstance,
            tagManager: this.knowledgeTagManager,
            engineRegistry: this.plugin.engineRegistry,
            onComplete: async () => {
                await this.loadKnowledgeBooks();
                this.renderActiveTab();
            },
            onViewDetail: (bookId, bookName) => {
                const book = this.knowledgeBooks?.find(b => b.id === bookId || b.name === bookName);
                if (book) {
                    new KnowledgeDetailModal(this.app, book.id, this.knowledgeBaseManager!).open();
                }
            }
        }).open();
    }

    private showKnowledgeMonitorModal(): void {
        if (!this.deconstructionSchedulerInstance || !this.knowledgeBaseManager) {
            new Notice('知识库未初始化');
            return;
        }
        new KnowledgeMonitorModal(this.app, this.deconstructionSchedulerInstance, this.knowledgeBaseManager).open();
    }

    private renderCoWriteTab() {
        const section = this.tabContent.createDiv();

        section.createEl('p', {
            text: '配置协同写作使用的模型。可在本地 Ollama 和云端 API 之间自由切换。',
            cls: 'setting-item-description'
        });

        let localModelDropdown: DropdownComponent | null = null;
        let cloudProviderDropdown: DropdownComponent | null = null;
        let cloudModelDropdown: DropdownComponent | null = null;
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
                dropdown.onChange((value) => {
                    this.plugin.settings.coWriteModelMode = value as 'local' | 'cloud';
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
                dropdown.onChange((value) => {
                    this.plugin.settings.coWriteModel = value;
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
                    if (p.sourceType !== 'local') {
                        dropdown.addOption(p.id, p.name);
                    }
                }
                dropdown.setValue(this.plugin.settings.coWriteCloudProvider || '');
                dropdown.onChange((value) => {
                    this.plugin.settings.coWriteCloudProvider = value;
                    refreshCloudModelDropdown();
                });
            });

        cloudModelSetting = new Setting(section)
            .setName('云端模型')
            .setDesc('选择协同写作使用的云端模型（留空则使用默认模型）')
            .addDropdown(dropdown => {
                cloudModelDropdown = dropdown;
                refreshCloudModelDropdown();
                dropdown.onChange((value) => {
                    this.plugin.settings.coWriteCloudModel = value;
                });
            });

        new Setting(section)
            .setName('Temperature')
            .setDesc('模型的创造性参数（0-2，默认 0.7）')
            .addSlider(slider => {
                slider.setLimits(0, 2, 0.05);
                slider.setValue(this.plugin.settings.coWriteTemperature ?? 0.7);
                slider.setDynamicTooltip();
                slider.onChange((value) => {
                    this.plugin.settings.coWriteTemperature = value;
                });
            });

        new Setting(section)
            .setName('最大输出 Token')
            .setDesc('单次生成的最大 token 数（默认 600）')
            .addText(text => {
                text.setValue(String(this.plugin.settings.coWriteMaxTokens ?? 600));
                text.onChange((value) => {
                    const num = parseInt(value, 10);
                    if (!isNaN(num) && num > 0) {
                        this.plugin.settings.coWriteMaxTokens = num;
                    }
                });
            });

        new Setting(section)
            .setName('自动剧情评估')
            .setDesc('输入时自动刷新剧情完成度评估')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoPlotEvaluation ?? true)
                .onChange(value => {
                    this.plugin.settings.autoPlotEvaluation = value;
                }));

        new Setting(section)
            .setName('自动联想（幽灵建议）')
            .setDesc('输入停顿后自动生成后续联想（每 4 秒最多一次）；关闭可节省 AI 调用')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoGhostAssociation ?? true)
                .onChange(value => {
                    this.plugin.settings.autoGhostAssociation = value;
                }));

        updateVisibility();
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

    private renderDeconstructionTab() {
        const section = this.tabContent.createDiv();
        section.createEl('h3', { text: '🧬 拆解引擎' });
        section.createEl('p', {
            text: '配置小说拆解引擎行为。点击底部「保存设置」后生效。',
            cls: 'setting-item-description'
        });

        const cfg = this.getDeconstructionEngineSettings();

        const qualityCard = section.createDiv({
            cls: 'nw-u-p-12px-16px-2 nw-u-b-1px-solid-background-m-2 nw-u-brd-6px-2 nw-u-marginbottom-16px-2 nw-u-bg-background-secondary-2'
        });
        qualityCard.createEl('h4', { text: '🎯 增强级别', cls: 'nw-u-m-0-0-12px-0-2 nw-u-fs-14px-2' });

        new Setting(qualityCard)
            .setName('默认质量级别')
            .setDesc('快速=仅基础分析；标准=完整维度；深度=含向量+LLM 增强')
            .addDropdown(dropdown => {
                dropdown.addOption('fast', '⚡ 快速');
                dropdown.addOption('standard', '✅ 标准');
                dropdown.addOption('deep', '🔬 深度');
                dropdown.setValue(cfg.defaultQualityLevel);
                dropdown.onChange(value => {
                    cfg.defaultQualityLevel = value as DeconstructionEngineSettings['defaultQualityLevel'];
                });
            });

        new Setting(qualityCard)
            .setName('低质量自动升级')
            .setDesc('检测到拆解质量较低时自动升级到更高级别')
            .addToggle(toggle => {
                toggle.setValue(cfg.enableAutoUpgrade);
                toggle.onChange(value => {
                    cfg.enableAutoUpgrade = value;
                });
            });

        const dimCard = section.createDiv({
            cls: 'nw-u-p-12px-16px-2 nw-u-b-1px-solid-background-m-2 nw-u-brd-6px-2 nw-u-marginbottom-16px-2 nw-u-bg-background-secondary-2'
        });
        dimCard.createEl('h4', { text: '🧩 拆解维度', cls: 'nw-u-m-0-0-12px-0-2 nw-u-fs-14px-2' });

        const dimList = dimCard.createDiv({ cls: 'nw-u-d-grid-2 nw-u-gtc-repeat-auto-fill-minma-5 nw-u-gap-6px-2' });
        const dimSet = new Set(cfg.enabledDimensions);
        ALL_BREAKDOWN_DIMENSIONS.forEach(dim => {
            const item = new Setting(dimList)
                .setName(DIMENSION_LABELS[dim])
                .addToggle(toggle => {
                    toggle.setValue(dimSet.has(dim));
                    toggle.onChange(value => {
                        const set = new Set(cfg.enabledDimensions);
                        if (value) set.add(dim);
                        else set.delete(dim);
                        cfg.enabledDimensions = ALL_BREAKDOWN_DIMENSIONS.filter(d => set.has(d));
                        if (dim === 'commercial') cfg.includeCommercial = value;
                        if (dim === 'readability') cfg.includeReadability = value;
                    });
                });
            item.settingEl.style.borderBottom = 'none';
            item.settingEl.style.padding = '6px 0';
        });

        const vectorCard = section.createDiv({
            cls: 'nw-u-p-12px-16px-2 nw-u-b-1px-solid-background-m-2 nw-u-brd-6px-2 nw-u-marginbottom-16px-2 nw-u-bg-background-secondary-2'
        });
        vectorCard.createEl('h4', { text: '🧠 向量增强', cls: 'nw-u-m-0-0-12px-0-2 nw-u-fs-14px-2' });

        new Setting(vectorCard)
            .setName('启用向量增强')
            .setDesc('使用向量相似度匹配辅助拆解（详细端点配置见「写作知识库」tab）')
            .addToggle(toggle => {
                toggle.setValue(cfg.vectorEnabled);
                toggle.onChange(value => {
                    cfg.vectorEnabled = value;
                });
            });

        new Setting(vectorCard)
            .setName('向量模型名称')
            .setDesc('默认向量嵌入模型名')
            .addText(text => {
                text.setValue(cfg.vectorModel);
                text.setPlaceholder('bge-m3');
                text.onChange(value => {
                    cfg.vectorModel = value.trim();
                });
            });

        new Setting(vectorCard)
            .setName('缓存大小 / 批处理大小')
            .setDesc(`缓存: ${cfg.vectorCacheSize} 条，批处理: ${cfg.vectorBatchSize} 条/次`)
            .addSlider(slider => {
                slider.setLimits(100, 50000, 100);
                slider.setValue(cfg.vectorCacheSize);
                slider.setDynamicTooltip();
                slider.onChange(value => {
                    cfg.vectorCacheSize = value;
                });
            })
            .addSlider(slider => {
                slider.setLimits(1, 256, 1);
                slider.setValue(cfg.vectorBatchSize);
                slider.setDynamicTooltip();
                slider.onChange(value => {
                    cfg.vectorBatchSize = value;
                });
            });

        const llmCard = section.createDiv({
            cls: 'nw-u-p-12px-16px-2 nw-u-b-1px-solid-background-m-2 nw-u-brd-6px-2 nw-u-marginbottom-16px-2 nw-u-bg-background-secondary-2'
        });
        llmCard.createEl('h4', {
            text: '🤖 LLM 增强 · 实验性',
            cls: 'nw-u-m-0-0-12px-0-2 nw-u-fs-14px-2'
        });

        new Setting(llmCard)
            .setName('启用 LLM 增强')
            .setDesc('调用大模型对拆解结果做二次提炼（增加 API 成本）')
            .addToggle(toggle => {
                toggle.setValue(cfg.llmEnabled);
                toggle.onChange(value => {
                    cfg.llmEnabled = value;
                });
            });

        new Setting(llmCard)
            .setName('LLM 模型名称')
            .setDesc('用于增强的 LLM 模型名称')
            .addText(text => {
                text.setValue(cfg.llmModel);
                text.setPlaceholder('deepseek-r1:7b');
                text.onChange(value => {
                    cfg.llmModel = value.trim();
                });
            });

        const perfCard = section.createDiv({
            cls: 'nw-u-p-12px-16px-2 nw-u-b-1px-solid-background-m-2 nw-u-brd-6px-2 nw-u-marginbottom-16px-2 nw-u-bg-background-secondary-2'
        });
        perfCard.createEl('h4', { text: '⚙️ 性能', cls: 'nw-u-m-0-0-12px-0-2 nw-u-fs-14px-2' });

        new Setting(perfCard)
            .setName('最大并发拆解数')
            .setDesc(`同时执行的拆解任务数（当前: ${cfg.maxConcurrency}）`)
            .addSlider(slider => {
                slider.setLimits(1, 8, 1);
                slider.setValue(cfg.maxConcurrency);
                slider.setDynamicTooltip();
                slider.onChange(value => {
                    cfg.maxConcurrency = value;
                });
            });

        new Setting(perfCard)
            .setName('采样模式（仅分析前 N 字）')
            .setDesc('默认关闭：全本智能分段拆解，逐段覆盖全部剧情。开启后仅分析开头“文本采样上限”字数，用于快速预览。')
            .addToggle(toggle => {
                toggle.setValue(cfg.sampleMode === true);
                toggle.onChange(value => {
                    cfg.sampleMode = value;
                });
            });

        new Setting(perfCard)
            .setName('文本采样上限')
            .setDesc(`仅采样模式生效：采样模式下参与拆解的最大字数（当前: ${cfg.textSampleLimit.toLocaleString()}）。全本模式下此项不生效。`)
            .addText(text => {
                text.setValue(String(cfg.textSampleLimit));
                text.setPlaceholder('100000');
                text.inputEl.type = 'number';
                text.onChange(value => {
                    const n = parseInt(value, 10);
                    if (Number.isFinite(n) && n > 0) {
                        cfg.textSampleLimit = n;
                    } else {
                        new Notice('⚠️ 文本采样上限必须为正整数');
                        text.setValue(String(cfg.textSampleLimit));
                    }
                });
            });
    }

    private renderForeshadowTab() {
        const section = this.tabContent.createDiv();

        new Setting(section)
            .setName('最大未揭示伏笔')
            .setDesc('允许的最大未揭示伏笔数量')
            .addText(text => text
                .setPlaceholder('20')
                .setValue(String(this.plugin.settings.maxUnrevealedForeshadow))
                .onChange((value) => {
                    this.plugin.settings.maxUnrevealedForeshadow = parseInt(value) || 20;
                }));
    }

    private renderTemplateTab() {
        const section = this.tabContent.createDiv();
        const templateManager = this.plugin.engineRegistry.get<TemplateManager>(ENGINE_NAMES.TEMPLATE_MANAGER);
        templateManager.renderTemplateList(section);

        // 提示词策略配置子分区
        section.createEl('hr', { cls: 'nw-u-m-20px-0 nw-u-b-none nw-u-bt-1px-solid-background-m-2' });
        section.createEl('h3', { text: '💬 提示词策略', cls: 'nw-u-margintop-16px-2' });
        if (this.plugin.promptManager) {
            const { PromptManagerSettings } = require('./prompt-manager-settings');
            const manager = new PromptManagerSettings(this.app, this.plugin, section);
            manager.render();
        } else {
            section.createDiv({ text: '提示词管理器未初始化', cls: 'nw-u-c-text-error' });
        }
    }

    private renderAppearanceTab() {
        const section = this.tabContent.createDiv();
        renderAppearanceSettings(section, this.plugin, {
            compact: false,
            rerender: () => this.renderActiveTab(),
        });
    }

    private renderLayoutTab() {
        const section = this.tabContent.createDiv();

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
                .onChange((value) => {
                    if (!this.plugin.settings.panelLayout) {
                        this.plugin.settings.panelLayout = { panels: [], autoRestore: true, lastWorkspaceOpen: false };
                    }
                    this.plugin.settings.panelLayout.autoRestore = value;
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

    private async renderRulesTab(): Promise<void> {
        const section = this.tabContent.createDiv();

        section.createEl('h3', { text: '📜 写作规则版本管理', cls: 'nw-u-margintop-0' });

        section.createEl('p', {
            text: '写作规则是 AI 生成正文时遵循的核心准则。版本不匹配可能导致生成质量下降或出现不一致行为。',
            cls: 'nw-u-c-text-muted-2 nw-u-fs-13px-2 nw-u-marginbottom-20px-2'
        });

        const statusCard = section.createDiv({
            cls: 'nw-u-p-20px-2 nw-u-bg-background-secondary-2 nw-u-brd-10px-2 nw-u-marginbottom-20px-2'
        });

        try {
            const rulesService = RulesService.getInstance(this.app);
            const { current, expected } = await rulesService.checkRulesVersion();
            const isPresent = await rulesService.isRulesFilePresent();
            const config = await rulesService.getRulesConfig();

            const statusRow1 = statusCard.createDiv({ cls: 'nw-u-d-flex-2 nw-u-jc-space-between-2 nw-u-marginbottom-12px-2' });
            statusRow1.createDiv({ text: '规则文件状态:', cls: 'nw-u-fwt-600-2' });
            statusRow1.createDiv({
                text: isPresent ? '✅ 已检测到' : '⚠️ 未找到',
                attr: {
                    style: `padding:4px 12px;border-radius:12px;font-size:12px;font-weight:600;${
                        isPresent ? 'background:var(--text-accent);color:var(--background-primary);' : 'background:var(--background-modifier-warning);color:var(--text-warning);'
                    }`
                }
            });

            const statusRow2 = statusCard.createDiv({ cls: 'nw-u-d-flex-2 nw-u-jc-space-between-2 nw-u-marginbottom-12px-2' });
            statusRow2.createDiv({ text: '当前规则版本:', cls: 'nw-u-fwt-600-2' });
            statusRow2.createDiv({ text: current === 'unknown' ? '无法检测' : `v${current}`, cls: 'nw-u-fontfamily-monospace' });

            const statusRow3 = statusCard.createDiv({ cls: 'nw-u-d-flex-2 nw-u-jc-space-between-2 nw-u-marginbottom-12px-2' });
            statusRow3.createDiv({ text: '期望规则版本:', cls: 'nw-u-fwt-600-2' });
            statusRow3.createDiv({ text: `v${expected}`, cls: 'nw-u-fontfamily-monospace' });

            if (config.lastModified > 0) {
                const statusRow4 = statusCard.createDiv({ cls: 'nw-u-d-flex-2 nw-u-jc-space-between-2 nw-u-marginbottom-12px-2' });
                statusRow4.createDiv({ text: '最后修改时间:', cls: 'nw-u-fwt-600-2' });
                statusRow4.createDiv({ text: new Date(config.lastModified).toLocaleString(), cls: 'nw-u-fs-12px-2 nw-u-c-text-muted-2' });
            }

            if (!isPresent) {
                section.createDiv({
                    text: '❌ 警告：未找到写作规则文件！AI 将使用内置的默认规则。建议在项目根目录创建「00-系统模板/写作规则.md」文件。',
                    cls: 'nw-u-p-12px-2 nw-u-bg-background-modifier-er nw-u-c-text-error nw-u-brd-6px-2 nw-u-marginbottom-16px-2'
                });
            } else if (current !== expected && current !== 'unknown') {
                section.createDiv({
                    text: `⚠️ 警告：规则版本不匹配！当前 v${current}，期望 v${expected}。建议更新写作规则文件以确保生成质量。`,
                    cls: 'nw-u-p-12px-2 nw-u-bg-background-modifier-wa nw-u-c-text-warning nw-u-brd-6px-2 nw-u-marginbottom-16px-2'
                });
            } else {
                section.createDiv({
                    text: '✅ 规则版本正常',
                    cls: 'nw-u-p-12px-2 nw-u-bg-background-modifier-su nw-u-c-text-success nw-u-brd-6px-2 nw-u-marginbottom-16px-2'
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
                this.renderActiveTab();
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
                    constructor(app: App) { super(app); }
                    onOpen() {
                        const { contentEl } = this;
                        contentEl.createEl('h3', { text: '写作规则内容' });
                        const textarea = contentEl.createEl('textarea', {
                            cls: 'nw-u-w-100-2 nw-u-h-400px nw-u-p-12px-2 nw-u-fontfamily-monospace nw-u-fs-12px-2 nw-u-b-1px-solid-background-m-2 nw-u-brd-6px-2 nw-u-bg-background-primary-2 nw-u-c-text-primary nw-u-resize-none'
                        });
                        textarea.value = rules;
                    }
                })(this.app);
                modal.open();
            });

        } catch (e) {
            statusCard.createDiv({
                text: `❌ 检查失败: ${(e as Error).message}`,
                cls: 'nw-u-c-text-error'
            });
        }
    }

    private renderPerformanceTab(): void {
        const section = this.tabContent.createDiv();

        section.createEl('h3', { text: '📊 性能监控', cls: 'nw-u-margintop-0' });
        section.createEl('p', { text: '监控插件关键操作的性能，识别性能瓶颈并优化。', cls: 'nw-u-c-text-muted-2 nw-u-fs-13px-2 nw-u-marginbottom-16px-2' });

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
                cls: "nw-empty-info-card nw-u-margintop-16px-2",
                attr: {}
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

        section.createEl('h4', { text: '📈 概览统计', cls: 'nw-u-m-16px-0-12px-0 nw-u-fs-14px-2' });

        const statsGrid = section.createEl('div', {
            cls: 'nw-u-d-grid-2 nw-u-gtc-repeat-auto-fit-minmax-6 nw-u-gap-12px-2 nw-u-marginbottom-20px-2'
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

        section.createEl('h4', { text: '📂 分类统计', cls: 'nw-u-m-16px-0-12px-0 nw-u-fs-14px-2' });

        const catTable = section.createEl('table', {
            cls: 'nw-u-w-100-2 nw-u-bordercollapse-collapse-2 nw-u-marginbottom-20px-2 nw-u-fs-13px-2'
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

        section.createEl('h4', { text: '🐢 最近慢操作', cls: 'nw-u-m-16px-0-12px-0 nw-u-fs-14px-2' });

        if (slowOps.length === 0) {
            section.createEl('div', {
                text: '✅ 暂无慢操作记录',
                cls: 'nw-u-p-20px-2 nw-u-ta-center-2 nw-u-c-text-muted-2 nw-u-fs-13px-2 nw-u-bg-background-secondary-2 nw-u-brd-6px-2'
            });
        } else {
            const slowList = section.createEl('div', {
                cls: 'nw-u-maxh-240px nw-u-ovy-auto-2 nw-u-b-1px-solid-background-m-2 nw-u-brd-8px-2'
            });
            for (const op of slowOps.slice(0, 20)) {
                const item = slowList.createEl('div', {
                    cls: 'nw-u-p-10px-14px-2 nw-u-bb-1px-solid-background-m-2'
                });
                const top = item.createEl('div', { cls: 'nw-u-d-flex-2 nw-u-jc-space-between-2 nw-u-ai-center-2' });
                top.createEl('span', { text: op.name, cls: 'nw-u-fwt-600-2' });
                top.createEl('span', {
                    text: this.formatDuration(op.duration),
                    cls: 'nw-u-c-text-error nw-u-fwt-600-2'
                });
                const bottom = item.createEl('div', {
                    text: `${op.category} · ${new Date(op.timestamp).toLocaleString()} · 阈值: ${this.formatDuration(op.threshold)}`,
                    cls: 'nw-u-fs-12px-2 nw-u-c-text-muted-2 nw-u-margintop-4px-3'
                });
            }
        }

        section.createEl('h4', { text: '📝 最近操作日志', cls: 'nw-u-m-16px-0-12px-0 nw-u-fs-14px-2' });

        if (log.length === 0) {
            section.createEl('div', {
                text: '暂无性能数据，请先使用插件功能',
                cls: 'nw-u-p-20px-2 nw-u-ta-center-2 nw-u-c-text-muted-2 nw-u-fs-13px-2 nw-u-bg-background-secondary-2 nw-u-brd-6px-2'
            });
        } else {
            const logContainer = section.createEl('div', {
                cls: 'nw-u-maxh-300px-2 nw-u-ovy-auto-2 nw-u-b-1px-solid-background-m-2 nw-u-brd-8px-2 nw-u-fontfamily-font-monospace nw-u-fs-12px-2'
            });
            for (const entry of log.slice(0, 50)) {
                const item = logContainer.createEl('div', {
                    cls: 'nw-u-p-6px-12px nw-u-bb-1px-solid-background-m-2 nw-u-d-flex-2 nw-u-jc-space-between-2 nw-u-gap-12px-2'
                });
                const left = item.createEl('span');
                left.textContent = `[${entry.category}] ${entry.name}`;
                const right = item.createEl('span', {
                    cls: 'nw-u-c-text-muted-2 nw-u-ws-nowrap-2'
                });
                right.textContent = this.formatDuration(entry.duration);
            }
        }

        section.createEl('h4', { text: '⚙️ 操作', cls: 'nw-u-m-16px-0-12px-0 nw-u-fs-14px-2' });

        const btnRow = section.createEl('div', {
            cls: 'nw-u-d-flex-2 nw-u-gap-10px-2 nw-u-fwr-wrap-2'
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

    private renderAboutTab(): void {
        const section = this.tabContent.createDiv();

        section.createEl('h3', { text: '📖 小说工坊 AI', cls: 'nw-u-margintop-0' });

        const currentVersion = PLUGIN_VERSION;

        const versionCard = section.createDiv({
            cls: 'nw-u-p-20px-2 nw-u-bg-background-secondary-2 nw-u-brd-10px-2 nw-u-marginbottom-20px-2 nw-u-ta-center-2'
        });

        versionCard.createEl('div', {
            text: '当前版本',
            cls: 'nw-u-fs-13px-2 nw-u-c-text-muted-2 nw-u-marginbottom-4px-2'
        });
        versionCard.createEl('div', {
            text: `v${currentVersion}`,
            cls: 'nw-u-fs-32px nw-u-fwt-700-2 nw-u-c-text-normal-2 nw-u-marginbottom-8px-2'
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
            cls: 'nw-u-d-grid-2 nw-u-gtc-1fr-1fr-2 nw-u-gap-12px-2 nw-u-margintop-16px-2 nw-u-ta-left-2'
        });

        this.renderInfoItem(infoGrid, '最新版本', latestVersionInfo);
        this.renderInfoItem(infoGrid, '上次检查', lastCheckInfo);

        const btnRow = section.createDiv({
            cls: 'nw-u-d-flex-2 nw-u-gap-10px-2 nw-u-marginbottom-24px-2 nw-u-fwr-wrap-2'
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

        section.createEl('h4', { text: '⚙️ 更新设置', cls: 'nw-u-marginbottom-12px-2' });

        new Setting(section)
            .setName('自动检查更新')
            .setDesc('定期检查插件更新，仅在后台静默检查，不打扰使用')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoCheckUpdates ?? false)
                .onChange((value) => {
                    this.plugin.settings.autoCheckUpdates = value;
                    void this.plugin.saveSettings();
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
                dropdown.onChange((value) => {
                    this.plugin.settings.updateSource = value as 'github' | 'custom';
                    void this.plugin.saveSettings();
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
                    .onChange((value) => {
                        this.plugin.settings.updateGithubRepo = value;
                        void this.plugin.saveSettings();
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
                    .onChange((value) => {
                        this.plugin.settings.updateCustomUrl = value;
                        void this.plugin.saveSettings();
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
                dropdown.onChange((value) => {
                    this.plugin.settings.updateCheckIntervalHours = parseInt(value, 10);
                    void this.plugin.saveSettings();
                    const updateChecker = this.plugin.engineRegistry.getOrNull<any>(ENGINE_NAMES.UPDATE_CHECKER);
                    if (updateChecker) {
                        updateChecker.updateConfig({ checkIntervalHours: parseInt(value, 10) });
                    }
                });
            });

        renderCollapsibleSection(section, '📌 关于插件', false, (aboutSection) => {
            const aboutCard = aboutSection.createDiv({
                cls: 'nw-u-p-16px-2 nw-u-bg-background-secondary-2 nw-u-brd-8px-2 nw-u-fs-13px-2 nw-u-lh-1-7 nw-u-c-text-muted-2'
            });

            aboutCard.createEl('p', {
                text: '全流程 AI 长篇小说创作系统 — 协同写作工作台 + 多模型智能引擎 + 数据安全架构。',
                cls: 'nw-u-m-0-0-12px-0-2'
            });

            aboutCard.createEl('div', { text: '作者：南柯一梦', cls: 'nw-u-marginbottom-4px-2' });
            aboutCard.createEl('div', { text: '许可证：MIT', cls: 'nw-u-marginbottom-4px-2' });
        });
    }

    private renderInfoItem(container: HTMLElement, label: string, value: string): void {
        const item = container.createDiv({
            cls: 'nw-u-p-10px-12px-2 nw-u-bg-background-primary-2 nw-u-brd-6px-2'
        });
        item.createEl('div', {
            text: label,
            cls: 'nw-u-fs-11px-2 nw-u-c-text-muted-2 nw-u-marginbottom-2px-2'
        });
        item.createEl('div', {
            text: value,
            cls: 'nw-u-fs-14px-2 nw-u-fwt-600-2 nw-u-c-text-normal-2'
        });
    }

    private addStatCard(container: HTMLElement, label: string, value: string): void {
        const card = container.createEl('div', {
            cls: 'nw-u-p-14px-2 nw-u-bg-background-secondary-2 nw-u-brd-8px-2'
        });
        card.createEl('div', {
            text: label,
            cls: 'nw-u-fs-12px-2 nw-u-c-text-muted-2 nw-u-marginbottom-6px-2'
        });
        card.createEl('div', {
            text: value,
            cls: 'nw-u-fs-18px-2 nw-u-fwt-700-2'
        });
    }

    private showPerformanceReport(report: string): void {
        const modal = new Modal(this.app);
        modal.modalEl.addClass('nw-scope');
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
            cls: 'nw-u-d-flex-2 nw-u-gap-10px-2 nw-u-jc-flex-end-2 nw-u-margintop-16px-2'
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

    private async saveAllSettings() {
        const contentEl = this.contentEl;

        const keyInput = contentEl.querySelector('input[type="password"], input[type="text"][placeholder*="密钥"], input[type="text"][placeholder*="API"]');
        if (keyInput) {
            const keyVal = (keyInput as HTMLInputElement).value;
            this.plugin.settings.apiKey = keyVal;
            const cid = this.plugin.getCurrentProviderId();
            if (cid) {
                this.plugin.settings.providerKeys[cid] = keyVal;
            }
        }

        const nameInput = contentEl.querySelector('input[placeholder*="我的代理"], input[placeholder*="提供商名称"]');
        if (nameInput) {
            const nameVal = (nameInput as HTMLInputElement).value.trim();
            if (nameVal) {
                this.plugin.settings.customProviderName = nameVal;
            }
        }

        const endpointInput = contentEl.querySelector('input[placeholder*="api.example.com"], input[placeholder*="ark.cn-beijing"]');
        if (endpointInput) {
            const endpointVal = (endpointInput as HTMLInputElement).value.trim();
            if (endpointVal) {
                this.plugin.settings.apiEndpoint = endpointVal;
            }
        }

        if (this.defaultDropdown) {
            this.plugin.settings.defaultModel = this.defaultDropdown.getValue();
        }
        if (this.proDropdown) {
            this.plugin.settings.proModel = this.proDropdown.getValue();
        }
        if (this.flashDropdown) {
            this.plugin.settings.flashModel = this.flashDropdown.getValue();
        }

        const ctxInput = contentEl.querySelector('input[placeholder*="128000"]') as HTMLInputElement | null;
        if (ctxInput && ctxInput.value && !isNaN(parseInt(ctxInput.value))) {
            this.plugin.settings.maxContext = parseInt(ctxInput.value);
        }

        const outInputs = contentEl.querySelectorAll('input[placeholder*="8192"]') as NodeListOf<HTMLInputElement>;
        for (const inp of outInputs) {
            if (inp.placeholder === '8192' && inp.value && !isNaN(parseInt(inp.value))) {
                this.plugin.settings.maxOutput = parseInt(inp.value);
                break;
            }
        }

        const endpoint = this.plugin.settings.apiEndpoint;
        const customProvs = this.plugin.settings.customProviders || [];
        const isPresetEndpoint = customProvs.some(c => c.isDefault && c.endpoint === endpoint);
        const isRegisteredCustom = customProvs.some(c => c.endpoint === endpoint);
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
        }

        const currId = this.plugin.getCurrentProviderId();
        if (currId && customProvs.find(c => c.id === currId)) {
            const cp = customProvs.find(c => c.id === currId)!;
            cp.models = [...this.plugin.settings.availableModels];
            cp.maxContext = this.plugin.settings.maxContext || cp.maxContext;
            cp.maxOutput = this.plugin.settings.maxOutput || cp.maxOutput;
        }

        const updateChecker = this.plugin.engineRegistry.getOrNull<any>(ENGINE_NAMES.UPDATE_CHECKER);
        if (updateChecker) {
            updateChecker.updateConfig({
                enabled: this.plugin.settings.autoCheckUpdates,
                source: this.plugin.settings.updateSource,
                githubRepo: this.plugin.settings.updateGithubRepo,
                customUrl: this.plugin.settings.updateCustomUrl,
                checkIntervalHours: this.plugin.settings.updateCheckIntervalHours,
            });
        }

        await this.plugin.saveSettings();
        this.plugin.updateStatusBarText();
        this.plugin.refreshFullWriterContextPanel();
    }

    private showManageProvidersModal(): void {
        new ManageProvidersModal(this.app, this.plugin, () => this.onOpen()).open();
    }
}
