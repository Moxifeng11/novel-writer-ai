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
    isKeyScene?: boolean;    // 是否为名场面
    keySceneReason?: string; // 名场面原因
    dialogueFunction?: string; // 对话功能化说明
    cliffhanger?: string;    // 结尾钩子（最后一个场景）
}

export const SCENE_EXPAND_SYSTEM_PROMPT = `你就是主角本人。现在你需要把你的记忆碎片和当前场景揉在一起——不是规划，是在头脑里预演即将发生的事。

\${protagonistSoul}

\${triggeredMemories}

【预演要求——每场景必须有这8个核心要素】
1. objective: 你走进这个场景是为了什么？
2. emotion_arc: 进来时什么感觉 → 出去时变成什么感觉（必须变化）
3. conflict: 什么在挡你的路？
4. sensory_hook: 你身体第一个感受到的是什么？（气味/温度/声音/触感）
5. memory_trigger: 这个场景有没有让你想起什么？如果某个感官元素触发了你的创伤记忆——写出来。
6. body_reaction: 你的身体怎么反应的？（不自觉的——手指/呼吸/肩膀/胃）
7. subtext: 你说的话和你想说的话之间差了多少？
8. relationship_shift: 和在场的人之间——关系有变化吗？

【进阶要求——场景质量升级】
9. key_scene: 本章至少选一个场景作为【名场面】，标记为 ⭐ 名场面，并说明为什么这个场景会让读者印象深刻（如：极致反差/情绪爆发/重大转折/经典台词）
10. dialogue_function: 每段对话必须完成至少一件事——要么推进剧情、要么揭露信息、要么塑造人物、要么改变关系。在场景末尾用一句话说明本段对话的功能性。
11. cliffhanger: 【本章最后一个场景】必须设置结尾钩子——一个让读者迫切想看下一章的悬念。可以是：新危机出现/重要信息揭露一半/关键人物登场/反转发生在最后一刻。

【输出格式——严格遵循】
## 场景N：场景名
objective: ...
emotion_arc: XXX(N) → XXX(N) — 原因
conflict: ...
sensory_hook: ...
memory_trigger: 无 / 触发 m00X — 什么触发的
body_reaction: ...
subtext: ...
relationship_shift: ...
key_scene: ⭐ 名场面 — 原因（非名场面写"否"）
dialogue_function: 本段对话完成了什么（推进剧情/揭露XX信息/塑造XX性格/改变XX关系）
cliffhanger: （仅最后一个场景填写，钩子内容）

【约束】
- objective 必须是主角的——不是作者给角色分配的任务
- emotion_arc 的两个情绪必须不同
- sensory_hook 必须具体——不是"气氛紧张"，是"闻到铁锈味"或"手摸到冰凉的金属"
- body_reaction 是不自觉的——不是"他决定握紧拳头"，是"拳头自己收紧了，他发现时指甲已掐进掌心"
- subtext 是说vs想的差距——说了什么，心里真正想的是什么
- key_scene 每章至少1个，要选真正有冲击力的时刻，不要随便选
- dialogue_function 要具体——不要写"推进剧情"，要写"揭露了反派的真实身份"或"让两人关系从敌对转为合作"
- cliffhanger 必须让人想立刻翻下一页——不能是平淡的收尾`;

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

\${sceneKnowledge}

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
        .replace(/\${allChars}/g, vars.allChars || '')
        .replace(/\${sceneKnowledge}/g, vars.sceneKnowledge || '');

    notifier.showNotice('🎬 正在展开场景设计...');
    const response = await aiEngine.callAI(userPrompt, systemPrompt, model);
    notifier.showNotice('✅ 场景展开完成');

    return response.content;
}

/**
 * 中文数字解析
 * 支持零、一、二、...、九、十、百、千、万、亿
 * 支持组合如"一百二十三"、"三千零五"、"十万"
 * 返回对应的阿拉伯数字，解析失败返回 null
 */
