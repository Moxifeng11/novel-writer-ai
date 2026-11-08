import { App, Menu, Modal, Notice, Setting } from 'obsidian';
import { OperationConfirmModal } from './components/progress';
import { API_FORMAT_OPTIONS, normalizeApiFormat, type ApiFormat } from '@/shared/api-format';
import { discoverModels } from '@/services/model-discovery';
import { ModelPickerModal } from './model-picker-modal';
import { describeSecretForInput, isStoredCiphertext } from '@/shared/secret-display';
import { lookupModelCapability } from '@/shared/model-capabilities';
import { showErrorNotice, showSuccessNotice } from './components/notice-helpers';
import type { CustomProvider, NovelWriterSettings } from '@/main';

/** 供应商列表的最小投影（对应 core/provider-manager.getAllProviders 返回结构的只读子集） */
interface ProviderSummary {
    id: string;
    name: string;
    endpoint: string;
    models: string[];
    maxContext: number;
    maxOutput: number;
    sourceType?: 'cloud' | 'local';
    apiFormat?: string;
    isDefault?: boolean;
    isHidden?: boolean;
}

interface ManageProvidersPlugin {
    settings: NovelWriterSettings;
    getAllProviders(): ProviderSummary[];
    getCurrentProviderId(): string | null;
    switchProviderByEndpoint(endpoint: string): boolean;
    addCustomProvider(name: string, endpoint: string, models: string[], maxContext: number, maxOutput: number, apiKey: string, apiFormat?: ApiFormat): string | null;
    deleteCustomProvider(id: string): boolean;
    setHidden(id: string, hidden: boolean): boolean;
    restoreDefaultProviders(): void;
    updateProvider(id: string, updates: Partial<CustomProvider>): boolean;
    saveSettings(): Promise<void>;
    updateStatusBarText(): void;
}

/**
 * 统一的提供商管理弹窗（预设 + 自定义）。
 *
 * 2026-10-29 重做为「左侧供应商列表 + 右侧详情」两栏，与设置页 API 区一致：
 * 输入框占满整行宽度（旧版一行只有 input，长 URL 显示不全）。
 * 迷你设置、模型弹层、设置页三处入口共用本弹窗，保证行为一致。
 */
export class ManageProvidersModal extends Modal {
    private plugin: ManageProvidersPlugin;
    private onChanged: () => void;
    private selectedId: string | null = null;

    constructor(app: App, plugin: ManageProvidersPlugin, onChanged: () => void) {
        super(app);
        this.plugin = plugin;
        this.onChanged = onChanged;
    }

    /**
     * onOpen 方法。
     */
    onOpen(): void {
        this.modalEl.addClass('nw-scope');
        this.render();
    }

    private getRawProvider(id: string): CustomProvider | undefined {
        return (this.plugin.settings.customProviders || []).find(p => p.id === id);
    }

    private formatCapacity(value: number | undefined): string {
        if (!value || value <= 0) return '';
        if (value >= 1_000_000) {
            const scaled = value / 1_000_000;
            return `${Number.isInteger(scaled) ? scaled : scaled.toFixed(1)}M`;
        }
        if (value >= 1000) return `${Math.round(value / 1000)}K`;
        return String(value);
    }

