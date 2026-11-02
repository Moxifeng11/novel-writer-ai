/**
 * llm-prompts.ts — LLM 增强拆解的提示词模板
 *
 * 为 7 个维度（personality/abilities/goals/style/rhythm/foreshadow/genre）
 * 提供结构化输出的提示词。每个维度的提示词要求 LLM 返回 JSON，
 * 便于 enhanceWithLLM 解析后合并到纯统计结果中。
 *
 * 设计原则：
 * - 每个提示词要求 LLM 仅输出 JSON（禁止解释性文字）
 * - 提示词包含"已有统计结果"字段，让 LLM 做增量提炼而非全量重写
 * - 提示词强制 LLM 在不确定时返回空数组/空字符串，避免编造
 */

import type { GenreConfig } from './genre/types';

/** 维度名枚举（与 LLMEnhanceContext.dimension 对齐） */
export type LLMEnhanceDimension =
    | 'personality'
    | 'abilities'
    | 'goals'
    | 'style'
    | 'rhythm'
    | 'foreshadow'
    | 'genre';

/** 角色校验结果 */
export interface CharacterVerifyResult {
    name: string;
    isCharacter: number;
    reason: string;
}

/** 称号/别名抽取结果 */
export interface TitleAliasResult {
    sourceName: string;
    targetName: string;
    reason: string;
    confidence: number;
}

/** 提示词构建结果 */
export interface LLMPromptPair {
    systemPrompt: string;
    userPrompt: string;
}

/** 通用系统提示词前缀，要求 JSON 输出 */
const JSON_SYSTEM_PREFIX = `你是一名专业的小说文本分析师。请根据给定的小说片段和已有的统计结果，进行语义提炼。
严格要求：
1. 只输出一个 JSON 对象，不要输出任何解释性文字、Markdown 代码块或前后缀
2. 不确定时返回空数组或空字符串，禁止编造
3. 提炼的内容必须基于给定文本，不要引入外部知识
4. 输出必须是合法的 JSON`;

/**
 * 构建 personality 维度提示词（性格标签提炼）
 * 输出结构：{ personality: string[], evidence: string[] }
 * @param text - 文本内容
 * @param _genreConfig - 题材配置
 * @param existing - 已有
  * @returns LLMPromptPair 实例
 */
function buildPersonalityPrompt(text: string, _genreConfig?: GenreConfig, existing?: unknown): LLMPromptPair {
    return {
        systemPrompt: `${JSON_SYSTEM_PREFIX}

任务：从小说片段中提炼主角的性格标签。
输出 JSON 结构：{"personality": string[], "evidence": string[]}
- personality: 3-8 个性格标签（如"冷静"、"果断"、"重情义"），简洁的二字或四字词组
- evidence: 对应性格标签的文本证据片段（每个不超过 30 字）`,
        userPrompt: `小说片段：
${text}

已有统计结果（参考，可能为空）：
${existing ? JSON.stringify(existing).slice(0, 800) : '（无）'}

请输出 JSON：`,
    };
}

/**
 * 构建 abilities 维度提示词（能力提炼）
 * 输出结构：{ abilities: string[], categories: string[] }
 * @param text - 文本内容
 * @param _genreConfig - 题材配置
 * @param existing - 已有
  * @returns LLMPromptPair 实例
 */
function buildAbilitiesPrompt(text: string, _genreConfig?: GenreConfig, existing?: unknown): LLMPromptPair {
    return {
        systemPrompt: `${JSON_SYSTEM_PREFIX}

任务：从小说片段中提炼人物的能力体系。
输出 JSON 结构：{"abilities": string[], "categories": string[]}
- abilities: 5-15 个具体能力名（如"剑术"、"火系法术"、"读心术"），基于文本证据
- categories: 能力所属大类（如"武技"、"法术"、"心智"），2-5 个`,
        userPrompt: `小说片段：
${text}

已有统计结果（参考，可能为空）：
${existing ? JSON.stringify(existing).slice(0, 800) : '（无）'}

请输出 JSON：`,
    };
}

/**
 * 构建 goals 维度提示词（目标描述）
 * 输出结构：{ shortTermGoals: string[], longTermGoal: string }
 * @param text - 文本内容
 * @param _genreConfig - 题材配置
 * @param existing - 已有
  * @returns LLMPromptPair 实例
 */
function buildGoalsPrompt(text: string, _genreConfig?: GenreConfig, existing?: unknown): LLMPromptPair {
    return {
        systemPrompt: `${JSON_SYSTEM_PREFIX}

任务：从小说片段中提炼人物目标。
输出 JSON 结构：{"shortTermGoals": string[], "longTermGoal": string}
- shortTermGoals: 1-5 个短期目标（每个不超过 20 字）
- longTermGoal: 一个长期目标（不超过 30 字），无则留空字符串`,
        userPrompt: `小说片段：
${text}

已有统计结果（参考，可能为空）：
${existing ? JSON.stringify(existing).slice(0, 800) : '（无）'}

请输出 JSON：`,
    };
}

