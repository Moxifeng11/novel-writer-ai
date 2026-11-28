import type { PromptTemplate, PromptCategory } from '@/shared/prompt-manager-types';
import { BODY_GENERATION_SYSTEM_PROMPT_V2, BODY_GENERATION_USER_TEMPLATE_V2 } from '@/shared/prompts/body-v2-prompts';
import { INFO_PLAN_PROMPTS, PLOT_DISTILL_PROMPTS, OUTLINE_PROMPTS } from '@/shared/prompts/chapter-pipeline-prompts';
import { EMOTION_PLAN_PROMPTS, SCENE_EXPAND_PROMPTS } from '@/shared/prompts/soul-driven-prompts';

const now = Date.now();

function createTemplate(
    id: string,
    name: string,
    category: PromptCategory,
    description: string,
    systemPrompt: string,
    userPrompt: string,
    variables: Array<{ name: string; description: string; type?: 'string' | 'number' | 'boolean'; default?: string; required?: boolean }> = [],
    version = '1.0.0'
): PromptTemplate {
    return {
        id,
        name,
        category,
        description,
        variables: variables.map(v => ({
            name: v.name,
            type: v.type || 'string',
            default: v.default,
            description: v.description,
            required: v.required ?? false,
        })),
        versions: [
            {
                version,
                createdAt: now,
                systemPrompt,
                userPrompt,
                description: '初始版本',
                isActive: true,
            },
        ],
        createdAt: now,
        updatedAt: now,
        tags: [category],
    };
}

/**
 * DEFAULT_PROMPT_TEMPLATES 常量。
 */
