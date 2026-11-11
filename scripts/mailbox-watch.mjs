#!/usr/bin/env node
/**
 * mailbox-watch.mjs — 信箱终端监视器（给 Trae / DSH / 人工用）
 *
 * 轮询 `.trae/mailbox/messages.jsonl`，把发给 `--me` 的未读消息打印到 stdout。
 * Trae 侧若不方便常驻 MCP 会话，可在终端跑本脚本实现自动轮询：
 *
 *   node .obsidian/plugins/novel-writer-ai/scripts/mailbox-watch.mjs --me trae
 *   node .obsidian/plugins/novel-writer-ai/scripts/mailbox-watch.mjs --me trae --once
 *
 * 已读判定与 MCP 服务同源（reads.jsonl）；本脚本**不写**任何信箱文件。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pairTasks, parseTaskId, parseReceiptTaskId, resolveMailboxRoot } from './lib/mailbox-lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 根目录解析与任务配对在 lib 里（可单测），见 scripts/lib/mailbox-lib.mjs */
const root = resolveMailboxRoot(__dirname, process.env.MAILBOX_ROOT);
const MESSAGES = path.join(root, 'messages.jsonl');
const READS = path.join(root, 'reads.jsonl');

if (!fs.existsSync(MESSAGES)) {
    console.error(`[mailbox-watch] ⚠️ 找不到信箱文件：${MESSAGES}`);
    console.error('[mailbox-watch] 请用 MAILBOX_ROOT 指定信箱根目录，或确认 .trae/mailbox 存在。');
    process.exit(2);
}

const args = process.argv.slice(2);
const getArg = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
};
const me = (getArg('--me') || process.env.MAILBOX_ME || '').trim().toLowerCase();
const intervalMs = Math.max(Number(getArg('--interval')) || 15000, 3000);
const once = args.includes('--once');

if (!['zcode', 'trae', 'dsh'].includes(me)) {
    console.error('用法: mailbox-watch.mjs --me zcode|trae|dsh [--interval 毫秒] [--once] [--tasks]');
    process.exit(1);
}

function readJsonl(file) {
    if (!fs.existsSync(file)) return [];
    const out = [];
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        const t = line.trim();
        if (!t) continue;
        try { out.push(JSON.parse(t)); } catch { /* 半行跳过 */ }
    }
    return out;
}

function readIds(me_) {
    const ids = new Set();
    for (const entry of readJsonl(READS)) {
        if (entry && entry.me === me_ && Array.isArray(entry.ids)) {
            for (const id of entry.ids) ids.add(id);
        }
    }
    return ids;
}

function checkOnce() {
    const readIds_ = readIds(me);
    const unread = readJsonl(MESSAGES)
        .filter((m) => m && m.id && (m.to === me || m.to === 'all') && m.from !== me && !readIds_.has(m.id));
    if (unread.length === 0) return false;
    const stamp = new Date().toLocaleTimeString('sv-SE');
    console.log(`\n[${stamp}] ${unread.length} 条未读：`);
    for (const m of unread) {
        console.log(`--- ${m.id} | ${m.ts} | ${m.from} → ${m.to}${m.subject ? ` | ${m.subject}` : ''}`);
        console.log(m.body);
    }
    console.log('（处理完成后请用 MCP read_messages 或 mark_read 标记已读）');
    return true;
}


/** 列出「派给我但我还没回执」的任务（配对逻辑在 lib 里，可单测） */
function listPendingTasks() {
    return pairTasks(readJsonl(MESSAGES), me);
}
if (args.includes('--tasks')) {
    const pending = listPendingTasks();
    if (pending.length === 0) {
        console.log(`[mailbox-watch] me=${me}：没有待回执的任务`);
        process.exit(0);
    }
    console.log(`[mailbox-watch] me=${me}：${pending.length} 个待回执任务`);
    for (const task of pending) {
        console.log(`\n=== ${task.taskId} ===`);
        console.log(`来自: ${task.from} | 时间: ${task.ts}`);
        console.log(task.body);
    }
    console.log('\n（做完后发 [RECEIPT] <TASK-ID> 给派发方，再重跑本命令确认已清空）');
    process.exit(0);
}

if (once) {
    checkOnce();
    process.exit(0);
}

console.log(`[mailbox-watch] me=${me} root=${root} 每 ${Math.round(intervalMs / 1000)}s 轮询一次（Ctrl+C 退出）`);
setInterval(() => {
    try {
        checkOnce();
    } catch (e) {
        console.error('[mailbox-watch] 读取失败:', e instanceof Error ? e.message : String(e));
    }
}, intervalMs);
