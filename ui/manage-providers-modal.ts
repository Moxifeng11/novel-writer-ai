import { App, Modal, Notice, Setting } from 'obsidian';
import { PROVIDERS, CustomProvider } from '../main';

interface ManageProvidersPlugin {
    settings: any;
    getAllProviders(): any[];
    getCurrentProviderId(): string | null;
    switchProviderByEndpoint(endpoint: string): boolean;
    addCustomProvider(name: string, endpoint: string, models: string[], maxContext: number, maxOutput: number, apiKey: string): string | null;
    deleteCustomProvider(id: string): boolean;
    hidePreset(presetId: string): boolean;
    restorePreset(presetId: string): boolean;
    restoreAllPresets(): void;
    savePresetOverride(presetId: string, name: string, endpoint: string, models: string[], maxContext: number, maxOutput: number): boolean;
    saveSettings(): Promise<void>;
    updateStatusBarText(): void;
}

/** v6.0: 统一的提供商管理弹窗（预设 + 自定义）
 *  迷你设置和完整设置页共用，保证功能和 UI 一致
 */
export class ManageProvidersModal extends Modal {
    private plugin: ManageProvidersPlugin;
    private onChanged: () => void;
    private showHidden: boolean = false;

    constructor(app: App, plugin: ManageProvidersPlugin, onChanged: () => void) {
        super(app);
        this.plugin = plugin;
        this.onChanged = onChanged;
    }

    onOpen() {
    this.modalEl.addClass('nw-scope'); this.render(); }

