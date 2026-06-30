/**
 * engine/prompts/template-utils.ts
 * PromptTemplate 接口 + 路由表 + 变量替换工具。
 *
 * 内联模板（characterSoul / emotionPlan / sceneExpand）保留在 getStepTemplate 函数体内，
 * 因为它们是该函数内部 case 分支返回的临时对象，无外部依赖。
 */
import {
    INFO_PLAN_PROMPTS,
    PLOT_DISTILL_PROMPTS,
    OUTLINE_PROMPTS,
    BODY_GENERATION_SYSTEM_PROMPT,
    BODY_GENERATION_USER_TEMPLATE,
    BODY_GENERATION_DESC,
    SELF_CHECK_PROMPTS,
    FIX_PROMPTS,
    CONTINUITY_CHECK_PROMPTS,
    ANALYSIS_REPORT_PROMPTS,
    QUALITY_CONTROL_PROMPTS,
} from './chapter-pipeline-prompts';
import {
    BODY_GENERATION_SYSTEM_PROMPT_V2,
    BODY_GENERATION_USER_TEMPLATE_V2,
    BODY_GENERATION_V2_DESC,
} from './body-v2-prompts';
import { MEMORY_GENERATION_PROMPTS } from './memory-prompts';

// ============================================================
export interface PromptTemplate {
    description: string;
    systemPrompt: string;
    userPrompt: string;
}

/**
 * 根据步骤 key 获取对应的提示词模板
 * 使用函数导出以避免 esbuild tree-shaking 掉模板字符串
 */
