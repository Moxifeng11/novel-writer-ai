/**
 * 任务板纯逻辑的回归测试
 *
 * 背景：三方协作此前靠 30 分钟信箱轮询派任务，有三个硬伤——
 * 延迟高、无原子领取（可能重复领）、无写范围互斥（可能同时改同一批文件）。
 *
 * 本文件锁住任务板的三条核心判定：
 * 1. 写范围重叠（前缀语义，空范围=整仓）
 * 2. 可领取任务筛选（已被占 / 租约过期 / 锁冲突 / 已完成）
 * 3. 租约过期（崩溃不会永久占坑）
 */

import { describe, expect, it } from 'vitest';
import {
    DEFAULT_LEASE_MS,
    foldTasks,
    formatBoardStatus,
    isLeaseExpired,
    normalizeScope,
    parseScopeList,
    pickClaimableTasks,
    scopeListsOverlap,
    scopesOverlap,
} from '../../../scripts/lib/board-lib.mjs';

const NOW = 1_700_000_000_000;

describe('任务板-1：写范围规范化', () => {
    it('统一斜杠、去前导 ./ 与首尾斜杠', () => {
        expect(normalizeScope('./scripts/a.mjs')).toBe('scripts/a.mjs');
        expect(normalizeScope('/scripts/')).toBe('scripts');
        expect(normalizeScope('scripts\\a.mjs')).toBe('scripts/a.mjs');
    });

    it('空 / . 表示整个仓库', () => {
        expect(normalizeScope('')).toBe('');
        expect(normalizeScope('.')).toBe('');
        expect(normalizeScope(null)).toBe('');
    });

    it('解析逗号分隔并去重', () => {
        expect(parseScopeList('scripts/a.mjs, tests/b.ts ,scripts/a.mjs')).toEqual([
            'scripts/a.mjs', 'tests/b.ts',
        ]);
    });

    it('接受数组输入', () => {
        expect(parseScopeList(['./a', 'a'])).toEqual(['a']);
    });
});

describe('任务板-2：范围重叠判定（前缀语义）', () => {
    it('目录范围覆盖其下文件', () => {
        expect(scopesOverlap('scripts', 'scripts/a.mjs')).toBe(true);
        expect(scopesOverlap('scripts/', 'scripts/a.mjs')).toBe(true);
    });

    it('同目录下不同文件不重叠', () => {
        expect(scopesOverlap('scripts/a.mjs', 'scripts/b.mjs')).toBe(false);
    });

    it('完全相同的范围重叠', () => {
        expect(scopesOverlap('scripts/a.mjs', 'scripts/a.mjs')).toBe(true);
    });

    it('空范围（整仓）与任何范围都重叠', () => {
        expect(scopesOverlap('', 'scripts/a.mjs')).toBe(true);
        expect(scopesOverlap('scripts/a.mjs', '')).toBe(true);
    });

    it('前缀相似但不是路径边界时不算重叠', () => {
        // 'scripts/a' 不是 'scripts/ab.mjs' 的父目录
        expect(scopesOverlap('scripts/a', 'scripts/ab.mjs')).toBe(false);
    });

    it('列表之间任一重叠即冲突', () => {
        expect(scopeListsOverlap(['a/x', 'b/y'], ['b'])).toBe(true);
        expect(scopeListsOverlap(['a/x'], ['b/y'])).toBe(false);
    });
});

describe('任务板-3：租约过期', () => {
    it('未到期 → 未过期', () => {
        expect(isLeaseExpired({ leaseUntil: NOW + 1000 }, NOW)).toBe(false);
    });

    it('已到期 / 刚好到期 → 过期', () => {
        expect(isLeaseExpired({ leaseUntil: NOW - 1 }, NOW)).toBe(true);
        expect(isLeaseExpired({ leaseUntil: NOW }, NOW)).toBe(true);
    });

    it('缺 leaseUntil 视为过期（不信任无租约的领取）', () => {
        expect(isLeaseExpired({}, NOW)).toBe(true);
        expect(isLeaseExpired({ leaseUntil: 'abc' as unknown as number }, NOW)).toBe(true);
        expect(isLeaseExpired(null, NOW)).toBe(true);
    });

    it('默认租约是 20 分钟', () => {
        expect(DEFAULT_LEASE_MS).toBe(20 * 60 * 1000);
    });
});

