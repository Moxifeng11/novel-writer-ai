/**
 * OutlineToTextExpander — 大纲到正文智能扩写引擎
 *
 * 支持多级扩写：
 * - 章节大纲 → 场景列表（Scene 切分）
 * - 场景大纲 → 段落列表（段落级扩写）
 * - 段落 → 扩写详细内容
 *
 * 扩写策略：保守 / 标准 / 激进
 * 字数控制：目标字数 + 上下浮动范围
 * 网文特色增强：爽点、节奏、对话、环境、伏笔
 */

import type { AIEngine, APIResponse } from './ai-engine';
import type { KnowledgeInjector, InjectionContext } from './knowledge-injector';
import type { WritingProfile } from './writing-profile';
import type { Notifier } from '../shared/types';
import { NOOP_NOTIFIER } from '../shared/types';
import { countWords } from '../shared/diff-utils';
import {
    BodyFormatContract, BodySeparator, DEFAULT_BODY_FORMAT, describeBodyFormat,
} from '../shared/body-format';
import { parseSceneHeadings } from './scene-expander';
import { fitPromptToContext } from '../shared/prompt-budget';

/**
 * 扩写层级。
 */
export type ExpansionLevel = 'chapter-to-scenes' | 'scene-to-paragraphs' | 'paragraph-expand';
/**
 * 扩写策略。
 */
export type ExpansionStrategy = 'conservative' | 'standard' | 'aggressive';

/**
 * 扩写选项。
 */
export interface ExpansionOptions {
    level: ExpansionLevel;
    strategy: ExpansionStrategy;
    targetWords: number;
    wordTolerance: number;
    enhanceCoolPoints?: boolean;
    enhanceDialogue?: boolean;
    enhanceEnvironment?: boolean;
    plantForeshadows?: boolean;
    chapterIndex?: number;
    totalChapters?: number;
    sceneType?: string;
    characterNames?: string[];
    /** 正文格式契约；不传则用默认契约（与项目「写作规则.md」推导结果保持一致） */
    bodyFormat?: BodyFormatContract;
}

/**
 * 场景大纲。
 */
export interface SceneOutline {
    index: number;
    name: string;
    summary: string;
    objective?: string;
    emotionArc?: string;
    conflict?: string;
    isKeyScene?: boolean;
}

/**
 * 段落大纲。
 */
export interface ParagraphOutline {
    index: number;
    content: string;
    purpose?: string;
}

/**
 * 扩写结果。
 */
export interface ExpansionResult {
    success: boolean;
    content: string;
    wordCount: number;
    scenes?: SceneOutline[];
    paragraphs?: ParagraphOutline[];
    error?: string;
}

const DEFAULT_OPTIONS: Partial<ExpansionOptions> = {
    strategy: 'standard',
    wordTolerance: 0.2,
    enhanceCoolPoints: true,
    enhanceDialogue: true,
    enhanceEnvironment: true,
    plantForeshadows: false,
};

const STRATEGY_LABELS: Record<ExpansionStrategy, string> = {
    conservative: '保守扩写',
    standard: '标准扩写',
    aggressive: '激进扩写',
};

const STRATEGY_DESCRIPTIONS: Record<ExpansionStrategy, string> = {
    conservative: '保持原意，增加细节，不改变核心情节走向，扩写幅度约 1.5-2 倍',
    standard: '适度扩展，增加描写和对话，丰富情节层次，扩写幅度约 2-3 倍',
    aggressive: '大量扩展，丰富支线情节和人物互动，深化主题，扩写幅度约 3-5 倍',
};

/**
 * 按正文格式契约切分段落。
 * - separator === '\n'：每个非空行就是一段（项目「一句一段」契约）
 * - separator === '\n\n'：空行分段，段内保留软换行
 *
 * 与 prompt 里的 ${bodyFormat} 使用同一契约，避免「提示要一句一段、解析只认空行」。
 * @param content - 内容
 * @param separator - 分隔符
 * @returns 结果数组
 */
export function splitParagraphsByContract(content: string, separator: BodySeparator): ParagraphOutline[] {
    const lines = (content || '').replace(/\r\n?/g, '\n').split('\n');
    const grouped: string[] = [];
    let current = '';

    for (const line of lines) {
        if (separator === '\n') {
            if (line.trim()) grouped.push(line.trim());
            continue;
        }
        if (line.trim() === '') {
            if (current.trim()) {
                grouped.push(current.trim());
                current = '';
            }
        } else {
            current += (current ? '\n' : '') + line;
        }
    }
    if (separator !== '\n' && current.trim()) grouped.push(current.trim());

    return grouped.map((text, i) => ({ index: i + 1, content: text }));
}

