/**
 * plan-spec-tools.ts — plan / spec 相关 Agent 工具
 *
 * write_spec / write_plan：落盘规格与计划
 * read_plan：读取最新计划与步骤状态
 */

import type { HarnessTool } from './harness-types';
import type { PlanSpecService } from '@/services/plan-spec-service';
import { stepsFromText } from '@/shared/plan-spec-model';

/**
 * 创建 plan/spec 工具集。
 *
 * @param getService - 取服务（懒加载，避免装配期 IO）
 * @param getProject - 取当前项目
 * @returns 工具数组
 */
export function createPlanSpecTools(
    getService: () => PlanSpecService | null,
    getProject: () => string,
): HarnessTool[] {
    return [
        {
            name: 'write_spec',
            kind: 'write-setting',
            description: '写入规格文档（需求背景 / 约束 / 验收标准），落盘到项目 04-项目总控/spec/。用户提出明确需求时先写规格，再写计划。',
            parameters: {
                title: { type: 'string', description: '规格标题', required: true },
                background: { type: 'string', description: '需求背景' },
                constraints: { type: 'string', description: '约束（分号或换行分隔）' },
                acceptance: { type: 'string', description: '验收标准（分号或换行分隔）' },
            },
            required: ['title'],
            sideEffect: 'write',
            timeoutMs: 15_000,
            execute: async (args) => {
                const service = getService();
                const project = getProject();
                if (!service) return { ok: false, content: '当前环境不支持写入规格' };
                if (!project) return { ok: false, content: '请先打开一个项目' };
                const split = (value: unknown): string[] => String(value ?? '')
                    .split(/[\n；;]+/).map(item => item.trim()).filter(Boolean);
                const result = await service.saveSpec(project, {
                    title: String(args.title || '').trim(),
                    background: String(args.background ?? '').trim(),
                    constraints: split(args.constraints),
                    acceptance: split(args.acceptance),
                });
                return { ok: true, content: `规格已保存：${result.path}`, data: { path: result.path } };
            },
        },
        {
            name: 'write_plan',
            kind: 'write-setting',
            description: '写入计划文档（步骤 + 验收），落盘到项目 04-项目总控/plan/。步骤按换行/分号拆分；后续每完成一步要更新计划。',
            parameters: {
                title: { type: 'string', description: '计划标题', required: true },
                steps: { type: 'string', description: '步骤（换行或分号分隔）', required: true },
            },
            required: ['title', 'steps'],
            sideEffect: 'write',
            timeoutMs: 15_000,
            execute: async (args) => {
                const service = getService();
                const project = getProject();
                if (!service) return { ok: false, content: '当前环境不支持写入计划' };
                if (!project) return { ok: false, content: '请先打开一个项目' };
                const steps = stepsFromText(String(args.steps ?? ''));
                if (steps.length === 0) return { ok: false, content: '步骤为空，请按换行/分号列出至少一步' };
                const result = await service.savePlan(project, { title: String(args.title || '').trim(), steps });
                return { ok: true, content: `计划已保存：${result.path}（${steps.length} 步）`, data: { path: result.path, steps: steps.length } };
            },
        },
        {
            name: 'read_plan',
            kind: 'read',
            description: '读取项目最新的计划与步骤状态（已完成/进行中/待办）。',
            parameters: {},
            required: [],
            sideEffect: 'none',
            timeoutMs: 10_000,
            execute: async () => {
                const service = getService();
                const project = getProject();
                if (!service) return { ok: false, content: '当前环境不支持读取计划' };
                if (!project) return { ok: false, content: '请先打开一个项目' };
                const latest = await service.readLatestPlan(project);
                if (!latest) return { ok: true, content: '还没有计划。需要时用 write_plan 创建。' };
                const marks = { done: '[已完成]', in_progress: '[进行中]', pending: '[ ]' } as const;
                const lines = latest.plan.steps.map((step, index) => `${index + 1}. ${marks[step.status]} ${step.step}`);
                return {
                    ok: true,
                    content: `【${latest.path}】\n${lines.join('\n') || '（无步骤）'}`,
                    data: { path: latest.path, steps: latest.plan.steps.length },
                };
            },
        },
    ];
}