/**
 * 构建 style 维度提示词（风格关键词）
 * 输出结构：{ styleKeywords: string[], rhetoricFeatures: string[] }
 * @param text - 文本内容
 * @param _genreConfig - 题材配置
 * @param existing - 已有
  * @returns LLMPromptPair 实例
 */
function buildStylePrompt(text: string, _genreConfig?: GenreConfig, existing?: unknown): LLMPromptPair {
    return {
        systemPrompt: `${JSON_SYSTEM_PREFIX}

任务：从小说片段中提炼写作风格特征。
输出 JSON 结构：{"styleKeywords": string[], "rhetoricFeatures": string[]}
- styleKeywords: 5-12 个风格关键词（如"白描"、"古风"、"快节奏"、"重抒情"）
- rhetoricFeatures: 2-6 个修辞特征（如"比喻密集"、"对仗工整"、"夸张"")`,
        userPrompt: `小说片段：
${text}

已有统计结果（参考，可能为空）：
${existing ? JSON.stringify(existing).slice(0, 800) : '（无）'}

请输出 JSON：`,
    };
}

/**
 * 构建 rhythm 维度提示词（事件描述）
 * 输出结构：{ events: Array<{description: string, type: string}>, pacing: string }
 * @param text - 文本内容
 * @param _genreConfig - 题材配置
 * @param existing - 已有
  * @returns LLMPromptPair 实例
 */
function buildRhythmPrompt(text: string, _genreConfig?: GenreConfig, existing?: unknown): LLMPromptPair {
    return {
        systemPrompt: `${JSON_SYSTEM_PREFIX}

任务：从小说片段中识别关键事件和节奏。
输出 JSON 结构：{"events": [{"description": string, "type": string}], "pacing": string}
- events: 3-10 个关键事件，description 不超过 30 字，type 为"冲突"/"转折"/"高潮"/"铺垫"/"过渡"之一
- pacing: 整体节奏描述（如"紧凑"、"舒缓"、"张弛有度"），不超过 10 字`,
        userPrompt: `小说片段：
${text}

已有统计结果（参考，可能为空）：
${existing ? JSON.stringify(existing).slice(0, 800) : '（无）'}

请输出 JSON：`,
    };
}

/**
 * 构建 foreshadow 维度提示词（伏笔列表）
 * 输出结构：{ foreshadows: Array<{hint: string, type: string, confidence: number}> }
 * @param text - 文本内容
 * @param _genreConfig - 题材配置
 * @param existing - 已有
  * @returns LLMPromptPair 实例
 */
function buildForeshadowPrompt(text: string, _genreConfig?: GenreConfig, existing?: unknown): LLMPromptPair {
    return {
        systemPrompt: `${JSON_SYSTEM_PREFIX}

任务：从小说片段中识别潜在的伏笔。
输出 JSON 结构：{"foreshadows": [{"hint": string, "type": string, "confidence": number}]}
- foreshadows: 0-8 个伏笔
  - hint: 伏笔描述（不超过 40 字）
  - type: "物件"/"对话"/"环境"/"人物"/"事件"之一
  - confidence: 0-1 之间的浮点数（保留 2 位小数）`,
        userPrompt: `小说片段：
${text}

已有统计结果（参考，可能为空）：
${existing ? JSON.stringify(existing).slice(0, 800) : '（无）'}

请输出 JSON：`,
    };
}

/**
 * 构建 genre 维度提示词（题材识别）
 * 输出结构：{ genreId: string, displayName: string, detectorSignals: string[], keywords: { abilityKeywords: string[], styleKeywords: string[], foreshadowTypes: string[] } }
 *
 * 注意：genreId 必须从给定列表中选择，或返回 "generic"
 * @param text - 文本内容
 * @param _genreConfig - 题材配置
 * @param existing - 已有
  * @returns LLMPromptPair 实例
 */
function buildGenrePrompt(text: string, _genreConfig?: GenreConfig, existing?: unknown): LLMPromptPair {
    return {
        systemPrompt: `${JSON_SYSTEM_PREFIX}

任务：识别小说片段的题材。
可选 genreId 列表：cultivation（修仙）, military（军事）, romance（言情）, mystery（悬疑）, scifi（科幻）, wuxia（武侠）, history（历史）, fantasy（奇幻）, urban（都市）, generic（通用/无法判断）

输出 JSON 结构：
{"genreId": string, "displayName": string, "detectorSignals": string[], "keywords": {"abilityKeywords": string[], "styleKeywords": string[], "foreshadowTypes": string[]}}
- genreId: 必须从上面列表中选择
- displayName: 题材中文名
- detectorSignals: 5-15 个识别特征词（用于后续统计识别）
- keywords.abilityKeywords: 5-15 个能力关键词
- keywords.styleKeywords: 5-15 个风格关键词
- keywords.foreshadowTypes: 3-10 个伏笔类型关键词`,
        userPrompt: `小说片段：
${text}

已有统计结果（参考，可能为空）：
${existing ? JSON.stringify(existing).slice(0, 800) : '（无）'}

请输出 JSON：`,
    };
}

