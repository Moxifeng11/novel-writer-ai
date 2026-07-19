/**
 * prompt-builder.ts — v5.5 从 CoWriterEngine 拆出的 Prompt 构建模块
 * 负责 A2/A3/A4/D2/E1/E3 的 prompt 注入片段生成
 */

import type { StyleLearner } from './style-learner';
import type { PreferenceMemory } from './preference-memory';
import type { SuggestionDirection } from '../shared/types';
import type { AssociationHint } from '../shared/co-writer-types';
import type { CharacterSoul } from './character-soul';
import type { StyleFingerprintLibrary, VectorStore } from './style-fingerprint-library';
import type { KnowledgeBaseManager } from '../services/knowledge-base-manager';
import type { KnowledgeSearchResult, KnowledgeVectorStore } from './knowledge-vector-store';
import { createLogger } from '../shared/logger';

const log = createLogger('PromptBuilder');
import {
    ContextAnalyzer,
    DynamicSampleSelector,
    TieredInjectionBuilder,
} from './style/dynamic-injection-engine';

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
}

export class PromptBuilder {
    private knowledgeVectorStore?: KnowledgeVectorStore | null;
    private knowledgeManager?: KnowledgeBaseManager | null;
    private referenceBookIds: string[] = [];
    private knowledgeCache: Map<string, { result: string[], contentHash: string }> = new Map();
    private cachedSystemPrompt: string | null = null;
    private l2ContextCache: Map<string, { parts: string[]; timestamp: number }> = new Map();
    private readonly L2_CACHE_TTL = 5000;
    /** 动态风格注入引擎（懒加载） */
    private contextAnalyzer?: ContextAnalyzer;
    private dynamicSampleSelector?: DynamicSampleSelector;
    private tieredInjectionBuilder?: TieredInjectionBuilder;

    constructor(
        private getSnapshot: () => PromptSnapshot | null,
        private styleLearner?: StyleLearner | null,
        private preferenceMemory?: PreferenceMemory | null,
        private fingerprintLibrary?: StyleFingerprintLibrary | null,
        private vectorStore?: VectorStore | null
    ) {}

    private getSystemPrompt(): string {
        if (!this.cachedSystemPrompt) {
            this.cachedSystemPrompt = [
                '你是一位第三人称限知视角的叙事者。你不是在"写小说"，你是在用镜头紧贴主角，把他/她正在经历的一切原样呈现出来。',
                '',
                '【叙事视角规则】',
                '- 严格第三人称限知：只写主角能看到、听到、摸到、感受到的东西。',
                '- 不跳其他角色的内心，不写上帝视角的全局解释。',
                '- 严禁使用第一人称「我」叙事。所有描写必须是第三人称（他/她/它），这是硬性规则，不可违反。',
                '- 心理活动用自由间接引语，不用"他心想""他觉得"这种标签。',
                '- 所有认知都从主角的感官出发，有温度、有重量、有气味。',
                '',
                '【怎么写才像活人经历的】',
                '- 不说教，不总结，不解释。事情在发生，不是在被讲述。',
                '- 情绪不说出口。不讲"他很难过"，讲"他指尖无意识掐进掌心"。',
                '- 不用排比，不用华丽辞藻堆砌。活人眼里的世界没那么多修辞。',
                '- 每句只讲一件事。一句话就是一个画面。',
                '- 不重复。同样的意思不说第二遍。',
                '- 不用"然后""接着""就在这时"这种过渡词。画面直接跳。',
                '',
                '【番茄小说分段格式】',
                '- 段落极短，大多只有一句话。',
                '- 一句话就是一段，换行直接切下一个画面。',
                '- 段落之间只用一个换行，不要留空行，不要用两个回车。',
                '- 每段首行缩进一个制表符（Tab）。',
                '- 对话单独成段，前后不要留空行。',
                '- 感官细节单独成段，一个细节就是一记重锤。',
                '',
                '输出语言：简体中文。所有叙事内容必须用纯中文输出，禁止出现任何英文单词或句子。',
            ].join('\n');
        }
        return this.cachedSystemPrompt;
    }

    private getCachedContextParts(snap: PromptSnapshot | null): string[] {
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
            `${worldType}|${writingStyle}|${allChars}|${allFactions}|${allLocs}|${allItems}|${writingRules}|${chapPlan}|${sceneExpansion}|${prevChaptersSummary}|${settingLib}|${timeline}|${triggeredMemories}`
        );

        const cached = this.l2ContextCache.get(cacheKey);
        if (cached && (Date.now() - cached.timestamp) < this.L2_CACHE_TTL) {
            return cached.parts;
        }