    private render(): void {
        const { contentEl } = this;
        contentEl.empty();

        const providers = this.plugin.getAllProviders();
        const currentId = this.plugin.getCurrentProviderId();
        const selected = this.selectedId && providers.some(p => p.id === this.selectedId)
            ? this.selectedId
            : (currentId && providers.some(p => p.id === currentId) ? currentId : (providers[0]?.id ?? ''));
        this.selectedId = selected || null;

        // 头部
        const header = contentEl.createDiv({ cls: 'nw-api-header' });
        const titleWrap = header.createDiv({ cls: 'nw-api-header-title' });
        titleWrap.createEl('h2', { text: '模型设置' });
        titleWrap.createEl('p', { text: '管理自定义模型供应商，配置后可在写作任务中选择使用。' });
        const actions = header.createDiv({ cls: 'nw-api-header-actions' });

        const restoreBtn = actions.createEl('button', {
            cls: 'nw-api-icon-btn',
            attr: { type: 'button', title: '恢复默认供应商', 'aria-label': '恢复默认供应商' },
        });
        restoreBtn.setText('🔄');
        restoreBtn.onclick = async () => {
            const confirmed = await OperationConfirmModal.confirm(this.app, {
                title: '恢复默认供应商',
                description: '确定要恢复默认供应商吗？已删除的默认供应商会重新加回来，已有的不会被覆盖。',
                confirmText: '确认恢复',
                cancelText: '取消',
            });
            if (!confirmed) return;
            this.plugin.restoreDefaultProviders();
            await this.plugin.saveSettings();
            showSuccessNotice('已恢复默认供应商');
            this.render();
            this.onChanged();
        };

        const addBtn = actions.createEl('button', {
            cls: 'nw-api-primary-btn',
            attr: { type: 'button' },
        });
        addBtn.setText('＋ 添加供应商');
        addBtn.onclick = () => this.openAddProvider();

        if (providers.length === 0) {
            contentEl.createDiv({
                cls: 'nw-api-empty',
                text: '还没有供应商。点击右上角「＋ 添加供应商」创建第一个。',
            });
            return;
        }

        // 两栏
        const layout = contentEl.createDiv({ cls: 'nw-api-layout' });
        const sidebar = layout.createDiv({ cls: 'nw-api-sidebar' });
        const groups = [
            { title: '预设供应商', items: providers.filter(p => p.isDefault) },
            { title: '自定义供应商', items: providers.filter(p => !p.isDefault) },
        ];
        for (const group of groups) {
            if (group.items.length === 0) continue;
            sidebar.createDiv({ cls: 'nw-api-sidebar-group', text: group.title });
            for (const provider of group.items) {
                const row = sidebar.createDiv({
                    cls: 'nw-api-sidebar-row' + (provider.id === selected ? ' nw-api-sidebar-row-selected' : ''),
                });
                row.createSpan({
                    cls: 'nw-api-sidebar-icon',
                    text: provider.sourceType === 'local' ? '💻' : '☁️',
                });
                row.createSpan({ cls: 'nw-api-sidebar-name', text: provider.name });
                row.createSpan({
                    cls: 'nw-api-sidebar-dot' + (provider.id === currentId ? ' nw-api-sidebar-dot-current' : ''),
                    attr: { title: provider.id === currentId ? '当前使用中' : '未启用' },
                });
                row.onclick = () => {
                    this.selectedId = provider.id;
                    this.render();
                };
            }
        }

        const detail = layout.createDiv({ cls: 'nw-api-detail' });
        if (selected) this.renderDetail(detail, selected);
    }

