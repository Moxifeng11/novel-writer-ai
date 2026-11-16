/**
 * api-section.ts — 「API 配置」分区
 *
 * 职责：API 供应商配置（侧栏/详情/模型列表/连通性）、全局模型分配、
 * 密钥加密状态与口令、同人考据来源、任务级模型参数。
 * 来源：原 settings-tab.ts L99-L1363。
 * 依赖：宿主提供的 app/plugin/refresh/reopen（见 section-base.ts），
 * 以及 api-format、model-discovery、task-model、task-budget-engine 等共享模块。
 */
import { Setting, Notice, Menu } from 'obsidian';
import { CustomProvider } from '@/main';
import {
    defaultHeadersForProvider,
    describeLimitSource,
    describeLimitSourceLabel,
    describeThinkingLevel,
    parseHeaderLines,
    resolveProviderHeaders,
    resolveThinkingCapability,
    serializeHeaderLines,
    thinkingBudgetFromLevel,
} from '@/shared/provider-ui-model';
import { ModelEditorModal } from '@/ui/model-editor-modal';
import { CanonResearchService, PROVIDER_LABELS } from '@/services/canon-research-service';
import { normalizeMcpServers } from '@/shared/mcp-config';
import { API_FORMAT_OPTIONS, normalizeApiFormat, resolveEffectiveRequestUrl, type ApiFormat } from '@/shared/api-format';
import { discoverModels } from '@/services/model-discovery';
import { ModelPickerModal } from '@/ui/model-picker-modal';
import { PasswordModal } from '@/ui/password-modal';
import { describeKeyEncryptionStatus, describeSecretForInput, isStoredCiphertext, SECRET_INPUT_ATTRS } from '@/shared/secret-display';
import { getDetectedModelCapability, lookupModelCapability } from '@/shared/model-capabilities';
import { testProviderConnectivity } from '@/services/api-connectivity-service';
import { renderCollapsibleSection } from '@/ui/settings-utils';
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
import { showErrorNotice, showSuccessNotice, showWarningNotice } from '@/ui/components/notice-helpers';
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

    /** 侧栏「新建供应商」行内表单是否展开（替代弹窗） */
    private newProviderFormOpen = false;

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
    /** 模型单价摘要：美元显示 $，人民币显示 ¥（输入/输出，每百万 tokens） */
    private formatModelPrice(meta: {
        inputPricePerM?: number;
        outputPricePerM?: number;
        priceCurrency?: 'USD' | 'CNY';
    } | undefined): string {
        const input = meta?.inputPricePerM;
        const output = meta?.outputPricePerM;
        if (!Number.isFinite(input) && !Number.isFinite(output)) return '';
        const symbol = meta?.priceCurrency === 'USD' ? '$' : '¥';
        const fmt = (value: number | undefined): string => (Number.isFinite(value) ? String(value) : '0');
        return `${symbol}${fmt(input)}/${symbol}${fmt(output)}`;
    }

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
        // 密钥加密状态放最上面：下载/重装/换设备后第一件事往往是「解锁 Key」
        this.renderKeyUnlockCard(section);

        const layout = section.createDiv({ cls: 'nw-api-layout' });
        this.renderProviderSidebar(layout.createDiv({ cls: 'nw-api-sidebar' }), providers, selectedId, currentId);

        const detail = layout.createDiv({ cls: 'nw-api-detail' });
        if (!selectedId) {
            detail.createDiv({
                cls: 'nw-api-empty',
                text: '还没有供应商。点击右上角「＋ 添加供应商」创建第一个。',
            });
            this.renderApiGlobalSettings(detail, '');
            return;
        }
        this.renderProviderDetail(detail, selectedId);
        this.renderApiGlobalSettings(detail, selectedId);
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
            showSuccessNotice('已恢复默认供应商');
            this.refresh();
        };

        const addBtn = actions.createEl('button', {
            cls: 'nw-api-primary-btn',
            attr: { type: 'button' },
        });
        addBtn.setText('＋ 添加供应商');
        addBtn.onclick = () => {
            this.newProviderFormOpen = true;
            this.refresh();
        };
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
                const assignment = this.plugin.getProviderAssignment(provider.id);
                if (assignment.defaultModel) {
                    row.createSpan({
                        cls: 'nw-api-sidebar-model',
                        text: assignment.defaultModel,
                        attr: { title: '默认模型：' + assignment.defaultModel },
                    });
                }
                if (!this.plugin.isProviderEnabled(provider.id)) {
                    row.createSpan({ cls: 'nw-api-sidebar-muted', text: '已隐藏', attr: { title: '不在其他模块显示' } });
                }
                row.createSpan({
                    cls: 'nw-api-sidebar-dot' + (isCurrent ? ' nw-api-sidebar-dot-current' : ''),
                    attr: { title: isCurrent ? '当前使用中' : '可用' },
                });
                row.onclick = () => {
                    this.apiSelectedProviderId = provider.id;
                    this.refresh();
                };
            }
        }

        // 行内新建供应商（替代原来的「添加供应商」弹窗）：直接在侧栏填完创建
        if (this.newProviderFormOpen) {
            this.renderNewProviderForm(container);
        } else {
            const add = container.createEl('button', {
                cls: 'nw-api-sidebar-add',
                text: '＋ 新建供应商',
                attr: { type: 'button' },
            });
            add.onclick = () => {
                this.newProviderFormOpen = true;
                this.refresh();
            };
        }
    }

    /**
     * 侧栏行内新建供应商表单（名称 / Base URL / 协议 / Key 一次填完）。
     *
     * @param container - 侧栏容器
     */
    private renderNewProviderForm(container: HTMLElement): void {
        const form = container.createDiv({ cls: 'nw-api-new-provider' });
        form.createDiv({ cls: 'nw-api-sidebar-group', text: '新建供应商' });
        let nameValue = '';
        let endpointValue = '';
        let formatValue: ApiFormat = 'openai-chat';
        let keyValue = '';

        new Setting(form)
            .setName('名称')
            .addText(text => text.setPlaceholder('我的代理').onChange(value => { nameValue = value; }));
        new Setting(form)
            .setName('Base URL')
            .setDesc('可带也可不带 /v1')
            .addText(text => text.setPlaceholder('https://api.example.com').onChange(value => { endpointValue = value.trim(); }));
        new Setting(form)
            .setName('API 格式')
            .addDropdown(dropdown => {
                for (const option of API_FORMAT_OPTIONS) dropdown.addOption(option.value, option.label);
                dropdown.setValue(formatValue);
                dropdown.onChange(value => { formatValue = normalizeApiFormat(value); });
            });
        new Setting(form)
            .setName('API Key')
            .addText(text => {
                text.inputEl.type = 'password';
                text.setPlaceholder('sk-...').onChange(value => { keyValue = value.trim(); });
            });
        new Setting(form)
            .addButton(button => button.setButtonText('取消').onClick(() => {
                this.newProviderFormOpen = false;
                this.refresh();
            }))
            .addButton(button => button
                .setButtonText('创建')
                .setCta()
                .onClick(async () => {
                    if (!nameValue.trim()) { new Notice('请输入名称'); return; }
                    if (!endpointValue) { new Notice('请输入 Base URL'); return; }
                    const id = this.plugin.addCustomProvider(
                        nameValue.trim(),
                        endpointValue,
                        ['default-model'],
                        128000,
                        32768,
                        keyValue,
                        formatValue,
                    );
                    if (!id) return;
                    await this.plugin.saveSettings();
                    this.plugin.updateStatusBarText();
                    this.newProviderFormOpen = false;
                    this.apiSelectedProviderId = id;
                    showSuccessNotice('已创建供应商，可点「从 URL 获取」导入模型', { timeout: 5000 });
                    this.refresh();
                }));
    }

    /** 密钥加密卡片（放页面顶部，解锁优先） */
    private renderKeyUnlockCard(section: HTMLElement): void {
        const service = this.plugin.getSettingsService?.();
        const locked = service?.lockedSecretCount?.() ?? 0;
        const card = section.createDiv({
            cls: 'nw-api-key-card' + (locked > 0 ? ' nw-api-key-card-locked' : ''),
        });
        if (locked > 0) {
            card.createDiv({ cls: 'nw-api-key-card-title', text: '🔒 密钥已加密锁定' });
            card.createDiv({
                cls: 'nw-api-key-card-hint',
                text: `有 ${locked} 项密钥尚未解锁，解锁后各渠道 Key 才能正常使用。`,
            });
        }
        this.renderKeyEncryptionRows(card);
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

        // 「使用中」= 当前渠道（切换它）；「在其他模块显示」= 快切/工作台/协同是否列出该渠道（启用语义）
        const isCurrent = providerId === this.plugin.getCurrentProviderId();
        if (isCurrent) {
            head.createSpan({ cls: 'nw-api-current-pill', text: '使用中' });
        } else {
            const useBtn = head.createEl('button', {
                cls: 'nw-api-ghost-btn',
                text: '设为当前',
                attr: { type: 'button', title: '把该供应商切换为当前使用渠道' },
            });
            useBtn.onclick = async () => {
                this.plugin.switchProviderByEndpoint(raw.endpoint);
                await this.plugin.saveSettings();
                this.plugin.updateStatusBarText();
                showSuccessNotice(`已切换到「${raw.name}」`);
                this.apiSelectedProviderId = providerId;
                rerender();
            };
        }

        const visible = this.plugin.isProviderEnabled(providerId);
        const visibleLabel = head.createEl('label', { cls: 'nw-api-switch', attr: { title: '在其他模块显示该渠道' } });
        const visibleToggle = visibleLabel.createEl('input', { type: 'checkbox' });
        visibleToggle.checked = visible;
        visibleLabel.toggleClass('nw-is-active', visible);
        visibleLabel.createSpan({ cls: 'nw-api-switch-text', text: '在其他模块显示' });
        visibleToggle.addEventListener('change', async () => {
            visibleLabel.toggleClass('nw-is-active', visibleToggle.checked);
            this.plugin.setProviderEnabled(providerId, visibleToggle.checked);
            await this.plugin.saveSettings();
            this.plugin.updateStatusBarText();
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
                    showErrorNotice('该供应商不存在或属于预设项', { title: '删除失败', timeout: 5000 });
                    return;
                }
                await this.plugin.saveSettings();
                this.plugin.updateStatusBarText();
                this.apiSelectedProviderId = null;
                rerender();
                showSuccessNotice(`已删除「${raw.name}」`);
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
                showSuccessNotice(`已切换为 ${API_FORMAT_OPTIONS.find(o => o.value === select.value)?.label ?? select.value}`);
            });
        }, `请求路径：${API_FORMAT_OPTIONS.map(o => `${o.label} → ${o.path}`).join('；')}`);

        // ── 实际请求 URL（方案 C）──
        // 推导结果必须可见、可改：旧版只显示「由下方协议推导」，用户不知道最终会打到哪个地址，
        // 自建网关/特殊路径只能靠猜。
        this.renderField(container, '实际请求 URL', (field) => {
            const derived = resolveEffectiveRequestUrl(raw.endpoint, format);
            let override = raw.requestUrlOverride?.trim() || '';
            const input = field.createEl('input', {
                cls: 'nw-api-text-input',
                attr: {
                    type: 'text',
                    spellcheck: 'false',
                    placeholder: derived || 'https://api.example.com/v1/chat/completions',
                },
            });
            input.value = override;
            const hint = field.createEl('div', { cls: 'nw-api-hint' });
            const syncHint = (): void => {
                const effective = resolveEffectiveRequestUrl(raw.endpoint, format, override);
                hint.setText(override
                    ? `覆盖中：${effective}（清空输入即恢复自动）`
                    : `自动推导：${derived || '（先填 Base URL）'}`);
            };
            syncHint();
            input.addEventListener('change', async () => {
                const next = input.value.trim();
                this.plugin.updateProvider(raw.id, { requestUrlOverride: next || undefined });
                await this.plugin.saveSettings();
                override = next;
                syncHint();
                showSuccessNotice(next ? '已固定实际请求 URL' : '已恢复自动推导', { timeout: 3000 });
            });
            const reset = field.createEl('button', {
                cls: 'nw-api-ghost-btn',
                text: '恢复自动',
                attr: { type: 'button' },
            });
            reset.onclick = async () => {
                input.value = '';
                this.plugin.updateProvider(raw.id, { requestUrlOverride: undefined });
                await this.plugin.saveSettings();
                override = '';
                syncHint();
                showSuccessNotice('已恢复自动推导', { timeout: 3000 });
            };
        }, '留空 = 按 Base URL + 协议自动推导；填写后「所见即所发」，测试与生成都打这个地址');

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
                attr: { ...SECRET_INPUT_ATTRS, placeholder: display.placeholder, title: display.title },
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
                const outcome = await this.plugin.saveSettingsWithOutcome();
                // S3-8：口令未解锁时新密钥并未写入，不能提示「已保存」
                if (outcome.droppedSecrets.length > 0) {
                    showWarningNotice('密钥未保存：当前口令未解锁，请先解锁后再保存');
                } else {
                    showSuccessNotice('密钥已保存');
                }
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

        // 连通性测试已下放到模型列表的每个模型行（见 renderProviderDetail 的 model row）：
        // 渠道级按钮测不出「测的是哪个模型」，失败也无法定位。

        // ── 能力与高级项（折叠）：思考强度按渠道自动识别、图片输入、请求头 ──
        renderCollapsibleSection(container, '渠道能力与高级项', false, inner => {
            this.renderProviderCapabilityRows(inner, raw);
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
                // 模型列表按「实际请求 URL」推导（覆盖时不再用 Base URL），保持与生成同源
                const listEndpoint = resolveEffectiveRequestUrl(raw.endpoint, format, raw.requestUrlOverride);
                const result = await discoverModels(listEndpoint, format, key, undefined, resolveProviderHeaders(raw));
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
                            ...(item.vision === undefined ? {} : { vision: item.vision }),
                            ...(item.inputPricePerM === undefined ? {} : { inputPricePerM: item.inputPricePerM }),
                            ...(item.outputPricePerM === undefined ? {} : { outputPricePerM: item.outputPricePerM }),
                            ...(item.priceCurrency === undefined ? {} : { priceCurrency: item.priceCurrency }),
                        };
                    }
                    this.plugin.updateProvider(raw.id, { models, modelMeta: meta });
                    this.syncAvailableModels(raw.id);
                    await this.plugin.saveSettings();
                    this.plugin.updateStatusBarText();
                    showSuccessNotice(`已更新模型列表（${models.length} 个）`, { timeout: 4000 });
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
        addModelBtn.onclick = () => this.openModelEditor(raw, '');

        const list = modelsBlock.createDiv({ cls: 'nw-api-model-list nw-u-maxh-240px nw-u-ovy-auto-2' });
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
            if (capacity) {
                const source = describeLimitSource(raw, modelId, false, getDetectedModelCapability(modelId) !== null);
                main.createSpan({
                    cls: 'nw-api-model-badge',
                    text: capacity,
                    attr: { title: `${contextWindow} tokens（来源：${describeLimitSourceLabel(source)}）` },
                });
            }
            if (meta?.vision) main.createSpan({ cls: 'nw-api-model-badge', text: '视觉' });
            // M-20：单价按渠道识别后直接展示，用户不用点进编辑也能确认「费用是按什么价在算」
            const price = this.formatModelPrice(meta);
            if (price) main.createSpan({ cls: 'nw-api-model-badge nw-api-model-price', text: price });

            const rowActions = row.createDiv({ cls: 'nw-api-model-actions' });

            // 每个模型行独立测试：旧实现在密钥下方放一个渠道级按钮，用户不知道测的是哪个模型
            // （当前渠道用 defaultModel，非当前渠道用第一个启用模型），失败也无法定位到具体模型。
            const testBtn = rowActions.createEl('button', {
                cls: 'nw-api-icon-btn',
                attr: { type: 'button', title: '测试该模型连通性' },
            });
            testBtn.setText('🔌');
            testBtn.onclick = async () => {
                if (testBtn.disabled) return;
                testBtn.disabled = true;
                testBtn.setText('⏳');
                // 结果不塞在模型行里（长错误会把行撑变形）：统一写到模型列表下方的结果区
                this.appendModelTestResult(raw.id, modelId, { level: 'pending', message: '正在测试…' });
                try {
                    const result = await testProviderConnectivity({
                        providerName: raw.name,
                        endpoint: raw.endpoint,
                        model: modelId,
                        apiKey: this.plugin.settings.providerKeys?.[raw.id] || '',
                        sourceType: raw.sourceType === 'local' ? 'local' : 'cloud',
                        apiFormat: format,
                        headers: resolveProviderHeaders(raw),
                        requestUrl: resolveEffectiveRequestUrl(raw.endpoint, format, raw.requestUrlOverride),
                    });
                    this.appendModelTestResult(raw.id, modelId, result);
                } finally {
                    testBtn.disabled = false;
                    testBtn.setText('🔌');
                }
            };

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
            editBtn.onclick = () => this.openModelEditor(raw, modelId);

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

        // 连通性测试结果区：独立在模型列表下方，不放模型行内（长错误会撑变形）
        const resultsBox = modelsBlock.createDiv({ cls: 'nw-api-test-results' });
        this.modelTestResultsEl = resultsBox;
        this.renderModelTestResults(raw.id);
    }

    /** 当前渲染的测试结果容器（append 后局部重绘，避免整页刷新） */
    private modelTestResultsEl: HTMLElement | null = null;

    /** 每个渠道各模型最近一次的连通性测试结果 */
    private modelTestResults = new Map<string, Map<string, {
        level: 'ok' | 'warn' | 'error' | 'pending';
        message: string;
        at: number;
    }>>();

    /**
     * 记录并展示某个模型的连通性测试结果。
     *
     * @param providerId - 渠道 id
     * @param modelId - 模型 id
     * @param result - 测试结果
     */
    private appendModelTestResult(
        providerId: string,
        modelId: string,
        result: { level: 'ok' | 'warn' | 'error' | 'pending'; message: string },
    ): void {
        const bucket = this.modelTestResults.get(providerId) ?? new Map();
        bucket.set(modelId, { ...result, at: Date.now() });
        this.modelTestResults.set(providerId, bucket);
        this.renderModelTestResults(providerId);
    }

    /**
     * 渲染测试结果区（按渠道隔离；只在该渠道的详情页出现）。
     *
     * @param providerId - 渠道 id
     */
    private renderModelTestResults(providerId: string): void {
        const box = this.modelTestResultsEl;
        if (!box) return;
        box.empty();
        const bucket = this.modelTestResults.get(providerId);
        if (!bucket || bucket.size === 0) return;
        const head = box.createDiv({ cls: 'nw-api-test-results-head' });
        head.createSpan({ text: '连通性测试结果' });
        const clear = head.createEl('button', {
            cls: 'nw-api-ghost-btn',
            text: '清空',
            attr: { type: 'button' },
        });
        clear.onclick = () => {
            this.modelTestResults.delete(providerId);
            this.renderModelTestResults(providerId);
        };
        for (const [modelId, result] of bucket) {
            const icon = result.level === 'ok' ? '✅' : result.level === 'warn' ? '⚠️' : result.level === 'pending' ? '⏳' : '❌';
            box.createDiv({
                cls: 'nw-api-test-result-row' + (result.level === 'pending' ? '' : ` nw-api-test-status-${result.level}`),
                text: `${icon} ${modelId}：${result.message}`,
            });
        }
    }

    /**
     * 渠道能力与高级项：思考强度（按渠道自动识别）、图片输入、自定义请求头。
     *
     * @param container - 容器
     * @param raw - 供应商原始配置
     */
    private renderProviderCapabilityRows(container: HTMLElement, raw: CustomProvider): void {
        // 按「该渠道当前分配的默认模型」判定，而不是永远拿 models[0]：
        // 一个渠道里不同模型的思考能力可能不同（有的支持 reasoning，有的纯文本）。
        const assignment = this.plugin.getProviderAssignment(raw.id);
        const capabilityModel = assignment.defaultModel || raw.models[0] || '';
        const capability = resolveThinkingCapability(raw, capabilityModel);
        if (capability.supported) {
            const thinking = this.plugin.getProviderThinking(raw.id);
            const mode = thinking.mode === 'off' ? 0 : Math.round((thinking.budget ?? 0) / 128);
            new Setting(container)
                .setName('思考强度')
                .setDesc(`${capability.hint}（${capabilityModel ? `按 ${capabilityModel} 判定` : '按渠道判定'}）；当前：${describeThinkingLevel(mode)}`)
                .addDropdown(dropdown => {
                    dropdown.addOption('0', '关闭');
                    dropdown.addOption('30', '低（快速）');
                    dropdown.addOption('60', '中（平衡）');
                    dropdown.addOption('85', '高（深入）');
                    dropdown.setValue(String(mode === 0 ? 0 : mode >= 80 ? 85 : mode >= 50 ? 60 : 30));
                    dropdown.onChange(async (value) => {
                        const level = Number(value) || 0;
                        this.plugin.setProviderThinking(raw.id, {
                            mode: level > 0 ? 'on' : 'off',
                            budget: thinkingBudgetFromLevel(level),
                        });
                        await this.plugin.saveSettings();
                        this.refresh();
                    });
                });
        } else {
            new Setting(container)
                .setName('思考强度')
                .setDesc(`${capability.hint}（该渠道不显示强度设置）`);
        }

        const visionModels = raw.models.filter(model => raw.modelMeta?.[model]?.vision);
        new Setting(container)
            .setName('图片输入')
            .setDesc(visionModels.length > 0
                ? `支持：${visionModels.slice(0, 6).join('、')}${visionModels.length > 6 ? ' …' : ''}`
                : '该渠道暂未标记支持图片输入的模型（可在模型编辑里勾选「支持图片输入」）');

        const headerDefault = defaultHeadersForProvider(raw);
        let headerText = serializeHeaderLines(raw.headers);
        new Setting(container)
            .setName('自定义请求头')
            .setDesc(headerDefault.note + '；每行一个 `Key: Value`，自定义值覆盖内置默认')
            .addTextArea(text => {
                text.inputEl.rows = 3;
                text.setPlaceholder('HTTP-Referer: https://example.com\nX-Title: novel-writer')
                    .setValue(headerText)
                    .onChange(async (value) => {
                        headerText = value;
                    });
                text.inputEl.addEventListener('blur', async () => {
                    const headers = parseHeaderLines(headerText);
                    this.plugin.updateProvider(raw.id, { headers });
                    await this.plugin.saveSettings();
                });
            });
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
        // 模型列表可能被用户清空（取消全部勾选）：此时 availableModels 为空，
        // 不能把 defaultModel/flashModel/proModel 写成 undefined（会让请求回落到兜底模型），
        // 保持旧值并提示用户在模型列表里补回或切换渠道。
        if (settings.availableModels.length === 0) {
            showWarningNotice('该渠道已没有模型：请在模型列表里「从 URL 获取」或手动添加', { timeout: 8000 });
            return;
        }
        for (const key of ['defaultModel', 'flashModel', 'proModel'] as const) {
            if (!settings.availableModels.includes(settings[key])) {
                settings[key] = settings.availableModels[0];
            }
        }
    }

    /**
     * 打开模型编辑弹窗（M-21）。
     *
     * 从行内编辑改为弹窗：窄面板里行内表单会把模型 ID 挤成竖排单字，
     * 且六个字段要横向滚动才能看全。弹窗一次展示完整，保存后即改即存。
     *
     * @param raw - 当前渠道
     * @param modelId - 要编辑的模型 id；空字符串表示新增
     */
    private openModelEditor(raw: CustomProvider, modelId: string): void {
        const current = this.getRawProvider(raw.id);
        if (!current) return;
        const meta = current.modelMeta?.[modelId] ?? {};
        new ModelEditorModal(this.app, modelId ? '编辑模型' : '新增模型', {
            id: modelId,
            contextWindow: meta.contextWindow,
            maxTokens: meta.maxTokens,
            inputPricePerM: meta.inputPricePerM,
            outputPricePerM: meta.outputPricePerM,
            priceCurrency: meta.priceCurrency,
            vision: meta.vision,
        }, async (value) => {
            const latest = this.getRawProvider(raw.id);
            if (!latest) return;
            const models = [...latest.models];
            if (modelId) {
                const index = models.indexOf(modelId);
                if (index >= 0) models[index] = value.id;
                else models.push(value.id);
            } else if (!models.includes(value.id)) {
                models.push(value.id);
            }
            const modelMeta = { ...(latest.modelMeta || {}) };
            if (modelId && modelId !== value.id) delete modelMeta[modelId];
            modelMeta[value.id] = {
                ...(value.contextWindow ? { contextWindow: value.contextWindow } : {}),
                ...(value.maxTokens ? { maxTokens: value.maxTokens } : {}),
                ...(value.inputPricePerM ? { inputPricePerM: value.inputPricePerM } : {}),
                ...(value.outputPricePerM ? { outputPricePerM: value.outputPricePerM } : {}),
                ...(value.priceCurrency ? { priceCurrency: value.priceCurrency } : {}),
                vision: value.vision === true,
            };
            this.plugin.updateProvider(raw.id, { models, modelMeta });
            this.syncAvailableModels(raw.id);
            await this.plugin.saveSettings();
            this.plugin.updateStatusBarText();
            showSuccessNotice('已保存模型设置', { timeout: 3000 });
            this.refresh();
        }).open();
    }

    /**
     * 密钥加密状态 + 口令重置：解锁优先（卡片已放到页面顶部）。
     *
     * 状态：磁盘上还有多少项密钥处于加密状态。
     * 解锁：输入已有口令（不会再让你「重设」口令）。
     * 重置：设定新口令后，能读到的明文会重新加密；解不开的旧密文会被清空并提示重填。
     */
    private renderKeyEncryptionRows(container: HTMLElement): void {
        const service = this.plugin.getSettingsService?.();
        const locked = service?.lockedSecretCount?.() ?? 0;
        const legacy = service?.legacySecretCount?.() ?? 0;
        const encrypted = service?.hasEncryptedSecrets?.() ?? false;
        const status = describeKeyEncryptionStatus({ locked, encrypted, legacy });

        const row = new Setting(container)
            .setName('密钥加密')
            .setDesc(status.text);

        row.addButton(btn => btn
            .setButtonText(locked > 0 ? '🔓 输入口令解锁' : '🔐 设定口令')
            .onClick(async () => {
                if (locked > 0) {
                    const password = await PasswordModal.ask(this.app);
                    if (!password) return;
                    const ok = await this.plugin.verifySettingsPassword?.(password);
                    if (ok === false) {
                        showErrorNotice('口令不正确，密钥仍未解锁', { timeout: 6000 });
                        return;
                    }
                    this.plugin.setSessionPassword?.(password);
                    await this.plugin.loadSettings();
                    this.refresh();
                    showSuccessNotice('已解锁，密钥可正常读取');
                    return;
                }
                const password = await PasswordModal.setup(this.app);
                if (!password) return;
                this.plugin.setSessionPassword?.(password);
                await this.plugin.saveSettings();
                this.refresh();
                showSuccessNotice('已启用密钥加密');
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
                if (result.cleared.length > 0) {
                    showWarningNotice(
                        `已重设口令：重新加密 ${result.reencrypted} 项；${result.cleared.join('、')} 需要重新填写`,
                        { timeout: 10000 },
                    );
                } else {
                    showSuccessNotice(`已重设口令：重新加密 ${result.reencrypted} 项`, { timeout: 10000 });
                }
            }));
    }

    /** 全局模型分配与上限：按渠道分别记忆，切换渠道自动恢复（折叠） */
    private renderApiGlobalSettings(container: HTMLElement, providerId: string): void {
        const wrap = container.createDiv({ cls: 'nw-api-global' });
        renderCollapsibleSection(wrap, '全局模型分配（按渠道分别记忆）', false, inner => {
            const provider = this.plugin.getAllProviders().find(item => item.id === providerId);
            if (!provider) {
                inner.createEl('p', { cls: 'nw-api-global-hint', text: '先在左侧选择或创建一个供应商。' });
                return;
            }
            const models = provider.models.length > 0 ? provider.models : ['default-model'];
            const assignment = this.plugin.getProviderAssignment(provider.id);
            const isCurrent = provider.id === this.plugin.getCurrentProviderId();
            inner.createEl('p', {
                cls: 'nw-api-global-hint',
                text: isCurrent
                    ? `当前渠道：${provider.name}（改动立即生效）`
                    : `渠道：${provider.name}（非当前渠道，改动只对该渠道记忆，切换过去后应用）`,
            });
            const addModelSelect = (
                label: string,
                desc: string,
                value: string,
                onChange: (next: string) => void,
            ): void => {
                new Setting(inner)
                    .setName(label)
                    .setDesc(desc)
                    .addDropdown(dropdown => {
                        for (const model of models) dropdown.addOption(model, model);
                        if (value && !models.includes(value)) dropdown.addOption(value, `${value}（已失效）`);
                        dropdown.setValue(value);
                        dropdown.onChange(onChange);
                    });
            };
            addModelSelect('默认模型', '未单独指定的任务使用', assignment.defaultModel, async (value) => {
                this.plugin.setProviderAssignment(provider.id, { ...assignment, defaultModel: value });
                await this.plugin.saveSettings();
                this.plugin.updateStatusBarText();
                this.refresh();
            });
            addModelSelect('Flash 模型（大纲/分析/规划）', '大纲骨架、分析报告、元素提取', assignment.flashModel, async (value) => {
                this.plugin.setProviderAssignment(provider.id, { ...assignment, flashModel: value });
                await this.plugin.saveSettings();
                this.plugin.updateStatusBarText();
                this.refresh();
            });
            addModelSelect('Pro 模型（正文/角色/实体）', '正文创作、角色生成、设定任务', assignment.proModel, async (value) => {
                this.plugin.setProviderAssignment(provider.id, { ...assignment, proModel: value });
                await this.plugin.saveSettings();
                this.plugin.updateStatusBarText();
                this.refresh();
            });

            const currentModel = assignment.defaultModel;
            const rawProvider = this.getRawProvider(provider.id);
            const override = this.plugin.settings.modelOverrides[provider.endpoint]?.[currentModel];
            const defaults = this.plugin.resolveModelLimits(currentModel, provider.endpoint);
            const detected = getDetectedModelCapability(currentModel) !== null;

            // 上限默认按「该渠道该模型」自动识别，输入框只作为手动覆盖；
            // 清空输入 = 回到自动（旧实现清空会把自动值固化成覆盖）。
            const removeOverride = (field: 'maxContext' | 'maxOutput'): void => {
                this.plugin.clearProviderModelOverride(provider.id, currentModel, field);
                void this.plugin.saveSettings();
            };
            const limitRows: Array<{ field: 'maxContext' | 'maxOutput'; label: string; value: number }> = [
                { field: 'maxContext', label: '最大上下文', value: defaults.maxContext },
                { field: 'maxOutput', label: '最大输出', value: defaults.maxOutput },
            ];
            for (const row of limitRows) {
                const source = describeLimitSource(
                    rawProvider,
                    currentModel,
                    override?.[row.field] !== undefined,
                    detected,
                );
                const hasOverride = override?.[row.field] !== undefined;
                new Setting(inner)
                    .setName(row.label)
                    .setDesc(`${currentModel}：自动识别 ${row.value.toLocaleString()} tokens（来源：${describeLimitSourceLabel(source)}）`
                        + (hasOverride ? ' · ⚠️ 当前为手动覆盖，清空输入可恢复自动' : ' · 留空即自动'))
                    .addText(text => text
                        .setPlaceholder(String(row.value))
                        .setValue(hasOverride ? String(override?.[row.field]) : '')
                        .onChange(value => {
                            const trimmed = value.trim();
                            if (!trimmed) {
                                removeOverride(row.field);
                                return;
                            }
                            const parsed = parseInt(trimmed, 10);
                            if (!Number.isFinite(parsed) || parsed <= 0) {
                                new Notice('请输入大于 0 的 token 数；清空表示自动识别');
                                return;
                            }
                            this.plugin.setProviderModelOverride(provider.id, currentModel, row.field, parsed);
                            void this.plugin.saveSettings();
                        }));
            }
        });

        renderCollapsibleSection(wrap, '任务级模型参数（按渠道记忆）', false, inner => this.renderTaskBudgetRows(inner, providerId));
        renderCollapsibleSection(wrap, '同人考据来源', false, inner => this.renderCanonResearchRows(inner));
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
            text: '同人设定以原著/官方资料为优先依据；没有官方来源时可用百科/wiki 二手资料补充（会标注等级），'
                + '同人、改编、外传等衍生作品不作为设定来源。维基百科与 Bangumi 为免 Key 通道，开箱可用。',
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
        // 旧数据里可能写过超出范围的值（例如 10000000）：打开设置时按运行端口径
        // 夹取并回写，避免「设置页显示 10000000、实际按 20000 生效」的误导。
        const clampedExcerpt = Number.isFinite(cfg.excerptChars)
            ? Math.max(200, Math.min(20000, cfg.excerptChars as number))
            : 1200;
        if (cfg.excerptChars !== clampedExcerpt) {
            cfg.excerptChars = clampedExcerpt;
            void this.plugin.saveSettings();
        }
        this.plugin.settings.canonResearch = cfg;

        new Setting(card)
            .setName('检索方式')
            .setDesc('手动=只导入自己提供的来源；DeepSeek 复用渠道 Key；MCP 用你配置的任意搜索工具；其余需要对应搜索 API key')
            .addDropdown(dropdown => {
                dropdown.addOption('manual', '手动官方来源（默认）');
                dropdown.addOption('deepseek', 'DeepSeek 联网搜索（复用 DeepSeek Key，按次计费）');
                dropdown.addOption('mcp', 'MCP 检索工具（用你已配置的 MCP 服务，不限于某个搜索源）');
                dropdown.addOption('wikipedia', '维基百科（免 key，可能受网络限制）');
                dropdown.addOption('bangumi', 'Bangumi 番组计划（免 key，可能受网络限制）');
                dropdown.addOption('bing', 'Bing web search（需 key）');
                dropdown.addOption('brave', 'Brave search（需 key）');
                dropdown.addOption('serper', 'Serper.dev（需 key）');
                dropdown.addOption('tavily', 'Tavily（需 key）');
                dropdown.setValue(cfg.provider || 'manual');
                dropdown.onChange(async (value) => {
                    cfg.provider = value as typeof cfg.provider;
                    await this.plugin.saveSettings();
                    // MCP 通道需要展开「服务/工具/参数名」配置，必须重渲染
                    if (value === 'mcp') this.refresh();
                });
            });

        // MCP 检索通道：不绑定具体搜索服务，用户选「已配置的 MCP 服务 + 工具」即可。
        if (cfg.provider === 'mcp') {
            const servers = normalizeMcpServers(this.plugin.settings.mcpServers);
            const serverBox = card.createDiv({ cls: 'nw-card nw-form-stack' });
            serverBox.createDiv({ cls: 'nw-form-label', text: 'MCP 检索配置' });
            if (servers.length === 0) {
                serverBox.createDiv({
                    cls: 'nw-text-12-muted',
                    text: '还没有配置 MCP 服务：请先到「MCP 服务」页添加一个提供搜索工具的服务（brave / tavily / exa / 自建均可）。',
                });
            } else {
                const currentServer = servers.find(server => server.id === cfg.mcpServerId) || servers[0];
                cfg.mcpServerId = currentServer.id;
                new Setting(serverBox)
                    .setName('MCP 服务')
                    .setDesc('选择提供搜索工具的服务')
                    .addDropdown(dropdown => {
                        for (const server of servers) dropdown.addOption(server.id, server.name || server.id);
                        dropdown.setValue(currentServer.id);
                        dropdown.onChange(async (value) => {
                            cfg.mcpServerId = value;
                            cfg.mcpToolName = '';
                            await this.plugin.saveSettings();
                            this.refresh();
                        });
                    });
                new Setting(serverBox)
                    .setName('工具名')
                    .setDesc('该服务里的搜索工具名，例如 brave_search / tavily_search / search')
                    .addText(text => text
                        .setPlaceholder('brave_search')
                        .setValue(cfg.mcpToolName || '')
                        .onChange(async (value) => {
                            cfg.mcpToolName = value.trim();
                            await this.plugin.saveSettings();
                        }));
                new Setting(serverBox)
                    .setName('查询参数名')
                    .setDesc('多数搜索工具用 query；部分用 q / search_query')
                    .addText(text => text
                        .setPlaceholder('query')
                        .setValue(cfg.mcpQueryParam || 'query')
                        .onChange(async (value) => {
                            cfg.mcpQueryParam = value.trim() || 'query';
                            await this.plugin.saveSettings();
                        }));
            }
        }

        // 联网检索本质上是「外部服务」：没有测试入口时，用户分不清是网络问题、Key 问题还是没结果。
        const testRow = new Setting(card)
            .setName('测试检索')
            .setDesc('用当前通道检索一个示例作品名，确认这条通道在本机网络下是否可用');
        const testStatus = card.createDiv({ cls: 'nw-text-12-muted' });
        testRow.addButton(button => button
            .setButtonText('🔍 测试检索')
            .onClick(async () => {
                button.setDisabled(true);
                testStatus.setText('正在检索…');
                try {
                    const service = new CanonResearchService(this.app, this.plugin);
                    const result = await service.research('斗破苍穹');
                    if (result.sources.length > 0) {
                        testStatus.setText(`✅ 「${PROVIDER_LABELS[result.provider] ?? result.provider}」可用：返回 ${result.sources.length} 条来源`);
                    } else {
                        // 先把「配置问题」与「通道问题」分开：密钥未解锁/未配置时，
                        // 说「通道可用」会让用户以为搜索坏了。
                        const blocked = result.warnings.find(item => /密钥|Key|锁定/.test(item));
                        testStatus.setText(blocked
                            ? `⚠️ ${blocked}`
                            : `⚠️ 通道可用但没有返回来源：${result.warnings[0] || '可换一个作品名再试'}`);
                    }
                } catch (error) {
                    testStatus.setText('❌ 检索失败：' + (error instanceof Error ? error.message : String(error)));
                } finally {
                    button.setDisabled(false);
                }
            }));

        new Setting(card)
            .setName('搜索 API key')
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
                        showErrorNotice(e instanceof Error ? e.message : String(e), { title: '保存搜索 API Key 失败', timeout: 6000 });
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
            .setDesc('每个来源抓取入库的字符数（200–20000）。只管存多少；注入 prompt 另有总预算，被裁剪时会显式标注。')
            .addText(text => text
                .setPlaceholder('1200')
                .setValue(String(cfg.excerptChars ?? 1200))
                .onChange(async (value) => {
                    // 与运行时口径一致：200–20000（旧版硬砍 4000，长条目会丢关键信息）
                    const n = parseInt(value, 10);
                    cfg.excerptChars = Number.isFinite(n) ? Math.max(200, Math.min(20000, n)) : 1200;
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
    private renderTaskBudgetRows(section: HTMLElement, providerId?: string): void {
        const card = section.createDiv({ cls: 'nw-u-margintop-20px-2' });
        const currentId = this.plugin.getCurrentProviderId();
        const isCurrentProvider = !providerId || providerId === currentId;
        if (!isCurrentProvider) {
            card.createEl('div', {
                cls: 'nw-u-fs-12px-2 nw-u-c-text-muted-2 nw-u-marginbottom-8px-2',
                text: '任务级参数按渠道各自记忆：这里显示/编辑的是「' + (this.plugin.getAllProviders().find(item => item.id === providerId)?.name || providerId) + '」，切换到该渠道后生效。',
            });
        }
        card.createEl('h4', { text: '🧠 任务级模型参数', cls: 'nw-u-m-0-0-6px-0-2 nw-u-fs-14px-2' });
        card.createEl('div', {
            text: '每个任务可单独覆盖模型/输入/输出/思考参数；留空即继承默认值。输出上限不会自动超过模型能力。',
            cls: 'nw-u-fs-12px-2 nw-u-c-text-muted-2 nw-u-marginbottom-8px-2',
        });

        // 全局思考强度只对「当前渠道」开放：非当前渠道改它会静默改掉别的渠道正在用的参数。
        if (isCurrentProvider) {
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


        } else {
            card.createEl('div', {
                cls: 'nw-card nw-text-12-muted',
                text: '全局思考强度与预算档位只对当前渠道开放；该渠道的思考强度请在「渠道能力与高级项」里单独设置。',
            });
        }

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
            if (!isCurrentProvider) {
                // 预算分发是按「当前渠道」的模型能力算的；非当前渠道展示会误导
                previewList.createDiv({
                    cls: 'nw-text-12-muted',
                    text: '预算分发按当前渠道的模型能力计算：切到该渠道后可查看实际结果。',
                });
                return;
            }
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

        // ── 已保存的任务级覆盖（按渠道）──────────────────────────
        // 旧实现固定读 settings.taskBudgets（当前渠道那份），在非当前渠道的设置页里
        // 会显示并清除别的渠道的覆盖。
        const overrides = isCurrentProvider
            ? (this.plugin.settings.taskBudgets || {})
            : (this.plugin.settings.providerTaskBudgets?.[providerId || ''] || {});
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
                    if (isCurrentProvider) {
                        this.plugin.settings.taskBudgets = {};
                    } else {
                        const key = providerId || '';
                        if (this.plugin.settings.providerTaskBudgets) {
                            delete this.plugin.settings.providerTaskBudgets[key];
                        }
                    }
                    await this.plugin.saveSettings();
                    this.refresh();
                    showSuccessNotice(isCurrentProvider
                        ? '已清除任务级覆盖，改由引擎分发'
                        : '已清除该渠道的任务级覆盖');
                }));
    }

    /** 由 renderTaskBudgetRows 注册，档位/强度变化后刷新只读分发表 */
    private refreshTaskBudgetPreview: (() => void) | null = null;
}
