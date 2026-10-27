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
import { fitPromptToContext } from '../shared/prompt-budget';
import { buildCraftSystemBlock } from './craft-constraints';
import { fillTemplate } from './prompts/template-utils';
import { createLogger } from '../shared/logger';

const log = createLogger('SceneExpander');

/** 预算闸门参数（不传时保持旧行为：不裁剪） */
export interface SceneExpandBudget {
    maxContext: number;
    maxOutput: number;
}

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

【预演要求——每场景必须有完整场景卡】
1. pov: 视角人物（默认主角，只写他能感知到的信息）
2. time: 场景内时间（如：黄昏/三日后/子时）
3. location: 具体地点
4. objective: 你走进这个场景是为了什么？
5. entry_state: 入场状态（位置/情绪/已知信息）
6. conflict: 什么在挡你的路？
7. turn: 场景转折（必须发生一次可指认的变化）
8. exit_state: 离场状态（必须与入场不同）
9. emotion_arc: 进来时什么感觉 → 出去时变成什么感觉（必须变化）
10. sensory_hook: 至少2个具体感官细节（气味/温度/声音/触感/画面）
11. memory_trigger: 这个场景有没有让你想起什么？如果某个感官元素触发了你的创伤记忆——写出来。
12. body_reaction: 你的身体怎么反应的？（不自觉的——手指/呼吸/肩膀/胃）
13. subtext: 你说的话和你想说的话之间差了多少？
14. relationship_shift: 和在场的人之间——关系有变化吗？
15. key_scene: 本章至少选一个场景作为【名场面】，标记为 ⭐ 名场面，并说明为什么这个场景会让读者印象深刻
16. dialogue_function: 每段对话必须完成至少一件事——推进剧情/揭露信息/塑造人物/改变关系
17. cliffhanger: 【本章最后一个场景】必须设置结尾钩子
18. craft_notes: 可选，本场景必须避免/必须做到的写作细节

【输出格式——严格遵循】
## 场景N：场景名
pov: 视角人物（默认主角，不得进入其他人物内心）
time: 场景内时间（如：黄昏/三日后/子时）
location: 具体地点
objective: 本场景目标
entry_state: 入场状态（人物位置/情绪/已知信息）
conflict: 核心冲突
turn: 场景转折（必须发生一次可指认的变化）
exit_state: 离场状态（必须与入场不同）
emotion_arc: XXX(N) → XXX(N) — 原因
sensory_hook: 至少2个具体感官细节（气味/温度/声音/触感/画面）
memory_trigger: 无 / 触发 m00X — 什么触发的
body_reaction: ...
subtext: ...
relationship_shift: ...
key_scene: ⭐ 名场面 — 原因（非名场面写"否"）
dialogue_function: 本段对话完成了什么（推进剧情/揭露XX信息/塑造XX性格/改变XX关系）
cliffhanger: （仅最后一个场景填写，钩子内容）
craft_notes: 可选，本场景必须避免/必须做到的写作细节

