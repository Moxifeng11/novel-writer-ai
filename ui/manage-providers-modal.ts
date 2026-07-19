import { App, Modal, Notice, Setting } from 'obsidian';

interface ManageProvidersPlugin {
    settings: any;
    getAllProviders(): any[];
    getCurrentProviderId(): string | null;
    switchProviderByEndpoint(endpoint: string): boolean;
    addCustomProvider(name: string, endpoint: string, models: string[], maxContext: number, maxOutput: number, apiKey: string): string | null;
    deleteCustomProvider(id: string): boolean;
    setHidden(id: string, hidden: boolean): boolean;
    restoreDefaultProviders(): void;
    updateProvider(id: string, updates: any): boolean;
    saveSettings(): Promise<void>;
    updateStatusBarText(): void;
}

/** v6.0: 统一的提供商管理弹窗（预设 + 自定义）
 *  迷你设置和完整设置页共用，保证功能和 UI 一致
 */
export class ManageProvidersModal extends Modal {
    private plugin: ManageProvidersPlugin;
    private onChanged: () => void;

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
            text: '🔄 恢复默认供应商',
            attr: { type: 'button', style: 'padding:6px 12px;cursor:pointer;border:1px solid var(--background-modifier-border);border-radius:4px;font-size:12px;background:var(--background-modifier-hover);' }
        });
        restoreBtn.onclick = async () => {
            if (!confirm('确定要恢复默认供应商吗？已删除的默认供应商会重新加回来，已有的不会被覆盖。')) return;
            this.plugin.restoreDefaultProviders();
            await this.plugin.saveSettings();
            new Notice('✅ 已恢复默认供应商');
            this.render();
            this.onChanged();
        };

        const addBtn = headerRight.createEl('button', {
            text: '➕ 添加',
            attr: { type: 'button', style: 'padding:6px 14px;cursor:pointer;background:var(--interactive-accent);color:var(--text-on-accent);border:none;border-radius:4px;font-size:12px;' }
        });
        addBtn.onclick = () => { this.close(); this.showAddModal(); };

        const allProviders = this.plugin.getAllProviders();
        const currentId = this.plugin.getCurrentProviderId();

        if (allProviders.length === 0) {
            contentEl.createDiv({
                attr: { style: 'padding:40px;text-align:center;color:var(--text-faint);font-size:13px;' },
                text: '还没有提供商，点击右上角「➕ 添加」创建第一个。'
            });
            return;
        }

        const displayProviders = [...allProviders].sort((a, b) => {
            if (a.id === currentId) return -1;
            if (b.id === currentId) return 1;
            return a.name.localeCompare(b.name);
        });

        const listEl = contentEl.createDiv({ attr: { style: 'display:flex;flex-direction:column;gap:8px;max-height:60vh;overflow-y:auto;' } });
        displayProviders.forEach(p => {
            const isActive = p.id === currentId;
            const item = listEl.createDiv({
                attr: {
                    style: `padding:12px;border:1px solid ${isActive ? 'var(--interactive-accent)' : 'var(--background-modifier-border)'};border-radius:6px;display:flex;align-items:center;justify-content:space-between;gap:12px;${isActive ? 'background:var(--background-modifier-hover);' : ''}`
                }
            });
            const info = item.createDiv({ attr: { style: 'flex:1;min-width:0;' } });
            const nameRow = info.createDiv({ attr: { style: 'display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap;' } });
            nameRow.createEl('span', { text: `🔧 ${p.name}`, attr: { style: 'font-weight:600;font-size:14px;' } });
            if (isActive) {
                nameRow.createEl('span', { text: '● 当前使用', attr: { style: 'font-size:11px;color:var(--interactive-accent);' } });
            }
            info.createEl('div', { text: p.endpoint, attr: { style: 'font-size:12px;color:var(--text-muted);word-break:break-all;margin-bottom:4px;' } });
            info.createEl('div', { text: `模型: ${p.models.join(', ')}`, attr: { style: 'font-size:11px;color:var(--text-faint);' } });

            const actions = item.createDiv({ attr: { style: 'display:flex;gap:6px;flex-shrink:0;' } });
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
                text: '🗑 删除',
                attr: { type: 'button', style: 'padding:4px 10px;cursor:pointer;border:1px solid var(--background-modifier-border);border-radius:4px;font-size:11px;color:var(--text-error);' }
            });
            delBtn.onclick = async () => {
                if (!confirm(`确定要删除供应商 "${p.name}" 吗？可以在「恢复默认供应商」中找回默认供应商。`)) return;
                this.plugin.setHidden(p.id, true);
                await this.plugin.saveSettings();
                this.plugin.updateStatusBarText();
                new Notice(`已删除 "${p.name}"`);
                this.render();
                this.onChanged();
            };
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
                    this.plugin.updateProvider(this.p.id, {
                        name: nameV.trim(),
                        endpoint: endpointV.trim(),
                        models,
                        maxContext: maxCtxV,
                        maxOutput: maxOutV,
                    });
                    this.plugin.settings.providerKeys[this.p.id] = apiKeyV;
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
