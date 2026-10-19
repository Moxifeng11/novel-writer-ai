/**
 * command-registry.ts — 命令注册与路由
 *
 * 职责：注册所有 Obsidian 命令、InternalRegistry 桥接、视图打开逻辑
 * 从 main.ts 拆分而来
 */

import { App, Editor, ItemView, MarkdownFileInfo, MarkdownView, Notice, TFile, TFolder, WorkspaceLeaf } from 'obsidian';
import { InternalRegistry } from '../engine/internal-registry';
import { CreateProjectModal } from '../ui/create-project-modal';
import { PlanBookModal } from '../ui/plan-book-modal';
import { WriteChapterModal } from '../ui/write-chapter-modal';
import { ReviewChapterModal } from '../ui/review-chapter-modal';
import { QualityDashboardModal } from '../ui/quality-dashboard-modal';
import { BatchCreateModal } from '../ui/batch-create-modal';
import { GenerateWorldviewModal } from '../ui/generate-worldview-modal';
import { GenerateCharacterModal } from '../ui/generate-character-modal';
import { GenerateFactionModal } from '../ui/generate-faction-modal';
import { GenerateLocationModal } from '../ui/generate-location-modal';
import { GenerateItemModal } from '../ui/generate-item-modal';
import { CrossVolumeStateModal } from '../ui/cross-volume-state-modal';
import { StyleDistillerModal } from '../ui/style-distiller-modal';
import { ContextInjectorModal } from '../ui/context-injector-modal';
import { ExpandTextModal } from '../ui/expand-text-modal';
import { OutlineExpandModal } from '../ui/outline-expand-modal';
import { ChapterSettlementModal } from '../ui/chapter-settlement-modal';
import { IdeationModal } from '../ui/ideation-modal';
import { GoldenOpeningModal } from '../ui/golden-opening-modal';
import { StepResultViewerModal } from '../ui/step-result-viewer-modal';
import { VolumeIntroModal } from '../ui/volume-intro-modal';
import { BatchChaptersModal } from '../ui/batch-chapters-modal';
import { ContinueChaptersModal } from '../ui/continue-chapters-modal';
import { AutoWriterModal } from '../ui/auto-writer-modal';
import { DiagnoseWriterModal } from '../ui/diagnose-writer-modal';
import { TomatoRankModal } from '../ui/tomato-rank-modal';
import { RebuildChaptersModal } from '../ui/rebuild-chapters-modal';
import { BackupYuanModal } from '../ui/backup-yuan-modal';
import { ProtectYuanModal } from '../ui/protect-yuan-modal';
import { NovelTagsModal } from '../ui/novel-tags-modal';
import { AiBuilderModal } from '../ui/ai-builder-modal';
import { AddFanficSettingModal } from '../ui/add-fanfic-setting-modal';
import { ProviderSwitcherModal } from '../ui/provider-switcher-modal';
import { FullWriterView, VIEW_TYPE as FULL_WRITER_VIEW_TYPE } from '../ui/full-writer-view';
import { CoWritingView, VIEW_TYPE_CO_WRITE } from '../ui/co-writing-view';
import { WritingFingerprintView, VIEW_TYPE_WRITING_FINGERPRINT } from '../ui/views/writing-fingerprint-view';
import { VIEW_TYPE_KNOWLEDGE_BASE } from '../ui/views/knowledge-base-view';
import { UnifiedEntityManagerModal } from '../ui/unified-entity-manager-modal';
import { UnifiedEntityGenerateModal } from '../ui/unified-entity-generate-modal';
import { ChapterVersionModal } from '../ui/chapter-version-modal';
import { ChapterVersionService } from '../services/chapter-version-service';
import { ENGINE_NAMES } from '../engine/engine-registry';
import { FloatWorkspaceManager } from '../ui/workspace-manager';
import { pjNarrativeOverview } from '../shared/paths';
import { createLogger } from '../shared/logger';


const log = createLogger('CommandRegistry');
/**
 * 命令 ID 常量枚举
 * 避免魔法字符串，提供类型安全的命令 ID 引用
 */
