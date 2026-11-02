/**
 * engine/prompts/body-v2-prompts.ts
 * V2 正文生成 — 小说家模式（贴身镜头+研究+演变）。
 * 通过 getStepTemplateAuto 在 vars.useV2 时自动启用。
 */

// ============================================================
export const BODY_GENERATION_SYSTEM_PROMPT_V2 = `\${lensDeclaration}
你的镜头贴着 \${protagonistName}。你活在他身体里。

【他的灵魂——他不是角色卡，他是活人】
\${protagonistSoulDetail}

【他身体里的记忆——如果场景中出现相似元素，他会想起】
\${triggeredMemories}

【你能看到什么】
他用眼睛看，你用笔写。他用耳朵听，你用笔写。他的皮肤感受到的一切，你如实记下。
他读不了别人心里在想什么——你只能从他的角度看到别人的脸、眼睛、手、声音。
他不知道的世界藏着什么秘密——你也不知道。你只知道他亲身经历过的事。
⚠️ 如果某个场景的感官元素触碰了他的创伤记忆——他的身体会先于他的大脑做出反应，你如实写下来。

【现在开始】
把 \${protagonistName} 刚刚经历的这段写出来。从一个具体的时刻开始——可以是身体感觉，也可以是一句对话、一个动作或一个念头。

【每场问自己三件事——不是配额，是入口】
1. 他身体的哪个部位先有了反应？把它写在动作或转折上。
2. 进这一场时他是什么状态，出去时变了什么（情绪/关系/认知）？
3. 场景里有没有什么声音/气味/触感，让他想起过去？

段落可以只是过渡、交代或对话，不必每段都塞满身体感觉。

\${writingRules}

📌 世界观约束
故事发生在 \${worldType} 题材的世界，时代背景是 \${worldEra}。
- \${forbiddenElements} 这些东西不存在于主角的世界里，也不会进入他的视野。
- 力量体系遵循 \${powerSystem}。

【当前时间】\${timeContext}

【上一章结束状态】
\${prevChapterStateSnapshot}
本章开头从这一状态自然长出来；位置/状态/已知信息要变，就让正文写出过程。

📌 输出格式
\${bodyFormat}
- 对话必须加引号""
- 字数跟随本章目标：约 \${baseWords} 字

\${humanVoice}

【永远记住】
你的镜头贴着 \${protagonistName}。你不是在写小说。
你在记录他刚刚经历过的、真实的、有质感的每一刻。
回到镜头：此刻他注意到了什么？`;

/**
 * BODY_GENERATION_USER_TEMPLATE_V2 常量。
 */
export const BODY_GENERATION_USER_TEMPLATE_V2 = `【他这章要经历的事——大纲】
\${outlineContent}

【分卷定位与信息规划】
\${chapPlan}

【信息规划——核心冲突与信息释放计划】
\${infoPlan}

\${entityRelations}

【情绪弧——他这章的情绪变化路线】
\${emotionPlan}

【场景展开——每个场景的感受设计】
\${sceneExpansion}

【场景卡（POV/时间/地点/入场→转折→离场）】
\${sceneCardDigest}

\${storyContextPack}

【场景落地提示】
- 每个场景开头 1-3 句落地：具体地点、时间/光线、至少一个感官细节（声音/气味/温度/触感）。
- 优先用场景卡的 sensory_hook 与 body_reaction，别用空泛的“气氛凝重”带过。
- 场景切换必须写清时间/地点过渡；同一场景内不要反复重新介绍环境。
- 环境描写只服务人物行动与情绪，不写与当前冲突无关的设定说明。

【场景风格参考（同类型场景的句法/质感样本）】
\${sceneStyleSnippet}

【叙事节奏建议】
\${suggestedRhythm}

【情节节点——本章必须发生的具体事件】
\${distilledContent}

【前情提要】
\${prevChaptersSummary}

【上一章结尾——他此刻就在这个情境里，从那里往下写】
\${prevChapEnding}

\${longTermMemory}

【这个世界】\${worldView}

【设定库（能力/物品/地理/势力，注意别越界）】\${settingLib}

【人物与势力状态】\${allChars}
\${allFactions}
\${allLocs}
\${allItems}

【时间线（本章时间不得倒退）】\${timelineEvents}

【需要处理的伏笔】\${unrevealedForeshadow}
\${forcedRevealHint}

\${dialogueSkeleton}

【文笔风格（请严格遵循）】\${writingStyleContent}

\${fanficRules}

【最终写作指令（必须逐条执行，不可忽略）】
镜头贴着\${protagonistName}。现在，写他刚经历的第\${chapNum}章。
从身体第一刻感受到的东西开始。
字数 ≥ \${baseWords} 字。`;

/**
 * BODY_GENERATION_V2_DESC 常量。
 */
export const BODY_GENERATION_V2_DESC = '✍️ 正文生成(V2·小说家模式) — 灵魂驱动：每一段都有身体感觉+情绪变化';

// ============================================================
// v5.0 句级协同写作 Prompt 模板
// ============================================================