        const parts: string[] = [
            worldType ? `【世界背景】你活在${worldType}题材的世界。` : '',
            '',
            allChars ? '【人物总览】' : '',
            allChars ? allChars.slice(0, 3000) : '',
            allChars ? '' : '',
            allFactions ? '【势力总览】' : '',
            allFactions ? allFactions.slice(0, 2000) : '',
            allFactions ? '' : '',
            allLocs ? '【地点总览】' : '',
            allLocs ? allLocs.slice(0, 2000) : '',
            allLocs ? '' : '',
            allItems ? '【物品功法总览】' : '',
            allItems ? allItems.slice(0, 2000) : '',
            allItems ? '' : '',
            writingRules ? '【写作规则（必须遵守）】' : '',
            writingRules ? writingRules.slice(0, 3000) : '',
            writingRules ? '' : '',
            writingStyle ? '【文笔风格（请严格遵循此文件定义的风格）】' + writingStyle : '',
            '',
            chapPlan ? '【本章大纲】' : '',
            chapPlan ? chapPlan.slice(0, 3000) : '',
            chapPlan ? '' : '',
            sceneExpansion ? '【场景展开】' : '',
            sceneExpansion ? sceneExpansion.slice(0, 3000) : '',
            sceneExpansion ? '' : '',
            prevChaptersSummary ? '【前章摘要】' : '',
            prevChaptersSummary ? prevChaptersSummary.slice(0, 3000) : '',
            prevChaptersSummary ? '' : '',
            triggeredMemories ? '【触发的记忆碎片】' : '',
            triggeredMemories ? triggeredMemories.slice(0, 2000) : '',
            triggeredMemories ? '' : '',
            settingLib ? '【设定库】' : '',
            settingLib ? settingLib.slice(0, 3000) : '',
            settingLib ? '' : '',
            timeline ? '【时间线】' : '',
            timeline ? timeline.slice(0, 2000) : '',
            timeline ? '' : '',
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

            // 2. 向量检索（扩大到 5 条，让 rerank 有空间）
            const searchResults = await this.vectorStore.search(queryTail.slice(-500), 5);

            // 3. 动态示例选择（TR-6.2）：对检索结果做基于上下文的 rerank
            const samplesWithFpId = searchResults.map(r => ({
                sample: r.sample,
                score: r.score,
                fingerprintId: undefined as string | undefined,
            }));
            const selectedSamples = this.dynamicSampleSelector.select(samplesWithFpId, context, 3);

            // 4. 分级注入拼装（TR-6.3 + TR-6.5）：全局层 + 段落层 + 句子层
            const result = this.tieredInjectionBuilder.build(
                enabledFingerprints,
                selectedSamples,
                context,
            );

            return result;
        } catch (e) {
            log.warn('[PromptBuilder] 指纹 prompt 生成失败:', e);
            return [];
        }
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
        this.knowledgeManager = knowledgeManager;
        this.knowledgeVectorStore = knowledgeVectorStore;
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
            const contentHash = this.simpleHash(searchQuery + (bookIds || []).join(','));
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

