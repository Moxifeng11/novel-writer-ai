/**
 * verify-flows-lib.d.mts — verify-flows-lib.mjs 的类型声明（TS 测试静态 import 用）
 *
 * 链路状态结构与 shared/link-status-compute.ts 对齐（镜像库的输出直接参与 parity 对比）。
 */

export type LinkStageStatus = 'ok' | 'broken' | 'warn' | 'unknown';

export interface LinkStage {
    name: string;
    status: LinkStageStatus;
    detail: string;
}

export interface LinkStatus {
    title: string;
    stages: LinkStage[];
    overall: LinkStageStatus;
    breakpoint: string | null;
    degradations?: string[];
}

export interface KnowledgeFlowInput {
    bookTotal: number;
    breakdownCompleted: number;
    vectorDone: number;
    vectorFailed: number;
    embeddingReady: boolean;
    embeddingDetail?: string;
    storeLoadedBooks: number;
    storeReady?: boolean;
    orphanCount?: number;
    degradations?: string[];
}

export interface StyleFlowInput {
    templateCount: number;
    globalCount: number;
    projectCount: number;
    enabledCount: number;
    intensityDisabledCount: number;
    embeddingReady: boolean;
    degradations?: string[];
}

export interface ConstraintFlowInput {
    sourceCount: number;
    settingExists: boolean;
    reviewStatus: 'approved' | 'pending' | 'rejected' | 'legacy' | 'none';
    bound: boolean;
    rulesHasContent: boolean;
    degradations?: string[];
}

export function summarizeLink(title: string, stages: LinkStage[], degradations?: string[]): LinkStatus;
export function computeKnowledgeFlowStatus(input: KnowledgeFlowInput): LinkStatus;
export function computeStyleFlowStatus(input: StyleFlowInput): LinkStatus;
export function computeConstraintFlowStatus(input: ConstraintFlowInput): LinkStatus;
export function mirrorSanitizeName(name: unknown): string;
