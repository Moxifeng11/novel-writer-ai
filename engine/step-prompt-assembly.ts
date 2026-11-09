/**
 * step-prompt-assembly.ts — 通用步骤的 prompt 装配
 *
 * 从 step-runner.ts 拆分而来：按本步实际模型取窗口预算，把大纲知识注入作为
 * 可丢弃的增强尾部，再做头尾截断。知识注入与预算解析由宿主提供，本模块只负责装配。
 */

import { fitPromptToContext } from '@/shared/prompt-budget';
import { estimateTokens } from '@/shared/token-estimator';
import { getBusinessThreshold } from '@/shared/thresholds';
import { withActiveInputBudget } from '@/shared/context-budget-policy';
import { createLogger } from '@/shared/logger';
import { ContextOverflowError, recoverOverflow, type ContextCompressionMode } from './context/overflow-recovery';
import type { StepRunCtx } from './step-definitions';

const log = createLogger('StepPromptAssembly');

/**
 * 从模板变量提取在场人物/场景关键词（抽取压缩的保留优先级）。
 *
 * @param vars - 模板变量
 * @returns 关键词
 */
function extractFocusTerms(vars?: Record<string, string>): string[] {
    const source = vars ?? {};
    const terms = new Set<string>();
    const protagonist = String(source.protagonistName ?? '').trim();
    if (protagonist && protagonist !== '主角') terms.add(protagonist);
    for (const line of String(source.allChars ?? '').split('\n')) {
        const match = line.match(/^\s*-\s*([^：:｜|]{2,12})[：:｜|]/);
        if (match) terms.add(match[1].trim());
    }
    const digest = String(source.sceneCardDigest ?? '').slice(0, 400);
    if (digest) terms.add(digest.slice(0, 20));
    return [...terms].filter(Boolean).slice(0, 12);
}

/**
 * StepPromptAssemblyHost 类型定义。
 */
export interface StepPromptAssemblyHost {
    /**
     * 大纲摘要步骤的知识注入（宿主内部完成画像读取与失败降级，非 outline 步骤不调用）
     *
     * @param ctx - 上下文
     * @returns 文本结果
     */
    loadOutlineKnowledge(ctx: StepRunCtx): Promise<string>;
    /**
     * 正文生成步骤的知识注入（文笔指纹；宿主内部完成画像读取与失败降级）
     *
     * @param ctx - 上下文
     * @returns 文本结果
     */
    loadBodyKnowledge(ctx: StepRunCtx): Promise<string>;
    /** 正文步骤的硬约束尾部（样章/对照），不允许被 extraTail 预算裁剪 */
    loadBodyKnowledgeParts?(ctx: StepRunCtx): Promise<{ extra: string; system: string }>;
    /**
     * 调用时关联查询（只补缺口；返回空文本表示无需注入）
     *
     * @param ctx - 上下文
     * @param stepKey - 当前步骤
     * @returns 关联文本与成本
     */
    loadAssociationContext?(ctx: StepRunCtx, stepKey: string): Promise<{ text: string; tokens: number; skipped?: string }>;
    /** 上下文压缩模式（默认 extractive） */
    compressionMode?: ContextCompressionMode;
    /** 溢出时的定向补检（只补缺口；返回空串表示无补充） */
    retrieveOverflowContext?(ctx: StepRunCtx, deficitTokens: number, focusTerms: string[]): Promise<string>;
    /**
     * 本步实际模型的窗口/输出上限（budget 由任务层给出时优先采用其 maxInput）
     *
     * @param model - 模型标识
     * @param budget - 预算
      * @returns StepBudgetLimits 实例
     */
    resolveStepBudgetLimits(model: string, budget?: StepBudgetHint): StepBudgetLimits;
}

/** 任务层已经算好的预算（按真实模型窗口 + 任务输出预留） */
export interface StepBudgetHint {
    maxInput?: number;
    maxContext?: number;
    maxOutput?: number;
}

/**
 * StepBudgetLimits 类型定义。
 */
export interface StepBudgetLimits {
    maxContext: number;
    maxOutput: number;
    /** 输入 token 预算：闸门用它，而不是 maxContext-maxOutput */
    maxInputTokens?: number;
}

/**
 * StepPromptAssemblyResult 类型定义。
 */
export interface StepPromptAssemblyResult {
    /** 经预算闸门处理后实际发送给模型的 system prompt */
    effectiveSystemPrompt: string;
    /** 经预算闸门处理后实际发送给模型的 user prompt */
    effectiveUserPrompt: string;
    /** 是否发生头尾截断（调用方负责给用户可见提示） */
    truncated: boolean;
    /** 知识注入是否因预算不足被整段丢弃 */
    droppedExtra: boolean;
    estimatedTokens: number;
    /** 分段裁剪时被整段丢弃/段内截断的段名（写进注入账本，用户可见） */
    droppedSections: string[];
    trimmedSections: string[];
    /** 本次实际生效的输入 token 预算 */
    maxInputTokens: number;
    /** 关键段缩完仍超预算 */
    overBudget: boolean;
    /** 关联查询注入的文本与 token（写入注入账本；空串表示未注入） */
    associationText?: string;
    associationTokens?: number;
    associationSkipped?: string;
    /** 预算恢复报告（压缩/补检/token），用于注入账本与面板 */
    contextBudgetReport?: string;
}

/**
 * assembleStepPrompt 函数。
 * @param host - 宿主元素
 * @param ctx - 上下文
 * @param stepKey - 步骤键
 * @param systemPrompt - 系统提示词
 * @param userPrompt - 用户提示词
 * @param stepModel - 步骤模型
 * @param budget - 预算
  * @returns StepPromptAssemblyResult 实例
 */
