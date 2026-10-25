import NovelWriterPlugin from '../main';
import { AIApiClient } from './ai-api-client';
import type { APIResponse } from './ai-engine';
import type { Notifier } from '../shared/types';
import { NOOP_NOTIFIER, SceneNode, SceneType, SceneStatus } from '../shared/types';
import { createLogger } from '../shared/logger';


const log = createLogger('AiSceneGenerator');
export interface SceneGeneratorContext {
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
    foreshadows?: string;
    targetSceneCount?: number;
}

export class SceneGenerator {
    private plugin: NovelWriterPlugin;
    private notifier: Notifier;
    private apiClient: AIApiClient;

    constructor(plugin: NovelWriterPlugin, apiClient: AIApiClient, notifier?: Notifier) {
        this.notifier = notifier || NOOP_NOTIFIER;
        this.plugin = plugin;
        this.apiClient = apiClient;
    }

    async generateScenes(context: SceneGeneratorContext): Promise<APIResponse> {
        const targetCount = context.targetSceneCount || 3;

        const systemPrompt = `你是专业的小说场景设计师。基于章节大纲，将一章拆分为多个场景，并为每个场景生成详细的细纲。

【不可违反的输出契约】
1. 必须输出 ${targetCount} 个场景，不多不少
2. 每个场景必须包含以下字段：
   - **场景序号**：从1开始的连续数字
   - **场景标题**：简洁的场景名称（10字以内）
   - **场景类型**：必须从以下类型中选择一个：
     - action（动作场面）
     - dialogue（对话推进）
     - emotion（情绪/内心描写）
     - description（环境/感官描写）
     - transition（场景转换）
     - climax（高潮戏）
     - foreshadow（伏笔埋设）
     - resolution（收束）
   - **场景状态**：默认 not_started
   - **场景概要**：50-200字的场景详细描述
   - **涉及人物**：该场景涉及的角色列表
   - **涉及地点**：该场景发生的地点
   - **涉及势力**：该场景涉及的势力
   - **涉及物品功法**：该场景涉及的物品或功法
   - **伏笔引用**：该场景埋设或回收的伏笔（如有）
   - **预计字数**：该场景的预估字数（200-500字）
   - **场景目标**：该场景要达成的目标
   - **场景障碍**：该场景的主要障碍
   - **场景结果**：该场景的预期结果
   - **情绪变化曲线**：该场景的情绪起伏
   - **关键对话要点**：该场景的关键对话（如有）

【输出格式——严格按以下 JSON 格式输出】
{
  "scenes": [
    {
      "id": "scene-uuid-1",
      "order": 1,
      "title": "场景标题",
      "type": "scene_type",
      "status": "not_started",
      "summary": "场景概要（50-200字）",
      "characters": ["角色1", "角色2"],
      "locations": ["地点1"],
      "factions": [],
      "items": [],
      "foreshadowRefs": [],
      "wordCountPlan": 300,
      "wordCountActual": 0,
      "objective": "场景目标",
      "obstacle": "场景障碍",
      "outcome": "场景结果",
      "emotionArc": "情绪变化曲线",
      "keyDialogues": ["对话要点1", "对话要点2"]
    }
  ]
}

【场景设计原则】
1. **节奏把控**：场景之间要有起伏，避免连续的对话或连续的动作
2. **冲突递进**：每个场景的冲突应该比前一个更激烈或更深入
3. **伏笔埋设**：适当在场景中埋设伏笔，为后续剧情做铺垫
4. **人物驱动**：场景应该服务于人物发展，每个场景至少涉及一个核心角色
5. **字数控制**：每章总字数应控制在合理范围内，场景字数分配要均匀

【角色使用铁律】
1. 必须使用已有角色，严禁自创全新角色
2. 如果已有角色不为空，每个场景至少涉及一位已有角色
3. 场景目标和障碍必须与角色动机相关

不要输出任何解释性文字，只输出纯 JSON。`;

        const userPrompt = `请为以下章节生成 ${targetCount} 个场景的详细细纲。

【章节信息】
- **卷号**：第${context.volumeNumber}卷
- **章号**：第${context.chapterNumber}章
- **核心冲突**：${context.chapterConflict}
- **章节概览**：${context.chapterSummary}

【世界观参考】
${context.worldview.slice(0, 2000)}

【已有角色】
${context.characters || '无'}

【已有地点】
${context.locations || '无'}

【已有势力】
${context.factions || '无'}

【已有物品功法】
${context.items || '无'}

【已有伏笔】
${context.foreshadows || '无'}

【要求】
1. 输出 ${targetCount} 个场景，每个场景都要有明确的目标和障碍
2. 场景之间要有逻辑衔接，形成完整的章节故事线
3. 必须使用已有角色，角色名字要与已有角色一致
4. 场景类型要多样化，避免单一类型重复
5. 字数分配要合理，总字数符合章节预期`;

        return this.apiClient.callAI(systemPrompt, userPrompt, this.plugin.settings.flashModel, 0.7, this.plugin.settings.maxOutput);
    }

