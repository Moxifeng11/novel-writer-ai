/**
 * board-lib.mjs — 任务板的纯逻辑（可测试）
 *
 * 背景：三方（ZCode / Trae / DSH）共享同一个文件系统，此前靠 30 分钟信箱轮询派任务，
 * 有三个硬伤：
 *   1. 延迟 30 分钟，不实时
 *   2. 没有原子领取，两个 agent 可能领到同一个任务
 *   3. 没有写范围互斥，两个 agent 可能同时改同一批文件
 *
 * 本模块把「任务板」的判定逻辑抽成纯函数，CLI 只负责文件操作：
 *   - 写范围重叠判定（scopesOverlap）
 *   - 可领取任务筛选（pickClaimableTasks）
 *   - 租约过期判定（isLeaseExpired）
 *
 * 原子性由文件系统原语保证（`open(..., 'wx')` 独占创建），不依赖任何锁服务。
 */

/** 默认租约时长：20 分钟。超时后可被其他 agent 抢占（防止崩溃永久占坑） */
export const DEFAULT_LEASE_MS = 20 * 60 * 1000;

/**
 * 规范化写范围路径。
 *
 * 统一为正斜杠、去掉前导 `./` 与首尾斜杠。
 * 空串或 `.` 表示**整个仓库**（与任何范围都重叠）。
 *
 * @param scope - 原始路径
 * @returns 规范化路径
 */
export function normalizeScope(scope) {
    const raw = String(scope ?? '').trim().replace(/\\/g, '/');
    if (!raw || raw === '.' || raw === './') return '';
    return raw.replace(/^\.\//, '').replace(/^\/+|\/+$/g, '');
}

/**
 * 解析逗号分隔的写范围字符串。
 *
 * @param text - 形如 `scripts/a.mjs, tests/b.test.ts`
 * @returns 规范化后的范围数组（去重、去空）
 */
export function parseScopeList(text) {
    if (Array.isArray(text)) return [...new Set(text.map(normalizeScope))];
    const parts = String(text ?? '').split(/[,;]/).map(normalizeScope).filter(Boolean);
    return [...new Set(parts)];
}

/**
 * 判断两个写范围是否重叠。
 *
 * 语义是**路径前缀**：
 * - `scripts/` 与 `scripts/a.mjs` 重叠
 * - `scripts/a.mjs` 与 `scripts/b.mjs` 不重叠
 * - 空范围（整个仓库）与任何范围都重叠
 *
 * @param a - 范围 A
 * @param b - 范围 B
 * @returns 是否重叠
 */
export function scopesOverlap(a, b) {
    const left = normalizeScope(a);
    const right = normalizeScope(b);
    if (left === '' || right === '') return true;
    if (left === right) return true;
    return left.startsWith(right + '/') || right.startsWith(left + '/');
}

/**
 * 判断两组写范围是否重叠。
 *
 * @param listA - 范围数组 A
 * @param listB - 范围数组 B
 * @returns 是否任一重叠
 */
export function scopeListsOverlap(listA, listB) {
    for (const a of listA || []) {
        for (const b of listB || []) {
            if (scopesOverlap(a, b)) return true;
        }
    }
    return false;
}

/**
 * 判断租约是否已过期。
 *
 * @param claim - 领取记录（含 leaseUntil 时间戳）
 * @param now - 当前时间戳（毫秒）
 * @returns 是否过期；无 leaseUntil 视为已过期（不信任无租约的领取）
 */
export function isLeaseExpired(claim, now) {
    const until = Number(claim?.leaseUntil);
    if (!Number.isFinite(until) || until <= 0) return true;
    return Number(now) >= until;
}

/**
 * 把 append-only 的任务记录折叠成「每个 id 最新一条」。
 *
 * 任务板是 append-only 的（便于审计与恢复），同一任务的状态更新以**最后一条**为准。
 *
 * @param records - 原始记录数组
 * @returns Map<id, task>
 */
export function foldTasks(records) {
    const map = new Map();
    for (const record of records || []) {
        if (!record || !record.id) continue;
        map.set(String(record.id), record);
    }
    return map;
}

/**
 * 筛选出当前可以被 `me` 领取的任务。
 *
 * 条件：
 * 1. 状态不是 done / failed
 * 2. 若任务指定了 `assignee`，只允许该 agent 领取（定向指派）
 * 3. 没有有效领取（无 claim，或 claim 租约已过期）
 * 4. 写范围与**他人持有的锁**不重叠（本人已持有的锁不算冲突）
 *
 * @param tasks - 任务记录数组（append-only）
 * @param claims - 领取记录数组 `{ taskId, agent, leaseUntil }`
 * @param locks - 锁记录数组 `{ scope, agent, leaseUntil }`
 * @param me - 我的身份
 * @param now - 当前时间戳
 * @returns 可领取任务数组
 */
export function pickClaimableTasks(tasks, claims, locks, me, now) {
    const folded = foldTasks(tasks);
    /** 有效领取：taskId → claim */
    const activeClaims = new Map();
    for (const claim of claims || []) {
        if (!claim || !claim.taskId) continue;
        if (isLeaseExpired(claim, now)) continue;
        activeClaims.set(String(claim.taskId), claim);
    }
    /** 他人持有的有效锁 */
    const foreignLocks = (locks || []).filter(
        (lock) => lock && lock.agent !== me && !isLeaseExpired(lock, now),
    );

    const result = [];
    for (const task of folded.values()) {
        if (task.status === 'done' || task.status === 'failed') continue;
        // 定向指派：指定了 assignee 的任务只给那个人（空/缺省表示任何人可领）
        const assignee = String(task.assignee ?? '').trim();
        if (assignee && assignee !== me) continue;
        const claim = activeClaims.get(String(task.id));
        if (claim && claim.agent !== me) continue;
        const scopes = parseScopeList(task.scope);
        const conflict = foreignLocks.some((lock) => scopeListsOverlap(scopes, parseScopeList(lock.scope)));
        if (conflict) continue;
        result.push(task);
    }
    // 稳定的先进先出：按 createdAt 升序（缺失时排最后）
    result.sort((a, b) => Number(a.createdAt || Infinity) - Number(b.createdAt || Infinity));
    return result;
}

/**
 * 生成任务板的人类可读状态摘要。
 *
 * @param tasks - 任务记录
 * @param claims - 领取记录
 * @param locks - 锁记录
 * @param now - 当前时间戳
 * @returns 文本摘要
 */
export function formatBoardStatus(tasks, claims, locks, now) {
    const folded = foldTasks(tasks);
    const lines = [`任务总数 ${folded.size}`];
    for (const task of folded.values()) {
        const claim = (claims || []).find((c) => c && String(c.taskId) === String(task.id) && !isLeaseExpired(c, now));
        const assignee = String(task.assignee ?? '').trim();
        const state = task.status === 'done' ? '✅ done'
            : task.status === 'failed' ? '❌ failed'
                : claim ? `🔒 ${claim.agent}（剩 ${Math.max(0, Math.round((Number(claim.leaseUntil) - now) / 60000))} 分钟）`
                    : assignee ? `🟢 待领取 → 指派 ${assignee}`
                        : '🟢 待领取';
        lines.push(`  ${task.id} | ${state} | ${task.title || ''}`);
    }
    const activeLocks = (locks || []).filter((l) => l && !isLeaseExpired(l, now));
    if (activeLocks.length > 0) {
        lines.push(`活跃写范围锁 ${activeLocks.length}：`);
        for (const lock of activeLocks) {
            lines.push(`  ${lock.scope} ← ${lock.agent}`);
        }
    }
    return lines.join('\n');
}
