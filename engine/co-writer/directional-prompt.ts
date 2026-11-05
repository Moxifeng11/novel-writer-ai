/**
 * directional-prompt.ts — 方向性续写提示词（自 co-writer-engine.ts 抽出）
 *
 * 抽取前该方法直接读 `this.soulData / chapterBrief / snapshot / promptBuilder`；
 * 现在所有状态由调用方算好显式传入（灵魂注入、剧情目标、简报片段、writingRules、
 * PromptBuilder 实例与输入预算），本模块只做**纯文本装配**：
 *  - 有 PromptBuilder → 原样委托 `buildSuggestionPrompt`（参数逐个透传）；
 *  - 无 PromptBuilder → 走兜底模板（第三人称限知 + 活人感规则 + bodyFormat 契约）。
 * 兜底模板与抽取前逐字一致；兜底不消费指纹/知识/剧情目标（与旧行为一致）。
 */
import type { PromptBuilder } from '@/engine/prompt-builder';
import type { SuggestionDirection } from '@/shared/types';
import { describeBodyFormat, deriveBodyFormat } from '@/shared/body-format';

/** buildDirectionalPrompt 的显式入参（状态访问留在引擎侧）。 */
export interface DirectionalPromptInput {
    /** 已写正文（兜底取末尾 800 字；<10 字视为本章开头） */
    precedingText: string;
    /** 写作方向 */
    direction: SuggestionDirection;
    /** 光标处特别指令（可空串） */
    cursorHint: string;
    /** 指纹片段（仅 PromptBuilder 路径消费） */
    fingerprintParts?: string[];
    /** 知识片段（仅 PromptBuilder 路径消费） */
    knowledgeParts?: string[];
    /** 知识注入段（仅 PromptBuilder 路径消费） */
    knowledgeInjection?: string;
    /** 主角灵魂注入（引擎由 soulData 计算，可为空串） */
    soulInjection: string;
    /** 剧情目标提示（引擎由 plotNodes / 章节简报计算，可为空串） */
    plotTarget: string;
    /** 章节简报片段（buildBriefPromptParts 结果） */
    briefParts: string[];
    /** 快照 writingRules（兜底路径推导正文格式契约） */
    writingRules: string;
    /** 注入的 PromptBuilder；null 时走兜底模板 */
    promptBuilder: PromptBuilder | null;
    /** 输入预算（引擎 getCoWriteInputBudget 结果） */
    inputBudget?: { maxInputTokens: number; modelId?: string };
}

/**
 * 构建方向性续写提示词。
 *
 * @param input - 正文、方向与全部上下文片段
 * @returns system / user 两段提示词
 *
 * @example
 * ```ts
 * const prompt = buildDirectionalPrompt({
 *     precedingText, direction, cursorHint,
 *     soulInjection, plotTarget, briefParts,
 *     writingRules: snapshot?.writingRules || '',
 *     promptBuilder: null,
 * });
 * ```
 */
export function buildDirectionalPrompt(input: DirectionalPromptInput): { system: string; user: string } {
    const {
        precedingText,
        direction,
        cursorHint,
        fingerprintParts,
        knowledgeParts,
        knowledgeInjection,
        soulInjection,
        plotTarget,
        briefParts,
        writingRules,
        promptBuilder,
        inputBudget,
    } = input;

    if (promptBuilder) {
        return promptBuilder.buildSuggestionPrompt(
            precedingText,
            direction,
            cursorHint,
            soulInjection,
            plotTarget,
            fingerprintParts,
            knowledgeParts,
            knowledgeInjection,
            briefParts,
            inputBudget
        );
    }

    const dirPrompt = '请根据当前写作方向自然地续写一段。';
    // 兜底 prompt 也必须走同一份格式契约，禁止在这里另写 Tab / 空行规则
    const bodyFormat = describeBodyFormat(deriveBodyFormat(writingRules || ''));
    const systemPrompt = [
        '你是一位第三人称限知视角的叙事者。你不是在"写小说"，你是在用镜头紧贴主角，把他/她正在经历的一切原样呈现出来。',
        '',
        '【叙事视角规则】',
        '- 严格第三人称限知：只写主角能看到、听到、摸到、感受到的东西。',
        '- 不跳其他角色的内心，不写上帝视角的全局解释。',
        '- 严禁使用第一人称「我」叙事。所有描写必须是第三人称（他/她/它），这是硬性规则，不可违反。',
        '- 心理活动优先用自由间接引语；需要写清楚时可以用“他心想”“他觉得”，不要每段都用。',
        '- 认知从主角的感官和处境出发；叙述者可以有人格，但不要跳到别人的脑子里。',
        '',
        '【怎么写才像活人写的】',
        '- 事情在发生，不是在被讲述；但允许解释、交代和过渡，不要把必要的来龙去脉都藏掉。',
        '- 情绪可以直接写，也可以藏在动作里；不要每段都逼着自己“藏”。',
        '- 不用排比，不用华丽辞藻堆砌。活人眼里的世界没那么多修辞。',
        '- 一个自然段 2–6 句，80–220 字；不要一句一段，不要把同一个动作拆成好几行。',
        '- 对话和说话人的动作、神态放在同一段；连续对话按说话人分段。',
        '- 允许口语、停顿、打断、答非所问和一点废话。',
        '- “然后”“接着”“就在这时”不是禁词；该过渡时用一句带过，比硬跳更自然。',
        '',
        '【节奏补充】',
        '- 句长平均 20–30 字，长句和短句交替；短句是调味，不是主菜。',
        '- 每个场景 2–3 处关键身体感觉即可，不要逐段打卡。',
        '',
        bodyFormat,
    ].filter(Boolean).join('\n');

    const userParts: string[] = [
        ...(briefParts.length > 0 ? briefParts : []),
        '【已写内容】',
        precedingText.slice(-800),
        '',
        '【写作方向】',
        dirPrompt
    ].filter(Boolean);

    if (cursorHint) {
        userParts.push('', '【特别指令】', cursorHint);
    }

    userParts.push('', (precedingText || '').trim().length < 10
        ? '这是本章的开头。请根据本章大纲和设定，开始写一个自然段（80–220 字，2–6 句）。只输出正文，不要标注、不要解释、不要写标题。'
        : '请自然地续写一个自然段（80–220 字，2–6 句），不要一句一段。只输出正文，不要标注、不要解释、不要写标题。');
    return { system: systemPrompt, user: userParts.join('\n') };
}
