#!/usr/bin/env node
/**
 * board.mjs — 三方任务板（ZCode / Trae / DSH 共享）
 *
 * 为什么不用 30 分钟信箱轮询：
 *   1. 延迟 30 分钟，不实时
 *   2. 没有原子领取，两个 agent 可能领到同一个任务
 *   3. 没有写范围互斥，两个 agent 可能同时改同一批文件
 *
 * 本脚本用**文件系统原语**做协调（不依赖任何锁服务）：
 *   - 原子领取：`writeFileSync(claim, ..., { flag: 'wx' })`，文件已存在即失败
 *   - 写范围租约：领取时对声明的每个范围独占创建锁文件，冲突则回滚
 *   - 租约超时：claim 带 leaseUntil（默认 20 分钟），崩溃不会永久占坑
 *   - 实时：`wait` 长轮询，任务一出现就返回（默认 500ms 一次，秒级）
 *
 * 用法：
 *   node scripts/board.mjs add --id T1 --title "标题" --scope "scripts/a.mjs,tests/b.ts" \
 *        --accept "验收标准" --by dsh [--note "说明"]
 *   node scripts/board.mjs next --me zcode [--lease 20]
 *   node scripts/board.mjs wait --me zcode [--timeout 600]
 *   node scripts/board.mjs done T1 --me zcode --evidence "commit abc; 9 tests passed"
 *   node scripts/board.mjs fail T1 --me zcode --reason "缺依赖"
 *   node scripts/board.mjs release T1 --me zcode
 *   node scripts/board.mjs status
 *   node scripts/board.mjs ls
 *
 * 环境变量：
 *   BOARD_ROOT  覆盖任务板目录（测试用）
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    DEFAULT_LEASE_MS,
    formatBoardStatus,
    isLeaseExpired,
    parseScopeList,
    pickClaimableTasks,
} from './lib/board-lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 向上搜索 vault 根（含 .trae 目录），找不到则退回插件仓 */
function resolveBoardRoot() {
    if (process.env.BOARD_ROOT) return process.env.BOARD_ROOT;
    let current = __dirname;
    for (let depth = 0; depth < 8; depth++) {
        const candidate = path.join(current, '.trae');
        if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
            return path.join(candidate, 'board');
        }
        const parent = path.dirname(current);
        if (parent === current) break;
        current = parent;
    }
    return path.join(path.resolve(__dirname, '..'), '.trae', 'board');
}

const BOARD_ROOT = resolveBoardRoot();
const TASKS = path.join(BOARD_ROOT, 'tasks.jsonl');
const RESULTS = path.join(BOARD_ROOT, 'results.jsonl');
const CLAIMS = path.join(BOARD_ROOT, 'claims');
const LOCKS = path.join(BOARD_ROOT, 'locks');

const argv = process.argv.slice(2);
const command = argv[0] || 'status';

/** 取 `--key value` 参数 */
function arg(name, fallback) {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : fallback;
}

/** 确保目录存在 */
function ensureDirs() {
    for (const dir of [BOARD_ROOT, CLAIMS, LOCKS]) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

/** 读 JSONL（半行/坏行跳过） */
function readJsonl(file) {
    if (!fs.existsSync(file)) return [];
    const out = [];
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try { out.push(JSON.parse(trimmed)); } catch { /* 跳过坏行 */ }
    }
    return out;
}

/** 追加一行 JSONL */
function appendJsonl(file, record) {
    fs.appendFileSync(file, JSON.stringify(record) + '\n', 'utf8');
}

/** 读目录下的 JSON 文件（跳过坏文件） */
function readDirJson(dir) {
    if (!fs.existsSync(dir)) return [];
    const out = [];
    for (const name of fs.readdirSync(dir)) {
        if (!name.endsWith('.json')) continue;
        const full = path.join(dir, name);
        try {
            out.push(JSON.parse(fs.readFileSync(full, 'utf8')));
        } catch {
            // 可能是「刚创建还没写完」的瞬间状态：用 mtime 给 10 秒宽限，避免误判为可用
            try {
                const stat = fs.statSync(full);
                if (Date.now() - stat.mtimeMs < 10_000) {
                    out.push({ __pending: true, file: full, leaseUntil: Date.now() + 10_000, agent: 'unknown' });
                }
            } catch { /* 忽略 */ }
        }
    }
    return out;
}

