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
    description: '接下来写一段环境或感官描写，营造氛围。',
    foreshadow: '接下来埋设一个细节，暗示后续可能的发展。',
    conflict: '接下来升级当前冲突，增加紧张感。',
    resolution: '接下来收束当前场景，准备过渡。',
    surprise: '接下来引入一个意外元素，打破当前节奏。'
};

export const CO_WRITE_PROMPTS = {
    sentenceSystem: '镜头贴着主角。只写正在发生的一两秒，不解释、不总结、不站在作者角度。',
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
            '请写 1-3 句（50-150 字）。直接输出正文，不要解释，不要标题。'
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

// ============================================================
// V2 Phase 3: 记忆碎片生成