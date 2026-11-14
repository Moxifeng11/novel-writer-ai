/**
 * plan-spec-model.ts — 计划（plan）与规格（spec）文档模型（纯函数）
 *
 * 两者都是 Markdown 落盘：
 * - spec：需求 / 约束 / 验收标准（做什么）
 * - plan：步骤 + 状态 + 验收（怎么做，引用 spec）
 */

/** 计划步骤状态 */
export type PlanStepStatus = 'pending' | 'in_progress' | 'done';

/** 计划步骤 */
export interface PlanStepItem {
    /** 步骤描述 */
    step: string;
    /** 状态 */
    status: PlanStepStatus;
    /** 验收标准 */
    accept?: string;
}

/** 规格文档 */
export interface SpecDocument {
    title: string;
    /** 需求背景 */
    background: string;
    /** 约束 */
    constraints: string[];
    /** 验收标准 */
    acceptance: string[];
}

/** 计划文档 */
export interface PlanDocument {
    title: string;
    /** 关联的规格文件路径（可选） */
    specPath?: string;
    steps: PlanStepItem[];
}

/** 状态中文名 */
export const PLAN_STEP_LABELS: Record<PlanStepStatus, string> = {
    pending: '[ ]',
    in_progress: '[进行中]',
    done: '[已完成]',
};

/**
 * 渲染规格文档为 Markdown。
 *
 * @param spec - 规格
 * @returns Markdown 文本
 */
export function renderSpec(spec: SpecDocument): string {
    const lines = [`# 规格：${spec.title}`, ''];
    if (spec.background.trim()) {
        lines.push('## 需求背景', '', spec.background.trim(), '');
    }
    if (spec.constraints.length > 0) {
        lines.push('## 约束', '', ...spec.constraints.map(item => `- ${item}`), '');
    }
    if (spec.acceptance.length > 0) {
        lines.push('## 验收标准', '', ...spec.acceptance.map((item, index) => `${index + 1}. ${item}`), '');
    }
    return lines.join('\n');
}

/**
 * 渲染计划文档为 Markdown。
 *
 * @param plan - 计划
 * @returns Markdown 文本
 */
export function renderPlan(plan: PlanDocument): string {
    const lines = [`# 计划：${plan.title}`, ''];
    if (plan.specPath) lines.push(`> 关联规格：${plan.specPath}`, '');
    if (plan.steps.length === 0) {
        lines.push('（还没有步骤）');
    } else {
        for (const [index, step] of plan.steps.entries()) {
            lines.push(`${index + 1}. ${PLAN_STEP_LABELS[step.status]} ${step.step}${step.accept ? `（验收：${step.accept}）` : ''}`);
        }
    }
    return `${lines.join('\n')}\n`;
}

/**
 * 从计划 Markdown 解析步骤。
 *
 * @param markdown - 计划文本
 * @returns 步骤数组
 */
export function parsePlanSteps(markdown: string): PlanStepItem[] {
    const steps: PlanStepItem[] = [];
    for (const line of String(markdown ?? '').split('\n')) {
        const match = line.match(/^\s*\d+\.\s*(\[[^\]]*\])\s*(.+)$/);
        if (!match) continue;
        const mark = match[1];
        const rest = match[2].trim();
        const acceptMatch = rest.match(/（验收：(.+)）$/);
        steps.push({
            status: mark.includes('已完成') ? 'done' : mark.includes('进行中') ? 'in_progress' : 'pending',
            step: acceptMatch ? rest.slice(0, acceptMatch.index).trim() : rest,
            ...(acceptMatch ? { accept: acceptMatch[1].trim() } : {}),
        });
    }
    return steps;
}

/**
 * 由一段自然语言生成初始步骤（按行/分号拆分）。
 *
 * @param text - 用户描述
 * @returns 步骤
 */
export function stepsFromText(text: string): PlanStepItem[] {
    return String(text ?? '')
        .split(/[\n；;]+/)
        .map(line => line.replace(/^\s*[-*\d.、]+\s*/, '').trim())
        .filter(Boolean)
        .slice(0, 20)
        .map(step => ({ step, status: 'pending' as const }));
}

/**
 * 计划完成度。
 *
 * @param plan - 计划
 * @returns { done, total }
 */
export function planProgress(plan: PlanDocument): { done: number; total: number } {
    return {
        done: plan.steps.filter(step => step.status === 'done').length,
        total: plan.steps.length,
    };
}
