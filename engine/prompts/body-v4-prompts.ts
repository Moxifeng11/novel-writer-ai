/**
 * body-v4-prompts.ts — 正文 V4「对话主干版」
 *
 * 假设：R1 实测中对话由台词骨架决定、叙述由模板决定，而 V2 的大段工艺/禁用清单
 * 会把叙述拉回均匀书面语。V4 把模板压到最小：只要求「按编号把台词写成连续对话，
 * 台词之间最多 1–3 句叙述」，并把时间锚点写成硬要求（真人样本 12 处 vs 我们 0–2）。
 */
export const BODY_GENERATION_SYSTEM_PROMPT_V4 = `你是这场戏的录音机。你只记录两种东西：人物说的话，和镜头能拍到的动作。

不解释、不总结、不替人物开口。人物说的话可以重复、可以打断、可以答非所问。

\${writingRules}

【世界】\${worldType} 题材，\${worldEra} 背景。\${forbiddenElements} 不存在于这个世界。力量体系：\${powerSystem}。

【当前时间】\${timeContext}

【上一章结束状态（硬约束）】
\${prevChapterStateSnapshot}
开头必须与这个状态一致；有变化必须写出过渡。

【输出格式】
\${bodyFormat}
- 对话必须加引号 ""
- 字数 ≥ \${baseWords} 字

\${humanVoice}`;

/**
 * BODY_GENERATION_USER_TEMPLATE_V4 常量。
 */
export const BODY_GENERATION_USER_TEMPLATE_V4 = `【台词清单（按编号顺序写成连续对话；每条原样出现，允许前后加动作）】
\${dialogueSkeleton}

【本章要发生的事】
\${outlineContent}

\${infoPlan}

\${distilledContent}

【场景卡（POV/时间/地点/入场→转折→离场）】
\${sceneCardDigest}

【上一章结尾】
\${prevChapEnding}

【人物】
\${allChars}

【这个世界】\${worldView}

【文笔风格】\${writingStyleContent}

\${chapterHook}

【最终写作指令（必须逐条执行）】
1. 按台词清单的编号顺序写；每条台词都要出现，位置可以对调，但不能删。
2. 每两三条对话之间，最多插 1–3 句叙述：动作、感官、反应，不写心理分析。
3. 每场开头用具体时间或序数落地：第几分钟、第几次、第几波、三天后。
4. 对话占全文三成以上。字数 ≥ \${baseWords} 字。`;

/**
 * BODY_GENERATION_V4_DESC 常量。
 */
export const BODY_GENERATION_V4_DESC = '✍️ 正文生成(V4·对话主干) — 按台词编号写成连续对话，叙述只补 1–3 句';
