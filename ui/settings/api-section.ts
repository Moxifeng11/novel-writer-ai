/**
 * api-section.ts — 「API 配置」分区
 *
 * 职责：API 供应商配置（侧栏/详情/模型列表/连通性）、全局模型分配、
 * 密钥加密状态与口令、同人考据来源、任务级模型参数。
 * 来源：原 settings-tab.ts L99-L1363。
 * 依赖：宿主提供的 app/plugin/refresh/reopen（见 section-base.ts），
 * 以及 api-format、model-discovery、task-model、task-budget-engine 等共享模块。
 */
import { Setting, Notice, Modal, Menu } from 'obsidian';
import { CustomProvider } from '@/main';
import { API_FORMAT_OPTIONS, normalizeApiFormat, type ApiFormat } from '@/shared/api-format';
import { discoverModels } from '@/services/model-discovery';
import { ModelPickerModal } from '@/ui/model-picker-modal';
import { PasswordModal } from '@/ui/password-modal';
import { describeSecretForInput, isStoredCiphertext } from '@/shared/secret-display';
import { lookupModelCapability } from '@/shared/model-capabilities';
import { testProviderConnectivity } from '@/services/api-connectivity-service';
import {
    resolveTaskModelConfig,
    THINKING_LEVELS,
    thinkingIntensityFromMode,
    thinkingLevelFromMode,
    thinkingLevelSpec,
    clampThinkingIntensity,
    nearestThinkingLevel,
    type AiTask,
    type TaskBudgetOverride,
    type ThinkingLevel,
} from '@/shared/task-model';
import {
    BUDGET_TIERS,
    budgetTierSpec,
    normalizeBudgetTier,
    TASK_CATEGORY,
    type BudgetTier,
} from '@/shared/task-budget-engine';
import { OperationConfirmModal } from '@/ui/components/progress';
import { SettingsSection } from './section-base';

/**
 * ApiSection 类。
 */
export class ApiSection extends SettingsSection {
    private getCurrentProviderModels(): string[] {
        const customProviders = this.plugin.settings.customProviders || [];
        const endpoint = this.plugin.settings.apiEndpoint;
        const provider = customProviders.find(c => c.endpoint === endpoint);
        if (provider && provider.models?.length > 0) {
            return [...provider.models];
        }
        return [...this.plugin.settings.availableModels];
    }

    /** 当前在 API 设置里选中的供应商（纯 UI 状态，不持久化） */
    private apiSelectedProviderId: string | null = null;

    /** 容量显示：1050000 → 1M，204800 → 205K */
    private formatCapacity(value: number | undefined): string {
        if (!value || value <= 0) return '';
        if (value >= 1_000_000) {
            const scaled = value / 1_000_000;
            return `${Number.isInteger(scaled) ? scaled : scaled.toFixed(1)}M`;
        }
        if (value >= 1000) return `${Math.round(value / 1000)}K`;
        return String(value);
    }

    /** 取供应商原始配置（含 apiFormat / disabledModels / modelMeta 等未透出字段） */
    private getRawProvider(id: string): CustomProvider | undefined {
        return (this.plugin.settings.customProviders || []).find(provider => provider.id === id);
    }

    /**
     * 渲染。
     * @param container - 容器元素
     */
    render(container: HTMLElement): void {
        const section = container.createEl('section');
        const providers = this.plugin.getAllProviders();
        const currentId = this.plugin.getCurrentProviderId();

        const remembered = this.apiSelectedProviderId;
        const selectedId = remembered && providers.some(p => p.id === remembered)
            ? remembered
            : (currentId && providers.some(p => p.id === currentId) ? currentId : (providers[0]?.id ?? ''));
        this.apiSelectedProviderId = selectedId || null;

        this.renderApiHeader(section);

        const layout = section.createDiv({ cls: 'nw-api-layout' });
        this.renderProviderSidebar(layout.createDiv({ cls: 'nw-api-sidebar' }), providers, selectedId, currentId);

        const detail = layout.createDiv({ cls: 'nw-api-detail' });
        if (!selectedId) {
            detail.createDiv({
                cls: 'nw-api-empty',
                text: '还没有供应商。点击右上角「＋ 添加供应商」创建第一个。',
            });
            this.renderApiGlobalSettings(detail);
            return;
        }
        this.renderProviderDetail(detail, selectedId);
        this.renderApiGlobalSettings(detail);
    }

    /** 顶部标题与操作 */
    private renderApiHeader(section: HTMLElement): void {
        const header = section.createDiv({ cls: 'nw-api-header' });
        const titleWrap = header.createDiv({ cls: 'nw-api-header-title' });
        titleWrap.createEl('h2', { text: '模型设置' });
        titleWrap.createEl('p', {
            text: '管理自定义模型供应商，配置后可在写作任务中选择使用。',
        });

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
            new Notice('✅ 已恢复默认供应商');
            this.refresh();
        };

