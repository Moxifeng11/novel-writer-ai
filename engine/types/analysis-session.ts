/**
 * analysis-session.ts — 分析会话类型定义
 *
 * 定义分析会话的数据结构、操作日志、列表条目和对比差异等类型。
 * 用于支持分析历史记录、版本对比和会话恢复等功能。
 */

import type { AnalysisSuggestion } from './analysis-suggestion';

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

    characterResult: any;
    plotResult?: any;
    otherResults?: Record<string, any>;

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
    details?: Record<string, any>;
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
