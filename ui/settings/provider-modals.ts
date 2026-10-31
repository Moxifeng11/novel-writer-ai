/**
 * provider-modals.ts — 自定义供应商弹窗分区
 *
 * 职责：自定义供应商的编辑 / 删除（管理列表）/ 添加弹窗。
 * 来源：原 settings-tab.ts L3720-L4046（不含 L3864-L3870 的 resetSettings）。
 * 依赖：宿主提供的 app/plugin/refresh（见 section-base.ts）、ManageProvidersModal、
 * 端点识别 detectProviderFromEndpoint。
 */
import { App, Setting, Notice, Modal } from 'obsidian';
import NovelWriterPlugin, { CustomProvider } from '../../main';
import { ManageProvidersModal } from '../manage-providers-modal';
import { detectProviderFromEndpoint } from '../../shared/provider-detection';
import { SettingsSection } from './section-base';

export class ProviderModalsSection extends SettingsSection {
    private showEditCustomProviderForm(cp: { id: string; name: string; endpoint: string; models: string[]; maxContext: number; maxOutput: number }): void {
        const plugin = this.plugin;
        const onSaved = () => this.refresh();
        class EditCustomProviderModal extends Modal {
            plugin: NovelWriterPlugin; cp: CustomProvider; onSaved: () => void;
            constructor(app: App, plugin: NovelWriterPlugin, cp: CustomProvider, onSaved: () => void) { super(app); this.plugin = plugin; this.cp = cp; this.onSaved = onSaved; }
            onOpen() {
    this.modalEl.addClass('nw-scope');
                const { contentEl } = this;
                contentEl.empty();
                contentEl.createEl('h3', { text: `✏️ 编辑 "${this.cp.name}"` });
                const formDiv = contentEl.createDiv({ cls: 'nw-u-margintop-16px-2' });
                let nameV = this.cp.name;
                let endpointV = this.cp.endpoint;
                let modelsStr = this.cp.models.join(', ');
                let maxCtxV = this.cp.maxContext;
                let maxOutV = this.cp.maxOutput;
                let apiKeyV = this.plugin.settings.providerKeys[this.cp.id] || '';
                let sourceTypeV = this.cp.sourceType;
                let apiStyleV = this.cp.apiStyle;
                let providerIdHintV = this.cp.providerIdHint || '';
                let manualOverride = false;
                let endpointText: any = null;
                let nameText: any = null;
                let modelsText: any = null;
                let maxCtxText: any = null;
                let maxOutText: any = null;

                new Setting(formDiv).setName('提供商名称').addText(t => {
                    nameText = t;
                    t.setValue(nameV).onChange(v => nameV = v);
                });
                const endpointSetting = new Setting(formDiv).setName('API 端点').addText(t => {
                    endpointText = t;
                    t.setValue(endpointV).onChange(v => endpointV = v.trim());
                });
                const detectionEl = formDiv.createDiv({
                    cls: 'nw-u-fs-12px-2 nw-u-c-text-muted-2 nw-u-margintop-4px-2',
                });
                const applyDetection = (force = false) => {
                    const d = detectProviderFromEndpoint(endpointV);
                    detectionEl.empty();
                    if (!d.valid) {
                        detectionEl.setText(`⚠️ ${d.warning || '无法识别端点'}`);
                        return;
                    }
                    const sourceLabel = d.sourceType === 'local' ? '本地' : '云端';
                    const styleLabel = d.apiStyle === 'ollama' ? 'Ollama 原生' : d.apiStyle === 'openai' ? 'OpenAI 兼容' : '自定义';
                    detectionEl.setText(`识别为：${d.name} · ${sourceLabel} · ${styleLabel}${d.warning ? ` · ${d.warning}` : ''}`);
                    if (manualOverride && !force) return;

                    endpointV = d.normalizedEndpoint;
                    endpointText?.setValue(endpointV);
                    sourceTypeV = d.sourceType;
                    apiStyleV = d.apiStyle;
                    providerIdHintV = d.providerId || '';
                    if (!nameV.trim() && d.name) {
                        nameV = d.name;
                        nameText?.setValue(nameV);
                    }
                    if (!modelsStr.trim() && d.providerId) {
                        const preset = this.plugin.getAllProviders().find(p => p.id === d.providerId);
                        if (preset?.models?.length) {
                            modelsStr = preset.models.join(', ');
                            modelsText?.setValue(modelsStr);
                        }
                    }
                    if (d.providerId) {
                        const preset = this.plugin.getAllProviders().find(p => p.id === d.providerId);
                        if (preset) {
                            maxCtxV = preset.maxContext;
                            maxOutV = preset.maxOutput;
                            maxCtxText?.setValue(String(maxCtxV));
                            maxOutText?.setValue(String(maxOutV));
                        }
                    }
                };
                endpointSetting.addButton(btn => btn
                    .setButtonText('识别')
                    .setTooltip('根据 URL 自动识别供应商与协议')
                    .onClick(() => applyDetection(true)));
                endpointSetting.settingEl.addClass('nw-provider-endpoint-setting');
                // 失焦时只展示识别结果；用户点“识别”才强制应用，避免覆盖手填配置
                const endpointInput = endpointSetting.settingEl.querySelector('input');
                endpointInput?.addEventListener('blur', () => applyDetection(false));

                new Setting(formDiv).setName('模型列表').addText(t => {
                    modelsText = t;
                    t.setValue(modelsStr).onChange(v => modelsStr = v);
                });
                new Setting(formDiv).setName('上下文上限').addText(t => {
                    maxCtxText = t;
                    t.setValue(String(maxCtxV)).onChange(v => maxCtxV = parseInt(v) || 128000);
                });
                new Setting(formDiv).setName('输出上限').addText(t => {
                    maxOutText = t;
                    t.setValue(String(maxOutV)).onChange(v => maxOutV = parseInt(v) || 32768);
                });
                new Setting(formDiv).setName('API 密钥').addText(t => { t.inputEl.type = 'password'; t.setValue(apiKeyV).onChange(v => apiKeyV = v); });
                new Setting(formDiv)
                    .setName('手动指定')
                    .setDesc('开启后只显示识别结果，不自动覆盖名称/模型/上限；端点仍按手填值保存')
                    .addToggle(t => t.setValue(false).onChange(v => manualOverride = v));

                const btnRow = contentEl.createDiv({ cls: 'nw-u-d-flex-2 nw-u-gap-8px-2 nw-u-margintop-16px-2 nw-u-jc-flex-end-2' });
                btnRow.createEl('button', { text: '取消' }).onclick = () => this.close();
                btnRow.createEl('button', { text: '💾 保存', cls: 'nw-u-bg-interactive-accent-2 nw-u-c-text-on-accent-2 nw-u-b-none nw-u-brd-4px-2 nw-u-p-6px-16px nw-u-cur-pointer-2' }).onclick = async () => {
                    if (!nameV.trim() || !endpointV.trim()) { new Notice('名称和端点不能为空'); return; }
                    const models = modelsStr.split(/[,，]/).map((m: string) => m.trim()).filter((m: string) => m);
                    if (models.length === 0) { new Notice('请至少输入一个模型名'); return; }
                    const detection = detectProviderFromEndpoint(endpointV);
                    const finalEndpoint = !manualOverride && detection.valid ? detection.normalizedEndpoint : endpointV.trim();
                    const finalSourceType = !manualOverride && detection.valid ? detection.sourceType : sourceTypeV;
                    const finalApiStyle = !manualOverride && detection.valid ? detection.apiStyle : apiStyleV;
                    const finalProviderHint = !manualOverride && detection.valid
                        ? (detection.providerId || '')
                        : providerIdHintV;
                    const idx = this.plugin.settings.customProviders.findIndex((c: CustomProvider) => c.id === this.cp.id);
                    if (idx >= 0) {
                        this.plugin.settings.customProviders[idx] = {
                            id: this.cp.id,
                            name: nameV.trim(),
                            endpoint: finalEndpoint,
                            models,
                            maxContext: maxCtxV,
                            maxOutput: maxOutV,
                            sourceType: finalSourceType,
                            apiStyle: finalApiStyle,
                            providerIdHint: finalProviderHint || undefined,
                        };
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

    private showManageProvidersModal(): void {
        new ManageProvidersModal(this.app, this.plugin, () => this.refresh()).open();
    }

    private showAddCustomProviderForm(_section: HTMLElement): void {
        const plugin = this.plugin;
        const onSaved = () => this.refresh();
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

                const formDiv = contentEl.createDiv({ cls: 'nw-u-margintop-16px-2' });
                let nameValue = '';
                let endpointValue = '';
                let modelsStr = '';
                let maxCtxValue = 128000;
                let maxOutValue = 32768;
                let apiKeyValue = '';
                let sourceTypeValue: 'cloud' | 'local' | undefined;
                let apiStyleValue: 'openai' | 'ollama' | 'custom' | undefined;
                let providerIdHintValue = '';
                let manualOverride = false;
                let endpointText: any = null;
                let nameText: any = null;
                let modelsText: any = null;
                let maxCtxText: any = null;
                let maxOutText: any = null;

                new Setting(formDiv)
                    .setName('提供商名称')
                    .setDesc('用于下拉列表和状态栏显示')
                    .addText(text => {
                        nameText = text;
                        text.setPlaceholder('例如：我的私有代理').onChange(v => nameValue = v);
                    });

                const endpointSetting = new Setting(formDiv)
                    .setName('API 端点')
                    .setDesc('OpenAI 兼容 API 的完整 URL；也可只填 base URL')
                    .addText(text => {
                        endpointText = text;
                        text.setPlaceholder('https://api.example.com/v1/chat/completions').onChange(v => endpointValue = v.trim());
                    });
                const detectionEl = formDiv.createDiv({
                    cls: 'nw-u-fs-12px-2 nw-u-c-text-muted-2 nw-u-margintop-4px-2',
                });
                detectionEl.setText('填写端点后可点击「识别」自动判断供应商与协议');
                const applyDetection = (force = false) => {
                    const d = detectProviderFromEndpoint(endpointValue);
                    detectionEl.empty();
                    if (!d.valid) {
                        detectionEl.setText(`⚠️ ${d.warning || '无法识别端点'}`);
                        return;
                    }
                    const sourceLabel = d.sourceType === 'local' ? '本地' : '云端';
                    const styleLabel = d.apiStyle === 'ollama' ? 'Ollama 原生' : d.apiStyle === 'openai' ? 'OpenAI 兼容' : '自定义';
                    detectionEl.setText(`识别为：${d.name} · ${sourceLabel} · ${styleLabel}${d.warning ? ` · ${d.warning}` : ''}`);
                    if (manualOverride && !force) return;

                    endpointValue = d.normalizedEndpoint;
                    endpointText?.setValue(endpointValue);
                    sourceTypeValue = d.sourceType;
                    apiStyleValue = d.apiStyle;
                    providerIdHintValue = d.providerId || '';
                    if (!nameValue.trim() && d.name) {
                        nameValue = d.name;
                        nameText?.setValue(nameValue);
                    }
                    if (!modelsStr.trim() && d.providerId) {
                        const preset = this.plugin.getAllProviders().find(p => p.id === d.providerId);
                        if (preset?.models?.length) {
                            modelsStr = preset.models.join(', ');
                            modelsText?.setValue(modelsStr);
                        }
                    }
                    if (d.providerId) {
                        const preset = this.plugin.getAllProviders().find(p => p.id === d.providerId);
                        if (preset) {
                            maxCtxValue = preset.maxContext;
                            maxOutValue = preset.maxOutput;
                            maxCtxText?.setValue(String(maxCtxValue));
                            maxOutText?.setValue(String(maxOutValue));
                        }
                    }
                };
                endpointSetting.addButton(btn => btn
                    .setButtonText('识别')
                    .setTooltip('根据 URL 自动识别供应商与协议')
                    .onClick(() => applyDetection(true)));
                endpointSetting.settingEl.addClass('nw-provider-endpoint-setting');
                const endpointInput = endpointSetting.settingEl.querySelector('input');
                endpointInput?.addEventListener('blur', () => applyDetection(false));

                new Setting(formDiv)
                    .setName('模型列表')
                    .setDesc('逗号分隔，第一个为默认模型')
                    .addText(text => {
                        modelsText = text;
                        text.setPlaceholder('model-a, model-b').onChange(v => modelsStr = v);
                    });

                new Setting(formDiv)
                    .setName('上下文上限 (tokens)')
                    .addText(text => {
                        maxCtxText = text;
                        text.setValue('128000').onChange(v => maxCtxValue = parseInt(v) || 128000);
                    });

                new Setting(formDiv)
                    .setName('输出上限 (tokens)')
                    .addText(text => {
                        maxOutText = text;
                        text.setValue('32768').onChange(v => maxOutValue = parseInt(v) || 32768);
                    });

                new Setting(formDiv)
                    .setName('API 密钥')
                    .addText(text => { text.inputEl.type = 'password'; text.setPlaceholder('sk-...').onChange(v => apiKeyValue = v); });

                new Setting(formDiv)
                    .setName('手动指定')
                    .setDesc('开启后只显示识别结果，不自动覆盖名称/模型/上限；端点仍按手填值保存')
                    .addToggle(t => t.setValue(false).onChange(v => manualOverride = v));

                const btnRow = contentEl.createDiv({ cls: 'nw-u-d-flex-2 nw-u-gap-8px-2 nw-u-margintop-16px-2 nw-u-jc-flex-end-2' });
                btnRow.createEl('button', { text: '取消', cls: 'nw-u-p-6px-16px' }).onclick = () => this.close();
                const saveBtn = btnRow.createEl('button', {
                    text: '✅ 添加并切换',
                    cls: 'nw-u-p-6px-16px nw-u-bg-interactive-accent-2 nw-u-c-text-on-accent-2 nw-u-b-none nw-u-brd-4px-2 nw-u-cur-pointer-2'
                });
                saveBtn.onclick = async () => {
                    if (!nameValue.trim()) { new Notice('❌ 请输入提供商名称'); return; }
                    if (!endpointValue.trim()) { new Notice('❌ 请输入 API 端点'); return; }
                    const models = modelsStr.split(/[,，]/).map((m: string) => m.trim()).filter((m: string) => m);
                    if (models.length === 0) { new Notice('❌ 请至少输入一个模型名'); return; }

                    const detection = detectProviderFromEndpoint(endpointValue);
                    const finalEndpoint = !manualOverride && detection.valid ? detection.normalizedEndpoint : endpointValue.trim();
                    const id = this.plugin.addCustomProvider(
                        nameValue.trim(),
                        finalEndpoint,
                        models,
                        maxCtxValue,
                        maxOutValue,
                        apiKeyValue,
                    );
                    if (id) {
                        const created = this.plugin.settings.customProviders.find(c => c.id === id);
                        if (created) {
                            created.sourceType = sourceTypeValue || detection.sourceType;
                            created.apiStyle = apiStyleValue || detection.apiStyle;
                            created.providerIdHint = providerIdHintValue || detection.providerId || undefined;
                        }
                    }
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
