/**
 * ai-prompt-builder.ts — 章节正文 Prompt 构建
 * 从 ai-engine.ts 提取，独立于类实例
 */
import type { ChapterContext } from './ai-types';
import { PREV_SUMMARY_SLICE, TOKEN_SAFE_BUFFER } from '@/shared/thresholds';
import {
    BodyFormatContract, DEFAULT_BODY_FORMAT, describeBodyFormat,
} from '@/shared/body-format';
import { assemblePromptWithinBudget, type PromptSection } from '@/shared/prompt-budget';
import { recordBudgetSnapshot } from '@/shared/budget-telemetry';
import { estimateInputTokens } from '@/shared/token-estimator';

/**
 * 系统提示词（写作引导）
 *
 * @param ctx - 上下文
 * @param settings - 设置
 * @param bodyFormat - 正文格式
 * @param writingRules - 写作规则全文（唯一来源 RulesService；调用方负责读取）
 * @returns 文本结果
 *
 * @example
 * ```ts
 * const system = buildSystemPrompt(ctx, { minWordCount: 2000, maxWordCount: 4000 }, fmt, rules);
 * ```
 */
export function buildSystemPrompt(
    ctx: ChapterContext,
    settings: { minWordCount: number; maxWordCount: number },
    bodyFormat: BodyFormatContract = DEFAULT_BODY_FORMAT,
    writingRules = '',
): string {
    // v4.26：规则文本唯一来源是 RulesService（由调用方传入），这里不再内嵌第二份规则。
    const rulesBlock = writingRules.trim();

    let systemPrompt = `${lensDeclarationFallback(ctx)}
${rulesBlock ? `${rulesBlock}` : '【镜头引导】贴着主角写：他看到的你才写，他的内心如实记下，别人的心思只从动作与语气里流露。'}

${describeBodyFormat({ ...bodyFormat, allowTitle: true })}

【世界观】所在的是${ctx.worldType ? ` **${ctx.worldType}** ` : ''}题材世界；角色言行要符合世界观与设定库。

记住：你不是在写，你是在记。你是在记录主角刚刚经历的真实时刻。`;

    return systemPrompt;
}

/** 单一镜头声明（无场景卡时的兜底形态） */
function lensDeclarationFallback(_ctx: ChapterContext): string {
    const person = '主角';
    return `【本章镜头】视角人物：${person}——只写 ${person} 能看到、听到、感知到的信息；镜头不切换。`;
}

/**
 * 单章提示词长度上限。
 */
export interface ChapterPromptLimits {
    maxContext: number;
    maxOutput: number;
    modelId?: string;
}

/**
 * 单章提示词构建结果。
 */
export interface ChapterPromptResult {
    system: string;
    user: string;
    /** 知识注入因预算不足被整段丢弃 */
    droppedKnowledge: boolean;
    /** 知识注入被截断保留 */
    trimmedKnowledge: boolean;
    estimatedTokens: number;
}

/**
 * 章节正文 prompt 的唯一组装入口。
 *
 * 知识注入不能拼到 system 尾部：`callAI` 在窗口不足时从尾部截断，
 * 最先丢掉的恰好是输出约束与风格参考。这里把知识作为 user 中的
 * 可裁剪层（priority 25），正文任务主体作为必保尾部。
 * @param ctx - 上下文
 * @param settings - 设置
 * @param bodyFormat - 正文格式
 * @param knowledgeInjection - 知识注入
 * @param limits - 限制
 * @param writingRules - 写作规则全文（唯一来源 RulesService）
  * @returns ChapterPromptResult 实例
 *
 * @example
 * ```ts
 * const { system, user } = buildChapterPrompts(ctx, settings, fmt, knowledge, limits, rules);
 * ```
 */