export function getStepTemplate(key: string): PromptTemplate | null {
    const map: Record<string, PromptTemplate> = {
        infoPlan: INFO_PLAN_PROMPTS,
        plotDistill: PLOT_DISTILL_PROMPTS,
        outline: OUTLINE_PROMPTS,
        characterSoul: {
            description: '🫀 角色灵魂提取 — 自动步骤，从上文加载的角色灵魂数据中提取本章相关角色的核心特质',
            systemPrompt: `你是一位角色灵魂分析师。你的任务是从已有的角色灵魂数据中，提取与当前章节相关的角色核心特质，供后续情绪规划和场景展开使用。

【提取内容】
- 主角的欲望、恐惧、创伤、软肋、道德边界
- 本章出场的重要配角的核心特质和与主角的关系
- 可能在本章被触发的记忆或情感按钮`,
            userPrompt: `从以下角色灵魂数据中，提取与第\${chapNum}章相关的角色核心特质。

【角色灵魂汇总】
\${characterCores}

【本章信息规划】
\${infoPlan}

请输出本章出场角色的灵魂特质摘要，供后续情绪规划和场景展开使用。`,
        },
        emotionPlan: {
            description: '🎭 情绪规划 — 为章节中每个场景规划情绪弧，确保情绪有起伏、有变化、有原因',
            systemPrompt: `你是一位情绪规划师。你的任务——为章节中每个场景规划情绪弧。

【核心原则】
- 情绪不是状态——情绪是变化。emotion_start 和 emotion_end 必须不同。
- 情绪要具体：不是"愤怒"，是"指甲掐进掌心的隐忍愤怒"
- 每个场景的情绪变化必须有原因：因为发生了什么事？因为想起了什么？
- 总体情绪曲线要有起伏：不能从头到尾一个调

【角色灵魂层——你必须理解】
\${characterSouls}
这些角色不是 NPC。他们有欲望、恐惧、创伤。他们的情绪反应源于这些深层动力。
- 如果一个角色的 trauma 被触发 → 情绪会剧烈波动
- 如果一个角色的 soft_spot 受到威胁 → 会产生保护欲或暴怒
- 如果触及 moral_boundary → 会产生内心撕裂

【输出格式——严格遵循】
## 总体情绪曲线
开篇情绪: XXX(X/10) | 高潮情绪: XXX(X/10) | 结尾情绪: XXX(X/10)
情绪总变化次数: N

## 场景级情绪规划

### sceneN: 场景名
emotion_start: XXX(N/10) — 原因
emotion_end: XXX(N/10) — 原因（必须与start不同）
emotion_delta: +N 或 -N
body_reaction: 身体反应（至少一处具体描写）
relationship_change: 本场景导致角色间关系如何变化（如有互动）

【校验规则——违反即判定失败】
1. 每个scene的emotion_start ≠ emotion_end
2. 总体情绪总变化次数 ≥ 场景数
3. 高潮情绪等级必须 ≥ 开篇和结尾情绪等级的最大值`,
            userPrompt: `根据以下素材，为第\${chapNum}章生成「情绪规划」。

【信息规划】
\${infoPlan}

【情节蒸馏】
\${distilledContent}

【大纲摘要】
\${outlineContent}

【分卷规划】
\${chapPlan}

【角色灵魂层】
\${characterSouls}

请按规范格式输出：总体情绪曲线 + 每个场景的详细情绪规划。`,
        },
        sceneExpand: {
            description: '🎬 Scene展开 — 将大纲场景展开为详细设计：目标/情绪弧/冲突/感官钩子/记忆触发/身体反应/潜台词',
            systemPrompt: `你就是主角本人。现在你需要把你的记忆碎片和当前场景揉在一起——不是规划，是在头脑里预演即将发生的事。

\${protagonistSoul}

\${triggeredMemories}

【预演要求——每场景必须有这8个要素】
1. objective: 你走进这个场景是为了什么？
2. emotion_arc: 进来时什么感觉 → 出去时变成什么感觉（必须变化）
3. conflict: 什么在挡你的路？
4. sensory_hook: 你身体第一个感受到的是什么？（气味/温度/声音/触感）
5. memory_trigger: 这个场景有没有让你想起什么？如果某个感官元素触发了你的创伤记忆——写出来。
6. body_reaction: 你的身体怎么反应的？（不自觉的——手指/呼吸/肩膀/胃）
7. subtext: 你说的话和你想说的话之间差了多少？
8. relationship_shift: 和在场的人之间——关系有变化吗？

【输出格式——严格遵循】
## sceneN: 场景名
objective: ...
emotion_arc: XXX(N) → XXX(N) — 原因
conflict: ...
sensory_hook: ...
memory_trigger: 无 / 触发 m00X — 什么触发的
body_reaction: ...
subtext: ...
relationship_shift: ...

【约束】
- objective 必须是主角的——不是作者给角色分配的任务
- emotion_arc 的两个情绪必须不同
- sensory_hook 必须具体——不是"气氛紧张"，是"闻到铁锈味"或"手摸到冰凉的金属"
- body_reaction 是不自觉的——不是"他决定握紧拳头"，是"拳头自己收紧了，他发现时指甲已掐进掌心"
- subtext 是说vs想的差距——说了什么，心里真正想的是什么`,
            userPrompt: `你是\${protagonistName}本人。现在预演你即将经历的第\${chapNum}章。

【你要经历的大纲】
\${outlineContent}

【你的情绪规划】
\${emotionPlan}

【你的记忆碎片——如果场景中出现相似元素会触发】
\${triggeredMemories}

【身边的人】
\${allChars}

请按规范格式输出每场景的展开设计。`,
        },
        bodyGeneration: {
            description: BODY_GENERATION_DESC,
            systemPrompt: BODY_GENERATION_SYSTEM_PROMPT,
            userPrompt: BODY_GENERATION_USER_TEMPLATE,
        },
        bodyGenerationV2: {
            description: BODY_GENERATION_V2_DESC,
            systemPrompt: BODY_GENERATION_SYSTEM_PROMPT_V2,
            userPrompt: BODY_GENERATION_USER_TEMPLATE_V2,
        },
        selfCheck: SELF_CHECK_PROMPTS,
        fix: FIX_PROMPTS,
        finalFix: FIX_PROMPTS,
        continuityCheck: CONTINUITY_CHECK_PROMPTS,
        analysisReport: ANALYSIS_REPORT_PROMPTS,
        qualityControl: QUALITY_CONTROL_PROMPTS,
        memoryGeneration: MEMORY_GENERATION_PROMPTS,
    };
    return map[key] || null;
}

/**
 * V2: 获取步骤模板——支持使用 V2 prompt 替换 V1
 * 当 vars 中 characterCores 有数据时自动启用 V2 模式
 */
export function getStepTemplateAuto(key: string, vars?: Record<string, string>): PromptTemplate | null {
    if (key === 'bodyGeneration' && vars) {
        // 如果有灵魂层数据 → 启用 V2 小说家模式
        const hasSoul = !!(vars.characterCores && vars.characterCores.trim().length > 100);
        if (hasSoul) {
            return getStepTemplate('bodyGenerationV2');
        }
    }
    return getStepTemplate(key);
}

/**
 * 替换模板变量
 */
export function fillTemplate(template: string, vars: Record<string, string>): string {
    let result = template;
    for (const [key, value] of Object.entries(vars)) {
        result = result.replace(new RegExp(`\\$\\{${key}\\}`, 'g'), value || '');
    }
    return result;
}