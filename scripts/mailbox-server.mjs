#!/usr/bin/env node
/**
 * mailbox-server.mjs — ZCode ↔ Trae ↔ DSH 本地 MCP 信箱
 *
 * 传输：MCP stdio（JSON-RPC 2.0，换行分隔；兼容 Content-Length 帧）。
 * 存储：`.trae/mailbox/messages.jsonl`（只增）+ `reads.jsonl`（已读日志）。
 * 身份：启动时由 `MAILBOX_ME=zcode|trae|dsh` 指定；工具参数 `from` 可覆盖（仅测试用）。
 *
 * 工具：
 *  - send_message   发消息（to: zcode | trae | all）
 *  - read_messages  读自己的消息（默认标记已读）
 *  - wait_for_message 长轮询等新消息（默认 20s，最大 30s）
 *  - mark_read      显式标记已读
 *  - mailbox_status 未读计数与最近消息时间
 *
 * 安全：只传协作摘要，不要传 API Key / 密钥 / 大段正文。
 * 日志一律写 stderr（stdout 只能走 MCP 协议帧）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const vaultRoot = path.resolve(__dirname, '..', '..', '..');
const ROOT = process.env.MAILBOX_ROOT || path.join(vaultRoot, '.trae', 'mailbox');
const MESSAGES = path.join(ROOT, 'messages.jsonl');
const READS = path.join(ROOT, 'reads.jsonl');
const LOCK = path.join(ROOT, '.lock');
const SERVER_VERSION = '1.1.0';
const DEFAULT_ME = (process.env.MAILBOX_ME || '').trim().toLowerCase();
const PEERS = new Set(['zcode', 'trae', 'dsh']);
const MAX_BODY = 8000;

function log(...args) {
    process.stderr.write(`[mailbox] ${args.join(' ')}\n`);
}

function ensureRoot() {
    fs.mkdirSync(ROOT, { recursive: true });
}

function withLock(fn) {
    ensureRoot();
    let fd = null;
    const deadline = Date.now() + 3000;
    for (;;) {
        try {
            fd = fs.openSync(LOCK, 'wx');
            break;
        } catch (error) {
            if (error.code !== 'EEXIST') throw error;
            try {
                const stat = fs.statSync(LOCK);
                if (Date.now() - stat.mtimeMs > 5000) {
                    fs.unlinkSync(LOCK);
                    continue;
                }
            } catch {
                // 锁文件刚被释放，重试
            }
            if (Date.now() > deadline) throw new Error('信箱忙，请稍后重试');
            const end = Date.now() + 20;
            while (Date.now() < end) { /* 短暂自旋，仅用于极短临界区 */ }
        }
    }
    try {
        return fn();
    } finally {
        try { fs.closeSync(fd); } catch { /* ignore */ }
        try { fs.unlinkSync(LOCK); } catch { /* ignore */ }
    }
}

function readJsonl(file) {
    if (!fs.existsSync(file)) return [];
    const text = fs.readFileSync(file, 'utf8');
    const out = [];
    for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
            out.push(JSON.parse(trimmed));
        } catch {
            // 写入中的半行：跳过，不阻断读取
        }
    }
    return out;
}

function resolveMe(args) {
    const from = String(args?.from || '').trim().toLowerCase();
    if (from) {
        if (!PEERS.has(from)) throw new Error(`from 必须是 zcode 或 trae（收到 ${from}）`);
        return from;
    }
    if (!DEFAULT_ME) throw new Error('未设置 MAILBOX_ME（zcode / trae / dsh）');
    if (!PEERS.has(DEFAULT_ME)) throw new Error(`MAILBOX_ME 必须是 zcode / trae / dsh（收到 ${DEFAULT_ME}）`);
    return DEFAULT_ME;
}

function normalizeTarget(to) {
    const value = String(to || '').trim().toLowerCase();
    if (!value) throw new Error('to 不能为空');
    if (value !== 'all' && !PEERS.has(value)) throw new Error('to 必须是 zcode、trae、dsh 或 all');
    return value;
}

function loadMessages() {
    return readJsonl(MESSAGES);
}

function loadReadIds(me) {
    const ids = new Set();
    for (const entry of readJsonl(READS)) {
        if (entry && entry.me === me && Array.isArray(entry.ids)) {
            for (const id of entry.ids) ids.add(id);
        }
    }
    return ids;
}

function appendRead(me, ids) {
    if (ids.length === 0) return;
    withLock(() => {
        ensureRoot();
        fs.appendFileSync(READS, `${JSON.stringify({ ts: new Date().toISOString(), me, ids })}\n`, 'utf8');
    });
}

