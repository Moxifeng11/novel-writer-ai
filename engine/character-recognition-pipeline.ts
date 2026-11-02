/**
 * character-recognition-pipeline.ts — 角色识别三层流水线
 *
 * Layer 1: 规则层（CharacterDeconstructor 纯统计方法）
 * Layer 2: 向量层（预留，语义过滤 + 同指消解）
 * Layer 3: LLM 层（预留，角色校验 + 称号抽取）
 *
 * 支持降级：任一层失败/关闭时自动回退到上一层结果
 */

import type {
    AnalysisSuggestion,
    CharacterCandidate,
    RecognitionPipelineOptions,
    CharacterRecognitionResult,
    SuggestionSource
} from './types/analysis-suggestion';
import type { Character, CharacterAnalysisResult } from './deconstructors/character-deconstructor';
import type { VectorEnhancer } from './vector-enhancer';
import type { LLMEnhancer } from './llm-enhancer';
import { CharacterDeconstructor } from './deconstructors/character-deconstructor';
import { SuggestionManager } from './suggestion-manager';
import { createLogger } from '../shared/logger';
import { getDegradationNotifier } from '../shared/degradation-notifier';

const log = createLogger('CharacterRecognitionPipeline');

const DEFAULT_MAX_CANDIDATES = 100;
const CONTEXT_WINDOW = 100;
const MAX_EVIDENCE_PER_CHARACTER = 5;

export class CharacterRecognitionPipeline {
    private deconstructor: CharacterDeconstructor;
    private suggestionManager: SuggestionManager;
    private vectorEnhancer: VectorEnhancer | null;
    private llmEnhancer: LLMEnhancer | null;

    constructor(
        deconstructor: CharacterDeconstructor,
        suggestionManager: SuggestionManager,
        vectorEnhancer?: VectorEnhancer,
        llmEnhancer?: LLMEnhancer
    ) {
        this.deconstructor = deconstructor;
        this.suggestionManager = suggestionManager;
        this.vectorEnhancer = vectorEnhancer ?? null;
        this.llmEnhancer = llmEnhancer ?? null;
    }