export const CommandIds = {
    // ─── 项目管理类 ───
    CREATE_PROJECT: 'novel-writer-create-project',
    RENAME_PROJECT: 'novel-writer-rename-project',
    PLAN_BOOK: 'novel-writer-plan-book',
    VOLUME_INTRO: 'novel-writer-volume-intro',
    BATCH_CREATE: 'novel-writer-batch-create',
    REBUILD_CHAPTERS: 'novel-writer-rebuild',
    BACKUP_META: 'novel-writer-backup',
    PROTECT_META: 'novel-writer-protect',
    NARRATIVE_OVERVIEW: 'novel-writer-narrative-overview',

    // ─── 写作辅助类 ───
    WRITE_CHAPTER: 'novel-writer-write-chapter',
    WRITE_CHAPTER_AUTO: 'novel-writer-write-chapter-auto',
    BATCH_CHAPTERS: 'novel-writer-batch-chapters',
    CONTINUE_CHAPTERS: 'novel-writer-continue-chapters',
    AUTO_WRITER: 'novel-writer-auto-writer',
    REVIEW_CHAPTER: 'novel-writer-review-chapter',
    QUALITY_DASHBOARD: 'novel-writer-quality-dashboard',
    CHAPTER_SETTLEMENT: 'novel-writer-chapter-settlement',
    EXPAND_TEXT: 'novel-writer-expand-text',
    OUTLINE_EXPAND: 'novel-writer-outline-expand',
    CROSS_VOLUME_STATE: 'novel-writer-cross-volume-state',

    // ─── 知识库类 ───
    WORLDVIEW: 'novel-writer-worldview',
    CHARACTER: 'novel-writer-character',
    FACTION: 'novel-writer-faction',
    LOCATION: 'novel-writer-location',
    ITEM: 'novel-writer-item',
    ENTITY_MANAGER: 'novel-writer-entity-manager',
    ENTITY_GENERATE: 'novel-writer-entity-generate',
    AI_BUILDER: 'novel-writer-ai-builder',
    ADD_FANFIC: 'novel-writer-add-fanfic',
    EXTRACT_ELEMENTS: 'novel-writer-extract-elements',
    POPULATE_SETTING_LIB: 'novel-writer-populate-setting-lib',
    TAGS_ANALYSIS: 'novel-writer-tags',
    FINGERPRINT_LIBRARY: 'novel-writer-fingerprint-library',
    STYLE_DISTILLER: 'novel-writer-style-distiller',
    CONTEXT_INJECTOR: 'novel-writer-context-injector',
    OPEN_KNOWLEDGE_BASE: 'novel-writer-open-knowledge-base',

    // ─── 工具类 ───
    DIAGNOSE: 'novel-writer-diagnose',
    TOMATO_RANK: 'novel-writer-tomato-rank',
    REFRESH_INFO_DEBT: 'novel-writer-refresh-info-debt',
    SWITCH_PROVIDER: 'switch-provider',
    IDEATION: 'novel-writer-ideation',
    GOLDEN_OPENING: 'novel-writer-golden-opening',
    STEP_RESULT_VIEWER: 'novel-writer-step-result-viewer',
    BATCH_DECONSTRUCT: 'novel-writer-batch-deconstruct',

    // ─── 视图类 ───
    FULL_WRITER: 'novel-writer-full-writer',
    CO_WRITING: 'novel-writer-co-writing',

    // ─── 版本管理类 ───
    VERSION_HISTORY: 'novel-writer-version-history',
    SAVE_VERSION: 'novel-writer-save-version',

    // ─── 内部调试命令（不暴露到 Obsidian 命令面板） ───
    CLEAR_WORLDVIEW_CACHE: 'clear-worldview-cache',
    WORLDVIEW_CACHE_STATS: 'worldview-cache-stats',
    POPULATE_SETTING_LIB_INTERNAL: 'populate-setting-lib',
} as const;

export type CommandId = typeof CommandIds[keyof typeof CommandIds];

/** 命令分组 */
export enum CommandGroup {
    ProjectManagement = 'project-management',
    WritingAssistant = 'writing-assistant',
    KnowledgeBase = 'knowledge-base',
    Tools = 'tools',
    Views = 'views',
    Version = 'version',
    Internal = 'internal',
}

/** 命令分组元信息 */
export const CommandGroupInfo: Record<CommandGroup, { name: string; description: string }> = {
    [CommandGroup.ProjectManagement]: {
        name: '项目管理',
        description: '项目创建、规划、备份等项目级操作',
    },
    [CommandGroup.WritingAssistant]: {
        name: '写作辅助',
        description: '正文写作、扩写、审查等写作相关功能',
    },
    [CommandGroup.KnowledgeBase]: {
        name: '知识库',
        description: '世界观、人物、势力等设定生成与管理',
    },
    [CommandGroup.Tools]: {
        name: '工具',
        description: '诊断、榜单分析、脑洞等辅助工具',
    },
    [CommandGroup.Views]: {
        name: '视图',
        description: '工作台、协同写作等视图打开',
    },
    [CommandGroup.Version]: {
        name: '版本管理',
        description: '版本保存、历史回滚等版本控制功能',
    },
    [CommandGroup.Internal]: {
        name: '内部命令',
        description: '内部调试用命令，不暴露到命令面板',
    },
};

/** 命令定义 */
export interface CommandDefinition {
    id: string;
    name: string;
    group: CommandGroup;
    description?: string;
    internalOnly?: boolean;
    hasEditorCallback?: boolean;
}

