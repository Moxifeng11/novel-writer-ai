import NovelWriterPlugin from '@/main';
import type { ReviewContext } from './ai-types';
import { AIApiClient } from './ai-api-client';
import type { APIResponse } from './ai-engine';

import type { Notifier } from '@/shared/types';
import { NOOP_NOTIFIER } from '@/shared/types';
/**
 * 单章 AI 辅助集合（审校/章纲/分析/改写）。
 */
export class ChapterHelpers {
    private plugin: NovelWriterPlugin;
    private notifier: Notifier;
    private apiClient: AIApiClient;

    constructor(plugin: NovelWriterPlugin, apiClient: AIApiClient, notifier?: Notifier) {
        this.notifier = notifier || NOOP_NOTIFIER;
        this.plugin = plugin;
        this.apiClient = apiClient;
    }

    /**
     * 审校章节正文。
     *
     * @param chapterContent - 章节正文
     * @param context - 上下文
     * @returns 审校结果
     */
    async reviewChapter(chapterContent: string, context: ReviewContext): Promise<APIResponse> {
        const systemPrompt = `你是一位严谨的小说连贯性审查员。请从多个维度审查章节内容。

审查维度：
1. 设定冲突：正文与设定库是否矛盾
2. 人物OOC：行为是否符合核心动机和性格
3. 前后文连贯：是否与前章无缝衔接
4. 伏笔逻辑：揭示是否合理，有无遗漏

输出格式：
使用Markdown格式，每个问题一行：
❌ 设定冲突：描述
❌ 人物OOC：描述
⚠️ 连贯性问题：描述
⚠️ 伏笔问题：描述
✅ 通过：维度名称`;

        const userPrompt = `请审查以下章节：

【章节内容】${chapterContent.slice(0, 3000)}

【人物设定】${context.characters?.slice(0, 1000) || '无'}

【设定库】${context.settingLib?.slice(0, 1000) || '无'}

${context.previousChapter ? `【前章内容】${context.previousChapter.slice(-500)}` : ''}`;

        return this.apiClient.callAI(systemPrompt, userPrompt, this.plugin.settings.flashModel, 0.3, this.plugin.settings.maxOutput);
    }



    /**
     * 抽取章节要素。
     *
     * @param bodyText - 正文文本
     * @returns 要素结果
     */
    async extractElements(bodyText: string): Promise<APIResponse> {
        const systemPrompt = `你是一个小说元素提取器。从正文中提取所有新出现的人物、地点、势力、功法/武技/法宝/物品、伏笔、时间线事件。

【规则】
1. 只提取正文中首次出现的元素
2. 如果该元素名明显是常见词（如"剑""刀""桌子"），不提取
3. 必须是专有名词级别的命名（如"炼体诀""青云宗"）
4. 输出格式严格如下，每行一个，不要额外解释：

CHARACTER: 角色名 | 角色简要描述
LOCATION: 地名 | 地点简要描述
FACTION: 势力名 | 势力简要描述
ITEM: 物品/功法/武技/法宝名 | 类型
FORESHADOW: 伏笔内容 | 指向章节或事件
TIMELINE: 时间点 | 事件描述`;

        const userContent = `请从以下正文中提取所有新元素：\n\n${bodyText.slice(0, 8000)}`;

        return this.apiClient.callAI(systemPrompt, userContent, this.plugin.settings.flashModel, 0.5, this.plugin.settings.maxOutput);
    }

}