    /**
     * 执行角色识别三层流水线
     * @param text 待分析文本
     * @param options 流水线配置选项
      * @returns CharacterRecognitionResult 实例
     */
    async analyze(text: string, options: RecognitionPipelineOptions): Promise<CharacterRecognitionResult> {
        const errors: string[] = [];
        const layerStatus: CharacterRecognitionResult['layerStatus'] = {
            rule: 'skipped',
            vector: 'skipped',
            llm: 'skipped'
        };

        let ruleCandidates: CharacterCandidate[] = [];
        let vectorFiltered: CharacterCandidate[] = [];
        let llmVerified: CharacterCandidate[] = [];
        let mergeSuggestions: AnalysisSuggestion[] = [];

        const maxCandidates = options.maxCandidates ?? DEFAULT_MAX_CANDIDATES;
        const onProgress = options.onProgress;

        if (options.enableRuleLayer) {
            try {
                onProgress?.('规则层', 0);
                ruleCandidates = await this.ruleLayerExtract(text);
                ruleCandidates = this.truncateCandidates(ruleCandidates, maxCandidates);
                layerStatus.rule = 'success';
                log.info(`[规则层] 提取到 ${ruleCandidates.length} 个角色候选`);
            } catch (e) {
                layerStatus.rule = 'failed';
                const errMsg = e instanceof Error ? e.message : String(e);
                errors.push(`规则层失败: ${errMsg}`);
                log.error('[规则层] 执行失败', e);
            }
            onProgress?.('规则层', 33);
        }

        if (options.enableVectorLayer && layerStatus.rule === 'success') {
            try {
                onProgress?.('向量层', 33);
                const vectorResult = await this.vectorLayerRefine(ruleCandidates, text);
                vectorFiltered = vectorResult.candidates;
                mergeSuggestions = vectorResult.mergeSuggestions;
                vectorFiltered = this.truncateCandidates(vectorFiltered, maxCandidates);
                layerStatus.vector = vectorResult.layerStatus;
                log.info(`[向量层] 精炼后剩余 ${vectorFiltered.length} 个角色候选，合并建议 ${mergeSuggestions.length} 条`);
            } catch (e) {
                layerStatus.vector = 'failed';
                const errMsg = e instanceof Error ? e.message : String(e);
                errors.push(`向量层失败，降级使用规则层结果: ${errMsg}`);
                log.warn('[向量层] 执行失败，降级到规则层', e);
                vectorFiltered = [...ruleCandidates];
            }
            onProgress?.('向量层', 66);
        } else {
            vectorFiltered = [...ruleCandidates];
        }

        if (options.enableLLMLayer && (layerStatus.vector === 'success' || layerStatus.rule === 'success')) {
            const inputCandidates = layerStatus.vector === 'success' ? vectorFiltered : ruleCandidates;
            try {
                onProgress?.('LLM层', 66);
                const llmResult = await this.llmLayerVerify(inputCandidates, text);
                llmVerified = llmResult.candidates;
                const llmMergeSuggestions = llmResult.mergeSuggestions;
                mergeSuggestions = [...mergeSuggestions, ...llmMergeSuggestions];
                llmVerified = this.truncateCandidates(llmVerified, maxCandidates);
                layerStatus.llm = llmResult.layerStatus;
                log.info(`[LLM层] 校验后剩余 ${llmVerified.length} 个角色候选，合并建议 ${llmMergeSuggestions.length} 条`);
            } catch (e) {
                layerStatus.llm = 'failed';
                const errMsg = e instanceof Error ? e.message : String(e);
                errors.push(`LLM层失败，降级使用向量层/规则层结果: ${errMsg}`);
                log.warn('[LLM层] 执行失败，降级到向量层/规则层', e);
                llmVerified = [...inputCandidates];
            }
            onProgress?.('LLM层', 100);
        } else {
            llmVerified = [...vectorFiltered];
        }

        const finalSource: SuggestionSource =
            layerStatus.llm === 'success' ? 'llm' :
            layerStatus.vector === 'success' ? 'vector' : 'rule';

        const suggestions = this.generateSuggestions(llmVerified, finalSource);
        const finalCharacters = this.candidatesToCharacters(llmVerified);

        return {
            ruleCandidates,
            vectorFiltered,
            llmVerified,
            finalCharacters,
            suggestions,
            mergeSuggestions,
            layerStatus,
            errors: errors.length > 0 ? errors : undefined
        };
    }

    /**
     * Layer 1: 规则层提取
     * 调用 CharacterDeconstructor 分析文本，转换为 CharacterCandidate 格式
     * @param text 待分析文本
     */
    private async ruleLayerExtract(text: string): Promise<CharacterCandidate[]> {
        if (!text || text.length === 0) {
            return [];
        }

        const result: CharacterAnalysisResult = await this.deconstructor.analyze(text);
        const characters = result.characters || [];

        const candidates = this.charactersToCandidates(characters, 'rule');

        for (const candidate of candidates) {
            candidate.evidence = this.extractEvidence(text, candidate.name, MAX_EVIDENCE_PER_CHARACTER);
            candidate.confidence = this.calculateRuleConfidence(candidate, characters);
        }

        return candidates.sort((a, b) => b.confidence - a.confidence);
    }

    /**
     * Layer 2: 向量层精炼
     * 用语义相似度过滤非人名词候选项，并生成同指合并建议
     * @param candidates 规则层候选
     * @param text 原始文本
     */
    private async vectorLayerRefine(
        candidates: CharacterCandidate[],
        text: string
    ): Promise<{ candidates: CharacterCandidate[]; mergeSuggestions: AnalysisSuggestion[]; layerStatus: 'success' | 'skipped' }> {
        if (!this.vectorEnhancer) {
            log.info('[向量层] 未配置 VectorEnhancer，跳过');
            return {
                candidates: candidates.map(c => ({ ...c, source: 'vector' as SuggestionSource })),
                mergeSuggestions: [],
                layerStatus: 'skipped'
            };
        }

        try {
            const available = await this.vectorEnhancer.isAvailable();
            if (!available) {
                log.info('[向量层] 向量模型不可用，跳过');
                // A3: 语义过滤/合并层静默跳过 → 补 info 级降级痕迹（不弹 Notice）。
                getDegradationNotifier().notify({
                    source: 'vector',
                    dimension: 'character',
                    from: 'vector',
                    to: 'keyword_stats',
                    reason: this.vectorEnhancer.getUnavailableReason() || '向量模型不可用',
                    severity: 'info',
                    recoverable: true,
                });
                return {
                    candidates: candidates.map(c => ({ ...c, source: 'vector' as SuggestionSource })),
                    mergeSuggestions: [],
                    layerStatus: 'skipped'
                };
            }

            log.info('[向量层] 开始语义过滤...');
            const filteredCandidates = await this.vectorEnhancer.filterCandidatesBySemantics(candidates, text);
            const updatedCandidates = filteredCandidates.map(c => ({ ...c, source: 'vector' as SuggestionSource }));

            log.info('[向量层] 开始上下文合并分析...');
            const mergeSuggestions = await this.vectorEnhancer.mergeCandidatesByContextSimilarity(updatedCandidates, text);

            return {
                candidates: updatedCandidates,
                mergeSuggestions,
                layerStatus: 'success'
            };
        } catch (e) {
            log.warn('[向量层] 执行出错，降级使用原候选', e);
            return {
                candidates: candidates.map(c => ({ ...c, source: 'vector' as SuggestionSource })),
                mergeSuggestions: [],
                layerStatus: 'skipped'
            };
        }
    }