export class OutlineToTextExpander {
    private aiEngine: AIEngine;
    private knowledgeInjector?: KnowledgeInjector;
    private notifier: Notifier;

    constructor(
        aiEngine: AIEngine,
        options?: {
            knowledgeInjector?: KnowledgeInjector;
            notifier?: Notifier;
        }
    ) {
        this.aiEngine = aiEngine;
        this.knowledgeInjector = options?.knowledgeInjector;
        this.notifier = options?.notifier || NOOP_NOTIFIER;
    }

    /**
     * 章纲→场景。
     *
     * @param chapterOutline - 章纲
     * @param options - 配置项
     * @param context - 参数
     * @returns 扩写结果
     */
    async expandChapterToScenes(
        chapterOutline: string,
        options: Partial<ExpansionOptions> = {},
        context?: {
            worldview?: string;
            characters?: string;
            writingProfile?: WritingProfile;
            injectionContext?: InjectionContext;
        }
    ): Promise<ExpansionResult> {
        const opts: ExpansionOptions = { ...DEFAULT_OPTIONS, ...options, level: 'chapter-to-scenes' } as ExpansionOptions;

        this.notifier.showNotice('🎬 正在将章节大纲拆分为场景...');

        const systemPrompt = this.buildChapterToScenesSystemPrompt(opts);
        const built = await this.buildChapterToScenesUserPrompt(chapterOutline, opts, context);

        try {
            const response = await this.callAI(systemPrompt, built.prompt, opts, built.knowledge);
            if (response.error) {
                return { success: false, content: '', wordCount: 0, error: response.error };
            }

            const scenes = this.parseScenes(response.content);
            return {
                success: true,
                content: response.content,
                wordCount: countWords(response.content),
                scenes,
            };
        } catch (e) {
            return {
                success: false,
                content: '',
                wordCount: 0,
                error: e instanceof Error ? e.message : String(e),
            };
        }
    }

    /**
     * 场景→段落。
     *
     * @param sceneOutline - 场景大纲
     * @param options - 配置项
     * @param context - 参数
     * @returns 扩写结果
     */
    async expandSceneToParagraphs(
        sceneOutline: string,
        options: Partial<ExpansionOptions> = {},
        context?: {
            worldview?: string;
            characters?: string;
            writingProfile?: WritingProfile;
            injectionContext?: InjectionContext;
        }
    ): Promise<ExpansionResult> {
        const opts: ExpansionOptions = { ...DEFAULT_OPTIONS, ...options, level: 'scene-to-paragraphs' } as ExpansionOptions;

        this.notifier.showNotice('📝 正在将场景扩展为段落...');

        const systemPrompt = this.buildSceneToParagraphsSystemPrompt(opts);
        const built = await this.buildSceneToParagraphsUserPrompt(sceneOutline, opts, context);

        try {
            const response = await this.callAI(systemPrompt, built.prompt, opts, built.knowledge);
            if (response.error) {
                return { success: false, content: '', wordCount: 0, error: response.error };
            }

            const paragraphs = splitParagraphsByContract(
                response.content,
                opts.bodyFormat?.separator ?? DEFAULT_BODY_FORMAT.separator
            );
            return {
                success: true,
                content: response.content,
                wordCount: countWords(response.content),
                paragraphs,
            };
        } catch (e) {
            return {
                success: false,
                content: '',
                wordCount: 0,
                error: e instanceof Error ? e.message : String(e),
            };
        }
    }

    /**
     * 段落扩写。
     *
     * @param paragraph - 段落
     * @param options - 配置项
     * @param context - 参数
     * @returns 扩写结果
     */
    async expandParagraph(
        paragraph: string,
        options: Partial<ExpansionOptions> = {},
        context?: {
            worldview?: string;
            characters?: string;
            precedingText?: string;
            followingText?: string;
            writingProfile?: WritingProfile;
            injectionContext?: InjectionContext;
        }
    ): Promise<ExpansionResult> {
        const opts: ExpansionOptions = { ...DEFAULT_OPTIONS, ...options, level: 'paragraph-expand' } as ExpansionOptions;

        this.notifier.showNotice('✨ 正在扩写段落...');

        const systemPrompt = this.buildParagraphExpandSystemPrompt(opts);
        const built = await this.buildParagraphExpandUserPrompt(paragraph, opts, context);

        try {
            const response = await this.callAI(systemPrompt, built.prompt, opts, built.knowledge);
            if (response.error) {
                return { success: false, content: '', wordCount: 0, error: response.error };
            }

            return {
                success: true,
                content: response.content.trim(),
                wordCount: countWords(response.content),
            };
        } catch (e) {
            return {
                success: false,
                content: '',
                wordCount: 0,
                error: e instanceof Error ? e.message : String(e),
            };
        }
    }