/** 把范围转成锁文件名（安全字符 + 短哈希） */
function lockFileFor(scope) {
    const safe = scope.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || '_repo_';
    let hash = 0;
    for (let i = 0; i < scope.length; i++) hash = (hash * 31 + scope.charCodeAt(i)) | 0;
    return path.join(LOCKS, `${safe}-${(hash >>> 0).toString(36)}.json`);
}

/** 独占创建（原子）：成功返回 true，已存在返回 false */
function tryCreateExclusive(file, content) {
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content, { flag: 'wx', encoding: 'utf8' });
        return true;
    } catch (e) {
        if (e && e.code === 'EEXIST') return false;
        throw e;
    }
}

/** 领取任务（原子）；成功返回 { task, claim }，否则 null */
function claimTask(taskId, me, leaseMinutes) {
    ensureDirs();
    const claimPath = path.join(CLAIMS, `${taskId}.json`);
    const leaseUntil = Date.now() + leaseMinutes * 60_000;
    const claimBody = JSON.stringify({ taskId, agent: me, leaseUntil, claimedAt: Date.now() }, null, 2);

    // 若已有有效 claim，先判断是不是自己的 / 是否过期
    if (fs.existsSync(claimPath)) {
        try {
            const existing = JSON.parse(fs.readFileSync(claimPath, 'utf8'));
            if (existing.agent !== me && !isLeaseExpired(existing, Date.now())) return null;
        } catch { /* 坏文件按可抢占处理 */ }
        fs.rmSync(claimPath, { force: true });
    }
    if (!tryCreateExclusive(claimPath, claimBody)) return null;

    // 加写范围锁（全有或全无）
    const tasks = readJsonl(TASKS);
    const task = [...tasks].reverse().find((t) => t && String(t.id) === String(taskId));
    const scopes = parseScopeList(task?.scope);
    const acquired = [];
    for (const scope of scopes) {
        const lockPath = lockFileFor(scope);
        const body = JSON.stringify({ scope, agent: me, taskId, leaseUntil, at: Date.now() }, null, 2);
        if (tryCreateExclusive(lockPath, body)) {
            acquired.push(lockPath);
            continue;
        }
        // 冲突：看持有者是否过期
        let holder = null;
        try { holder = JSON.parse(fs.readFileSync(lockPath, 'utf8')); } catch { /* 坏文件 */ }
        if (holder && holder.agent !== me && !isLeaseExpired(holder, Date.now())) {
            // 真的冲突 → 回滚
            for (const p of acquired) fs.rmSync(p, { force: true });
            fs.rmSync(claimPath, { force: true });
            return { conflict: holder, scope };
        }
        // 过期或自己的锁 → 抢占
        fs.rmSync(lockPath, { force: true });
        if (tryCreateExclusive(lockPath, body)) acquired.push(lockPath);
    }
    return { task, claimPath, locks: acquired };
}

/** 释放任务（删除 claim 与本人持有的锁） */
function releaseTask(taskId, me) {
    ensureDirs();
    fs.rmSync(path.join(CLAIMS, `${taskId}.json`), { force: true });
    for (const lock of readDirJson(LOCKS)) {
        if (!lock || lock.taskId !== taskId) continue;
        if (me && lock.agent !== me) continue;
        const scope = lock.scope || '';
        fs.rmSync(lockFileFor(scope), { force: true });
    }
}

/** 取下一个可领取任务（考虑 claim 与锁） */
function pickNext(me) {
    ensureDirs();
    const tasks = readJsonl(TASKS);
    const claims = readDirJson(CLAIMS);
    const locks = readDirJson(LOCKS);
    const candidates = pickClaimableTasks(tasks, claims, locks, me, Date.now());
    return candidates[0] || null;
}

// ---------------------------------------------------------------- 命令

function cmdAdd() {
    const id = arg('id');
    const title = arg('title');
    if (!id || !title) {
        console.error('用法: board.mjs add --id <id> --title <标题> [--scope "a,b"] [--accept "..."] [--by dsh]');
        process.exit(1);
    }
    ensureDirs();
    const task = {
        id,
        title,
        scope: arg('scope', ''),
        accept: arg('accept', ''),
        /** 定向指派：只有该 agent 能领；空串表示任何 agent 可领 */
        assignee: arg('assignee', ''),
        note: arg('note', ''),
        by: arg('by', 'dsh'),
        status: 'open',
        createdAt: Date.now(),
    };
    appendJsonl(TASKS, task);
    console.log(`✅ 已加入任务板：${id} | ${title}`);
    if (task.scope) console.log(`   写范围：${task.scope}`);
}