    /**
     * Layer 3: LLM 层校验与称号抽取
     * 调用 LLMEnhancer 进行角色校验和称号/别名抽取
     * @param candidates 上层候选
     * @param text 原始文本
     */
    private async llmLayerVerify(
        candidates: CharacterCandidate[],
        text: string
    ): Promise<{ candidates: CharacterCandidate[]; mergeSuggestions: AnalysisSuggestion[]; layerStatus: 'success' | 'skipped' }> {
        if (!this.llmEnhancer) {
            log.info('[LLM层] 未配置 LLMEnhancer，跳过');
            return {
                candidates: candidates.map(c => ({ ...c, source: 'llm' as SuggestionSource })),
                mergeSuggestions: [],
                layerStatus: 'skipped'
            };
        }

        try {
            const textSample = this.buildTextSample(text);
            log.info('[LLM层] 开始角色校验...');
            const verifiedCandidates = await this.llmEnhancer.verifyCharactersWithLLM(
                candidates,
                textSample
            );

            log.info('[LLM层] 开始称号/别名抽取...');
            const titleSuggestions = await this.llmEnhancer.extractTitlesAndAliases(
                verifiedCandidates,
                textSample
            );

            return {
                candidates: verifiedCandidates,
                mergeSuggestions: titleSuggestions,
                layerStatus: 'success'
            };
        } catch (e) {
            log.warn('[LLM层] 执行出错，降级使用原候选', e);
            return {
                candidates: candidates.map(c => ({ ...c, source: 'llm' as SuggestionSource })),
                mergeSuggestions: [],
                layerStatus: 'skipped'
            };
        }
    }

    /**
     * 构建文本样本（截取前 2000 字用于 LLM 上下文）
     */
    private buildTextSample(text: string): string {
        const MAX_CHARS = 2000;
        if (text.length <= MAX_CHARS) return text;
        return text.slice(0, MAX_CHARS);
    }

    /**
     * 从角色候选生成分析建议列表
     * @param candidates 角色候选列表
     * @param source 来源层级
     */
    private generateSuggestions(candidates: CharacterCandidate[], source: 'rule' | 'vector' | 'llm'): AnalysisSuggestion[] {
        const suggestions: AnalysisSuggestion[] = [];

        for (const candidate of candidates) {
            this.suggestionManager.addSuggestion({
                type: 'character',
                confidence: candidate.confidence,
                source,
                payload: {
                    name: candidate.name,
                    aliases: candidate.aliases,
                    mentionCount: candidate.mentionCount,
                    firstAppearance: candidate.firstAppearance,
                    lastAppearance: candidate.lastAppearance
                },
                evidence: candidate.evidence,
                reason: `来自${source === 'rule' ? '规则' : source === 'vector' ? '向量' : 'LLM'}层的角色识别结果`
            });
        }

        return this.suggestionManager.getAllSuggestions('character');
    }

