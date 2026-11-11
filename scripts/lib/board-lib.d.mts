/**
 * board-lib.mjs 的类型声明（供 TS 测试 import）。
 */

/** 默认租约时长（毫秒） */
export const DEFAULT_LEASE_MS: number;

/** 任务记录 */
export interface BoardTask {
    id: string;
    title?: string;
    scope?: string;
    accept?: string;
    /** 定向指派：只有该 agent 能领；空/缺省表示任何人可领 */
    assignee?: string;
    note?: string;
    by?: string;
    status?: string;
    createdAt?: number;
    doneAt?: number;
    failedAt?: number;
}

/** 领取记录 */
export interface BoardClaim {
    taskId: string;
    agent: string;
    leaseUntil: number;
    claimedAt?: number;
}

/** 锁记录 */
export interface BoardLock {
    scope: string;
    agent: string;
    taskId?: string;
    leaseUntil: number;
    at?: number;
}

/** 规范化写范围 */
export function normalizeScope(scope: string | null | undefined): string;

/** 解析写范围列表 */
export function parseScopeList(text: string | string[] | null | undefined): string[];

/** 两个范围是否重叠 */
export function scopesOverlap(a: string, b: string): boolean;

/** 两组范围是否重叠 */
export function scopeListsOverlap(listA: string[], listB: string[]): boolean;

/** 租约是否过期 */
export function isLeaseExpired(claim: { leaseUntil?: number } | null | undefined, now: number): boolean;

/** 折叠 append-only 任务记录 */
export function foldTasks(records: BoardTask[] | null | undefined): Map<string, BoardTask>;

/** 筛选可领取任务 */
export function pickClaimableTasks(
    tasks: BoardTask[] | null | undefined,
    claims: BoardClaim[] | null | undefined,
    locks: BoardLock[] | null | undefined,
    me: string,
    now: number,
): BoardTask[];

/** 生成状态摘要 */
export function formatBoardStatus(
    tasks: BoardTask[] | null | undefined,
    claims: BoardClaim[] | null | undefined,
    locks: BoardLock[] | null | undefined,
    now: number,
): string;