/** 所有命令的定义列表 */
const COMMAND_DEFINITIONS: CommandDefinition[] = [
    // ─── 项目管理类 ───
    { id: CommandIds.CREATE_PROJECT, name: '新建项目', group: CommandGroup.ProjectManagement, description: '创建新的小说项目' },
    { id: CommandIds.RENAME_PROJECT, name: '重命名当前项目', group: CommandGroup.ProjectManagement, description: '重命名当前活动项目' },
    { id: CommandIds.PLAN_BOOK, name: 'AI全书规划', group: CommandGroup.ProjectManagement, description: '使用 AI 进行全书规划' },
    { id: CommandIds.VOLUME_INTRO, name: '全书简介', group: CommandGroup.ProjectManagement, description: '查看和编辑全书简介' },
    { id: CommandIds.BATCH_CREATE, name: '批量建章', group: CommandGroup.ProjectManagement, description: '批量创建章节' },
    { id: CommandIds.REBUILD_CHAPTERS, name: '重建章节', group: CommandGroup.ProjectManagement, description: '重建章节结构' },
    { id: CommandIds.BACKUP_META, name: '备份元文件', group: CommandGroup.ProjectManagement, description: '备份项目元文件' },
    { id: CommandIds.PROTECT_META, name: '保护元文件', group: CommandGroup.ProjectManagement, description: '保护元文件不被意外修改' },
    { id: CommandIds.NARRATIVE_OVERVIEW, name: '叙事总览', group: CommandGroup.ProjectManagement, description: '查看叙事总览' },

    // ─── 写作辅助类 ───
    // 以下 4 个旧版正文生成命令已废弃（正文统一走 CoWriterEngine），标记 internalOnly 以从公开命令收敛
    { id: CommandIds.WRITE_CHAPTER, name: 'AI写正文〔旧〕', group: CommandGroup.WritingAssistant, description: '使用 AI 撰写章节正文（旧版）', internalOnly: true },
    { id: CommandIds.WRITE_CHAPTER_AUTO, name: '后台AI写正文〔旧〕', group: CommandGroup.WritingAssistant, description: '后台自动撰写章节正文（旧版）', internalOnly: true },
    { id: CommandIds.BATCH_CHAPTERS, name: '批量写正文〔旧〕', group: CommandGroup.WritingAssistant, description: '批量撰写章节正文（旧版）', internalOnly: true },
    { id: CommandIds.CONTINUE_CHAPTERS, name: '续写规划', group: CommandGroup.WritingAssistant, description: '规划后续章节内容' },
    { id: CommandIds.AUTO_WRITER, name: '自动写作器〔旧〕', group: CommandGroup.WritingAssistant, description: '自动写作器（旧版）', internalOnly: true },
    { id: CommandIds.REVIEW_CHAPTER, name: '连贯性审查', group: CommandGroup.WritingAssistant, description: '审查章节连贯性' },
    { id: CommandIds.QUALITY_DASHBOARD, name: '📊 质量仪表盘', group: CommandGroup.WritingAssistant, description: '六维质量评分 + 问题定位 + 事实确认' },
    { id: CommandIds.CHAPTER_SETTLEMENT, name: '章节结算', group: CommandGroup.WritingAssistant, description: '章节内容结算与分析' },
    { id: CommandIds.EXPAND_TEXT, name: '📝 段落扩写', group: CommandGroup.WritingAssistant, description: '扩写选中的段落', hasEditorCallback: true },
    { id: CommandIds.OUTLINE_EXPAND, name: '✨ 智能大纲扩写', group: CommandGroup.WritingAssistant, description: '智能扩写大纲', hasEditorCallback: true },
    { id: CommandIds.CROSS_VOLUME_STATE, name: '跨卷状态继承', group: CommandGroup.WritingAssistant, description: '跨卷状态继承管理' },

    // ─── 知识库类 ───
    { id: CommandIds.WORLDVIEW, name: '生成世界观', group: CommandGroup.KnowledgeBase, description: '使用 AI 生成世界观设定' },
    { id: CommandIds.CHARACTER, name: '生成人物', group: CommandGroup.KnowledgeBase, description: '使用 AI 生成人物设定' },
    { id: CommandIds.FACTION, name: '生成势力', group: CommandGroup.KnowledgeBase, description: '使用 AI 生成势力设定' },
    { id: CommandIds.LOCATION, name: '生成地点', group: CommandGroup.KnowledgeBase, description: '使用 AI 生成地点设定' },
    { id: CommandIds.ITEM, name: '生成物品功法', group: CommandGroup.KnowledgeBase, description: '使用 AI 生成物品功法设定' },
    { id: CommandIds.ENTITY_MANAGER, name: '📚 实体管理', group: CommandGroup.KnowledgeBase, description: '统一管理所有实体（人物/地点/势力/物品）' },
    { id: CommandIds.ENTITY_GENERATE, name: '✨ 统一生成实体', group: CommandGroup.KnowledgeBase, description: '统一流程生成各类实体' },
    { id: CommandIds.AI_BUILDER, name: 'AI世界元素生成', group: CommandGroup.KnowledgeBase, description: 'AI 世界元素批量生成' },
    { id: CommandIds.ADD_FANFIC, name: '添加同人设定', group: CommandGroup.KnowledgeBase, description: '添加同人作品设定' },
    { id: CommandIds.EXTRACT_ELEMENTS, name: 'AI 元素提取', group: CommandGroup.KnowledgeBase, description: '从文本中提取元素' },
    { id: CommandIds.POPULATE_SETTING_LIB, name: '从世界观生成设定库', group: CommandGroup.KnowledgeBase, description: '从世界观生成设定库' },
    { id: CommandIds.TAGS_ANALYSIS, name: '作品标签分析', group: CommandGroup.KnowledgeBase, description: '分析作品标签' },
    { id: CommandIds.FINGERPRINT_LIBRARY, name: '🔍 打开写作指纹库', group: CommandGroup.KnowledgeBase, description: '打开写作指纹库视图' },
    { id: CommandIds.STYLE_DISTILLER, name: '文笔风格蒸馏', group: CommandGroup.KnowledgeBase, description: '蒸馏文笔风格' },
    { id: CommandIds.CONTEXT_INJECTOR, name: '上下文注入', group: CommandGroup.KnowledgeBase, description: '上下文注入配置' },
    { id: CommandIds.OPEN_KNOWLEDGE_BASE, name: '📚 打开知识库管理界面', group: CommandGroup.KnowledgeBase, description: '打开知识库管理视图' },

    // ─── 工具类 ───
    { id: CommandIds.DIAGNOSE, name: '流程诊断', group: CommandGroup.Tools, description: '诊断写作流程问题' },
    { id: CommandIds.TOMATO_RANK, name: '番茄榜单分析', group: CommandGroup.Tools, description: '番茄小说榜单分析' },
    { id: CommandIds.REFRESH_INFO_DEBT, name: '刷新信息债看板', group: CommandGroup.Tools, description: '刷新信息债看板' },
    { id: CommandIds.SWITCH_PROVIDER, name: '快速切换 AI 提供商', group: CommandGroup.Tools, description: '快速切换 AI 提供商' },
    { id: CommandIds.IDEATION, name: '💡 脑洞构思工坊', group: CommandGroup.Tools, description: '脑洞构思工作坊' },
    { id: CommandIds.GOLDEN_OPENING, name: '🌟 黄金开篇工坊', group: CommandGroup.Tools, description: '黄金开篇设计工作坊' },
    { id: CommandIds.STEP_RESULT_VIEWER, name: '📋 步骤结果查看', group: CommandGroup.Tools, description: '查看步骤执行结果' },
    { id: CommandIds.BATCH_DECONSTRUCT, name: '📚 批量拆解', group: CommandGroup.Tools, description: '批量拆解多本书的写作风格' },

    // ─── 视图类 ───
    { id: CommandIds.FULL_WRITER, name: '📖 完整写作工作台', group: CommandGroup.Views, description: '打开完整写作工作台' },
    { id: CommandIds.CO_WRITING, name: '✍️ 句级协同写作工作台', group: CommandGroup.Views, description: '打开句级协同写作工作台' },

    // ─── 版本管理类 ───
    { id: CommandIds.VERSION_HISTORY, name: '📜 版本历史与回滚', group: CommandGroup.Version, description: '查看版本历史与回滚' },
    { id: CommandIds.SAVE_VERSION, name: '💾 保存当前版本', group: CommandGroup.Version, description: '保存当前版本' },

    // ─── 内部调试命令 ───
    { id: CommandIds.CLEAR_WORLDVIEW_CACHE, name: '清空世界观缓存', group: CommandGroup.Internal, description: '清空世界观缓存', internalOnly: true },
    { id: CommandIds.WORLDVIEW_CACHE_STATS, name: '世界观缓存统计', group: CommandGroup.Internal, description: '显示世界观缓存统计', internalOnly: true },
    { id: CommandIds.POPULATE_SETTING_LIB_INTERNAL, name: '生成设定库（内部）', group: CommandGroup.Internal, description: '内部设定库生成命令', internalOnly: true },
];

