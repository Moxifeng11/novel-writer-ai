/**
 * Emotion Planner — V2 情绪规划引擎
 * 
 * 基于信息规划 + 角色灵魂层，为每章每个场景规划情绪弧。
 * AI 调用生成，输出到 第X章_情绪规划.md。
 * 
 * 核心约束：每场景 emotion_start ≠ emotion_end
 */

import { App } from 'obsidian';
import type { AIEngine } from './ai-engine';
import type { Notifier } from '../shared/types';
import { NOOP_NOTIFIER } from '../shared/types';

/** 情绪等级 0-10 */
export type EmotionLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

/** 单个场景的情绪规划 */
export interface SceneEmotionPlan {
    sceneName: string;           // 场景名
    emotionStart: string;        // 进入场景时的情绪+原因
    emotionStartLevel: number;   // 情绪等级(0-10)
    emotionEnd: string;          // 离开场景时的情绪+原因
    emotionEndLevel: number;     // 情绪等级(0-10)
    emotionDelta: string;        // +N 或 -N
    bodyReaction: string;        // 身体反应
    relationshipChange: string;  // 关系变化描述
}

/** 整章情绪规划 */
export interface ChapterEmotionPlan {
    openingEmotion: string;
    climaxEmotion: string;
    closingEmotion: string;
    totalChangeCount: number;
    scenes: SceneEmotionPlan[];
}

/**
 * System prompt for emotion planning
 */
export const EMOTION_PLAN_SYSTEM_PROMPT = `你是一位情绪规划师。你的任务——为章节中每个场景规划情绪弧。

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
3. 高潮情绪等级必须 ≥ 开篇和结尾情绪等级的最大值`;

/**
 * 情绪计划用户模板常量。
 */
export const EMOTION_PLAN_USER_TEMPLATE = `根据以下素材，为第\${chapNum}章生成「情绪规划」。

【世界观设定】
\${worldView}

【设定库】
\${settingLib}

【力量体系】
\${powerSystem}

【世界类型】
\${worldType}

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

\${emotionKnowledge}

请按规范格式输出：总体情绪曲线 + 每个场景的详细情绪规划。
所有场景必须严格遵循上述世界观与力量体系，不得出现与世界观不符的元素。`;

/**
 * 校验情绪规划是否合法
 * @param content - 内容
  * @returns string[] } 结果
 */
export function validateEmotionPlan(content: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // 解析场景（兼容 ##/###/#### 标题，以及 sceneN / 场景N 两种命名）
    const sceneRegex = /^#{2,6}\s*(?:scene|场景)\s*\d+\s*[：:]/gim;
    const scenes = [...content.matchAll(sceneRegex)];

    if (scenes.length === 0) {
        errors.push('未找到任何场景规划（缺少 ### sceneN: 格式）');
        return { valid: false, errors };
    }

    // 提取所有 emotion_start / emotion_end
    const starts = [...content.matchAll(/emotion_start:\s*(.+)/gi)];
    const ends = [...content.matchAll(/emotion_end:\s*(.+)/gi)];

    if (starts.length !== scenes.length || ends.length !== scenes.length) {
        errors.push(`场景数 ${scenes.length} 但 emotion_start 有 ${starts.length} 个、emotion_end 有 ${ends.length} 个——不匹配`);
        return { valid: false, errors };
    }

    // 校验每场景情绪变化
    for (let i = 0; i < scenes.length; i++) {
        const startText = starts[i][1]?.trim() || '';
        const endText = ends[i][1]?.trim() || '';

        // 提取等级数字（兼容 6/10 与 6.5/10；括号兼容半角 () 与全角 （）——实测模型两种都写）
        const startLevel = startText.match(/[（(](\d+(?:\.\d+)?)\s*\/10[）)]/)?.[1];
        const endLevel = endText.match(/[（(](\d+(?:\.\d+)?)\s*\/10[）)]/)?.[1];

        if (!startLevel || !endLevel) {
            errors.push(`scene${i + 1}: 缺少情绪等级（格式：emotion_start: XXX(N/10)）`);
            continue;
        }

        if (startLevel === endLevel) {
            errors.push(`scene${i + 1}: emotion_start 和 emotion_end 等级相同（${startLevel}/10）——情绪无变化`);
        }
    }

    // 检查总体情绪曲线
    if (!content.includes('总体情绪曲线') && !content.includes('开篇情绪')) {
        errors.push('缺少「总体情绪曲线」段');
    }

    return { valid: errors.length === 0, errors };
}

/**
 * 调用 AI 生成情绪规划
 * @param aiEngine - AI 引擎
 * @param app - Obsidian 应用实例
 * @param vars - 变量表
 * @param model - 模型标识
 * @param notifier - 通知器
 * @param options - 配置项
 * @returns 文本结果
 */
export async function generateEmotionPlan(
    aiEngine: AIEngine,
    app: App,
    vars: Record<string, string>,
    model?: string,
    notifier: Notifier = NOOP_NOTIFIER,
    options?: { maxTokens?: number; signal?: AbortSignal },
): Promise<string> {
    const systemPrompt = EMOTION_PLAN_SYSTEM_PROMPT.replace(/\${characterSouls}/g, vars.characterCores || '无角色灵魂层数据。');
    const userPrompt = EMOTION_PLAN_USER_TEMPLATE
        .replace(/\${chapNum}/g, vars.chapNum || '?')
        .replace(/\${worldView}/g, vars.worldView || '暂无世界观设定。')
        .replace(/\${settingLib}/g, vars.settingLib || '暂无设定库。')
        .replace(/\${powerSystem}/g, vars.powerSystem || '暂无力量体系设定。')
        .replace(/\${worldType}/g, vars.worldType || '未知世界类型。')
        .replace(/\${infoPlan}/g, vars.infoPlan || '')
        .replace(/\${distilledContent}/g, vars.distilledContent || '')
        .replace(/\${outlineContent}/g, vars.outlineContent || '')
        .replace(/\${chapPlan}/g, vars.chapPlan || '')
        .replace(/\${characterSouls}/g, vars.characterCores || '无角色灵魂层数据。')
        .replace(/\${emotionKnowledge}/g, vars.emotionKnowledge || '');

    notifier.showNotice('🎭 正在生成情绪规划...');
    // callAI 签名是 (systemPrompt, userPrompt)：此前把两者传反，情绪规划从未按 system 约束生成
    const response = await aiEngine.callAI(
        systemPrompt,
        userPrompt,
        model,
        0.7,
        options?.maxTokens,
        options?.signal ? { signal: options.signal } : undefined,
    );
    notifier.showNotice('✅ 情绪规划生成完成');

    return response.content;
}
