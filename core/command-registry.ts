/**
 * command-registry.ts — 命令注册与路由
 *
 * 职责：注册所有 Obsidian 命令、InternalRegistry 桥接、视图打开逻辑
 * 从 main.ts 拆分而来
 */

import { App, Editor, ItemView, MarkdownFileInfo, MarkdownView, Notice, TFile } from 'obsidian';
import { InternalRegistry } from '@/shared/internal-registry';
import type { ChapterVersionPort } from '@/shared/chapter-version-port';
import { importExampleProject } from './example-project-service';
import { ENGINE_NAMES } from '@/shared/engine-names';
import { parseChapterLocation, pjNarrativeOverview } from '@/shared/paths';
import { createLogger } from '@/shared/logger';
import { NOOP_COMMAND_UI_PORT, type CommandUiPort } from '@/shared/command-ui-port';
import type { CreationMode } from '@/shared/creation-mode';
import { getProjectModeSync } from '@/shared/project-mode';
import { LONG_ONLY, SCRIPT_ONLY, SHORT_ONLY } from '@/shared/command-mode-rules';


const log = createLogger('CommandRegistry');
/**
 * 命令 ID 常量枚举
 * 避免魔法字符串，提供类型安全的命令 ID 引用
 */
import { CommandIds, type CommandId } from '@/shared/command-ids';
export { CommandIds, type CommandId };

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
    { id: CommandIds.CREATE_PROJECT, name: '新建项目', group: CommandGroup.ProjectManagement, description: '新建长篇小说/同人项目（短篇与剧本使用独立入口）' },
    { id: CommandIds.AGENT_GUIDE, name: '🤖 对话引导（新建/继续项目）', group: CommandGroup.ProjectManagement, description: '通过多轮对话完成项目创建、故事结构与流程引导，无需手动跳转或填表单' },
    { id: CommandIds.CREATE_SHORT, name: '新建短篇项目', group: CommandGroup.ProjectManagement, description: '先完成短篇前期调研，再创建番茄短篇项目' },
    { id: CommandIds.CREATE_SCRIPT, name: '新建剧本项目', group: CommandGroup.ProjectManagement, description: '先完成剧本前期调研，再创建红果短剧项目' },
        { id: CommandIds.SHORT_RESEARCH, name: '短篇前期调研', group: CommandGroup.ProjectManagement, description: '编辑当前短篇项目的前期调研与五维分类' },
    { id: CommandIds.SCRIPT_RESEARCH, name: '剧本前期调研', group: CommandGroup.ProjectManagement, description: '编辑当前剧本项目的前期调研与商业定位' },
    { id: CommandIds.SHORT_STORY_CORE, name: '短篇故事核', group: CommandGroup.ProjectManagement, description: '编辑当前短篇的故事核' },
    { id: CommandIds.SHORT_OUTLINE, name: '短篇分节大纲', group: CommandGroup.ProjectManagement, description: '编辑当前短篇的分节大纲' },
    { id: CommandIds.SCRIPT_SCENE_BIBLE, name: '剧本场景圣经', group: CommandGroup.ProjectManagement, description: '编辑当前剧本的场景圣经' },
    { id: CommandIds.SCRIPT_OUTLINE, name: '剧本分集大纲', group: CommandGroup.ProjectManagement, description: '编辑当前剧本的分集大纲' },
    { id: CommandIds.SCRIPT_STORYBOARD, name: '剧本分镜表', group: CommandGroup.ProjectManagement, description: '编辑当前剧本的分镜表' },
    { id: CommandIds.IMPORT_EXAMPLE, name: '导入示例项目', group: CommandGroup.ProjectManagement, description: '一键创建含 1 卷 3 章、人物与伏笔的示例项目' },
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
    { id: CommandIds.BATCH_NOVELS, name: '📚 批量生成章节（正式流程）', group: CommandGroup.WritingAssistant, description: '按 7 步批量流程逐章生成规划、正文与分析报告，并执行结算' },
    { id: CommandIds.CONTINUE_CHAPTERS, name: '续写规划', group: CommandGroup.WritingAssistant, description: '规划后续章节内容' },
    { id: CommandIds.AUTO_WRITER, name: '自动写作器〔旧〕', group: CommandGroup.WritingAssistant, description: '自动写作器（旧版）', internalOnly: true },
    { id: CommandIds.REVIEW_CHAPTER, name: '连贯性审查', group: CommandGroup.WritingAssistant, description: '审查章节连贯性' },
    { id: CommandIds.TARGETED_REVISION, name: '定向修订（当前章）', group: CommandGroup.WritingAssistant, description: '按质控报告定向修订当前章正文（闸门+自动备份+复检）' },
    { id: CommandIds.QUALITY_DASHBOARD, name: '📊 质量仪表盘', group: CommandGroup.WritingAssistant, description: '六维质量评分 + 问题定位 + 事实确认' },
    { id: CommandIds.CHAPTER_SETTLEMENT, name: '章节结算', group: CommandGroup.WritingAssistant, description: '章节内容结算与分析' },
    { id: CommandIds.EXPAND_TEXT, name: '📝 段落扩写', group: CommandGroup.WritingAssistant, description: '扩写选中的段落', hasEditorCallback: true },
    { id: CommandIds.OUTLINE_EXPAND, name: '✨ 智能大纲扩写', group: CommandGroup.WritingAssistant, description: '智能扩写大纲', hasEditorCallback: true },
    { id: CommandIds.REWRITE_SUGGESTION, name: '✨ AI 改写建议', group: CommandGroup.WritingAssistant, description: '对选中文本生成 2-3 个改写方案', hasEditorCallback: true },
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
    { id: CommandIds.CHARACTER_RECOGNITION, name: '👤 角色识别审核', group: CommandGroup.KnowledgeBase, description: '识别当前章节角色并人工审核建议' },
    { id: CommandIds.POPULATE_SETTING_LIB, name: '从世界观生成设定库', group: CommandGroup.KnowledgeBase, description: '从世界观生成设定库' },
    { id: CommandIds.TAGS_ANALYSIS, name: '作品标签分析', group: CommandGroup.KnowledgeBase, description: '分析作品标签' },
    { id: CommandIds.FINGERPRINT_LIBRARY, name: '🔍 打开写作指纹库', group: CommandGroup.KnowledgeBase, description: '打开写作指纹库视图' },
    { id: CommandIds.STYLE_DISTILLER, name: '文笔风格蒸馏', group: CommandGroup.KnowledgeBase, description: '蒸馏文笔风格' },
    { id: CommandIds.CONTEXT_INJECTOR, name: '上下文注入', group: CommandGroup.KnowledgeBase, description: '上下文注入配置' },
    { id: CommandIds.OPEN_KNOWLEDGE_BASE, name: '📚 打开知识库管理界面', group: CommandGroup.KnowledgeBase, description: '打开知识库管理视图' },

    // ─── 工具类 ───
    { id: CommandIds.DIAGNOSE, name: '流程诊断', group: CommandGroup.Tools, description: '诊断写作流程问题' },
    { id: CommandIds.CONSISTENCY_AUDIT, name: '一致性审核', group: CommandGroup.Tools, description: '跨章检查数量/时间线/命名矛盾（带原文证据）' },
    { id: CommandIds.TOMATO_RANK, name: '番茄榜单分析', group: CommandGroup.Tools, description: '番茄小说榜单分析' },
    { id: CommandIds.REFRESH_INFO_DEBT, name: '刷新信息债看板', group: CommandGroup.Tools, description: '刷新信息债看板' },
    { id: CommandIds.SWITCH_PROVIDER, name: '快速切换 AI 提供商', group: CommandGroup.Tools, description: '快速切换 AI 提供商' },
    { id: CommandIds.IDEATION, name: '💡 脑洞构思工坊', group: CommandGroup.Tools, description: '脑洞构思工作坊' },
    { id: CommandIds.GOLDEN_OPENING, name: '🌟 黄金开篇工坊', group: CommandGroup.Tools, description: '黄金开篇设计工作坊' },
    { id: CommandIds.STEP_RESULT_VIEWER, name: '📋 步骤结果查看', group: CommandGroup.Tools, description: '查看步骤执行结果' },
    { id: CommandIds.STORY_LINKAGE_BOARD, name: '🔗 关联索引看板', group: CommandGroup.Tools, description: '时间线/伏笔 ↔ 设定库/全书规划 的关联视图与回写' },
    { id: CommandIds.VALIDATE_STORY_GRAPH, name: '🧭 校验故事一致性', group: CommandGroup.Tools, description: '只读检查断链、孤立实体、关系缺卡、双链字段类型冲突，输出诊断报告' },
    { id: CommandIds.BATCH_DECONSTRUCT, name: '📚 批量拆解', group: CommandGroup.Tools, description: '打开知识库：批量导入书籍并按维度拆解，结果持久化到拆解库' },
    { id: CommandIds.EXPORT_MANUSCRIPT, name: '📦 成稿导出', group: CommandGroup.Tools, description: '编译全书为 Markdown / TXT / HTML 稿件' },
    { id: CommandIds.PRUNE_SESSIONS, name: '🧹 清理旧会话', group: CommandGroup.Tools, description: '手动清理超出保留上限的旧分析会话与 Agent 会话（最近各 30 个以内不动）' },

    // ─── 视图类 ───
    { id: CommandIds.OPEN_HOME, name: '🏠 创作主页', group: CommandGroup.Views, description: '三个创作模式、最近项目、下一步建议与任务入口' },
    { id: CommandIds.JOB_CENTER, name: '🧵 任务中心', group: CommandGroup.Tools, description: '查看进行中/已完成任务，取消或重试长任务' },
    { id: CommandIds.PROJECT_HEALTH, name: '🩺 项目体检', group: CommandGroup.Tools, description: '检查重复正文、未结算、frontmatter 异常与正文目录孤儿文件' },
    { id: CommandIds.ASSET_REGISTRY, name: '🧩 资产总览', group: CommandGroup.Tools, description: '查看规则/提示词/指纹/知识库的来源、版本与生效状态' },
    { id: CommandIds.USAGE_LEDGER, name: '💰 AI 用量账本', group: CommandGroup.Tools, description: '查看模型调用的 token/耗时/状态统计' },
    { id: CommandIds.BACKUP_CENTER, name: '🗂 版本与备份中心', group: CommandGroup.Tools, description: '按项目查看版本快照、步骤/结算产物与配置备份' },
    { id: CommandIds.FULL_WRITER, name: '📖 项目与章节（流程工作台）', group: CommandGroup.Views, description: '打开流程规划工作台的项目与章节页' },
    { id: CommandIds.CREATION_FLOW, name: '🧭 创作流程（当前项目）', group: CommandGroup.Views, description: '打开当前项目的创作流程：阶段进度与下一步动作' },
    { id: CommandIds.MIGRATE_ENTITY_LINKS, name: '🔗 实体链接迁移（存量关系图谱化）', group: CommandGroup.Tools, description: '把存量实体的归属类字段（所属势力/当前位置/所属归属）转为 wiki-link（先预览再执行）' },
    { id: CommandIds.PROJECT_SIDE_PANEL, name: '🧭 项目速览面板（右侧栏）', group: CommandGroup.Views, description: '在右侧栏打开项目速览：当前笔记属性、标签与快捷动作' },
    { id: CommandIds.GENERATE_BASES, name: '📊 生成/刷新项目看板（Bases）', group: CommandGroup.Tools, description: '在项目内生成章节进度/人物状态/物品归属/地点与势力四个 Bases 看板' },
    { id: CommandIds.MIGRATE_NAMESPACE_TAGS, name: '🏷️ 补齐分层标签（先预览）', group: CommandGroup.Tools, description: '给存量笔记追加 nw/ 层级标签（保留原标签，只加不删）' },
    { id: CommandIds.COMPLETE_PROPERTIES, name: '🧩 补齐笔记属性（先预览）', group: CommandGroup.Tools, description: '按插件属性模板补上缺失的必填属性（只补空值，不覆盖已有内容）' },
    { id: CommandIds.CO_WRITING, name: '✍️ 句级协同写作工作台', group: CommandGroup.Views, description: '打开句级协同写作工作台' },

    // ─── 版本管理类 ───
    { id: CommandIds.VERSION_HISTORY, name: '📜 版本历史与回滚', group: CommandGroup.Version, description: '查看版本历史与回滚' },
    { id: CommandIds.SAVE_VERSION, name: '💾 保存当前版本', group: CommandGroup.Version, description: '保存当前版本' },

    // ─── 设置 / 引导 ───
    { id: CommandIds.OPEN_ONBOARDING, name: '🚀 首启引导（3 分钟）', group: CommandGroup.Tools, description: '选择提供商、测试 Key、导入示例项目' },
    { id: CommandIds.OPEN_SETTINGS, name: '⚙️ 打开插件设置', group: CommandGroup.Tools, description: '打开「小说工坊 AI」插件设置页' },
    { id: CommandIds.WRITING_STATS, name: '📊 写作统计（日/周/月）', group: CommandGroup.Tools, description: '查看写作字数台账与日均/周均产出' },
    { id: CommandIds.TOGGLE_PET, name: '🐾 显示/隐藏桌面宠物', group: CommandGroup.Tools, description: '切换桌面写作宠物显示' },

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
    /** 上下文管理器注入点（本类暂未调用其方法，保持最小类型，待有调用时收窄为实际方法集） */
    ctxManager: unknown;
    foreshadowManager: { refreshInfoDebt(): void };
    /** UI 执行端口：Modal / 视图类命令由 ui 层实现，core 只按 id 委托 */
    ui?: CommandUiPort;
    /** 插件实例引用（实体 Modal 需要 access settings 和回调槽） */
    plugin: import('@/main').default;
    /**
     * 获取当前活动项目名
     *
      * @returns 文本结果 或 null
     */
    getActiveProject(): string | null;
    /** 打开提供商切换弹窗 */
    openProviderSwitcher(): void;
    /** 刷新工作台面板 */
    refreshFullWriterContextPanel(): void;
    /** 执行 populateSettingLib */
    populateSettingLib(): Promise<void>;
    /**
     * 是否为工作台上下文
     *
     * @returns 是否成功
     */
    isWorkbenchContext(): boolean;
}