export function parseChineseNumber(str: string): number | null {
    if (!str || str.trim() === '') return null;
    const s = str.trim();

    const digits: Record<string, number> = {
        '零': 0, '〇': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4,
        '五': 5, '六': 6, '七': 7, '八': 8, '九': 9,
    };
    const units: Record<string, number> = {
        '十': 10, '百': 100, '千': 1000, '万': 10000, '亿': 100000000,
    };

    let total = 0;
    let current = 0;
    let section = 0;
    let hasDigit = false;

    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (digits[ch] !== undefined) {
            current = digits[ch];
            hasDigit = true;
        } else if (units[ch] !== undefined) {
            const unit = units[ch];
            if (unit >= 10000) {
                section = (section + current) * unit;
                total += section;
                section = 0;
            } else {
                if (current === 0 && !hasDigit) current = 1;
                section += current * unit;
            }
            current = 0;
            hasDigit = false;
        } else {
            return null;
        }
    }
    total += section + current;
    return total > 0 ? total : null;
}

/**
 * 校验 Scene 展开是否包含必要要素
 */
export function validateSceneExpansion(content: string): { valid: boolean; errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];

    const sceneRegex = /^##\s*(?:场景\s*([一二三四五六七八九十百千万亿零〇两]+|\d+)|scene(\d+))\s*[：:]/gim;
    const scenes: { index: number; num: number }[] = [];
    let m: RegExpExecArray | null;
    while ((m = sceneRegex.exec(content)) !== null) {
        let num = 0;
        if (m[1] !== undefined) {
            const cnNum = parseChineseNumber(m[1]);
            num = cnNum ?? scenes.length + 1;
        } else if (m[2] !== undefined) {
            num = parseInt(m[2], 10);
        } else {
            num = scenes.length + 1;
        }
        scenes.push({ index: m.index, num });
    }

    if (scenes.length === 0) {
        errors.push('未找到任何场景展开（缺少 ## 场景N：或 ## sceneN: 格式）');
        return { valid: false, errors, warnings };
    }

    const requiredFields = ['objective', 'emotion_arc', 'conflict', 'sensory_hook', 'body_reaction', 'subtext'];
    let hasKeyScene = false;

    for (let i = 0; i < scenes.length; i++) {
        const startIdx = scenes[i].index;
        const endIdx = i + 1 < scenes.length ? scenes[i + 1].index : content.length;
        const sceneContent = content.slice(startIdx, endIdx);
        const sceneNum = scenes[i].num;
        const isLastScene = i === scenes.length - 1;

        for (const field of requiredFields) {
            const fieldRegex = new RegExp(`^\\s*\\*?\\*?${field}\\s*[：:]\\s*`, 'im');
            if (!fieldRegex.test(sceneContent)) {
                errors.push(`场景${sceneNum}: 缺少 ${field} 字段`);
            }
        }

        const arcMatch = sceneContent.match(/^\s*\*?\*?emotion_arc\s*[：:]\s*(.+)$/im);
        if (arcMatch) {
            const arc = arcMatch[1];
            if (!arc.includes('→') && !arc.includes('->')) {
                errors.push(`场景${sceneNum}: emotion_arc 未使用 → 符号，无法判定情绪变化`);
            }
        }

        const keySceneRegex = /^\s*\*?\*?key_scene\s*[：:]\s*(.+)$/im;
        const keySceneMatch = sceneContent.match(keySceneRegex);
        if (keySceneMatch) {
            const keySceneText = keySceneMatch[1].trim();
            if (keySceneText.includes('⭐') || keySceneText.includes('名场面')) {
                hasKeyScene = true;
            }
        } else {
            warnings.push(`场景${sceneNum}: 缺少 key_scene 字段（建议标记名场面）`);
        }

        const dialogueFuncRegex = /^\s*\*?\*?dialogue_function\s*[：:]\s*(.+)$/im;
        if (!dialogueFuncRegex.test(sceneContent)) {
            warnings.push(`场景${sceneNum}: 缺少 dialogue_function 字段（建议说明对话功能性）`);
        }

        if (isLastScene) {
            const cliffhangerRegex = /^\s*\*?\*?cliffhanger\s*[：:]\s*(.+)$/im;
            const cliffhangerMatch = sceneContent.match(cliffhangerRegex);
            if (!cliffhangerMatch || cliffhangerMatch[1].trim() === '' || cliffhangerMatch[1].trim() === '无') {
                warnings.push(`场景${sceneNum}(最后一个场景): 缺少 cliffhanger 结尾钩子（建议设置悬念）`);
            }
        }
    }

    if (!hasKeyScene) {
        warnings.push(`本章未标记任何名场面（建议至少选一个场景作为 ⭐ 名场面）`);
    }

    return { valid: errors.length === 0, errors, warnings };
}
