/**
 * analysis-session.ts — 分析会话类型定义
 *
 * 定义分析会话的数据结构、操作日志、列表条目和对比差异等类型。
 * 用于支持分析历史记录、版本对比和会话恢复等功能。
 */

import type { AnalysisSuggestion } from './analysis-suggestion';

/**
 * 角色识别结果快照
 *
 * 会话只做「原样存取 + 按 name 对比」，因此这里只约束三个候选数组的 `name`；
 * 其余字段（confidence/evidence 等）随历史 JSON 一起保留，不做逐字段建模。
 * 生产端真实类型是 `Character[]` / `CharacterCandidate[]`（见
 * character-recognition-pipeline），结构上可赋值给本快照。
 */
export interface CharacterResultSnapshot {
    finalCharacters?: Array<{ name?: string }>;
    llmVerified?: Array<{ name?: string }>;
    ruleCandidates?: Array<{ name?: string }>;
}

/**
 * 分析会话
 *
 * 保存一次完整分析的所有相关数据，包括分析结果快照、
 * 建议列表、操作日志和元数据。
 */
export interface AnalysisSession {
    id: string;
    createdAt: number;
    updatedAt: number;
    file: string;
    title: string;

    characterResult?: CharacterResultSnapshot | null;
    /** 剧情分析结果：当前无生产者/消费者，仅随会话 JSON 原样存取 */
    plotResult?: unknown;
    /** 其他分析结果（已知键 `analysisReport: string`，其余按不透明负载处理） */
    otherResults?: Record<string, unknown>;

    suggestions: AnalysisSuggestion[];

    actionLog: SessionAction[];

    metadata: SessionMetadata;
}

/**
 * 会话元数据
 */
export interface SessionMetadata {
    wordCount: number;
    characterCount: number;
    layersUsed: string[];
    durationMs: number;
}

/**
 * 会话操作记录
 */
export interface SessionAction {
    id: string;
    timestamp: number;
    type: SessionActionType;
    suggestionId?: string;
    /** 动作附加信息（analyze 固定写 wordCount/characterCount，其余调用方自定义） */
    details?: Record<string, unknown>;
}

/**
 * 会话操作类型
 */
export type SessionActionType =
    | 'adopt'
    | 'reject'
    | 'modify'
    | 'batch_adopt'
    | 'batch_reject'
    | 'analyze'
    | 'import';

/**
 * 会话列表条目（用于快速展示，不含大字段）
 */
export interface SessionListEntry {
    id: string;
    title: string;
    file: string;
    createdAt: number;
    updatedAt: number;
    characterCount: number;
    suggestionStats: SuggestionStats;
}

/**
 * 建议状态统计
 */
export interface SuggestionStats {
    total: number;
    pending: number;
    adopted: number;
    rejected: number;
    modified: number;
}

/**
 * 会话对比结果
 */
export interface SessionDiff {
    addedCharacters: string[];
    removedCharacters: string[];
    changedSuggestions: string[];
    statsDiff: Record<string, number>;
}

/**
 * 会话索引（持久化到磁盘的索引文件结构）
 */
export interface SessionIndex {
    version: number;
    entries: SessionListEntry[];
    updatedAt: number;
}