/** 提示词构建器映射 */
const PROMPT_BUILDERS: Record<LLMEnhanceDimension, (text: string, genreConfig?: GenreConfig, existing?: unknown) => LLMPromptPair> = {
    personality: buildPersonalityPrompt,
    abilities: buildAbilitiesPrompt,
    goals: buildGoalsPrompt,
    style: buildStylePrompt,
    rhythm: buildRhythmPrompt,
    foreshadow: buildForeshadowPrompt,
    genre: buildGenrePrompt,
};

/**
 * 获取指定维度的提示词。
 *
 * @param dimension 维度名
 * @param text 上下文摘要文本（建议 200-500 字）
 * @param genreConfig 题材配置（可选，目前仅 genre 维度使用）
 * @param existingResult 已有统计结果（可选，作为 LLM 参考）
  * @returns LLMPromptPair 实例
 */
export function getDimensionPrompt(
    dimension: LLMEnhanceDimension,
    text: string,
    genreConfig?: GenreConfig,
    existingResult?: unknown
): LLMPromptPair {
    const builder = PROMPT_BUILDERS[dimension];
    return builder(text, genreConfig, existingResult);
}

/**
 * 构建角色校验 Prompt
 *
 * 设计思路：
 * - 让 LLM 基于文本上下文判断每个候选词是否是小说中的人物角色名
 * - 给出 0-1 的置信度，便于后续与统计置信度加权融合
 * - 要求提供简短理由，便于调试和人工审核
 * - 批处理模式：每批最多 20 个候选，避免 prompt 过长
 * @param candidates - 候选
 * @param textSample - 文本样本
  * @returns LLMPromptPair 实例
 */
export function buildCharacterVerifyPrompt(
    candidates: string[],
    textSample: string
): LLMPromptPair {
    const candidatesList = candidates.map((name, i) => `${i + 1}. ${name}`).join('\n');

    return {
        systemPrompt: `你是一个中文小说角色识别专家。请判断以下词语是否是小说中的人物角色名。

严格要求：
1. 只输出一个 JSON 数组，不要输出任何解释性文字、Markdown 代码块或前后缀
2. 每个候选词都要给出判断，不要遗漏
3. 不确定时给出较低的置信度，不要强行判断
4. 判断必须基于给定的文本上下文，不要引入外部知识
5. 输出必须是合法的 JSON 数组

输出 JSON 结构（每项包含）：
- name: 候选名称（字符串）
- isCharacter: 0-1 的置信度（1=确定是角色，0=确定不是，保留2位小数）
- reason: 简短判断理由（不超过 20 字）`,
        userPrompt: `文本上下文：
${textSample}

候选列表：
${candidatesList}

请以 JSON 数组格式返回结果：`,
    };
}

/**
 * 构建称号/别名抽取 Prompt
 *
 * 设计思路：
 * - 让 LLM 分析文本中同一角色的不同称呼、称号、身份、别名
 * - 特别关注称号类（如"愚者"、"死神"等与本名无字符重叠的）
 * - 返回 merge 建议格式，sourceName=称号/别名，targetName=主名称
 * - 只生成建议，不直接合并，由上层 pipeline 决定是否采纳
 * - 批处理模式：每批处理 5-10 个角色的上下文
 * @param candidates - 候选
 * @param textSample - 文本样本
  * @returns LLMPromptPair 实例
 */
export function buildTitleAliasPrompt(
    candidates: string[],
    textSample: string
): LLMPromptPair {
    const candidatesList = candidates.map((name, i) => `${i + 1}. ${name}`).join('\n');

    return {
        systemPrompt: `你是一个中文小说角色分析专家。请分析文本中同一角色的不同称呼、称号、身份、别名。

严格要求：
1. 只输出一个 JSON 数组，不要输出任何解释性文字、Markdown 代码块或前后缀
2. 只返回你有较高把握的对应关系，不要编造
3. sourceName 必须是称号/别名（出现在文本中但不在已知角色列表中的称呼）
4. targetName 必须是已知角色列表中的名称
5. 判断必须基于给定的文本上下文，不要引入外部知识
6. 输出必须是合法的 JSON 数组

输出 JSON 结构（每项包含）：
- sourceName: 称号/别名（字符串）
- targetName: 主名称（已知角色列表中的名称，字符串）
- reason: 判断理由（不超过 30 字，字符串）
- confidence: 0-1 的置信度（保留2位小数）`,
        userPrompt: `文本上下文：
${textSample}

已知角色列表：
${candidatesList}

请找出同一角色的不同称呼、称号、身份、别名，以 JSON 数组格式返回：`,
    };
}
