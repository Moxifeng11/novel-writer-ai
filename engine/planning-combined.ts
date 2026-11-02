/**
 * planning-combined.ts — 全章合并规划
 *
 * 从 step-runner.ts 拆分而来：一次 AI 调用生成 5 个规划模块的提示词模板与输出解析。
 * 本模块为纯函数 + 常量，不依赖 Obsidian，也不持有任何状态。
 */

/** 合并规划覆盖的步骤 key（顺序即输出分隔符的解析顺序） */
export const COMBINED_PLANNING_STEP_KEYS = ['infoPlan', 'plotDistill', 'outline', 'emotionPlan', 'sceneExpand'] as const;

/**
 * CombinedPlanningStepKey 类型定义。
 */
export type CombinedPlanningStepKey = typeof COMBINED_PLANNING_STEP_KEYS[number];

/**
 * COMBINED_PLANNING_SYSTEM_PROMPT 常量。
 */
export const COMBINED_PLANNING_SYSTEM_PROMPT = `你是一位资深小说编辑。请为第\${chapNum}章一次性生成完整的章节规划，包含5个模块。

【输出格式——严格遵循，用分隔符划分5个模块】

========== INFO_PLAN ==========
## 章名与核心冲突
章名：第N章 章节名
核心冲突：一句话说明本章最大矛盾
## 情感与冲突量化
情感温度：从X级到Y级（9-10 级量表，附说明）
冲突强度：N/5（1-5 级，附阶段描述）
## 信息释放计划
- 新信息点1：出现在哪个场景/用什么方式释放
- 新信息点2：同上
## 开头承接
- 上一章末句：引用上一章结尾的原句或直接后果（一句话）
- 本章首句承接方式：从该句的哪个感官/动作/念头接着写（一句话）
## 章末钩子
- 钩子类型：悬念 / 反转 / 危机 / 未回答的问题（选一）
- 钩子内容：一句话写出钩子本身
## 伏笔操作
- 需回收的旧伏笔：具体伏笔名称（多个用「、」分隔；本章不回收写「无」）
- 需埋下的新伏笔：具体伏笔名称（多个用「、」分隔；至少 1 条）
## 关系推进
- 本章明确推进的一对关系及变化

========== PLOT_DISTILL ==========
（情节蒸馏内容：场景节奏设计、情节节点规划、爽点设计、冲突升级路径、信息密度指标）

========== OUTLINE ==========
（大纲摘要内容：全书定位、关键场景3-5个、结尾钩子）

========== EMOTION_PLAN ==========
（情绪规划内容：总体情绪曲线 + 每个场景的详细情绪规划）
总体情绪曲线格式：开篇情绪: XXX(X/10) | 高潮情绪: XXX(X/10) | 结尾情绪: XXX(X/10)
每个场景格式：
### sceneN: 场景名
emotion_start: XXX(N/10) — 原因
emotion_end: XXX(N/10) — 原因（必须与start不同）
emotion_delta: +N 或 -N
body_reaction: 身体反应
relationship_change: 关系变化

========== SCENE_EXPAND ==========
（Scene展开内容：每个场景的完整场景卡）
每个场景格式：
## 场景N：场景名
pov: 视角人物
time: 场景内时间
location: 具体地点
objective: ...
entry_state: 入场状态
conflict: ...
turn: 场景转折（必须发生）
exit_state: 离场状态（必须与入场不同）
emotion_arc: XXX(N) → XXX(N) — 原因
sensory_hook: 至少2个具体感官细节
memory_trigger: 无 / 触发描述
body_reaction: ...
subtext: ...
relationship_shift: ...
key_scene: ⭐ 名场面 — 原因 / 否
dialogue_function: 本段对话完成了什么
cliffhanger: （仅最后一个场景）
craft_notes: 可选

【约束】
- 人物、地点、势力必须从「已有实体上下文」中选取，不得新创
- 世界观总览与设定库是硬约束：能力、物品、地理、势力不得越界
- 第一个场景必须承接「上一章结尾」的时间、地点与人物状态；场景之间跳时间/跳地点必须写清过渡
- 每个场景的情绪必须有变化（start ≠ end）
- 信息规划输出三个量化指标：情感温度、冲突强度、节奏节拍
- 关键场景3-5个
- 必须有结尾钩子（悬念式/反转式/预告式/前置冲突）`;

/**
 * COMBINED_PLANNING_USER_PROMPT 常量。
 */