            try {
                const allResults = await this.knowledgeVectorStore!.search(searchQuery, {
                    topN: combinedTopN,
                    bookIds: bookIds,
                    dimensions: ['style', 'rhythm', 'technique', 'structure'],
                });

                styleResults = allResults.filter(r => r.dimension === 'style');
                rhythmResults = allResults.filter(r => r.dimension === 'rhythm');
                techniqueResults = allResults.filter(r => r.dimension === 'technique' || r.dimension === 'structure');
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
                let filteredRhythm = rhythmResults;
                if (direction === 'emotion') {
                    filteredRhythm = rhythmResults
                        .sort((a, b) => (b.position ?? 0) - (a.position ?? 0))
                        .slice(0, rhythmTopN);
                } else {
                    filteredRhythm = rhythmResults.slice(0, rhythmTopN);
                }

                if (filteredRhythm.length > 0) {
                    const rhythmLines: string[] = [];
                    for (let i = 0; i < filteredRhythm.length; i++) {
                        const r = filteredRhythm[i];
                        const sample = r.sample.slice(0, 150);
                        const scorePct = Math.round(r.score * 100);
                        rhythmLines.push(`- 《${r.bookName}》${scorePct}%：${sample}`);
                    }
                    parts.push('【写作知识库 - 节奏参考】', '参考书籍同位置节奏模式：', ...rhythmLines, '');
                }
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

    /** 统一聚合 A2/A3/A4/D2 注入点 */
    getNarrativeDriverPromptParts(precedingText: string): string[] {
        return [
            ...this.getEmotionAnchorPromptParts(),
            ...this.getForeshadowTriggerPromptParts(precedingText),
            ...this.getRelationshipDriverPromptParts(precedingText),
            ...this.getCrossVolumePromptParts()
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
        knowledgeInjection?: string
    ): { system: string; user: string } {
        const dirPrompt = DIRECTION_PROMPTS[direction] || DIRECTION_PROMPTS.action;
        const snap = this.getSnapshot();

        let systemPrompt = this.getSystemPrompt();
        if (knowledgeInjection && knowledgeInjection.trim()) {
            systemPrompt += '\n' + knowledgeInjection.trim();
        }

        const userParts: string[] = [
            ...this.getMemoryPromptParts(fingerprintParts),
            ...(knowledgeParts && knowledgeParts.length > 0 ? knowledgeParts : []),
            ...this.getNarrativeDriverPromptParts(precedingText),
            soulInjection ? '【主角是谁】' : '',
            soulInjection,
            soulInjection ? '' : '',
            ...this.getCachedContextParts(snap),
            ...this.getUnrevealedForeshadowReminderPromptParts(),
            plotTarget ? '【A5 剧情节点推进指引】' : '',
            plotTarget ? plotTarget : '',
            plotTarget ? '续写必须朝向下一个剧情节点推进，不得原地踏步或提前跳到后面的节点。' : '',
            plotTarget ? '' : '',
            '【已写内容】',
            precedingText.slice(-800),
            '',
            '【写作方向】',
            dirPrompt
        ].filter(Boolean);

        if (cursorHint) {
            userParts.push('', '【特别指令】', cursorHint);
        }

        userParts.push('', (precedingText || '').trim().length < 10
            ? '这是本章的开头。请根据本章大纲和设定，开始写正文。不需要多，但要让人感觉这一瞬间是真实的。只输出正文，不要标注、不要解释、不要写标题。'
            : '请自然地续写一段。不需要多，但要让人感觉这一瞬间是真实的。只输出正文，不要标注、不要解释、不要写标题。');

        return { system: systemPrompt, user: userParts.join('\n') };
    }

    /** 构建选区改写 prompt */
    buildRewritePrompt(
        selectedText: string,
        beforeContext: string,
        afterContext: string,
        cursorHint: string,
        direction: SuggestionDirection,
        fingerprintParts?: string[],
        knowledgeParts?: string[]
    ): string {
        const snap = this.getSnapshot();
        const writingStyle = snap?.writingStyle || '';
        const writingRules = snap?.writingRules || '';

        return [
            '你是小说协同编辑。改写内容必须保持第三人称视角（他/她），严禁使用第一人称（我）。',
            '',
            '输出语言：简体中文。所有叙事内容必须用纯中文输出，禁止出现任何英文单词或句子。',
            '',
            '请对用户选中的片段给出一个可直接替换的改写版本。',
            '',
            ...this.getMemoryPromptParts(fingerprintParts),
            ...(knowledgeParts && knowledgeParts.length > 0 ? knowledgeParts : []),
            ...this.getNarrativeDriverPromptParts(beforeContext),
            writingRules ? '【写作规则（必须遵守）】' : '',
            writingRules ? writingRules.slice(0, 3000) : '',
            writingRules ? '' : '',
            writingStyle ? '【文笔风格（请严格遵循此文件定义的风格）】' + writingStyle : '',
            writingStyle ? '' : '',
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
        ].filter(Boolean).join('\n');
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
        knowledgeParts?: string[]
    ): string {
        const snap = this.getSnapshot();
        const writingStyle = snap?.writingStyle || '';
        const writingRules = snap?.writingRules || '';

        const promptParts: string[] = [
            '你是第三人称叙事者。所有续写必须使用第三人称（他/她），严禁使用第一人称（我）。',
            '',
            '输出语言：简体中文。所有叙事内容必须用纯中文输出，禁止出现任何英文单词或句子。',
            '',
            '根据上下文，续写1-2句话（30-80字）。',
            '',
            ...this.getMemoryPromptParts(fingerprintParts),
            ...(knowledgeParts && knowledgeParts.length > 0 ? knowledgeParts : []),
            writingRules ? '【写作规则（必须遵守）】' : '',
            writingRules ? writingRules.slice(0, 2000) : '',
            writingRules ? '' : '',
            writingStyle ? '【文笔风格（请严格遵循此文件定义的风格）】' + writingStyle : '',
            writingStyle ? '' : '',
            '【上下文】',
            context.slice(-300)
        ];

        if (hint.type === 'entity-action' && hint.entity) {
            promptParts.push('', `【提示】${hint.entity}接下来可能做什么动作？`);
        } else if (hint.type === 'escalate' && hint.emotion) {
            promptParts.push('', `【提示】情绪正在${hint.emotion === 'anger' ? '愤怒' : '恐惧'}中升级。`);
        } else if (hint.type === 'dialogue') {
            promptParts.push('', '【提示】完成这个对话。');
        }

        promptParts.push('', '直接输出续写内容，不要解释：');

        return promptParts.join('\n');
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