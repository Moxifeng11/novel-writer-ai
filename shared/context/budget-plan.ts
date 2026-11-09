/**
 * budget-plan.ts — 上下文预算计划（纯函数）
 *
 * 把 prompt 段落分成 required / optional，计算当前占用与缺口；
 * 溢出恢复按这份计划先压缩 optional，再在必要时压缩 required 的可缩段，
 * 而不是直接把整段文本腰斩。
 */
import { estimateTokens } from '@/shared/token-estimator';

/** 段落角色 */
export type ContextSectionRole = 'required' | 'optional';

/** 段落计划 */
export interface ContextSectionPlan {
    key: string;
    role: ContextSectionRole;
    /** 越大越重要 */
    priority: number;
    /** 该段至少要保留的 token（required 段不可低于它） */
    minTokens: number;
    /** 当前 token */
    currentTokens: number;
    /** 是否允许段内压缩 */
    shrinkable: boolean;
    text: string;
}

/** 预算计划结果 */
export interface ContextBudgetPlan {
    sections: ContextSectionPlan[];
    maxInputTokens: number;
    totalTokens: number;
    /** 需要释放的 token */
    deficit: number;
    requiredTokens: number;
    optionalTokens: number;
}

/**
 * 从文本段落构建计划。
 *
 * @param sections - 段落
 * @param maxInputTokens - 输入预算
 * @param modelId - 模型
 * @returns 计划
 */
export function planContextBudget(
    sections: Array<Omit<ContextSectionPlan, 'currentTokens'> & { currentTokens?: number }>,
    maxInputTokens: number,
    modelId = 'default',
): ContextBudgetPlan {
    const planned: ContextSectionPlan[] = sections.map((section) => ({
        ...section,
        currentTokens: section.currentTokens ?? estimateTokens(section.text, modelId),
    }));
    const totalTokens = planned.reduce((sum, section) => sum + section.currentTokens, 0);
    const requiredTokens = planned
        .filter((section) => section.role === 'required')
        .reduce((sum, section) => sum + section.currentTokens, 0);
    const optionalTokens = totalTokens - requiredTokens;
    return {
        sections: planned,
        maxInputTokens,
        totalTokens,
        deficit: Math.max(0, totalTokens - maxInputTokens),
        requiredTokens,
        optionalTokens,
    };
}

/**
 * 按压缩结果重算计划。
 *
 * @param plan - 原计划
 * @param compressed - key → 新文本
 * @param modelId - 模型
 * @returns 新计划
 */
export function applyCompression(
    plan: ContextBudgetPlan,
    compressed: Map<string, string>,
    modelId = 'default',
): ContextBudgetPlan {
    const sections = plan.sections.map((section) => {
        const text = compressed.get(section.key);
        if (text === undefined) return section;
        return {
            ...section,
            text,
            currentTokens: estimateTokens(text, modelId),
        };
    });
    const totalTokens = sections.reduce((sum, section) => sum + section.currentTokens, 0);
    const requiredTokens = sections
        .filter((section) => section.role === 'required')
        .reduce((sum, section) => sum + section.currentTokens, 0);
    return {
        ...plan,
        sections,
        totalTokens,
        requiredTokens,
        optionalTokens: totalTokens - requiredTokens,
        deficit: Math.max(0, totalTokens - plan.maxInputTokens),
    };
}

/**
 * 按优先级排序（先压缩低优先级 optional）。
 *
 * @param plan - 计划
 * @returns 排序后的段落
 */
export function compressionOrder(plan: ContextBudgetPlan): ContextSectionPlan[] {
    return [...plan.sections].sort((a, b) => {
        if (a.role !== b.role) return a.role === 'optional' ? -1 : 1;
        return a.priority - b.priority;
    });
}