    parseScenes(response: APIResponse): SceneNode[] {
        const result: SceneNode[] = [];

        try {
            let content = response.content || '';

            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                return this.fallbackParse(content);
            }

            const jsonStr = jsonMatch[0];
            const data = JSON.parse(jsonStr);

            if (data.scenes && Array.isArray(data.scenes)) {
                data.scenes.forEach((sceneData: any, index: number) => {
                    const scene: SceneNode = {
                        id: sceneData.id || `scene-${Date.now()}-${index}`,
                        order: sceneData.order || index + 1,
                        title: sceneData.title || `场景${index + 1}`,
                        type: this.validateSceneType(sceneData.type),
                        status: sceneData.status || 'not_started',
                        summary: sceneData.summary || '',
                        characters: Array.isArray(sceneData.characters) ? sceneData.characters : [],
                        locations: Array.isArray(sceneData.locations) ? sceneData.locations : [],
                        factions: Array.isArray(sceneData.factions) ? sceneData.factions : [],
                        items: Array.isArray(sceneData.items) ? sceneData.items : [],
                        foreshadowRefs: Array.isArray(sceneData.foreshadowRefs) ? sceneData.foreshadowRefs : [],
                        wordCountPlan: sceneData.wordCountPlan || 300,
                        wordCountActual: sceneData.wordCountActual || 0,
                        objective: sceneData.objective || '',
                        obstacle: sceneData.obstacle || '',
                        outcome: sceneData.outcome || '',
                        emotionArc: sceneData.emotionArc || '',
                        keyDialogues: Array.isArray(sceneData.keyDialogues) ? sceneData.keyDialogues : [],
                    };
                    result.push(scene);
                });
            }
        } catch (error) {
            log.error('SceneGenerator: Failed to parse scenes:', error);
            return this.fallbackParse(response.content || '');
        }

        return result;
    }

    private validateSceneType(type: any): SceneType {
        const validTypes: SceneType[] = ['action', 'dialogue', 'emotion', 'description', 'transition', 'climax', 'foreshadow', 'resolution'];
        return validTypes.includes(type) ? type : 'dialogue';
    }

    private fallbackParse(content: string): SceneNode[] {
        const result: SceneNode[] = [];
        const lines = content.split('\n').filter(line => line.trim());

        let currentScene: Partial<SceneNode> | null = null;
        let sceneIndex = 0;

        for (const line of lines) {
            const sceneMatch = line.match(/^(\d+)\.\s*(.+)$/);
            if (sceneMatch) {
                if (currentScene && currentScene.title) {
                    result.push(this.completeScene(currentScene, sceneIndex++));
                }
                currentScene = {
                    order: parseInt(sceneMatch[1]),
                    title: sceneMatch[2].trim(),
                };
                continue;
            }

            if (currentScene) {
                if (line.includes('场景概要') || line.includes('summary')) {
                    const match = line.match(/[：:]\s*(.+)/);
                    if (match) currentScene.summary = match[1].trim();
                } else if (line.includes('涉及人物') || line.includes('characters')) {
                    const match = line.match(/[：:]\s*(.+)/);
                    if (match) currentScene.characters = match[1].split(/[,，、]/).map(s => s.trim()).filter(Boolean);
                } else if (line.includes('涉及地点') || line.includes('location')) {
                    const match = line.match(/[：:]\s*(.+)/);
                    if (match) currentScene.locations = match[1].split(/[,，、]/).map(s => s.trim()).filter(Boolean);
                } else if (line.includes('预计字数') || line.includes('wordCount')) {
                    const match = line.match(/(\d+)/);
                    if (match) currentScene.wordCountPlan = parseInt(match[1]);
                } else if (line.includes('场景目标') || line.includes('objective')) {
                    const match = line.match(/[：:]\s*(.+)/);
                    if (match) currentScene.objective = match[1].trim();
                } else if (line.includes('场景障碍') || line.includes('obstacle')) {
                    const match = line.match(/[：:]\s*(.+)/);
                    if (match) currentScene.obstacle = match[1].trim();
                } else if (line.includes('场景结果') || line.includes('outcome')) {
                    const match = line.match(/[：:]\s*(.+)/);
                    if (match) currentScene.outcome = match[1].trim();
                }
            }
        }

        if (currentScene && currentScene.title) {
            result.push(this.completeScene(currentScene, sceneIndex));
        }

        return result;
    }

    private completeScene(scene: Partial<SceneNode>, index: number): SceneNode {
        return {
            id: scene.id || `scene-${Date.now()}-${index}`,
            order: scene.order || index + 1,
            title: scene.title || `场景${index + 1}`,
            type: scene.type || 'dialogue',
            status: scene.status || 'not_started',
            summary: scene.summary || '',
            characters: scene.characters || [],
            locations: scene.locations || [],
            factions: scene.factions || [],
            items: scene.items || [],
            foreshadowRefs: scene.foreshadowRefs || [],
            wordCountPlan: scene.wordCountPlan || 300,
            wordCountActual: scene.wordCountActual || 0,
            objective: scene.objective || '',
            obstacle: scene.obstacle || '',
            outcome: scene.outcome || '',
            emotionArc: scene.emotionArc || '',
            keyDialogues: scene.keyDialogues || [],
        };
    }
}