function cmdNext() {
    const me = arg('me');
    if (!me) { console.error('用法: board.mjs next --me <agent>'); process.exit(1); }
    const lease = Number(arg('lease', '20')) || 20;
    const task = pickNext(me);
    if (!task) { console.log('（当前没有可领取的任务）'); process.exit(0); }
    const claimed = claimTask(task.id, me, lease);
    if (!claimed) { console.log('（任务在领取瞬间被抢走，请重试）'); process.exit(0); }
    if (claimed.conflict) {
        console.log(`（写范围冲突：${claimed.scope} 被 ${claimed.conflict.agent} 持有）`);
        process.exit(0);
    }
    console.log(JSON.stringify(claimed.task, null, 2));
}

async function cmdWait() {
    const me = arg('me');
    if (!me) { console.error('用法: board.mjs wait --me <agent> [--timeout 600]'); process.exit(1); }
    const timeoutSec = Number(arg('timeout', '600')) || 600;
    const deadline = Date.now() + timeoutSec * 1000;
    const lease = Number(arg('lease', '20')) || 20;
    while (Date.now() < deadline) {
        const task = pickNext(me);
        if (task) {
            const claimed = claimTask(task.id, me, lease);
            if (claimed && !claimed.conflict) {
                console.log(JSON.stringify(claimed.task, null, 2));
                return;
            }
        }
        // 500ms 轮询：只读几个小文件，开销可忽略（用 setTimeout 让出事件循环，不忙等）
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
    console.log('（等待超时，仍无任务）');
    process.exit(0);
}

function cmdDone() {
    const id = argv[1];
    const me = arg('me');
    const evidence = arg('evidence', '');
    if (!id || !me) { console.error('用法: board.mjs done <id> --me <agent> --evidence "..."'); process.exit(1); }
    ensureDirs();
    appendJsonl(TASKS, { id, status: 'done', doneAt: Date.now(), by: me });
    appendJsonl(RESULTS, { taskId: id, status: 'done', agent: me, evidence, at: Date.now() });
    releaseTask(id, me);
    console.log(`✅ 任务 ${id} 已标记完成并释放锁`);
}

function cmdFail() {
    const id = argv[1];
    const me = arg('me');
    const reason = arg('reason', '');
    if (!id || !me) { console.error('用法: board.mjs fail <id> --me <agent> --reason "..."'); process.exit(1); }
    ensureDirs();
    appendJsonl(TASKS, { id, status: 'failed', failedAt: Date.now(), by: me });
    appendJsonl(RESULTS, { taskId: id, status: 'failed', agent: me, reason, at: Date.now() });
    releaseTask(id, me);
    console.log(`❌ 任务 ${id} 已标记失败并释放锁`);
}

function cmdRelease() {
    const id = argv[1];
    const me = arg('me');
    if (!id) { console.error('用法: board.mjs release <id> [--me <agent>]'); process.exit(1); }
    releaseTask(id, me);
    console.log(`已释放 ${id} 的领取与写范围锁`);
}

function cmdStatus() {
    ensureDirs();
    console.log(formatBoardStatus(readJsonl(TASKS), readDirJson(CLAIMS), readDirJson(LOCKS), Date.now()));
}

function cmdLs() {
    const tasks = readJsonl(TASKS);
    if (tasks.length === 0) { console.log('（任务板为空）'); return; }
    for (const t of tasks) {
        console.log(`${t.id} | ${t.status || 'open'} | ${t.title || ''} | scope=${t.scope || '-'}`);
    }
}

switch (command) {
    case 'add': cmdAdd(); break;
    case 'next': cmdNext(); break;
    case 'wait': await cmdWait(); break;
    case 'done': cmdDone(); break;
    case 'fail': cmdFail(); break;
    case 'release': cmdRelease(); break;
    case 'ls': cmdLs(); break;
    case 'status': cmdStatus(); break;
    default:
        console.error(`未知命令：${command}`);
        console.error('可用：add | next | wait | done | fail | release | ls | status');
        process.exit(1);
}
