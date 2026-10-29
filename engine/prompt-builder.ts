/**
 * prompt-builder.ts — v5.5 从 CoWriterEngine 拆出的 Prompt 构建模块
 * 负责 A2/A3/A4/D2/E1/E3 的 prompt 注入片段生成
 */

import type { StyleLearner } from './style-learner';
import type { PreferenceMemory } from './preference-memory';
import type { SuggestionDirection } from '../shared/types';
import type { AssociationHint } from '../shared/co-writer-types';
import type { CharacterSoul } from './character-soul';
import type { StyleFingerprint, StyleFingerprintLibrary, VectorStore } from './style-fingerprint-library';
import type { KnowledgeBaseManager } from '../services/knowledge-base-manager';
import type { KnowledgeSearchResult, KnowledgeVectorStore } from './knowledge-vector-store';
import { createLogger } from '../shared/logger';
import {
    BodyFormatContract,
    DEFAULT_BODY_FORMAT,
    deriveBodyFormat,
    describeBodyFormat,
} from '../shared/body-format';
import { assemblePromptWithinBudget, resolvePrecedingCharLimit, type PromptSection } from '../shared/prompt-budget';
import { recordBudgetSnapshot } from '../shared/budget-telemetry';
import { dedupeAdjacentChunks } from '../shared/knowledge-position';
import { getDegradationNotifier } from '../shared/degradation-notifier';
import { StyleIntensityEngine, type StyleIntensityConfig } from './style/style-intensity-engine';
import { selectFingerprintsForInjection } from './style/fingerprint-selection';

const log = createLogger('PromptBuilder');
import {
    ContextAnalyzer,
    DynamicSampleSelector,
    TieredInjectionBuilder,
} from './style/dynamic-injection-engine';

/** 强度映射是纯函数，模块级共享一个实例即可 */
const intensityEngine = new StyleIntensityEngine();

const DIRECTION_PROMPTS: Record<SuggestionDirection, string> = {
    action:       '现在需要一段推进情节的动作描写。写出主角此刻身体在做什么——手的动作、脚步的移动、呼吸的变化。用具体的身体动作把这一幕推向下一个节点。',
    emotion:      '现在进入主角的内心。不要写"他感到怎样"，通过他注意到的细节来传递情绪——他看见了什么别人注意不到的东西？他听见了什么声音让他心跳变了？他的嗅觉或触觉捕捉到了什么？',
    dialogue:     '现在需要一句或几句对话。对话不是为了交代信息，而是为了展现人物之间的关系——谁在试探谁？谁在回避什么？潜台词比说出来的更重要。',
    description:  '现在需要一段环境描写。但不要客观描述，从主角的眼睛看出去——这个空间里有什么让他不舒服？有什么让他放松？此时的光线、气味、温度，怎样影响他的身体感觉？',
    foreshadow:   '现在需要埋一个细节，让细心的读者隐约感到后面有事要发生——可以是一个不起眼的物件、一句看似随意的话、或主角一闪而过的直觉。',
    conflict:     '现在需要加大冲突的烈度。让对立的两个力更近一步——一句话一个动作就可以让局势急转直下。不要让冲突停留在对话层面，要有身体上的反应。',
    resolution:   '当前场景接近尾声。收束不是戛然而止，而是让情绪有一个落点——主角最后的感受是什么？他带走了什么？有什么东西变了？',
    surprise:     '现在需要一个意外。不是天降神兵，而是前面某个被忽略的细节突然有了意义。让主角（和读者）同时意识到"原来是这样"。'
};

/** ContextSnapshot 的最小接口（避免循环依赖） */
export interface PromptSnapshot {
    emotionPlan?: string;
    foreshadows?: { unrevealed?: any[] };
    chapterName?: string;
    relationshipStates?: Array<{
        charA: string;
        charB: string;
        state?: {
            status?: string;
            trust?: number;
            attraction?: number;
            fear?: number;
            resentment?: number;
            dependence?: number;
        };
    }>;
    crossVolumeContext?: string;
    longTermMemoryContext?: string;
    fanficRulesContext?: string;
    /** 创作模式硬约束（短篇/剧本）；长篇为空 */
    creationModeContext?: string;
    worldType?: string;
    writingStyle?: string;
    allChars?: string;
    allFactions?: string;
    allLocs?: string;
    allItems?: string;
    writingRules?: string;
    chapPlan?: string;
    sceneExpansion?: string;
    prevChaptersSummary?: string;
    settingLib?: string;
    timeline?: string;
    triggeredMemories?: string;
    /** 故事上下文总线：完整信息包（协同续写/改写） */
    storyContextPack?: string;
    /** 故事上下文总线：关联摘要（联想/迭代，避免挤占小窗口） */
    storyContextPackCompact?: string;
    /** 故事上下文总线遥测（只读，供日志/诊断） */
    storyContextTelemetry?: unknown;
}

export class PromptBuilder {
    private knowledgeVectorStore?: KnowledgeVectorStore | null;
    private knowledgeManager?: KnowledgeBaseManager | null;
    private referenceBookIds: string[] = [];
    private knowledgeCache: Map<string, { result: string[], contentHash: string }> = new Map();
    private cachedSystemPrompt: string | null = null;
    /** 缓存 system prompt 时使用的格式契约签名（写作规则变化后需重建） */
    private cachedFormatKey = '';
    private l2ContextCache: Map<string, { parts: string[]; timestamp: number }> = new Map();
    private readonly L2_CACHE_TTL = 5000;
    /** 动态风格注入引擎（懒加载） */
    private contextAnalyzer?: ContextAnalyzer;
    private dynamicSampleSelector?: DynamicSampleSelector;
    private tieredInjectionBuilder?: TieredInjectionBuilder;
    /** 指纹筛选回退全量的降级事件是否已发过（每实例只报一次，避免逐章刷屏） */
    private fingerprintFallbackNotified = false;

    constructor(
        private getSnapshot: () => PromptSnapshot | null,
        private styleLearner?: StyleLearner | null,
        private preferenceMemory?: PreferenceMemory | null,
        private fingerprintLibrary?: StyleFingerprintLibrary | null,
        private vectorStore?: VectorStore | null
    ) {}

    /** 当前项目的正文格式契约（由写作规则推导；无规则时用默认契约） */
    getBodyFormat(): BodyFormatContract {
        const rules = this.getSnapshot()?.writingRules || '';
        return rules.trim() ? deriveBodyFormat(rules) : { ...DEFAULT_BODY_FORMAT };
    }