function collect({ me, peer, since, unreadOnly, includeSent, limit }) {
    const messages = loadMessages();
    const readIds = loadReadIds(me);
    const sinceTs = since ? Date.parse(since) : null;
    if (since && Number.isNaN(sinceTs)) throw new Error('since 必须是可解析的时间（ISO 或毫秒）');
    let filtered = messages.filter((m) => {
        if (!m || !m.id) return false;
        const mine = m.to === me || m.to === 'all';
        const sent = m.from === me;
        if (!mine && !(includeSent && sent)) return false;
        if (peer && m.from !== peer && m.to !== peer) return false;
        if (sinceTs != null && Date.parse(m.ts) < sinceTs) return false;
        if (unreadOnly && (sent || readIds.has(m.id))) return false;
        return true;
    });
    filtered.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
    const total = filtered.length;
    if (limit && limit > 0) filtered = filtered.slice(-limit);
    return { messages: filtered, total, readIds };
}

function toolSendMessage(args) {
    const me = resolveMe(args);
    const to = normalizeTarget(args.to);
    if (to === me) throw new Error('不能给自己发消息');
    let body = String(args.body || '');
    if (!body.trim()) throw new Error('body 不能为空');
    if (body.length > MAX_BODY) body = `${body.slice(0, MAX_BODY)}\n…（已截断 ${body.length - MAX_BODY} 字）`;
    const message = {
        id: `m-${Date.now()}-${randomUUID().slice(0, 8)}`,
        ts: new Date().toISOString(),
        from: me,
        to,
        subject: String(args.subject || '').slice(0, 200),
        body,
        ...(args.reply_to ? { reply_to: String(args.reply_to) } : {}),
    };
    withLock(() => {
        ensureRoot();
        fs.appendFileSync(MESSAGES, `${JSON.stringify(message)}\n`, 'utf8');
    });
    return { ok: true, message };
}

function toolReadMessages(args) {
    const me = resolveMe(args);
    const peer = args.peer ? normalizeTarget(args.peer) : null;
    if (peer === 'all') throw new Error('peer 只能是 zcode 或 trae');
    const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 100);
    const { messages, total, readIds } = collect({
        me,
        peer,
        since: args.since,
        unreadOnly: args.unread_only === true,
        includeSent: args.include_sent === true,
        limit,
    });
    const markRead = args.mark_read !== false;
    const unreadIds = messages
        .filter((m) => m.from !== me && !readIds.has(m.id))
        .map((m) => m.id);
    if (markRead && unreadIds.length > 0) appendRead(me, unreadIds);
    return {
        ok: true,
        me,
        total,
        returned: messages.length,
        marked_read: markRead ? unreadIds.length : 0,
        messages: messages.map((m) => ({ ...m, read: m.from === me || readIds.has(m.id) })),
    };
}

function toolMarkRead(args) {
    const me = resolveMe(args);
    const ids = Array.isArray(args.ids) ? args.ids.map(String) : [];
    if (ids.length === 0) throw new Error('ids 不能为空');
    appendRead(me, ids);
    return { ok: true, marked_read: ids.length };
}

function toolStatus(args) {
    const me = resolveMe(args);
    const messages = loadMessages();
    const readIds = loadReadIds(me);
    const peers = {};
    for (const peer of PEERS) peers[peer] = { unread: 0, total: 0 };
    let unread = 0;
    let last = null;
    for (const m of messages) {
        if (!m || !m.id) continue;
        const mine = m.to === me || m.to === 'all';
        if (!mine || m.from === me) continue;
        peers[m.from] = peers[m.from] || { unread: 0, total: 0 };
        peers[m.from].total += 1;
        if (!readIds.has(m.id)) {
            peers[m.from].unread += 1;
            unread += 1;
        }
        if (!last || Date.parse(m.ts) > Date.parse(last)) last = m.ts;
    }
    return { ok: true, me, unread, last_message_at: last, peers, mailbox: ROOT };
}

