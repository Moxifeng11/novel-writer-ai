/**
 * command-handlers-lib.mjs 的类型声明（供 TS 测试 import）。
 */

/** 注册 id 解析结果 */
export interface RegisteredIds {
    direct: Set<string>;
    uiListed: Set<string>;
}

/** 抽取 exec()/execGuarded() 使用的命令 id */
export function collectExecUsedIds(source: string): string[];

/** 抽取注册的命令 id（直连 + UI 批量列表） */
export function collectRegisteredIds(source: string): RegisteredIds;

/** 抽取 UI 执行器 case 分支 id */
export function collectExecutorCases(source: string): Set<string>;

/** 找出会静默失效的命令（含原因前缀） */
export function findMissingHandlers(input: {
    execUsed: string[];
    registered: RegisteredIds;
    executorCases: Set<string>;
}): string[];

/** 汇总判定 */
export function evaluateCommandHandlers(input: {
    execUsed: string[];
    registered: RegisteredIds;
    executorCases: Set<string>;
}): { ok: boolean; reason: string; missing: string[] };
