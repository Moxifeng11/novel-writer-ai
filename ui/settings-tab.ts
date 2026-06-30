import { App, PluginSettingTab, Setting, Notice, Modal } from 'obsidian';
import NovelWriterPlugin, { NovelWriterSettings, DEFAULT_SETTINGS, PROVIDERS, ProviderPreset, CustomProvider } from '../main';
import { renderAppearanceSettings } from './appearance-settings';
import { renderCollapsibleSection } from './settings-utils';
import { ManageProvidersModal } from './manage-providers-modal';
import { TemplateManager } from './template-manager';

export class NovelWriterSettingTab extends PluginSettingTab {
    private plugin: NovelWriterPlugin;

    constructor(app: App, plugin: NovelWriterPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;

        containerEl.empty();

        containerEl.createEl('h2', { text: '📖 小说工坊 AI 设置' });

        // v6.0: 使用共享的 renderCollapsibleSection，与迷你设置弹窗保持 CSS 样式一致
        renderCollapsibleSection(containerEl, '🔌 API 配置', true, (section) => this.renderApiSection(section), [
            { text: '🔧 管理全部提供商', onClick: () => this.showManageProvidersModal() }
        ]);
        renderCollapsibleSection(containerEl, '✍️ 写作配置', true, (section) => this.renderWritingSection(section));
        renderCollapsibleSection(containerEl, '📌 伏笔管理', false, (section) => this.renderForeshadowSection(section));
        renderCollapsibleSection(containerEl, '📋 模板管理', false, (section) => { this.renderTemplateSection(section); });
        renderCollapsibleSection(containerEl, '🎨 外观设置', false, (section) => this.renderAppearanceSection(section));
        renderCollapsibleSection(containerEl, '🧩 工作台布局', false, (section) => this.renderWorkspaceLayoutSection(section));
    }

    private renderApiSection(containerEl: HTMLElement): void {
        const section = containerEl.createEl('section');

        const currentProviderId = this.plugin.getCurrentProviderId();
        // v3.5.0: isCustom = 当前提供商是自定义的（非PROVIDERS预设）
        const isCustom = currentProviderId ? !PROVIDERS[currentProviderId] : (this.plugin.settings.apiEndpoint !== '');
        // 如果是遗留自定义配置（有端点但不在 customProviders 中），提示迁移
        if (isCustom && currentProviderId && !(this.plugin.settings.customProviders || []).find(c => c.id === currentProviderId)) {
            // 遗留模式：降级为无ID自定义
        }

        // 跟踪脏状态变了哪些
        const dirtyState = {
            endpoint: false,
            name: false,
            models: false,
            context: false,
            output: false
        };

        // === 提供商选择 ===
        let providerDropdown: any;
        new Setting(section)
            .setName('API 提供商')
            .setDesc('选择 AI API 提供商，或添加自定义提供商')
            .addDropdown(dropdown => {
                providerDropdown = dropdown;
                // 预设提供商
                Object.entries(PROVIDERS).forEach(([key, val]) => {
                    dropdown.addOption(key, val.name);
                });
                // v3.5.0: 自定义提供商也出现在下拉列表中
                const customProviders = this.plugin.settings.customProviders || [];
                for (const cp of customProviders) {
                    dropdown.addOption(cp.id, `🔧 ${cp.name}`);
                }
                // 兜底选项：添加新自定义
                dropdown.addOption('__add_custom__', '➕ 添加自定义提供商...');
                dropdown.setValue(currentProviderId || '__add_custom__');
                dropdown.onChange(async (value) => {
                    // v3.5.0: "添加自定义提供商" → 弹出添加表单
                    if (value === '__add_custom__') {
                        this.showAddCustomProviderForm(section);
                        return;
                    }
                    // 切换到已有自定义提供商
                    const customProviders = this.plugin.settings.customProviders || [];
                    const customMatch = customProviders.find(c => c.id === value);
                    if (customMatch) {
                        if (currentProviderId) {
                            this.plugin.settings.providerKeys[currentProviderId] = this.plugin.settings.apiKey;
                        }
                        this.plugin.settings.apiEndpoint = customMatch.endpoint;
                        this.plugin.settings.availableModels = [...customMatch.models];
                        this.plugin.settings.defaultModel = customMatch.models[0];
                        this.plugin.settings.flashModel = customMatch.models[0];
                        this.plugin.settings.proModel = customMatch.models[1] || customMatch.models[0];
                        this.plugin.settings.maxContext = customMatch.maxContext;
                        this.plugin.settings.maxOutput = customMatch.maxOutput;
                        this.plugin.settings.apiKey = this.plugin.settings.providerKeys[value] || '';
                        await this.plugin.saveSettings();
                        this.plugin.updateStatusBarText();
                        this.display();
                        return;
                    }
                    // 切换到预设提供商
                    const preset = PROVIDERS[value];
                    if (preset && this.plugin.switchProviderByEndpoint(preset.endpoint)) {
                        await this.plugin.saveSettings();
                        this.plugin.updateStatusBarText();
                        this.display();
                    }
                });
            });

        // === v3.5.0: 自定义提供商管理（选中自定义时显示编辑/删除）===
        const activeCustom = currentProviderId ? (this.plugin.settings.customProviders || []).find(c => c.id === currentProviderId) : null;
        if (isCustom || activeCustom) {
            if (activeCustom) {
                // 已有自定义提供商 → 显示摘要 + 管理按钮
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
                    if (!confirm(`确定要删除自定义提供商 "${activeCustom.name}" 吗？`)) return;
                    this.plugin.deleteCustomProvider(activeCustom.id);
                    await this.plugin.saveSettings();
                    this.plugin.updateStatusBarText();
                    this.display();
                    new Notice(`已删除 "${activeCustom.name}"`);
                };
            } else {
                // 遗留模式或有端点但未保存为自定义 → 提示迁移
                section.createDiv({ attr: { style: 'padding:8px 12px;margin:8px 0;background:var(--background-modifier-warning);border-radius:6px;font-size:12px;' } })
                    .createEl('span', { text: '⚠️ 当前使用未保存的自定义配置。建议点击"➕ 添加自定义提供商..."保存。' });
            }
        }