【约束】
- POV 必须是视角人物；只写他能感知到的信息，不进入其他人物内心
- time/location 必须具体；场景之间切换必须写出时间推移或空间移动
- objective 必须是主角的——不是作者给角色分配的任务
- entry_state 与 exit_state 必须不同；如果人物状态没有变化，这个场景不成立
- turn 必须是可指认的事件/信息/决定，不是“情绪变得更复杂”
- emotion_arc 的两个情绪必须不同
- sensory_hook 必须具体——不是"气氛紧张"，是"闻到铁锈味"或"手摸到冰凉的金属"
- body_reaction 是不自觉的——不是"他决定握紧拳头"，是"拳头自己收紧了，他发现时指甲已掐进掌心"
- subtext 是说vs想的差距——说了什么，心里真正想的是什么
- key_scene 每章至少1个，要选真正有冲击力的时刻，不要随便选
- dialogue_function 要具体——不要写"推进剧情"，要写"揭露了反派的真实身份"或"让两人关系从敌对转为合作"
- cliffhanger 必须让人想立刻翻下一页——不能是平淡的收尾
- 第1个场景必须承接【上一章结尾】的时间、地点、人物状态与情绪，不得无过渡跳转
- 本章时间只许前进或原地，不得倒退；与【时间线】冲突时以时间线为准
- 场景之间切换必须有过渡（时间推移/空间移动/视角转移），不得凭空换场
- 只演出【信息规划】与【大纲】已确定的事件，不得自行新增情节节点或反转`;

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

【情节节点——本章必须发生的具体事件】
\${distilledContent}

【信息规划——本章必须释放/保留的信息】
\${infoPlan}

【上一章结尾——本章第一个场景必须从这里接上】
\${prevChapEnding}

【时间线——本章时间不得倒退】
\${timelineEvents}

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
    budget?: SceneExpandBudget,
    customPrompt?: { systemPrompt?: string; userPrompt?: string },
    options?: { maxTokens?: number; signal?: AbortSignal },
): Promise<string> {
    const sceneKnowledgeForTemplate = (vars.sceneKnowledge || '').trim();
    const defaultSystemPrompt = `${SCENE_EXPAND_SYSTEM_PROMPT
        .replace(/\${protagonistSoul}/g, vars.characterCores || '')
        .replace(/\${triggeredMemories}/g, vars.triggeredMemories || '无。')}

