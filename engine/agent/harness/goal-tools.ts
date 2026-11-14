/**
 * goal-tools.ts — goal 目标模式工具
 *
 * create_goal / update_goal / complete_goal / read_goal
 */

import type { HarnessTool } from './harness-types';
import type { GoalService } from '@/services/goal-service';
import { appendProgress, blockGoal, completeGoal, renderGoal, type GoalDefinition } from '@/shared/goal-model';

/**
 * 创建 goal 工具集。
 *
 * @param getService - 取服务
 * @param getProject - 取当前项目
 * @returns 工具数组
 */
export function createGoalTools(getService: () => GoalService | null, getProject: () => string): HarnessTool[] {
    return [
        {
            name: 'create_goal', kind: 'write-setting',
            description: '创建长任务目标（跨回合推进）。用户给出多步/长期任务时先建目标，之后用 update_goal 记进度。',
            parameters: {
                title: { type: 'string', description: '目标标题', required: true },
                objective: { type: 'string', description: '目标描述（完成标准）' },
            },
            required: ['title'], sideEffect: 'write', timeoutMs: 15_000,
            execute: async (args) => {
                const service = getService(); const project = getProject();
                if (!service) return { ok: false, content: '当前环境不支持目标模式' };
                if (!project) return { ok: false, content: '请先打开一个项目' };
                const goal = await service.create(project, String(args.title || ''), String(args.objective ?? ''));
                return { ok: true, content: `目标已创建：${goal.title}（${goal.id}）`, data: { id: goal.id } };
            },
        },
        {
            name: 'update_goal', kind: 'write-setting',
            description: '记录目标进展（附证据：章节版本/文件路径/提交号）。',
            parameters: {
                note: { type: 'string', description: '进展描述', required: true },
                evidence: { type: 'string', description: '证据' },
            },
            required: ['note'], sideEffect: 'write', timeoutMs: 15_000,
            execute: async (args) => {
                const service = getService(); const project = getProject();
                if (!service) return { ok: false, content: '当前环境不支持目标模式' };
                const goal = await service.readLatest(project);
                if (!goal) return { ok: false, content: '还没有目标，先用 create_goal 创建' };
                await service.save(project, appendProgress(goal, String(args.note || ''), args.evidence ? String(args.evidence) : undefined));
                return { ok: true, content: '进度已记录。' };
            },
        },
        {
            name: 'complete_goal', kind: 'write-setting',
            description: '完成目标（必须提供证据，不能空口宣告）。',
            parameters: { evidence: { type: 'string', description: '完成证据', required: true } },
            required: ['evidence'], sideEffect: 'write', timeoutMs: 15_000,
            execute: async (args) => {
                const service = getService(); const project = getProject();
                if (!service) return { ok: false, content: '当前环境不支持目标模式' };
                const goal = await service.readLatest(project);
                if (!goal) return { ok: false, content: '还没有目标' };
                const result = completeGoal(goal, String(args.evidence || ''));
                if (!result.goal) return { ok: false, content: result.error || '无法完成目标' };
                await service.save(project, result.goal);
                return { ok: true, content: '目标已完成并记录证据。' };
            },
        },
        {
            name: 'read_goal', kind: 'read',
            description: '读取当前目标与进度。',
            parameters: {}, required: [], sideEffect: 'none', timeoutMs: 10_000,
            execute: async () => {
                const service = getService(); const project = getProject();
                if (!service) return { ok: false, content: '当前环境不支持目标模式' };
                const goal = await service.readLatest(project);
                if (!goal) return { ok: true, content: '当前没有目标。' };
                return { ok: true, content: renderGoal(goal), data: { id: goal.id, status: goal.status } };
            },
        },
    ];
}

/**
 * 阻塞目标（供宿主调用）。
 *
 * @param goal - 目标
 * @param reason - 原因
 * @returns 新目标
 */
export function markGoalBlocked(goal: GoalDefinition, reason: string): GoalDefinition {
    return blockGoal(goal, reason);
}
