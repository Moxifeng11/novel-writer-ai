import NovelWriterPlugin from '../main';
import { AIApiClient } from './ai-api-client';
import type { APIResponse } from './ai-engine';
import type { Notifier } from '../shared/types';
import { NOOP_NOTIFIER, SceneNode, SCENE_TYPE_LABELS } from '../shared/types';
import { BodyWriter } from './body-writer';
import { describeBodyFormat } from '../shared/body-format';

export interface SceneExpandContext {
    projectId: string;
    volumeNumber: number;
    chapterNumber: number;
    chapterConflict: string;
    chapterSummary: string;
    worldview: string;
    characters: string;
    locations: string;
    factions: string;
    items: string;
    powerSystem: string;
    protagonistName: string;
    protagonistSoul?: string;
    emotionPlan?: string;
}

export class SceneExpander {
    private plugin: NovelWriterPlugin;
    private notifier: Notifier;
    private apiClient: AIApiClient;
    private bodyWriter: BodyWriter;

    constructor(plugin: NovelWriterPlugin, apiClient: AIApiClient, notifier?: Notifier) {
        this.notifier = notifier || NOOP_NOTIFIER;
        this.plugin = plugin;
        this.apiClient = apiClient;
        this.bodyWriter = new BodyWriter({ app: plugin.app });
    }

    async expandScene(scene: SceneNode, context: SceneExpandContext): Promise<APIResponse> {
        // 扩写输出与正文落盘共用同一份格式契约
        const bodyFormat = await this.bodyWriter.resolveContract(context.projectId);
        const systemPrompt = `你是专业的小说作家。根据场景细纲，将其扩写为生动的小说文本。

【写作铁律——不可违反】
1. 必须遵循世界观和力量体系设定，不得出现与设定不符的元素
2. 必须使用已有角色，角色名字和性格要保持一致
3. 字数控制在 ${scene.wordCountPlan} 字左右，误差不超过 ±20%
4. 场景类型决定写作风格：
   - action（动作场面）：节奏紧凑，注重动作描写和感官体验
   - dialogue（对话推进）：对话要自然，有潜台词，推动剧情发展
   - emotion（情绪/内心描写）：深入角色内心，细腻描写情绪变化
   - description（环境/感官描写）：注重氛围营造，调动五感
   - transition（场景转换）：流畅过渡，衔接自然
   - climax（高潮戏）：情绪饱满，冲突激烈，有冲击力
   - foreshadow（伏笔埋设）：巧妙埋设伏笔，不刻意不突兀
   - resolution（收束）：收束得当，为下一场景铺垫

${describeBodyFormat(bodyFormat)}

【写作技巧】
1. 感官描写：调动视觉、听觉、嗅觉、味觉、触觉
2. 动作细节：具体的动作描写，避免笼统
3. 情绪表达：通过动作、对话、内心独白来表达情绪
4. 节奏把控：根据场景类型调整叙述节奏
5. 留白艺术：适当留白，让读者自行想象

不要输出"场景X：XXX"等标题，只输出小说正文。`;

        const userPrompt = `请根据以下场景细纲，扩写为 ${scene.wordCountPlan} 字左右的小说文本。

【场景信息】
- **场景序号**：第${scene.order}场
- **场景标题**：${scene.title}
- **场景类型**：${SCENE_TYPE_LABELS[scene.type]}
- **场景目标**：${scene.objective}
- **场景障碍**：${scene.obstacle}
- **场景结果**：${scene.outcome}
- **情绪变化曲线**：${scene.emotionArc}

【章节信息】
- **卷号**：第${context.volumeNumber}卷
- **章号**：第${context.chapterNumber}章
- **核心冲突**：${context.chapterConflict}
- **章节概览**：${context.chapterSummary}

【世界观】
${context.worldview.slice(0, 2000)}

【力量体系】
${context.powerSystem || '无'}

【已有角色】
${context.characters || '无'}

【已有地点】
${context.locations || '无'}

【已有势力】
${context.factions || '无'}

【已有物品功法】
${context.items || '无'}

【主角信息】
${context.protagonistName}

【场景概要】
${scene.summary}

【关键对话要点】
${scene.keyDialogues?.join('\n') || '无'}

【要求】
1. 字数控制在 ${scene.wordCountPlan} 字左右
2. 风格符合场景类型：${SCENE_TYPE_LABELS[scene.type]}
3. 注重感官描写和动作细节
4. 对话要有潜台词，推动剧情发展
5. 情绪变化要自然流畅
6. 结尾要为下一场景铺垫`;

        return this.apiClient.callAI(systemPrompt, userPrompt, this.plugin.settings.flashModel, 0.7, this.plugin.settings.maxOutput);
    }