    /**
     * 整章扩写。
     *
     * @param chapterOutline - 章纲
     * @param options - 配置项
     * @param context - 参数
     * @returns 扩写结果
     */
    async expandFullChapter(
        chapterOutline: string,
        options: Partial<ExpansionOptions> = {},
        context?: {
            worldview?: string;
            characters?: string;
            writingProfile?: WritingProfile;
            injectionContext?: InjectionContext;
            onProgress?: (phase: string, current: number, total: number) => void;
        }
    ): Promise<ExpansionResult> {
        const opts: ExpansionOptions = { ...DEFAULT_OPTIONS, ...options, level: 'chapter-to-scenes' } as ExpansionOptions;

        this.notifier.showNotice('📖 正在进行章节全文扩写...');

        const sceneResult = await this.expandChapterToScenes(chapterOutline, opts, context);
        if (!sceneResult.success || !sceneResult.scenes) {
            return sceneResult;
        }

        context?.onProgress?.('scenes', 1, sceneResult.scenes.length + 1);

        let fullText = '';
        const allParagraphs: ParagraphOutline[] = [];
        // 场景之间的拼接也必须走同一份契约，否则「一句一段」会被塞进空行
        const sep = opts.bodyFormat?.separator ?? DEFAULT_BODY_FORMAT.separator;

        for (let i = 0; i < sceneResult.scenes.length; i++) {
            const scene = sceneResult.scenes[i];
            context?.onProgress?.('scene-paragraphs', i + 2, sceneResult.scenes.length + 1);

            const sceneText = `## 场景${scene.index}：${scene.name}\n${scene.summary}`;
            const paraResult = await this.expandSceneToParagraphs(sceneText, opts, {
                ...context,
                injectionContext: {
                    ...context?.injectionContext,
                    sceneType: scene.isKeyScene ? 'climax' : undefined,
                } as InjectionContext,
            });

            if (paraResult.success && paraResult.paragraphs) {
                const sceneParagraphs = paraResult.paragraphs.map((p, idx) => ({
                    ...p,
                    index: allParagraphs.length + idx + 1,
                }));
                allParagraphs.push(...sceneParagraphs);
                fullText += paraResult.content + sep;
            } else {
                fullText += sceneText + sep;
            }
        }

        return {
            success: true,
            content: fullText.trim(),
            wordCount: countWords(fullText),
            scenes: sceneResult.scenes,
            paragraphs: allParagraphs,
        };
    }

    private buildChapterToScenesSystemPrompt(opts: ExpansionOptions): string {
        const strategyDesc = STRATEGY_DESCRIPTIONS[opts.strategy];

        return `你是专业的小说结构师，负责将章节大纲拆分为具体的场景列表。

【扩写策略】${STRATEGY_LABELS[opts.strategy]}：${strategyDesc}

【场景拆分原则】
1. 每个场景要有明确的时间、地点、人物和核心事件
2. 场景之间要有逻辑衔接，推进剧情发展
3. 合理分配场景权重，重要场景可以更长更详细
4. 场景数量根据章节目标字数合理安排（约每 500-800 字一个场景）
5. 每个场景都要有其存在的意义：要么推进剧情、要么塑造人物、要么揭示信息

【网文特色增强】
${opts.enhanceCoolPoints ? '- 识别并标记爽点场景，重点刻画' : '- 不特别强调爽点'}
${opts.enhanceDialogue ? '- 注重对话场景设计，通过对话推进剧情' : '- 以叙述为主'}
${opts.enhanceEnvironment ? '- 注重环境描写，营造氛围' : '- 环境描写从简'}

【输出格式】
严格按照以下 Markdown 格式输出，每个场景一个二级标题：

## 场景N：场景名称
- **场景概要**：一句话概述本场景核心内容
- **场景目标**：主角在本场景要达成什么
- **情绪弧线**：入场情绪 → 出场情绪
- **核心冲突**：本场景的主要矛盾
- **是否名场面**：是/否（名场面即爽点/高潮/关键转折场景）

注意：
- 场景编号从 1 开始，连续递增
- 场景名称要简洁有概括性
- 场景概要要具体，不能太笼统
- 至少标记 1 个名场面（爽点场景）`;
    }