${buildCraftSystemBlock()}`;
    const systemPrompt = customPrompt?.systemPrompt
        ? `${fillTemplate(customPrompt.systemPrompt, { ...vars, sceneKnowledge: sceneKnowledgeForTemplate })}\n\n${buildCraftSystemBlock()}`
        : defaultSystemPrompt;

    // 知识注入单独作为增强层：超预算时整段丢弃，而不是拼在正文主体里被尾部截断
    const sceneKnowledge = sceneKnowledgeForTemplate;

    const defaultUserPrompt = SCENE_EXPAND_USER_TEMPLATE
        .replace(/\${protagonistName}/g, vars.protagonistName || '主角')
        .replace(/\${chapNum}/g, vars.chapNum || '?')
        .replace(/\${worldView}/g, vars.worldView || '暂无世界观设定。')
        .replace(/\${settingLib}/g, vars.settingLib || '暂无设定库。')
        .replace(/\${powerSystem}/g, vars.powerSystem || '暂无力量体系设定。')
        .replace(/\${worldType}/g, vars.worldType || '未知世界类型。')
        .replace(/\${outlineContent}/g, vars.outlineContent || '')
        .replace(/\${infoPlan}/g, vars.infoPlan || '（未执行信息规划：只演出大纲已确定的事件，不得新增情节节点）')
        .replace(/\${distilledContent}/g, vars.distilledContent || '（未执行情节蒸馏：只按大纲事件展开，不要新增情节节点）')
        .replace(/\${prevChapEnding}/g, vars.prevChapEnding || '（无上一章结尾信息：不要编造上一章结尾）')
        .replace(/\${timelineEvents}/g, vars.timelineEvents || '（无时间线信息：本章时间不得倒退，场景顺序必须符合因果）')
        .replace(/\${emotionPlan}/g, vars.emotionPlan || '无情绪规划。')
        .replace(/\${triggeredMemories}/g, vars.triggeredMemories || '无。')
        .replace(/\${allChars}/g, vars.allChars || '')
        .replace(/\${sceneKnowledge}/g, '');
    const userPrompt = customPrompt?.userPrompt
        ? fillTemplate(customPrompt.userPrompt, { ...vars, sceneKnowledge: sceneKnowledgeForTemplate })
        : defaultUserPrompt;

    let effectiveUser = userPrompt;
    if (budget && budget.maxContext > 0) {
        const fit = fitPromptToContext({
            systemPrompt,
            userPrompt,
            extraTail: sceneKnowledge,
            maxContext: budget.maxContext,
            maxOutput: budget.maxOutput,
            modelId: model,
            sectionAware: true,
        });
        effectiveUser = fit.user;
        if (fit.droppedExtra) {
            log.warn(`[SceneExpander] 上下文不足，已跳过知识注入: ~${fit.estimatedTokens}t`);
            notifier.showNotice('⚠️ 上下文不足，已跳过场景展开的知识注入');
        }
        if (fit.truncated) {
            log.warn(`[SceneExpander] prompt 过长，已保留头部+尾部: ~${fit.estimatedTokens}t`);
        }
    } else if (sceneKnowledge) {
        effectiveUser = `${userPrompt}\n\n${sceneKnowledge}`;
    }

    notifier.showNotice('🎬 正在展开场景设计...');
    const response = await aiEngine.callAI(
        systemPrompt,
        effectiveUser,
        model,
        0.7,
        options?.maxTokens ?? budget?.maxOutput,
        options?.signal ? { signal: options.signal } : undefined,
    );
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

/** 场景标题行：兼容 ## / ### / #### 标题、中文「场景N」与英文「sceneN」写法 */
export const SCENE_HEADING_SOURCE =
    '^#{2,6}[ \\t]*(?:场景[ \\t]*([一二三四五六七八九十百千万亿零〇两]+|\\d+)|scene[ \\t]*(\\d+))[ \\t]*[：:][ \\t]*(.*)$';

/** 解析出的场景标题 */
export interface SceneHeading {
    /** 场景序号；标题中无法解析时按出现顺序兜底 */
    index: number;
    /** 场景标题 */
    name: string;
    /** 标题行起始偏移 */
    start: number;
    /** 标题行结束偏移（场景正文起点） */
    end: number;
}

/** 解析 Scene 展开内容中的场景标题位置（所有场景相关解析的唯一入口） */
export function parseSceneHeadings(content: string): SceneHeading[] {
    const headings: SceneHeading[] = [];
    if (!content) return headings;

    const regex = new RegExp(SCENE_HEADING_SOURCE, 'gim');
    let m: RegExpExecArray | null;
    while ((m = regex.exec(content)) !== null) {
        let index = headings.length + 1;
        if (m[1] !== undefined) {
            index = parseChineseNumber(m[1]) ?? index;
        } else if (m[2] !== undefined) {
            index = parseInt(m[2], 10) || index;
        }
        headings.push({
            index,
            name: m[3].trim(),
            start: m.index,
            end: m.index + m[0].length,
        });
    }
    return headings;
}

/** 按场景标题切分场景正文 */
export function splitSceneSections(content: string): { heading: SceneHeading; body: string }[] {
    const headings = parseSceneHeadings(content);
    return headings.map((heading, i) => ({
        heading,
        body: content.slice(heading.end, i + 1 < headings.length ? headings[i + 1].start : content.length),
    }));
}

/**
 * 校验 Scene 展开是否包含必要要素
 */
export function validateSceneExpansion(content: string): { valid: boolean; errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];

    const scenes = parseSceneHeadings(content).map(heading => ({ index: heading.start, num: heading.index }));

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

        // 场景卡新字段：旧文件缺失只告警，不阻断；新生成提示词会强制要求
        const sceneCardFields = ['pov', 'time', 'location', 'entry_state', 'turn', 'exit_state'];
        for (const field of sceneCardFields) {
            const fieldRegex = new RegExp(`^\\s*\\*?\\*?${field}\\s*[：:]\\s*`, 'im');
            if (!fieldRegex.test(sceneContent)) {
                warnings.push(`场景${sceneNum}: 缺少 ${field} 字段（场景卡不完整，建议重新生成或补填）`);
            }
        }

        const entry = sceneContent.match(/^\s*\*?\*?entry_state\s*[：:]\s*(.+)$/im)?.[1]?.trim();
        const exit = sceneContent.match(/^\s*\*?\*?exit_state\s*[：:]\s*(.+)$/im)?.[1]?.trim();
        if (entry && exit && entry === exit) {
            warnings.push(`场景${sceneNum}: entry_state 与 exit_state 相同，场景没有发生状态变化`);
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
