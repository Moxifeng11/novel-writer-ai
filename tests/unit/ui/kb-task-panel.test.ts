/**
 * kb-task-panel 单测（v4.83.0 UI 可测性治理 · 第 7 批）
 *
 * `renderTasksTab` 是 knowledge-base-view.ts 里最大的单体（384 行），而该文件覆盖率 0.34%。
 * 任务面板规则密集且有**误操作风险**，本文件把判定规则全部锁定。
 *
 * 最关键的两条（勘察报告风险点 #4）：
 * - 批量**取消**只针对 `running | pending`
 * - 批量**删除**只针对 `completed | failed | cancelled`
 * 两个集合不同，混用会取消已完成任务或试图删除运行中任务。
 *
 * 另注意风险点 #5：任务状态 **6 档**（多「已暂停」），不可复用书籍拆解状态的 5 档映射。
 */

import { describe, expect, it } from 'vitest';
import type { BreakdownTask } from '../../../engine/deconstruction-scheduler';
import {
    TASK_FILTER_OPTIONS,
    resolveTaskStatusTone,
    filterTasks,
    sortTasksByCreatedDesc,
    filterAndSortTasks,
    computeTaskStats,
    selectSelectedCancellable,
    selectSelectedDeletable,
    selectActiveTasks,
    isAllFilteredSelected,
    formatSelectionLabel,
    resolveTaskRowActions,
    shouldShowTaskProgress,
    shouldShowTaskMessage,
    shouldShowTaskTiming,
    shouldShowTaskError,
    formatTaskDimensions,
    formatTaskProgressPercent,
    disabledOpacity,
    disabledCursor,
    type TaskFilterType,
} from '../../../ui/views/kb-task-panel';

/** 构造任务（只填所需字段） */
function task(partial: Partial<BreakdownTask> & { id?: string } = {}): BreakdownTask {
    return {
        id: partial.id ?? 't',
        bookId: partial.bookId ?? 'b',
        bookName: partial.bookName ?? '书',
        sourceText: partial.sourceText ?? '',
        dimensions: partial.dimensions ?? ['character'],
        status: partial.status ?? 'pending',
        progress: partial.progress ?? 0,
        createdAt: partial.createdAt ?? 0,
        ...partial,
    } as BreakdownTask;
}

describe('任务筛选', () => {
    const list: BreakdownTask[] = [
        task({ id: 'a', status: 'running', createdAt: 3 }),
        task({ id: 'b', status: 'pending', createdAt: 1 }),
        task({ id: 'c', status: 'completed', createdAt: 5 }),
        task({ id: 'd', status: 'failed', createdAt: 2 }),
        task({ id: 'e', status: 'cancelled', createdAt: 4 }),
        task({ id: 'f', status: 'paused', createdAt: 6 }),
    ];

    it('下拉选项 6 项且不含「已暂停」（视图不提供该筛选入口）', () => {
        expect(TASK_FILTER_OPTIONS.map(o => o.value)).toEqual(['all', 'running', 'pending', 'completed', 'failed', 'cancelled']);
        expect(TASK_FILTER_OPTIONS.map(o => o.label)).toEqual(['全部', '运行中', '等待中', '已完成', '失败', '已取消']);
    });

    it('all 返回全部（含 paused）', () => {
        expect(filterTasks(list, 'all')).toHaveLength(6);
    });

    it('按状态筛选', () => {
        expect(filterTasks(list, 'running').map(t => t.id)).toEqual(['a']);
        expect(filterTasks(list, 'cancelled').map(t => t.id)).toEqual(['e']);
        expect(filterTasks(list, 'paused').map(t => t.id)).toEqual(['f']);
    });

    it('不改原数组', () => {
        const snapshot = list.map(t => t.id);
        filterTasks(list, 'running');
        expect(list.map(t => t.id)).toEqual(snapshot);
    });

    it('按创建时间降序（最新在前）', () => {
        expect(sortTasksByCreatedDesc(list).map(t => t.id)).toEqual(['f', 'c', 'e', 'a', 'd', 'b']);
    });

    it('先筛后排', () => {
        expect(filterAndSortTasks(list, 'all').map(t => t.createdAt)).toEqual([6, 5, 4, 3, 2, 1]);
    });

    it('空输入返回空数组', () => {
        expect(filterTasks([], 'all')).toEqual([]);
        expect(filterAndSortTasks([], 'running')).toEqual([]);
    });
});

