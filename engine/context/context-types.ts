/**
 * engine/context/context-types.ts
 * ContextManager 全部类型导出 — 单一来源（P1-3 拆分阶段一）。
 *
 * 从 context-manager.ts 末尾迁移而来，由 30+ 个 UI 文件直接 import。
 * 原 context-manager.ts 通过 `export type` 重新导出，保持向后兼容。
 *
 * 拆分原则：纯类型零运行时，无副作用，可被任意模块安全 import。
 */
import type NovelWriterPlugin from '../../main';
import type { PluginCapabilities } from '../../shared/plugin-capabilities';
import type { FileSystemPort } from '../../shared/file-system-port';
import type { Notifier, CharacterFrontmatter, LocationFrontmatter, FactionFrontmatter, ItemFrontmatter } from '../../shared/types';
import type { TimelineRow, FanficRules } from '../../shared/template-validator';
import type { CompressedContext } from '../context-compressor';
import type { CharacterSoul } from '../character-soul';
import type { MemoryShard } from '../memory-trigger';

// ============================================================
// 构造选项
// ============================================================

/**
 * ContextManager 构造选项 — 支持双模式：
 *   ①传统模式：传入 plugin，直接使用 plugin.app
 *   ②解耦模式：传入 capabilities 和可选 fs，使用抽象接口
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
}

// ============================================================
// PromptContext 系列（buildPromptSection 用）
// ============================================================

export interface PromptContextOptions {
    includeWorldView?: boolean;
    includeWritingStyle?: boolean;
    includeCharacters?: boolean;
    includeEntities?: boolean;
    includeSetLib?: boolean;
    includeTimeline?: boolean;
    maxCharsPerSection?: number;
}

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

export interface GatheredContext {
    project: string;
    gatheredAt: string;
    data: ContextData;
    issues: ContextIssue[];
}

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
    fanfic_canon_timeline?: TimelineRow[];
    fanfic_fan_timeline?: TimelineRow[];
    fanfic_rules?: FanficRules;
    /** V2: 角色灵魂层数据 */
    character_cores?: CharacterSoul[];
    /** V2 Phase 3: 触发记忆碎片（由 memory-trigger 引擎注入） */
    triggered_memories?: MemoryShard[];
    /** 触发记忆的 prompt 格式化文本 */
    triggered_memories_prompt?: string;
    /** v1.6.0: 加载失败的上下文模块名（面板提示用） */
    _failedModules?: string[];
}

// CharacterData — 字段定义见 shared/types.ts（CharacterFrontmatter），此处保留别名以确保向后兼容
export type CharacterData = CharacterFrontmatter;

export interface MarkdownContent {
    raw: string;
    sections: MarkdownSection[];
}

export interface MarkdownSection {
    title: string;
    level: number;
    content: string[];
}

export interface ForeshadowData {
    unrevealed: ForeshadowItem[];
    revealed: ForeshadowItem[];
    abandoned: ForeshadowItem[];
}

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
}

export interface PreviousChapterData {
    chapterNumber: number;
    content: string | null;
    outline: string | null;
    ending: string | null;
    analysisReport: string | null;
    continuityReview: string | null;
    infoPlan: string | null;
    bodySummary: string | null;
}

export interface WritingRules {
    mandatory: RuleItem[];
    checklist: string[];
    style: string;
}

export interface RuleItem {
    title: string;
    description: string;
    points: string[];
}

export interface ContextIssue {
    type: 'warning' | 'error';
    message: string;
    suggestion: string;
}
