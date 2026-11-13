/**
 * engine/context/context-types.ts
 * ContextManager 全部类型导出 — 单一来源（P1-3 拆分阶段一）。
 *
 * 从 context-manager.ts 末尾迁移而来，由 30+ 个 UI 文件直接 import。
 * 原 context-manager.ts 通过 `export type` 重新导出，保持向后兼容。
 *
 * 拆分原则：纯类型零运行时，无副作用，可被任意模块安全 import。
 */
import type NovelWriterPlugin from '@/main';
import type { PluginCapabilities } from '@/shared/plugin-capabilities';
import type { FileSystemPort } from '@/shared/file-system-port';
import type { Notifier, CharacterFrontmatter, LocationFrontmatter, FactionFrontmatter, ItemFrontmatter } from '@/shared/types';
import type { TimelineRow, FanficRules } from '@/shared/template-validator';
import type { CompressedContext } from '@/engine/context-compressor';
import type { CharacterSoul } from '@/engine/character-soul';
import type { MemoryShard, TriggeredMemory } from '@/engine/memory-trigger';
import type { StoryLinkage } from '@/engine/story-linkage';
import type { ChapterDigest } from '@/engine/memory/chapter-digest';
import type { StoryContextNode } from '@/engine/context/story-context-types';
import type {
    CharacterRepository,
    ChapterRepository,
    ProjectRepository,
    FactionRepository,
    LocationRepository,
    ItemRepository,
} from '@/engine/repository';
import type { EngineRegistry } from '@/engine/engine-registry';
import type { MultiLayerCache } from '@/engine/cache';

// ============================================================
// 构造选项
// ============================================================

/**
 * ContextManager 构造选项 — 支持多种模式：
 *   ①传统模式：传入 plugin，直接使用 plugin.app
 *   ②解耦模式：传入 capabilities 和可选 fs，使用抽象接口
 *   ③Repository 模式：传入各 Repository 实例，通过仓储层访问数据
 *   ④EngineRegistry 模式：传入 engineRegistry，按需获取项目级 Repository
 */
export interface ContextManagerOptions {
    /** 插件实例（传统模式） */
    plugin?: NovelWriterPlugin;
    /** 插件能力接口（解耦模式，优先使用） */
    capabilities?: PluginCapabilities;
    /** 文件系统抽象接口（解耦模式） */
    fs?: FileSystemPort;
    /** 通知器 */
    notifier?: Notifier;
    /** 人物仓储（可选，优先使用） */
    characterRepository?: CharacterRepository;
    /** 章节仓储（可选，优先使用） */
    chapterRepository?: ChapterRepository;
    /** 项目仓储（可选，优先使用） */
    projectRepository?: ProjectRepository;
    /** 势力仓储（可选，优先使用） */
    factionRepository?: FactionRepository;
    /** 地点仓储（可选，优先使用） */
    locationRepository?: LocationRepository;
    /** 物品仓储（可选，优先使用） */
    itemRepository?: ItemRepository;
    /** 引擎注册表（可选，用于按需获取项目级 Repository） */
    engineRegistry?: EngineRegistry;
    /** 多层缓存（可选，用于增强缓存能力） */
    multiLayerCache?: MultiLayerCache;
}

// ============================================================
// PromptContext 系列（buildPromptSection 用）
// ============================================================

/**
 * 提示词上下文选项。
 */
export interface PromptContextOptions {
    includeWorldView?: boolean;
    includeWritingStyle?: boolean;
    includeCharacters?: boolean;
    includeEntities?: boolean;
    includeSetLib?: boolean;
    includeTimeline?: boolean;
    maxCharsPerSection?: number;
}

/**
 * 提示词上下文段。
 */
export interface PromptContextSection {
    worldView: string;
    writingStyle: string;
    settingLib: string;
    timeline: string;
    characters: string;
    locations: string;
    factions: string;
    items: string;
    // 原始数据，供 Modal 端实体评分复用
    rawCharacters: CharacterData[];
    rawLocations: LocationFrontmatter[];
    rawFactions: FactionFrontmatter[];
    rawItems: ItemFrontmatter[];
    rawTimeline: TimelineEvent[];
    // 同人流程
    fanficCanonTimeline?: string;
    fanficFanTimeline?: string;
    fanficRules?: string;
}

// ============================================================
// GatheredContext 系列（gatherAll 用）
// ============================================================

/**
 * 聚合上下文。
 */
export interface GatheredContext {
    project: string;
    gatheredAt: string;
    data: ContextData;
    issues: ContextIssue[];
}

/**
 * 上下文数据。
 */