    private getSystemPrompt(writingRules = ''): string {
        // 格式契约来自项目写作规则：同一 prompt 里不允许再硬编码「Tab / 空两格」两套说法
        const contract = writingRules.trim() ? deriveBodyFormat(writingRules) : { ...DEFAULT_BODY_FORMAT };
        const formatKey = `${contract.separator}|${contract.indent}`;
        if (this.cachedSystemPrompt && this.cachedFormatKey === formatKey) return this.cachedSystemPrompt;

        this.cachedFormatKey = formatKey;
        this.cachedSystemPrompt = [
                '你是一位第三人称限知视角的叙事者。你不是在"写小说"，你是在用镜头紧贴主角，把他/她正在经历的一切原样呈现出来。',
                '',
                '【叙事视角规则】',
                '- 严格第三人称限知：只写主角能看到、听到、摸到、感受到的东西。',
                '- 不跳其他角色的内心，不写上帝视角的全局解释。',
                '- 严禁使用第一人称「我」叙事。所有描写必须是第三人称（他/她/它），这是硬性规则，不可违反。',
                '- 心理活动优先用自由间接引语；需要写清楚时可以用“他心想”“他觉得”，不要每段都用。',
                '- 认知从主角的感官和处境出发；叙述者可以有人格，但不要跳到别人的脑子里。',
                '',
                '【怎么写才像活人写的】',
                '- 事情在发生，不是在被讲述；但允许解释、交代和过渡，不要把必要的来龙去脉都藏掉。',
                '- 情绪可以直接写，也可以藏在动作里；不要每段都逼着自己“藏”。',
                '- 不用排比，不用华丽辞藻堆砌。活人眼里的世界没那么多修辞。',
                '- 一个自然段 2–6 句，80–220 字；不要一句一段，不要把同一个动作拆成好几行。',
                '- 对话和说话人的动作、神态放在同一段；连续对话按说话人分段。',
                '- 允许口语、停顿、打断、答非所问和一点废话。',
                '- “然后”“接着”“就在这时”不是禁词；该过渡时用一句带过，比硬跳更自然。',
                '',
                describeBodyFormat(contract),
                '【节奏补充】',
                '- 句长平均 20–30 字，长句和短句交替；短句是调味，不是主菜。',
                '- 每个场景 2–3 处关键身体感觉即可，不要逐段打卡。',
                '',
                '输出语言：简体中文。所有叙事内容必须用纯中文输出，禁止出现任何英文单词或句子。',
            ].join('\n');
        return this.cachedSystemPrompt;
    }

    private getCachedContextParts(
        snap: PromptSnapshot | null,
        opts?: { skipChapterPlanning?: boolean; skipCoreInfo?: boolean },
    ): string[] {
        const skipChapterPlanning = opts?.skipChapterPlanning === true;
        // 故事上下文总线已提供实体/设定/时间线时，旧的核心信息块不再重复注入
        const skipCoreInfo = opts?.skipCoreInfo === true;
        const worldType = snap?.worldType || '';
        const writingStyle = snap?.writingStyle || '';
        const allChars = snap?.allChars || '';
        const allFactions = snap?.allFactions || '';
        const allLocs = snap?.allLocs || '';
        const allItems = snap?.allItems || '';
        const writingRules = snap?.writingRules || '';
        const chapPlan = snap?.chapPlan || '';
        const sceneExpansion = snap?.sceneExpansion || '';
        const prevChaptersSummary = snap?.prevChaptersSummary || '';
        const settingLib = snap?.settingLib || '';
        const timeline = snap?.timeline || '';
        const triggeredMemories = snap?.triggeredMemories || '';

        const cacheKey = this.simpleHash(
            `${skipChapterPlanning ? 'brief' : 'full'}|${skipCoreInfo ? 'pack' : 'core'}|${worldType}|${writingStyle}|${allChars}|${allFactions}|${allLocs}|${allItems}|${writingRules}|${chapPlan}|${sceneExpansion}|${prevChaptersSummary}|${settingLib}|${timeline}|${triggeredMemories}`
        );

        const cached = this.l2ContextCache.get(cacheKey);
        if (cached && (Date.now() - cached.timestamp) < this.L2_CACHE_TTL) {
            return cached.parts;
        }

        const parts: string[] = [
            worldType ? `【世界背景】你活在${worldType}题材的世界。` : '',
            '',
            !skipCoreInfo && allChars ? '【人物总览】' : '',
            !skipCoreInfo && allChars ? allChars.slice(0, 3000) : '',
            !skipCoreInfo && allChars ? '' : '',
            !skipCoreInfo && allFactions ? '【势力总览】' : '',
            !skipCoreInfo && allFactions ? allFactions.slice(0, 2000) : '',
            !skipCoreInfo && allFactions ? '' : '',
            !skipCoreInfo && allLocs ? '【地点总览】' : '',
            !skipCoreInfo && allLocs ? allLocs.slice(0, 2000) : '',
            !skipCoreInfo && allLocs ? '' : '',
            !skipCoreInfo && allItems ? '【物品功法总览】' : '',
            !skipCoreInfo && allItems ? allItems.slice(0, 2000) : '',
            !skipCoreInfo && allItems ? '' : '',
            writingRules ? '【写作规则（必须遵守）】' : '',
            writingRules ? writingRules.slice(0, 3000) : '',
            writingRules ? '' : '',
            writingStyle ? '【文笔风格（请严格遵循此文件定义的风格）】' + writingStyle : '',
            '',
            // 有章节简报时，简报已完整承载大纲与当前场景，避免重复注入整段 Scene 展开
            chapPlan && !skipChapterPlanning ? '【本章大纲】' : '',
            chapPlan && !skipChapterPlanning ? chapPlan.slice(0, 3000) : '',
            chapPlan && !skipChapterPlanning ? '' : '',
            sceneExpansion && !skipChapterPlanning ? '【场景展开】' : '',
            sceneExpansion && !skipChapterPlanning ? sceneExpansion.slice(0, 3000) : '',
            sceneExpansion && !skipChapterPlanning ? '' : '',
            prevChaptersSummary ? '【前章摘要】' : '',
            prevChaptersSummary ? prevChaptersSummary.slice(0, 3000) : '',
            prevChaptersSummary ? '' : '',
            triggeredMemories ? '【触发的记忆碎片】' : '',
            triggeredMemories ? triggeredMemories.slice(0, 2000) : '',
            triggeredMemories ? '' : '',
            !skipCoreInfo && settingLib ? '【设定库】' : '',
            !skipCoreInfo && settingLib ? settingLib.slice(0, 3000) : '',
            !skipCoreInfo && settingLib ? '' : '',
            !skipCoreInfo && timeline ? '【时间线】' : '',
            !skipCoreInfo && timeline ? timeline.slice(0, 2000) : '',
            !skipCoreInfo && timeline ? '' : '',
        ];

        this.l2ContextCache.set(cacheKey, { parts, timestamp: Date.now() });
        if (this.l2ContextCache.size > 50) {
            const oldest = this.l2ContextCache.keys().next().value;
            if (oldest) this.l2ContextCache.delete(oldest);
        }

        return parts;
    }