/**
 * 命令注册表：统一登记命令 ID、执行入口与可用性判断。
 */
export class CommandRegistry {
    private readonly deps: CommandRegistryDeps;
    private readonly ui: CommandUiPort;

    constructor(deps: CommandRegistryDeps) {
        this.deps = deps;
        this.ui = deps.ui ?? NOOP_COMMAND_UI_PORT;
    }

    // ─── 命令查询方法 ───

    /**
     * 获取所有命令定义列表
     *
     * @returns 结果数组
     */
    getAllCommands(): CommandDefinition[] {
        return [...COMMAND_DEFINITIONS];
    }

    /**
     * 根据 ID 查找命令定义
     *
     * @param id - 标识
      * @returns CommandDefinition 或 undefined
     */
    findCommand(id: string): CommandDefinition | undefined {
        return COMMAND_DEFINITIONS.find(cmd => cmd.id === id);
    }

    /**
     * 根据分组获取命令列表
     *
     * @param group - 分组
     * @returns 结果数组
     */
    getCommandsByGroup(group: CommandGroup): CommandDefinition[] {
        return COMMAND_DEFINITIONS.filter(cmd => cmd.group === group);
    }

    /**
     * 获取所有公开命令（排除内部调试命令）
     *
     * @returns 结果数组
     */
    getPublicCommands(): CommandDefinition[] {
        return COMMAND_DEFINITIONS.filter(cmd => !cmd.internalOnly);
    }