    private renderDetail(container: HTMLElement, providerId: string): void {
        const raw = this.getRawProvider(providerId);
        const provider = this.plugin.getAllProviders().find(p => p.id === providerId);
        if (!raw || !provider) {
            container.createDiv({ cls: 'nw-api-empty', text: '该供应商已不可用。' });
            return;
        }
        const format = normalizeApiFormat(raw.apiFormat);
        const rerender = () => this.render();

        // 标题行
        const head = container.createDiv({ cls: 'nw-api-provider-head' });
        head.createSpan({ cls: 'nw-api-provider-icon', text: '🗂' });
        const nameInput = head.createEl('input', {
            cls: 'nw-api-provider-name',
            type: 'text',
            value: raw.name,
            attr: { 'aria-label': '供应商名称' },
        });
        nameInput.addEventListener('change', async () => {
            const next = nameInput.value.trim();
            if (!next || next === raw.name) {
                nameInput.value = raw.name;
                return;
            }
            this.plugin.updateProvider(raw.id, { name: next });
            await this.plugin.saveSettings();
            rerender();
        });

        const isCurrent = providerId === this.plugin.getCurrentProviderId();
        const toggleLabel = head.createEl('label', { cls: 'nw-api-switch', attr: { title: '启用该供应商' } });
        const toggle = toggleLabel.createEl('input', { type: 'checkbox' });
        toggle.checked = isCurrent;
        toggleLabel.toggleClass('nw-is-active', toggle.checked);
        toggle.addEventListener('change', async () => {
            toggleLabel.toggleClass('nw-is-active', toggle.checked);
            if (!toggle.checked) {
                toggle.checked = true;
                new Notice('不能用开关停用当前正在使用的供应商，请改为切换到其他供应商', 5000);
                return;
            }
            this.plugin.switchProviderByEndpoint(raw.endpoint);
            await this.plugin.saveSettings();
            this.plugin.updateStatusBarText();
            showSuccessNotice(`已切换到「${raw.name}」`);
            this.onChanged();
            rerender();
        });

        const moreBtn = head.createEl('button', {
            cls: 'nw-api-icon-btn',
            attr: { type: 'button', title: '更多操作', 'aria-label': '更多操作' },
        });
        moreBtn.setText('⋯');
        moreBtn.onclick = (event) => {
            const menu = new Menu();
            menu.addItem(item => item.setTitle('切换到该供应商').setDisabled(isCurrent).onClick(async () => {
                this.plugin.switchProviderByEndpoint(raw.endpoint);
                await this.plugin.saveSettings();
                this.plugin.updateStatusBarText();
                this.onChanged();
                rerender();
            }));
            menu.addSeparator();
            menu.addItem(item => item.setTitle('删除供应商').onClick(async () => {
                const confirmed = await OperationConfirmModal.confirm(this.app, {
                    title: '删除供应商',
                    description: `确定要删除供应商「${raw.name}」吗？可以在「恢复默认供应商」中找回默认项。`,
                    confirmText: '确认删除',
                    cancelText: '取消',
                });
                if (!confirmed) return;
                this.plugin.setHidden(raw.id, true);
                await this.plugin.saveSettings();
                this.plugin.updateStatusBarText();
                this.selectedId = null;
                this.render();
                this.onChanged();
            }));
            menu.showAtMouseEvent(event);
        };

        // Base URL
        this.renderField(container, 'Base URL', (field) => {
            // 长 URL 在窄面板里单行一定截断，用可换行 textarea
            const input = field.createEl('textarea', {
                cls: 'nw-api-text-input nw-api-text-area',
                attr: { placeholder: 'https://api.example.com/v1', spellcheck: 'false', rows: '1', wrap: 'soft' },
            });
            input.value = raw.endpoint;
            const autosize = () => {
                input.addClass('nw-h-auto');
                input.style.height = `${Math.max(34, input.scrollHeight)}px`;
            };
            window.setTimeout(autosize, 0);
            input.addEventListener('change', async () => {
                const next = input.value.trim();
                if (!next) {
                    input.value = raw.endpoint;
                    new Notice('Base URL 不能为空');
                    return;
                }
                input.value = next;
                autosize();
                this.plugin.updateProvider(raw.id, { endpoint: next });
                await this.plugin.saveSettings();
                if (raw.id === this.plugin.getCurrentProviderId()) this.plugin.updateStatusBarText();
                rerender();
            });
        }, '可带也可不带 /v1，实际请求路径由「API 格式」推导');

        // API 格式
        this.renderField(container, 'API 格式', (field) => {
            const select = field.createEl('select', { cls: 'nw-api-select' });
            for (const option of API_FORMAT_OPTIONS) {
                select.createEl('option', {
                    value: option.value,
                    // 短名进下拉，路径放 title（窄面板下长标签会被 select 截断）
                    text: option.label,
                    attr: { title: `${option.label}（${option.path}）` },
                });
            }
            select.value = format;
            const syncTitle = () => {
                const active = API_FORMAT_OPTIONS.find(o => o.value === select.value);
                select.setAttr('title', active ? `${active.label}${active.path}` : '');
            };
            syncTitle();
            select.addEventListener('change', async () => {
                syncTitle();
                this.plugin.updateProvider(raw.id, { apiFormat: normalizeApiFormat(select.value) });
                await this.plugin.saveSettings();
                showSuccessNotice(`已切换为 ${API_FORMAT_OPTIONS.find(o => o.value === select.value)?.label ?? select.value}`);
            });
        }, `请求路径：${API_FORMAT_OPTIONS.map(o => `${o.label} → ${o.path}`).join('；')}。Anthropic 协议改用 x-api-key 发送密钥`);

        // API Key
        this.renderField(container, 'API Key', (field) => {
            const row = field.createDiv({ cls: 'nw-api-key-row' });
            const storedKey = this.plugin.settings.providerKeys?.[raw.id] || '';
            const input = row.createEl('input', {
                cls: 'nw-api-text-input',
                type: 'password',
                // 未解锁时内存里是密文，不能直接显示（会露出乱码，误编辑还会存回密文）
                value: describeSecretForInput(storedKey).value,
                attr: {
                    placeholder: describeSecretForInput(storedKey).placeholder,
                    spellcheck: 'false',
                    title: describeSecretForInput(storedKey).title,
                },
            });
            input.addEventListener('change', async () => {
                const typed = input.value.trim();
                if (!typed && isStoredCiphertext(storedKey)) return;
                this.plugin.settings.providerKeys = this.plugin.settings.providerKeys || {};
                this.plugin.settings.providerKeys[raw.id] = typed;
                if (raw.id === this.plugin.getCurrentProviderId()) {
                    this.plugin.settings.apiKey = typed;
                }
                await this.plugin.saveSettings();
                showSuccessNotice('密钥已保存');
            });
            const eye = row.createEl('button', {
                cls: 'nw-api-icon-btn',
                attr: { type: 'button', title: '显示/隐藏密钥' },
            });
            eye.setText('👁');
            eye.onclick = () => {
                input.type = input.type === 'password' ? 'text' : 'password';
                eye.setText(input.type === 'password' ? '👁' : '🙈');
            };
        });

        // 模型列表
        const modelsBlock = container.createDiv({ cls: 'nw-api-field' });
        const modelsHead = modelsBlock.createDiv({ cls: 'nw-api-models-head' });
        modelsHead.createEl('span', { cls: 'nw-api-label', text: '模型列表' });
        const modelsActions = modelsHead.createDiv({ cls: 'nw-api-models-actions' });

        const fetchBtn = modelsActions.createEl('button', {
            cls: 'nw-api-ghost-btn',
            attr: { type: 'button', title: '请求端点模型列表接口，勾选后写入' },
        });
        fetchBtn.setText('🔄 从 URL 获取');
        fetchBtn.onclick = async () => {
            if (fetchBtn.disabled) return;
            fetchBtn.disabled = true;
            fetchBtn.setText('⏳ 获取中…');
            try {
                const key = this.plugin.settings.providerKeys?.[raw.id] || '';
                const result = await discoverModels(raw.endpoint, format, key);
                if (result.kind === 'error') {
                    showErrorNotice(result.message, { title: '获取模型失败', timeout: 10000 });
                    return;
                }
                new ModelPickerModal(this.app, result.models, raw.models, async ({ models, capacities }) => {
                    const meta = { ...(this.getRawProvider(raw.id)?.modelMeta || {}) };
                    for (const item of capacities) {
                        meta[item.id] = {
                            ...meta[item.id],
                            ...(item.contextWindow ? { contextWindow: item.contextWindow } : {}),
                            ...(item.maxTokens ? { maxTokens: item.maxTokens } : {}),
                        };
                    }
                    this.plugin.updateProvider(raw.id, { models, modelMeta: meta });
                    this.syncAvailable(raw.id);
                    await this.plugin.saveSettings();
                    this.plugin.updateStatusBarText();
                    showSuccessNotice(`已更新模型列表（${models.length} 个）`, { timeout: 4000 });
                    this.onChanged();
                    rerender();
                }).open();
            } finally {
                fetchBtn.disabled = false;
                fetchBtn.setText('🔄 从 URL 获取');
            }
        };

        const addModelBtn = modelsActions.createEl('button', {
            cls: 'nw-api-ghost-btn',
            attr: { type: 'button' },
        });
        addModelBtn.setText('＋ 添加模型');
        addModelBtn.onclick = () => this.openModelEditor(raw.id, '');

        const list = modelsBlock.createDiv({ cls: 'nw-api-model-list' });
        const disabled = new Set(raw.disabledModels || []);
        if (raw.models.length === 0) {
            list.createDiv({ cls: 'nw-api-model-empty', text: '还没有模型。点「从 URL 获取」自动导入，或手动添加。' });
        }
        for (const modelId of raw.models) {
            const meta = raw.modelMeta?.[modelId];
            const fallback = lookupModelCapability(modelId);
            const row = list.createDiv({
                cls: 'nw-api-model-row' + (disabled.has(modelId) ? ' nw-api-model-row-disabled' : ''),
            });
            const main = row.createDiv({ cls: 'nw-api-model-main' });
            main.createSpan({ cls: 'nw-api-model-id', text: modelId });
            const capacity = this.formatCapacity(meta?.contextWindow ?? fallback?.maxContext);
            if (capacity) main.createSpan({ cls: 'nw-api-model-badge', text: capacity });
            if (meta?.vision) main.createSpan({ cls: 'nw-api-model-badge', text: '视觉' });

            const rowActions = row.createDiv({ cls: 'nw-api-model-actions' });
            const enableLabel = rowActions.createEl('label', { cls: 'nw-api-switch', attr: { title: '启用该模型' } });
            const enable = enableLabel.createEl('input', { type: 'checkbox' });
            enable.checked = !disabled.has(modelId);
            enableLabel.toggleClass('nw-is-active', enable.checked);
            enable.addEventListener('change', async () => {
                enableLabel.toggleClass('nw-is-active', enable.checked);
                const next = new Set(this.getRawProvider(raw.id)?.disabledModels || []);
                if (enable.checked) next.delete(modelId);
                else next.add(modelId);
                this.plugin.updateProvider(raw.id, { disabledModels: [...next] });
                this.syncAvailable(raw.id);
                await this.plugin.saveSettings();
                this.plugin.updateStatusBarText();
                rerender();
            });

            const editBtn = rowActions.createEl('button', {
                cls: 'nw-api-icon-btn',
                attr: { type: 'button', title: '编辑模型' },
            });
            editBtn.setText('✏️');
            editBtn.onclick = () => this.openModelEditor(raw.id, modelId);

            const delBtn = rowActions.createEl('button', {
                cls: 'nw-api-icon-btn',
                attr: { type: 'button', title: '从列表移除' },
            });
            delBtn.setText('🗑');
            delBtn.onclick = async () => {
                const next = (this.getRawProvider(raw.id)?.models || []).filter((model: string) => model !== modelId);
                this.plugin.updateProvider(raw.id, { models: next });
                this.syncAvailable(raw.id);
                await this.plugin.saveSettings();
                this.plugin.updateStatusBarText();
                this.onChanged();
                rerender();
            };
        }
    }

