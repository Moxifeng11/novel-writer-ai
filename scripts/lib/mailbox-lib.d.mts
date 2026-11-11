/**
 * mailbox-lib.mjs 的类型声明。
 *
 * 实现是 .mjs（要被 node 直接执行），但测试用 TS 写，所以单独声明类型。
 */

export interface MailboxMessage {
    id?: string;
    ts?: string;
    from?: string;
    to?: string;
    subject?: string;
    body?: string;
}

export interface PendingTask {
    taskId: string;
    id: string;
    ts?: string;
    from?: string;
    subject?: string;
    body?: string;
}

/**
 * 解析信箱根目录。
 *
 * @param startDir - 起始目录
 * @param envRoot - MAILBOX_ROOT 环境变量值（优先）
 * @param maxDepth - 最大上溯层数
 * @returns 信箱根目录
 */
export function resolveMailboxRoot(startDir: string, envRoot?: string, maxDepth?: number): string;

/**
 * 从消息里解析任务 ID。
 *
 * @param message - 消息
 * @returns 任务 ID 或 null
 */
export function parseTaskId(message: MailboxMessage | null | undefined): string | null;

/**
 * 从回执消息里解析任务 ID。
 *
 * @param message - 消息
 * @returns 任务 ID 或 null
 */
export function parseReceiptTaskId(message: MailboxMessage | null | undefined): string | null;

/**
 * 配对任务与回执。
 *
 * @param messages - 全部消息
 * @param me - 我的身份
 * @returns 待办任务
 */
export function pairTasks(messages: MailboxMessage[] | null | undefined, me: string): PendingTask[];