/** CommandRegistry 所需的插件接口 */
export interface CommandRegistryDeps {
    app: App;
    registry: InternalRegistry;
    aiEngine: { extractElements(content: string): Promise<{ error?: string }> };
    ctxManager: any;
    foreshadowManager: { refreshInfoDebt(): void };
    workspaceManager?: FloatWorkspaceManager;
    /** 插件实例引用（实体 Modal 需要 access settings 和回调槽） */
    plugin: import('../main').default;
    /** 获取当前活动项目名 */
    getActiveProject(): string | null;
    /** 打开提供商切换弹窗 */
    openProviderSwitcher(): void;
    /** 刷新工作台面板 */
    refreshFullWriterContextPanel(): void;
    /** 执行 populateSettingLib */
    populateSettingLib(): Promise<void>;
    /** 工作台状态 */
    getWorkbenchState(): { project?: string; chapterName?: string; chapterNum?: number; volume?: string } | null;
    /** 是否为工作台上下文 */
    isWorkbenchContext(): boolean;
}

export class CommandRegistry {
    private readonly deps: CommandRegistryDeps;

    constructor(deps: CommandRegistryDeps) {
        this.deps = deps;
    }

    // ─── 命令查询方法 ───

    /** 获取所有命令定义列表 */
    getAllCommands(): CommandDefinition[] {
        return [...COMMAND_DEFINITIONS];
    }

    /** 根据 ID 查找命令定义 */
    findCommand(id: string): CommandDefinition | undefined {
        return COMMAND_DEFINITIONS.find(cmd => cmd.id === id);
    }

    /** 根据分组获取命令列表 */
    getCommandsByGroup(group: CommandGroup): CommandDefinition[] {
        return COMMAND_DEFINITIONS.filter(cmd => cmd.group === group);
    }

    /** 获取所有公开命令（排除内部调试命令） */
    getPublicCommands(): CommandDefinition[] {
        return COMMAND_DEFINITIONS.filter(cmd => !cmd.internalOnly);
    }

    /** 获取所有内部命令 */
    getInternalCommands(): CommandDefinition[] {
        return COMMAND_DEFINITIONS.filter(cmd => cmd.internalOnly);
    }

    /** 检查命令是否存在 */
    hasCommand(id: string): boolean {
        return COMMAND_DEFINITIONS.some(cmd => cmd.id === id);
    }

    /** 获取命令总数统计 */
    getCommandCount(): { total: number; public: number; internal: number } {
        const total = COMMAND_DEFINITIONS.length;
        const internal = COMMAND_DEFINITIONS.filter(cmd => cmd.internalOnly).length;
        return { total, public: total - internal, internal };
    }

    // ─── 命令注册方法 ───