    async expandChapter(scenes: SceneNode[], context: SceneExpandContext): Promise<APIResponse> {
        const bodyFormat = await this.bodyWriter.resolveContract(context.projectId);
        const systemPrompt = `你是专业的小说作家。根据多个场景细纲，将其扩写为完整的章节内容。

【写作铁律——不可违反】
1. 必须遵循世界观和力量体系设定，不得出现与设定不符的元素
2. 必须使用已有角色，角色名字和性格要保持一致
3. 场景之间要有自然的衔接和过渡
4. 整体节奏要有起伏，避免平铺直叙
5. 高潮场景要情绪饱满，有冲击力
6. 结尾要有钩子，让读者想继续阅读

${describeBodyFormat(bodyFormat)}

【写作技巧】
1. 场景衔接：场景之间要有自然的过渡段落
2. 节奏把控：动作场景节奏快，情感场景节奏慢
3. 情绪递进：整个章节的情绪要有递进关系
4. 伏笔呼应：前面埋设的伏笔在后面要有呼应
5. 人物成长：章节结束时角色要有变化或成长

不要输出章节标题，只输出小说正文。`;

        const sceneList = scenes.map((scene, index) => {
            return `【场景${index + 1}】${scene.title}（${SCENE_TYPE_LABELS[scene.type]}）\n目标：${scene.objective}\n障碍：${scene.obstacle}\n概要：${scene.summary}`;
        }).join('\n\n');

        const userPrompt = `请根据以下场景细纲列表，扩写为完整的章节内容。

【章节信息】
- **卷号**：第${context.volumeNumber}卷
- **章号**：第${context.chapterNumber}章
- **核心冲突**：${context.chapterConflict}
- **章节概览**：${context.chapterSummary}

【世界观】
${context.worldview.slice(0, 2000)}

【力量体系】
${context.powerSystem || '无'}

【已有角色】
${context.characters || '无'}

【已有地点】
${context.locations || '无'}

【已有势力】
${context.factions || '无'}

【已有物品功法】
${context.items || '无'}

【主角信息】
${context.protagonistName}

【情绪规划】
${context.emotionPlan || '无'}

【场景列表】
${sceneList}

【要求】
1. 将所有场景连贯地写成一个完整章节
2. 场景之间要有自然的过渡
3. 节奏要有起伏，高潮场景要突出
4. 注重感官描写和动作细节
5. 对话要有潜台词，推动剧情发展
6. 结尾要有钩子，让读者想继续阅读`;

        return this.apiClient.callAI(systemPrompt, userPrompt, this.plugin.settings.flashModel, 0.7, 8192);
    }

    async expandSceneWithMemory(scene: SceneNode, context: SceneExpandContext): Promise<APIResponse> {
        const bodyFormat = await this.bodyWriter.resolveContract(context.projectId);
        const systemPrompt = `你就是主角本人。现在你正在经历这个场景——不是在写小说，是在真实地体验。

${context.protagonistSoul || ''}

【写作铁律——不可违反】
1. 你是第一人称视角，用"我"来叙述
2. 必须遵循世界观和力量体系设定
3. 感官体验要真实具体，不是笼统描述
4. 情绪变化要发自内心，不是表面描写
5. 身体反应是不自觉的，不是刻意为之
6. 潜台词要通过内心独白和行动来体现

${describeBodyFormat(bodyFormat)}

【写作技巧】
1. 感官入口：身体第一个感受到的是什么？（气味/温度/声音/触感）
2. 记忆触发：这个场景有没有让你想起什么？如果某个感官元素触发了记忆——写出来
3. 身体反应：你的身体怎么反应的？（不自觉的——手指/呼吸/肩膀/胃）
4. 情绪变化：进来时什么感觉 → 出去时变成什么感觉
5. 潜台词：你说的话和你想说的话之间差了多少？

不要输出"场景X：XXX"等标题，只输出小说正文。`;

        const userPrompt = `你是${context.protagonistName}。现在你正在经历以下场景。

【场景信息】
- **场景序号**：第${scene.order}场
- **场景标题**：${scene.title}
- **场景类型**：${SCENE_TYPE_LABELS[scene.type]}
- **场景目标**：${scene.objective}
- **场景障碍**：${scene.obstacle}
- **场景结果**：${scene.outcome}
- **情绪变化曲线**：${scene.emotionArc}

【章节信息】
- **卷号**：第${context.volumeNumber}卷
- **章号**：第${context.chapterNumber}章
- **核心冲突**：${context.chapterConflict}

【世界观】
${context.worldview.slice(0, 1500)}

【力量体系】
${context.powerSystem || '无'}

【场景概要】
${scene.summary}

【关键对话要点】
${scene.keyDialogues?.join('\n') || '无'}

【要求】
1. 第一人称视角，用"我"来叙述
2. 感官描写要具体真实
3. 情绪变化要发自内心
4. 身体反应是不自觉的
5. 潜台词要通过内心独白体现`;

        return this.apiClient.callAI(systemPrompt, userPrompt, this.plugin.settings.flashModel, 0.7, this.plugin.settings.maxOutput);
    }
}