export function buildChapterPrompts(
    ctx: ChapterContext,
    settings: { minWordCount: number; maxWordCount: number },
    bodyFormat: BodyFormatContract = DEFAULT_BODY_FORMAT,
    knowledgeInjection?: string,
    limits?: ChapterPromptLimits,
    writingRules = '',
): ChapterPromptResult {
    const system = buildSystemPrompt(ctx, settings, bodyFormat, writingRules);
    const user = buildUserPrompt(ctx, settings, bodyFormat);
    const knowledge = (knowledgeInjection || '').trim();
    const modelId = limits?.modelId || 'default';

    if (!knowledge || !limits || limits.maxContext <= 0) {
        return {
            system,
            user,
            droppedKnowledge: false,
            trimmedKnowledge: false,
            estimatedTokens: estimateInputTokens(system, user, modelId),
        };
    }

    const sections: PromptSection[] = [{
        key: 'knowledge.injection',
        text: knowledge,
        priority: 25,
        shrinkable: true,
    }];
    const maxInputTokens = Math.max(1, limits.maxContext - limits.maxOutput - TOKEN_SAFE_BUFFER);
    const result = assemblePromptWithinBudget({
        systemPrompt: system,
        sections,
        tailParts: [user],
        maxInputTokens,
        modelId,
    });
    recordBudgetSnapshot({
        source: 'chapter',
        model: modelId,
        inputTokens: result.estimatedTokens,
        maxInputTokens,
        droppedSections: result.droppedSections,
        trimmedSections: result.trimmedSections,
        overBudget: result.overBudget,
    });

    return {
        system: result.system,
        user: result.user,
        droppedKnowledge: result.droppedSections.includes('knowledge.injection'),
        trimmedKnowledge: result.trimmedSections.includes('knowledge.injection'),
        estimatedTokens: result.estimatedTokens,
    };
}

/**
 * 用户提示词（上下文拼接）
 *
 * @param ctx - 上下文
 * @param settings - 设置
 * @param bodyFormat - 正文格式
 * @returns 文本结果
 */
export function buildUserPrompt(
    ctx: ChapterContext,
    settings: { minWordCount: number },
    bodyFormat: BodyFormatContract = DEFAULT_BODY_FORMAT,
): string {
    let userContent = '';

    if (ctx.chapterPlan) {
        userContent += `【分卷规划】${ctx.chapterPlan.slice(0, 3000)}\n`;
    }
    if (ctx.infoPlan) {
        userContent += `【信息规划】${ctx.infoPlan.slice(0, 1000)}\n`;
    }
    if (ctx.previousChapters) {
        userContent += `【前文摘要】${ctx.previousChapters.slice(0, PREV_SUMMARY_SLICE)}\n`;
    }
    if (ctx.worldView) {
        userContent += `【世界观】${ctx.worldView.slice(0, 2000)}\n`;
    }
    if (ctx.settingLib) {
        userContent += `【设定库】${ctx.settingLib.slice(0, 2000)}\n`;
    }
    if (ctx.writingStyle) {
        userContent += `【文笔风格要求】${ctx.writingStyle.slice(0, 1500)}\n`;
    }
    // Rev 186：有「关联索引」时用它替代平铺的伏笔/时间线清单——
    // 关联索引已按章去重并与设定库/全书规划交叉，重复平铺只会浪费预算。
    if (ctx.storyLinkage) {
        userContent += `【关联索引】${ctx.storyLinkage.slice(0, 1800)}\n`;
    } else {
        if (ctx.unrevealedForeshadow) {
            userContent += `【未揭示伏笔】${ctx.unrevealedForeshadow.slice(0, 1000)}\n`;
        }
        if (ctx.timelineEvents) {
            userContent += `【时间线事件】${ctx.timelineEvents.slice(0, 500)}\n`;
        }
    }
    if (ctx.forcedReveal && ctx.forcedReveal.length > 0) {
        const revealedNames = ctx.forcedReveal.map(n => `- ${n}`).join('\n');
        userContent += `【本章必须揭示的伏笔】以下伏笔必须在本章正文中通过剧情/对话揭示：\n${revealedNames}\n请在正文中明确交代这些伏笔的结果。\n`;
    }
    if (ctx.outline) {
        userContent += `【本章大纲】${ctx.outline.slice(0, 800)}\n`;
    }
    if (ctx.characters) {
        userContent += `【人物状态】${ctx.characters.slice(0, 2000)}\n`;
    }

    userContent += `
请撰写第${ctx.chapterNumber}章正文，第一行写标题：# 第${ctx.chapterNumber}章 标题（标题 2-15 字），正文从下一行开始。

【最后指令】
${describeBodyFormat({ ...bodyFormat, allowTitle: true })}
- 标题必须完整：不能只写「# 第${ctx.chapterNumber}章」而没有章名
- 镜头贴着主角，只写他能感知的信息；其他角色的心思用动作与语气暗示
- 对话推动信息，人物行为符合核心动机
- ${ctx.forcedReveal && ctx.forcedReveal.length > 0 ? `本章优先揭示以下伏笔：${ctx.forcedReveal.join("、")}` : "有合适的机会就回收旧伏笔、埋下新伏笔；没有就不硬凑"}
- 首句自然承接上一章结束的场景，不重复上一章末尾的词语
- 时间跳跃在开头交代清楚

【输出前检查】
① 标题行是否完整（第几章 + 章名）
② 是否始终是同一个镜头，没有写镜头外的心声
③ 对话是否加了引号并独立成段`;

    return userContent;
}