    private renderField(
        container: HTMLElement,
        label: string,
        build: (field: HTMLElement) => void,
        hint?: string,
    ): void {
        const field = container.createDiv({ cls: 'nw-api-field' });
        field.createEl('span', { cls: 'nw-api-label', text: label });
        build(field);
        if (hint) field.createEl('span', { cls: 'nw-api-hint', text: hint });
    }

    private syncAvailable(providerId: string): void {
        if (providerId !== this.plugin.getCurrentProviderId()) return;
        const raw = this.getRawProvider(providerId);
        if (!raw) return;
        const settings = this.plugin.settings;
        const disabled = new Set(raw.disabledModels || []);
        const enabled = raw.models.filter((model: string) => !disabled.has(model));
        settings.availableModels = enabled.length > 0 ? [...enabled] : [...raw.models];
        for (const key of ['defaultModel', 'flashModel', 'proModel'] as const) {
            if (!settings.availableModels.includes(settings[key])) {
                settings[key] = settings.availableModels[0];
            }
        }
    }

    private openModelEditor(providerId: string, modelId: string): void {
        const raw = this.getRawProvider(providerId);
        if (!raw) return;
        const plugin = this.plugin;
        const rerender = () => this.render();
        const sync = (id: string) => this.syncAvailable(id);
        const onChanged = this.onChanged;
        const isNew = modelId === '';
        const initialMeta = raw.modelMeta?.[modelId] || {};
        const fallback = lookupModelCapability(modelId);
        const app = this.app;

        new (class extends Modal {
            /**
             * onOpen 方法。
             */
            onOpen(): void {
                this.modalEl.addClass('nw-scope');
                const { contentEl } = this;
                contentEl.createEl('h3', { text: isNew ? '＋ 添加模型' : '✏️ 编辑模型' });

                let idValue = modelId;
                let contextValue = String(initialMeta.contextWindow ?? fallback?.maxContext ?? '');
                let outputValue = String(initialMeta.maxTokens ?? fallback?.maxOutput ?? '');
                let visionValue = !!initialMeta.vision;

                new Setting(contentEl).setName('模型 ID').setDesc('请求时使用的模型名，需与端点完全一致')
                    .addText(text => text.setValue(idValue).setPlaceholder('deepseek-v4.1-flash')
                        .onChange(value => { idValue = value.trim(); }));
                new Setting(contentEl).setName('上下文窗口 (tokens)').setDesc('留空则按内置能力表推断')
                    .addText(text => text.setValue(contextValue).onChange(value => { contextValue = value.trim(); }));
                new Setting(contentEl).setName('输出上限 (tokens)').setDesc('留空则按内置能力表推断')
                    .addText(text => text.setValue(outputValue).onChange(value => { outputValue = value.trim(); }));
                new Setting(contentEl).setName('支持图片输入')
                    .addToggle(toggle => toggle.setValue(visionValue).onChange(value => { visionValue = value; }));

                const footer = contentEl.createDiv({ cls: 'nw-api-modal-footer' });
                footer.createEl('button', { text: '取消', attr: { type: 'button' } }).onclick = () => this.close();
                const save = footer.createEl('button', {
                    cls: 'nw-api-primary-btn',
                    text: isNew ? '添加' : '保存',
                    attr: { type: 'button' },
                });
                save.onclick = async () => {
                    if (!idValue) { new Notice('模型 ID 不能为空'); return; }
                    const current = (plugin.settings.customProviders || []).find(p => p.id === providerId);
                    if (!current) { showErrorNotice('该供应商已不存在'); return; }

                    const models = [...current.models];
                    if (isNew) {
                        if (models.includes(idValue)) { new Notice('该模型已在列表中'); return; }
                        models.push(idValue);
                    } else if (idValue !== modelId) {
                        const at = models.indexOf(modelId);
                        if (at < 0) { showErrorNotice('原模型已不在列表中'); return; }
                        if (models.includes(idValue)) { new Notice('该模型已在列表中'); return; }
                        models[at] = idValue;
                    }

                    const meta = { ...(current.modelMeta || {}) };
                    if (!isNew && idValue !== modelId) delete meta[modelId];
                    const nextMeta: { contextWindow?: number; maxTokens?: number; vision?: boolean } = {};
                    const context = parseInt(contextValue, 10);
                    const output = parseInt(outputValue, 10);
                    if (Number.isFinite(context) && context > 0) nextMeta.contextWindow = context;
                    if (Number.isFinite(output) && output > 0) nextMeta.maxTokens = output;
                    if (visionValue) nextMeta.vision = true;
                    if (Object.keys(nextMeta).length > 0) meta[idValue] = nextMeta;
                    else delete meta[idValue];

                    const disabledList = (current.disabledModels || []).map(
                        (model: string) => (model === modelId ? idValue : model),
                    );

                    plugin.updateProvider(providerId, { models, modelMeta: meta, disabledModels: disabledList });
                    sync(providerId);
                    await plugin.saveSettings();
                    plugin.updateStatusBarText();
                    showSuccessNotice(isNew ? `已添加模型 ${idValue}` : `已保存 ${idValue}`);
                    this.close();
                    onChanged();
                    rerender();
                };
            }
            onClose(): void { this.contentEl.empty(); }
        })(app).open();
    }