export interface ContextData {
    character_state?: CharacterData[];
    locations?: LocationFrontmatter[];
    factions?: FactionFrontmatter[];
    items?: ItemFrontmatter[];
    setting_lib?: MarkdownContent | null;
    writing_style?: MarkdownContent | null;
    foreshadows?: ForeshadowData;
    timeline?: TimelineEvent[];
    timeline_eras?: string[];
    timeline_inconsistencies?: string[];
    previous_chapter?: PreviousChapterData | null;
    writing_rules?: WritingRules | null;
    outline?: MarkdownContent | null;
    world_view?: MarkdownContent | null;
    emotion_plan?: MarkdownContent | null;
    scene_expansion?: MarkdownContent | null;
    compressed?: CompressedContext;
    /** 剧情记忆：最近 N 章摘要（升序） */
    chapter_digests?: ChapterDigest[];
    fanfic_canon_timeline?: TimelineRow[];
    fanfic_fan_timeline?: TimelineRow[];
    fanfic_rules?: FanficRules;
    /** V2: 角色灵魂层数据 */
    character_cores?: CharacterSoul[];
    /** V2 Phase 3: 触发记忆碎片（由 memory-trigger 引擎注入） */
    triggered_memories?: MemoryShard[];
    /** V2 Phase 3: 本次命中的触发记忆（含匹配分数与原因，供 UI 预览） */
    triggered_memories_matched?: TriggeredMemory[];
    /** 触发记忆的 prompt 格式化文本 */
    triggered_memories_prompt?: string;
    /** Rev 186：本章关联索引（伏笔/时间线 ↔ 设定库/世界观 ↔ 全书规划） */
    story_linkage?: StoryLinkage | null;
    /**
     * 事实库节点（DSH-20261114-01）：拆解事实 → 图节点，与实体/伏笔/时间线同住一张图。
     *
     * 断链修复背景（docs/audits/ai-coverage-and-linkage-audit.md §四-1）：事实此前只被
     * 一致性审核消费，写作 prompt 从未拿到「主体·谓词=值」硬事实。现在 gather 阶段
     * 预转换成图节点，buildStoryContext 自动透传（一键与协同共用）。
     */
    fact_nodes?: StoryContextNode[];
    /** v1.6.0: 加载失败的上下文模块名（面板提示用） */
    _failedModules?: string[];
}

// CharacterData — 字段定义见 shared/types.ts（CharacterFrontmatter），此处保留别名以确保向后兼容
/**
 * 角色数据别名。
 */
export type CharacterData = CharacterFrontmatter;

/**
 * Markdown 内容。
 */
export interface MarkdownContent {
    raw: string;
    sections: MarkdownSection[];
}

/**
 * Markdown 分节。
 */
export interface MarkdownSection {
    title: string;
    level: number;
    content: string[];
}

/**
 * 伏笔数据。
 */
export interface ForeshadowData {
    unrevealed: ForeshadowItem[];
    revealed: ForeshadowItem[];
    abandoned: ForeshadowItem[];
}

/**
 * 伏笔条目。
 */
export interface ForeshadowItem {
    id: string;
    name: string;
    importance?: string;
    buryChapter?: string;
    plannedReveal?: string;
    relatedChars?: string;
    relatedMainline?: string;
    revealChapter?: string;
    method?: string;
    status?: string;
    reason?: string;
    abandonChapter?: string;
}

/**
 * 时间线事件。
 */
export interface TimelineEvent {
    time: string;
    chapter: string;
    event: string;
    impact: string;
    eventName?: string;
    location?: string;
    involvedEntities?: string[];
    type?: string;
    idx?: string;
    /** 纪元名（台账解析保留；旧数据可能没有） */
    era?: string;
}

/**
 * 上一章数据。
 */
export interface PreviousChapterData {
    chapterNumber: number;
    content: string | null;
    outline: string | null;
    ending: string | null;
    analysisReport: string | null;
    continuityReview: string | null;
    infoPlan: string | null;
    bodySummary: string | null;
    /** 上一章结束状态快照（04-项目总控/章节状态快照/） */
    stateSnapshot?: string | null;
}

/**
 * 写作规则。
 */
export interface WritingRules {
    mandatory: RuleItem[];
    checklist: string[];
    style: string;
}

/**
 * 规则条目。
 */
export interface RuleItem {
    title: string;
    description: string;
    points: string[];
}

/**
 * 上下文问题。
 */
export interface ContextIssue {
    type: 'warning' | 'error';
    message: string;
    suggestion: string;
}

export type {
    SmartEntityContextOptions,
    SmartEntityContextResult,
    ScoredEntity,
    TrimmedEntityInfo,
    RelationContext,
    EntityAppearanceRecord,
    CharacterImportance,
    EntitySelectionReason,
} from '@/engine/entity-context-engine';
