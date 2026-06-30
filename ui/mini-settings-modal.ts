import { App, Modal, Setting, DropdownComponent, Notice } from 'obsidian';
import NovelWriterPlugin, { PROVIDERS, CustomProvider } from '../main';
import { renderAppearanceSettings } from './appearance-settings';
import { ManageProvidersModal } from './manage-providers-modal';
import { TemplateManager } from './template-manager';

export class MiniSettingsModal extends Modal {
    private plugin: NovelWriterPlugin;
    private proDropdown: DropdownComponent | null = null;
    private flashDropdown: DropdownComponent | null = null;
    private activeTab: string = 'api';
    private tabContent!: HTMLElement;
    private tabBar!: HTMLElement;

    constructor(app: App, plugin: NovelWriterPlugin) {
        super(app);
        this.plugin = plugin;
    }

    async onOpen() {
    this.modalEl.addClass('nw-scope');
        const { contentEl } = this;

        const wrapper = contentEl.parentElement as HTMLElement;
        if (wrapper) {
            wrapper.style.setProperty('max-width', 'min(720px, 95vw)', 'important');
            wrapper.style.setProperty('width', 'min(720px, 95vw)', 'important');
            wrapper.style.setProperty('margin', 'auto', 'important');
        }
        contentEl.style.maxWidth = 'min(720px, 95vw)';
        contentEl.style.width = '100%';
        contentEl.style.setProperty('overflow-y', 'auto', 'important');
        contentEl.empty();
        contentEl.addClass('novel-writer-mini-settings');

        contentEl.createEl('h3', { text: '⚙️ 工作台设置', attr: { style: 'margin-top:0;margin-bottom:8px;' } });

        this.tabBar = contentEl.createDiv({ cls: 'nw-settings-tab-bar' });
        const tabs = [
            { id: 'api', label: '🔌 API配置' },
            { id: 'writing', label: '✍️ 写作配置' },
            { id: 'cowrite', label: '🖥 协同写作' },
            { id: 'foreshadow', label: '🔮 伏笔管理' },
            { id: 'template', label: '📋 模板管理' },
            { id: 'appearance', label: '🎨 外观设置' },
            { id: 'layout', label: '🧩 工作台布局' },
        ];
        for (const tab of tabs) {
            const tabEl = this.tabBar.createDiv({
                cls: 'nw-settings-tab',
                text: tab.label,
                attr: { 'data-tab-id': tab.id }
            });
            if (tab.id === this.activeTab) tabEl.addClass('is-active');
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
            el.toggleClass('is-active', el.getAttribute('data-tab-id') === this.activeTab);
        });
        switch (this.activeTab) {
            case 'api': this.renderApiTab(); break;
            case 'writing': this.renderWritingTab(); break;
            case 'cowrite': this.renderCoWriteTab(); break;
            case 'foreshadow': this.renderForeshadowTab(); break;
            case 'template': this.renderTemplateTab(); break;
            case 'appearance': this.renderAppearanceTab(); break;
            case 'layout': this.renderLayoutTab(); break;
        }
    }

    private renderApiTab() {
        const section = this.tabContent.createDiv();
        const currentProviderId = this.plugin.getCurrentProviderId();
        const customProviders = this.plugin.settings.customProviders || [];
        const isPreset = currentProviderId ? !!PROVIDERS[currentProviderId] : false;
        const isCustom = !isPreset;
        const isLegacyCustom = isCustom && !customProviders.find(c => c.id === currentProviderId);

        const updateModelDropdown = (dd: DropdownComponent, selectedModel: string) => {
            const selectEl = dd.selectEl;
            selectEl.empty();
            this.plugin.settings.availableModels.forEach(model => {
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
                    const label = p.isPreset ? p.name : `🔧 ${p.name}`;
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
                        this.onOpen();
                    }
                });
            });

        const manageRow = section.createDiv({ attr: { style: 'display:flex;justify-content:flex-end;margin-top:-4px;margin-bottom:8px;' } });
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
            : (currentProviderId ? PROVIDERS[currentProviderId]?.name || currentProviderId : 'API');
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
            this.plugin.settings.availableModels.forEach((model, idx) => {
                const chip = modelListEl.createDiv({ cls: 'nw-settings-model-chip' });
                chip.createSpan({ text: model });
                const delBtn = chip.createEl('button', { text: '✕', attr: { type: 'button', title: '删除此模型' } });
                delBtn.addEventListener('click', async () => {
                    this.plugin.settings.availableModels.splice(idx, 1);
                    if (this.plugin.settings.availableModels.length === 0) {
                        this.plugin.settings.availableModels = ['default-model'];
                    }
                    if (!this.plugin.settings.availableModels.includes(this.plugin.settings.defaultModel)) {
                        this.plugin.settings.defaultModel = this.plugin.settings.availableModels[0];
                    }
                    if (!this.plugin.settings.availableModels.includes(this.plugin.settings.flashModel)) {
                        this.plugin.settings.flashModel = this.plugin.settings.availableModels[0];
                    }
                    if (!this.plugin.settings.availableModels.includes(this.plugin.settings.proModel)) {
                        this.plugin.settings.proModel = this.plugin.settings.availableModels[0];
                    }
                    const currProviderId = this.plugin.getCurrentProviderId();
                    const customProvs = this.plugin.settings.customProviders || [];
                    if (currProviderId && customProvs.find(c => c.id === currProviderId)) {
                        const cp = customProvs.find(c => c.id === currProviderId)!;
                        cp.models = [...this.plugin.settings.availableModels];
                    }
                    await this.plugin.saveSettings();
                    renderModelChips();
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
            if (this.plugin.settings.availableModels.includes(modelName)) {
                new Notice('模型已存在');
                return;
            }
            this.plugin.settings.availableModels.push(modelName);
            const currProviderId = this.plugin.getCurrentProviderId();
            const customProvs = this.plugin.settings.customProviders || [];
            if (currProviderId && customProvs.find(c => c.id === currProviderId)) {
                const cp = customProvs.find(c => c.id === currProviderId)!;
                cp.models = [...this.plugin.settings.availableModels];
            }
            await this.plugin.saveSettings();
            modelInput.value = '';
            new Notice(`✅ 已添加模型：${modelName}`);
            renderModelChips();
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
            .setName('Pro 模型（正文/角色/实体）')
            .setDesc('正文创作、角色生成、势力/地点/物品设定任务使用')
            .addDropdown(dropdown => {
                this.proDropdown = dropdown;
                this.plugin.settings.availableModels.forEach(model => {
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
                this.plugin.settings.availableModels.forEach(model => {
                    dropdown.addOption(model, model);
                });
                dropdown.setValue(this.plugin.settings.flashModel);
                dropdown.onChange(value => {
                    this.plugin.settings.flashModel = value;
                    this.plugin.updateModelLimitsFromModel(value);
                });
            });

        new Setting(section)
            .setName('最大上下文')
            .setDesc('AI 模型的最大上下文长度（token）')
            .addText(text => text
                .setPlaceholder('128000')
                .setValue(String(this.plugin.settings.maxContext)));

        new Setting(section)
            .setName('最大输出')
            .setDesc('AI 最大输出长度（token）')
            .addText(text => text
                .setPlaceholder('8192')
                .setValue(String(this.plugin.settings.maxOutput)));
    }

    private renderWritingTab() {
        const section = this.tabContent.createDiv();

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

    private renderCoWriteTab() {
        const section = this.tabContent.createDiv();

        section.createEl('p', {
            text: '协同写作仅使用本地模型（Ollama），不回退到远程 API。请确保 Ollama 服务已启动。',
            cls: 'setting-item-description'
        });

        new Setting(section)
            .setName('本地模型')
            .setDesc('选择协同写作使用的 Ollama 本地模型')
            .addDropdown(dropdown => {
                dropdown.addOption('', '（未设置 — 协同写作将无法使用）');
                const ollamaModels = ['qwen2.5:7b', 'qwen2.5:14b', 'deepseek-r1:7b', 'deepseek-r1:14b', 'llama3.1:8b', 'mistral:7b', 'gemma2:9b'];
                for (const m of ollamaModels) {
                    dropdown.addOption(m, `🖥 ${m}`);
                }
                if (this.plugin.settings.availableModels) {
                    for (const m of this.plugin.settings.availableModels) {
                        if (!ollamaModels.includes(m) && (m.includes(':') || m.includes('local'))) {
                            dropdown.addOption(m, `🖥 ${m}`);
                        }
                    }
                }
                dropdown.setValue(this.plugin.settings.coWriteModel || '');
                dropdown.onChange(async (value) => {
                    this.plugin.settings.coWriteModel = value;
                    await this.plugin.saveSettings();
                });
            });

        new Setting(section)
            .setName('Temperature')
            .setDesc('本地模型的创造性参数（0-2，默认 0.7）')
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
            .setDesc('本地模型单次生成的最大 token 数（默认 600）')
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
    }

    private renderForeshadowTab() {
        const section = this.tabContent.createDiv();

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
    }

    private renderTemplateTab() {
        const section = this.tabContent.createDiv();
        const templateManager = new TemplateManager(this.app);
        templateManager.renderTemplateList(section);
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
            this.plugin.settings.customProviderName = (nameInput as HTMLInputElement).value;
        }

        const endpointInput = contentEl.querySelector('input[placeholder*="api.example.com"], input[placeholder*="ark.cn-beijing"]');
        if (endpointInput) {
            this.plugin.settings.apiEndpoint = (endpointInput as HTMLInputElement).value.trim();
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
        const isPresetEndpoint = Object.values(PROVIDERS).some(p => p.endpoint === endpoint);
        const customProvs = this.plugin.settings.customProviders || [];
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

        await this.plugin.saveSettings();
        this.plugin.updateStatusBarText();
        this.plugin.refreshFullWriterContextPanel();
    }

    private showManageProvidersModal(): void {
        new ManageProvidersModal(this.app, this.plugin, () => this.onOpen()).open();
    }
}