describe('resolveTaskStatusTone — 6 档中映射 4 档语义色', () => {
    it('四档语义', () => {
        expect(resolveTaskStatusTone('completed')).toBe('success');
        expect(resolveTaskStatusTone('running')).toBe('info');
        expect(resolveTaskStatusTone('failed')).toBe('danger');
        expect(resolveTaskStatusTone('pending')).toBe('warning');
    });

    it('cancelled / paused / 未知落回 muted', () => {
        expect(resolveTaskStatusTone('cancelled')).toBe('muted');
        expect(resolveTaskStatusTone('paused')).toBe('muted');
        expect(resolveTaskStatusTone('weird')).toBe('muted');
    });
});

describe('computeTaskStats — 六张统计卡', () => {
    it('顺序、文案与计数', () => {
        const stats = computeTaskStats([
            task({ status: 'running' }), task({ status: 'running' }),
            task({ status: 'pending' }),
            task({ status: 'completed' }),
            task({ status: 'failed' }),
            task({ status: 'cancelled' }),
        ]);
        expect(stats.map(s => s.label)).toEqual(['总任务数', '运行中', '等待中', '已完成', '失败', '已取消']);
        expect(stats.map(s => s.value)).toEqual([6, 2, 1, 1, 1, 1]);
    });

    it('配色固定', () => {
        const stats = computeTaskStats([]);
        expect(stats.map(s => s.color)).toEqual([
            'var(--interactive-accent)', '#3b82f6', '#f59e0b', '#2ecc71', '#e74c3c', '#9ca3af',
        ]);
        expect(stats.map(s => s.value)).toEqual([0, 0, 0, 0, 0, 0]);
    });
});

describe('批量操作集合 — 取消与删除必须不同（误操作防线）', () => {
    const list: BreakdownTask[] = [
        task({ id: 'run', status: 'running' }),
        task({ id: 'pen', status: 'pending' }),
        task({ id: 'done', status: 'completed' }),
        task({ id: 'fail', status: 'failed' }),
        task({ id: 'canc', status: 'cancelled' }),
        task({ id: 'paus', status: 'paused' }),
    ];
    const allSelected = new Set(list.map(t => t.id));

    it('批量取消只挑 running | pending', () => {
        expect(selectSelectedCancellable(list, allSelected).map(t => t.id)).toEqual(['run', 'pen']);
    });

    it('批量删除只挑 completed | failed | cancelled', () => {
        expect(selectSelectedDeletable(list, allSelected).map(t => t.id)).toEqual(['done', 'fail', 'canc']);
    });

    it('两个集合没有交集（不可混用）', () => {
        const cancellable = new Set(selectSelectedCancellable(list, allSelected).map(t => t.id));
        const deletable = selectSelectedDeletable(list, allSelected).map(t => t.id);
        expect(deletable.some(id => cancellable.has(id))).toBe(false);
    });

    it('只统计被选中的任务', () => {
        const onlyDoneSelected = new Set(['done']);
        expect(selectSelectedCancellable(list, onlyDoneSelected)).toEqual([]);
        expect(selectSelectedDeletable(list, onlyDoneSelected).map(t => t.id)).toEqual(['done']);
    });

    it('paused 既不可批量取消也不可批量删除（保守口径）', () => {
        const pausedOnly = new Set(['paus']);
        expect(selectSelectedCancellable(list, pausedOnly)).toEqual([]);
        expect(selectSelectedDeletable(list, pausedOnly)).toEqual([]);
    });

    it('一键全部取消：不受选中影响，只收 running | pending', () => {
        expect(selectActiveTasks(list).map(t => t.id)).toEqual(['run', 'pen']);
    });

    it('空选中集合返回空', () => {
        expect(selectSelectedCancellable(list, new Set())).toEqual([]);
        expect(selectSelectedDeletable(list, new Set())).toEqual([]);
    });
});

describe('全选判定与文案', () => {
    it('已选数量等于筛选结果数量即视为全选', () => {
        expect(isAllFilteredSelected(3, 3)).toBe(true);
        expect(isAllFilteredSelected(2, 3)).toBe(false);
        expect(isAllFilteredSelected(0, 0)).toBe(true);
    });

    it('已选文案格式', () => {
        expect(formatSelectionLabel(2, 5)).toBe('已选 2 / 5 项');
        expect(formatSelectionLabel(0, 0)).toBe('已选 0 / 0 项');
    });
});