    private render() {
        const { contentEl } = this;
        contentEl.empty();

        const header = contentEl.createDiv({ attr: { style: 'display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;' } });
        header.createEl('h3', { text: '🔧 管理 API 提供商', attr: { style: 'margin:0;' } });

        const headerRight = header.createDiv({ attr: { style: 'display:flex;gap:6px;align-items:center;' } });

        const restoreBtn = headerRight.createEl('button', {
            text: '🔄 恢复默认预设',
            attr: { type: 'button', style: 'padding:6px 12px;cursor:pointer;border:1px solid var(--background-modifier-border);border-radius:4px;font-size:12px;background:var(--background-modifier-hover);' }
        });
        restoreBtn.onclick = async () => {
            if (!confirm('确定要恢复所有默认预设吗？被隐藏的预设会重新显示。')) return;
            this.plugin.restoreAllPresets();
            await this.plugin.saveSettings();
            new Notice('✅ 已恢复所有默认预设');
            this.render();
            this.onChanged();
        };

        const toggleHiddenBtn = headerRight.createEl('button', {
            text: this.showHidden ? '🙈 隐藏已删除' : '👁 显示已删除',
            attr: { type: 'button', style: 'padding:6px 12px;cursor:pointer;border:1px solid var(--background-modifier-border);border-radius:4px;font-size:12px;background:var(--background-modifier-hover);' }
        });
        toggleHiddenBtn.onclick = () => {
            this.showHidden = !this.showHidden;
            this.render();
        };

        const addBtn = headerRight.createEl('button', {
            text: '➕ 添加',
            attr: { type: 'button', style: 'padding:6px 14px;cursor:pointer;background:var(--interactive-accent);color:var(--text-on-accent);border:none;border-radius:4px;font-size:12px;' }
        });
        addBtn.onclick = () => { this.close(); this.showAddModal(); };

        const allProviders = this.plugin.getAllProviders();
        const currentId = this.plugin.getCurrentProviderId();
        const hiddenPresets = this.plugin.settings.hiddenPresets || [];

        let displayProviders = [...allProviders];

        if (this.showHidden && hiddenPresets.length > 0) {
            for (const pid of hiddenPresets) {
                if (PROVIDERS[pid] && !displayProviders.find(p => p.id === pid)) {
                    displayProviders.push({ ...PROVIDERS[pid], id: pid, isPreset: true, isHidden: true });
                }
            }
        }

        if (displayProviders.length === 0) {
            contentEl.createDiv({
                attr: { style: 'padding:40px;text-align:center;color:var(--text-faint);font-size:13px;' },
                text: '还没有提供商，点击右上角「➕ 添加」创建第一个。'
            });
            return;
        }

        displayProviders.sort((a, b) => {
            if (a.id === currentId) return -1;
            if (b.id === currentId) return 1;
            if (a.isPreset && !b.isPreset) return -1;
            if (!a.isPreset && b.isPreset) return 1;
            return a.name.localeCompare(b.name);
        });

        const listEl = contentEl.createDiv({ attr: { style: 'display:flex;flex-direction:column;gap:8px;max-height:60vh;overflow-y:auto;' } });
        displayProviders.forEach(p => {
            const isActive = p.id === currentId;
            const isHidden = p.isHidden === true;
            const item = listEl.createDiv({
                attr: {
                    style: `padding:12px;border:1px solid ${isActive ? 'var(--interactive-accent)' : 'var(--background-modifier-border)'};border-radius:6px;display:flex;align-items:center;justify-content:space-between;gap:12px;${isActive ? 'background:var(--background-modifier-hover);' : ''}${isHidden ? 'opacity:0.5;' : ''}`
                }
            });
            const info = item.createDiv({ attr: { style: 'flex:1;min-width:0;' } });
            const nameRow = info.createDiv({ attr: { style: 'display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap;' } });
            nameRow.createEl('span', { text: `${p.isPreset ? '📦' : '🔧'} ${p.name}`, attr: { style: 'font-weight:600;font-size:14px;' } });
            if (isActive) {
                nameRow.createEl('span', { text: '● 当前使用', attr: { style: 'font-size:11px;color:var(--interactive-accent);' } });
            }
            if (p.isPreset) {
                nameRow.createEl('span', { text: '系统预设', attr: { style: 'font-size:10px;padding:1px 6px;background:var(--background-modifier-hover);border-radius:3px;color:var(--text-muted);' } });
            }
            if (isHidden) {
                nameRow.createEl('span', { text: '已删除', attr: { style: 'font-size:10px;padding:1px 6px;background:var(--background-modifier-error);border-radius:3px;color:var(--text-error);' } });
            }
            info.createEl('div', { text: p.endpoint, attr: { style: 'font-size:12px;color:var(--text-muted);word-break:break-all;margin-bottom:4px;' } });
            info.createEl('div', { text: `模型: ${p.models.join(', ')}`, attr: { style: 'font-size:11px;color:var(--text-faint);' } });

            const actions = item.createDiv({ attr: { style: 'display:flex;gap:6px;flex-shrink:0;' } });
            if (isHidden) {
                const restoreBtnItem = actions.createEl('button', {
                    text: '↩️ 恢复',
                    attr: { type: 'button', style: 'padding:4px 10px;cursor:pointer;border:1px solid var(--interactive-accent);border-radius:4px;font-size:11px;color:var(--interactive-accent);background:transparent;' }
                });
                restoreBtnItem.onclick = async () => {
                    this.plugin.restorePreset(p.id);
                    await this.plugin.saveSettings();
                    new Notice(`✅ 已恢复 "${p.name}"`);
                    this.render();
                    this.onChanged();
                };
            } else {
                if (!isActive) {
                    const switchBtn = actions.createEl('button', {
                        text: '切换',
                        attr: { type: 'button', style: 'padding:4px 10px;cursor:pointer;border:1px solid var(--background-modifier-border);border-radius:4px;font-size:11px;' }
                    });
                    switchBtn.onclick = async () => {
                        this.plugin.switchProviderByEndpoint(p.endpoint);
                        await this.plugin.saveSettings();
                        this.plugin.updateStatusBarText();
                        new Notice(`✅ 已切换到 "${p.name}"`);
                        this.render();
                        this.onChanged();
                    };
                }
                const editBtn = actions.createEl('button', {
                    text: '✏️ 编辑',
                    attr: { type: 'button', style: 'padding:4px 10px;cursor:pointer;border:1px solid var(--background-modifier-border);border-radius:4px;font-size:11px;' }
                });
                editBtn.onclick = () => { this.close(); setTimeout(() => this.showEditModal(p), 100); };

                const delBtn = actions.createEl('button', {
                    text: p.isPreset ? '🗑 隐藏' : '🗑 删除',
                    attr: { type: 'button', style: 'padding:4px 10px;cursor:pointer;border:1px solid var(--background-modifier-border);border-radius:4px;font-size:11px;color:var(--text-error);' }
                });
                delBtn.onclick = async () => {
                    if (p.isPreset) {
                        if (!confirm(`确定要隐藏系统预设 "${p.name}" 吗？可以在「显示已删除」中恢复。`)) return;
                        this.plugin.hidePreset(p.id);
                        await this.plugin.saveSettings();
                        new Notice(`已隐藏 "${p.name}"`);
                    } else {
                        if (!confirm(`确定要删除自定义提供商 "${p.name}" 吗？`)) return;
                        this.plugin.deleteCustomProvider(p.id);
                        await this.plugin.saveSettings();
                        new Notice(`已删除 "${p.name}"`);
                    }
                    this.plugin.updateStatusBarText();
                    this.render();
                    this.onChanged();
                };
            }
        });
    }