        // === API 密钥（仅显示当前提供商的）===
        const providerLabel = isCustom
            ? (this.plugin.settings.customProviderName || '自定义')
            : (currentProviderId ? PROVIDERS[currentProviderId]?.name || currentProviderId : 'API');
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
                // 添加显示/隐藏切换按钮
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

        // === 模型管理（可增删）===
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

        // P0-15: 内联输入框（替代 prompt()，Obsidian 中 prompt 可能静默返回 null）
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
            this.plugin.settings.availableModels.forEach((model, idx) => {
                const chip = modelListEl.createDiv({ attr: { style: 'display:inline-flex;align-items:center;gap:2px;padding:2px 6px;background:var(--background-modifier-hover);border-radius:3px;font-size:12px;' } });
                chip.createSpan({ text: model });
                const delBtn = chip.createEl('button', { text: '✕', attr: { type: 'button', title: '删除此模型' } });
                delBtn.style.cssText = 'border:none;background:none;cursor:pointer;font-size:10px;padding:0 2px;color:var(--text-muted);';
                delBtn.addEventListener('click', async () => {
                    this.plugin.settings.availableModels.splice(idx, 1);
                    if (this.plugin.settings.availableModels.length === 0) {
                        this.plugin.settings.availableModels = ['default-model'];
                    }
                    // 修正已选的模型引用
                    if (!this.plugin.settings.availableModels.includes(this.plugin.settings.defaultModel)) {
                        this.plugin.settings.defaultModel = this.plugin.settings.availableModels[0];
                    }
                    if (!this.plugin.settings.availableModels.includes(this.plugin.settings.flashModel)) {
                        this.plugin.settings.flashModel = this.plugin.settings.availableModels[0];
                    }
                    if (!this.plugin.settings.availableModels.includes(this.plugin.settings.proModel)) {
                        this.plugin.settings.proModel = this.plugin.settings.availableModels[0];
                    }
                    // v6.0: 同步更新当前自定义提供商的 models（持久化）
                    const currProviderId = this.plugin.getCurrentProviderId();
                    const customProviders = this.plugin.settings.customProviders || [];
                    if (currProviderId && customProviders.find(c => c.id === currProviderId)) {
                        const cp = customProviders.find(c => c.id === currProviderId)!;
                        cp.models = [...this.plugin.settings.availableModels];
                    }
                    await this.plugin.saveSettings();
                    dirtyState.models = true;
                    renderModelChips();
                    // 同时更新页面上的模型下拉框
                    this.display();
                });
                // divider between chips but not last
            });
        };
        renderModelChips();

        addModelBtn.addEventListener('click', () => {
            // P0-15: 直接聚焦内联输入框，避免 Obsidian 中 prompt() 静默失败
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
            // v6.0: 同步更新当前自定义提供商的 models（持久化，重启不丢失）
            const currProviderId = this.plugin.getCurrentProviderId();
            const customProviders = this.plugin.settings.customProviders || [];
            if (currProviderId && customProviders.find(c => c.id === currProviderId)) {
                const cp = customProviders.find(c => c.id === currProviderId)!;
                cp.models = [...this.plugin.settings.availableModels];
            }
            await this.plugin.saveSettings();
            dirtyState.models = true;
            modelInput.value = '';
            new Notice(`✅ 已添加模型：${modelName}`);
            renderModelChips();
            this.display();
        };

        confirmBtn.addEventListener('click', handleAddModel);
        modelInput.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleAddModel();
            }
        });

        // === 模型选择下拉框 ===
        new Setting(section)
            .setName('默认模型')
            .setDesc('默认使用的 AI 模型')
            .addDropdown(dropdown => {
                this.plugin.settings.availableModels.forEach(model => {
                    dropdown.addOption(model, model);
                });
                dropdown.setValue(this.plugin.settings.defaultModel);
                dropdown.onChange(async (value) => {
                    this.plugin.settings.defaultModel = value;
                    this.plugin.updateModelLimitsFromModel(value);
                    await this.plugin.saveSettings();
                    this.display(); // 刷新上下文/输出字段
                });
            });

        new Setting(section)
            .setName('Flash 模型（大纲/分析/规划）')
            .setDesc('大纲骨架、分析报告、元素提取、规划类任务使用')
            .addDropdown(dropdown => {
                this.plugin.settings.availableModels.forEach(model => {
                    dropdown.addOption(model, model);
                });
                dropdown.setValue(this.plugin.settings.flashModel);
                dropdown.onChange(async (value) => {
                    this.plugin.settings.flashModel = value;
                    this.plugin.updateModelLimitsFromModel(value);
                    await this.plugin.saveSettings();
                    this.display();
                });
            });

        new Setting(section)
            .setName('Pro 模型（正文/角色/实体）')
            .setDesc('正文创作、角色生成、势力/地点/物品设定任务使用')
            .addDropdown(dropdown => {
                this.plugin.settings.availableModels.forEach(model => {
                    dropdown.addOption(model, model);
                });
                dropdown.setValue(this.plugin.settings.proModel);
                dropdown.onChange(async (value) => {
                    this.plugin.settings.proModel = value;
                    this.plugin.updateModelLimitsFromModel(value);
                    await this.plugin.saveSettings();
                    this.display();
                });
            });

        // === v6.5: 协同写作本地模型（强制本地，不回退远程） ===
        containerEl.createEl('h3', { text: '🖥 协同写作本地模型' });
        containerEl.createEl('p', {
            text: '协同写作仅使用本地模型（Ollama），不回退到远程 API。请确保 Ollama 服务已启动。',
            cls: 'setting-item-description'
        });

        new Setting(containerEl)
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

        new Setting(containerEl)
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

        new Setting(containerEl)
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

        // === 上下文与输出 ===
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
                    // 刷新描述
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

        // === 查看修改历史 ===
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

        // === 💾 显式保存按钮 ===
        const saveBtnContainer = section.createDiv({ attr: { style: 'margin-top:16px;display:flex;gap:8px;' } });
        const saveBtn = saveBtnContainer.createEl('button', {
            text: '💾 保存设置',
            attr: { type: 'button' }
        });
        saveBtn.style.cssText = 'padding:8px 20px;cursor:pointer;background:var(--interactive-accent);color:var(--text-on-accent);border:none;border-radius:6px;font-size:13px;font-weight:600;';
        saveBtn.addEventListener('click', async () => {
            // 保存当前提供商的密钥
            if (currentProviderId) {
                this.plugin.settings.providerKeys[currentProviderId] = this.plugin.settings.apiKey;
            }
            // v6.0: 如果当前是自定义端点但未注册为自定义提供商，自动注册
            // 这样下拉菜单里才会显示，重启也不会丢失
            const endpoint = this.plugin.settings.apiEndpoint;
            const isPresetEndpoint = Object.values(PROVIDERS).some(p => p.endpoint === endpoint);
            const customProviders = this.plugin.settings.customProviders || [];
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
            // v6.0: 如果是已注册的自定义提供商，同步更新 models（用户可能增删了模型）
            if (currentProviderId && customProviders.find(c => c.id === currentProviderId)) {
                const cp = customProviders.find(c => c.id === currentProviderId)!;
                cp.models = [...this.plugin.settings.availableModels];
                cp.maxContext = this.plugin.settings.maxContext || cp.maxContext;
                cp.maxOutput = this.plugin.settings.maxOutput || cp.maxOutput;
            }
            await this.plugin.saveSettings();
            this.plugin.updateStatusBarText();
            new Notice('✅ API 设置已保存');
            // 刷新页面以更新下拉菜单
            this.display();
        });

        const resetBtn = saveBtnContainer.createEl('button', {
            text: '🔄 重置',
            attr: { type: 'button' }
        });
        resetBtn.style.cssText = 'padding:8px 16px;cursor:pointer;background:var(--background-modifier-border);color:var(--text-normal);border:none;border-radius:6px;font-size:13px;';
        resetBtn.addEventListener('click', () => {
            this.display();
        });
    }

    private renderWritingSection(containerEl: HTMLElement): void {
        const section = containerEl.createEl('section');

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

        // P0-13: 断联自动切换模型开关
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

    private renderForeshadowSection(containerEl: HTMLElement): void {
        const section = containerEl.createEl('section');
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
    }

    private async renderTemplateSection(containerEl: HTMLElement): Promise<void> {
        const section = containerEl.createEl('section');
        const templateManager = new TemplateManager(this.app);
        await templateManager.renderTemplateList(section);
    }

    private renderAppearanceSection(containerEl: HTMLElement): void {
        const section = containerEl.createEl('section');
        // 外观控件统一由 appearance-settings.ts 渲染（完整版），消除两层重复实现
        renderAppearanceSettings(section, this.plugin, {
            compact: false,
            rerender: () => this.display(),
        });
    }

    private renderWorkspaceLayoutSection(containerEl: HTMLElement): void {
        const section = containerEl.createEl('section');
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
                    this.display();
                    new Notice('✅ 已清除浮窗布局记忆');
                }));
    }
    /** v3.5.0: 编辑已有自定义提供商 */
    private showEditCustomProviderForm(cp: { id: string; name: string; endpoint: string; models: string[]; maxContext: number; maxOutput: number }): void {
        const plugin = this.plugin;
        const onSaved = () => this.display();
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
        this.display();
        new Notice('✅ 设置已重置', 3000);
    }

    /** v6.0: 打开统一的提供商管理弹窗 */
    private showManageProvidersModal(): void {
        new ManageProvidersModal(this.app, this.plugin, () => this.display()).open();
    }

    /** v3.5.0: 弹出添加自定义API提供商的表单弹窗 */
    private showAddCustomProviderForm(_section: HTMLElement): void {
        const plugin = this.plugin;
        const onSaved = () => this.display();
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
}