async function toolWaitForMessage(args) {
    const me = resolveMe(args);
    const timeout = Math.min(Math.max(Number(args.timeout_ms) || 20000, 1000), 30000);
    const peer = args.peer ? normalizeTarget(args.peer) : null;
    const since = args.since || new Date(Date.now() - 1000).toISOString();
    const deadline = Date.now() + timeout;
    for (;;) {
        const { messages, readIds } = collect({
            me,
            peer,
            since,
            unreadOnly: true,
            includeSent: false,
            limit: 20,
        });
        if (messages.length > 0) {
            if (args.mark_read !== false) {
                appendRead(me, messages.filter((m) => !readIds.has(m.id)).map((m) => m.id));
            }
            return { ok: true, timed_out: false, messages };
        }
        if (Date.now() >= deadline) return { ok: true, timed_out: true, messages: [] };
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
}

const TOOLS = [
    {
        name: 'send_message',
        description: '给另一个工具发一条协作消息（只传摘要，不要传密钥/大段正文）。',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                to: { type: 'string', enum: ['zcode', 'trae', 'dsh', 'all'], description: '收件方' },
                body: { type: 'string', description: '消息正文（≤8000 字）' },
                subject: { type: 'string', description: '可选主题' },
                reply_to: { type: 'string', description: '可选，回复的消息 id' },
                from: { type: 'string', enum: ['zcode', 'trae', 'dsh'], description: '仅测试用，默认取 MAILBOX_ME' },
            },
            required: ['to', 'body'],
        },
    },
    {
        name: 'read_messages',
        description: '读取发给自己的消息；默认标记已读。',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                peer: { type: 'string', enum: ['zcode', 'trae', 'dsh'], description: '只看与某方的往来' },
                unread_only: { type: 'boolean', description: '只看未读' },
                include_sent: { type: 'boolean', description: '包含自己发出的' },
                since: { type: 'string', description: 'ISO 时间或毫秒时间戳' },
                limit: { type: 'integer', minimum: 1, maximum: 100, description: '最多返回条数（默认 20）' },
                mark_read: { type: 'boolean', description: '默认 true' },
                from: { type: 'string', enum: ['zcode', 'trae', 'dsh'], description: '仅测试用' },
            },
        },
    },
    {
        name: 'wait_for_message',
        description: '长轮询等待新消息（1–30 秒），用于需要即时响应的场景。',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                timeout_ms: { type: 'integer', minimum: 1000, maximum: 30000, description: '默认 20000' },
                peer: { type: 'string', enum: ['zcode', 'trae', 'dsh'] },
                since: { type: 'string', description: '默认从现在开始等' },
                mark_read: { type: 'boolean', description: '默认 true' },
                from: { type: 'string', enum: ['zcode', 'trae', 'dsh'], description: '仅测试用' },
            },
        },
    },
    {
        name: 'mark_read',
        description: '显式标记若干消息为已读。',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                ids: { type: 'array', items: { type: 'string' } },
                from: { type: 'string', enum: ['zcode', 'trae', 'dsh'], description: '仅测试用' },
            },
            required: ['ids'],
        },
    },
    {
        name: 'mailbox_status',
        description: '查看未读计数、最近消息时间与信箱路径。',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                from: { type: 'string', enum: ['zcode', 'trae', 'dsh'], description: '仅测试用' },
            },
        },
    },
];

function callTool(name, args) {
    switch (name) {
        case 'send_message': return toolSendMessage(args || {});
        case 'read_messages': return toolReadMessages(args || {});
        case 'wait_for_message': return toolWaitForMessage(args || {});
        case 'mark_read': return toolMarkRead(args || {});
        case 'mailbox_status': return toolStatus(args || {});
        default: throw new Error(`未知工具: ${name}`);
    }
}

function send(message) {
    process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function handleRequest(request) {
    const { id, method, params } = request;
    try {
        if (method === 'initialize') {
            send({
                jsonrpc: '2.0',
                id,
                result: {
                    protocolVersion: params?.protocolVersion || '2024-11-05',
                    capabilities: { tools: { listChanged: false } },
                    serverInfo: { name: 'novel-writer-mailbox', version: SERVER_VERSION },
                },
            });
            return;
        }
        if (method === 'ping') {
            send({ jsonrpc: '2.0', id, result: {} });
            return;
        }
        if (method === 'tools/list') {
            send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
            return;
        }
        if (method === 'tools/call') {
            const name = params?.name;
            const result = await callTool(name, params?.arguments);
            send({
                jsonrpc: '2.0',
                id,
                result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: false },
            });
            return;
        }
        if (method === 'resources/list') {
            send({ jsonrpc: '2.0', id, result: { resources: [] } });
            return;
        }
        if (method === 'prompts/list') {
            send({ jsonrpc: '2.0', id, result: { prompts: [] } });
            return;
        }
        send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
    } catch (error) {
        send({
            jsonrpc: '2.0',
            id,
            result: {
                content: [{ type: 'text', text: `❌ ${error instanceof Error ? error.message : String(error)}` }],
                isError: true,
            },
        });
    }
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
    buffer += chunk;
    for (;;) {
        const headerEnd = buffer.indexOf('\r\n\r\n');
        if (buffer.startsWith('Content-Length:') && headerEnd >= 0) {
            const length = Number(buffer.slice(0, headerEnd).split(':')[1].trim());
            const bodyStart = headerEnd + 4;
            if (buffer.length < bodyStart + length) return;
            const body = buffer.slice(bodyStart, bodyStart + length);
            buffer = buffer.slice(bodyStart + length);
            dispatch(body);
            continue;
        }
        const newline = buffer.indexOf('\n');
        if (newline < 0) return;
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) dispatch(line);
    }
});

function dispatch(text) {
    let request;
    try {
        request = JSON.parse(text);
    } catch {
        log('忽略无法解析的帧');
        return;
    }
    if (!request || request.jsonrpc !== '2.0') return;
    if (!Object.prototype.hasOwnProperty.call(request, 'id')) return; // 通知不响应
    void handleRequest(request);
}

process.stdin.on('end', () => process.exit(0));
log(`已启动（me=${DEFAULT_ME || '未设置'}，root=${ROOT}）`);
