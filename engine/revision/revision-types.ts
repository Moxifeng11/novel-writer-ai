/**
 * revision-types.ts — 定向修订的数据契约
 */
export type RevisionDimension =
    | 'dialogue'
    | 'rhythm'
    | 'description'
    | 'hook'
    | 'continuity'
    | 'style';

/**
 * RevisionSeverity 类型定义。
 */
export type RevisionSeverity = 'high' | 'medium' | 'low';

/**
 * 修订问题结构定义。
 */
export interface RevisionIssue {
    dimension: RevisionDimension;
    severity: RevisionSeverity;
    evidence: string;
    suggestion?: string;
    /** 例如：场景2 / 第5段 / L120 */
    location?: string;
    source?: 'quality-report' | 'quality-score' | 'manual';
}

/**
 * 修订计划结构定义。
 */
export interface RevisionPlan {
    passes: RevisionDimension[];
    reason: string;
}

/**
 * RevisionPassResult 类型定义。
 */
export interface RevisionPassResult {
    dimension: RevisionDimension;
    changed: boolean;
    notes?: string;
    error?: string;
}

/**
 * TargetedRevisionResult 类型定义。
 */
export interface TargetedRevisionResult {
    body: string;
    passes: RevisionPassResult[];
    changed: boolean;
}

/**
 * 修订维度标签列表常量。
 */
export const REVISION_DIMENSION_LABELS: Record<RevisionDimension, string> = {
    dialogue: '对话',
    rhythm: '节奏',
    description: '描写',
    hook: '钩子',
    continuity: '连续性',
    style: '文风/AI 味',
};