describe('任务板-4：append-only 折叠（同一 id 最后一条为准）', () => {
    it('后面的状态覆盖前面的', () => {
        const folded = foldTasks([
            { id: 'T1', status: 'open' },
            { id: 'T1', status: 'done' },
        ]);
        expect(folded.get('T1')?.status).toBe('done');
    });

    it('缺 id 的记录被跳过', () => {
        expect(foldTasks([{ status: 'open' } as never, null as never]).size).toBe(0);
    });
});

describe('任务板-5：可领取任务筛选', () => {
    const tasks = [
        { id: 'T1', title: 'A', scope: 'scripts/a.mjs', createdAt: 1 },
        { id: 'T2', title: 'B', scope: 'scripts/b.mjs', createdAt: 2 },
        { id: 'T3', title: 'C', scope: 'docs/c.md', createdAt: 3 },
    ];

    it('无占用时按 createdAt 先进先出', () => {
        const picked = pickClaimableTasks(tasks, [], [], 'zcode', NOW);
        expect(picked.map((t) => t.id)).toEqual(['T1', 'T2', 'T3']);
    });

    it('被他人有效领取 → 不可领', () => {
        const picked = pickClaimableTasks(
            tasks,
            [{ taskId: 'T1', agent: 'trae', leaseUntil: NOW + 60_000 }],
            [],
            'zcode',
            NOW,
        );
        expect(picked.map((t) => t.id)).toEqual(['T2', 'T3']);
    });

    it('他人领取已过期 → 可领（崩溃不会永久占坑）', () => {
        const picked = pickClaimableTasks(
            tasks,
            [{ taskId: 'T1', agent: 'trae', leaseUntil: NOW - 1 }],
            [],
            'zcode',
            NOW,
        );
        expect(picked.map((t) => t.id)).toContain('T1');
    });

    it('自己已领取 → 仍可领（续做）', () => {
        const picked = pickClaimableTasks(
            tasks,
            [{ taskId: 'T1', agent: 'zcode', leaseUntil: NOW + 60_000 }],
            [],
            'zcode',
            NOW,
        );
        expect(picked.map((t) => t.id)).toContain('T1');
    });

    it('他人持有写范围锁 → 重叠任务被跳过', () => {
        const picked = pickClaimableTasks(
            tasks,
            [],
            [{ scope: 'scripts/a.mjs', agent: 'trae', leaseUntil: NOW + 60_000 }],
            'zcode',
            NOW,
        );
        expect(picked.map((t) => t.id)).toEqual(['T2', 'T3']);
    });

    it('他人持锁但已过期 → 不再阻塞', () => {
        const picked = pickClaimableTasks(
            tasks,
            [],
            [{ scope: 'scripts/a.mjs', agent: 'trae', leaseUntil: NOW - 1 }],
            'zcode',
            NOW,
        );
        expect(picked.map((t) => t.id)).toContain('T1');
    });

    it('自己持有的锁不算冲突', () => {
        const picked = pickClaimableTasks(
            tasks,
            [],
            [{ scope: 'scripts/a.mjs', agent: 'zcode', leaseUntil: NOW + 60_000 }],
            'zcode',
            NOW,
        );
        expect(picked.map((t) => t.id)).toContain('T1');
    });

    it('已完成 / 已失败的任务不再出现', () => {
        const picked = pickClaimableTasks(
            [
                { id: 'T1', status: 'done' },
                { id: 'T2', status: 'failed' },
                { id: 'T3', status: 'open' },
            ],
            [], [], 'zcode', NOW,
        );
        expect(picked.map((t) => t.id)).toEqual(['T3']);
    });

    it('空输入不抛错', () => {
        expect(pickClaimableTasks([], [], [], 'zcode', NOW)).toEqual([]);
        expect(pickClaimableTasks(null, null, null, 'zcode', NOW)).toEqual([]);
    });
});