    /**
     * 将 Character[] 转换为 CharacterCandidate[]
     * @param characters 角色数组
     * @param source 来源层级
     */
    private charactersToCandidates(characters: Character[], source: 'rule' | 'vector' | 'llm'): CharacterCandidate[] {
        return characters.map((char: Character) => ({
            name: char.name,
            aliases: char.aliases || [],
            confidence: 0,
            source,
            evidence: [],
            mentionCount: char.mentionCount || char.appearanceCount || 0,
            firstAppearance: char.firstAppearance || 0,
            lastAppearance: char.lastAppearance || 0
        }));
    }

    /**
     * 将 CharacterCandidate[] 转换为 Character[]
     * 用于向后兼容，输出与原 character-deconstructor 一致的格式
     * @param candidates 角色候选数组
     */
    private candidatesToCharacters(candidates: CharacterCandidate[]): Character[] {
        return candidates.map((candidate, index) => ({
            id: `char_${index}`,
            name: candidate.name,
            aliases: candidate.aliases,
            role: index === 0 ? 'protagonist' : 'supporting',
            firstAppearance: candidate.firstAppearance,
            lastAppearance: candidate.lastAppearance,
            appearanceCount: candidate.mentionCount,
            mentionCount: candidate.mentionCount,
            personality: [],
            abilities: [],
            growthStages: [],
            relationships: []
        } as Character));
    }

    /**
     * 计算规则层置信度（0-1 归一化）
     * 基于 mentionCount、角色重要性权重等综合计算
     * @param candidate 角色候选
     * @param allCharacters 全部角色（用于归一化）
     */
    private calculateRuleConfidence(candidate: CharacterCandidate, allCharacters: Character[]): number {
        if (allCharacters.length === 0) return 0;

        const maxMention = Math.max(...allCharacters.map(c => c.mentionCount || 0), 1);
        const mentionScore = Math.min(candidate.mentionCount / maxMention, 1);

        const spreadScore = candidate.lastAppearance - candidate.firstAppearance;

        const aliasBonus = candidate.aliases.length > 0 ? 0.05 * Math.min(candidate.aliases.length, 3) : 0;

        const rawScore = mentionScore * 0.7 + spreadScore * 0.25 + aliasBonus;
        return Math.min(Math.max(rawScore, 0), 1);
    }

    /**
     * 提取角色出现的上下文证据片段
     * @param text 原始文本
     * @param name 角色名称
     * @param maxCount 最大证据数量
     */
    private extractEvidence(text: string, name: string, maxCount: number): string[] {
        const evidence: string[] = [];
        let idx = 0;
        const positions: number[] = [];

        while ((idx = text.indexOf(name, idx)) !== -1 && evidence.length < maxCount * 3) {
            positions.push(idx);
            idx += name.length;
        }

        if (positions.length === 0) return evidence;

        const step = Math.max(1, Math.floor(positions.length / maxCount));
        for (let i = 0; i < positions.length && evidence.length < maxCount; i += step) {
            const pos = positions[i];
            const start = Math.max(0, pos - CONTEXT_WINDOW / 2);
            const end = Math.min(text.length, pos + name.length + CONTEXT_WINDOW / 2);
            const context = text.substring(start, end);
            const sentence = this.extractSentence(context, name);
            if (sentence && !evidence.includes(sentence)) {
                evidence.push(sentence);
            }
        }

        return evidence.slice(0, maxCount);
    }

    /**
     * 从上下文中提取包含关键词的完整句子
     * @param context 上下文文本
     * @param keyword 关键词
     */
    private extractSentence(context: string, keyword: string): string {
        const keywordIdx = context.indexOf(keyword);
        if (keywordIdx === -1) return '';

        let start = keywordIdx;
        while (start > 0 && !/[。！？!?，,；;\n]/.test(context[start - 1])) {
            start--;
        }

        let end = keywordIdx + keyword.length;
        while (end < context.length && !/[。！？!?\n]/.test(context[end])) {
            end++;
        }
        if (end < context.length && /[。！？!?]/.test(context[end])) end++;

        return context.substring(start, end).trim();
    }

    /**
     * 按置信度截断候选列表，限制最大数量
     * @param candidates 候选列表
     * @param maxCandidates 最大候选数
     */
    private truncateCandidates(candidates: CharacterCandidate[], maxCandidates: number): CharacterCandidate[] {
        if (candidates.length <= maxCandidates) return candidates;
        return candidates
            .sort((a, b) => b.confidence - a.confidence)
            .slice(0, maxCandidates);
    }
}