    /** E1/E3: 风格自学习 + 偏好记忆注入 */
    getMemoryPromptParts(fingerprintParts?: string[]): string[] {
        const styleGuide = this.styleLearner?.getStyleGuide()?.trim() || '';
        const preferencePrompt = this.preferenceMemory?.generatePreferencePrompt()?.trim() || '';
        const parts: string[] = [];

        if (fingerprintParts && fingerprintParts.length > 0) {
            parts.push(...fingerprintParts, '');
        }
        if (styleGuide) {
            parts.push('【作者风格自学习】', styleGuide, '');
        }
        if (preferencePrompt) {
            parts.push('【作者偏好记忆】', preferencePrompt, '');
        }

        return parts;
    }

    /**
     * 获取写作风格指纹 prompt 片段（异步，涉及向量检索）
     * @param queryText 当前已写文本（用于上下文分析和向量检索）
     * @param direction 可选的写作方向提示（优先于自动识别）
     */
    async getFingerprintPromptParts(queryText: string, direction?: SuggestionDirection): Promise<string[]> {
        if (!this.fingerprintLibrary || !this.vectorStore) return [];

        try {
            const enabledFingerprints = await this.fingerprintLibrary.getEnabledFingerprints();
            if (enabledFingerprints.length === 0) return [];

            // 懒加载动态注入引擎
            if (!this.contextAnalyzer) this.contextAnalyzer = new ContextAnalyzer();
            if (!this.dynamicSampleSelector) this.dynamicSampleSelector = new DynamicSampleSelector();
            if (!this.tieredInjectionBuilder) this.tieredInjectionBuilder = new TieredInjectionBuilder();

            // 1. 上下文分析（TR-6.1）
            const queryTail = (queryText || '').slice(-800);
            const context = this.contextAnalyzer.analyze(queryTail, direction);

            // 2. 强度配置（必须先读盘：getIntensityConfig 只查内存 map，
            //    不 load 的话重启后一律回落到默认强度，用户设置对 prompt 完全不生效）
            await this.fingerprintLibrary.loadIntensityConfigs();
            // 启用指纹过多时按当前正文的 V2 12 维相似度挑选，避免全量特征挤占本地窗口
            const queryTailForRanking = queryTail.slice(-500);
            const fingerprintsForInjection = await this.selectFingerprintsForInjection(
                enabledFingerprints,
                queryTailForRanking,
            );
            const intensityConfigs = new Map<string, StyleIntensityConfig>();
            const disabledFpIds = new Set<string>();
            for (const fp of enabledFingerprints) {
                const config = this.fingerprintLibrary.getIntensityConfig(fp.id);
                intensityConfigs.set(fp.id, config);
                // 强度 0 = 完全禁用（与 TieredInjectionBuilder#buildGlobalTier 同口径）。
                // 只让全局层描述消失、示例样本照旧注入，等于「禁用」对正文无效。
                if (intensityEngine.previewIntensity(config).disabled) disabledFpIds.add(fp.id);
            }

            // 3. 向量检索（扩大到 5 条，让 rerank 有空间）
            const searchResults = await this.vectorStore.search(queryTailForRanking, 5);

            // 4. 动态示例选择（TR-6.2）：对检索结果做基于上下文的 rerank
            // 必须按启用状态 + 强度过滤：指纹被禁用后向量文件仍在磁盘上，
            // 不过滤等于禁用无效。fingerprintId 缺失（旧实现/测试桩）时无法判定归属，放行。
            const injectionIds = new Set(fingerprintsForInjection.map(fp => fp.id));
            const samplesWithFpId = searchResults
                .filter(r => !r.fingerprintId || (injectionIds.has(r.fingerprintId) && !disabledFpIds.has(r.fingerprintId)))
                .map(r => ({
                    sample: r.sample,
                    score: r.score,
                    fingerprintId: r.fingerprintId,
                }));
            const selectedSamples = this.dynamicSampleSelector.select(samplesWithFpId, context, 3);

            // 5. 分级注入拼装（TR-6.3 + TR-6.5）：全局层 + 段落层 + 句子层
            const result = this.tieredInjectionBuilder.build(
                fingerprintsForInjection,
                selectedSamples,
                context,
                intensityConfigs,
            );

            return result;
        } catch (e) {
            log.warn('[PromptBuilder] 指纹 prompt 生成失败:', e);
            return [];
        }
    }

    /**
     * 启用指纹超过上限时，用 V2 12 维检索挑出与当前正文最相似的 N 个。
     * 检索不可用 / 无结果 / 抛错时一律回退全量：风格约束不能因为一次检索失败而丢失，
     * 但必须发一次降级事件，避免「注入了 20 个指纹却只剩 3 个预算」的静默行为。
     */
    private async selectFingerprintsForInjection(
        enabled: StyleFingerprint[],
        query: string,
    ): Promise<StyleFingerprint[]> {
        const library = this.fingerprintLibrary;
        const searcher = library?.searchSimilarStylesV2;
        return selectFingerprintsForInjection(enabled, {
            query,
            searchV2: typeof searcher === 'function'
                ? (q, opts) => searcher.call(library, q, opts)
                : undefined,
            // 协同写作宁可回退全量也不能丢风格约束；11 步用 'firstN' 守住预算上限
            fallback: 'all',
            onFallback: reason => this.notifyFingerprintFallback(reason),
        });
    }

    /** 指纹筛选回退全量时发一次降级事件（每实例一次） */
    private notifyFingerprintFallback(reason: string): void {
        if (this.fingerprintFallbackNotified) return;
        this.fingerprintFallbackNotified = true;
        getDegradationNotifier().notify({
            source: 'vector',
            dimension: 'style',
            from: 'v2_ranking',
            to: 'inject_all_enabled',
            reason: `风格指纹相关性筛选回退全量注入：${reason}`,
            severity: 'warning',
            recoverable: true,
        });
    }

    /** 设置参考书籍 ID */
    setReferenceBooks(bookIds: string[]): void {
        this.referenceBookIds = bookIds || [];
    }

    /** 设置知识库管理器和向量存储 */
    setKnowledgeBase(
        knowledgeManager?: KnowledgeBaseManager | null,
        knowledgeVectorStore?: KnowledgeVectorStore | null
    ): void {
        const changed = this.knowledgeManager !== knowledgeManager
            || this.knowledgeVectorStore !== knowledgeVectorStore;
        this.knowledgeManager = knowledgeManager;
        this.knowledgeVectorStore = knowledgeVectorStore;
        // 换了数据源（切项目 / 重新初始化）：旧片段一律作废
        if (changed) this.knowledgeCache.clear();
    }

    /**
     * 知识库内容指纹：书目版本 + 换模型后跳过的书数 + 当前 embedding 指纹。
     * 旧实现的缓存只认 query+bookIds，重新拆解/切换 embedding 后
     * 同一会话里会一直返回旧片段，直到插件重启。
     */
    private getKnowledgeContentSignature(): string {
        const managerVersion = this.knowledgeManager?.version ?? 0;
        const mismatches = this.knowledgeVectorStore?.getModelMismatches?.().length ?? 0;
        return `${managerVersion}:${mismatches}`;
    }