describe('任务板-6：状态摘要', () => {
    it('区分待领取 / 已占用 / 已完成 / 已失败', () => {
        const text = formatBoardStatus(
            [
                { id: 'T1', title: 'A', status: 'open' },
                { id: 'T2', title: 'B', status: 'open' },
                { id: 'T3', title: 'C', status: 'done' },
                { id: 'T4', title: 'D', status: 'failed' },
            ],
            [{ taskId: 'T1', agent: 'zcode', leaseUntil: NOW + 600_000 }],
            [{ scope: 'scripts/a.mjs', agent: 'zcode', leaseUntil: NOW + 600_000 }],
            NOW,
        );
        expect(text).toContain('T1 | 🔒 zcode');
        expect(text).toContain('T2 | 🟢 待领取');
        expect(text).toContain('T3 | ✅ done');
        expect(text).toContain('T4 | ❌ failed');
        expect(text).toContain('scripts/a.mjs ← zcode');
    });

    it('过期锁不计入活跃锁', () => {
        const text = formatBoardStatus(
            [],
            [],
            [{ scope: 'x', agent: 'zcode', leaseUntil: NOW - 1 }],
            NOW,
        );
        expect(text).not.toContain('活跃写范围锁');
    });
});

describe('任务板-7：定向指派（assignee）', () => {
    it('指派给 zcode 的任务，trae 领不到', () => {
        const tasks = [{ id: 'T1', title: 'A', scope: 'a.mjs', assignee: 'zcode', createdAt: 1 }];
        expect(pickClaimableTasks(tasks, [], [], 'trae', NOW)).toEqual([]);
        expect(pickClaimableTasks(tasks, [], [], 'zcode', NOW).map((t) => t.id)).toEqual(['T1']);
    });

    it('未指派的任务任何人可领', () => {
        const tasks = [{ id: 'T1', title: 'A', scope: 'a.mjs', createdAt: 1 }];
        expect(pickClaimableTasks(tasks, [], [], 'trae', NOW).map((t) => t.id)).toEqual(['T1']);
        expect(pickClaimableTasks(tasks, [], [], 'zcode', NOW).map((t) => t.id)).toEqual(['T1']);
    });

    it('空串指派视为未指派', () => {
        const tasks = [{ id: 'T1', title: 'A', scope: 'a.mjs', assignee: '', createdAt: 1 }];
        expect(pickClaimableTasks(tasks, [], [], 'trae', NOW).map((t) => t.id)).toEqual(['T1']);
    });

    it('状态摘要显示指派对象', () => {
        const text = formatBoardStatus(
            [{ id: 'T1', title: 'A', status: 'open', assignee: 'zcode' }],
            [], [], NOW,
        );
        expect(text).toContain('待领取 → 指派 zcode');
    });
});

describe('作废状态（cancel）', () => {
    const now = Date.now();
    const base = {
        id: 'T1', title: '低收益任务', scope: 'a/', status: 'open', createdAt: now - 1000,
    };

    it('作废任务不可被领取（与 done/failed 同等）', () => {
        const tasks = [{ ...base, status: 'cancelled', reason: '低收益' }];
        expect(pickClaimableTasks(tasks, [], [], 'zcode', now)).toHaveLength(0);
    });

    it('状态显示带作废原因', () => {
        const out = formatBoardStatus(
            [{ ...base, status: 'cancelled', reason: '低收益' }], [], [], now,
        );
        expect(out).toContain('cancelled');
        expect(out).toContain('低收益');
    });

    it('未作废的任务仍可领取（守卫不误伤）', () => {
        expect(pickClaimableTasks([base], [], [], 'zcode', now)).toHaveLength(1);
    });
});
