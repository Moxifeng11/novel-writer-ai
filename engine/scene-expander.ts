/**
 * Scene Expander — V2 场景展开引擎
 * 
 * 将大纲场景展开为详细设计：objective/emotion_arc/conflict/
 * sensory_hook/memory_trigger/body_reaction/subtext
 * 
 * AI 调用生成，输出到 第X章_Scene展开.md
 */

import type { AIEngine } from './ai-engine';
import type { Notifier } from '../shared/types';
import { NOOP_NOTIFIER } from '../shared/types';

/** 展开后的场景设计 */
export interface ExpandedScene {
    sceneName: string;
    objective: string;       // 角色进入场景的目的
    emotionArc: string;      // 进来→出去的情绪变化
    conflict: string;         // 核心矛盾
    sensoryHook: string;     // 感官入口（第一个感受到的）
    memoryTrigger: string;   // 记忆触发（无/触发m00X：原因）
    bodyReaction: string;    // 身体反应
    subtext: string;         // 潜台词（说vs想）
}

export const SCENE_EXPAND_SYSTEM_PROMPT = `你就是主角本人。现在你需要把你的记忆碎片和当前场景揉在一起——不是规划，是在头脑里预演即将发生的事。

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
- subtext 是说vs想的差距——说了什么，心里真正想的是什么`;

export const SCENE_EXPAND_USER_TEMPLATE = `你是\${protagonistName}本人。现在预演你即将经历的第\${chapNum}章。

【世界观设定】
\${worldView}

【设定库】
\${settingLib}

【力量体系】
\${powerSystem}

【世界类型】
\${worldType}

【你要经历的大纲】
\${outlineContent}

【你的情绪规划】
\${emotionPlan}

【你的记忆碎片——如果场景中出现相似元素会触发】
\${triggeredMemories}

【身边的人】
\${allChars}

请按规范格式输出每场景的展开设计。
所有场景必须严格遵循上述世界观与力量体系，不得出现与世界观不符的元素（如现代物品、现代词汇等）。`;

/**
 * 调用 AI 生成 Scene 展开
 */
export async function generateSceneExpansion(
    aiEngine: AIEngine,
    vars: Record<string, string>,
    model?: string,
    notifier: Notifier = NOOP_NOTIFIER,
): Promise<string> {
    const systemPrompt = SCENE_EXPAND_SYSTEM_PROMPT
        .replace(/\${protagonistSoul}/g, vars.characterCores || '')
        .replace(/\${triggeredMemories}/g, vars.triggeredMemories || '无。');

    const userPrompt = SCENE_EXPAND_USER_TEMPLATE
        .replace(/\${protagonistName}/g, vars.protagonistName || '主角')
        .replace(/\${chapNum}/g, vars.chapNum || '?')
        .replace(/\${worldView}/g, vars.worldView || '暂无世界观设定。')
        .replace(/\${settingLib}/g, vars.settingLib || '暂无设定库。')
        .replace(/\${powerSystem}/g, vars.powerSystem || '暂无力量体系设定。')
        .replace(/\${worldType}/g, vars.worldType || '未知世界类型。')
        .replace(/\${outlineContent}/g, vars.outlineContent || '')
        .replace(/\${emotionPlan}/g, vars.emotionPlan || '无情绪规划。')
        .replace(/\${triggeredMemories}/g, vars.triggeredMemories || '无。')
        .replace(/\${allChars}/g, vars.allChars || '');

    notifier.showNotice('🎬 正在展开场景设计...');
    const response = await aiEngine.callAI(userPrompt, systemPrompt, model);
    notifier.showNotice('✅ 场景展开完成');

    return response.content;
}

/**
 * 校验 Scene 展开是否包含必要要素
 */
export function validateSceneExpansion(content: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const sceneRegex = /##\s+scene\d+:/gi;
    const scenes = [...content.matchAll(sceneRegex)];

    if (scenes.length === 0) {
        errors.push('未找到任何场景展开（缺少 ## sceneN: 格式）');
        return { valid: false, errors };
    }

    const requiredFields = ['objective', 'emotion_arc', 'conflict', 'sensory_hook', 'body_reaction', 'subtext'];
    for (let i = 0; i < scenes.length; i++) {
        // 获取下一个场景的起始位置来截取当前场景内容
        const startIdx = scenes[i].index!;
        const endIdx = i + 1 < scenes.length ? scenes[i + 1].index! : content.length;
        const sceneContent = content.slice(startIdx, endIdx);

        for (const field of requiredFields) {
            if (!sceneContent.includes(`${field}:`)) {
                errors.push(`scene${i + 1}: 缺少 ${field} 字段`);
            }
        }

        // 校验 emotion_arc 有变化
        const arcMatch = sceneContent.match(/emotion_arc:\s*(.+)/i);
        if (arcMatch) {
            const arc = arcMatch[1];
            if (!arc.includes('→') && !arc.includes('->')) {
                errors.push(`scene${i + 1}: emotion_arc 未使用 → 符号，无法判定情绪变化`);
            }
        }
    }

    return { valid: errors.length === 0, errors };
}