    private showAddModal() {
        const plugin = this.plugin;
        const onChanged = this.onChanged;
        const modal = new (class extends Modal {
            onChanged: () => void;
            plugin: ManageProvidersPlugin;
            constructor(app: App, plugin: ManageProvidersPlugin, onChanged: () => void) { super(app); this.plugin = plugin; this.onChanged = onChanged; }
            onOpen() {
    this.modalEl.addClass('nw-scope');
                this.contentEl.empty();
                this.contentEl.createEl('h3', { text: '➕ 添加自定义 API 提供商' });
                const formDiv = this.contentEl.createDiv({ attr: { style: 'margin-top:16px;' } });
                let nameV = '', endpointV = '', modelsStr = '';
                let maxCtxV = 128000, maxOutV = 32768, apiKeyV = '';
                new Setting(formDiv).setName('提供商名称').setDesc('用于下拉列表和状态栏显示').addText(t => t.setPlaceholder('例如：我的私有代理').onChange(v => nameV = v));
                new Setting(formDiv).setName('API 端点').setDesc('OpenAI 兼容 API 的基础 URL').addText(t => t.setPlaceholder('https://api.example.com/v1/chat/completions').onChange(v => endpointV = v.trim()));
                new Setting(formDiv).setName('模型列表').setDesc('逗号分隔，第一个为默认模型').addText(t => t.setPlaceholder('model-a, model-b').onChange(v => modelsStr = v));
                new Setting(formDiv).setName('上下文上限 (tokens)').addText(t => t.setValue('128000').onChange(v => maxCtxV = parseInt(v) || 128000));
                new Setting(formDiv).setName('输出上限 (tokens)').addText(t => t.setValue('32768').onChange(v => maxOutV = parseInt(v) || 32768));
                new Setting(formDiv).setName('API 密钥').addText(t => { t.inputEl.type = 'password'; t.setPlaceholder('sk-...').onChange(v => apiKeyV = v); });
                const btnRow = this.contentEl.createDiv({ attr: { style: 'display:flex;gap:8px;margin-top:16px;justify-content:flex-end;' } });
                btnRow.createEl('button', { text: '取消', attr: { style: 'padding:6px 16px;' } }).onclick = () => this.close();
                const saveBtn = btnRow.createEl('button', { text: '✅ 添加并切换', attr: { style: 'padding:6px 16px;background:var(--interactive-accent);color:var(--text-on-accent);border:none;border-radius:4px;cursor:pointer;' } });
                saveBtn.onclick = async () => {
                    if (!nameV.trim()) { new Notice('❌ 请输入提供商名称'); return; }
                    if (!endpointV.trim()) { new Notice('❌ 请输入 API 端点'); return; }
                    const models = modelsStr.split(/[,，]/).map((m: string) => m.trim()).filter((m: string) => m);
                    if (models.length === 0) { new Notice('❌ 请至少输入一个模型名'); return; }
                    const result = plugin.addCustomProvider(nameV.trim(), endpointV.trim(), models, maxCtxV, maxOutV, apiKeyV);
                    if (result === null) return;
                    await plugin.saveSettings();
                    plugin.updateStatusBarText();
                    this.close();
                    new Notice(`✅ 已添加并切换到 "${nameV.trim()}"`, 3000);
                    this.onChanged();
                };
            }
            onClose() { this.contentEl.empty(); }
        })(this.app, this.plugin, this.onChanged);
        modal.open();
    }

