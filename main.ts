import { InternalRegistry } from './engine/internal-registry';
import { App, Plugin, PluginSettingTab, Setting, Notice, TFile, TFolder, WorkspaceLeaf, ItemView } from 'obsidian';
import { AIEngine } from './engine/ai-engine';
import { CoWriterEngine } from './engine/co-writer-engine';
import { ContextManager } from './engine/context-manager';
import { ForeshadowManager } from './engine/foreshadow-manager';
import { ReviewAgent } from './engine/review-agent';
import { NovelWriterModal } from './ui/main-modal';
import { NovelWriterSettingTab } from './ui/settings-tab';
import { CreateProjectModal } from './ui/create-project-modal';
import { PlanBookModal } from './ui/plan-book-modal';
import { WriteChapterModal } from './ui/write-chapter-modal';
import { ReviewChapterModal } from './ui/review-chapter-modal';
import { BatchCreateModal } from './ui/batch-create-modal';
import { GenerateWorldviewModal } from './ui/generate-worldview-modal';
import { GenerateCharacterModal } from './ui/generate-character-modal';
import { GenerateFactionModal } from './ui/generate-faction-modal';
import { GenerateLocationModal } from './ui/generate-location-modal';
import { GenerateItemModal } from './ui/generate-item-modal';
import { CrossVolumeStateModal } from './ui/cross-volume-state-modal';
import { StyleDistillerModal } from './ui/style-distiller-modal';
import { ContextInjectorModal } from './ui/context-injector-modal';
import { ChapterSettlementModal } from './ui/chapter-settlement-modal';
import { VolumeIntroModal } from './ui/volume-intro-modal';
import { BatchChaptersModal } from './ui/batch-chapters-modal';
import { ContinueChaptersModal } from './ui/continue-chapters-modal';
import { AutoWriterModal } from './ui/auto-writer-modal';
import { DiagnoseWriterModal } from './ui/diagnose-writer-modal';
import { TomatoRankModal } from './ui/tomato-rank-modal';
import { RebuildChaptersModal } from './ui/rebuild-chapters-modal';
import { BackupYuanModal } from './ui/backup-yuan-modal';
import { ProtectYuanModal } from './ui/protect-yuan-modal';
import { NovelTagsModal } from './ui/novel-tags-modal';
import { AiBuilderModal } from './ui/ai-builder-modal';
import { AddFanficSettingModal } from './ui/add-fanfic-setting-modal';
import { FullWriterView, VIEW_TYPE as FULL_WRITER_VIEW_TYPE } from './ui/full-writer-view';
import { CoWritingView, VIEW_TYPE_CO_WRITE } from './ui/co-writing-view';
import { ProviderSwitcherModal } from './ui/provider-switcher-modal';

import { FloatWorkspaceManager } from './ui/workspace-manager';
import { EntityStateManager } from './engine/entity-state-manager';
import { AdaptiveDebounceManager } from './shared/adaptive-debounce-manager';
import { SerializedWriter } from './shared/serialized-writer';
import { migrateSettings, withCurrentVersion, CURRENT_SCHEMA_VERSION } from './shared/settings-migrator';
import { PluginCacheManager } from './shared/plugin-cache';
import { pjNarrativeOverview } from './shared/paths';

// ─── core 服务层（从 main.ts 拆出）───
import { CryptoService } from './core/crypto-service';
import { ThemeManager } from './core/theme-manager';
import { ProviderManager } from './core/provider-manager';
import { CommandRegistry, parseChapterFromPath } from './core/command-registry';
import { SettingsService, getDefaultSettings } from './core/settings-service';


export interface ProviderPreset {
    name: string;
    endpoint: string;
    models: string[];
    maxContext: number;
    maxOutput: number;
}

/** v3.5.0: 用户自定义 API 提供商，可持久化保存 */
export interface CustomProvider {
    id: string;       // 唯一标识（自动生成，如 custom-1）
    name: string;     // 显示名称
    endpoint: string; // API 端点
    models: string[]; // 模型列表
    maxContext: number;
    maxOutput: number;
}

// 导入集中化的模型能力映射（避免与 token-estimator.ts 重复硬编码）
import { MODEL_CAPABILITIES, findModelCapability } from './shared/model-capabilities';
export { MODEL_CAPABILITIES, findModelCapability };