export const COMBINED_PLANNING_USER_PROMPT = `根据以下素材，为第\${chapNum}章一次性生成完整的章节规划（5个模块）。

【分卷规划】
\${chapPlan}

\${fanficRules}

【世界观总览】
\${worldView}

【设定库（硬约束：能力/物品/地理/势力不得越界）】
\${settingLib}

【文笔与叙述风格（保持同一叙述视角与情绪基调）】
\${writingStyleContent}

【大纲摘要】
\${outlineContent}

【前文摘要】
\${prevChaptersSummary}

【上一章结尾（第一个场景必须从这里接着写）】
\${prevChapEnding}

【未揭示伏笔】
\${unrevealedForeshadow}
\${forcedRevealHint}

【时间线】
\${timelineEvents}

【已有实体上下文（人物/势力/地点/物品功法）】
\${entityContext}

【主角信息】主角名：\${protagonistName}

【角色灵魂层】
\${characterCores}

请严格按照输出格式的分隔符（========== MODULE_NAME ==========）划分5个模块，每个模块内容完整。`;

/**
 * 将模板中的 ${key} 替换为变量值；缺失变量替换为空串
 *
 * @param template - 模板
 * @param vars - 变量表
 * @returns 文本结果
 */
export function fillPlanningTemplate(template: string, vars: Record<string, string>): string {
    return template.replace(/\$\{(\w+)\}/g, (_, key) => vars[key] || '');
}

/**
 * 构建合并规划的 system/user 提示词（变量已填充）
 *
 * @param vars - 变量表
  * @returns string } 结果
 */
export function buildCombinedPlanningPrompts(vars: Record<string, string>): { system: string; user: string } {
    return {
        system: fillPlanningTemplate(COMBINED_PLANNING_SYSTEM_PROMPT, vars),
        user: fillPlanningTemplate(COMBINED_PLANNING_USER_PROMPT, vars),
    };
}

/** 合并规划单个模块视为「有效产出」的最小字符数 */
export const COMBINED_PLANNING_MIN_MODULE_CHARS = 50;

/**
 * 合并规划完整性判定：哪些模块本次有效产出、哪些仍缺失、是否满足继续写正文的最低条件。
 *
 * `completed` 必须包含本次运行前已完成的步骤，避免「之前已有 outline、这次只生成 infoPlan」
 * 被误判为缺 outline。成功条件只看 infoPlan + outline：大纲是正文的结构输入，
 * 缺失时 `outlineContent` 只能回退分卷规划，剧情偏离风险最高。
 *
 * Rev 185：`isValid` 用于把「字符数够但结构残缺」的模块排除出 generated。
 * 不传时保持旧行为（仅按字符数），供既有调用方/测试兼容。
 * @param parsed - 解析结果
 * @param completed - 完成状态
 * @param isValid - 是否有效
 * @param minChars - 最小字符
  * @returns boolean } 结果
 */
export function evaluateCombinedPlanning(
    parsed: Record<string, string>,
    completed: ReadonlySet<string>,
    minChars = COMBINED_PLANNING_MIN_MODULE_CHARS,
    isValid?: (key: CombinedPlanningStepKey, content: string) => boolean,
): { generated: CombinedPlanningStepKey[]; missing: CombinedPlanningStepKey[]; requiredReady: boolean } {
    const generated = COMBINED_PLANNING_STEP_KEYS.filter((key) => {
        const content = parsed[key] || '';
        if (content.trim().length <= minChars) return false;
        return isValid ? isValid(key, content) : true;
    });
    const done = new Set<string>([...completed, ...generated]);
    const missing = COMBINED_PLANNING_STEP_KEYS.filter((key) => !done.has(key));
    return {
        generated,
        missing,
        requiredReady: done.has('infoPlan') && done.has('outline'),
    };
}

/**
 * 解析合并规划的 AI 输出。
 * 按固定模块顺序查找分隔符；某模块内容持续到下一个出现过的分隔符为止。
 * 缺失的模块不会产生 key；是否算成功由 `evaluateCombinedPlanning` 决定。
 * @param content - 内容
 * @returns 映射结果
 */
export function parseCombinedPlanning(content: string): Record<string, string> {
    const result: Record<string, string> = {};
    const sections: { key: string; marker: string }[] = [
        { key: 'infoPlan', marker: 'INFO_PLAN' },
        { key: 'plotDistill', marker: 'PLOT_DISTILL' },
        { key: 'outline', marker: 'OUTLINE' },
        { key: 'emotionPlan', marker: 'EMOTION_PLAN' },
        { key: 'sceneExpand', marker: 'SCENE_EXPAND' },
    ];

    for (let i = 0; i < sections.length; i++) {
        const sec = sections[i];
        const startMarker = `========== ${sec.marker} ==========`;
        const startIdx = content.indexOf(startMarker);
        if (startIdx === -1) continue;

        let endIdx = content.length;
        for (let j = i + 1; j < sections.length; j++) {
            const nextMarker = `========== ${sections[j].marker} ==========`;
            const nextIdx = content.indexOf(nextMarker, startIdx + startMarker.length);
            if (nextIdx !== -1) {
                endIdx = nextIdx;
                break;
            }
        }

        const sectionContent = content.slice(startIdx + startMarker.length, endIdx).trim();
        if (sectionContent) {
            result[sec.key] = sectionContent;
        }
    }

    return result;
}
