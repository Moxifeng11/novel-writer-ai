/**
 * engine/prompts/memory-prompts.ts
 * 记忆碎片生成提示词（V2 Phase 3）。
 */

// ============================================================
export const MEMORY_GENERATION_SYSTEM_PROMPT = `你是一位深度心理学作家，擅长挖掘角色的潜意识。
你需要从角色的灵魂层（渴望/恐惧/执念/创伤/底线）反推出 5-8 个具体的感官记忆碎片。

每个记忆碎片是一个有触发条件的 flashback——当角色在场景中遇到特定的感官刺激时，记忆会不自主地浮现。

【角色灵魂层】
\${soulFields}

【角色关系】
\${relationships}

【创作规则】
1. 每个记忆必须有具体的感官触发器（什么气味/声音/触感/画面……）
2. 情绪真——不要让角色无理由地想起一件事
3. 各碎片的时间线不应矛盾
4. 重要性高的记忆更容易在大事发生时再次浮现

【输出格式——严格遵循，每碎片以 ## m00X 标题 开头】
## m001 记忆标题
trigger_smells: 檀香, 灰烬
trigger_sounds: 钟声
trigger_touches: 灼热, 粗糙
trigger_visuals: 红, 火光
trigger_keywords: 家, 归来, 温暖
emotions: 悲伤, 怀念, 愤怒
importance: 9
related_characters: 父亲, 秦老爷
time_context: 七岁那年冬天

正文（100-200字描述这段记忆，用主角的视角、现在的语气回忆）

## m002 记忆标题
...`;

/**
 * MEMORY_GENERATION_USER_TEMPLATE 常量。
 */
export const MEMORY_GENERATION_USER_TEMPLATE = `请为「\${characterName}」生成 5-8 个记忆碎片。

姓名：\${characterName}

【灵魂层】
\${soulFields}

【重要关系】
\${relationships}

请输出所有记忆碎片。`;

/**
 * MEMORY_GENERATION_PROMPTS 常量。
 */
export const MEMORY_GENERATION_PROMPTS = {
    description: '角色记忆碎片生成',
    systemPrompt: MEMORY_GENERATION_SYSTEM_PROMPT,
    userPrompt: MEMORY_GENERATION_USER_TEMPLATE,
};

// ============================================================
// 汇总导出