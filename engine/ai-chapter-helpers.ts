import NovelWriterPlugin from '@/main';
import {
    DEAI_CHECK_SYSTEM_PROMPT,
    DEAI_CHECK_USER_TEMPLATE,
    DEAI_REWRITE_SYSTEM_PROMPT,
    DEAI_REWRITE_USER_TEMPLATE,
    SELF_CHECK_PROMPTS,
    FIX_PROMPTS,
} from './prompt-templates';
import type { ChapterContext, ReviewContext } from './ai-types';
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
     * 生成章节规划。
     *
     * @param context - 上下文
     * @returns 规划文本
     */
    async generateChapterPlan(context: ChapterContext): Promise<APIResponse> {
        const systemPrompt = `你是一个小说章节规划师。根据以下素材，为章节生成「章节信息规划」。

【核心约束】规划本章时，核心冲突和人物行动必须基于已有的角色列表，严禁自创新主角或核心配角。

输出格式：
使用 Markdown 格式，包含：章名、核心冲突、熵预算、自信息目标、互信息强化、伏笔操作。`;

        const userPrompt = `根据以下素材，为第${context.chapterNumber}章生成「章节信息规划」。

【已有角色】${context.characters?.slice(0, 2000) || '无'}
【分卷规划】${context.chapterPlan?.slice(0, 500) || '无'}
【大纲摘要】${context.outline?.slice(0, 1000) || '无'}
【前文摘要】${context.previousChapters?.slice(0, 1500) || '无'}
【未揭示伏笔】${context.unrevealedForeshadow?.slice(0, 500) || '无'}
【时间线】${context.timelineEvents?.slice(0, 500) || '无'}
【规划原则】核心冲突必须基于已有角色展开，严禁自创主角。`;

        return this.apiClient.callAI(systemPrompt, userPrompt, this.plugin.settings.flashModel, 0.7, this.plugin.settings.maxOutput);
    }

    /**
     * 生成章节分析报告。
     *
     * @param bodyText - 正文文本
     * @returns 报告
     */
    async generateAnalysisReport(bodyText: string): Promise<APIResponse> {
        const systemPrompt = `你是一位小说信息论分析师兼元素提取器。对正文做两件事：

1. **新元素提取（优先）**：逐段扫描正文，提取所有首次出现的专有名词级别的新元素。
2. **信息论分析**：互信息断裂检测、自信息事件评估。

【元素提取规则】
- 只提取专有名词级别的命名（如"炼体诀""青云宗"），常见词（剑/刀/桌子）不提取
- 功法名、法宝名、武技名必须提取，即使出现一次也算
- 人物名如果明显是新角色（非已有角色）才提取
- 位置/势力/物品同理

【输出格式——严格遵循，不要额外解释】
UPDATE_CHARACTER: [[角色]] | 当前状态 | 新值
UPDATE_CHARACTER: [[角色]] | 修为等级 | 新值
UPDATE_CHARACTER: [[角色]] | 当前位置 | 新值
UPDATE_CHARACTER: [[角色]] | 所属势力 | 新值
UPDATE_FORESHADOW: [[伏笔]] | 状态 | 已揭示
NEW_CHARACTER: 角色名 | 角色描述
NEW_LOCATION: 地名 | 地点描述
NEW_FACTION: 势力名 | 势力描述
NEW_ITEM: 物品/功法/法宝名 | 简要描述
NEW_FORESHADOW: 伏笔内容 | 埋入章节 | 预期揭示
NEW_TIMELINE: 时间点 | 事件

【分析要求（在提取指令之后输出）】
- 互信息断裂检测
- 自信息事件评估（1-10分）
- 续写建议`;

        const userPrompt = `【正文】${bodyText.slice(0, 5000)}\n\n请完成新元素提取和信息论分析。元素提取指令放在前面，分析内容放在后面。`;

        return this.apiClient.callAI(systemPrompt, userPrompt, this.plugin.settings.flashModel, 0.5, this.plugin.settings.maxOutput);
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

    /**
     * 分析章节文风。
     *
     * @param novelName - 小说名
     * @param signal - 取消信号
     * @returns 文风分析
     */
    async analyzeStyle(novelName: string, signal?: AbortSignal): Promise<APIResponse> {
        const systemPrompt = `你是一位资深网络小说编辑，精通各大平台（番茄、起点、七猫等）热门小说的文笔风格分析。

根据用户提供的小说名称，分析该小说的文笔风格特征，按照以下格式输出分析报告。

注意：你只需要输出格式中的内容，不要输出额外说明。

【格式】
## 一、叙事视角
- 视角：（第一人称/第三人称/多视角）
- 是否限知：（限知/全知）

## 二、文笔特征
### 总体风格
（用一句话概括，如：简洁冷峻、幽默诙谐、华丽铺陈、热血激昂等）

### 句式特征
（长短句使用习惯、修辞特点）

### 用语习惯
（口语化/文雅、现代/古风、是否有特色用词）

## 三、对话风格
（对话占比、角色说话风格差异、是否有标志性口头禅等）

## 四、描写风格
（描写侧重：环境/动作/心理、描写占比、描写手法特点）

## 五、叙事节奏
（紧张情节和舒缓情节的段落节奏、场景切换方式）

## 六、情感表达方式
（直接描写还是通过动作/对话暗示，是否有心理独白习惯）

## 七、禁用/慎用
（该小说避免使用的表达方式）

## 八、参考作品信息
- 作者：
- 平台：
- 类型：
- 风格关键词：（3-5个词）

---

【分析要求】
1. 如果你对该小说的文笔风格有足够了解，基于已有知识分析
2. 如果不确定某个具体特征，基于该小说的类型和常见风格推断，但标注"推测"
3. 输出要具体，不要泛泛而谈
4. 每个特征都要有具体的例子或描述`;

        const userPrompt = `请分析《${novelName}》的文笔风格特征，按指定格式输出分析报告。`;

        return this.apiClient.callAI(systemPrompt, userPrompt, this.plugin.settings.flashModel, 0.7, this.plugin.settings.maxOutput, { signal });
    }

    /**
     * 执行去 AI 味改写。
     *
     * @param bodyText - 正文文本
     * @returns 改写结果
     */
    async deaiRewrite(bodyText: string): Promise<{
        original: string;
        checkReport: string;
        rewritten: string;
    }> {
        const checkSysPrompt = DEAI_CHECK_SYSTEM_PROMPT;
        const checkUserPrompt = DEAI_CHECK_USER_TEMPLATE.replace('${bodyText}', bodyText);
        const checkResult = await this.apiClient.callAI(checkSysPrompt, checkUserPrompt, this.plugin.settings.flashModel, 0.3, 2048);
        
        const rewriteSysPrompt = DEAI_REWRITE_SYSTEM_PROMPT
            .replace(/\$\{writingRules\}/g, '（见项目写作规则与上下文设定）');
        const rewriteUserPrompt = DEAI_REWRITE_USER_TEMPLATE
            .replace('${deaiReport}', checkResult.content)
            .replace('${bodyText}', bodyText);
        const rewriteResult = await this.apiClient.callAI(rewriteSysPrompt, rewriteUserPrompt, this.plugin.settings.proModel, 0.8, this.plugin.settings.maxOutput, { isWritingTask: true });
        
        return {
            original: bodyText,
            checkReport: checkResult.content,
            rewritten: rewriteResult.content
        };
    }

    /**
     * 执行迭代精修。
     *
     * @param bodyText - 正文文本
     * @param contextPrompt - 上下文提示词
     * @param maxRounds - 最大轮次
     * @param chapNum - 章号
     * @param onProgress - 进度回调
     * @returns 精修结果
     */
    async iterativeRefine(
        bodyText: string, 
        contextPrompt: string,
        maxRounds: number = 3,
        chapNum?: string,
        onProgress?: (msg: string) => void,
    ): Promise<{
        finalBody: string;
        rounds: number;
        diffs: string[];
        roundBodies: string[];
    }> {
        let currentBody = bodyText;
        const diffs: string[] = [];
        const roundBodies: string[] = [bodyText];
        let lastIssues = '';
        const ctxBlock = contextPrompt ? `\n\n【上下文/设定】\n${contextPrompt.slice(0, 3000)}` : '';
        
        for (let round = 0; round < maxRounds; round++) {
            onProgress?.(`🔍 第${round + 1}轮审查...`);
            const checkPrompt = SELF_CHECK_PROMPTS.userPrompt
                .replace('${chapNum}', chapNum || '当前')
                .replace('${bodyText}', currentBody) + ctxBlock;
            const checkResult = await this.apiClient.callAI(
                SELF_CHECK_PROMPTS.systemPrompt, 
                checkPrompt, 
                this.plugin.settings.flashModel, 
                0.3, 
                2048
            );
            
            const hasIssues = checkResult.content.includes('❌');
            if (!hasIssues) {
                lastIssues = checkResult.content;
                onProgress?.('✅ 审查通过');
                break;
            }
            
            lastIssues = checkResult.content;
            
            onProgress?.(`🔧 第${round + 1}轮修复...`);
            const fixPrompt = FIX_PROMPTS.userPrompt
                .replace('${issues}', checkResult.content)
                .replace('${bodyText}', currentBody) + ctxBlock;
            // 旧实现把 ${writingRules}/${writingStyleContent} 原样发给模型；
            // 这里用上下文块兜底，至少不再泄漏字面占位符。
            const fixSystem = FIX_PROMPTS.systemPrompt
                .replace(/\$\{writingRules\}/g, '（见上下文/设定中的写作规则）')
                .replace(/\$\{writingStyleContent\}/g, '（见上下文/设定中的文笔风格）');
            const fixResult = await this.apiClient.callAI(
                fixSystem,
                fixPrompt,
                this.plugin.settings.proModel,
                0.7,
                this.plugin.settings.maxOutput,
                { isWritingTask: true }
            );
            
            const beforeLines = currentBody.split('\n').length;
            const afterLines = fixResult.content.split('\n').length;
            const changed = Math.abs(afterLines - beforeLines);
            diffs.push(`第${round + 1}轮：原文${beforeLines}行 → 修复后${afterLines}行 (变化${changed}行)`);
            
            currentBody = fixResult.content;
            roundBodies.push(currentBody);
        }
        
        return {
            finalBody: currentBody,
            rounds: diffs.length,
            diffs,
            roundBodies
        };
    }
}