    private openAddProvider(): void {
        const plugin = this.plugin;
        const onChanged = this.onChanged;
        const rerender = () => this.render();
        const app = this.app;

        new (class extends Modal {
            /**
             * onOpen 方法。
             */
            onOpen(): void {
                this.modalEl.addClass('nw-scope');
                const { contentEl } = this;
                contentEl.createEl('h3', { text: '＋ 添加供应商' });

                let nameValue = '';
                let endpointValue = '';
                let formatValue: ApiFormat = 'openai-chat';
                let keyValue = '';

                new Setting(contentEl).setName('名称').setDesc('用于列表与状态显示')
                    .addText(text => text.setPlaceholder('我的代理').onChange(value => { nameValue = value; }));
                new Setting(contentEl).setName('Base URL').setDesc('可带也可不带 /v1')
                    .addText(text => text.setPlaceholder('https://api.example.com').onChange(value => { endpointValue = value.trim(); }));
                new Setting(contentEl).setName('API 格式')
                    .addDropdown(dropdown => {
                        for (const option of API_FORMAT_OPTIONS) dropdown.addOption(option.value, option.label);
                        dropdown.setValue(formatValue);
                        dropdown.onChange(value => { formatValue = normalizeApiFormat(value); });
                    });
                new Setting(contentEl).setName('API Key')
                    .addText(text => {
                        text.inputEl.type = 'password';
                        text.setPlaceholder('sk-...').onChange(value => { keyValue = value.trim(); });
                    });

                const footer = contentEl.createDiv({ cls: 'nw-api-modal-footer' });
                footer.createEl('button', { text: '取消', attr: { type: 'button' } }).onclick = () => this.close();
                const save = footer.createEl('button', {
                    cls: 'nw-api-primary-btn',
                    text: '添加',
                    attr: { type: 'button' },
                });
                save.onclick = async () => {
                    if (!nameValue.trim()) { new Notice('请输入名称'); return; }
                    if (!endpointValue) { new Notice('请输入 Base URL'); return; }
                    const id = plugin.addCustomProvider(
                        nameValue.trim(), endpointValue, ['default-model'], 128000, 32768, keyValue, formatValue,
                    );
                    if (!id) return;
                    await plugin.saveSettings();
                    plugin.updateStatusBarText();
                    this.close();
                    showSuccessNotice('已添加供应商，可点「从 URL 获取」导入模型', { timeout: 5000 });
                    onChanged();
                    rerender();
                };
            }
            onClose(): void { this.contentEl.empty(); }
        })(app).open();
    }

    /**
     * onClose 方法。
     */
    onClose(): void {
        this.contentEl.empty();
    }
}