    private showEditModal(p: any) {
        const plugin = this.plugin;
        const onChanged = this.onChanged;
        const modal = new (class extends Modal {
            p: any;
            onChanged: () => void;
            plugin: ManageProvidersPlugin;
            constructor(app: App, plugin: ManageProvidersPlugin, p: any, onChanged: () => void) { super(app); this.plugin = plugin; this.p = p; this.onChanged = onChanged; }
            onOpen() {
    this.modalEl.addClass('nw-scope');
                this.contentEl.empty();
                this.contentEl.createEl('h3', { text: `✏️ 编辑 "${this.p.name}"` });
                if (this.p.isPreset) {
                    this.contentEl.createDiv({ attr: { style: 'margin:8px 0;padding:8px 12px;background:var(--background-modifier-hover);border-radius:6px;font-size:12px;color:var(--text-muted);' } })
                        .createSpan({ text: '💡 编辑系统预设后，会保存为自定义版本。原始预设可通过「恢复默认预设」找回。' });
                }
                const formDiv = this.contentEl.createDiv({ attr: { style: 'margin-top:16px;' } });
                let nameV = this.p.name;
                let endpointV = this.p.endpoint;
                let modelsStr = this.p.models.join(', ');
                let maxCtxV = this.p.maxContext;
                let maxOutV = this.p.maxOutput;
                let apiKeyV = this.plugin.settings.providerKeys[this.p.id] || '';
                new Setting(formDiv).setName('提供商名称').addText(t => t.setValue(nameV).onChange(v => nameV = v));
                new Setting(formDiv).setName('API 端点').addText(t => t.setValue(endpointV).onChange(v => endpointV = v.trim()));
                new Setting(formDiv).setName('模型列表').addText(t => t.setValue(modelsStr).onChange(v => modelsStr = v));
                new Setting(formDiv).setName('上下文上限').addText(t => t.setValue(String(maxCtxV)).onChange(v => maxCtxV = parseInt(v) || 128000));
                new Setting(formDiv).setName('输出上限').addText(t => t.setValue(String(maxOutV)).onChange(v => maxOutV = parseInt(v) || 32768));
                new Setting(formDiv).setName('API 密钥').addText(t => { t.inputEl.type = 'password'; t.setValue(apiKeyV).onChange(v => apiKeyV = v); });
                const btnRow = this.contentEl.createDiv({ attr: { style: 'display:flex;gap:8px;margin-top:16px;justify-content:flex-end;' } });
                btnRow.createEl('button', { text: '取消', attr: { style: 'padding:6px 16px;' } }).onclick = () => this.close();
                const saveBtn = btnRow.createEl('button', { text: '💾 保存', attr: { style: 'padding:6px 16px;background:var(--interactive-accent);color:var(--text-on-accent);border:none;border-radius:4px;cursor:pointer;' } });
                saveBtn.onclick = async () => {
                    if (!nameV.trim() || !endpointV.trim()) { new Notice('名称和端点不能为空'); return; }
                    const models = modelsStr.split(/[,，]/).map((m: string) => m.trim()).filter((m: string) => m);
                    if (models.length === 0) { new Notice('请至少输入一个模型名'); return; }
                    if (this.p.isPreset) {
                        this.plugin.savePresetOverride(this.p.id, nameV.trim(), endpointV.trim(), models, maxCtxV, maxOutV);
                    } else {
                        const idx = this.plugin.settings.customProviders.findIndex((c: CustomProvider) => c.id === this.p.id);
                        if (idx >= 0) {
                            this.plugin.settings.customProviders[idx] = { id: this.p.id, name: nameV.trim(), endpoint: endpointV.trim(), models, maxContext: maxCtxV, maxOutput: maxOutV };
                        }
                    }
                    this.plugin.settings.providerKeys[this.p.id] = apiKeyV;
                    const currId = this.plugin.getCurrentProviderId();
                    if (currId === this.p.id) {
                        this.plugin.settings.availableModels = [...models];
                        this.plugin.settings.maxContext = maxCtxV;
                        this.plugin.settings.maxOutput = maxOutV;
                        this.plugin.settings.customProviderName = nameV.trim();
                    }
                    await this.plugin.saveSettings();
                    this.plugin.updateStatusBarText();
                    this.close();
                    new Notice(`✅ 已更新 "${nameV.trim()}"`);
                    this.onChanged();
                };
            }
            onClose() { this.contentEl.empty(); }
        })(this.app, this.plugin, p, this.onChanged);
        modal.open();
    }

    onClose() { this.contentEl.empty(); }
}
