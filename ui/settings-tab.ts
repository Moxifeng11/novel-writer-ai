import { App, PluginSettingTab, Setting, Notice, Modal, Menu } from 'obsidian';
import NovelWriterPlugin, { NovelWriterSettings, DEFAULT_SETTINGS, CustomProvider, DEFAULT_DECONSTRUCTION_ENGINE_SETTINGS, ALL_BREAKDOWN_DIMENSIONS, DIMENSION_LABELS } from '../main';
import type { DeconstructionEngineSettings } from '../main';
import { renderAppearanceSettings } from './appearance-settings';
import { ManageProvidersModal } from './manage-providers-modal';
import { TemplateManager } from './template-manager';
import { getOllamaModelsWithFallback } from '../engine/co-writer-engine';
import { StyleFingerprintLibrary, StyleFingerprint } from '../engine/style-fingerprint-library';
import { FingerprintExtractor } from '../engine/fingerprint-extractor';
import { createFingerprintEmbedding } from './fingerprint-embedding';
import { detectProviderFromEndpoint } from '../shared/provider-detection';
import { testProviderConnectivity, type ApiConnectivityResult } from '../services/api-connectivity-service';
import {
    API_FORMAT_OPTIONS,
    normalizeApiFormat,
    type ApiFormat,
} from '../shared/api-format';
import { discoverModels, type DiscoveredModel } from '../services/model-discovery';
import { ModelPickerModal } from './model-picker-modal';
import { PasswordModal } from './password-modal';
import { describeSecretForInput, isStoredCiphertext } from '../shared/secret-display';
import { lookupModelCapability } from '../shared/model-capabilities';
import { ProjectMigrationService } from '../services/project-migration-service';
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
} from '../shared/task-model';
import {
    BUDGET_TIERS,
    budgetTierSpec,
    normalizeBudgetTier,
    TASK_CATEGORY,
    type BudgetTier,
} from '../shared/task-budget-engine';
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
import { GITHUB_BRANCH, GITHUB_REPO_SLUG } from '../shared/github-repo';
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
            { id: 'projects', label: '🗂 项目库迁移' },
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
            case 'projects': this.renderProjectLibrarySection(); break;
            case 'performance': this.renderPerformanceSection(); break;
            case 'about': this.renderAboutSection(); break;
        }
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

    private renderApiSection(): void {
        const section = this.tabContent.createEl('section');
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
            this.renderActiveTab();
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
                    this.renderActiveTab();
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
        const rerender = () => this.renderActiveTab();

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
        const rerender = () => this.renderActiveTab();
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
                    this.plugin.setSessionPassword?.(password);
                    await this.plugin.loadSettings();
                    this.renderActiveTab();
                    new Notice('✅ 已解锁，密钥可正常读取');
                    return;
                }
                const password = await PasswordModal.setup(this.app);
                if (!password) return;
                this.plugin.setSessionPassword?.(password);
                await this.plugin.saveSettings();
                this.renderActiveTab();
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
                this.renderActiveTab();
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
            this.renderActiveTab();
        });
        addModelSelect('Flash 模型（大纲/分析/规划）', '大纲骨架、分析报告、元素提取', settings.flashModel, async (value) => {
            settings.flashModel = value;
            this.plugin.updateModelLimitsFromModel(value);
            await this.plugin.saveSettings();
            this.renderActiveTab();
        });
        addModelSelect('Pro 模型（正文/角色/实体）', '正文创作、角色生成、设定任务', settings.proModel, async (value) => {
            settings.proModel = value;
            this.plugin.updateModelLimitsFromModel(value);
            await this.plugin.saveSettings();
            this.renderActiveTab();
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
            this.renderActiveTab();
        };
        footer.createEl('button', {
            cls: 'nw-api-ghost-btn',
            text: '🔄 重置',
            attr: { type: 'button' },
        }).onclick = () => this.renderActiveTab();
    }

    /** 添加供应商弹窗（名称/Base URL/格式/密钥，模型可稍后拉取） */
    private openNewProviderModal(): void {
        const plugin = this.plugin;
        const app = this.app;
        const rerender = () => this.renderActiveTab();

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
            .setDesc('仅用于同人考据检索；保存在插件设置中')
            .addText(text => {
                text.inputEl.type = 'password';
                text.setPlaceholder('留空则只能手动添加来源')
                    .setValue(cfg.apiKey || '')
                    .onChange(async (value) => {
                        cfg.apiKey = value.trim();
                        await this.plugin.saveSettings();
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
                    this.renderActiveTab();
                    new Notice('✅ 已清除任务级覆盖，改由引擎分发');
                }));
    }

    /** 由 renderTaskBudgetRows 注册，档位/强度变化后刷新只读分发表 */
    private refreshTaskBudgetPreview: (() => void) | null = null;

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
            .setName('本地上下文窗口 num_ctx')
            .setDesc('0=按模型探测窗口自动；显存不足时可下调（如 16384/32768）')
            .addText(text => {
                text.setPlaceholder('0（自动）');
                text.setValue(String(this.plugin.settings.coWriteNumCtx ?? 0));
                text.onChange(async (value) => {
                    const num = parseInt(value, 10);
                    this.plugin.settings.coWriteNumCtx = Number.isFinite(num) && num > 0 ? num : 0;
                    await this.plugin.saveSettings();
                });
            });

        new Setting(section)
            .setName('本地候选批量化')
            .setDesc('本地模型一次调用生成多个方向的候选，减少串行等待；解析失败自动回退逐方向生成')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.coWriteCandidateBatching !== false)
                .onChange(async (value) => {
                    this.plugin.settings.coWriteCandidateBatching = value;
                    await this.plugin.saveSettings();
                }));

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
            .setName('自然段模式')
            .setDesc('正文写入时，把相邻的“一句一段”合并成 2–6 句的自然段，并合并对话与说话人的动作。只影响一键生成/续写/批量/场景，不影响手工编辑和协同写作逐段插入。')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.naturalParagraphMode !== false)
                .onChange(async (value) => {
                    this.plugin.settings.naturalParagraphMode = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(section)
            .setName('故事上下文档位')
            .setDesc('自动：协同按本地/云端模式，一键按默认模型推断。本地档位使用压缩文本与更少条目，云端档位使用完整文本与更多条目。')
            .addDropdown(dropdown => dropdown
                .addOption('auto', '自动')
                .addOption('local', '本地 Ollama / 小窗口')
                .addOption('cloud', '云端 API / 大窗口')
                .setValue(this.plugin.settings.storyContextTier || 'auto')
                .onChange(async (value) => {
                    this.plugin.settings.storyContextTier = value as 'auto' | 'local' | 'cloud';
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
                cls: 'nw-u-p-40px-2 nw-u-ta-center-2 nw-u-c-text-faint-2 nw-u-fs-13px-2',
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

        const templateSection = section.createDiv({ cls: 'nw-u-marginbottom-24px-2' });
        this.renderFingerprintGroup(templateSection, '模板指纹库', this.templateFingerprints, 'template');

        const globalSection = section.createDiv({ cls: 'nw-u-marginbottom-24px-2' });
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
        const headerRow = container.createDiv({ cls: 'nw-u-d-flex-2 nw-u-ai-center-2 nw-u-jc-space-between-2 nw-u-marginbottom-10px-2' });
        
        if (scope === 'project') {
            const titleText = activeProject ? `${title}（${fingerprints.length} 个）· ${activeProject}` : `${title}（${fingerprints.length} 个）`;
            headerRow.createEl('span', { text: titleText, cls: 'nw-u-fwt-600-2 nw-u-fs-13px-2' });
        } else {
            headerRow.createEl('span', { text: `${title}（${fingerprints.length} 个）`, cls: 'nw-u-fwt-600-2 nw-u-fs-13px-2' });
        }

        const isProjectWithoutProject = scope === 'project' && !activeProject;
        const headerRight = scope === 'project' && activeProject
            ? headerRow.createDiv({ cls: 'nw-u-d-flex-2 nw-u-ai-center-2 nw-u-gap-10px-2' })
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
                cls: 'nw-u-p-20px-2 nw-u-ta-center-2 nw-u-c-text-muted-2 nw-u-fs-13px-2 nw-u-bg-background-secondary-2 nw-u-brd-6px-2',
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
                cls: 'nw-u-p-40px-2 nw-u-ta-center-2 nw-u-c-text-faint-2 nw-u-fs-13px-2',
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
            this.renderActiveTab();
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
            this.renderActiveTab();
        });

        const tagFilterRow = filterBar.createDiv({ cls: 'nw-u-d-flex-2 nw-u-gap-12px-2 nw-u-fwr-wrap-2' });

        const themeFilterDiv = tagFilterRow.createDiv({ cls: 'nw-u-flex-1-2 nw-u-minw-200px-2' });
        themeFilterDiv.createEl('span', { text: '📖 题材：全部', cls: 'nw-u-fs-12px-2 nw-u-c-text-muted-2 nw-u-marginright-8px' });

        const techniqueFilterDiv = tagFilterRow.createDiv({ cls: 'nw-u-flex-1-2 nw-u-minw-200px-2' });
        techniqueFilterDiv.createEl('span', { text: '✍️ 技巧：全部', cls: 'nw-u-fs-12px-2 nw-u-c-text-muted-2 nw-u-marginright-8px' });

        const filteredBooks = this.filterKnowledgeBooks();

        if (filteredBooks.length === 0) {
            const emptyState = section.createDiv({
                cls: 'nw-u-p-60px-20px nw-u-ta-center-2 nw-u-b-1px-dashed-background- nw-u-brd-8px-2 nw-u-bg-background-secondary-2'
            });
            emptyState.createEl('div', {
                text: '📚',
                cls: 'nw-u-fs-48px nw-u-marginbottom-16px-2 nw-u-op-0-5'
            });
            emptyState.createEl('div', {
                text: this.knowledgeBooks.length === 0
                    ? '知识库暂无书籍，点击上方「批量导入」开始添加'
                    : '没有符合筛选条件的书籍',
                cls: 'nw-u-fs-14px-2 nw-u-c-text-muted-2 nw-u-marginbottom-8px-2'
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
            cls: 'nw-u-fs-13px-2 nw-u-c-text-muted-2'
        });

        const gridContainer = section.createDiv({
            cls: 'nw-u-d-grid-2 nw-u-gtc-repeat-auto-fill-minma-4 nw-u-gap-12px-2 nw-u-maxh-500px nw-u-ovy-auto-2 nw-u-p-4px'
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
            cls: 'nw-u-p-12px-16px-2 nw-u-b-1px-solid-background-m-2 nw-u-brd-6px-2 nw-u-marginbottom-16px-2 nw-u-bg-background-secondary-2'
        });
        qualityCard.createEl('h4', { text: '🎯 增强级别', cls: 'nw-u-m-0-0-12px-0-2 nw-u-fs-14px-2' });

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
            cls: 'nw-u-p-12px-16px-2 nw-u-b-1px-solid-background-m-2 nw-u-brd-6px-2 nw-u-marginbottom-16px-2 nw-u-bg-background-secondary-2'
        });
        dimCard.createEl('h4', { text: '🧩 拆解维度', cls: 'nw-u-m-0-0-12px-0-2 nw-u-fs-14px-2' });
        dimCard.createEl('div', {
            text: '选择默认启用的拆解维度（调用方未显式指定维度时使用）',
            cls: 'nw-u-fs-12px-2 nw-u-c-text-muted-2 nw-u-marginbottom-10px-2'
        });

        const dimList = dimCard.createDiv({ cls: 'nw-u-d-grid-2 nw-u-gtc-repeat-auto-fill-minma-5 nw-u-gap-6px-2' });
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
            cls: 'nw-u-p-12px-16px-2 nw-u-b-1px-solid-background-m-2 nw-u-brd-6px-2 nw-u-marginbottom-16px-2 nw-u-bg-background-secondary-2'
        });
        vectorCard.createEl('h4', { text: '🧠 向量增强', cls: 'nw-u-m-0-0-12px-0-2 nw-u-fs-14px-2' });

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
            cls: 'nw-u-p-12px-16px-2 nw-u-b-1px-solid-background-m-2 nw-u-brd-6px-2 nw-u-marginbottom-16px-2 nw-u-bg-background-secondary-2'
        });
        llmCard.createEl('h4', {
            text: '🤖 LLM 增强 · 实验性',
            cls: 'nw-u-m-0-0-12px-0-2 nw-u-fs-14px-2'
        });
        llmCard.createEl('div', {
            text: '⚠️ 实验性功能：调用大模型对拆解结果做二次提炼，会增加 API 调用成本',
            cls: 'nw-u-fs-12px-2 nw-u-c-text-warning nw-u-marginbottom-10px-2'
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

        const resetRow = section.createDiv({ cls: 'nw-u-d-flex-2 nw-u-jc-flex-end-2 nw-u-margintop-12px-2' });
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
            cls: 'nw-u-p-14px-2 nw-u-b-1px-solid-background-m-2 nw-u-brd-8px-2 nw-u-bg-background-primary-2 nw-u-cur-pointer-2 nw-u-transition-all-0-2s-ease nw-u-pos-relative nw-u-ov-hidden-2'
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
            cls: "kb-card-actions nw-u-pos-absolute nw-u-t-8px nw-u-r-8px nw-u-d-flex-2 nw-u-gap-4px-2 nw-u-op-0 nw-u-transition-opacity-0-2s-ease nw-u-z-10",
            attr: {}
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

        const titleRow = card.createDiv({ cls: 'nw-u-marginbottom-6px-2 nw-u-paddingright-60px' });
        titleRow.createEl('div', {
            text: book.name,
            cls: 'nw-u-fs-15px-2 nw-u-fwt-600-2 nw-u-c-text-normal-2 nw-u-lh-1-4-2'
        });

        if (book.author) {
            titleRow.createEl('div', {
                text: book.author,
                cls: 'nw-u-fs-12px-2 nw-u-c-text-muted-2 nw-u-margintop-2px-2'
            });
        }

        const statusBadge = this.getStatusBadge(book.breakdownStatus);
        card.appendChild(statusBadge);

        const allTags = [...book.themeTags, ...book.techniqueTags, ...book.customTags];
        if (allTags.length > 0) {
            const tagRow = card.createDiv({
                cls: 'nw-u-d-flex-2 nw-u-gap-4px-2 nw-u-fwr-wrap-2 nw-u-m-10px-0'
            });
            const displayTags = allTags.slice(0, 3);
            displayTags.forEach(tag => {
                tagRow.createEl('span', {
                    text: tag,
                    cls: 'nw-u-p-2px-8px-2 nw-u-bg-background-secondary-2 nw-u-brd-10px-2 nw-u-fs-11px-2 nw-u-c-text-muted-2'
                });
            });
            if (allTags.length > 3) {
                tagRow.createEl('span', {
                    text: `+${allTags.length - 3}`,
                    cls: 'nw-u-p-2px-8px-2 nw-u-bg-background-secondary-2 nw-u-brd-10px-2 nw-u-fs-11px-2 nw-u-c-text-faint-2'
                });
            }
        }

        const metaRow = card.createDiv({
            cls: 'nw-u-d-flex-2 nw-u-gap-12px-2 nw-u-fs-11px-2 nw-u-c-text-faint-2 nw-u-paddingtop-8px-2 nw-u-bt-1px-solid-background-m-2'
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

        new Setting(vectorSection)
            .setName('向量服务不可用时的回退')
            .setDesc('local-only=只允许回退到本地 Ollama；never=直接失败；allow-cloud=允许回退到云端（可能把本地文本发到云端）')
            .addDropdown(dropdown => {
                dropdown.addOption('local-only', '仅本地（推荐）');
                dropdown.addOption('never', '不回退');
                dropdown.addOption('allow-cloud', '允许云端（谨慎）');
                dropdown.setValue(this.plugin.settings.embeddingFallbackPolicy || 'local-only');
                dropdown.onChange(async (value) => {
                    this.plugin.settings.embeddingFallbackPolicy = value as 'never' | 'local-only' | 'allow-cloud';
                    await this.plugin.saveSettings();
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
        section.createEl('hr', { cls: 'nw-u-m-20px-0 nw-u-b-none nw-u-bt-1px-solid-background-m-2' });
        section.createEl('h3', { text: '💬 提示词策略', cls: 'nw-u-margintop-16px-2' });
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

    private renderProjectLibrarySection(): void {
        const section = this.tabContent.createEl('section');
        section.createEl('h3', { text: '🗂 项目库迁移' });
        section.createEl('p', {
            text: '将根目录旧项目迁移到 长篇小说/、短篇小说/、剧本/ 三个独立模式库。默认 dry-run，只有点击迁移才会移动目录。',
            cls: 'setting-item-description',
        });

        const actions = section.createDiv({ cls: 'nw-u-d-flex-2 nw-u-gap-8px-2 nw-u-marginbottom-8px-2' });
        const planBtn = actions.createEl('button', {
            text: '📋 生成迁移计划',
            cls: 'nw-btn nw-btn-secondary',
            attr: { type: 'button' },
        });
        const migrateBtn = actions.createEl('button', {
            text: '🚚 执行迁移（含备份清单）',
            cls: 'nw-btn nw-btn-primary',
            attr: { type: 'button' },
        });
        const resultEl = section.createDiv({ cls: 'nw-u-fs-12px-2 nw-u-c-text-muted-2' });

        const renderPlan = (planText: string): void => {
            resultEl.empty();
            resultEl.createEl('pre', { text: planText, cls: 'nw-u-fs-12px-2' });
        };

        planBtn.onclick = async () => {
            if (planBtn.disabled) return;
            planBtn.disabled = true;
            planBtn.setText('⏳ 扫描中…');
            try {
                const service = new ProjectMigrationService(this.app);
                const plan = await service.plan();
                if (plan.candidates.length === 0 && plan.conflicts.length === 0) {
                    renderPlan('没有需要迁移的 legacy 项目。');
                } else {
                    const lines: string[] = [];
                    if (plan.candidates.length > 0) {
                        lines.push('待迁移：');
                        for (const item of plan.candidates) {
                            lines.push(`- [${item.mode}] ${item.projectId} → ${item.targetPath}`);
                        }
                    }
                    if (plan.conflicts.length > 0) {
                        lines.push('冲突：');
                        for (const item of plan.conflicts) lines.push(`- ${item.projectId}：${item.reason}`);
                    }
                    if (plan.skipped.length > 0) {
                        lines.push('跳过：');
                        for (const item of plan.skipped) lines.push(`- ${item.projectId}：${item.reason}`);
                    }
                    renderPlan(lines.join('\n'));
                }
            } catch (e) {
                renderPlan(`生成迁移计划失败：${e instanceof Error ? e.message : String(e)}`);
            } finally {
                planBtn.disabled = false;
                planBtn.setText('📋 生成迁移计划');
            }
        };

        migrateBtn.onclick = async () => {
            if (migrateBtn.disabled) return;
            const confirmed = await OperationConfirmModal.confirm(this.app, {
                title: '迁移项目库',
                description: '将把根目录 legacy 项目移动到对应模式库；迁移前会写入备份清单。',
                confirmText: '开始迁移',
                cancelText: '取消',
            });
            if (!confirmed) return;
            migrateBtn.disabled = true;
            migrateBtn.setText('⏳ 迁移中…');
            try {
                const service = new ProjectMigrationService(this.app);
                const result = await service.migrateWithNotice({ backup: true });
                const lines = [
                    `已迁移 ${result.moved.length} 个项目`,
                    ...result.moved.map(item => `- ${item.projectId} → ${item.targetPath}`),
                ];
                if (result.failed.length > 0) {
                    lines.push('', '失败：');
                    for (const item of result.failed) lines.push(`- ${item.projectId}：${item.error}`);
                }
                if (result.warnings.length > 0) lines.push('', ...result.warnings);
                renderPlan(lines.join('\n'));
                this.plugin.ctxManager.invalidateContextCache();
                this.plugin.updateStatusBarText();
            } catch (e) {
                renderPlan(`迁移失败：${e instanceof Error ? e.message : String(e)}`);
            } finally {
                migrateBtn.disabled = false;
                migrateBtn.setText('🚚 执行迁移（含备份清单）');
            }
        };
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

        this.renderPanelSizeRows(section);
    }

    /**
     * 面板尺寸（2026-10-29 第 4 轮）。
     *
     * 工作台左右栏可以直接拖，但拖出来的值没有数字入口查看/精确设定；
     * 完整写作工作台的三栏此前写死在 grid 变量里，只能改代码。
     * 这里给每一项一个数字输入 + 恢复默认，并在文案里说明也可拖拽。
     */
    private renderPanelSizeRows(section: HTMLElement): void {
        section.createEl('h4', { text: '📐 面板尺寸' });
        section.createEl('p', {
            text: '可直接在界面上拖拽分隔条调整，也可在此精确输入。双击分隔条恢复默认。',
            cls: 'setting-item-description',
        });

        const sizes = () => {
            if (!this.plugin.settings.panelSizes) this.plugin.settings.panelSizes = {};
            return this.plugin.settings.panelSizes;
        };

        const persist = async (apply: () => void) => {
            apply();
            await this.plugin.saveSettings();
            // 尺寸通过 CSS 变量生效，重注入即可，不必重建整个设置页
            this.plugin.injectLayoutVariables();
            this.plugin.injectThemeVariables();
        };

        const rows: Array<{
            key: 'fwStepNav' | 'fwRightPanel';
            label: string;
            desc: string;
            min: number;
            max: number;
            fallback: number;
        }> = [
            { key: 'fwStepNav', label: '写作工作台 · 左栏', desc: '步骤导航宽度', min: 100, max: 400, fallback: 140 },
            { key: 'fwRightPanel', label: '写作工作台 · 右栏', desc: '上下文/预览栏宽度', min: 160, max: 560, fallback: 220 },
        ];

        for (const row of rows) {
            new Setting(section)
                .setName(row.label)
                .setDesc(`${row.desc}（${row.min}–${row.max}px，默认 ${row.fallback}px）`)
                .addText(text => {
                    text.inputEl.type = 'number';
                    text.inputEl.min = String(row.min);
                    text.inputEl.max = String(row.max);
                    text
                        .setPlaceholder(String(row.fallback))
                        .setValue(String(sizes()[row.key] ?? row.fallback))
                        .onChange(async (value) => {
                            const parsed = parseInt(value, 10);
                            if (!Number.isFinite(parsed)) return;
                            const clamped = Math.max(row.min, Math.min(row.max, parsed));
                            await persist(() => { sizes()[row.key] = clamped; });
                        });
                })
                .addExtraButton(btn => btn
                    .setIcon('rotate-ccw')
                    .setTooltip('恢复默认宽度')
                    .onClick(async () => {
                        await persist(() => { delete sizes()[row.key]; });
                        this.renderActiveTab();
                    }));
        }

        new Setting(section)
            .setName('恢复全部面板尺寸')
            .setDesc('把所有面板宽高恢复为默认值（不影响浮窗位置记录）')
            .addButton(btn => btn
                .setButtonText('全部恢复默认')
                .setWarning()
                .onClick(async () => {
                    await persist(() => {
                        this.plugin.settings.panelSizes = {};
                        delete this.plugin.settings.agentWorkbenchLeftWidth;
                        delete this.plugin.settings.agentWorkbenchRightWidth;
                        delete this.plugin.settings.coWriteEditorWidthRatio;
                    });
                    this.renderActiveTab();
                    new Notice('✅ 已恢复全部面板尺寸');
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

    private renderPerformanceSection(): void {
        const section = this.tabContent.createEl('section');

        section.createEl('h3', { text: '📊 性能监控' });
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
                cls: "nw-empty-info-card nw-u-margintop-16px-2", attr: {}
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

        section.createEl('h4', { text: '📂 分类统计', cls: 'nw-h4-section' });

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

        section.createEl('h4', { text: '🐢 最近慢操作', cls: 'nw-h4-section' });

        if (slowOps.length === 0) {
            section.createEl('div', {
                text: '✅ 暂无慢操作记录',
                cls: 'nw-empty-info-card'
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

        section.createEl('h4', { text: '📝 最近操作日志', cls: 'nw-h4-section' });

        if (log.length === 0) {
            section.createEl('div', {
                text: '暂无性能数据，请先使用插件功能',
                cls: 'nw-empty-info-card'
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

        section.createEl('h4', { text: '⚙️ 操作', cls: 'nw-h4-section' });

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
                cls: 'nw-u-marginbottom-16px-2 nw-u-p-14px-18px nw-u-bg-linear-gradient-135deg-3 nw-u-brd-10px-2 nw-u-c-white-2 nw-u-d-flex-2 nw-u-ai-center-2 nw-u-jc-space-between-2 nw-u-gap-12px-2 nw-u-fwr-wrap-2'
            });

            const left = banner.createDiv({ cls: 'nw-u-flex-1-2 nw-u-minw-200px-2' });
            left.createEl('div', {
                text: `🎉 发现新版本 v${latestVersion}`,
                cls: 'nw-u-fwt-600-2 nw-u-fs-15px-2 nw-u-marginbottom-4px-2'
            });
            left.createEl('div', {
                text: lastResult.releaseNotes
                    ? lastResult.releaseNotes.substring(0, 80) + (lastResult.releaseNotes.length > 80 ? '...' : '')
                    : '点击查看详情了解新功能和改进',
                cls: 'nw-u-fs-12px-2 nw-u-op-0-9-2'
            });

            const right = banner.createDiv({ cls: 'nw-u-d-flex-2 nw-u-gap-8px-2 nw-u-fsh-0-2' });

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
        await this.mountRulesSection(section);
    }

    /**
     * 渲染规则版本检查内容到指定容器。
     *
     * 「重新检查」必须只重绘本容器：旧实现直接调用 renderRulesSection()，
     * 而该方法每次都会往 tabContent 追加一个新的 section，导致每点一次
     * 就多出一整块重复模块。
     */
    private async mountRulesSection(section: HTMLElement): Promise<void> {
        section.empty();
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

            const statusRow1 = statusCard.createDiv({ cls: 'nw-status-row' });
            statusRow1.createDiv({ text: '规则文件状态:', cls: 'nw-status-label' });
            statusRow1.createDiv({
                text: isPresent ? '✅ 已检测到' : '⚠️ 未找到',
                attr: {
                    style: `padding:4px 12px;border-radius:12px;font-size:12px;font-weight:600;${
                        isPresent ? 'background:var(--text-accent);color:var(--background-primary);' : 'background:var(--background-modifier-warning);color:var(--text-warning);'
                    }`
                }
            });

            const statusRow2 = statusCard.createDiv({ cls: 'nw-status-row' });
            statusRow2.createDiv({ text: '当前规则版本:', cls: 'nw-status-label' });
            statusRow2.createDiv({ text: current === 'unknown' ? '无法检测' : `v${current}`, cls: 'nw-u-fontfamily-monospace' });

            const statusRow3 = statusCard.createDiv({ cls: 'nw-status-row' });
            statusRow3.createDiv({ text: '期望规则版本:', cls: 'nw-status-label' });
            statusRow3.createDiv({ text: `v${expected}`, cls: 'nw-u-fontfamily-monospace' });

            if (config.lastModified > 0) {
                const statusRow4 = statusCard.createDiv({ cls: 'nw-status-row' });
                statusRow4.createDiv({ text: '最后修改时间:', cls: 'nw-status-label' });
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

            const actions = section.createDiv({ cls: 'nw-settings-actions' });

            const refreshBtn = actions.createEl('button', {
                text: '🔄 重新检查',
                cls: 'nw-btn nw-btn-secondary',
                attr: { type: 'button' },
            });
            refreshBtn.addEventListener('click', async () => {
                if (refreshBtn.disabled) return;
                refreshBtn.disabled = true;
                refreshBtn.setText('⏳ 检查中…');
                rulesService.invalidateCache();
                // 只重绘本容器，不追加新模块
                await this.mountRulesSection(section);
            });

            const viewBtn = actions.createEl('button', {
                text: '📝 查看规则内容',
                cls: 'nw-btn nw-btn-primary',
                attr: { type: 'button' },
            });
            viewBtn.addEventListener('click', async () => {
                const rules = await rulesService.getWritingRules();
                const modal = new (class extends Modal {
                    constructor(app: any) { super(app); }
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
                cls: 'nw-text-error'
            });
        }
    }

    private renderAboutSection(): void {
        const section = this.tabContent.createEl('section');

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
                .setDesc('格式：owner/repo · 默认分支：' + GITHUB_BRANCH)
                .addText(text => text
                    .setPlaceholder(GITHUB_REPO_SLUG)
                    .setValue(this.plugin.settings.updateGithubRepo || GITHUB_REPO_SLUG)
                    .onChange(async (value) => {
                        this.plugin.settings.updateGithubRepo = value;
                        await this.plugin.saveSettings();
                        const updateChecker = this.plugin.engineRegistry.getOrNull<any>(ENGINE_NAMES.UPDATE_CHECKER);
                        if (updateChecker) {
                            updateChecker.updateConfig({ githubRepo: value });
                            updateChecker.clearCache?.();
                        }
                    })
                );
            new Setting(section)
                .setName('GitHub Token（私有仓库必填）')
                .setDesc('公开仓库留空；私有仓库需要 repo 读取权限。Token 只保存在本地设置中。')
                .addText(text => {
                    text.inputEl.type = 'password';
                    text.setPlaceholder('github_pat_... 或 ghp_...')
                        .setValue(this.plugin.settings.updateGithubToken || '')
                        .onChange(async (value) => {
                            this.plugin.settings.updateGithubToken = value.trim();
                            await this.plugin.saveSettings();
                            const updateChecker = this.plugin.engineRegistry.getOrNull<any>(ENGINE_NAMES.UPDATE_CHECKER);
                            if (updateChecker) {
                                updateChecker.updateConfig({ githubToken: value.trim() });
                                updateChecker.clearCache?.();
                            }
                        });
                });

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

        section.createEl('h4', { text: '📌 关于插件', cls: 'nw-u-m-24px-0-12px-0' });

        const aboutCard = section.createDiv({
            cls: 'nw-u-p-16px-2 nw-u-bg-background-secondary-2 nw-u-brd-8px-2 nw-u-fs-13px-2 nw-u-lh-1-7 nw-u-c-text-muted-2'
        });

        aboutCard.createEl('p', {
            text: '全流程 AI 长篇小说创作系统 — 协同写作工作台 + 多模型智能引擎 + 数据安全架构。',
            cls: 'nw-u-m-0-0-12px-0-2'
        });

        aboutCard.createEl('div', { text: '作者：南柯一梦', cls: 'nw-u-marginbottom-4px-2' });
        aboutCard.createEl('div', { text: '许可证：MIT', cls: 'nw-u-marginbottom-4px-2' });
    }

    private renderRecognitionSection(): void {
        const section = this.tabContent.createEl('section');

        section.createEl('h3', { text: '🎭 角色识别设置' });
        section.createEl('p', {
            text: '配置角色识别三层流水线的各层参数。',
            cls: 'setting-item-description'
        });

        section.createEl('h4', { text: '启用的识别层', cls: 'nw-u-margintop-20px-2 nw-u-marginbottom-8px-2' });

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

        section.createEl('h4', { text: '📋 规则层配置', cls: 'nw-u-margintop-24px nw-u-marginbottom-8px-2' });

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

        section.createEl('h4', { text: '🔗 向量层配置', cls: 'nw-u-margintop-24px nw-u-marginbottom-8px-2' });

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

        section.createEl('h4', { text: '🤖 LLM 层配置', cls: 'nw-u-margintop-24px nw-u-marginbottom-8px-2' });

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
}