// v3.4.7 P0-10: 根据各模型官方文档更新 maxContext / maxOutput
// 注意：同一 provider 下不同模型可能有不同上限，此处取旗舰模型能力作为默认值，
// 用户可在设置中针对具体模型降低。
export const PROVIDERS: Record<string, ProviderPreset> = {
    volc:   { name: '火山引擎豆包', endpoint: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions', models: ['deepseek-v3-2-251201', 'doubao-seed-2-0-pro-260215', 'doubao-seed-1-8-251228', 'doubao-seed-2-0-code-preview-260215', 'glm-4-7-251222'], maxContext: 256000, maxOutput: 131072 },
    openai: { name: 'OpenAI 兼容', endpoint: 'https://api.openai.com/v1/chat/completions', models: ['gpt-4o', 'gpt-4o-mini'], maxContext: 128000, maxOutput: 16384 },
    ollama: { name: '本地 Ollama', endpoint: 'http://localhost:11434/v1/chat/completions', models: ['qwen2.5:7b', 'deepseek-r1:7b'], maxContext: 32768, maxOutput: 8192 },
    catcat: { name: 'CatCat Gemini', endpoint: 'https://api.catcat.top/v1/chat/completions', models: ['gemini-3.1-pro-preview-search'], maxContext: 1048576, maxOutput: 65536 },
    deepseek:{ name: 'DeepSeek 官网', endpoint: 'https://api.deepseek.com/v1/chat/completions', models: ['deepseek-v4-flash', 'deepseek-v4-pro'], maxContext: 1048576, maxOutput: 384000 },
};

// v3.4.7: 模型能力表已迁移至 shared/model-capabilities.ts，此处 re-export 仅用于向后兼容
// 新代码应直接从 './shared/model-capabilities' 导入

export interface NovelWriterSettings {
    apiKey: string;
    apiEndpoint: string;
    defaultModel: string;
    flashModel: string;
    proModel: string;
    /** v6.3: 协同写作专用模型（可设为本地 Ollama 模型如 qwen2.5:7b，减少远程 API 调用） */
    coWriteModel: string;
    /** v6.5: 协同写作本地模型 temperature（0-2，默认 0.7） */
    coWriteTemperature: number;
    /** v6.5: 协同写作本地模型 max_tokens（默认 600） */
    coWriteMaxTokens: number;
    availableModels: string[];
    maxContext: number;   // v6.2: 当前生效值（由 modelOverrides 或 MODEL_CAPABILITIES 决定）
    maxOutput: number;    // v6.2: 当前生效值（由 modelOverrides 或 MODEL_CAPABILITIES 决定）
    /**
     * v7.0: 两层索引的模型覆盖值
     * 外层 key = endpoint URL，内层 key = 模型名
     * 切换供应商时自动按 endpoint 索引，不会丢失旧供应商下的覆盖值
     */
    modelOverrides: Record<string, Record<string, { maxContext?: number; maxOutput?: number }>>;
    /**
     * v6.2: 覆盖值修改历史（每次用户手动修改时追加）
     * 用于查看/追溯每次渠道-模型配置变更
     */
    modelOverrideHistory: Array<{
        timestamp: string;    // ISO 时间
        providerId: string;   // 渠道 ID（如 volc / openai / deepseek / custom-1）
        model: string;        // 模型 ID
        field: 'maxContext' | 'maxOutput' | 'both';
        oldValue: number;
        newValue: number;
    }>;
    defaultWordCount: number;
    minWordCount: number;
    maxWordCount: number;
    enableAutoReview: boolean;
    enableAutoCorrect: boolean;
    enableAutoModelFallback: boolean;  // P0-13: AI断联时自动切换同端点下其他模型
    enableDetailedAnalysis?: boolean;  // v4.x: 启用详细节奏分析（AI 辅助估算紧张度）
    contextScope: 'full' | 'compact';  // 上下文范围：compact=仅本章涉及实体，full=遍历全部实体
    infoDebtThreshold: number;
    maxUnrevealedForeshadow: number;
    maxApiRetries: number;
    maxEntityBatchRetries: number;
    /** 各提供商的 API Key，key=providerId, value=apiKey */
    providerKeys: Record<string, string>;
    customProviderName: string;
    /** v3.5.0: 用户自定义 API 提供商列表，可持久化保存、切换、删除 */
    customProviders: CustomProvider[];
    /** v6.0: 被用户隐藏/删除的预设提供商 ID（预设不会真删除，只是隐藏） */
    hiddenPresets: string[];
    theme: 'light' | 'dark' | 'auto';
    themeColors?: {
        accent?: string;
        cardBg?: string;
        textPrimary?: string;
        /** v6.1: 应用底色独立自定义 */
        appBg?: string;
        /** v6.1: 面板底色独立自定义 */
        panelBg?: string;
        /** 界面氛围预设 */
        appearancePreset?: 'soft' | 'clear' | 'paper';
        /** 是否启用自定义卡片背景色 */
        enableCustomCardBg?: boolean;
    };
    /** 浮窗工作台布局（位置/折叠状态/自动恢复） */
    panelLayout?: {
        panels: Array<{
            id: string;
            position: { x: number; y: number };
            size: { width: number; height: number };
            collapsed: boolean;
        }>;
        autoRestore: boolean;
        lastWorkspaceOpen: boolean;
    };
}

export const DEFAULT_SETTINGS: NovelWriterSettings = {
    apiKey: '',
    apiEndpoint: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
    defaultModel: 'deepseek-v3-2-251201',
    flashModel: 'deepseek-v3-2-251201',
    proModel: 'doubao-seed-2-0-pro-260215',
    coWriteModel: '',  // v6.3: 空=使用 flashModel，可设为本地模型如 qwen2.5:7b
    coWriteTemperature: 0.7,  // v6.5: 协同写作本地模型 temperature
    coWriteMaxTokens: 600,    // v6.5: 协同写作本地模型 max_tokens
    availableModels: ['deepseek-v3-2-251201', 'doubao-seed-2-0-pro-260215', 'doubao-seed-1-8-251228'],
    maxContext: 128000,
    maxOutput: 32768,
    modelOverrides: {},       // v6.2: 用户手动覆盖值
    modelOverrideHistory: [], // v6.2: 修改历史
    defaultWordCount: 3000,
    minWordCount: 2500,
    maxWordCount: 5000,
    enableAutoReview: true,
    enableAutoCorrect: true,
    enableAutoModelFallback: true,  // P0-13: 默认开启断联自动切换
    contextScope: 'compact',
    infoDebtThreshold: 10,
    maxUnrevealedForeshadow: 20,
    maxApiRetries: 3,
    maxEntityBatchRetries: 2,
    providerKeys: {},
    customProviderName: '',
    customProviders: [],
    hiddenPresets: [],
    theme: 'auto'
};

// 主题 CSS 变量已迁移至 core/theme-manager.ts

export default class NovelWriterPlugin extends Plugin {
    settings!: NovelWriterSettings;
    private statusBarItem!: HTMLElement;
    private _statusBarClickHandler: (() => void) | null = null;
    private _aiEngine: AIEngine | null = null;
    private _coWriterEngine: CoWriterEngine | null = null;
    private contextManager!: ContextManager;
    private foreshadowManager!: ForeshadowManager;
    private reviewAgent!: ReviewAgent;
    registry!: InternalRegistry;
    // ─── core 服务实例 ───
    private _cryptoService!: CryptoService;
    private _themeManager!: ThemeManager;
    private _providerManager!: ProviderManager;
    private _commandRegistry!: CommandRegistry;
    private _settingsService!: SettingsService;
    /** 热重载恢复状态 */
    public _pendingReloadState: { project: string; chapterFileName: string; volume?: string; chapDir?: string } | null = null;
    /** 实体生成弹窗的预选项目（跨 modal 临时传递） */
    public _pendingEntityProject: string | null = null;
    /** 实体生成弹窗的上下文标记（跨 modal 临时传递） */
    public _pendingEntityContext: { project: string; isEarlyStage: boolean } | null = null;
    /** 实体生成弹窗刚关闭标记（向导渲染时检测并刷新步骤状态） */
    public _entityModalJustClosed: boolean = false;
    /** 工作台上下文标记：true=当前工作台视图打开中，Modal 不应在 Obsidian 主窗口打开文件 */
    public _isWorkbenchContext: boolean = false;
    /** 工作台当前章节上下文（由工作台视图运行时写入，协同视图/引擎读取） */
    public _workbenchState: {
        project?: string;
        chapterName?: string;
        chapterNum?: number;
        volume?: string;
        protagonistName?: string;
        protagonist?: string;
    } | null = null;
    /** 浮窗管理器（运行时注入，可能未初始化） */
    public workspaceManager?: FloatWorkspaceManager;

    /** P0修复#2：当前章节涉及的实体集（由 FullWriterView 同步，context-panel 读取以过滤显示） */
    public _involvedChars: Set<string> = new Set<string>();
    public _involvedLocs: Set<string> = new Set<string>();
    public _involvedFactions: Set<string> = new Set<string>();
    public _involvedItems: Set<string> = new Set<string>();

    /**
     * 安全打开文件：工作台上下文中仅显示 Notice，避免跳转到 Obsidian 主窗口
     * 用于替换 Modal 中所有 workspace.getLeaf(false).openFile(file) 调用
     */
    async safeOpenFile(file: TFile): Promise<void> {
        if (this._isWorkbenchContext) {
            new Notice(`📄 文件已保存：${file.name}`);
        } else {
            const leaf = this.app.workspace.getLeaf(false);
            await leaf.openFile(file);
        }
    }

    /** 公开访问器 — 供 Modal 层依赖注入使用 */
    public get ctxManager(): ContextManager { return this.contextManager; }

    /** 从当前活动文件检测所属项目名（非项目目录返回 null） */
    getActiveProject(): string | null {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) return null;
        const project = activeFile.path.split('/')[0];
        // 排除系统目录
        if (project === '元文件' || project === '文笔风格库' || project.startsWith('.')) return null;
        // 确认是项目目录。注意：`.project` 是点文件，不入 vault 索引，
        // getAbstractFileByPath 恒为 null，这里改用被索引的项目文件夹判定。
        const folder = this.app.vault.getAbstractFileByPath(project);
        return folder instanceof TFolder ? project : null;
    }

    async onload() {
        this._cacheManager = new PluginCacheManager(this.app);
        await this._cacheManager.load();
        this.registry = new InternalRegistry();
        window.novelAI = this.registry;

        // ─── 初始化 core 服务 ───
        this._cryptoService = new CryptoService(this.app);
        this._providerManager = new ProviderManager({
            getSettings: () => this.settings,
            saveSettings: () => this.saveSettings(),
            refreshContextPanel: () => this.refreshFullWriterContextPanel(),
            updateStatusBar: () => this.updateStatusBarText(),
            addOverrideHistory: (entry) => this._cacheManager?.addModelOverrideHistory(entry),
        });
        this._themeManager = new ThemeManager(() => this.settings);
        this._settingsService = new SettingsService({
            crypto: this._cryptoService,
            providerManager: this._providerManager,
            cacheManager: this._cacheManager,
            settingsWriter: this._settingsWriter,
            getSettings: () => this.settings,
            setSettings: (s) => { this.settings = s; },
            loadData: () => this.loadData(),
            saveData: (d) => this.saveData(d),
        });
        // 初始化引擎（必须在 CommandRegistry 之前，否则 Modal 中 ctxManager 为 undefined）
this.contextManager = new ContextManager(this);
this.foreshadowManager = new ForeshadowManager(this);
this.reviewAgent = new ReviewAgent(this);
console.log('[小说工坊] 引擎初始化完成');

this._commandRegistry = new CommandRegistry({
    app: this.app,
    registry: this.registry,
    aiEngine: { extractElements: (c) => this.aiEngine.extractElements(c) },
    ctxManager: this.contextManager,
    foreshadowManager: this.foreshadowManager,
    getActiveProject: () => this.getActiveProject(),
    openProviderSwitcher: () => this.openProviderSwitcher(),
    refreshFullWriterContextPanel: () => this.refreshFullWriterContextPanel(),
    populateSettingLib: () => this.commandPopulateSettingLib(),
    getWorkbenchState: () => this._workbenchState,
    isWorkbenchContext: () => this._isWorkbenchContext,
});
// 注册 InternalRegistry + Obsidian 命令
this._commandRegistry.registerInternalCommands();
this._commandRegistry.registerObsidianCommands((cmd) => this.addCommand(cmd));

console.log('[小说工坊] 开始加载插件...');
try {
    console.log('[小说工坊] 加载设置...');
    await this.loadSettings();
    console.log('[小说工坊] 设置加载完成');

    console.log('[小说工坊] 创建状态栏...');
    this.statusBarItem = this.addStatusBarItem();
    this.statusBarItem.addClass('novel-writer-status-bar');
    this.updateStatusBarText();
    this._statusBarClickHandler = () => {
        this.openProviderSwitcher();
    };
    this.statusBarItem.addEventListener('click', this._statusBarClickHandler);

    console.log('[小说工坊] 注册命令...');
            this.registerCommands();
            
            const registeredCmds = this.app.commands.listCommands().filter((cmd: { id: string }) => cmd.id.startsWith('novel-writer'));
            console.log('[小说工坊] 命令注册完成，已注册:', registeredCmds.length, '个命令');
            console.log('[小说工坊] 命令列表:', registeredCmds.map((c: { id: string }) => c.id));

            console.log('[小说工坊] 添加设置面板...');
            this.addSettingTab(new NovelWriterSettingTab(this.app, this));

            console.log('[小说工坊] 添加侧边栏图标...');
            this.addRibbonIcon('book-open', '小说工坊', () => {
                this.registry.execute('novel-writer-full-writer');
            });

            // v6.0: 第二个 Ribbon 图标，直达句级协同写作工作台（解决「找不到入口」）
            this.addRibbonIcon('pen-line', '小说工坊 · 句级协同写作', () => {
                this.registry.execute('novel-writer-co-writing');
            });

            console.log('[小说工坊] 注册视图...');
            this.registerView(
                FULL_WRITER_VIEW_TYPE,
                (leaf) => new FullWriterView(leaf, this)
            );

            // v4.0: 注册句级协同写作视图
            this.registerView(
                VIEW_TYPE_CO_WRITE,
                (leaf) => new CoWritingView(leaf, this)
            );

            // v5.5: 实例化浮窗管理器并注册监控面板A/B视图
            // （此前 workspaceManager 仅声明字段、从未实例化 -> MONITOR_A/B 永不注册，
            //  导致分离监控面板「丢失」、分析结果回退塞进协同视图内嵌容器造成拥挤）
            this.workspaceManager = new FloatWorkspaceManager(this);
            this.workspaceManager.registerAll();

            console.log('[小说工坊] 注册事件...');
            this.registerEvent(
                this.app.vault.on('modify', (file) => {
                    if (file.path.includes('/02-时间线与伏笔/')) {
                        this.foreshadowManager.refreshInfoDebt();
                    }
                    if (file instanceof TFile && /\/03-大纲与章节\/正文\/.*第\d+卷\/第\d+章_正文\.md$/.test(file.path)) {
                        this.handleBodyFileModify(file);
                    }
                })
            );

            // P0-14/16: 热重载恢复（完全基于内存态 _pendingReloadState，不依赖 localStorage）
            // — Obsidian 启动加载插件：_pendingReloadState 为 null → 不主动打开工作台
            // — 用户点 🔄 热重载按钮：_pendingReloadState 已由按钮 handler 在 disable 前同步设置 → 调用 openFullWriterView 恢复
            // — 用户点 ribbon 图标：_pendingReloadState 为 null → 打开工作台至「项目与章节」
            //
            // 彻底清理所有可能的 localStorage 残留（旧实现遗留），防止跨会话污染
            localStorage.removeItem('novel-writer-reload-state');
            localStorage.removeItem('novel-writer-user-reload');
            if (this._pendingReloadState?.project) {
                const saved = this._pendingReloadState;
                setTimeout(() => {
                    this.openFullWriterView();
                }, 300);
            }

            this.injectThemeVariables();
            this.injectLayoutVariables();  // v3.4.8: 布局变量全插件可用，不再依赖 full-writer-view 打开

            console.log('[小说工坊] 插件加载完成！');
        } catch (error: any) {
            console.error('[小说工坊] 插件加载失败:', error.message);
            console.error('[小说工坊] 错误堆栈:', error.stack);
            new Notice(`❌ 小说工坊插件加载失败: ${error.message}`);
        }
    }

    private registerCommands() {
        this.addCommand({
            id: 'novel-writer-create-project',
            name: '新建项目',
            callback: () => {
                this.registry.execute('novel-writer-create-project').catch(err => console.error('[小说工坊]', err));
            }
        });

        this.addCommand({
            id: 'novel-writer-plan-book',
            name: 'AI全书规划',
            callback: () => {
                this.registry.execute('novel-writer-plan-book').catch(err => console.error('[小说工坊]', err));
            }
        });

        this.addCommand({
            id: 'novel-writer-volume-intro',
            name: '全书简介',
            callback: () => {
                this.registry.execute('novel-writer-volume-intro').catch(err => console.error('[小说工坊]', err));
            }
        });

        this.addCommand({
            id: 'novel-writer-batch-chapters',
            name: '批量写正文〔旧〕',
            callback: () => {
                this.registry.execute('novel-writer-batch-chapters').catch(err => console.error('[小说工坊]', err));
            }
        });

        this.addCommand({
            id: 'novel-writer-continue-chapters',
            name: '续写规划',
            callback: () => {
                this.registry.execute('novel-writer-continue-chapters').catch(err => console.error('[小说工坊]', err));
            }
        });

        this.addCommand({
            id: 'novel-writer-auto-writer',
            name: '自动写作器〔旧〕',
            callback: () => {
                this.registry.execute('novel-writer-auto-writer').catch(err => console.error('[小说工坊]', err));
            }
        });

        this.addCommand({
            id: 'novel-writer-diagnose',
            name: '流程诊断',
            callback: () => {
                this.registry.execute('novel-writer-diagnose').catch(err => console.error('[小说工坊]', err));
            }
        });

        this.addCommand({
            id: 'novel-writer-tomato-rank',
            name: '番茄榜单分析',
            callback: () => {
                this.registry.execute('novel-writer-tomato-rank').catch(err => console.error('[小说工坊]', err));
            }
        });

        this.addCommand({
            id: 'novel-writer-rebuild',
            name: '重建章节',
            callback: () => {
                this.registry.execute('novel-writer-rebuild').catch(err => console.error('[小说工坊]', err));
            }
        });

        this.addCommand({
            id: 'novel-writer-backup',
            name: '备份元文件',
            callback: () => {
                this.registry.execute('novel-writer-backup').catch(err => console.error('[小说工坊]', err));
            }
        });

        this.addCommand({
            id: 'novel-writer-protect',
            name: '保护元文件',
            callback: () => {
                this.registry.execute('novel-writer-protect').catch(err => console.error('[小说工坊]', err));
            }
        });

        this.addCommand({
            id: 'novel-writer-narrative-overview',
            name: '叙事总览',
            callback: async () => {
                const project = this.getActiveProject();
                if (!project) { new Notice('请先选择项目'); return; }
                const overviewPath = pjNarrativeOverview(project);
                const file = this.app.vault.getAbstractFileByPath(overviewPath);
                if (file instanceof TFile) {
                    const leaf = this.app.workspace.getLeaf('tab');
                    await leaf.openFile(file);
                } else {
                    new Notice('叙事总览尚未生成，请先执行章节结算');
                }
            }
        });

        this.addCommand({
            id: 'novel-writer-tags',
            name: '作品标签分析',
            callback: () => {
                this.registry.execute('novel-writer-tags').catch(err => console.error('[小说工坊]', err));
            }
        });

        this.addCommand({
            id: 'novel-writer-ai-builder',
            name: 'AI世界元素生成',
            callback: () => {
                this.registry.execute('novel-writer-ai-builder').catch(err => console.error('[小说工坊]', err));
            }
        });

        this.addCommand({
            id: 'novel-writer-add-fanfic',
            name: '添加同人设定',
            callback: () => {
                this.registry.execute('novel-writer-add-fanfic').catch(err => console.error('[小说工坊]', err));
            }
        });

        this.addCommand({
            id: 'novel-writer-write-chapter',
            name: 'AI写正文〔旧〕',
            callback: () => {
                this.registry.execute('novel-writer-write-chapter').catch(err => console.error('[小说工坊]', err));
            }
        });

        this.addCommand({
            id: 'novel-writer-write-chapter-auto',
            name: '后台AI写正文〔旧〕',
            callback: () => {
                this.registry.execute('novel-writer-write-chapter-auto').catch(err => console.error('[小说工坊]', err));
            }
        });

        this.addCommand({
            id: 'novel-writer-review-chapter',
            name: '连贯性审查',
            callback: () => {
                this.registry.execute('novel-writer-review-chapter').catch(err => console.error('[小说工坊]', err));
            }
        });

        this.addCommand({
            id: 'novel-writer-batch-create',
            name: '批量建章',
            callback: () => {
                this.registry.execute('novel-writer-batch-create').catch(err => console.error('[小说工坊]', err));
            }
        });

        this.addCommand({
            id: 'novel-writer-worldview',
            name: '生成世界观',
            callback: () => {
                this.registry.execute('novel-writer-worldview').catch(err => console.error('[小说工坊]', err));
            }
        });

        this.addCommand({
            id: 'novel-writer-character',
            name: '生成人物',
            callback: () => {
                this.registry.execute('novel-writer-character').catch(err => console.error('[小说工坊]', err));
            }
        });

        this.addCommand({
            id: 'novel-writer-faction',
            name: '生成势力',
            callback: () => {
                this.registry.execute('novel-writer-faction').catch(err => console.error('[小说工坊]', err));
            }
        });

        this.addCommand({
            id: 'novel-writer-location',
            name: '生成地点',
            callback: () => {
                this.registry.execute('novel-writer-location').catch(err => console.error('[小说工坊]', err));
            }
        });

        this.addCommand({
            id: 'novel-writer-item',
            name: '生成物品功法',
            callback: () => {
                this.registry.execute('novel-writer-item').catch(err => console.error('[小说工坊]', err));
            }
        });

        this.addCommand({
            id: 'novel-writer-refresh-info-debt',
            name: '刷新信息债看板',
            callback: () => {
                this.registry.execute('novel-writer-refresh-info-debt').catch(err => console.error('[小说工坊]', err));
            }
        });

        this.addCommand({
            id: 'novel-writer-cross-volume-state',
            name: '跨卷状态继承',
            callback: () => {
                this.registry.execute('novel-writer-cross-volume-state').catch(err => console.error('[小说工坊]', err));
            }
        });

        this.addCommand({
            id: 'novel-writer-style-distiller',
            name: '文笔风格蒸馏',
            callback: () => {
                this.registry.execute('novel-writer-style-distiller').catch(err => console.error('[小说工坊]', err));
            }
        });

        this.addCommand({
            id: 'novel-writer-context-injector',
            name: '上下文注入',
            callback: () => {
                this.registry.execute('novel-writer-context-injector').catch(err => console.error('[小说工坊]', err));
            }
        });

        this.addCommand({
            id: 'novel-writer-chapter-settlement',
            name: '章节结算',
            callback: () => {
                this.registry.execute('novel-writer-chapter-settlement').catch(err => console.error('[小说工坊]', err));
            }
        });

        this.addCommand({
            id: 'novel-writer-full-writer',
            name: '📖 完整写作工作台',
            callback: () => {
                this.registry.execute('novel-writer-full-writer').catch(err => console.error('[小说工坊]', err));
            }
        });

        // v6.0: 句级协同写作工作台直达命令（命令面板 / 自定义快捷键可达）
        this.addCommand({
            id: 'novel-writer-co-writing',
            name: '✍️ 句级协同写作工作台',
            callback: () => {
                this.registry.execute('novel-writer-co-writing').catch(err => console.error('[小说工坊]', err));
            }
        });

        this.addCommand({
            id: 'switch-provider',
            name: '快速切换 AI 提供商',
            callback: () => {
                this.registry.execute('switch-provider').catch(err => console.error('[小说工坊]', err));
            }
        });

        this.addCommand({
            id: 'novel-writer-extract-elements',
            name: 'AI 元素提取',
            callback: () => {
                this.registry.execute('novel-writer-extract-elements').catch(err => console.error('[小说工坊]', err));
            }
        });

        this.addCommand({
            id: 'novel-writer-populate-setting-lib',
            name: '从世界观生成设定库',
            callback: () => {
                this.registry.execute('populate-setting-lib').catch(err => console.error('[小说工坊]', err));
            }
        });

        // v1.5.0: 手动重命名项目
        this.addCommand({
            id: 'novel-writer-rename-project',
            name: '重命名当前项目',
            callback: () => {
                const activeFile = this.app.workspace.getActiveFile();
                if (!activeFile) { new Notice('请先打开项目中的文件'); return; }
                const project = activeFile.path.split('/')[0];
                new Notice(`当前项目: ${project}。请在文件浏览器中右键文件夹重命名，或通过生成世界观自动重命名。`);
            }
        });

        // v1.5.0: vault rename 事件监听
        this.registerEvent(
            this.app.vault.on('rename', (file, oldPath) => {
                if (file instanceof TFolder) {
                    new Notice(`📁 项目已重命名: ${oldPath} → ${file.path}`, 4000);
                }
            })
        );
    }

    private async extractElementsCommand(): Promise<void> {
        const activeView = this.app.workspace.getActiveViewOfType(ItemView);
        if (!activeView) {
            new Notice('请先打开一个 Markdown 文件');
            return;
        }
        // ItemView 实际上有 file 属性，但 Obsidian 官方类型未暴露
        // 使用接口合并在 obsidian-augment.d.ts 中扩展，或直接使用类型断言
        const file = (activeView as ItemView & { file?: TFile }).file ?? null;
        if (!file) {
            new Notice('未找到当前文件');
            return;
        }
        const content = await this.app.vault.read(file);
        const result = await this.aiEngine.extractElements(content);
        if (result.error) {
            new Notice(`元素提取失败: ${result.error}`);
        } else {
            const notice = new Notice(`✅ 元素提取完成`, 5000);
        }
    }

    async activateView(): Promise<void> {
        // 重定向到完整写作工作台
        this.openFullWriterView();
    }

    public async openFullWriterView() {
        const { workspace } = this.app;
        // 优先复用已有视图，避免每次热重载开新窗口（v3.4.7 P0-7）
        const existing = workspace.getLeavesOfType(FULL_WRITER_VIEW_TYPE);
        let leaf: any;
        if (existing.length > 0) {
            leaf = existing[0];
            // v4.5.1: 清理重复实例（避免多 leaf 共存导致 tabContent undefined 等问题）
            for (let i = 1; i < existing.length; i++) {
                existing[i].detach();
            }
        } else {
            leaf = workspace.getLeaf('tab');  // 当前窗口新建 tab，而非 getLeaf('window') 开新窗口
        }
        await leaf.setViewState({
            type: FULL_WRITER_VIEW_TYPE,
            active: true
        });
        workspace.revealLeaf(leaf);
    }

    /** v4.0: 打开句级协同写作视图 */
    public async activateCoWritingView(project?: string, chapterName?: string, volume?: string, chapterNum?: number): Promise<void> {
        const { workspace } = this.app;
        let leaf = workspace.getLeavesOfType(VIEW_TYPE_CO_WRITE)[0];

        if (!leaf) {
            // 协同写作是「左预览 / 中编辑 / 右控制台」三栏布局，需要完整宽度。
            // 必须落在主编辑区（tab），不能用 getRightLeaf 放进右侧 dock（约 400px），
            // 否则三栏 grid 把中间编辑栏压成 0px，界面看起来「错乱 / 打不开」。
            leaf = workspace.getLeaf('tab');
            await leaf.setViewState({ type: VIEW_TYPE_CO_WRITE, active: true });
        }

        workspace.revealLeaf(leaf);

        if (project || chapterName) {
            const view = leaf.view as CoWritingView;
            if (view) {
                await view.openChapter(project || '', chapterName || '', volume || '第1卷', chapterNum || 1);
            }
        }

        // v5.5: 协同写作视图打开后，补开分离式监控面板A/B（节奏/情绪/OOC/实体、结局/风格/偏好）。
        // 不向 openAll 传 project/chapterName，避免其内部以 2 参再次调用 openChapter 覆盖 volume/chapterNum。
        await this.workspaceManager?.openAll();
    }

    /**
     * v6.0: 协同写作直达入口的智能绑定。
     * 优先级：①工作台已记录的当前章节(_workbenchState) → ②当前打开的正文文件反解出的章节 → ③空态视图。
     * 这样无论从命令面板、Ribbon 还是快捷键进入，都尽量带着章节上下文，避免打开后一片空白。
     */
    public async openCoWritingFromActiveContext(): Promise<void> {
        // ① 工作台运行时记录的章节上下文
        const wb = this._workbenchState;
        if (wb?.project && wb?.chapterNum) {
            await this.activateCoWritingView(
                wb.project,
                wb.chapterName || `第${wb.chapterNum}章`,
                wb.volume || '第1卷',
                wb.chapterNum
            );
            return;
        }

        // ② 从当前打开的正文文件路径反解章节
        const activeFile = this.app.workspace.getActiveFile();
        const ctx = activeFile ? this.parseChapterFromPath(activeFile.path) : null;
        if (ctx) {
            await this.activateCoWritingView(ctx.project, ctx.chapterName, ctx.volume, ctx.chapterNum);
            new Notice(`✍️ 已绑定章节：${ctx.project} · ${ctx.volume} · 第${ctx.chapterNum}章`, 3000);
            return;
        }

        // ③ 没有可用上下文：打开空态视图并提示如何绑定
        await this.activateCoWritingView();
        new Notice('已打开句级协同写作工作台。请先打开某章「正文」文件，或从完整写作工作台选择章节后再进入，即可自动绑定。', 6000);
    }

    /**
     * v6.0: 从文件路径反解出协同写作所需的章节上下文。
     * 仅识别标准正文路径：<项目>/03-大纲与章节/正文/第X卷/第Y章_正文.md
     * 反解失败返回 null（交由调用方回退到空态）。
     */
    private parseChapterFromPath(path: string): { project: string; volume: string; chapterNum: number; chapterName: string } | null {
        if (!path) return null;
        const m = path.match(/^(.+?)\/03-大纲与章节\/正文\/(第(\d+)卷)\/第(\d+)章_正文\.md$/);
        if (!m) return null;
        const project = m[1];
        const volume = m[2];
        const chapterNum = parseInt(m[4], 10);
        if (!project || !Number.isFinite(chapterNum)) return null;
        return { project, volume, chapterNum, chapterName: `第${chapterNum}章` };
    }

    async commandPopulateSettingLib() {
        const { workspace } = this.app;
        let leaf = workspace.getLeaf(false);
        if (!leaf) {
            leaf = workspace.createLeafBySplit(workspace.getLeaf(true));
        }
        await leaf.setViewState({
            type: FULL_WRITER_VIEW_TYPE,
            active: true
        });
        workspace.revealLeaf(leaf);
        const view = leaf.view as FullWriterView;
        if (view) await view.populateSettingLib();
    }

    // ─── API 密钥加密（委托至 core/crypto-service）───
    private async encryptKey(plaintext: string): Promise<string> {
        return this._cryptoService.encrypt(plaintext);
    }
    private async decryptKey(stored: string): Promise<string> {
        return this._cryptoService.decrypt(stored);
    }

    async loadSettings() {
        await this._settingsService.loadSettings();
    }

    async saveSettings() {
        await this._settingsService.saveSettings();
    }

    public updateStatusBarText(): void {
        const providerId = this.getCurrentProviderId();
        let providerName = '';
        if (providerId && PROVIDERS[providerId]) {
            providerName = PROVIDERS[providerId].name;
        } else if (providerId) {
            // 自定义提供商
            const custom = this.settings.customProviders?.find(c => c.id === providerId);
            providerName = custom?.name || this.settings.customProviderName || '自定义';
        } else {
            providerName = this.settings.customProviderName || '自定义';
        }
        const flashModelShort = this.settings.flashModel.substring(0, 20);
        const proModelShort = this.settings.proModel.substring(0, 20);
        this.statusBarItem.setText(
            `🔌 ${providerName} | Flash: ${flashModelShort} | Pro: ${proModelShort}`
        );
    }

    // ─── 提供商管理（委托至 core/provider-manager）───
    public getCurrentProviderId(): string | null { return this._providerManager.getCurrentProviderId(); }
    public switchProviderByEndpoint(endpoint: string): boolean { return this._providerManager.switchByEndpoint(endpoint); }
    public resolveModelLimits(modelName: string) { return this._providerManager.resolveModelLimits(modelName); }
    public updateModelLimitsFromModel(modelName: string): void { this._providerManager.updateModelLimits(modelName); }
    public setCurrentModelOverride(field: 'maxContext' | 'maxOutput', value: number): void {
        this._providerManager.setModelOverride(this.getCurrentProviderId() || 'unknown', this.settings.defaultModel, field, value);
    }
    public addCustomProvider(name: string, endpoint: string, models: string[], maxContext: number, maxOutput: number, apiKey: string): string | null {
        return this._providerManager.addCustom(name, endpoint, models, maxContext, maxOutput, apiKey);
    }
    public deleteCustomProvider(id: string): boolean { return this._providerManager.deleteCustom(id); }
    public getAllProviders() { return this._providerManager.getAllProviders(); }
    public hidePreset(presetId: string): boolean { return this._providerManager.hidePreset(presetId); }
    public restorePreset(presetId: string): boolean { return this._providerManager.restorePreset(presetId); }
    public restoreAllPresets(): void { this._providerManager.restoreAllPresets(); }
    public savePresetOverride(presetId: string, name: string, endpoint: string, models: string[], maxContext: number, maxOutput: number): boolean {
        return this._providerManager.savePresetOverride(presetId, name, endpoint, models, maxContext, maxOutput);
    }

    public openProviderSwitcher(): void {
        new ProviderSwitcherModal(this.app, this).open();
    }

    public refreshFullWriterContextPanel(): void {
        this.app.workspace.trigger('novel-writer:refresh-context-panel', {});
    }

    get aiEngine(): AIEngine {
        if (!this._aiEngine) {
            this._aiEngine = new AIEngine(this);
        }
        return this._aiEngine;
    }

    get coWriterEngine(): CoWriterEngine {
        if (!this._coWriterEngine) {
            this._coWriterEngine = new CoWriterEngine(this.app, this.aiEngine, this.contextManager);
        }
        return this._coWriterEngine;
    }

    get cacheManager(): PluginCacheManager {
        if (!this._cacheManager) {
            throw new Error('cacheManager not initialized');
        }
        return this._cacheManager;
    }

    executeCommand(commandId: string): boolean {
        // 使用内置的 Registry（函数指针）替代 Obsidian 字符串 ID 路由
        if (this.registry.has(commandId)) {
            this.registry.execute(commandId).catch(err => console.error('[小说工坊] Registry 执行失败:', err));
            return true;
        }
        // 临时兼容桥：registry 中不存在时 fallback 到 Obsidian 命令系统
        console.warn('[小说工坊] 命令 ' + commandId + ' 未在 Registry 注册，fallback 到 Obsidian 路由');
        return this.app.commands.executeCommandById(commandId);
    }



    // ─── 自适应防抖管理器 ───

    private _debounceManager = new AdaptiveDebounceManager({ debug: false });
    private _settingsWriter = new SerializedWriter({ debug: false });
    private _cacheManager: PluginCacheManager | null = null;

    // ─── 设置持久化 debounce ───

    private scheduleOverrideSave(): void {
        this._debounceManager.debounceFixed('override-save', () => {
            this.saveSettings().catch(e => console.warn('[小说工坊] 模型覆盖保存失败:', e));
        }, 500);
    }

    // ─── 正文文件变更监听与实体状态重检 ───

    private handleBodyFileModify(file: TFile): void {
        const path = file.path;
        this._debounceManager.debounceFixed(`body-modify:${path}`, () => {
            this.runEntityStateRecheck(file).catch(e =>
                console.warn('[小说工坊] 正文编辑实体状态重检失败:', e)
            );
        }, 3000);
    }

    private async runEntityStateRecheck(file: TFile): Promise<void> {
        try {
            const pathMatch = file.path.match(/^([^/]+\/[^/]+)\/03-大纲与章节\/正文\/第(\d+)卷\/第(\d+)章_正文\.md$/);
            if (!pathMatch) return;

            const project = pathMatch[1];
            const volN = parseInt(pathMatch[2], 10);
            const chapN = parseInt(pathMatch[3], 10);

            const content = await this.app.vault.read(file);
            if (!content || content.length < 50) return;

            const manager = new EntityStateManager({
                app: this.app,
                plugin: this,
                aiEngine: this.aiEngine,
            });

            const changes = await manager.detectStateChanges(
                content,
                project,
                chapN,
                `第${chapN}章`
            );

            if (changes.length > 0) {
                await manager.applyStateChanges(project, changes, chapN, `第${chapN}章`);
                await manager.updateInvolvedEntities(project, file.path, content);
                console.log(`[小说工坊] 正文手动编辑触发实体状态更新: ${changes.length}项变更`);
            }
        } catch (e) {
            console.warn('[小说工坊] 实体状态自动重检异常:', e);
        }
    }

    // ─── 主题变量注入（委托至 core/theme-manager）───
    public injectThemeVariables(): void { this._themeManager.injectThemeVariables(); }
    public injectLayoutVariables(): void { this._themeManager.injectLayoutVariables(); }

    openChapterInFullWriter(project: string, chapterPath: string) {
        // Open the full writer view with this chapter
        this.activateFullWriterView(project, chapterPath);
    }

    async activateFullWriterView(project: string, chapterPath?: string) {
        // Find or create full writer workspace leaf
        const { workspace } = this.app;
        const leaves = workspace.getLeavesOfType('novel-writer-full-writer');
        let leaf = leaves[0];
        if (!leaf) {
            try {
                leaf = workspace.getLeaf('tab');
            } catch (e) {
                console.warn('[main] getLeaf(tab) 失败，回退到已有 leaf:', e);
            }
            if (!leaf) {
                // 完全回退，创建新的 leaf
                console.warn('[main] 无法获取 workspace leaf，跳过面板创建');
                new Notice('⚠️ 工作台面板创建失败，请检查侧边栏是否已打开', 5000);
                return;
            }
            try {
                await leaf.setViewState({ type: 'novel-writer-full-writer', active: true });
            } catch (e) {
                console.error('[main] setViewState 失败:', e);
                new Notice('⚠️ 工作台面板激活失败，请重试', 5000);
                return;
            }
        }
        if (!leaf) {
            new Notice('⚠️ 工作台面板创建失败', 5000);
            return;
        }
        workspace.revealLeaf(leaf);
        
        if (chapterPath && leaf?.view) {
            // 方案：通过 _pendingReloadState 传递章节信息
            // 让 FullWriterView 在 onOpen 中处理章节打开
            const view = leaf.view as FullWriterView;
            // selectChapter 是 FullWriterView 的私有方法，仅通过 view 上的 _pendingReloadState 间接触发
            // TODO: 将章节自动选择改为通过 _pendingReloadState 传递（已有该机制）
            if (typeof (view as unknown as { selectChapter?: unknown }).selectChapter === 'function') {
                // 需要通过 chapterPath 解析出 project 和 chapter 对象
                // 暂时跳过自动选择章节，让用户手动选择
                console.warn('[小说工坊] 自动选择章节功能待完善，请手动选择章节');
            }
        }
    }

    onunload() {
        // 清理防抖管理器
        this._debounceManager.dispose();
        // 等待设置写入队列完成（不阻塞卸载，尽力而为）
        this._settingsWriter.flush().catch(e =>
            console.warn('[小说工坊] 卸载时设置写入失败:', e)
        );
        // 清理缓存管理器
        this._cacheManager?.dispose();
        // P0-14/16: 不再向 localStorage 保存恢复状态。
        // 热重载恢复完全通过内存态 _pendingReloadState 传递（按钮 handler 在 disable 前设置）。
        // 这样 Obsidian 正常关闭→启动时不会有任何残留，工作台默认不打开。
        localStorage.removeItem('novel-writer-reload-state');
        localStorage.removeItem('novel-writer-user-reload');
        // v5.5: 卸载时关闭分离式浮窗（监控面板A/B + 协同写作视图叶子），避免残留空叶子。
        this.workspaceManager?.closeAll();
        // 清理状态栏点击事件监听器
        if (this._statusBarClickHandler && this.statusBarItem) {
            this.statusBarItem.removeEventListener('click', this._statusBarClickHandler);
            this._statusBarClickHandler = null;
        }
        // 清理所有注入的样式标签（匹配 novel-writer 前缀）
        const allStyles = document.querySelectorAll('style[id^="novel-writer-"]');
        allStyles.forEach(el => el.remove());
        console.log('Novel Writer AI plugin unloaded');
    }
}