    /**
     * 获取所有内部命令
     *
     * @returns 结果数组
     */
    getInternalCommands(): CommandDefinition[] {
        return COMMAND_DEFINITIONS.filter(cmd => cmd.internalOnly);
    }

    /**
     * 检查命令是否存在
     *
     * @param id - 标识
     * @returns 是否成功
     */
    hasCommand(id: string): boolean {
        return COMMAND_DEFINITIONS.some(cmd => cmd.id === id);
    }

    /**
     * 获取命令总数统计
     *
      * @returns number } 结果
     */
    getCommandCount(): { total: number; public: number; internal: number } {
        const total = COMMAND_DEFINITIONS.length;
        const internal = COMMAND_DEFINITIONS.filter(cmd => cmd.internalOnly).length;
        return { total, public: total - internal, internal };
    }

    // ─── 命令注册方法 ───

    /** 注册 InternalRegistry 命令（供外部 API 调用） */
    registerInternalCommands(): void {
        const r = this.deps.registry;

        // ── UI 类命令：core 只登记 id 与回调，实际执行由 ui 层（CommandUiExecutor）接管 ──
        const uiCommandIds: string[] = [
            CommandIds.CREATE_PROJECT,
            CommandIds.AGENT_GUIDE,
            CommandIds.CREATE_SHORT,
            CommandIds.CREATE_SCRIPT,
            CommandIds.SHORT_RESEARCH,
            CommandIds.SCRIPT_RESEARCH,
            CommandIds.SHORT_STORY_CORE,
            CommandIds.SHORT_OUTLINE,
            CommandIds.SCRIPT_SCENE_BIBLE,
            CommandIds.SCRIPT_OUTLINE,
            CommandIds.SCRIPT_STORYBOARD,
            CommandIds.PLAN_BOOK,
            CommandIds.VOLUME_INTRO,
            CommandIds.BATCH_CHAPTERS,
            CommandIds.BATCH_NOVELS,
            CommandIds.CONTINUE_CHAPTERS,
            CommandIds.AUTO_WRITER,
            CommandIds.DIAGNOSE,
            CommandIds.TOMATO_RANK,
            CommandIds.REBUILD_CHAPTERS,
            CommandIds.BACKUP_META,
            CommandIds.PROTECT_META,
            CommandIds.TAGS_ANALYSIS,
            CommandIds.AI_BUILDER,
            CommandIds.ADD_FANFIC,
            CommandIds.WRITE_CHAPTER,
            CommandIds.WRITE_CHAPTER_AUTO,
            CommandIds.REVIEW_CHAPTER,
            CommandIds.TARGETED_REVISION,
            CommandIds.QUALITY_DASHBOARD,
            CommandIds.BATCH_CREATE,
            CommandIds.CROSS_VOLUME_STATE,
            CommandIds.CHAPTER_SETTLEMENT,
            CommandIds.EXPAND_TEXT,
            CommandIds.OUTLINE_EXPAND,
            CommandIds.REWRITE_SUGGESTION,
            CommandIds.WORLDVIEW,
            CommandIds.CHARACTER,
            CommandIds.FACTION,
            CommandIds.LOCATION,
            CommandIds.ITEM,
            CommandIds.ENTITY_MANAGER,
            CommandIds.ENTITY_GENERATE,
            CommandIds.STYLE_DISTILLER,
            CommandIds.CONTEXT_INJECTOR,
            CommandIds.BATCH_DECONSTRUCT,
            CommandIds.CHARACTER_RECOGNITION,
            CommandIds.FINGERPRINT_LIBRARY,
            CommandIds.OPEN_KNOWLEDGE_BASE,
            CommandIds.IDEATION,
            CommandIds.GOLDEN_OPENING,
            CommandIds.STEP_RESULT_VIEWER,
            CommandIds.STORY_LINKAGE_BOARD,
            CommandIds.VALIDATE_STORY_GRAPH,
            CommandIds.EXPORT_MANUSCRIPT,
            CommandIds.FULL_WRITER,
            CommandIds.CO_WRITING,
            CommandIds.OPEN_SETTINGS,
            CommandIds.MIGRATE_ENTITY_LINKS,
            CommandIds.PROJECT_SIDE_PANEL,
            CommandIds.GENERATE_BASES,
            CommandIds.MIGRATE_NAMESPACE_TAGS,
            CommandIds.COMPLETE_PROPERTIES,
            // 命令面板里注册了「🧭 创作流程」，但不在本表 → execute 找不到、
            // CommandUiExecutor 的 CREATION_FLOW 分支永远不可达（点了没反应）。
            CommandIds.CREATION_FLOW,
            CommandIds.WRITING_STATS,
            CommandIds.TOGGLE_PET,
        ];
        for (const id of uiCommandIds) {
            r.register(id, async () => { await this.ui.executeCommand(id); });
        }

        // v4.73.0（用户拍板）：统一入口七命令补进 registry——此前「面板可点但 InternalRegistry
        // 无执行体」（command-ui-executor 已有分支，exec(id) 找不到执行体静默失效）。
        // 一致性测试的 KNOWN_PALETTE_REGISTRY_GAPS 豁免已随本批删除。
        for (const id of [
            CommandIds.OPEN_HOME,
            CommandIds.JOB_CENTER,
            CommandIds.PROJECT_HEALTH,
            CommandIds.ASSET_REGISTRY,
            CommandIds.USAGE_LEDGER,
            CommandIds.BACKUP_CENTER,
            CommandIds.OPEN_ONBOARDING,
            // 一致性审核走 command-ui-executor 分支（S1/S2 合成入口）
            CommandIds.CONSISTENCY_AUDIT,
        ]) {
            r.register(id, async () => { await this.ui.executeCommand(id); });
        }

        // ── 非 UI 命令：留在 core（示例项目导入 / 信息债 / 元素提取 / 版本与缓存） ──
        r.register(CommandIds.IMPORT_EXAMPLE, async () => {
            const { created, project } = await importExampleProject(this.deps.app);
            new Notice(
                created
                    ? `✅ 示例项目「${project}」已导入（1 卷 3 章 + 1 人物 + 1 伏笔）`
                    : `ℹ️ 示例项目「${project}」已存在，直接打开`,
                5000,
            );
            await this.ui.executeCommand(CommandIds.FULL_WRITER);
        });
        r.register(CommandIds.REFRESH_INFO_DEBT, async () => { this.deps.foreshadowManager.refreshInfoDebt(); });
        // 叙事总览此前只在 Obsidian 命令面板注册，快捷工具点击会落到 fallback 并打 warn；
        // 这里补进 registry，保证 tool-catalog 的每个入口都能命中统一路由。
        r.register(CommandIds.NARRATIVE_OVERVIEW, async () => { await this.openNarrativeOverview(); });
        r.register(CommandIds.SWITCH_PROVIDER, async () => this.deps.openProviderSwitcher());
        r.register(CommandIds.EXTRACT_ELEMENTS, async () => { this.extractElementsCommand(); });
        r.register(CommandIds.POPULATE_SETTING_LIB_INTERNAL, () => this.deps.populateSettingLib());
        // v4.72.0（用户拍板）：这三个调色板命令此前「Agent 可见不可执行」（调色板 id 未进
        // InternalRegistry）；口径统一后（list_commands = run_command 可执行集合）把它们
        // 注册进来，让 Agent 能真正执行重命名项目 / 清理会话 / 生成设定库。
        // prune/populate 在 Agent 侧走 dangerous 确认（host-tools 的危险关键词正则）。
        r.register(CommandIds.RENAME_PROJECT, async () => { this.renameProject(); });
        r.register(CommandIds.PRUNE_SESSIONS, async () => { void this.ui.executeCommand(CommandIds.PRUNE_SESSIONS); });
        r.register(CommandIds.POPULATE_SETTING_LIB, async () => { await this.deps.populateSettingLib(); });
        r.register(CommandIds.CLEAR_WORLDVIEW_CACHE, async () => {
            const cacheService = this.deps.plugin.worldviewCacheService;
            if (cacheService) {
                cacheService.clearAll();
                new Notice('✅ 世界观缓存已清空');
                log.info('[WorldviewCache] 缓存已清空');
            }
        });
        r.register(CommandIds.WORLDVIEW_CACHE_STATS, async () => {
            const cacheService = this.deps.plugin.worldviewCacheService;
            if (cacheService) {
                const stats = cacheService.getStats();
                log.info('[WorldviewCache] 缓存统计:', stats);
                new Notice(`📊 缓存统计：命中率 ${(stats.hitRate * 100).toFixed(1)}%，${stats.totalEntries} 个条目，${(stats.totalSize / 1024).toFixed(1)} KB`, 8000);
            }
        });
        r.register(CommandIds.VERSION_HISTORY, async () => { await this.openVersionHistory(); });
        r.register(CommandIds.SAVE_VERSION, async () => { await this.saveCurrentVersion(); });
    }

