/**
 * story-context-types.ts — 长篇故事上下文总线的类型定义
 *
 * 目标：把世界观、设定库、人物/势力/地点/物品、时间线、伏笔、场景卡、情绪弧
 * 统一成可索引、可关联、可按预算裁剪的节点，而不是各入口各自拼字符串。
 *
 * 分层：
 *   1. StoryContextNode：标准化后的单个信息节点；
 *   2. StoryContextGraph：节点 + 自动关联边；
 *   3. StoryContextRequest：一次检索请求（章节/场景/模式/预算）；
 *   4. StoryContextBundle：检索与预算裁剪后的结果 + 覆盖度遥测。
 */

import type { SceneCardFields } from '../../shared/scene-card';
import type { StoryLinkage } from '../story-linkage';
import type { GatheredContext } from './context-types';

export type StoryContextKind =
    | 'worldview'
    | 'setting'
    | 'character'
    | 'faction'
    | 'location'
    | 'item'
    | 'timeline'
    | 'foreshadow'
    | 'scene'
    | 'emotion';

export type StoryContextTier = 'local' | 'cloud';

export type StoryContextMode = 'one-click' | 'co-write';

export type StoryContextLinkReason =
    | 'scene-explicit'
    | 'scene-mention'
    | 'timeline-mention'
    | 'foreshadow-related'
    | 'setting-mention'
    | 'emotion-scene'
    | 'story-linkage'
    | 'alias';

export interface StoryContextLink {
    targetId: string;
    reason: StoryContextLinkReason;
    weight: number;
}

export interface StoryContextNode {
    id: string;
    kind: StoryContextKind;
    title: string;
    /** 完整文本（云端优先） */
    text: string;
    /** 压缩文本（本地优先） */
    compactText: string;
    /** 基础优先级 0–100，越大越重要 */
    priority: number;
    /** 必含项：预算不足时仍保留（可截断，但不静默丢弃） */
    required: boolean;
    /** 估算 token（完整/压缩） */
    tokens: number;
    compactTokens: number;
    /** 自动关联边 */
    links: StoryContextLink[];
    /** 来源文件/步骤，便于追溯 */
    sourcePath?: string;
    /** 结构化元数据（章号、场景号、重要度等） */
    metadata: Record<string, unknown>;
}

export interface StoryContextGraph {
    project: string;
    chapterName: string;
    chapterNum: number;
    volume: string;
    nodes: Map<string, StoryContextNode>;
    byKind: Record<StoryContextKind, StoryContextNode[]>;
    /** 名称/别名 → 节点 ID，供自动关联使用 */
    nameIndex: Map<string, string[]>;
    /** 构建时的数据源摘要，用于 telemetry 与缓存 */
    sourceHash: string;
    warnings: string[];
}

export interface StoryContextRequest {
    mode: StoryContextMode;
    tier: StoryContextTier;
    chapterNum: number;
    /** 当前场景（协同写作传当前场景；一键生成可传全部场景，留空表示整章） */
    scene?: SceneCardFields;
    /** 当前已写正文/查询文本，用于关键词相关性 */
    precedingText?: string;
    /** 额外查询文本（如用户临时指令） */
    queryText?: string;
    /** 输入预算（token）；未传时使用 tier 的默认上限 */
    maxInputTokens?: number;
    /** 模型 ID，用于 token 估算 */
    modelId?: string;
    /** 额外必含节点 ID */
    pinnedIds?: string[];
}

export interface StoryContextKindTelemetry {
    total: number;
    included: number;
    dropped: number;
    truncated: number;
}

export interface StoryContextTelemetry {
    tier: StoryContextTier;
    mode: StoryContextMode;
    budgetTokens: number;
    estimatedTokens: number;
    included: number;
    dropped: number;
    truncated: number;
    requiredTotal: number;
    requiredIncluded: number;
    missingRequired: string[];
    byKind: Record<StoryContextKind, StoryContextKindTelemetry>;
    droppedItems: Array<{ id: string; kind: StoryContextKind; title: string; reason: string }>;
    warnings: string[];
}

export interface StoryContextBundle {
    tier: StoryContextTier;
    mode: StoryContextMode;
    items: StoryContextNode[];
    byKind: Record<StoryContextKind, StoryContextNode[]>;
    telemetry: StoryContextTelemetry;
    /** 完整信息包（协同写作/需要全量时） */
    formattedFull: string;
    /** 关联摘要（一键生成：避免与模板已有变量重复） */
    formattedCrossLink: string;
}

export interface StoryContextSource {
    project: string;
    chapterName: string;
    chapterNum: number;
    volume?: string;
    context: GatheredContext;
    sceneExpansionText?: string;
    emotionPlanText?: string;
    storyLinkage?: StoryLinkage | null;
    /** 当前正文/前文，用于相关性打分 */
    precedingText?: string;
}

export interface StoryContextProfile {
    tier: StoryContextTier;
    /** 信息包自身的 token 上限 */
    maxPackTokens: number;
    /** 各类型最多保留多少个节点 */
    maxPerKind: Partial<Record<StoryContextKind, number>>;
    /** 是否优先使用压缩文本 */
    preferCompact: boolean;
    /** 必含项最多可占预算比例 */
    requiredShare: number;
}