    /** 注册 InternalRegistry 命令（供外部 API 调用） */
    registerInternalCommands(): void {
        const r = this.deps.registry;

        // ── 项目管理类 ──
        r.register(CommandIds.CREATE_PROJECT, async () => new CreateProjectModal(this.deps.app, this.deps.plugin).open());
        r.register(CommandIds.PLAN_BOOK, async () => new PlanBookModal(this.deps.app, this.deps.plugin).open());
        r.register(CommandIds.VOLUME_INTRO, async () => new VolumeIntroModal(this.deps.app, this.deps.plugin).open());
        r.register(CommandIds.BATCH_CHAPTERS, async () => new BatchChaptersModal(this.deps.app, this.deps.plugin).open());
        r.register(CommandIds.CONTINUE_CHAPTERS, async () => new ContinueChaptersModal(this.deps.app, this.deps.plugin).open());
        r.register(CommandIds.AUTO_WRITER, async () => new AutoWriterModal(this.deps.app, this.deps.plugin).open());
        r.register(CommandIds.DIAGNOSE, async () => new DiagnoseWriterModal(this.deps.app, this.deps.plugin).open());
        r.register(CommandIds.TOMATO_RANK, async () => new TomatoRankModal(this.deps.app, this.deps.plugin).open());
        r.register(CommandIds.REBUILD_CHAPTERS, async () => new RebuildChaptersModal(this.deps.app, this.deps.plugin).open());
        r.register(CommandIds.BACKUP_META, async () => new BackupYuanModal(this.deps.app, this.deps.plugin).open());
        r.register(CommandIds.PROTECT_META, async () => new ProtectYuanModal(this.deps.app, this.deps.plugin).open());
        r.register(CommandIds.TAGS_ANALYSIS, async () => new NovelTagsModal(this.deps.app, this.deps.plugin).open());
        r.register(CommandIds.AI_BUILDER, async () => new AiBuilderModal(this.deps.app, this.deps.plugin).open());
        r.register(CommandIds.ADD_FANFIC, async () => new AddFanficSettingModal(this.deps.app, this.deps.plugin).open());
        // U1（技术审计）：WRITE_CHAPTER 此前仅有定义未注册，tools-modal 的
        // 「整章生成（旧）」按钮与 executeCommand 双路由均落空（点击无任何效果）。
        r.register(CommandIds.WRITE_CHAPTER, async () => new WriteChapterModal(this.deps.app, this.deps.plugin).open());
        r.register(CommandIds.WRITE_CHAPTER_AUTO, async () => { WriteChapterModal.runBackground(this.deps.app, this.deps.plugin); });
        r.register(CommandIds.REVIEW_CHAPTER, async () => new ReviewChapterModal(this.deps.app, this.deps.plugin).open());
        r.register(CommandIds.QUALITY_DASHBOARD, async () => new QualityDashboardModal(this.deps.app, this.deps.plugin).open());
        r.register(CommandIds.BATCH_CREATE, async () => new BatchCreateModal(this.deps.app, this.deps.plugin).open());
        r.register(CommandIds.WORLDVIEW, async () => new GenerateWorldviewModal(this.deps.app, this.deps.plugin).open());
        r.register(CommandIds.CHARACTER, async () => new GenerateCharacterModal(this.deps.app, this.deps.plugin).open());
        r.register(CommandIds.FACTION, async () => new GenerateFactionModal(this.deps.app, this.deps.plugin).open());
        r.register(CommandIds.LOCATION, async () => new GenerateLocationModal(this.deps.app, this.deps.plugin).open());
        r.register(CommandIds.ITEM, async () => new GenerateItemModal(this.deps.app, this.deps.plugin).open());
        r.register(CommandIds.ENTITY_MANAGER, async () => {
            const project = this.deps.getActiveProject();
            if (!project) {
                new Notice('⚠️ 请先选择或打开一个项目', 3000);
                return;
            }
            new UnifiedEntityManagerModal(this.deps.app, this.deps.plugin, project).open();
        });
        r.register(CommandIds.ENTITY_GENERATE, async () => {
            const project = this.deps.getActiveProject();
            new UnifiedEntityGenerateModal(this.deps.app, this.deps.plugin, project || undefined).open();
        });
        r.register(CommandIds.REFRESH_INFO_DEBT, async () => { this.deps.foreshadowManager.refreshInfoDebt(); });
        r.register(CommandIds.CROSS_VOLUME_STATE, async () => new CrossVolumeStateModal(this.deps.app, this.deps.plugin).open());
        r.register(CommandIds.STYLE_DISTILLER, async () => new StyleDistillerModal(this.deps.app, this.deps.plugin).open());
        r.register(CommandIds.CONTEXT_INJECTOR, async () => new ContextInjectorModal(this.deps.app, this.deps.plugin).open());
        r.register(CommandIds.CHAPTER_SETTLEMENT, async () => new ChapterSettlementModal(this.deps.app, this.deps.plugin).open());
        r.register(CommandIds.IDEATION, async () => new IdeationModal(this.deps.app, this.deps.plugin).open());
        r.register(CommandIds.GOLDEN_OPENING, async () => new GoldenOpeningModal(this.deps.app, this.deps.plugin).open());
        r.register(CommandIds.STEP_RESULT_VIEWER, async () => new StepResultViewerModal(this.deps.app, this.deps.plugin).open());
        r.register(CommandIds.BATCH_DECONSTRUCT, async () => {
            const { BatchDeconstructModal } = await import('../ui/batch-deconstruct-modal');
            new BatchDeconstructModal(this.deps.app, this.deps.plugin).open();
        });
        r.register(CommandIds.FULL_WRITER, async () => { this.openFullWriterView(); });
        r.register(CommandIds.SWITCH_PROVIDER, async () => this.deps.openProviderSwitcher());
        r.register(CommandIds.EXTRACT_ELEMENTS, async () => { this.extractElementsCommand(); });
        r.register(CommandIds.POPULATE_SETTING_LIB_INTERNAL, () => this.deps.populateSettingLib());
        r.register(CommandIds.CO_WRITING, async () => { await this.openCoWritingFromActiveContext(); });
        r.register(CommandIds.EXPAND_TEXT, async () => { this.expandTextFromActive(); });
        r.register(CommandIds.OUTLINE_EXPAND, async () => { this.outlineExpandFromActive(); });
        r.register(CommandIds.FINGERPRINT_LIBRARY, async () => { await this.openFingerprintLibrary(); });
        r.register(CommandIds.OPEN_KNOWLEDGE_BASE, async () => { await this.openKnowledgeBase(); });
        r.register(CommandIds.CLEAR_WORLDVIEW_CACHE, async () => {
            const cacheService = (this.deps.plugin as any).worldviewCacheService;
            if (cacheService) {
                cacheService.clearAll();
                new Notice('✅ 世界观缓存已清空');
                log.info('[WorldviewCache] 缓存已清空');
            }
        });
        r.register(CommandIds.WORLDVIEW_CACHE_STATS, async () => {
            const cacheService = (this.deps.plugin as any).worldviewCacheService;
            if (cacheService) {
                const stats = cacheService.getStats();
                log.info('[WorldviewCache] 缓存统计:', stats);
                new Notice(`📊 缓存统计：命中率 ${(stats.hitRate * 100).toFixed(1)}%，${stats.totalEntries} 个条目，${(stats.totalSize / 1024).toFixed(1)} KB`, 8000);
            }
        });
        r.register(CommandIds.VERSION_HISTORY, async () => { await this.openVersionHistory(); });
        r.register(CommandIds.SAVE_VERSION, async () => { await this.saveCurrentVersion(); });
    }

