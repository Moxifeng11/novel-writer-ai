/**
 * engine/prompts/co-write-prompts.ts
 * 句级协同写作（CoWriter）方向化提示词。
 * 8 个方向：action / emotion / dialogue / sensory / pacing / narrative / hook / continuity
 */


export type CoWriteDirection =
    | 'action'
    | 'emotion'
    | 'dialogue'
    | 'description'
    | 'foreshadow'
    | 'conflict'
    | 'resolution'
    | 'surprise';

export const CO_WRITE_DIRECTION_PROMPTS: Record<CoWriteDirection, string> = {
    action: '接下来写一段动作或冲突场景，聚焦身体动作和外部变化。',
    emotion: '接下来写一句内心感受或情绪波动，从身体感觉出发。',
    dialogue: '接下来写一句对话，推动人物关系或揭示信息。',
    description: '接下来写一段环境或感官描写：必须使用当前场景卡的地点、时间、sensory_hook 与 body_reaction，写 1-3 句；只营造氛围与身体感受，不推进剧情、不写对白、不引入新地点。',
    foreshadow: '接下来埋设一个细节，暗示后续可能的发展。',
    conflict: '接下来升级当前冲突，增加紧张感。',
    resolution: '接下来收束当前场景，准备过渡。',
    surprise: '接下来引入一个意外元素，打破当前节奏。'
};

import { HUMAN_VOICE_SHORT } from './human-voice';

export const CO_WRITE_PROMPTS = {
    sentenceSystem: `镜头贴着主角。只写正在发生的一两秒，不解释、不总结、不站在作者角度。场景描写必须落在具体地点、时间与至少一个感官细节上，优先使用场景卡提供的 sensory_hook 与 body_reaction。${HUMAN_VOICE_SHORT}`,
    buildSentenceUserPrompt(precedingText: string, directionPrompt: string, cursorHint = ''): string {
        return [
            '【已写内容】',
            precedingText.slice(-800),
            '',
            '【本次续写方向】',
            directionPrompt,
            cursorHint ? '' : '',
            cursorHint ? '【临时指令】' : '',
            cursorHint || '',
            '',
            (precedingText || '').trim().length < 10
            ? '这是本章的开头。请根据本章大纲和设定，开始写正文。写 1 个自然段（80–220 字，2–6 句）。直接输出正文，不要解释，不要标题。'
            : '请写 1 个自然段（80–220 字，2–6 句），不要一句一段。直接输出正文，不要解释，不要标题。'
        ].filter(line => line !== '').join('\n');
    },
    buildValidationPrompt(modifiedText: string, originalText: string, precedingContext: string): string {
        return [
            '你是一个小说编辑。请验证用户手动修改后的句子是否合适。',
            '',
            '【原 AI 建议】',
            originalText,
            '',
            '【用户修改后】',
            modifiedText,
            '',
            '【上下文】',
            precedingContext.slice(-500),
            '',
            '请评估：设定一致性、文风对齐、剧情对齐，各 0-100 分。',
            '只返回 JSON，不要 markdown 代码块。'
        ].join('\n');
    },
    buildCompletionPrompt(currentBody: string, chapterPlan: string): string {
        return [
            '你是小说结构分析师。请评估当前正文的剧情完成度。',
            '',
            '【章节目标】',
            chapterPlan.slice(0, 500),
            '',
            '【当前正文】',
            currentBody.slice(-1500),
            '',
            '请评估 sceneObjectivesMet、characterArcsAdvanced、foreshadowingSeeded、emotionalArcProgress，各 0-100 分。',
            '同时给出 suggestionAdvice 和 nextDirectionHints（三个方向）。只返回 JSON，不要 markdown 代码块。'
        ].join('\n');
    }
};

export const PRECISION_MODE_SYSTEM_APPEND = `
【精准风格约束】
你正在模仿特定作家的写作风格。请严格遵守以下约束：
- 每句话的字数必须有明显波动，避免句长均匀；长短句交替，不要通篇短句
- 连续句子的开头词语不得重复
- 标点符号要多样化，适当使用问号、冒号、省略号、感叹号、破折号
- 避免使用AI高频词（然而、于是、随后、仿佛、似乎等）
- 优先使用口语化表达；短句只用来停顿或强调，不要一句一段
- 对话要自然，避免书面语
`;

// ============================================================
// V2 Phase 3: 记忆碎片生成