        const addBtn = actions.createEl('button', {
            cls: 'nw-api-primary-btn',
            attr: { type: 'button' },
        });
        addBtn.setText('＋ 添加供应商');
        addBtn.onclick = () => this.openNewProviderModal();
    }

    /** 左栏：预设 / 自定义分组列表 */
    private renderProviderSidebar(
        container: HTMLElement,
        providers: Array<{ id: string; name: string; sourceType: string; isDefault?: boolean }>,
        selectedId: string,
        currentId: string | null,
    ): void {
        const groups: Array<{ title: string; items: typeof providers }> = [
            { title: '预设供应商', items: providers.filter(p => p.isDefault) },
            { title: '自定义供应商', items: providers.filter(p => !p.isDefault) },
        ];

        for (const group of groups) {
            if (group.items.length === 0) continue;
            container.createDiv({ cls: 'nw-api-sidebar-group', text: group.title });
            for (const provider of group.items) {
                const row = container.createDiv({
                    cls: 'nw-api-sidebar-row' + (provider.id === selectedId ? ' nw-api-sidebar-row-selected' : ''),
                });
                row.createSpan({
                    cls: 'nw-api-sidebar-icon',
                    text: provider.sourceType === 'local' ? '💻' : '☁️',
                });
                row.createSpan({ cls: 'nw-api-sidebar-name', text: provider.name });
                const isCurrent = provider.id === currentId;
                row.createSpan({
                    cls: 'nw-api-sidebar-dot' + (isCurrent ? ' nw-api-sidebar-dot-current' : ''),
                    attr: { title: isCurrent ? '当前使用中' : '未启用' },
                });
                row.onclick = () => {
                    this.apiSelectedProviderId = provider.id;
                    this.refresh();
                };
            }
        }
    }

    /** 右栏：单个供应商的完整配置 */
    private renderProviderDetail(container: HTMLElement, providerId: string): void {
        const raw = this.getRawProvider(providerId);
        const provider = this.plugin.getAllProviders().find(p => p.id === providerId);
        if (!raw || !provider) {
            container.createDiv({ cls: 'nw-api-empty', text: '该供应商已不可用。' });
            return;
        }
        const format = normalizeApiFormat(raw.apiFormat);
        const rerender = () => this.refresh();

        // ── 标题行：名称 + 启用开关 + 更多操作 ──
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
        toggle.addEventListener('change', async () => {
            if (toggle.checked) {
                this.plugin.switchProviderByEndpoint(raw.endpoint);
                await this.plugin.saveSettings();
                this.plugin.updateStatusBarText();
                new Notice(`✅ 已切换到「${raw.name}」`);
                this.apiSelectedProviderId = providerId;
                rerender();
                return;
            }
            // 关闭当前供应商会让写作任务失去端点，必须明确拒绝
            toggle.checked = true;
            new Notice('不能用开关停用当前正在使用的供应商，请改为切换到其他供应商', 5000);
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
                rerender();
            }));
            menu.addSeparator();
            menu.addItem(item => item.setTitle(raw.isDefault ? '删除供应商' : '删除自定义供应商').onClick(async () => {
                // 预设：隐藏，可在「恢复默认供应商」找回；自定义：真删，不可恢复
                const isPreset = raw.isDefault === true;
                const confirmed = await OperationConfirmModal.confirm(this.app, {
                    title: isPreset ? '删除供应商' : '删除自定义供应商',
                    description: isPreset
                        ? `确定要删除供应商「${raw.name}」吗？可以在「恢复默认供应商」中找回。`
                        : `确定要永久删除自定义供应商「${raw.name}」吗？此操作不可恢复（可重新添加）。`,
                    confirmText: '确认删除',
                    cancelText: '取消',
                });
                if (!confirmed) return;
                if (isPreset) this.plugin.setHidden(raw.id, true);
                else if (!this.plugin.removeCustomProvider(raw.id)) {
                    new Notice('删除失败：该供应商不存在或属于预设项', 5000);
                    return;
                }
                await this.plugin.saveSettings();
                this.plugin.updateStatusBarText();
                this.apiSelectedProviderId = null;
                rerender();
                new Notice(`已删除「${raw.name}」`);
            }));
            menu.showAtMouseEvent(event);
        };

        // ── Base URL ──
        this.renderField(container, 'Base URL', (field) => {
            // 用可换行的 textarea：长 URL（如火山 …/api/v3/chat/completions）在窄面板里
            // 单行 input 一定被截断，多行显示才能一眼看全。
            const input = field.createEl('textarea', {
                cls: 'nw-api-text-input nw-api-text-area',
                attr: {
                    placeholder: 'https://api.example.com/v1',
                    spellcheck: 'false',
                    rows: '1',
                    wrap: 'soft',
                },
            });
            input.value = raw.endpoint;
            const autosize = () => {
                input.style.height = 'auto';
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
        }, '可带也可不带 /v1，实际请求路径由下方「API 格式」推导');

        // ── API 格式 ──
        this.renderField(container, 'API 格式', (field) => {
            const select = field.createEl('select', { cls: 'nw-api-select' });
            for (const option of API_FORMAT_OPTIONS) {
                select.createEl('option', {
                    value: option.value,
                    // 下拉里只放短名；路径放 title，避免窄面板截断（旧版把
                    // 路径塞进 label，36 字符在 240px 面板下溢出 38px）
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
                new Notice(`已切换为 ${API_FORMAT_OPTIONS.find(o => o.value === select.value)?.label ?? select.value}`);
            });
        }, `请求路径：${API_FORMAT_OPTIONS.map(o => `${o.label} → ${o.path}`).join('；')}`);

        // ── API Key ──
        this.renderField(container, 'API Key', (field) => {
            const row = field.createDiv({ cls: 'nw-api-key-row' });
            // 未解锁时内存里是密文：不能把它塞进输入框（用户会看到乱码，
            // 误编辑还会把密文当新密钥存回去）。密文一律显示为空 + 提示语。
            const storedKey = this.plugin.settings.providerKeys?.[raw.id] || '';
            const display = describeSecretForInput(storedKey);
            const input = row.createEl('input', {
                cls: 'nw-api-text-input',
                type: 'password',
                value: display.value,
                attr: { placeholder: display.placeholder, spellcheck: 'false', title: display.title },
            });
            input.addEventListener('change', async () => {
                const typed = input.value.trim();
                // 密文未解锁时输入框是空的：留空失焦不写回，避免把密文清掉
                if (!typed && isStoredCiphertext(storedKey)) return;
                this.plugin.settings.providerKeys = this.plugin.settings.providerKeys || {};
                this.plugin.settings.providerKeys[raw.id] = typed;
                // 当前供应商的密钥同时写回全局字段，避免两条读取路径不一致
                if (raw.id === this.plugin.getCurrentProviderId()) {
                    this.plugin.settings.apiKey = typed;
                }
                await this.plugin.saveSettings();
                new Notice('✅ 密钥已保存');
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

        // ── 模型列表 ──
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
                    new Notice(`❌ 获取模型失败：${result.message}`, 10000);
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
                    this.syncAvailableModels(raw.id);
                    await this.plugin.saveSettings();
                    this.plugin.updateStatusBarText();
                    new Notice(`✅ 已更新模型列表（${models.length} 个）`, 4000);
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
            const contextWindow = meta?.contextWindow ?? fallback?.maxContext;

            const row = list.createDiv({ cls: 'nw-api-model-row' + (disabled.has(modelId) ? ' nw-api-model-row-disabled' : '') });
            const main = row.createDiv({ cls: 'nw-api-model-main' });
            main.createSpan({ cls: 'nw-api-model-id', text: modelId });
            const capacity = this.formatCapacity(contextWindow);
            if (capacity) main.createSpan({ cls: 'nw-api-model-badge', text: capacity });
            if (meta?.vision) main.createSpan({ cls: 'nw-api-model-badge', text: '视觉' });

            const rowActions = row.createDiv({ cls: 'nw-api-model-actions' });

            const enableLabel = rowActions.createEl('label', { cls: 'nw-api-switch', attr: { title: '启用该模型' } });
            const enable = enableLabel.createEl('input', { type: 'checkbox' });
            enable.checked = !disabled.has(modelId);
            enable.addEventListener('change', async () => {
                const next = new Set(this.getRawProvider(raw.id)?.disabledModels || []);
                if (enable.checked) next.delete(modelId);
                else next.add(modelId);
                this.plugin.updateProvider(raw.id, { disabledModels: [...next] });
                this.syncAvailableModels(raw.id);
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
                const next = (this.getRawProvider(raw.id)?.models || []).filter(model => model !== modelId);
                this.plugin.updateProvider(raw.id, { models: next });
                this.syncAvailableModels(raw.id);
                await this.plugin.saveSettings();
                this.plugin.updateStatusBarText();
                rerender();
            };
        }

        // ── 连通性测试 ──
        const testRow = container.createDiv({ cls: 'nw-api-test-row' });
        const testBtn = testRow.createEl('button', {
            cls: 'nw-api-ghost-btn',
            attr: { type: 'button', title: '发送一次最小请求，验证端点、密钥与模型' },
        });
        testBtn.setText('🔌 测试连通性');
        const statusEl = testRow.createSpan({ cls: 'nw-api-test-status', text: '未测试' });
        testBtn.onclick = async () => {
            if (testBtn.disabled) return;
            testBtn.disabled = true;
            testBtn.setText('⏳ 测试中…');
            statusEl.setText('正在检测…');
            statusEl.className = 'nw-api-test-status';
            try {
                const enabledModels = raw.models.filter(model => !disabled.has(model));
                const model = (raw.id === this.plugin.getCurrentProviderId() ? this.plugin.settings.defaultModel : '')
                    || enabledModels[0]
                    || raw.models[0]
                    || '';
                const result = await testProviderConnectivity({
                    providerName: raw.name,
                    endpoint: raw.endpoint,
                    model,
                    apiKey: this.plugin.settings.providerKeys?.[raw.id] || '',
                    sourceType: provider.sourceType === 'local' ? 'local' : 'cloud',
                    apiFormat: format,
                });
                const icon = result.level === 'ok' ? '✅' : result.level === 'warn' ? '⚠️' : '❌';
                statusEl.setText(`${icon} ${result.message}`);
                statusEl.className = `nw-api-test-status nw-api-test-status-${result.level}`;
            } finally {
                testBtn.disabled = false;
                testBtn.setText('🔌 测试连通性');
            }
        };
    }

    /** 「标签 + 控件 + 说明」的统一排版 */
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

    /** 把供应商的启用模型同步到全局 availableModels，并修正失效的默认/规划/正文模型 */
    private syncAvailableModels(providerId: string): void {
        const settings = this.plugin.settings;
        if (providerId !== this.plugin.getCurrentProviderId()) return;
        const raw = this.getRawProvider(providerId);
        if (!raw) return;
        const disabled = new Set(raw.disabledModels || []);
        const enabled = raw.models.filter(model => !disabled.has(model));
        settings.availableModels = enabled.length > 0 ? [...enabled] : [...raw.models];
        for (const key of ['defaultModel', 'flashModel', 'proModel'] as const) {
            if (!settings.availableModels.includes(settings[key])) {
                settings[key] = settings.availableModels[0];
            }
        }
    }

    /** 模型编辑弹窗：改 id / 上下文 / 输出 / 是否支持图片 */
    private openModelEditor(providerId: string, modelId: string): void {
        const raw = this.getRawProvider(providerId);
        if (!raw) return;
        const plugin = this.plugin;
        const app = this.app;
        const rerender = () => this.refresh();
        const sync = (id: string) => this.syncAvailableModels(id);
        const isNew = modelId === '';
        const initialMeta = raw.modelMeta?.[modelId] || {};
        const fallback = lookupModelCapability(modelId);

        new (class extends Modal {
            onOpen(): void {
                this.modalEl.addClass('nw-scope');
                const { contentEl } = this;
                contentEl.createEl('h3', { text: isNew ? '＋ 添加模型' : '✏️ 编辑模型' });

                let idValue = modelId;
                let contextValue = String(initialMeta.contextWindow ?? fallback?.maxContext ?? '');
                let outputValue = String(initialMeta.maxTokens ?? fallback?.maxOutput ?? '');
                let visionValue = !!initialMeta.vision;

                new Setting(contentEl)
                    .setName('模型 ID')
                    .setDesc('请求时使用的模型名，需与端点完全一致')
                    .addText(text => text
                        .setValue(idValue)
                        .setPlaceholder('deepseek-v4.1-flash')
                        .onChange(value => { idValue = value.trim(); }));

                new Setting(contentEl)
                    .setName('上下文窗口 (tokens)')
                    .setDesc('留空则按内置能力表推断')
                    .addText(text => text
                        .setValue(contextValue)
                        .onChange(value => { contextValue = value.trim(); }));

                new Setting(contentEl)
                    .setName('输出上限 (tokens)')
                    .setDesc('留空则按内置能力表推断')
                    .addText(text => text
                        .setValue(outputValue)
                        .onChange(value => { outputValue = value.trim(); }));

                new Setting(contentEl)
                    .setName('支持图片输入')
                    .addToggle(toggle => toggle
                        .setValue(visionValue)
                        .onChange(value => { visionValue = value; }));

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
                    if (!current) { new Notice('该供应商已不存在'); return; }

                    const models = [...current.models];
                    if (isNew) {
                        if (models.includes(idValue)) { new Notice('该模型已在列表中'); return; }
                        models.push(idValue);
                    } else if (idValue !== modelId) {
                        const at = models.indexOf(modelId);
                        if (at >= 0) {
                            if (models.includes(idValue)) { new Notice('该模型已在列表中'); return; }
                            models[at] = idValue;
                        }
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

                    // 重命名时同步禁用列表，避免旧名残留在 disabledModels 里
                    const disabled = (current.disabledModels || []).map(model => (model === modelId ? idValue : model));

                    plugin.updateProvider(providerId, { models, modelMeta: meta, disabledModels: disabled });
                    sync(providerId);
                    await plugin.saveSettings();
                    plugin.updateStatusBarText();
                    new Notice(isNew ? `✅ 已添加模型 ${idValue}` : `✅ 已保存 ${idValue}`);
                    this.close();
                    rerender();
                };
            }
            onClose(): void { this.contentEl.empty(); }
        })(app).open();
    }

    /**
     * 密钥加密状态 + 口令重置（2026-10-29）。
     *
     * 状态：磁盘上还有多少项密钥处于加密状态。
     * 解锁：输入已有口令（修复后不会再让你「重设」口令）。
     * 重置：设定新口令后，能读到的明文会重新加密；解不开的旧密文会被清空
     * 并在 Notice 里列出，提示重新填写——而不是让它们以「看起来配好了但
     * 其实无效」的状态一直存在。
     */
    private renderKeyEncryptionRows(container: HTMLElement): void {
        const service = this.plugin.getSettingsService?.();
        const locked = service?.lockedSecretCount?.() ?? 0;

        const row = new Setting(container)
            .setName('密钥加密')
            .setDesc(locked > 0
                ? `磁盘上有 ${locked} 项密钥处于加密状态。重启或更新后需要输入口令才能读取（修复后不会再让你「重设」口令）。`
                : '磁盘上没有加密的密钥条目。设定口令后，保存的密钥会用口令加密。');

        row.addButton(btn => btn
            .setButtonText(locked > 0 ? '🔓 输入口令解锁' : '🔐 设定口令')
            .onClick(async () => {
                if (locked > 0) {
                    const password = await PasswordModal.ask(this.app);
                    if (!password) return;
                    // 先验证能解开磁盘上的密文，避免「提示解锁成功、实际全是乱码」
                    const ok = await this.plugin.verifySettingsPassword?.(password);
                    if (ok === false) {
                        new Notice('❌ 口令不正确，密钥仍未解锁', 6000);
                        return;
                    }
                    this.plugin.setSessionPassword?.(password);
                    await this.plugin.loadSettings();
                    this.refresh();
                    new Notice('✅ 已解锁，密钥可正常读取');
                    return;
                }
                const password = await PasswordModal.setup(this.app);
                if (!password) return;
                this.plugin.setSessionPassword?.(password);
                await this.plugin.saveSettings();
                this.refresh();
                new Notice('✅ 已启用密钥加密');
            }));

        row.addButton(btn => btn
            .setButtonText('♻️ 重置口令')
            .setWarning()
            .onClick(async () => {
                const confirmed = await OperationConfirmModal.confirm(this.app, {
                    title: '重置密钥加密口令',
                    description: '将用新口令重新加密所有密钥。用旧口令加密且无法解开的条目会被清空，需要重新填写。',
                    warning: '请先确认已备份 API Key',
                    confirmText: '继续重置',
                    cancelText: '取消',
                });
                if (!confirmed) return;

                const password = await PasswordModal.setup(this.app);
                if (!password) return;
                const result = await this.plugin.resetKeyPassword?.(password)
                    ?? { reencrypted: 0, cleared: [] };
                this.refresh();
                new Notice(
                    result.cleared.length > 0
                        ? `⚠️ 已重设口令：重新加密 ${result.reencrypted} 项；${result.cleared.join('、')} 需要重新填写`
                        : `✅ 已重设口令：重新加密 ${result.reencrypted} 项`,
                    10000,
                );
            }));
    }

    /** 全局模型分配与上限：作用于当前使用的供应商 */
    private renderApiGlobalSettings(container: HTMLElement): void {
        const settings = this.plugin.settings;
        const currentId = this.plugin.getCurrentProviderId();
        const currentName = this.plugin.getAllProviders().find(p => p.id === currentId)?.name || '未选择';
        const models = this.getCurrentProviderModels();

        const wrap = container.createDiv({ cls: 'nw-api-global' });
        wrap.createEl('h3', { text: '全局模型分配' });
        wrap.createEl('p', {
            cls: 'nw-api-global-hint',
            text: `以下设置作用于当前使用的供应商：${currentName}`,
        });

        const addModelSelect = (
            label: string,
            desc: string,
            value: string,
            onChange: (next: string) => void,
        ): void => {
            new Setting(wrap)
                .setName(label)
                .setDesc(desc)
                .addDropdown(dropdown => {
                    for (const model of models) dropdown.addOption(model, model);
                    if (value && !models.includes(value)) dropdown.addOption(value, `${value}（已失效）`);
                    dropdown.setValue(value);
                    dropdown.onChange(onChange);
                });
        };

        addModelSelect('默认模型', '未单独指定的任务使用', settings.defaultModel, async (value) => {
            settings.defaultModel = value;
            this.plugin.updateModelLimitsFromModel(value);
            await this.plugin.saveSettings();
            this.refresh();
        });
        addModelSelect('Flash 模型（大纲/分析/规划）', '大纲骨架、分析报告、元素提取', settings.flashModel, async (value) => {
            settings.flashModel = value;
            this.plugin.updateModelLimitsFromModel(value);
            await this.plugin.saveSettings();
            this.refresh();
        });
        addModelSelect('Pro 模型（正文/角色/实体）', '正文创作、角色生成、设定任务', settings.proModel, async (value) => {
            settings.proModel = value;
            this.plugin.updateModelLimitsFromModel(value);
            await this.plugin.saveSettings();
            this.refresh();
        });

        const currentModel = settings.defaultModel;
        const endpoint = settings.apiEndpoint;
        const override = settings.modelOverrides[endpoint]?.[currentModel];
        const defaults = this.plugin.resolveModelLimits(currentModel);

        new Setting(wrap)
            .setName('最大上下文')
            .setDesc(`${currentModel} 默认 ${defaults.maxContext.toLocaleString()} tokens${override?.maxContext !== undefined ? ' · ⚠️ 已设置自定义值' : ''}`)
            .addText(text => text
                .setPlaceholder(String(defaults.maxContext))
                .setValue(override?.maxContext !== undefined ? String(override.maxContext) : '')
                .onChange(value => {
                    const parsed = parseInt(value, 10);
                    this.plugin.setCurrentModelOverride('maxContext', Number.isFinite(parsed) && parsed > 0 ? parsed : defaults.maxContext);
                }));

        new Setting(wrap)
            .setName('最大输出')
            .setDesc(`${currentModel} 默认 ${defaults.maxOutput.toLocaleString()} tokens${override?.maxOutput !== undefined ? ' · ⚠️ 已设置自定义值' : ''}`)
            .addText(text => text
                .setPlaceholder(String(defaults.maxOutput))
                .setValue(override?.maxOutput !== undefined ? String(override.maxOutput) : '')
                .onChange(value => {
                    const parsed = parseInt(value, 10);
                    this.plugin.setCurrentModelOverride('maxOutput', Number.isFinite(parsed) && parsed > 0 ? parsed : defaults.maxOutput);
                }));

        this.renderTaskBudgetRows(wrap);
        this.renderCanonResearchRows(wrap);

        // ── 加密口令状态与恢复 ────────────────────────────────
        // 历史 bug：重启后保存任意密钥都会让用户「设定新口令」，新口令覆盖
        // 会话口令 → 旧密文永久解不开（表现为 API Key 失效）。修复后不再
        // 重设；这里再给已经踩坑的用户一条恢复路径。
        this.renderKeyEncryptionRows(wrap);
        const footer = wrap.createDiv({ cls: 'nw-api-footer' });
        const saveBtn = footer.createEl('button', {
            cls: 'nw-api-primary-btn',
            text: '💾 保存设置',
            attr: { type: 'button' },
        });
        saveBtn.onclick = async () => {
            if (currentId) {
                settings.providerKeys[currentId] = settings.apiKey;
            }
            await this.plugin.saveSettings();
            this.plugin.updateStatusBarText();
            new Notice('✅ API 设置已保存');
            this.refresh();
        };
        footer.createEl('button', {
            cls: 'nw-api-ghost-btn',
            text: '🔄 重置',
            attr: { type: 'button' },
        }).onclick = () => this.refresh();
    }

    /** 添加供应商弹窗（名称/Base URL/格式/密钥，模型可稍后拉取） */
    private openNewProviderModal(): void {
        const plugin = this.plugin;
        const app = this.app;
        const rerender = () => this.refresh();

        new (class extends Modal {
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
                        nameValue.trim(),
                        endpointValue,
                        ['default-model'],
                        128000,
                        32768,
                        keyValue,
                        formatValue,
                    );
                    if (!id) return;
                    await plugin.saveSettings();
                    plugin.updateStatusBarText();
                    this.close();
                    new Notice('✅ 已添加供应商，可点「从 URL 获取」导入模型', 5000);
                    rerender();
                };
            }
            onClose(): void { this.contentEl.empty(); }
        })(app).open();
    }

    private updateTaskBudget(task: AiTask, patch: TaskBudgetOverride): void {
        const settings = this.plugin.settings;
        settings.taskBudgets = settings.taskBudgets || {};
        const next: TaskBudgetOverride = { ...(settings.taskBudgets[task] || {}), ...patch };
        for (const key of Object.keys(next) as Array<keyof TaskBudgetOverride>) {
            const value = next[key];
            if (value === undefined || value === '' || (typeof value === 'number' && !Number.isFinite(value))) {
                delete next[key];
            }
        }
        if (Object.keys(next).length > 0) settings.taskBudgets[task] = next;
        else delete settings.taskBudgets[task];
    }

    /** v4.18: 同人考据来源设置。没有 API Key 时只允许手动官方来源。 */
    private renderCanonResearchRows(section: HTMLElement): void {
        const card = section.createDiv({ cls: 'nw-u-margintop-20px-2' });
        card.createEl('h4', { text: '📚 同人考据来源', cls: 'nw-u-m-0-0-6px-0-2 nw-u-fs-14px-2' });
        card.createEl('div', {
            text: '同人设定只允许参考原著/官方资料，不参考同人、改编、外传等衍生作品。未配置搜索 API 时只能手动添加官方 URL/摘录。',
            cls: 'nw-u-fs-12px-2 nw-u-c-text-muted-2 nw-u-marginbottom-8px-2',
        });
        const cfg = this.plugin.settings.canonResearch || {
            provider: 'manual' as const,
            apiKey: '',
            allowedDomains: [],
            blockedDomains: [],
            maxSources: 6,
            excerptChars: 1200,
        };
        this.plugin.settings.canonResearch = cfg;

        new Setting(card)
            .setName('检索方式')
            .setDesc('manual=只手动导入；其他选项需要对应搜索 API Key')
            .addDropdown(dropdown => {
                dropdown.addOption('manual', '手动官方来源（默认）');
                dropdown.addOption('bing', 'Bing Web Search');
                dropdown.addOption('brave', 'Brave Search');
                dropdown.addOption('serper', 'Serper.dev');
                dropdown.addOption('tavily', 'Tavily');
                dropdown.setValue(cfg.provider || 'manual');
                dropdown.onChange(async (value) => {
                    cfg.provider = value as typeof cfg.provider;
                    await this.plugin.saveSettings();
                });
            });

        new Setting(card)
            .setName('搜索 API Key')
            .setDesc('仅用于同人考据检索；与其它密钥同一套加密保存')
            .addText(text => {
                text.inputEl.type = 'password';
                // 未解锁时内存里是密文：留空 + 占位提示，绝不把密文当明文展示/回写
                const secretDisplay = describeSecretForInput(cfg.apiKey || '');
                text.setPlaceholder(secretDisplay.placeholder || '留空则只能手动添加来源')
                    .setValue(secretDisplay.value);
                text.inputEl.title = secretDisplay.title;
                // 用 change（失焦/回车）而不是 onChange：逐键保存会触发全量密钥加密 + 写盘
                text.inputEl.addEventListener('change', () => {
                    const next = text.inputEl.value.trim();
                    if (!next) return; // 空值 = 未修改，避免把已加密 Key 清空
                    cfg.apiKey = next;
                    void this.plugin.saveSettings().catch(e => {
                        new Notice(`保存搜索 API Key 失败：${e instanceof Error ? e.message : String(e)}`, 6000);
                    });
                });
            });

        new Setting(card)
            .setName('允许域名')
            .setDesc('逗号分隔；留空表示不限制。示例：qidian.com, fanqienovel.com')
            .addText(text => text
                .setPlaceholder('qidian.com, fanqienovel.com')
                .setValue((cfg.allowedDomains || []).join(', '))
                .onChange(async (value) => {
                    cfg.allowedDomains = value.split(/[,，]/).map(v => v.trim()).filter(Boolean);
                    await this.plugin.saveSettings();
                }));

        new Setting(card)
            .setName('排除域名')
            .setDesc('逗号分隔；同人/衍生站点建议加入这里')
            .addText(text => text
                .setPlaceholder('lofter.com, ao3.org')
                .setValue((cfg.blockedDomains || []).join(', '))
                .onChange(async (value) => {
                    cfg.blockedDomains = value.split(/[,，]/).map(v => v.trim()).filter(Boolean);
                    await this.plugin.saveSettings();
                }));

        // 拆成两条：合并标签「最大来源数 / 单源摘录长度」在设置行里会被
        // 右侧两个输入框挤成一列竖排单字（Obsidian 的 .setting-item-info
        // 是 min-width:0 的 flex 子项，中文可在任意字符处断行）。
        new Setting(card)
            .setName('最大来源数')
            .setDesc('来源越多越容易交叉验证，但也会增加审核成本。')
            .addText(text => text
                .setPlaceholder('6')
                .setValue(String(cfg.maxSources ?? 6))
                .onChange(async (value) => {
                    const n = parseInt(value, 10);
                    cfg.maxSources = Number.isFinite(n) && n > 0 ? n : 6;
                    await this.plugin.saveSettings();
                }));

        new Setting(card)
            .setName('单源摘录长度')
            .setDesc('每个来源只保存审计所需的短文本（字符数）。')
            .addText(text => text
                .setPlaceholder('1200')
                .setValue(String(cfg.excerptChars ?? 1200))
                .onChange(async (value) => {
                    const n = parseInt(value, 10);
                    cfg.excerptChars = Number.isFinite(n) && n >= 200 ? n : 1200;
                    await this.plugin.saveSettings();
                }));
    }

    /**
     * 任务级模型参数。
     *
     * 保留原有 API 设置窗口，只追加一张高级表：
     * 模型 / 最大输入 / 最大输出 / 思考模式 / 思考预算。
     * 不填即继承该任务的默认模型与能力值。
     */
    private renderTaskBudgetRows(section: HTMLElement): void {
        const card = section.createDiv({ cls: 'nw-u-margintop-20px-2' });
        card.createEl('h4', { text: '🧠 任务级模型参数', cls: 'nw-u-m-0-0-6px-0-2 nw-u-fs-14px-2' });
        card.createEl('div', {
            text: '每个任务可单独覆盖模型/输入/输出/思考参数；留空即继承默认值。输出上限不会自动超过模型能力。',
            cls: 'nw-u-fs-12px-2 nw-u-c-text-muted-2 nw-u-marginbottom-8px-2',
        });

        const globalCard = card.createDiv({ cls: 'nw-card' });
        globalCard.addClass('nw-form-stack');
        globalCard.createDiv({ cls: 'nw-form-label', text: '全局思考强度' });
        globalCard.createDiv({
            cls: 'nw-text-12-muted',
            text: '四级预设 + 0–100% 拖拽强度。等级决定默认语义，滑杆可微调实际思考预算；任务级设置优先。',
        });

        const initialLevel = this.plugin.settings.thinkingLevel
            ?? thinkingLevelFromMode(this.plugin.settings.thinkingMode);
        const initialIntensity = this.plugin.settings.thinkingIntensity
            ?? thinkingIntensityFromMode(this.plugin.settings.thinkingMode);
        let currentLevel: ThinkingLevel = initialLevel;

        const levelRow = globalCard.createDiv({ cls: 'nw-u-d-flex-2 nw-u-gap-8px-2 nw-u-fwr-wrap-2 nw-u-margintop-8px-2' });
        const levelButtons = new Map<ThinkingLevel, HTMLButtonElement>();
        const levelDesc = globalCard.createDiv({ cls: 'nw-u-fs-12px-2 nw-u-c-text-muted-2 nw-u-margintop-6px-2' });
        const sliderRow = globalCard.createDiv({ cls: 'nw-u-d-flex-2 nw-u-ai-center-2 nw-u-gap-8px-2 nw-u-margintop-8px-2' });
        const range = sliderRow.createEl('input', {
            type: 'range',
            attr: { min: '0', max: '100', step: '5' },
        }) as HTMLInputElement;
        const percentEl = sliderRow.createSpan({ cls: 'nw-u-fs-12px-2 nw-u-c-text-normal-2' });

        const refreshLevelUi = (level: ThinkingLevel, intensity: number): void => {
            currentLevel = level;
            for (const [key, button] of levelButtons) {
                const active = key === level;
                button.classList.toggle('nw-btn-primary', active);
                button.classList.toggle('nw-btn-secondary', !active);
            }
            range.value = String(intensity);
            percentEl.setText(`${intensity}%`);
            const spec = thinkingLevelSpec(level);
            levelDesc.setText(`${spec.label} · ${intensity}% — ${spec.description}`);
        };

        const persistThinking = async (level: ThinkingLevel, intensity: number): Promise<void> => {
            this.plugin.settings.thinkingLevel = level;
            this.plugin.settings.thinkingIntensity = intensity;
            this.plugin.settings.thinkingMode = thinkingLevelSpec(level).mode;
            await this.plugin.saveSettings();
            this.refreshTaskBudgetPreview?.();
        };

        for (const spec of THINKING_LEVELS) {
            const button = levelRow.createEl('button', {
                text: `${spec.label} ${spec.percent}%`,
                cls: 'nw-btn nw-btn-secondary',
                attr: { type: 'button', title: spec.description },
            });
            levelButtons.set(spec.level, button);
            button.onclick = () => {
                refreshLevelUi(spec.level, spec.percent);
                void persistThinking(spec.level, spec.percent);
            };
        }

        range.oninput = () => {
            const intensity = clampThinkingIntensity(parseInt(range.value, 10));
            refreshLevelUi(nearestThinkingLevel(intensity), intensity);
        };
        range.onchange = () => {
            const intensity = clampThinkingIntensity(parseInt(range.value, 10));
            const level = nearestThinkingLevel(intensity);
            refreshLevelUi(level, intensity);
            void persistThinking(level, intensity);
        };
        refreshLevelUi(initialLevel, initialIntensity);

        // ── 预算档位（唯一的输入/输出调节入口）──────────────────
        // 用户只选一个档位，引擎按任务类别分发输入/输出预算。
        // 旧的 6 张任务卡片各带输入/输出/思考 3 个数字框，共 18 个；
        // 现在这 18 个控件收敛成这一处。
        const globalGrid = globalCard.createDiv({ cls: 'nw-form-grid' });

        const tierField = globalGrid.createDiv({ cls: 'nw-form-field' });
        tierField.createEl('label', { cls: 'nw-form-label', text: '预算档位' });
        const tierSelect = tierField.createEl('select', { cls: 'nw-select' });
        for (const spec of BUDGET_TIERS) {
            tierSelect.createEl('option', {
                value: spec.value,
                text: spec.label,
                attr: { title: spec.description },
            });
        }
        tierSelect.value = normalizeBudgetTier(this.plugin.settings.budgetTier);
        const tierDesc = tierField.createDiv({ cls: 'nw-text-12-muted' });
        const syncTierDesc = (): void => {
            const spec = budgetTierSpec(tierSelect.value as BudgetTier);
            tierDesc.setText(spec.description);
            tierSelect.setAttr('title', spec.description);
        };
        syncTierDesc();

        const globalBudgetField = globalGrid.createDiv({ cls: 'nw-form-field' });
        globalBudgetField.createEl('label', { cls: 'nw-form-label', text: '思考预算上限（0=按强度自动）' });
        const globalBudget = globalBudgetField.createEl('input', {
            type: 'text',
            cls: 'nw-input',
            attr: { placeholder: '0' },
        });
        globalBudget.value = String(this.plugin.settings.thinkingBudget || 0);

        tierSelect.onchange = async () => {
            this.plugin.settings.budgetTier = normalizeBudgetTier(tierSelect.value);
            syncTierDesc();
            await this.plugin.saveSettings();
            this.refreshTaskBudgetPreview?.();
        };

        globalBudget.onchange = async () => {
            const n = parseInt(globalBudget.value, 10);
            this.plugin.settings.thinkingBudget = Number.isFinite(n) && n > 0 ? n : 0;
            await this.plugin.saveSettings();
            this.refreshTaskBudgetPreview?.();
        };

        // ── 预算分发表（只读）────────────────────────────────────
        // 旧版给 6 个任务各渲染一张卡片（模型/输入/输出/思考等级/思考预算），
        // 共 30 个控件，用户要保证它们彼此一致。现在统一由
        // shared/task-budget-engine.ts 分发，这里只展示推导结果。
        const previewCard = card.createDiv({ cls: 'nw-card' });
        previewCard.addClass('nw-form-stack');
        previewCard.createDiv({ cls: 'nw-form-label', text: '预算分发结果（只读）' });
        previewCard.createDiv({
            cls: 'nw-text-12-muted',
            text: '引擎按任务类别把上面的档位与强度分发到每个任务。数字会随档位、强度、模型切换实时变化。',
        });

        const previewList = previewCard.createDiv({ cls: 'nw-budget-preview' });

        const categoryLabel: Record<string, string> = {
            planning: '规划',
            writing: '正文',
            analysis: '分析',
        };
        const previewTasks: AiTask[] = ['planning', 'body', 'analysis', 'quality', 'deconstruction', 'fingerprint'];
        const previewTaskLabels: Record<string, string> = {
            planning: '规划',
            body: '正文',
            analysis: '分析报告',
            quality: '质量控制',
            deconstruction: '拆解 LLM',
            fingerprint: '指纹提取',
        };

        // 用卡片列表而不是表格：设置面板通常只有 300–400px 宽，
        // 6 列表格必然横向滚动，把「输入/输出/思考」三列挤到视野外。
        const renderPreview = (): void => {
            previewList.empty();
            for (const task of previewTasks) {
                const effective = resolveTaskModelConfig(
                    this.plugin.settings,
                    task,
                    (model, endpoint) => this.plugin.resolveModelLimits(model, endpoint),
                );
                const row = previewList.createDiv({ cls: 'nw-budget-row' });
                const head = row.createDiv({ cls: 'nw-budget-row-head' });
                head.createSpan({ cls: 'nw-budget-task', text: previewTaskLabels[task] || task });
                head.createSpan({
                    cls: 'nw-budget-cat',
                    text: categoryLabel[TASK_CATEGORY[task]] || TASK_CATEGORY[task],
                });
                row.createDiv({
                    cls: 'nw-budget-row-model',
                    text: effective.model,
                    attr: { title: effective.model },
                });
                const thinking = effective.thinkingBudget > 0
                    ? effective.thinkingBudget.toLocaleString()
                    : '—';
                row.createDiv({
                    cls: 'nw-budget-row-numbers',
                    text: '输入 ' + effective.maxInput.toLocaleString()
                        + ' · 输出 ' + effective.maxOutput.toLocaleString()
                        + ' · 思考 ' + thinking,
                });
            }
        };
        renderPreview();

        // 档位变化后刷新预览（不必重建整个设置页）
        const refreshPreview = () => renderPreview();
        this.refreshTaskBudgetPreview = refreshPreview;

        // ── 已保存的任务级覆盖 ──────────────────────────────────
        const overrides = this.plugin.settings.taskBudgets || {};
        const overrideKeys = Object.keys(overrides).filter(key => {
            const entry = overrides[key as AiTask];
            return entry && (
                entry.model !== undefined
                || entry.maxInputTokens !== undefined
                || entry.maxOutputTokens !== undefined
                || entry.thinkingLevel !== undefined
                || entry.thinkingIntensity !== undefined
                || entry.thinkingBudget !== undefined
                || entry.thinkingMode !== undefined
            );
        });

        new Setting(previewCard)
            .setName('任务级覆盖')
            .setDesc(overrideKeys.length > 0
                ? `检测到 ${overrideKeys.length} 个任务存在旧的手工覆盖（${overrideKeys.join('、')}）。这些值仍优先于引擎，可一键清除交由引擎接管。`
                : '没有手工覆盖，全部由引擎分发。')
            .addButton(btn => btn
                .setButtonText(overrideKeys.length > 0 ? '清除全部覆盖' : '已由引擎接管')
                .setDisabled(overrideKeys.length === 0)
                .onClick(async () => {
                    this.plugin.settings.taskBudgets = {};
                    await this.plugin.saveSettings();
                    this.refresh();
                    new Notice('✅ 已清除任务级覆盖，改由引擎分发');
                }));
    }

    /** 由 renderTaskBudgetRows 注册，档位/强度变化后刷新只读分发表 */
    private refreshTaskBudgetPreview: (() => void) | null = null;
}