    /** 注册 Obsidian 命令面板命令 */
    registerObsidianCommands(addCommand: (cmd: { id: string; name: string; callback?: () => void; editorCallback?: (editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => any }) => void): void {
        const exec = (id: string) => () => {
            this.deps.registry.execute(id).catch(err => log.error('[小说工坊]', err));
        };

        addCommand({ id: CommandIds.CREATE_PROJECT, name: '新建项目', callback: exec(CommandIds.CREATE_PROJECT) });
        addCommand({ id: CommandIds.PLAN_BOOK, name: 'AI全书规划', callback: exec(CommandIds.PLAN_BOOK) });
        addCommand({ id: CommandIds.VOLUME_INTRO, name: '全书简介', callback: exec(CommandIds.VOLUME_INTRO) });
        addCommand({ id: CommandIds.CONTINUE_CHAPTERS, name: '续写规划', callback: exec(CommandIds.CONTINUE_CHAPTERS) });
        addCommand({ id: 'novel-writer-diagnose', name: '流程诊断', callback: exec('novel-writer-diagnose') });
        addCommand({ id: CommandIds.TOMATO_RANK, name: '番茄榜单分析', callback: exec(CommandIds.TOMATO_RANK) });
        addCommand({ id: CommandIds.REBUILD_CHAPTERS, name: '重建章节', callback: exec(CommandIds.REBUILD_CHAPTERS) });
        addCommand({ id: CommandIds.BACKUP_META, name: '备份元文件', callback: exec(CommandIds.BACKUP_META) });
        addCommand({ id: CommandIds.PROTECT_META, name: '保护元文件', callback: exec(CommandIds.PROTECT_META) });
        addCommand({ id: CommandIds.TAGS_ANALYSIS, name: '作品标签分析', callback: exec(CommandIds.TAGS_ANALYSIS) });
        addCommand({ id: CommandIds.AI_BUILDER, name: 'AI世界元素生成', callback: exec(CommandIds.AI_BUILDER) });
        addCommand({ id: CommandIds.ADD_FANFIC, name: '添加同人设定', callback: exec(CommandIds.ADD_FANFIC) });
        addCommand({ id: CommandIds.REVIEW_CHAPTER, name: '连贯性审查', callback: exec(CommandIds.REVIEW_CHAPTER) });
        addCommand({ id: CommandIds.QUALITY_DASHBOARD, name: '📊 质量仪表盘', callback: exec(CommandIds.QUALITY_DASHBOARD) });
        addCommand({ id: CommandIds.BATCH_CREATE, name: '批量建章', callback: exec(CommandIds.BATCH_CREATE) });
        addCommand({ id: 'novel-writer-worldview', name: '生成世界观', callback: exec('novel-writer-worldview') });
        addCommand({ id: CommandIds.CHARACTER, name: '生成人物', callback: exec(CommandIds.CHARACTER) });
        addCommand({ id: CommandIds.FACTION, name: '生成势力', callback: exec(CommandIds.FACTION) });
        addCommand({ id: CommandIds.LOCATION, name: '生成地点', callback: exec(CommandIds.LOCATION) });
        addCommand({ id: CommandIds.ITEM, name: '生成物品功法', callback: exec(CommandIds.ITEM) });
        addCommand({ id: CommandIds.ENTITY_MANAGER, name: '📚 实体管理', callback: exec(CommandIds.ENTITY_MANAGER) });
        addCommand({ id: CommandIds.ENTITY_GENERATE, name: '✨ 统一生成实体', callback: exec(CommandIds.ENTITY_GENERATE) });
        addCommand({ id: CommandIds.REFRESH_INFO_DEBT, name: '刷新信息债看板', callback: exec(CommandIds.REFRESH_INFO_DEBT) });
        addCommand({ id: CommandIds.CROSS_VOLUME_STATE, name: '跨卷状态继承', callback: exec(CommandIds.CROSS_VOLUME_STATE) });
        addCommand({ id: CommandIds.STYLE_DISTILLER, name: '文笔风格蒸馏', callback: exec(CommandIds.STYLE_DISTILLER) });
        addCommand({ id: CommandIds.CONTEXT_INJECTOR, name: '上下文注入', callback: exec(CommandIds.CONTEXT_INJECTOR) });
        addCommand({ id: CommandIds.CHAPTER_SETTLEMENT, name: '章节结算', callback: exec(CommandIds.CHAPTER_SETTLEMENT) });
        addCommand({ id: 'novel-writer-ideation', name: '💡 脑洞构思工坊', callback: exec('novel-writer-ideation') });
        addCommand({ id: CommandIds.GOLDEN_OPENING, name: '🌟 黄金开篇工坊', callback: exec(CommandIds.GOLDEN_OPENING) });
        addCommand({ id: CommandIds.STEP_RESULT_VIEWER, name: '📋 步骤结果查看', callback: exec(CommandIds.STEP_RESULT_VIEWER) });
        addCommand({ id: CommandIds.BATCH_DECONSTRUCT, name: '📚 批量拆解', callback: exec(CommandIds.BATCH_DECONSTRUCT) });
        addCommand({ id: CommandIds.FULL_WRITER, name: '📖 完整写作工作台', callback: exec(CommandIds.FULL_WRITER) });
        addCommand({ id: CommandIds.CO_WRITING, name: '✍️ 句级协同写作工作台', callback: exec(CommandIds.CO_WRITING) });
        addCommand({ id: 'novel-writer-fingerprint-library', name: '🔍 打开写作指纹库', callback: exec('novel-writer-fingerprint-library') });
        addCommand({ id: CommandIds.OPEN_KNOWLEDGE_BASE, name: '📚 打开知识库管理界面', callback: exec(CommandIds.OPEN_KNOWLEDGE_BASE) });
        addCommand({ id: CommandIds.SWITCH_PROVIDER, name: '快速切换 AI 提供商', callback: exec(CommandIds.SWITCH_PROVIDER) });
        addCommand({ id: CommandIds.EXTRACT_ELEMENTS, name: 'AI 元素提取', callback: exec(CommandIds.EXTRACT_ELEMENTS) });
        addCommand({
            id: CommandIds.EXPAND_TEXT,
            name: '📝 段落扩写',
            editorCallback: (editor, _view) => {
                const selectedText = editor.getSelection();
                new ExpandTextModal(this.deps.app, this.deps.plugin, selectedText, editor).open();
            },
        });
        addCommand({
            id: CommandIds.OUTLINE_EXPAND,
            name: '✨ 智能大纲扩写',
            editorCallback: (editor, _view) => {
                const selectedText = editor.getSelection();
                const allText = editor.getValue();
                const sourceText = selectedText || allText;
                const modal = new OutlineExpandModal(this.deps.app, this.deps.plugin, sourceText, {
                    mode: selectedText ? 'paragraph' : 'chapter',
                    targetWords: 3000,
                });
                modal.open();
            },
        });
        addCommand({ id: CommandIds.POPULATE_SETTING_LIB, name: '从世界观生成设定库', callback: exec(CommandIds.POPULATE_SETTING_LIB_INTERNAL) });
        addCommand({ id: CommandIds.RENAME_PROJECT, name: '重命名当前项目', callback: () => this.renameProject() });

        // 叙事总览（直接执行，不走 registry）
        addCommand({ id: CommandIds.NARRATIVE_OVERVIEW, name: '叙事总览', callback: () => this.openNarrativeOverview() });

        addCommand({ id: CommandIds.VERSION_HISTORY, name: '📜 版本历史与回滚', callback: exec(CommandIds.VERSION_HISTORY) });
        addCommand({ id: CommandIds.SAVE_VERSION, name: '💾 保存当前版本', callback: exec(CommandIds.SAVE_VERSION) });
    }

    // ─── 视图操作 ───

    async openFullWriterView(): Promise<void> {
        const { workspace } = this.deps.app;
        const existing = workspace.getLeavesOfType(FULL_WRITER_VIEW_TYPE);
        let leaf: WorkspaceLeaf;
        if (existing.length > 0) {
            leaf = existing[0];
            for (let i = 1; i < existing.length; i++) existing[i].detach();
        } else {
            leaf = workspace.getLeaf('tab');
        }
        await leaf.setViewState({ type: FULL_WRITER_VIEW_TYPE, active: true });
        workspace.revealLeaf(leaf);
    }

    async activateCoWritingView(project?: string, chapterName?: string, volume?: string, chapterNum?: number): Promise<void> {
        const { workspace } = this.deps.app;
        let leaf = workspace.getLeavesOfType(VIEW_TYPE_CO_WRITE)[0];
        if (!leaf) {
            leaf = workspace.getLeaf('tab');
            await leaf.setViewState({ type: VIEW_TYPE_CO_WRITE, active: true });
        }
        workspace.revealLeaf(leaf);
        if (project || chapterName) {
            const view = leaf.view as CoWritingView;
            if (view) await view.openChapter(project || '', chapterName || '', volume || '第1卷', chapterNum || 1);
        }
        await this.deps.workspaceManager?.openAll();
    }

    async openCoWritingFromActiveContext(): Promise<void> {
        const wb = this.deps.getWorkbenchState();
        if (wb?.project && wb?.chapterNum) {
            await this.activateCoWritingView(wb.project, wb.chapterName || `第${wb.chapterNum}章`, wb.volume || '第1卷', wb.chapterNum);
            return;
        }
        const activeFile = this.deps.app.workspace.getActiveFile();
        const ctx = activeFile ? parseChapterFromPath(activeFile.path) : null;
        if (ctx) {
            await this.activateCoWritingView(ctx.project, ctx.chapterName, ctx.volume, ctx.chapterNum);
            new Notice(`✍️ 已绑定章节：${ctx.project} · ${ctx.volume} · 第${ctx.chapterNum}章`, 3000);
            return;
        }
        await this.activateCoWritingView();
        new Notice('已打开句级协同写作工作台。请先打开某章「正文」文件，或从完整写作工作台选择章节后再进入，即可自动绑定。', 6000);
    }

    async openFingerprintLibrary(): Promise<void> {
        const { workspace } = this.deps.app;
        const existing = workspace.getLeavesOfType(VIEW_TYPE_WRITING_FINGERPRINT);
        let leaf: WorkspaceLeaf;
        if (existing.length > 0) {
            leaf = existing[0];
            for (let i = 1; i < existing.length; i++) existing[i].detach();
        } else {
            leaf = workspace.getLeaf('tab');
        }
        await leaf.setViewState({ type: VIEW_TYPE_WRITING_FINGERPRINT, active: true });
        workspace.revealLeaf(leaf);
        new Notice('🔍 已打开写作指纹库');
    }

    async openKnowledgeBase(): Promise<void> {
        const { workspace } = this.deps.app;
        const existing = workspace.getLeavesOfType(VIEW_TYPE_KNOWLEDGE_BASE);
        let leaf: WorkspaceLeaf;
        if (existing.length > 0) {
            leaf = existing[0];
            for (let i = 1; i < existing.length; i++) existing[i].detach();
        } else {
            leaf = workspace.getLeaf('tab');
        }
        await leaf.setViewState({ type: VIEW_TYPE_KNOWLEDGE_BASE, active: true });
        workspace.revealLeaf(leaf);
    }

    // ─── 私有辅助 ───

    private async extractElementsCommand(): Promise<void> {
        const activeView = this.deps.app.workspace.getActiveViewOfType(ItemView);
        if (!activeView) { new Notice('请先打开一个 Markdown 文件'); return; }
        const file = (activeView as ItemView & { file?: TFile }).file ?? null;
        if (!file) { new Notice('未找到当前文件'); return; }
        const content = await this.deps.app.vault.read(file);
        const result = await this.deps.aiEngine.extractElements(content);
        if (result.error) {
            new Notice(`元素提取失败: ${result.error}`);
        } else {
            new Notice(`✅ 元素提取完成`, 5000);
        }
    }

    private expandTextFromActive(): void {
        const view = this.deps.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view) {
            new Notice('请先打开 Markdown 编辑器并选中需要扩写的段落');
            return;
        }
        const editor = view.editor;
        const selectedText = editor.getSelection();
        new ExpandTextModal(this.deps.app, this.deps.plugin, selectedText, editor).open();
    }