export const DEFAULT_PROMPT_TEMPLATES: PromptTemplate[] = [
    createTemplate(
        'info-plan',
        '信息规划',
        'chapter',
        '章节信息规划（核心冲突/熵预算/信息释放）。文本与引擎 getStepTemplate 同源（2026-11-28 修复漂移）',
        INFO_PLAN_PROMPTS.systemPrompt,
        INFO_PLAN_PROMPTS.userPrompt,
        [
            { name: 'forcedRevealHint', description: '强制揭示提示', required: false },
            { name: 'chapNum', description: '章节号', required: true },
            { name: 'chapPlan', description: '分卷规划', required: false },
            { name: 'fanficRules', description: '同人规则块', required: false },
            { name: 'worldView', description: '世界观', required: false },
            { name: 'settingLib', description: '设定库', required: false },
            { name: 'writingStyleContent', description: '文笔风格', required: false },
            { name: 'outlineContent', description: '大纲内容', required: false },
            { name: 'prevChaptersSummary', description: '前文摘要', required: false },
            { name: 'prevChapEnding', description: '上一章结尾', required: false },
            { name: 'unrevealedForeshadow', description: '未揭示伏笔', required: false },
            { name: 'openPromises', description: '未兑现承诺', required: false },
            { name: 'characterArcs', description: '角色弧线', required: false },
            { name: 'timelineEvents', description: '时间线事件', required: false },
            { name: 'entityContext', description: '已有实体上下文', required: false },
        ]
    ),

    createTemplate(
        'plot-distill',
        '情节蒸馏',
        'chapter',
        '情节蒸馏（场景与信息提炼）。文本与引擎 getStepTemplate 同源（2026-11-28 修复漂移）',
        PLOT_DISTILL_PROMPTS.systemPrompt,
        PLOT_DISTILL_PROMPTS.userPrompt,
        [
            { name: 'chapNum', description: '章节号', required: true },
            { name: 'infoPlan', description: '信息规划', required: false },
            { name: 'chapPlan', description: '分卷规划', required: false },
            { name: 'fanficRules', description: '同人规则块', required: false },
            { name: 'worldView', description: '世界观', required: false },
            { name: 'settingLib', description: '设定库', required: false },
            { name: 'outlineContent', description: '大纲内容', required: false },
            { name: 'prevChaptersSummary', description: '前文摘要', required: false },
            { name: 'prevChapEnding', description: '上一章结尾', required: false },
            { name: 'unrevealedForeshadow', description: '未揭示伏笔', required: false },
            { name: 'timelineEvents', description: '时间线事件', required: false },
            { name: 'allChars', description: '人物状态', required: false },
        ]
    ),

    createTemplate(
        'outline-generation',
        '大纲生成',
        'chapter',
        '章节大纲（关键场景路线图）。文本与引擎 getStepTemplate 同源（2026-11-28 修复漂移）',
        OUTLINE_PROMPTS.systemPrompt,
        OUTLINE_PROMPTS.userPrompt,
        [
            { name: 'infoPlan', description: '信息规划', required: false },
            { name: 'distilledContent', description: '情节蒸馏内容', required: false },
            { name: 'worldView', description: '世界观', required: false },
            { name: 'settingLib', description: '设定库', required: false },
            { name: 'writingStyleContent', description: '文笔风格', required: false },
            { name: 'prevChaptersSummary', description: '前文摘要', required: false },
            { name: 'prevChapEnding', description: '上一章结尾', required: false },
            { name: 'unrevealedForeshadow', description: '未揭示伏笔', required: false },
            { name: 'timelineEvents', description: '时间线事件', required: false },
            { name: 'entityContext', description: '已有实体上下文', required: false },
            { name: 'fanficRules', description: '同人规则块', required: false },
            { name: 'protagonistName', description: '主角名字', required: true },
            { name: 'protagonistSoulDetail', description: '主角灵魂细节', required: false },
        ]
    ),

    createTemplate(
        'body-generation-v2',
        '正文生成（V2小说家模式）',
        'chapter',
        'V2版本正文生成，贴身镜头+灵魂+演变。文本与 engine/prompts/body-v2-prompts.ts 同源（2026-11-28 修复两份漂移）',
        BODY_GENERATION_SYSTEM_PROMPT_V2,
        BODY_GENERATION_USER_TEMPLATE_V2,
        [
            { name: 'lensDeclaration', description: '镜头声明（本章视角人物与感知边界）', required: false },
            { name: 'protagonistName', description: '主角名字', required: true },
            { name: 'protagonistSoulDetail', description: '主角灵魂细节', required: false },
            { name: 'triggeredMemories', description: '触发的记忆', required: false },
            { name: 'writingRules', description: '写作规则', required: false },
            { name: 'worldType', description: '世界类型', required: false },
            { name: 'worldEra', description: '时代背景', required: false },
            { name: 'forbiddenElements', description: '禁忌元素', required: false },
            { name: 'powerSystem', description: '力量体系', required: false },
            { name: 'timeContext', description: '当前时间上下文', required: false },
            { name: 'prevChapterStateSnapshot', description: '上一章状态快照', required: false },
            { name: 'bodyFormat', description: '正文格式硬性约束', required: false },
            { name: 'baseWords', description: '基础字数', default: '3000', required: false },
            { name: 'humanVoice', description: '人味约束块（按 humanVoiceMode 组装）', required: false },
            { name: 'protocolLines', description: '结构化变更行指令（structuredChangeLines 开启时非空）', required: false },
            { name: 'outlineContent', description: '大纲内容', required: false },
            { name: 'chapPlan', description: '分卷规划', required: false },
            { name: 'infoPlan', description: '信息规划', required: false },
            { name: 'writingAnnotations', description: '写作批注块（⟨✍⟩ 摘要批注）', required: false },
            { name: 'entityRelations', description: '实体关系', required: false },
            { name: 'emotionPlan', description: '情绪规划', required: false },
            { name: 'sceneExpansion', description: '场景展开', required: false },
            { name: 'sceneCardDigest', description: '场景卡摘要', required: false },
            { name: 'storyContextPack', description: '故事上下文信息包', required: false },
            { name: 'sceneStyleSnippet', description: '场景文风片段', required: false },
            { name: 'suggestedRhythm', description: '建议节奏', required: false },
            { name: 'distilledContent', description: '情节蒸馏内容', required: false },
            { name: 'prevChaptersSummary', description: '前文摘要', required: false },
            { name: 'prevChapEnding', description: '上一章结尾', required: false },
            { name: 'nextChapterHook', description: '下一章开头钩子', required: false },
            { name: 'longTermMemory', description: '长期记忆', required: false },
            { name: 'worldView', description: '世界观', required: false },
            { name: 'settingLib', description: '设定库', required: false },
            { name: 'allChars', description: '人物状态', required: false },
            { name: 'allFactions', description: '所有势力', required: false },
            { name: 'allLocs', description: '所有地点', required: false },
            { name: 'allItems', description: '所有物品', required: false },
            { name: 'timelineEvents', description: '时间线事件', required: false },
            { name: 'unrevealedForeshadow', description: '未揭示伏笔', required: false },
            { name: 'storyLinkage', description: '关联索引（story_linkage.promptText；存在时替代平铺伏笔/时间线）', required: false },
            { name: 'forcedRevealHint', description: '强制揭示提示', required: false },
            { name: 'dialogueSkeleton', description: '台词骨架', required: false },
            { name: 'writingStyleContent', description: '文笔风格', required: false },
            { name: 'fanficRules', description: '同人规则块', required: false },
            { name: 'chapNum', description: '章节号', required: true },
        ]
    ),

    createTemplate(
        'character-generation',
        '角色生成',
        'character',
        '生成详细的角色人设',
        `你是一位角色塑造大师。你的任务是创造有血有肉、有深度的角色。

【角色塑造原则】
- 有欲望：角色想要什么？为什么想要？
- 有恐惧：角色害怕什么？恐惧从何而来？
- 有矛盾：外在表现 vs 内心真实
- 有成长空间：角色的弧光是什么？
- 有辨识度：让读者一眼就能记住的特征`,
        `请创建一个角色人设。

【基础信息】
- 类型：\${characterType}
- 名字：\${characterName}
- 性别：\${gender}
- 年龄：\${age}

【题材/世界观】
\${worldContext}

【角色定位】
\${rolePosition}

【参考风格（可选）】
\${referenceStyle}

请输出详细的角色人设，包含以下部分：
## 基础档案
## 外貌特征
## 性格特质
## 核心欲望与恐惧
## 背景故事
## 人际关系
## 能力/特长
## 弱点/软肋
## 成长弧光（角色可能的变化方向）
## 标志性台词/口头禅`,
        [
            { name: 'characterType', description: '角色类型（主角/配角/反派等）', default: '配角' },
            { name: 'characterName', description: '角色名字' },
            { name: 'gender', description: '性别' },
            { name: 'age', description: '年龄' },
            { name: 'worldContext', description: '世界观背景' },
            { name: 'rolePosition', description: '角色定位和作用' },
            { name: 'referenceStyle', description: '参考风格' },
        ]
    ),

    createTemplate(
        'worldview-generation',
        '世界观生成',
        'worldview',
        '生成完整的世界观设定',
        `你是一位世界观架构师。请构建一个逻辑自洽、细节丰富的世界。

【世界观构建维度】
1. 世界概览：世界叫什么？整体是什么样的？
2. 力量体系：有什么特殊力量？规则是什么？
3. 社会结构：政治、经济、阶层是怎样的？
4. 文化风俗：人们的价值观、节日、禁忌？
5. 地理环境：主要的大陆、国家、地貌？
6. 历史背景：重要的历史事件和影响？
7. 种族/族群：有哪些智慧种族？关系如何？`,
        `请生成一个世界观设定。

【题材】\${genre}
【核心概念】\${coreConcept}
【风格基调】\${tone}
【参考作品】\${references}

请输出完整的世界观设定，结构清晰、细节丰富。`,
        [
            { name: 'genre', description: '题材类型', required: true },
            { name: 'coreConcept', description: '核心概念' },
            { name: 'tone', description: '风格基调' },
            { name: 'references', description: '参考作品' },
        ]
    ),

    createTemplate(
        'scene-expand',
        'Scene 展开',
        'chapter',
        '场景任务卡展开。文本与引擎 getStepTemplate 同源（2026-11-28 修复漂移）',
        SCENE_EXPAND_PROMPTS.systemPrompt,
        SCENE_EXPAND_PROMPTS.userPrompt,
        [
            { name: 'protagonistSoul', description: 'protagonistSoul', required: false },
            { name: 'triggeredMemories', description: '触发的记忆', required: false },
            { name: 'protagonistName', description: '主角名字', required: true },
            { name: 'chapNum', description: '章节号', required: true },
            { name: 'outlineContent', description: '大纲内容', required: false },
            { name: 'prevChapEnding', description: '上一章结尾', required: false },
            { name: 'emotionPlan', description: '情绪规划', required: false },
            { name: 'allChars', description: '人物状态', required: false },
            { name: 'timelineEvents', description: '时间线事件', required: false },
            { name: 'fanficRules', description: '同人规则块', required: false },
        ]
    ),

    createTemplate(
        'emotion-plan',
        '情绪规划',
        'chapter',
        '情绪弧规划。文本与引擎 getStepTemplate 同源（2026-11-28 修复漂移）',
        EMOTION_PLAN_PROMPTS.systemPrompt,
        EMOTION_PLAN_PROMPTS.userPrompt,
        [
            { name: 'characterSouls', description: 'characterSouls', required: false },
            { name: 'chapNum', description: '章节号', required: true },
            { name: 'infoPlan', description: '信息规划', required: false },
            { name: 'distilledContent', description: '情节蒸馏内容', required: false },
            { name: 'outlineContent', description: '大纲内容', required: false },
            { name: 'chapPlan', description: '分卷规划', required: false },
            { name: 'fanficRules', description: '同人规则块', required: false },
        ]
    ),

    createTemplate(
        'polish-text',
        '文笔润色',
        'polish',
        '润色和优化文本，提升文笔质量',
        `你是一位资深文学编辑。你的任务是润色文本，提升文笔质量，同时保留原文的核心内容和风格。

【润色原则】
1. 保留原意：不改变原文的情节、人物、核心信息
2. 提升质感：让文字更有画面感、更有温度
3. 精简冗余：去掉啰嗦、重复、空洞的表达
4. 增强节奏：让句子长短错落，有节奏感
5. 感官细节：增加身体感受、环境细节
6. 情绪内化：把直接的情绪描述转化为动作和身体反应`,
        `请润色以下文本。

【原文】
\${originalText}

【润色要求】
\${polishRequirements}

【参考风格】
\${referenceStyle}

请输出润色后的文本，以及润色说明（改了什么、为什么这么改）。`,
        [
            { name: 'originalText', description: '原始文本', required: true },
            { name: 'polishRequirements', description: '润色具体要求', default: '提升文笔质感，保留原意' },
            { name: 'referenceStyle', description: '参考风格' },
        ]
    ),

    createTemplate(
        'deai-text',
        '去AI味改写',
        'polish',
        '去除AI生成痕迹，让文本更像真人写作',
        `你是一位反AI检测专家。你的任务是把AI生成的文本改写成真人写作的感觉。

【AI文本的典型特征（需要避免）】
- 过于工整完美，没有瑕疵
- 形容词堆砌，华而不实
- 句式过于规律，缺少变化
- 情绪表达直接，缺少含蓄
- 没有个人化的表达习惯
- 缺少口语化、接地气的表达

【真人写作的特点（需要增加）】
- 有不完美的地方，偶尔的"啰嗦"或"跳跃"
- 有个人独特的表达习惯
- 情绪藏在字里行间，不直接说破
- 句子长短错落，有呼吸感
- 有具体的、生活化的细节
- 偶尔的留白和未说完的话

【写作规则（全书唯一来源）】
\${writingRules}`,
        `请改写以下文本，去除AI味，让它更像真人写的。

【原文】
\${originalText}

【改写方向】
\${rewriteDirection}

请输出改写后的文本。`,
        [
            { name: 'originalText', description: '原始文本', required: true },
            { name: 'rewriteDirection', description: '改写方向和重点', default: '整体去AI味，更自然' },
        ]
    ),

    createTemplate(
        'co-write-sentence',
        '协同写作续写',
        'cowrite',
        '句级协同写作，续写1-3句',
        `\${lensDeclaration}
只写正在发生的一两秒，不解释、不总结、不站在作者角度。

【写作规则（全书唯一来源）】
\${writingRules}`,
        `【已写内容】
\${precedingText}

【本次续写方向】
\${directionPrompt}
\${cursorHint}

\${isStart ? '这是本章的开头。请根据本章大纲和设定，开始写正文。写 1-3 句（50-150 字）。直接输出正文，不要解释，不要标题。' : '请写 1-3 句（50-150 字）。直接输出正文，不要解释，不要标题。'}`,
        [
            { name: 'precedingText', description: '已写内容', required: true },
            { name: 'directionPrompt', description: '续写方向提示', required: true },
            { name: 'cursorHint', description: '光标位置提示' },
            { name: 'isStart', description: '是否是开头', type: 'boolean', default: 'false' },
        ]
    ),

    createTemplate(
        'self-check',
        '章节自检',
        'chapter',
        '自动检查章节质量问题',
        `你是一位严格的小说质检编辑。请仔细检查这一章，找出所有问题。

【检查维度】
1. 世界观一致性：有没有不符合设定的内容？
2. 人物OOC：角色的言行是否符合其性格？
3. 逻辑漏洞：有没有说不通的地方？
4. 节奏问题：哪里太快/太慢/太拖？
5. 信息密度：有没有信息量不足的段落？
6. 文笔问题：有没有病句、啰嗦、表达不清？
7. 伏笔回收：该揭的伏笔揭了吗？该埋的埋了吗？

【写作规则（全书唯一来源）】
\${writingRules}`,
        `请检查以下章节内容。

【章节内容】
\${chapterContent}

【世界观设定】
\${worldView}

【人物设定】
\${characters}

【前文摘要】
\${prevSummary}

请输出质检报告，按维度列出发现的问题，每个问题说明位置和严重程度。`,
        [
            { name: 'chapterContent', description: '章节内容', required: true },
            { name: 'worldView', description: '世界观设定' },
            { name: 'characters', description: '人物设定' },
            { name: 'prevSummary', description: '前文摘要' },
        ]
    ),
];