    private async buildChapterToScenesUserPrompt(
        chapterOutline: string,
        opts: ExpansionOptions,
        context?: {
            worldview?: string;
            characters?: string;
            writingProfile?: WritingProfile;
            injectionContext?: InjectionContext;
        }
    ): Promise<{ prompt: string; knowledge: string }> {
        let prompt = `请将以下章节大纲拆分为具体的场景列表。

【目标字数】约 ${opts.targetWords} 字（上下浮动 ${Math.round(opts.wordTolerance * 100)}%）

【章节大纲】
${chapterOutline}`;

        if (context?.worldview) {
            prompt += `\n\n【世界观设定】\n${context.worldview.slice(0, 2000)}`;
        }

        if (context?.characters) {
            prompt += `\n\n【主要人物】\n${context.characters.slice(0, 1500)}`;
        }

        let knowledge = '';
        if (this.knowledgeInjector && context?.writingProfile && context?.injectionContext) {
            const raw = await this.knowledgeInjector.injectForOutline(
                context.writingProfile,
                context.injectionContext
            );
            if (raw) knowledge = `【写作参考】\n${raw}`;
        }

        prompt += `\n\n请直接输出场景列表，不要额外解释。`;

        return { prompt, knowledge };
    }

    private buildSceneToParagraphsSystemPrompt(opts: ExpansionOptions): string {
        const strategyDesc = STRATEGY_DESCRIPTIONS[opts.strategy];

        return `你是专业的小说作家，负责将场景大纲扩展为具体的段落正文。

【扩写策略】${STRATEGY_LABELS[opts.strategy]}：${strategyDesc}

【段落扩展原则】
1. 每个段落有明确的功能：叙述、描写、对话、心理、动作等
2. 段落之间过渡自然，节奏有张有弛
3. 开头要吸引人，结尾要有钩子或余韵
4. 合理分配笔墨，重要部分详写，过渡部分略写
5. 保持视角一致，不要随意切换视角

【网文特色增强】
${opts.enhanceCoolPoints ? '- 强化爽点，让读者感到畅快淋漓' : '- 平稳叙述'}
${opts.enhanceDialogue ? '- 增加生动对话，展现人物性格' : '- 对话简洁'}
${opts.enhanceEnvironment ? '- 五感描写（视觉、听觉、嗅觉、味觉、触觉），增强代入感' : '- 环境从简'}
${opts.plantForeshadows ? '- 适当埋设伏笔，为后续剧情铺垫' : '- 不埋设新伏笔'}

【输出格式】
${describeBodyFormat(opts.bodyFormat ?? DEFAULT_BODY_FORMAT)}`;
    }

    private async buildSceneToParagraphsUserPrompt(
        sceneOutline: string,
        opts: ExpansionOptions,
        context?: {
            worldview?: string;
            characters?: string;
            writingProfile?: WritingProfile;
            injectionContext?: InjectionContext;
        }
    ): Promise<{ prompt: string; knowledge: string }> {
        let prompt = `请将以下场景大纲扩展为正文段落。

【目标字数】约 ${opts.targetWords} 字（上下浮动 ${Math.round(opts.wordTolerance * 100)}%）

【场景大纲】
${sceneOutline}`;

        if (context?.worldview) {
            prompt += `\n\n【世界观设定】\n${context.worldview.slice(0, 1500)}`;
        }

        if (context?.characters) {
            prompt += `\n\n【出场人物】\n${context.characters.slice(0, 1000)}`;
        }

        let knowledge = '';
        if (this.knowledgeInjector && context?.writingProfile && context?.injectionContext) {
            const raw = await this.knowledgeInjector.injectForSceneExpand(
                context.writingProfile,
                context.injectionContext
            );
            // 知识注入作为可丢弃的增强层，不拼进正文主体
            if (raw) knowledge = `【写作参考】\n${raw}`;
        }

        prompt += `\n\n请直接输出正文，不要额外解释或添加标题。`;

        return { prompt, knowledge };
    }

    private buildParagraphExpandSystemPrompt(opts: ExpansionOptions): string {
        const strategyDesc = STRATEGY_DESCRIPTIONS[opts.strategy];

        return `你是专业的小说作家，负责对给定段落进行扩写润色。

【扩写策略】${STRATEGY_LABELS[opts.strategy]}：${strategyDesc}

【扩写原则】
1. 保持原文的核心意思和叙事方向不变
2. 增加细节描写，让内容更生动具体
3. 优化语言表达，提升文字质感
4. 保持原文的语气、风格和视角
5. 扩写后的内容要自然流畅，不生硬

【增强方向】
${opts.enhanceCoolPoints ? '- 强化爽感，突出高光时刻' : '- 平稳扩写'}
${opts.enhanceDialogue ? '- 丰富对话，增加互动感' : '- 对话从简'}
${opts.enhanceEnvironment ? '- 增加五感描写，增强画面感' : '- 环境从简'}

【输出要求】
${describeBodyFormat(opts.bodyFormat ?? DEFAULT_BODY_FORMAT)}`;
    }