    private simpleHash(str: string): string {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash |= 0;
        }
        return Math.abs(hash).toString(36);
    }

    private extractLastTwoSentences(text: string): string {
        const sentences = text.split(/[。！？…]+/).filter(s => s.trim().length > 0);
        return sentences.slice(-2).join('。');
    }

    /** 获取知识库 prompt 片段（异步，涉及向量检索） */
    async getKnowledgePromptParts(
        queryText: string,
        direction?: SuggestionDirection
    ): Promise<string[]> {
        const parts: string[] = [];

        try {
            const bookIds = this.referenceBookIds;
            const hasBooks = bookIds.length > 0;
            const hasVectorStore = !!this.knowledgeVectorStore;

            if (!hasBooks || !hasVectorStore) {
                return [];
            }

            const directionKeywords: Record<string, string> = {
                'action': '动作描写 战斗',
                'emotion': '情绪 心理',
                'dialogue': '对话 交谈',
            };
            const localContext = this.extractLastTwoSentences(queryText);
            const searchQuery = direction
                ? `${localContext} ${directionKeywords[direction] || ''}`.trim()
                : queryText;

            const cacheKey = `${direction ?? 'default'}:${this.simpleHash(searchQuery)}`;
            const cached = this.knowledgeCache.get(cacheKey);
            // 内容哈希必须包含知识库版本：重新拆解 / 改名 / 换 embedding 后
            // 文件签名变了但 query 与 bookIds 不变，旧缓存会把过期片段一直喂给模型
            const contentHash = this.simpleHash(
                `${searchQuery}|${(bookIds || []).join(',')}|${this.getKnowledgeContentSignature()}`
            );
            if (cached && cached.contentHash === contentHash) {
                return cached.result;
            }

            const styleTopN = 3;
            const rhythmTopN = 2;
            const techniqueTopN = (direction === 'action' || direction === 'dialogue') ? 6 : 3;

            const maxPerDim = Math.max(
                direction ? 6 : styleTopN,
                direction === 'emotion' ? 4 : rhythmTopN,
                techniqueTopN
            );
            const combinedTopN = maxPerDim * 4;

            let styleResults: KnowledgeSearchResult[] = [];
            let rhythmResults: KnowledgeSearchResult[] = [];
            let techniqueResults: KnowledgeSearchResult[] = [];
            let originalResults: KnowledgeSearchResult[] = [];

            try {
                const allResults = await this.knowledgeVectorStore!.search(searchQuery, {
                    topN: combinedTopN,
                    bookIds: bookIds,
                    // structure 的 category 是「起/承/转/合」，混进来会被当成技巧类别渲染
                    dimensions: ['style', 'rhythm', 'technique'],
                    // B3：三个维度共用一次检索，必须按维度各自过滤；
                    // 全局阈值会让 0.45 的 rhythm 被 0.6 的 style × 0.85 整段丢弃
                    filterScope: 'perDimension',
                });

                styleResults = allResults.filter(r => r.dimension === 'style');
                rhythmResults = allResults.filter(r => r.dimension === 'rhythm');
                techniqueResults = allResults.filter(r => r.dimension === 'technique');

                // 原文分块单独检索：原文样本数量远多于拆解报告，混在同一次 topN 里
                // 会把风格/节奏/技巧结果挤掉；按 2 倍取再相邻去重，避免 40 字重叠块重复占预算。
                originalResults = await this.knowledgeVectorStore!.search(searchQuery, {
                    topN: 6,
                    bookIds: bookIds,
                    dimensions: ['original'],
                });
            } catch (e) {
                log.warn('[PromptBuilder] 知识库合并检索失败:', e);
                return parts;
            }

            // 【写作知识库 - 风格参考】
            {
                let filteredStyle = styleResults;
                if (direction === 'action') {
                    filteredStyle = styleResults
                        .sort((a, b) => a.sample.length - b.sample.length)
                        .slice(0, styleTopN);
                } else if (direction === 'emotion') {
                    const emotionKeywords = ['颤抖', '心跳', '呼吸', '眼泪', '痛', '怒', '恐惧', '绝望', '喜悦', '悲伤'];
                    filteredStyle = styleResults
                        .sort((a, b) => {
                            const aScore = emotionKeywords.filter(k => a.sample.includes(k)).length;
                            const bScore = emotionKeywords.filter(k => b.sample.includes(k)).length;
                            return bScore - aScore;
                        })
                        .slice(0, styleTopN);
                } else if (direction === 'dialogue') {
                    filteredStyle = styleResults
                        .sort((a, b) => {
                            const aDialog = (a.sample.match(/["「『"']/g) || []).length;
                            const bDialog = (b.sample.match(/["「『"']/g) || []).length;
                            return bDialog - aDialog;
                        })
                        .slice(0, styleTopN);
                } else {
                    filteredStyle = styleResults.slice(0, styleTopN);
                }

                if (filteredStyle.length > 0) {
                    const uniqueBooks = [...new Set(filteredStyle.map(r => r.bookName))];
                    const styleLines: string[] = [];
                    styleLines.push(`参考了${uniqueBooks.map(n => `《${n}》`).join('')}的写作风格：`);
                    for (let i = 0; i < filteredStyle.length; i++) {
                        const r = filteredStyle[i];
                        const sample = r.sample.slice(0, 200);
                        const scorePct = Math.round(r.score * 100);
                        styleLines.push(`${i + 1}. ${sample} —— 来源：《${r.bookName}》${scorePct}%`);
                    }
                    parts.push('【写作知识库 - 风格参考】', ...styleLines, '');
                }
            }

            // 【写作知识库 - 节奏参考】
            {
                // B3：节奏参考按相关度取，不按分块位置。position 只是原文里的位置标记，
                // 用 (b.position - a.position) 排序会把与当前场景最相关的节奏挤出去。
                const filteredRhythm = [...rhythmResults]
                    .sort((a, b) => b.score - a.score)
                    .slice(0, rhythmTopN);

                if (filteredRhythm.length > 0) {
                    const rhythmLines: string[] = [];
                    for (let i = 0; i < filteredRhythm.length; i++) {
                        const r = filteredRhythm[i];
                        const sample = r.sample.slice(0, 150);
                        const scorePct = Math.round(r.score * 100);
                        rhythmLines.push(`- 《${r.bookName}》${scorePct}%：${sample}`);
                    }
                    parts.push('【写作知识库 - 节奏参考】', '参考书籍相近节奏模式：', ...rhythmLines, '');
                }
            }

            // 【写作知识库 - 原文片段】（Phase 4.3：检索对象改为原文分块）
            if (originalResults.length > 0) {
                const pickedOriginal = dedupeAdjacentChunks(originalResults).slice(0, 3);
                const uniqueBooks = [...new Set(pickedOriginal.map(r => r.bookName))];
                const originalLines: string[] = [
                    `以下为${uniqueBooks.map(n => `《${n}》`).join('')}原文片段，请模仿其句法与叙事质感，不要照抄情节：`,
                ];
                for (let i = 0; i < pickedOriginal.length; i++) {
                    const r = pickedOriginal[i];
                    originalLines.push(`${i + 1}. ${r.sample.slice(0, 250)} —— 来源：《${r.bookName}》${Math.round(r.score * 100)}%`);
                }
                parts.push('【写作知识库 - 原文片段】', ...originalLines, '');
            }

            // 【写作知识库 - 技巧参考】
            {
                let filteredTechnique = techniqueResults;
                if (direction === 'action') {
                    const actionCategories = ['动作描写', '战斗场景', '打斗'];
                    filteredTechnique = techniqueResults
                        .filter(r => !r.category || actionCategories.some(c => r.category!.includes(c)))
                        .slice(0, 3);
                    if (filteredTechnique.length === 0) {
                        filteredTechnique = techniqueResults.slice(0, 3);
                    }
                } else if (direction === 'dialogue') {
                    const dialogueCategories = ['对话推进'];
                    filteredTechnique = techniqueResults
                        .filter(r => !r.category || dialogueCategories.some(c => r.category!.includes(c)))
                        .slice(0, 3);
                    if (filteredTechnique.length === 0) {
                        filteredTechnique = techniqueResults.slice(0, 3);
                    }
                } else {
                    filteredTechnique = techniqueResults.slice(0, 3);
                }

                if (filteredTechnique.length > 0) {
                    const techniqueLines: string[] = [];
                    for (let i = 0; i < filteredTechnique.length; i++) {
                        const r = filteredTechnique[i];
                        const sample = r.sample.slice(0, 200);
                        const scorePct = Math.round(r.score * 100);
                        const category = r.category ? `技巧：${r.category}` : '';
                        techniqueLines.push(`${i + 1}. ${sample} —— 来源：《${r.bookName}》${category ? ' ' + category : ''}${scorePct}%`);
                    }
                    parts.push('【写作知识库 - 技巧参考】', ...techniqueLines, '');
                }
            }

            this.knowledgeCache.set(cacheKey, { result: [...parts], contentHash });
        } catch (e) {
            log.warn('[PromptBuilder] 知识库 prompt 生成失败:', e);
        }

        return parts;
    }

    /** A2: 情绪曲线镀点——将本章情绪规划注入生成 prompt */
    getEmotionAnchorPromptParts(): string[] {
        const plan = (this.getSnapshot()?.emotionPlan || '').trim();
        if (!plan) return [];
        return ['【A2 本章情绪曲线镀点】', plan.slice(0, 500), '请让续写的情绪走向与上述规划一致，不要提前泄气或跳过关键情绪转折。', ''];
    }

    /** A3: 伏笔智能触发——根据已写前文提示可回收/推进的未揭示伏笔 */
    getForeshadowTriggerPromptParts(precedingText: string): string[] {
        const fs: any = this.getSnapshot()?.foreshadows;
        const unrevealed: any[] = Array.isArray(fs?.unrevealed) ? fs.unrevealed : [];
        if (unrevealed.length === 0) return [];
        const tail = (precedingText || '').slice(-400);
        const lines: string[] = [];
        for (const item of unrevealed.slice(0, 6)) {
            const name = (item?.name || '').trim();
            if (!name) continue;
            const touched = name.length >= 2 && tail.includes(name);
            const reveal = item?.plannedReveal || '未定';
            lines.push(`- 「${name}」（计划揭示：${reveal}）${touched ? ' ← 前文刚提及，可适度推进但不要提前揭谜' : ''}`);
        }
        if (lines.length === 0) return [];
        return ['【A3 未揭示伏笔（可埋设/铺垫，勿提前揭示）】', ...lines, ''];
    }

    /** 未回收伏笔提醒——筛选计划回收章节 ≤ 当前章节的未揭示伏笔，提示 AI 推进回收 */
    getUnrevealedForeshadowReminderPromptParts(): string[] {
        const snap = this.getSnapshot();
        if (!snap) return [];
        const unrevealed: any[] = Array.isArray(snap.foreshadows?.unrevealed) ? snap.foreshadows.unrevealed : [];
        if (unrevealed.length === 0) return [];
        const m = (snap.chapterName || '').match(/第(\d+)章/);
        if (!m) return [];
        const currentChapter = parseInt(m[1], 10);
        const due = unrevealed.filter((item: any) => {
            const p = (item?.plannedReveal || '').match(/第(\d+)章/);
            return p ? parseInt(p[1], 10) <= currentChapter : false;
        });
        if (due.length === 0) return [];
        const lines = due.slice(0, 10).map((item: any, i: number) => {
            const name = (item?.name || '').trim() || '（未命名）';
            return `${i + 1}. ${name} (计划回收: ${item?.plannedReveal || '未定'})`;
        });
        return ['【未回收伏笔提醒】', '以下伏笔计划在本章或之前回收，请在续写中推进：', ...lines, ''];
    }

    /** A4: 关系状态驱动——注入与当前场景相关的角色关系数值 */
    getRelationshipDriverPromptParts(precedingText: string): string[] {
        const rels = this.getSnapshot()?.relationshipStates || [];
        if (!rels.length) return [];
        const tail = (precedingText || '').slice(-400);
        const scored = rels.map(r => {
            const hit = (tail.includes(r.charA) ? 1 : 0) + (tail.includes(r.charB) ? 1 : 0);
            return { r, hit };
        });
        scored.sort((a, b) => b.hit - a.hit);
        const picked = scored.filter(x => x.hit > 0).slice(0, 3);
        const use = picked.length ? picked : scored.slice(0, 2);
        const lines = use.map(({ r }) => {
            const st: any = r.state || {};
            const desc = (st.status || '').toString().trim();
            const nums = `信任${st.trust ?? '-'}/吸引${st.attraction ?? '-'}/恐惧${st.fear ?? '-'}/怨恨${st.resentment ?? '-'}/依赖${st.dependence ?? '-'}`;
            return `- ${r.charA} ↔ ${r.charB}：${desc ? desc + '，' : ''}${nums}`;
        });
        if (!lines.length) return [];
        return ['【A4 角色关系状态（请让对话/互动符合这些关系数值）】', ...lines, ''];
    }

    /** D2: 跨卷一致性——注入前面卷的状态快照 */
    getCrossVolumePromptParts(): string[] {
        const ctx = (this.getSnapshot()?.crossVolumeContext || '').trim();
        if (!ctx) return [];
        return ['【D2 跨卷状态快照（请保持与前面卷的人物/势力/伏笔/时间线一致）】', ctx.slice(0, 1200), ''];
    }

    /** 长篇记忆：事实索引中已确认的人物/世界观/剧情事实（跨章累积） */
    getLongTermMemoryPromptParts(): string[] {
        const ctx = (this.getSnapshot()?.longTermMemoryContext || '').trim();
        if (!ctx) return [];
        return [ctx, ''];
    }

    /**
     * 同人约束：原作的硬性设定与红线（仅同人项目存在）。
     * 文本由 formatFanficRulesForPrompt 统一格式化，自带标题，此处不再包装。
     */
    getFanficRulesPromptParts(): string[] {
        const ctx = (this.getSnapshot()?.fanficRulesContext || '').trim();
        if (!ctx) return [];
        return [ctx, ''];
    }

    /**
     * 创作模式硬约束：短篇/剧本的平台规格、节奏与输出格式。
     * 块文本自带标题；长篇为空，原有协同 prompt 不受影响。
     */
    getCreationModePromptParts(): string[] {
        const ctx = (this.getSnapshot()?.creationModeContext || '').trim();
        if (!ctx) return [];
        return [ctx, ''];
    }

    /** 统一聚合 A2/A3/A4/D2 注入点 */
    getNarrativeDriverPromptParts(precedingText: string): string[] {
        return [
            ...this.getEmotionAnchorPromptParts(),
            ...this.getForeshadowTriggerPromptParts(precedingText),
            ...this.getRelationshipDriverPromptParts(precedingText),
            ...this.getCrossVolumePromptParts()
        ];
    }

    /**
     * 故事上下文总线提供的完整/压缩信息包。
     * 有信息包时，实体/设定/时间线/伏笔/情绪走这一条，旧的分段注入只保留关系与跨卷。
     */
    getStoryContextPackParts(compact = false): string[] {
        const snap = this.getSnapshot();
        const pack = ((compact ? snap?.storyContextPackCompact : snap?.storyContextPack) || '').trim();
        // 只有标题、没有任何分类内容时不注入，避免空包把旧上下文挤掉
        return pack && pack.includes('■') ? [pack, ''] : [];
    }

    /** 有信息包时仍需保留的驱动：关系状态 + 跨卷快照（信息包不含这两类动态状态） */
    getRelationshipOnlyDriverParts(precedingText: string): string[] {
        return [
            ...this.getRelationshipDriverPromptParts(precedingText),
            ...this.getCrossVolumePromptParts(),
        ];
    }

    /** 构建续写建议 prompt（system 仅含静态指令，用户内容全部在 user prompt） */
    buildSuggestionPrompt(
        precedingText: string,
        direction: SuggestionDirection,
        cursorHint: string,
        soulInjection: string,
        plotTarget: string,
        fingerprintParts?: string[],
        knowledgeParts?: string[],
        knowledgeInjection?: string,
        briefParts?: string[],
        budget?: { maxInputTokens: number; modelId?: string }
    ): { system: string; user: string } {
        const dirPrompt = DIRECTION_PROMPTS[direction] || DIRECTION_PROMPTS.action;
        const snap = this.getSnapshot();

        // system 只放静态硬规则：知识注入属于增强信息，拼进 system 会绕过预算裁剪，
        // 把整段 prompt 顶过窗口后由本地模型从尾部截断（正好切掉已写内容与写作方向）
        const systemPrompt = this.getSystemPrompt(snap?.writingRules || '');

        const hasBrief = !!briefParts && briefParts.length > 0;
        const hasStoryContext = this.getStoryContextPackParts(false).length > 0;
        // 片段优先级：节点推进 > 同人约束 > 简报 > 角色状态 > 故事上下文 > 叙事驱动 > 伏笔提醒 > 缓存上下文 > 知识库 > 指纹/记忆
        const sections: PromptSection[] = [
            {
                key: 'memory',
                priority: 20,
                shrinkable: true,
                text: this.getMemoryPromptParts(fingerprintParts).join('\n'),
            },
            {
                key: 'knowledge',
                priority: 25,
                shrinkable: true,
                text: (knowledgeParts && knowledgeParts.length > 0 ? knowledgeParts : []).join('\n'),
            },
            {
                key: 'longTermMemory',
                priority: 30,
                shrinkable: true,
                text: this.getLongTermMemoryPromptParts().join('\n'),
            },
            {
                key: 'fanfic',
                priority: 98,
                shrinkable: true,
                text: this.getFanficRulesPromptParts().join('\n'),
            },
            {
                key: 'creationMode',
                priority: 97,
                shrinkable: true,
                text: this.getCreationModePromptParts().join('\n'),
            },
            {
                key: 'drivers',
                priority: 60,
                shrinkable: true,
                text: (hasStoryContext
                    ? this.getRelationshipOnlyDriverParts(precedingText)
                    : this.getNarrativeDriverPromptParts(precedingText)).join('\n'),
            },
            {
                key: 'soul',
                priority: 90,
                shrinkable: true,
                text: soulInjection ? ['【主角是谁】', soulInjection, ''].join('\n') : '',
            },
            {
                key: 'brief',
                priority: 95,
                text: hasBrief ? briefParts!.join('\n') : '',
            },
            {
                key: 'knowledgeInjection',
                priority: 70,
                shrinkable: true,
                text: knowledgeInjection && knowledgeInjection.trim() ? knowledgeInjection.trim() : '',
            },
            {
                key: 'storyContext',
                priority: 72,
                shrinkable: true,
                text: this.getStoryContextPackParts(false).join('\n'),
            },
            {
                key: 'context',
                priority: 40,
                shrinkable: true,
                text: this.getCachedContextParts(snap, {
                    skipChapterPlanning: hasBrief,
                    skipCoreInfo: hasStoryContext,
                }).join('\n'),
            },
            {
                key: 'foreshadow',
                priority: 55,
                text: hasStoryContext ? '' : this.getUnrevealedForeshadowReminderPromptParts().join('\n'),
            },
            {
                key: 'plot',
                priority: 100,
                text: plotTarget
                    ? ['【A5 剧情节点推进指引】', plotTarget, '续写必须朝向下一个剧情节点推进，不得原地踏步或提前跳到后面的节点。', ''].join('\n')
                    : '',
            },
        ];

        // 必保片段：上一段正文 + 写作方向 + 收尾指令，任何预算下都不裁剪
        // 前文长度随输入预算自适应（800~2000 字），不再固定丢掉快照里的后 1200 字
        const tailParts: string[] = [
            '【已写内容】',
            precedingText.slice(-resolvePrecedingCharLimit(budget?.maxInputTokens)),
            '',
            '【写作方向】',
            dirPrompt,
        ];
        if (cursorHint) {
            tailParts.push('', '【特别指令】', cursorHint);
        }
        tailParts.push('', (precedingText || '').trim().length < 10
            ? '这是本章的开头。请根据本章大纲和设定，开始写一个自然段（80–220 字，2–6 句）。只输出正文，不要标注、不要解释、不要写标题。'
            : '请自然地续写一个自然段（80–220 字，2–6 句），不要一句一段。只输出正文，不要标注、不要解释、不要写标题。');

        if (budget) {
            const result = assemblePromptWithinBudget({
                systemPrompt,
                sections,
                tailParts,
                maxInputTokens: budget.maxInputTokens,
                modelId: budget.modelId,
            });
            recordBudgetSnapshot({
                source: 'cowrite',
                model: budget.modelId,
                inputTokens: result.estimatedTokens,
                maxInputTokens: budget.maxInputTokens,
                droppedSections: result.droppedSections,
                trimmedSections: result.trimmedSections,
                overBudget: result.overBudget,
            });
            if (result.droppedSections.length > 0 || result.trimmedSections.length > 0 || result.overBudget) {
                log.info('[PromptBuilder] 协同 prompt 按预算裁剪', {
                    estimatedTokens: result.estimatedTokens,
                    maxInputTokens: budget.maxInputTokens,
                    dropped: result.droppedSections,
                    trimmed: result.trimmedSections,
                    overBudget: result.overBudget,
                });
            }
            return { system: result.system, user: result.user };
        }

        return {
            system: systemPrompt,
            user: [...sections.map((s) => s.text), ...tailParts].filter(Boolean).join('\n'),
        };
    }

    /**
     * 按预算裁剪并拼回单一字符串（联想 / 改写 / 迭代这些只接收字符串的入口）。
     * 无预算时由调用方走未裁剪分支，保证行为可对照。
     */
    private assembleWithBudget(
        label: string,
        systemPrompt: string,
        sections: PromptSection[],
        tailParts: string[],
        budget: { maxInputTokens: number; modelId?: string }
    ): string {
        const result = assemblePromptWithinBudget({
            systemPrompt,
            sections,
            tailParts,
            maxInputTokens: budget.maxInputTokens,
            modelId: budget.modelId,
        });
        recordBudgetSnapshot({
            source: 'cowrite',
            model: budget.modelId,
            inputTokens: result.estimatedTokens,
            maxInputTokens: budget.maxInputTokens,
            droppedSections: result.droppedSections,
            trimmedSections: result.trimmedSections,
            overBudget: result.overBudget,
        });
        if (result.droppedSections.length > 0 || result.trimmedSections.length > 0 || result.overBudget) {
            log.info(`[PromptBuilder] ${label} prompt 按预算裁剪`, {
                estimatedTokens: result.estimatedTokens,
                maxInputTokens: budget.maxInputTokens,
                dropped: result.droppedSections,
                trimmed: result.trimmedSections,
                overBudget: result.overBudget,
            });
        }
        return [result.system, result.user].filter(Boolean).join('\n');
    }

    /** 构建选区改写 prompt */
    buildRewritePrompt(
        selectedText: string,
        beforeContext: string,
        afterContext: string,
        cursorHint: string,
        direction: SuggestionDirection,
        fingerprintParts?: string[],
        knowledgeParts?: string[],
        budget?: { maxInputTokens: number; modelId?: string }
    ): string {
        const snap = this.getSnapshot();
        const writingStyle = snap?.writingStyle || '';
        const writingRules = snap?.writingRules || '';

        const systemPrompt = [
            '你是小说协同编辑。改写内容必须保持第三人称视角（他/她），严禁使用第一人称（我）。',
            '',
            '输出语言：简体中文。所有叙事内容必须用纯中文输出，禁止出现任何英文单词或句子。',
            '',
            '请对用户选中的片段给出一个可直接替换的改写版本。',
            '',
            describeBodyFormat(writingRules.trim() ? deriveBodyFormat(writingRules) : { ...DEFAULT_BODY_FORMAT }),
        ].filter(Boolean).join('\n');

        // 项目规则与文笔风格可能很长，放进 sections 参与预算裁剪（system 不裁剪）
        const projectStyleText = [
            writingRules ? '【写作规则（必须遵守）】' : '',
            writingRules ? writingRules.slice(0, 3000) : '',
            writingStyle ? '【文笔风格（请严格遵循此文件定义的风格）】' + writingStyle : '',
        ].filter(Boolean).join('\n');

        const sections: PromptSection[] = [
            {
                key: 'projectStyle',
                priority: 85,
                shrinkable: true,
                text: projectStyleText,
            },
            {
                key: 'memory',
                priority: 20,
                shrinkable: true,
                text: this.getMemoryPromptParts(fingerprintParts).join('\n'),
            },
            {
                key: 'fanfic',
                priority: 98,
                shrinkable: true,
                text: this.getFanficRulesPromptParts().join('\n'),
            },
            {
                key: 'creationMode',
                priority: 97,
                shrinkable: true,
                text: this.getCreationModePromptParts().join('\n'),
            },
            {
                key: 'storyContext',
                priority: 72,
                shrinkable: true,
                text: this.getStoryContextPackParts(false).join('\n'),
            },
            {
                key: 'knowledge',
                priority: 25,
                shrinkable: true,
                text: (knowledgeParts && knowledgeParts.length > 0 ? knowledgeParts : []).join('\n'),
            },
            {
                key: 'drivers',
                priority: 60,
                shrinkable: true,
                text: (this.getStoryContextPackParts(false).length > 0
                    ? this.getRelationshipOnlyDriverParts(beforeContext)
                    : this.getNarrativeDriverPromptParts(beforeContext)).join('\n'),
            },
        ];

        // 必保片段：改写目标、临时指令、前后文、选中文本、输出约束
        const tailParts: string[] = [
            '【改写目标】',
            DIRECTION_PROMPTS[direction] || DIRECTION_PROMPTS.description,
            cursorHint ? `【特别指令】\n${cursorHint}` : '',
            '',
            '【前文】',
            beforeContext.slice(-500),
            '',
            '【选中文本】',
            selectedText,
            '',
            '【后文】',
            afterContext.slice(0, 300),
            '',
            '请输出 1 个改写版本，保持剧情事实不变，不要解释。'
        ];

        if (budget) {
            return this.assembleWithBudget('选区改写', systemPrompt, sections, tailParts, budget);
        }

        return [systemPrompt, ...sections.map(s => s.text), ...tailParts].filter(Boolean).join('\n');
    }

    /** 构建编辑验证 prompt */
    buildValidationPrompt(
        modifiedText: string,
        originalText: string,
        context: string
    ): string {
        return [
            '你是一个小说编辑。请验证以下编辑是否符合故事的整体一致性。',
            '',
            '【原文建议】',
            originalText,
            '',
            '【用户修改后】',
            modifiedText,
            '',
            '【上下文】',
            context.slice(-500),
            '',
            '请评估三个方面（各 0-100 分）：',
            '1. 设定一致性：是否与已有世界观/人物设定冲突',
            '2. 文风对齐：是否与整体文风一致',
            '3. 剧情对齐：是否推动当前场景目标',
            '',
            '请以 JSON 格式返回（不要包含 markdown 代码块标记）：',
            '{',
            '  "consistencyScore": 85,',
            '  "styleScore": 78,',
            '  "plotAlignmentScore": 90,',
            '  "warnings": ["警告信息"],',
            '  "suggestions": ["改进建议"]',
            '}'
        ].join('\n');
    }

    /** 构建联想输入 prompt */
    buildAssociationPrompt(
        context: string,
        hint: AssociationHint,
        fingerprintParts?: string[],
        knowledgeParts?: string[],
        briefParts?: string[],
        budget?: { maxInputTokens: number; modelId?: string }
    ): string {
        const snap = this.getSnapshot();
        const writingStyle = snap?.writingStyle || '';
        const writingRules = snap?.writingRules || '';

        const systemPrompt = [
            '你是第三人称叙事者。所有续写必须使用第三人称（他/她），严禁使用第一人称（我）。',
            '',
            '输出语言：简体中文。所有叙事内容必须用纯中文输出，禁止出现任何英文单词或句子。',
            '',
            describeBodyFormat(writingRules.trim() ? deriveBodyFormat(writingRules) : { ...DEFAULT_BODY_FORMAT }),
            '',
            '根据上下文，续写1-2句话（30-80字）。',
        ].filter(Boolean).join('\n');

        // 项目规则与文笔风格可能很长，放进 sections 参与预算裁剪（system 不裁剪）
        const projectStyleText = [
            writingRules ? '【写作规则（必须遵守）】' : '',
            writingRules ? writingRules.slice(0, 2000) : '',
            writingStyle ? '【文笔风格（请严格遵循此文件定义的风格）】' + writingStyle : '',
        ].filter(Boolean).join('\n');

        const sections: PromptSection[] = [
            {
                key: 'projectStyle',
                priority: 85,
                shrinkable: true,
                text: projectStyleText,
            },
            {
                key: 'memory',
                priority: 20,
                shrinkable: true,
                text: this.getMemoryPromptParts(fingerprintParts).join('\n'),
            },
            {
                key: 'knowledge',
                priority: 25,
                shrinkable: true,
                text: (knowledgeParts && knowledgeParts.length > 0 ? knowledgeParts : []).join('\n'),
            },
            {
                key: 'fanfic',
                priority: 98,
                shrinkable: true,
                text: this.getFanficRulesPromptParts().join('\n'),
            },
            {
                key: 'creationMode',
                priority: 97,
                shrinkable: true,
                text: this.getCreationModePromptParts().join('\n'),
            },
            {
                key: 'storyContext',
                priority: 62,
                shrinkable: true,
                text: this.getStoryContextPackParts(true).join('\n'),
            },
            {
                key: 'brief',
                priority: 95,
                text: (briefParts && briefParts.length > 0 ? briefParts : []).join('\n'),
            },
        ];

        // 必保片段：当前上下文 + 联想提示 + 输出约束。本地模型从尾部截断，这几段不能被裁掉
        const tailParts: string[] = ['【上下文】', context.slice(-300)];

        if (hint.type === 'entity-action' && hint.entity) {
            tailParts.push('', `【提示】${hint.entity}接下来可能做什么动作？`);
        } else if (hint.type === 'escalate' && hint.emotion) {
            tailParts.push('', `【提示】情绪正在${hint.emotion === 'anger' ? '愤怒' : '恐惧'}中升级。`);
        } else if (hint.type === 'dialogue') {
            tailParts.push('', '【提示】完成这个对话。');
        }

        tailParts.push('', '直接输出续写内容，不要解释：');

        if (budget) {
            return this.assembleWithBudget('联想续写', systemPrompt, sections, tailParts, budget);
        }

        return [systemPrompt, ...sections.map(s => s.text), ...tailParts].filter(Boolean).join('\n');
    }

    /** 构建句级建议迭代 prompt（在已有候选上做定向修改） */
    buildIteratePrompt(
        originalText: string,
        precedingContext: string,
        instruction: string,
        cursorHint: string,
        fingerprintParts?: string[],
        knowledgeParts?: string[],
        budget?: { maxInputTokens: number; modelId?: string }
    ): string {
        const systemPrompt =
            '你是小说句级协同写作助手。用户不想重新生成整组建议，而是要基于当前候选做一次定向迭代。';

        const sections: PromptSection[] = [
            {
                key: 'memory',
                priority: 20,
                shrinkable: true,
                text: this.getMemoryPromptParts(fingerprintParts).join('\n'),
            },
            {
                key: 'knowledge',
                priority: 25,
                shrinkable: true,
                text: (knowledgeParts && knowledgeParts.length > 0 ? knowledgeParts : []).join('\n'),
            },
            {
                key: 'fanfic',
                priority: 98,
                shrinkable: true,
                text: this.getFanficRulesPromptParts().join('\n'),
            },
            {
                key: 'creationMode',
                priority: 97,
                shrinkable: true,
                text: this.getCreationModePromptParts().join('\n'),
            },
            {
                key: 'storyContext',
                priority: 62,
                shrinkable: true,
                text: this.getStoryContextPackParts(true).join('\n'),
            },
            {
                key: 'drivers',
                priority: 60,
                shrinkable: true,
                text: (this.getStoryContextPackParts(true).length > 0
                    ? this.getRelationshipOnlyDriverParts(precedingContext)
                    : this.getNarrativeDriverPromptParts(precedingContext)).join('\n'),
            },
        ];

        // 必保片段：前文 + 原候选 + 用户指令 + 输出约束（尾部被截断会直接丢失迭代要求）
        const tailParts: string[] = [
            '【已写前文】',
            precedingContext.slice(-resolvePrecedingCharLimit(budget?.maxInputTokens)),
            '',
            '【原候选】',
            originalText,
            '',
            '【用户迭代指令】',
            instruction,
            cursorHint ? `\n【临时写作方向】\n${cursorHint}` : '',
            '',
            '请只输出 1 个新版候选，保持剧情事实连续，不要解释，不要列点。',
        ];

        if (budget) {
            return this.assembleWithBudget('建议迭代', systemPrompt, sections, tailParts, budget);
        }

        return [systemPrompt, ...sections.map(s => s.text), ...tailParts].filter(Boolean).join('\n');
    }

    /** 构建 OOC 检测 prompt */
    buildOOCPrompt(
        text: string,
        soul: CharacterSoul
    ): string {
        return [
            '你是角色设定审查员。检查以下文本是否违背角色的核心特质。',
            '',
            '【角色灵魂层】',
            `- 最渴望: ${soul.desire}`,
            `- 最恐惧: ${soul.fear}`,
            `- 执念: ${soul.obsession}`,
            `- 创伤: ${soul.trauma}`,
            `- 弱点: ${soul.weakness}`,
            `- 软处: ${soul.soft_spot}`,
            `- 暴走红线: ${soul.rage_trigger}`,
            `- 底线: ${soul.moral_boundary}`,
            '',
            '【待检查文本】',
            text,
            '',
            '请判断：该角色在此文本中的行为/心理是否符合其核心特质？',
            '以 JSON 格式返回（不要包含 markdown 代码块）：',
            '{',
            '  "hasOOC": false,',
            '  "warnings": ["如果违背，列出具体问题"],',
            '  "score": 85,',
            '  "violatedFields": ["desire", "fear"] // 违背的字段名',
            '}'
        ].join('\n');
    }
}