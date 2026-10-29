/**
 * creation-plan.ts — 创作计划（吸收 dsh plan-mode「计划呈现→审阅」与 todo 步骤追踪）
 *
 * Agent 在多步创作任务（新建→大纲→章节→质检→导出）中通过 update_plan 工具
 * 维护一份有序步骤清单；工作台左栏实时渲染。纯函数 + 纯状态，不依赖 Obsidian。
 */

export type PlanStepStatus = 'pending' | 'in_progress' | 'done';

export interface PlanStep {
    step: string;
    status: PlanStepStatus;
}

export const PLAN_STEP_STATUSES: PlanStepStatus[] = ['pending', 'in_progress', 'done'];

/** 校验并规整模型提交的步骤数组；非法条目剔除，最多保留 8 步 */
export function parsePlanSteps(raw: unknown): PlanStep[] | null {
    if (!Array.isArray(raw)) return null;
    const steps: PlanStep[] = [];
    for (const item of raw) {
        if (!item || typeof item !== 'object') continue;
        const record = item as Record<string, unknown>;
        const step = typeof record.step === 'string' ? record.step.trim() : '';
        const status = typeof record.status === 'string' ? record.status.trim() : '';
        if (!step) continue;
        steps.push({
            step: step.slice(0, 80),
            status: (PLAN_STEP_STATUSES as string[]).includes(status) ? status as PlanStepStatus : 'pending',
        });
        if (steps.length >= 8) break;
    }
    return steps.length > 0 ? steps : null;
}

/** 渲染给模型看的计划文本（系统提示词「创作计划」段） */
export function formatPlanForPrompt(steps: PlanStep[]): string {
    if (steps.length === 0) return '（尚未建立创作计划）';
    const marks: Record<PlanStepStatus, string> = { done: '[已完成]', in_progress: '[进行中]', pending: '[ ]' };
    return steps.map((step, index) => `${index + 1}. ${marks[step.status]} ${step.step}`).join('\n');
}

/** 渲染给 UI 的单行摘要（工具调用行用） */
export function summarizePlanUpdate(steps: PlanStep[]): string {
    const done = steps.filter(step => step.status === 'done').length;
    const inProgress = steps.find(step => step.status === 'in_progress');
    return `${done}/${steps.length} 完成${inProgress ? ` · 当前：${inProgress.step.slice(0, 24)}` : ''}`;
}