    private async buildParagraphExpandUserPrompt(
        paragraph: string,
        opts: ExpansionOptions,
        context?: {
            worldview?: string;
            characters?: string;
            precedingText?: string;
            followingText?: string;
            writingProfile?: WritingProfile;
            injectionContext?: InjectionContext;
        }
    ): Promise<{ prompt: string; knowledge: string }> {
        let prompt = `请对以下段落进行扩写。

【目标字数】约 ${opts.targetWords} 字（上下浮动 ${Math.round(opts.wordTolerance * 100)}%）

【原文段落】
${paragraph}`;

        if (context?.precedingText) {
            prompt += `\n\n【前文上下文】\n${context.precedingText.slice(-500)}`;
        }

        if (context?.followingText) {
            prompt += `\n\n【后文上下文】\n${context.followingText.slice(0, 500)}`;
        }

        if (context?.worldview) {
            prompt += `\n\n【世界观设定参考】\n${context.worldview.slice(0, 1000)}`;
        }

        let knowledge = '';
        if (this.knowledgeInjector && context?.writingProfile && context?.injectionContext) {
            const raw = await this.knowledgeInjector.injectForBodyGeneration(
                context.writingProfile,
                context.injectionContext
            );
            if (raw) knowledge = `【写作参考】\n${raw}`;
        }

        prompt += `\n\n请直接输出扩写后的内容，不要额外解释。`;

        return { prompt, knowledge };
    }

    private async callAI(
        systemPrompt: string,
        userPrompt: string,
        opts: ExpansionOptions,
        extraTail?: string,
    ): Promise<APIResponse> {
        const maxTokens = Math.min(
            16000,
            Math.max(1024, opts.targetWords * 3)
        );

        const temperature = opts.strategy === 'conservative' ? 0.6
            : opts.strategy === 'aggressive' ? 0.9
            : 0.75;

        // B6：大纲扩写此前直接拼接、完全不过预算闸门。
        // 统一按模型窗口裁剪 user（system 必保），避免 Ollama 从尾部静默截断输出约束。
        const limits = this.aiEngine.getPromptLimits();
        const fit = fitPromptToContext({
            systemPrompt,
            userPrompt,
            extraTail,
            maxContext: limits.maxContext,
            maxOutput: maxTokens,
        });

        return this.aiEngine.callAI(
            systemPrompt,
            fit.user,
            undefined,
            temperature,
            maxTokens,
            { isWritingTask: true }
        );
    }

    private parseScenes(content: string): SceneOutline[] {
        const scenes: SceneOutline[] = [];

        const sceneStarts = parseSceneHeadings(content)
            .map(h => ({ index: h.start, num: h.index, name: h.name }));

        for (let i = 0; i < sceneStarts.length; i++) {
            const start = sceneStarts[i];
            const endIdx = i + 1 < sceneStarts.length ? sceneStarts[i + 1].index : content.length;
            const sceneContent = content.slice(start.index, endIdx);

            const summaryMatch = sceneContent.match(/场景概要[：:]\s*(.+?)(?:\n|$)/i);
            const objectiveMatch = sceneContent.match(/场景目标[：:]\s*(.+?)(?:\n|$)/i);
            const emotionMatch = sceneContent.match(/情绪弧线[：:]\s*(.+?)(?:\n|$)/i);
            const conflictMatch = sceneContent.match(/核心冲突[：:]\s*(.+?)(?:\n|$)/i);
            const keySceneMatch = sceneContent.match(/是否名场面[：:]\s*(.+?)(?:\n|$)/i);

            scenes.push({
                index: start.num,
                name: start.name,
                summary: summaryMatch?.[1]?.trim() || sceneContent.slice(0, 200),
                objective: objectiveMatch?.[1]?.trim(),
                emotionArc: emotionMatch?.[1]?.trim(),
                conflict: conflictMatch?.[1]?.trim(),
                isKeyScene: keySceneMatch?.[1]?.includes('是') ?? false,
            });
        }

        return scenes;
    }

    static getStrategyLabel(strategy: ExpansionStrategy): string {
        return STRATEGY_LABELS[strategy];
    }

    static getStrategyDescription(strategy: ExpansionStrategy): string {
        return STRATEGY_DESCRIPTIONS[strategy];
    }
}
