/**
 * mailbox-lib.mjs — 信箱任务配对与根目录解析（可测试的纯逻辑）
 *
 * 从 `mailbox-watch.mjs` 抽出，因为这两块逻辑都出过真实 bug：
 *
 * 1. **根目录解析**：曾写死 `path.resolve(__dirname,'..','..','..')`，
 *    从 `<vault>/.obsidian/plugins/novel-writer-ai/scripts` 上溯三层只到 `.obsidian`，
 *    指向不存在的 `<vault>/.obsidian/.trae/mailbox`——
 *    脚本永远报「没有未读」，实际一封也没读到。典型静默失效。
 * 2. **任务配对**：派发方可能把 TASK-ID 写在正文而不是 subject 前缀，
 *    只认 subject 会让任务静默消失在待办列表里。
 *
 * 放在 lib 里是为了能被 vitest 直接 import 测试（scripts/*.mjs 本身不便单测）。
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * 解析信箱根目录：向上搜索含 `.trae/mailbox/messages.jsonl` 的目录。
 *
 * @param startDir - 起始目录（通常是脚本所在目录）
 * @param envRoot - MAILBOX_ROOT 环境变量值（优先）
 * @param maxDepth - 最大上溯层数
 * @returns 信箱根目录路径
 */
export function resolveMailboxRoot(startDir, envRoot, maxDepth = 8) {
    if (envRoot) return envRoot;
    let current = startDir;
    for (let depth = 0; depth < maxDepth; depth++) {
        const candidate = path.join(current, '.trae', 'mailbox');
        if (fs.existsSync(path.join(candidate, 'messages.jsonl'))) return candidate;
        const parent = path.dirname(current);
        if (parent === current) break;
        current = parent;
    }
    // 兜底：vault 根约定是「脚本目录上溯四层」（scripts → plugin → plugins → .obsidian → vault）
    return path.join(path.resolve(startDir, '..', '..', '..', '..'), '.trae', 'mailbox');
}

/**
 * 从一条消息里解析任务 ID。
 *
 * 优先 subject 的 `[TASK-xxx]` 前缀；退化到正文 `TASK-ID: xxx` 行。
 *
 * @param message - 消息对象
 * @returns 任务 ID 或 null
 */
export function parseTaskId(message) {
    const subjectMatch = /^\[TASK-\s*([^\]]+)\]/i.exec(String(message?.subject || ''));
    if (subjectMatch) return subjectMatch[1].trim();
    const bodyMatch = /^\s*TASK-ID:\s*(\S+)\s*$/im.exec(String(message?.body || ''));
    if (bodyMatch) return bodyMatch[1].trim();
    return null;
}

/**
 * 从一条消息里解析回执对应的任务 ID。
 *
 * @param message - 消息对象
 * @returns 任务 ID 或 null
 */
export function parseReceiptTaskId(message) {
    const match = /^\[RECEIPT\]\s*(\S+)/.exec(String(message?.subject || ''));
    return match ? match[1].trim() : null;
}

/**
 * 配对任务与回执，返回「派给我但还没回执」的任务。
 *
 * @param messages - 全部消息
 * @param me - 我的身份（zcode / trae / dsh）
 * @returns 待办任务数组
 */
export function pairTasks(messages, me) {
    const all = (messages || []).filter((m) => m && m.id);
    const replied = new Set();
    for (const m of all) {
        if (m.from !== me) continue;
        const taskId = parseReceiptTaskId(m);
        if (taskId) replied.add(taskId);
    }
    const pending = [];
    for (const m of all) {
        if (m.to !== me && m.to !== 'all') continue;
        const taskId = parseTaskId(m);
        if (!taskId) continue;
        if (replied.has(taskId)) continue;
        pending.push({ taskId, id: m.id, ts: m.ts, from: m.from, subject: m.subject, body: m.body });
    }
    return pending;
}