    /**
     * 注册 Obsidian 命令面板命令
     *
     * @param addCommand - 注册命令函数
     */
    registerObsidianCommands(addCommand: (cmd: {
        id: string;
        name: string;
        callback?: () => void;
        checkCallback?: (checking: boolean) => boolean | void;
        editorCallback?: (editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => void;
    }) => void): void {
        const exec = (id: string) => () => {
            this.deps.registry.execute(id).catch(err => log.error('[小说工坊]', err));
        };
        /**
         * 模式守卫版命令：当前项目模式不匹配时直接从命令面板隐藏。
         * 同步判断（路径前缀 + 缓存）避免 checkCallback 里做异步读盘。
         */
        const execGuarded = (id: string, allowed: CreationMode[]) => (checking: boolean): boolean => {
            const project = this.deps.plugin.getActiveProject();
            const mode = getProjectModeSync(project);
            if (project && !allowed.includes(mode)) return false;
            if (!checking) {
                this.deps.registry.execute(id).catch(err => log.error('[小说工坊]', err));
            }
            return true;
        };

        addCommand({ id: CommandIds.CREATE_PROJECT, name: '新建项目', callback: exec(CommandIds.CREATE_PROJECT) });
        addCommand({ id: CommandIds.AGENT_GUIDE, name: '🤖 对话引导（新建/继续项目）', callback: exec(CommandIds.AGENT_GUIDE) });
        addCommand({ id: CommandIds.CREATE_SHORT, name: '新建短篇项目（前期调研）', callback: exec(CommandIds.CREATE_SHORT) });
        addCommand({ id: CommandIds.CREATE_SCRIPT, name: '新建剧本项目（前期调研）', callback: exec(CommandIds.CREATE_SCRIPT) });
        addCommand({ id: CommandIds.SHORT_RESEARCH, name: '编辑短篇前期调研', checkCallback: execGuarded(CommandIds.SHORT_RESEARCH, SHORT_ONLY) });
        addCommand({ id: CommandIds.SCRIPT_RESEARCH, name: '编辑剧本前期调研', checkCallback: execGuarded(CommandIds.SCRIPT_RESEARCH, SCRIPT_ONLY) });
        addCommand({ id: CommandIds.SHORT_STORY_CORE, name: '编辑短篇故事核', checkCallback: execGuarded(CommandIds.SHORT_STORY_CORE, SHORT_ONLY) });
        addCommand({ id: CommandIds.SHORT_OUTLINE, name: '编辑短篇分节大纲', checkCallback: execGuarded(CommandIds.SHORT_OUTLINE, SHORT_ONLY) });
        addCommand({ id: CommandIds.SCRIPT_SCENE_BIBLE, name: '编辑剧本场景圣经', checkCallback: execGuarded(CommandIds.SCRIPT_SCENE_BIBLE, SCRIPT_ONLY) });
        addCommand({ id: CommandIds.SCRIPT_OUTLINE, name: '编辑剧本分集大纲', checkCallback: execGuarded(CommandIds.SCRIPT_OUTLINE, SCRIPT_ONLY) });
        addCommand({ id: CommandIds.SCRIPT_STORYBOARD, name: '编辑剧本分镜表', checkCallback: execGuarded(CommandIds.SCRIPT_STORYBOARD, SCRIPT_ONLY) });
        addCommand({ id: CommandIds.IMPORT_EXAMPLE, name: '导入示例项目', callback: exec(CommandIds.IMPORT_EXAMPLE) });
        addCommand({ id: CommandIds.PLAN_BOOK, name: 'AI全书规划', checkCallback: execGuarded(CommandIds.PLAN_BOOK, LONG_ONLY) });
        addCommand({ id: CommandIds.VOLUME_INTRO, name: '全书简介', checkCallback: execGuarded(CommandIds.VOLUME_INTRO, LONG_ONLY) });
        addCommand({ id: CommandIds.CONTINUE_CHAPTERS, name: '续写规划', checkCallback: execGuarded(CommandIds.CONTINUE_CHAPTERS, LONG_ONLY) });
        addCommand({ id: CommandIds.DIAGNOSE, name: '流程诊断', callback: exec(CommandIds.DIAGNOSE) });
        addCommand({ id: CommandIds.CONSISTENCY_AUDIT, name: '一致性审核', callback: exec(CommandIds.CONSISTENCY_AUDIT) });
        addCommand({ id: CommandIds.TOMATO_RANK, name: '番茄榜单分析', callback: exec(CommandIds.TOMATO_RANK) });
        addCommand({ id: CommandIds.REBUILD_CHAPTERS, name: '重建章节', checkCallback: execGuarded(CommandIds.REBUILD_CHAPTERS, LONG_ONLY) });
        addCommand({ id: CommandIds.BACKUP_META, name: '备份元文件', callback: exec(CommandIds.BACKUP_META) });
        addCommand({ id: CommandIds.PROTECT_META, name: '保护元文件', callback: exec(CommandIds.PROTECT_META) });
        addCommand({ id: CommandIds.TAGS_ANALYSIS, name: '作品标签分析', checkCallback: execGuarded(CommandIds.TAGS_ANALYSIS, LONG_ONLY) });
        addCommand({ id: CommandIds.AI_BUILDER, name: 'AI世界元素生成', checkCallback: execGuarded(CommandIds.AI_BUILDER, LONG_ONLY) });
        addCommand({ id: CommandIds.ADD_FANFIC, name: '添加同人设定', checkCallback: execGuarded(CommandIds.ADD_FANFIC, LONG_ONLY) });
        addCommand({ id: CommandIds.REVIEW_CHAPTER, name: '连贯性审查', checkCallback: execGuarded(CommandIds.REVIEW_CHAPTER, LONG_ONLY) });
        addCommand({ id: CommandIds.TARGETED_REVISION, name: '定向修订（当前章）', checkCallback: execGuarded(CommandIds.TARGETED_REVISION, LONG_ONLY) });
        addCommand({ id: CommandIds.QUALITY_DASHBOARD, name: '📊 质量仪表盘', checkCallback: execGuarded(CommandIds.QUALITY_DASHBOARD, LONG_ONLY) });
        addCommand({ id: CommandIds.BATCH_CREATE, name: '批量建章', checkCallback: execGuarded(CommandIds.BATCH_CREATE, LONG_ONLY) });
        addCommand({ id: CommandIds.WORLDVIEW, name: '生成世界观', checkCallback: execGuarded(CommandIds.WORLDVIEW, LONG_ONLY) });
        addCommand({ id: CommandIds.CHARACTER, name: '生成人物', checkCallback: execGuarded(CommandIds.CHARACTER, LONG_ONLY) });
        addCommand({ id: CommandIds.FACTION, name: '生成势力', checkCallback: execGuarded(CommandIds.FACTION, LONG_ONLY) });
        addCommand({ id: CommandIds.LOCATION, name: '生成地点', checkCallback: execGuarded(CommandIds.LOCATION, LONG_ONLY) });
        addCommand({ id: CommandIds.ITEM, name: '生成物品功法', checkCallback: execGuarded(CommandIds.ITEM, LONG_ONLY) });
        addCommand({ id: CommandIds.ENTITY_MANAGER, name: '📚 实体管理', checkCallback: execGuarded(CommandIds.ENTITY_MANAGER, LONG_ONLY) });
        addCommand({ id: CommandIds.ENTITY_GENERATE, name: '✨ 统一生成实体', checkCallback: execGuarded(CommandIds.ENTITY_GENERATE, LONG_ONLY) });
        addCommand({ id: CommandIds.REFRESH_INFO_DEBT, name: '刷新信息债看板', callback: exec(CommandIds.REFRESH_INFO_DEBT) });
        addCommand({ id: CommandIds.CROSS_VOLUME_STATE, name: '跨卷状态继承', checkCallback: execGuarded(CommandIds.CROSS_VOLUME_STATE, LONG_ONLY) });
        addCommand({ id: CommandIds.STYLE_DISTILLER, name: '文笔风格蒸馏', checkCallback: execGuarded(CommandIds.STYLE_DISTILLER, LONG_ONLY) });
        addCommand({ id: CommandIds.CONTEXT_INJECTOR, name: '上下文注入', checkCallback: execGuarded(CommandIds.CONTEXT_INJECTOR, LONG_ONLY) });
        addCommand({ id: CommandIds.CHAPTER_SETTLEMENT, name: '章节结算', checkCallback: execGuarded(CommandIds.CHAPTER_SETTLEMENT, LONG_ONLY) });
        addCommand({ id: CommandIds.IDEATION, name: '💡 脑洞构思工坊', callback: exec(CommandIds.IDEATION) });
        addCommand({ id: CommandIds.GOLDEN_OPENING, name: '🌟 黄金开篇工坊', callback: exec(CommandIds.GOLDEN_OPENING) });
        addCommand({ id: CommandIds.STEP_RESULT_VIEWER, name: '📋 步骤结果查看', checkCallback: execGuarded(CommandIds.STEP_RESULT_VIEWER, LONG_ONLY) });
        addCommand({ id: CommandIds.STORY_LINKAGE_BOARD, name: '🔗 关联索引看板', checkCallback: execGuarded(CommandIds.STORY_LINKAGE_BOARD, LONG_ONLY) });
        addCommand({ id: CommandIds.VALIDATE_STORY_GRAPH, name: '🧭 校验故事一致性', checkCallback: execGuarded(CommandIds.VALIDATE_STORY_GRAPH, LONG_ONLY) });
        addCommand({ id: CommandIds.BATCH_DECONSTRUCT, name: '📚 批量拆解', checkCallback: execGuarded(CommandIds.BATCH_DECONSTRUCT, LONG_ONLY) });
        addCommand({ id: CommandIds.CHARACTER_RECOGNITION, name: '👤 角色识别审核', callback: exec(CommandIds.CHARACTER_RECOGNITION) });
        addCommand({ id: CommandIds.EXPORT_MANUSCRIPT, name: '📦 成稿导出', callback: exec(CommandIds.EXPORT_MANUSCRIPT) });
        addCommand({ id: CommandIds.OPEN_HOME, name: '🏠 创作主页', callback: exec(CommandIds.OPEN_HOME) });
        addCommand({ id: CommandIds.JOB_CENTER, name: '🧵 任务中心', callback: exec(CommandIds.JOB_CENTER) });
        addCommand({ id: CommandIds.PROJECT_HEALTH, name: '🩺 项目体检', callback: exec(CommandIds.PROJECT_HEALTH) });
        addCommand({ id: CommandIds.ASSET_REGISTRY, name: '🧩 资产总览', callback: exec(CommandIds.ASSET_REGISTRY) });
        addCommand({ id: CommandIds.USAGE_LEDGER, name: '💰 AI 用量账本', callback: exec(CommandIds.USAGE_LEDGER) });
        addCommand({ id: CommandIds.BACKUP_CENTER, name: '🗂 版本与备份中心', callback: exec(CommandIds.BACKUP_CENTER) });
        addCommand({ id: CommandIds.OPEN_ONBOARDING, name: '🚀 首启引导（3 分钟）', callback: exec(CommandIds.OPEN_ONBOARDING) });
        addCommand({ id: CommandIds.FULL_WRITER, name: '📖 项目与章节（流程工作台）', callback: exec(CommandIds.FULL_WRITER) });
        addCommand({ id: CommandIds.CREATION_FLOW, name: '🧭 创作流程（当前项目）', callback: exec(CommandIds.CREATION_FLOW) });
        addCommand({ id: CommandIds.MIGRATE_ENTITY_LINKS, name: '🔗 实体链接迁移（存量关系图谱化）', callback: exec(CommandIds.MIGRATE_ENTITY_LINKS) });
        addCommand({ id: CommandIds.PROJECT_SIDE_PANEL, name: '🧭 项目速览面板（右侧栏）', callback: exec(CommandIds.PROJECT_SIDE_PANEL) });
        addCommand({ id: CommandIds.GENERATE_BASES, name: '📊 生成/刷新项目看板（Bases）', callback: exec(CommandIds.GENERATE_BASES) });
        addCommand({ id: CommandIds.MIGRATE_NAMESPACE_TAGS, name: '🏷️ 补齐分层标签（先预览）', callback: exec(CommandIds.MIGRATE_NAMESPACE_TAGS) });
        addCommand({ id: CommandIds.COMPLETE_PROPERTIES, name: '🧩 补齐笔记属性（先预览）', callback: exec(CommandIds.COMPLETE_PROPERTIES) });
        addCommand({ id: CommandIds.WRITING_STATS, name: '📊 写作统计（日/周/月）', callback: exec(CommandIds.WRITING_STATS) });
        addCommand({ id: CommandIds.TOGGLE_PET, name: '🐾 显示/隐藏桌面宠物', callback: exec(CommandIds.TOGGLE_PET) });
        addCommand({ id: CommandIds.CO_WRITING, name: '✍️ 句级协同写作工作台', checkCallback: execGuarded(CommandIds.CO_WRITING, LONG_ONLY) });
        addCommand({ id: CommandIds.BATCH_NOVELS, name: '📚 批量生成章节（正式流程）', checkCallback: execGuarded(CommandIds.BATCH_NOVELS, LONG_ONLY) });
        addCommand({ id: CommandIds.FINGERPRINT_LIBRARY, name: '🔍 打开写作指纹库', callback: exec(CommandIds.FINGERPRINT_LIBRARY) });
        addCommand({ id: CommandIds.OPEN_KNOWLEDGE_BASE, name: '📚 打开知识库管理界面', callback: exec(CommandIds.OPEN_KNOWLEDGE_BASE) });
        addCommand({ id: CommandIds.SWITCH_PROVIDER, name: '快速切换 AI 提供商', callback: exec(CommandIds.SWITCH_PROVIDER) });
        addCommand({ id: CommandIds.OPEN_SETTINGS, name: '⚙️ 打开插件设置', callback: exec(CommandIds.OPEN_SETTINGS) });
        // v4.34.0：手动会话清理。不进 InternalRegistry（registerInternalCommands 的
        // 注册集合被 command-registry.test.ts 快照钉死），与 RENAME_PROJECT 同模式：
        // 直接委托 UI 执行器，由 command-ui-executor 的 switch 分支调用 runSessionPrune
        addCommand({
            id: CommandIds.PRUNE_SESSIONS,
            name: '🧹 清理旧会话',
            callback: () => { void this.ui.executeCommand(CommandIds.PRUNE_SESSIONS); },
        });
        addCommand({ id: CommandIds.EXTRACT_ELEMENTS, name: 'AI 元素提取', checkCallback: execGuarded(CommandIds.EXTRACT_ELEMENTS, LONG_ONLY) });
        addCommand({
            id: CommandIds.EXPAND_TEXT,
            name: '📝 段落扩写',
            editorCallback: (editor, _view) => {
                void this.ui.executeCommand(CommandIds.EXPAND_TEXT, { editor });
            },
        });
        addCommand({
            id: CommandIds.OUTLINE_EXPAND,
            name: '✨ 智能大纲扩写',
            editorCallback: (editor, _view) => {
                void this.ui.executeCommand(CommandIds.OUTLINE_EXPAND, { editor });
            },
        });
        addCommand({
            id: CommandIds.REWRITE_SUGGESTION,
            name: '✨ AI 改写建议',
            editorCallback: (editor, _view) => {
                void this.ui.executeCommand(CommandIds.REWRITE_SUGGESTION, { editor });
            },
        });
        addCommand({ id: CommandIds.POPULATE_SETTING_LIB, name: '从世界观生成设定库', checkCallback: execGuarded(CommandIds.POPULATE_SETTING_LIB_INTERNAL, LONG_ONLY) });
        addCommand({ id: CommandIds.RENAME_PROJECT, name: '重命名当前项目', callback: () => this.renameProject() });

        // 叙事总览（直接执行，不走 registry）
        addCommand({ id: CommandIds.NARRATIVE_OVERVIEW, name: '叙事总览', checkCallback: execGuarded(CommandIds.NARRATIVE_OVERVIEW, LONG_ONLY) });

        addCommand({ id: CommandIds.VERSION_HISTORY, name: '📜 版本历史与回滚', callback: exec(CommandIds.VERSION_HISTORY) });
        addCommand({ id: CommandIds.SAVE_VERSION, name: '💾 保存当前版本', callback: exec(CommandIds.SAVE_VERSION) });
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

    private renameProject(): void {
        const project = this.deps.getActiveProject()
            ?? this.deps.app.workspace.getActiveFile()?.path.split('/')[0];
        void this.ui.executeCommand(CommandIds.RENAME_PROJECT, { project: project ?? undefined });
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
        contentType: import('@/shared/version-types').ContentType;
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
        const project = projectIdFromPath(path);
        if (!project) {
            new Notice('未找到所属项目');
            return null;
        }

        const chapterCtx = parseChapterFromPath(path);
        let contentType: import('@/shared/version-types').ContentType = 'chapter';
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
        await this.ui.executeCommand(CommandIds.VERSION_HISTORY, { versionContext: ctx });
    }

    private async saveCurrentVersion(): Promise<void> {
        const ctx = await this.getCurrentFileContext();
        if (!ctx) return;

        const service = this.deps.plugin.engineRegistry.get<ChapterVersionPort>(ENGINE_NAMES.CHAPTER_VERSION_SERVICE);
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

/**
 * 从文件路径反解章节上下文。
 * 单一实现在 shared/paths.parseChapterLocation（B2）：正文与步骤路径都支持，
 * 项目 ID 也不再用「第一段」猜（v4 结构下第一段是「长篇小说」）。
 *
 * 保留此导出是为了 command-registry 的既有调用点与 public API。
 * @param path - 路径
  * @returns string } 结果 或 null
 */
export function parseChapterFromPath(path: string): { project: string; volume: string; chapterNum: number; chapterName: string } | null {
    return parseChapterLocation(path);
}
import { projectIdFromPath } from '@/shared/paths';
