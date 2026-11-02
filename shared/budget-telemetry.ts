/**
 * budget-telemetry.ts — 最近 prompt 预算快照（进程内环形缓冲）
 *
 * 只记录最近 20 条，供「流程诊断」展示；不做持久化，避免写放大。
 * 记录点：
 * - ai-api-client：请求前的输入/窗口预算（source=api）
 * - ai-prompt-builder：章节正文 prompt 装配（source=chapter）
 * - knowledge-injector：场景正文按需注入（source=scene）
 * - prompt-builder：协同续写/联想/改写/迭代（source=cowrite）
 */

export type BudgetSource = 'api' | 'chapter' | 'scene' | 'cowrite';

/**
 * 预算快照结构定义。
 */
export interface BudgetSnapshot {
    at: number;
    source: BudgetSource;
    model?: string;
    inputTokens?: number;
    availableTokens?: number;
    contextWindow?: number;
    maxInputTokens?: number;
    maxOutput?: number;
    droppedSections: string[];
    trimmedSections: string[];
    overBudget: boolean;
}

const MAX_SNAPSHOTS = 20;
let snapshots: BudgetSnapshot[] = [];

/**
 * 预算快照输入结构定义。
 */
export type BudgetSnapshotInput = Omit<
    BudgetSnapshot,
    'at' | 'droppedSections' | 'trimmedSections'
> & {
    at?: number;
    droppedSections?: string[];
    trimmedSections?: string[];
};

/**
 * recordBudgetSnapshot 函数。
 * @param input - 输入
 */
export function recordBudgetSnapshot(input: BudgetSnapshotInput): void {
    snapshots.push({
        ...input,
        at: input.at ?? Date.now(),
        droppedSections: [...(input.droppedSections ?? [])],
        trimmedSections: [...(input.trimmedSections ?? [])],
    });
    if (snapshots.length > MAX_SNAPSHOTS) {
        snapshots = snapshots.slice(-MAX_SNAPSHOTS);
    }
}

/**
 * 返回副本，调用方修改不会污染内部缓冲。
 *
 * @returns 结果数组
 */
export function getBudgetSnapshots(): BudgetSnapshot[] {
    return snapshots.map((snapshot) => ({
        ...snapshot,
        droppedSections: [...snapshot.droppedSections],
        trimmedSections: [...snapshot.trimmedSections],
    }));
}

/**
 * 清空预算快照列表。
 */
export function clearBudgetSnapshots(): void {
    snapshots = [];
}