describe('resolveTaskRowActions — 每行按钮集合', () => {
    it('failed → 重试 + 删除 + 查看', () => {
        expect(resolveTaskRowActions('failed')).toEqual(['retry', 'delete', 'view-book']);
    });

    it('running / pending → 取消 + 查看（无删除）', () => {
        expect(resolveTaskRowActions('running')).toEqual(['cancel', 'view-book']);
        expect(resolveTaskRowActions('pending')).toEqual(['cancel', 'view-book']);
    });

    it('completed / cancelled → 删除 + 查看', () => {
        expect(resolveTaskRowActions('completed')).toEqual(['delete', 'view-book']);
        expect(resolveTaskRowActions('cancelled')).toEqual(['delete', 'view-book']);
    });

    it('paused 与未知状态只有查看（保守：不提供取消/删除入口）', () => {
        expect(resolveTaskRowActions('paused')).toEqual(['view-book']);
        expect(resolveTaskRowActions('weird')).toEqual(['view-book']);
    });

    it('任何状态都有「查看书籍」', () => {
        for (const status of ['running', 'pending', 'completed', 'failed', 'cancelled', 'paused', 'x']) {
            expect(resolveTaskRowActions(status)).toContain('view-book');
        }
    });
});

describe('任务卡区块显隐', () => {
    it('进度条：仅 running|pending 且有 emitter 状态', () => {
        expect(shouldShowTaskProgress('running', true)).toBe(true);
        expect(shouldShowTaskProgress('pending', true)).toBe(true);
        expect(shouldShowTaskProgress('running', false)).toBe(false);
        expect(shouldShowTaskProgress('completed', true)).toBe(false);
        expect(shouldShowTaskProgress('cancelled', true)).toBe(false);
    });

    it('消息条：running|pending 且有消息', () => {
        expect(shouldShowTaskMessage('running', '正在拆解')).toBe(true);
        expect(shouldShowTaskMessage('pending', '排队中')).toBe(true);
        expect(shouldShowTaskMessage('running', '')).toBe(false);
        expect(shouldShowTaskMessage('completed', '完成')).toBe(false);
    });

    it('耗时/剩余行：仅 running', () => {
        expect(shouldShowTaskTiming('running', true)).toBe(true);
        expect(shouldShowTaskTiming('pending', true)).toBe(false);
        expect(shouldShowTaskTiming('running', false)).toBe(false);
    });

    it('错误信息：仅 failed 且有 error', () => {
        expect(shouldShowTaskError('failed', 'boom')).toBe(true);
        expect(shouldShowTaskError('failed', '')).toBe(false);
        expect(shouldShowTaskError('completed', 'boom')).toBe(false);
    });
});

describe('格式化与禁用态', () => {
    it('维度拼接用「、」，空列表给空串', () => {
        const labels = { character: '人物', foreshadow: '伏笔', technique: '技巧' } as never;
        expect(formatTaskDimensions(['character', 'foreshadow'] as never, labels)).toBe('人物、伏笔');
        expect(formatTaskDimensions([], labels)).toBe('');
        expect(formatTaskDimensions(undefined, labels)).toBe('');
    });

    it('进度百分比四舍五入', () => {
        expect(formatTaskProgressPercent(42)).toBe('42%');
        expect(formatTaskProgressPercent(42.4)).toBe('42%');
        expect(formatTaskProgressPercent(42.6)).toBe('43%');
        expect(formatTaskProgressPercent(0)).toBe('0%');
        expect(formatTaskProgressPercent(100)).toBe('100%');
    });

    it('禁用态不透明度与光标', () => {
        expect(disabledOpacity(true)).toBe('1');
        expect(disabledOpacity(false)).toBe('0.5');
        expect(disabledCursor(true)).toBe('pointer');
        expect(disabledCursor(false)).toBe('not-allowed');
    });
});

describe('TaskFilterType 与视图本地类型对齐', () => {
    it('视图下拉的 6 个值都在模块类型内', () => {
        const viewLocal = ['all', 'running', 'pending', 'completed', 'failed', 'cancelled'];
        for (const value of viewLocal) {
            expect(() => filterTasks([], value as TaskFilterType)).not.toThrow();
        }
    });
});