export async function assembleStepPrompt(
    host: StepPromptAssemblyHost,
    ctx: StepRunCtx,
    stepKey: string,
    systemPrompt: string,
    userPrompt: string,
    stepModel: string,
    budget?: StepBudgetHint,
): Promise<StepPromptAssemblyResult> {
    // 先算本步模型预算：知识注入与分段裁剪都读 activeContextQuotas，
    // 必须在注入之前把它设成「本步真实窗口」，否则会用上一次流程/默认 120K 的配额
    const stepLimits = host.resolveStepBudgetLimits(stepModel, budget);
    return withActiveInputBudget(stepLimits.maxInputTokens, async () => {
        let extraTail = '';
        let systemTail = '';
        let associationText = '';
        let associationTokens = 0;
        let associationSkipped: string | undefined;
        if (stepKey === 'outline') {
            extraTail = await host.loadOutlineKnowledge(ctx);
        } else if (stepKey === 'bodyGeneration') {
            if (host.loadBodyKnowledgeParts) {
                const parts = await host.loadBodyKnowledgeParts(ctx);
                extraTail = parts.extra;
                systemTail = parts.system;
            } else {
                extraTail = await host.loadBodyKnowledge(ctx);
            }
        }
        if (host.loadAssociationContext && ['bodyGeneration', 'qualityControl', 'analysisReport'].includes(stepKey)) {
            const association = await host.loadAssociationContext(ctx, stepKey);
            associationText = association.text;
            associationTokens = association.tokens;
            associationSkipped = association.skipped;
            if (associationText) {
                extraTail = [extraTail, associationText].filter(Boolean).join('\n\n');
            }
        }
        const effectiveSystemPrompt = systemTail
            ? `${systemPrompt}\n\n${systemTail}`
            : systemPrompt;

        // 预算恢复：先定向补检 + 抽取压缩，再交给分段预算闸门；绝不直接腰斩
        const focusTerms = extractFocusTerms(ctx.vars);
        let effectiveUserPrompt = userPrompt;
        let effectiveExtraTail = extraTail;
        let contextBudgetReport = '';
        const strictNoTruncation = ['bodyGeneration', 'qualityControl', 'analysisReport'].includes(stepKey);
        const inputBudget = stepLimits.maxInputTokens
            ?? Math.max(512, stepLimits.maxContext - stepLimits.maxOutput);
        const estimatedTotal = estimateTokens(effectiveSystemPrompt, stepModel)
            + estimateTokens(userPrompt, stepModel)
            + estimateTokens(extraTail, stepModel);
        if (estimatedTotal > inputBudget) {
            const retrieve = host.retrieveOverflowContext;
            const recovered = await recoverOverflow({
                system: effectiveSystemPrompt,
                user: userPrompt,
                extraTail,
                maxInputTokens: inputBudget,
                focusTerms,
                modelId: stepModel,
                mode: host.compressionMode,
                retrieve: retrieve
                    ? (deficit) => retrieve(ctx, deficit, focusTerms)
                    : undefined,
            });
            effectiveUserPrompt = recovered.user;
            effectiveExtraTail = recovered.extraTail;
            contextBudgetReport = recovered.report;
        }

        // prompt 长度校验：system + user + 知识注入一起算，超窗口时先丢注入再截断主体
        // 窗口必须按「本步实际模型」取：settings 是全局单值，本地小窗口模型下永不触发裁剪
        const fit = fitPromptToContext({
            systemPrompt: effectiveSystemPrompt,
            userPrompt: effectiveUserPrompt,
            extraTail: effectiveExtraTail,
            maxContext: stepLimits.maxContext,
            maxOutput: stepLimits.maxOutput,
            maxInputTokens: stepLimits.maxInputTokens,
            modelId: stepModel,
            headRatio: getBusinessThreshold('promptSplitRatio'),
            // 章节模板按【标题】分段：先丢低优先段，保住世界观/设定库/人物/大纲/Scene
            sectionAware: true,
        });

        if (strictNoTruncation && (fit.overBudget || fit.truncated)) {
            throw new ContextOverflowError(
                Math.max(1, fit.estimatedTokens - fit.maxInputTokens),
                fit.maxInputTokens,
                fit.droppedSections.length > 0 ? fit.droppedSections : ['未命名段落'],
            );
        }

        if (fit.droppedExtra) {
            log.warn(`[StepRunner] 上下文不足，已跳过知识注入（风格/节奏/题材）: ~${fit.estimatedTokens}t`);
        }
        if (fit.droppedSections.length > 0 || fit.trimmedSections.length > 0) {
            log.warn(
                `[StepRunner] prompt 超预算（~${fit.estimatedTokens}t / 预算 ${fit.maxInputTokens}t）：`
                + `丢弃 ${fit.droppedSections.join('、') || '无'}；截断 ${fit.trimmedSections.join('、') || '无'}`,
            );
        } else if (fit.truncated) {
            log.warn(`[StepRunner] prompt 过长，已保留头部+尾部，中间资料截断: ~${fit.estimatedTokens}t`);
        }

        return {
            effectiveSystemPrompt,
            effectiveUserPrompt: fit.user,
            truncated: fit.truncated,
            droppedExtra: fit.droppedExtra,
            estimatedTokens: fit.estimatedTokens,
            droppedSections: fit.droppedSections,
            trimmedSections: fit.trimmedSections,
            maxInputTokens: fit.maxInputTokens,
            overBudget: fit.overBudget,
            associationText,
            associationTokens,
            associationSkipped,
            contextBudgetReport,
        };
    });
}