    private outlineExpandFromActive(): void {
        const view = this.deps.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view) {
            new Notice('请先打开 Markdown 编辑器');
            return;
        }
        const editor = view.editor;
        const selectedText = editor.getSelection();
        const allText = editor.getValue();
        const sourceText = selectedText || allText;
        const modal = new OutlineExpandModal(this.deps.app, this.deps.plugin, sourceText, {
            mode: selectedText ? 'paragraph' : 'chapter',
            targetWords: 3000,
        });
        modal.open();
    }

    private renameProject(): void {
        const activeFile = this.deps.app.workspace.getActiveFile();
        if (!activeFile) { new Notice('请先打开项目中的文件'); return; }
        const project = activeFile.path.split('/')[0];
        new Notice(`当前项目: ${project}。请在文件浏览器中右键文件夹重命名，或通过生成世界观自动重命名。`);
    }

    private async openNarrativeOverview(): Promise<void> {
        const project = this.deps.getActiveProject();
        if (!project) { new Notice('请先选择项目'); return; }
        const overviewPath = pjNarrativeOverview(project);
        const file = this.deps.app.vault.getAbstractFileByPath(overviewPath);
        if (file instanceof TFile) {
            const leaf = this.deps.app.workspace.getLeaf('tab');
            await leaf.openFile(file);
        } else {
            new Notice('叙事总览尚未生成，请先执行章节结算');
        }
    }

    // ─── 版本管理 ───

    private async getCurrentFileContext(): Promise<{
        project: string;
        contentType: import('../shared/version-types').ContentType;
        contentKey: string;
        sourcePath: string;
        content: string;
    } | null> {
        const activeFile = this.deps.app.workspace.getActiveFile();
        if (!activeFile) {
            new Notice('请先打开一个 Markdown 文件');
            return null;
        }

        const path = activeFile.path;
        const project = path.split('/')[0];
        if (!project) {
            new Notice('未找到所属项目');
            return null;
        }

        const chapterCtx = parseChapterFromPath(path);
        let contentType: import('../shared/version-types').ContentType = 'chapter';
        let contentKey = activeFile.basename;

        if (chapterCtx) {
            contentType = 'chapter';
            contentKey = `${chapterCtx.volume}_第${chapterCtx.chapterNum}章`;
        } else if (path.includes('/03-大纲与章节/分卷大纲/')) {
            contentType = 'outline';
            contentKey = activeFile.basename;
        } else if (path.includes('/01-世界架构/') && path.includes('世界观')) {
            contentType = 'worldview';
            contentKey = '世界观总览';
        } else if (path.includes('/01-世界架构/人物/')) {
            contentType = 'character';
            contentKey = activeFile.basename;
        } else if (path.includes('/01-世界架构/')) {
            contentType = 'setting';
            contentKey = activeFile.basename;
        }

        const content = await this.deps.app.vault.read(activeFile);

        return {
            project,
            contentType,
            contentKey,
            sourcePath: path,
            content,
        };
    }

    private async openVersionHistory(): Promise<void> {
        const ctx = await this.getCurrentFileContext();
        if (!ctx) return;

        const modal = new ChapterVersionModal(this.deps.app, {
            project: ctx.project,
            contentType: ctx.contentType,
            contentKey: ctx.contentKey,
            sourcePath: ctx.sourcePath,
            currentContent: ctx.content,
            onSaveVersion: async () => {
                const service = this.deps.plugin.engineRegistry.get<ChapterVersionService>(ENGINE_NAMES.CHAPTER_VERSION_SERVICE);
                return await service.saveVersion(
                    ctx.project,
                    ctx.contentType,
                    ctx.contentKey,
                    ctx.sourcePath,
                    ctx.content,
                    { type: 'manual' },
                );
            },
            onRollback: async (version) => {
                const service = this.deps.plugin.engineRegistry.get<ChapterVersionService>(ENGINE_NAMES.CHAPTER_VERSION_SERVICE);
                const activeFile = this.deps.app.workspace.getActiveFile();
                const currentContent = activeFile ? await this.deps.app.vault.read(activeFile) : '';
                await service.rollbackToVersion(version, currentContent);
            },
        }, this.deps.plugin.engineRegistry);
        modal.open();
    }

    private async saveCurrentVersion(): Promise<void> {
        const ctx = await this.getCurrentFileContext();
        if (!ctx) return;

        const service = this.deps.plugin.engineRegistry.get<ChapterVersionService>(ENGINE_NAMES.CHAPTER_VERSION_SERVICE);
        const version = await service.saveVersion(
            ctx.project,
            ctx.contentType,
            ctx.contentKey,
            ctx.sourcePath,
            ctx.content,
            { type: 'manual' },
        );

        new Notice(`✅ 版本已保存：v${version.version}（${version.wordCount} 字）`, 4000);
    }
}

/** 从文件路径反解章节上下文 */
export function parseChapterFromPath(path: string): { project: string; volume: string; chapterNum: number; chapterName: string } | null {
    if (!path) return null;
    const m = path.match(/^(.+?)\/03-大纲与章节\/正文\/(第(\d+)卷)\/第(\d+)章_正文\.md$/);
    if (!m) return null;
    const project = m[1];
    const chapterNum = parseInt(m[4], 10);
    if (!project || !Number.isFinite(chapterNum)) return null;
    return { project, volume: m[2], chapterNum, chapterName: `第${chapterNum}章` };
}
