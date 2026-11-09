import { VectorEnhancer } from './vector-enhancer';
import { createLogger } from '@/shared/logger';
import {
    ABILITY_KEYWORDS,
    APPEARANCE_CONTRADICTIONS,
    BEHAVIOR_PATTERNS,
    PERSONALITY_TRAITS,
    abilityTerms,
    resolveConfiguredTraits,
    sentencesForCharacter,
} from '@/shared/character-rules';


const log = createLogger('CharacterConsistencyChecker');
/**
 * InconsistencyItem 类型定义。
 */
export interface InconsistencyItem {
    type: 'personality' | 'behavior' | 'ability' | 'appearance';
    severity: 'low' | 'medium' | 'high';
    description: string;
    location?: string;
    suggestion?: string;
    confidence: number;
}

/**
 * ConsistencyCheckResult 类型定义。
 */
export interface ConsistencyCheckResult {
    overallScore: number;
    characterResults: Record<string, {
        score: number;
        inconsistencies: InconsistencyItem[];
    }>;
    summary: string;
    details: string;
    /** 全部角色中最严重的等级（用于门禁/告警；不是平均分） */
    worstSeverity: 'none' | 'low' | 'medium' | 'high';
    /** 高严重度问题数量（任一 >0 即 passed=false） */
    highSeverityCount: number;
    /** 是否存在高严重度矛盾 */
    passed: boolean;
}

interface CharacterInfo {
    name: string;
    personality?: string;
    appearance?: string;
    abilities?: string;
    background?: string;
}

/**
 * 角色一致性检查器。
 */
export class CharacterConsistencyChecker {
    private vectorEnhancer?: VectorEnhancer;
    private readonly threshold: number;

    constructor(vectorEnhancer?: VectorEnhancer, threshold?: number) {
        this.vectorEnhancer = vectorEnhancer;
        this.threshold = threshold ?? 0.6;
    }

    /**
     * 检查。
     * @param chapterText - 参数值
     * @param characterInfos - 参数值
      * @returns ConsistencyCheckResult 实例
     */
    async check(
        chapterText: string,
        characterInfos: CharacterInfo[]
    ): Promise<ConsistencyCheckResult> {
        const result: ConsistencyCheckResult = {
            overallScore: 100,
            characterResults: {},
            summary: '',
            details: '',
            worstSeverity: 'none',
            highSeverityCount: 0,
            passed: true,
        };

        if (!chapterText || chapterText.length === 0 || characterInfos.length === 0) {
            result.summary = '无有效文本或人物信息，跳过一致性检测';
            result.details = '';
            return result;
        }

        const allNames = characterInfos.map((info) => info.name);
        for (const char of characterInfos) {
            const charInconsistencies: InconsistencyItem[] = [];

            try {
                const personalityIssues = await this.checkPersonality(chapterText, char, allNames);
                charInconsistencies.push(...personalityIssues);
            } catch (e) {
                log.warn(`[CharacterConsistencyChecker] ${char.name} 性格检测失败`, e);
            }

            try {
                const behaviorIssues = await this.checkBehavior(chapterText, char, allNames);
                charInconsistencies.push(...behaviorIssues);
            } catch (e) {
                log.warn(`[CharacterConsistencyChecker] ${char.name} 行为检测失败`, e);
            }

            try {
                const abilityIssues = await this.checkAbility(chapterText, char, allNames);
                charInconsistencies.push(...abilityIssues);
            } catch (e) {
                log.warn(`[CharacterConsistencyChecker] ${char.name} 能力检测失败`, e);
            }

            try {
                const appearanceIssues = await this.checkAppearance(chapterText, char, allNames);
                charInconsistencies.push(...appearanceIssues);
            } catch (e) {
                log.warn(`[CharacterConsistencyChecker] ${char.name} 外貌检测失败`, e);
            }

            const charScore = this.calculateCharacterScore(charInconsistencies);
            result.characterResults[char.name] = {
                score: charScore,
                inconsistencies: charInconsistencies
            };
        }

        // 评分取平均，但门禁看最严重等级：一个角色严重 OOC 不能被其他正常角色稀释
        const allIssues = Object.values(result.characterResults).flatMap((entry) => entry.inconsistencies);
        result.highSeverityCount = allIssues.filter((item) => item.severity === 'high').length;
        result.worstSeverity = allIssues.some((item) => item.severity === 'high')
            ? 'high'
            : allIssues.some((item) => item.severity === 'medium')
                ? 'medium'
                : allIssues.some((item) => item.severity === 'low') ? 'low' : 'none';
        result.passed = result.highSeverityCount === 0;

        result.overallScore = this.calculateOverallScore(result);
        result.summary = this.generateSummary(result);
        result.details = this.generateDetails(result);

        return result;
    }

    private async checkPersonality(text: string, character: CharacterInfo, allNames: string[]): Promise<InconsistencyItem[]> {
        const issues: InconsistencyItem[] = [];
        if (!character.personality || character.personality.length === 0) {
            return issues;
        }

        const charName = character.name;
        const personalityDesc = character.personality;

        const charSentences = sentencesForCharacter(text, charName, allNames);
        if (charSentences.length === 0) {
            return issues;
        }

        const useVector = this.vectorEnhancer ? await this.vectorEnhancer.isAvailable() : false;

        if (useVector && this.vectorEnhancer) {
            try {
                const personalityVector = await this.vectorEnhancer.embedText(personalityDesc);
                
                for (let i = 0; i < charSentences.length; i++) {
                    const sentence = charSentences[i];
                    const paraVector = await this.vectorEnhancer.embedText(sentence);
                    const similarity = this.vectorEnhancer.cosineSimilarity(personalityVector, paraVector);
                    
                    if (similarity < this.threshold) {
                        const severity = similarity < 0.3 ? 'high' : similarity < 0.45 ? 'medium' : 'low';
                        const confidence = 1 - similarity;
                        
                        issues.push({
                            type: 'personality',
                            severity,
                            description: `第${i + 1}句人物描写与设定性格相似度较低（${(similarity * 100).toFixed(1)}%）`,
                            location: `第${i + 1}句附近`,
                            suggestion: '请确认该句中人物的言行是否符合其性格设定',
                            confidence: Math.min(confidence, 0.9)
                        });
                    }
                }
            } catch (e) {
                log.warn('[CharacterConsistencyChecker] 向量性格检测失败，降级为关键词匹配', e);
                return this.checkPersonalityKeyword(text, character, charSentences);
            }
        } else {
            return this.checkPersonalityKeyword(text, character, charSentences);
        }

        return issues;
    }

    private checkPersonalityKeyword(
        text: string,
        character: CharacterInfo,
        sentences: string[]
    ): InconsistencyItem[] {
        const issues: InconsistencyItem[] = [];
        const personalityDesc = character.personality || '';

        const detectedTraits = resolveConfiguredTraits(personalityDesc);

        if (detectedTraits.length === 0) {
            return issues;
        }

        for (let i = 0; i < sentences.length; i++) {
            const sentence = sentences[i];
            const paraTraits: string[] = [];
            
            for (const [trait, keywords] of Object.entries(PERSONALITY_TRAITS)) {
                for (const kw of keywords) {
                    if (sentence.includes(kw)) {
                        paraTraits.push(trait);
                        break;
                    }
                }
            }

            const matchingTraits = paraTraits.filter(t => detectedTraits.includes(t));
            const mismatchingTraits = paraTraits.filter(t => !detectedTraits.includes(t));

            if (mismatchingTraits.length > 0 && matchingTraits.length === 0) {
                const severity = mismatchingTraits.length >= 2 ? 'medium' : 'low';
                issues.push({
                    type: 'personality',
                    severity,
                    description: `第${i + 1}句检测到与设定不符的性格特征：${mismatchingTraits.join('、')}`,
                    location: `第${i + 1}句附近`,
                    suggestion: `设定性格为：${detectedTraits.join('、')}，请确认该句描写是否合理`,
                    confidence: 0.6
                });
            }
        }

        return issues;
    }

    private async checkBehavior(text: string, character: CharacterInfo, allNames: string[]): Promise<InconsistencyItem[]> {
        const issues: InconsistencyItem[] = [];
        if (!character.personality || character.personality.length === 0) {
            return issues;
        }

        const charName = character.name;
        const personalityDesc = character.personality;

        const configuredTraits = new Set(resolveConfiguredTraits(personalityDesc));
        const relevantPatterns = BEHAVIOR_PATTERNS.filter(p => configuredTraits.has(p.trait));

        if (relevantPatterns.length === 0) {
            return issues;
        }

        const charSentences = sentencesForCharacter(text, charName, allNames);
        if (charSentences.length === 0) {
            return issues;
        }

        for (let i = 0; i < charSentences.length; i++) {
            const sentenceText = charSentences[i];
            
            for (const pattern of relevantPatterns) {
                for (const action of pattern.incompatibleActions) {
                    if (sentenceText.includes(action)) {
                        const sentence = this.extractSentence(sentenceText, action);
                        issues.push({
                            type: 'behavior',
                            severity: 'medium',
                            description: `"${pattern.trait}"的人出现了不符的行为：${action}`,
                            location: `第${i + 1}句附近`,
                            suggestion: sentence ? `原文："${sentence}"，请确认该行为是否符合人物性格` : '请确认该行为是否符合人物性格设定',
                            confidence: 0.7
                        });
                        break;
                    }
                }
            }
        }

        return issues;
    }

    private async checkAbility(text: string, character: CharacterInfo, allNames: string[]): Promise<InconsistencyItem[]> {
        const issues: InconsistencyItem[] = [];
        if (!character.abilities || character.abilities.length === 0) {
            return issues;
        }

        const charName = character.name;
        const abilitiesDesc = character.abilities;

        const charSentences = sentencesForCharacter(text, charName, allNames);
        if (charSentences.length === 0) {
            return issues;
        }

        const useVector = this.vectorEnhancer ? await this.vectorEnhancer.isAvailable() : false;

        if (useVector && this.vectorEnhancer) {
            try {
                const abilitiesVector = await this.vectorEnhancer.embedText(abilitiesDesc);
                
                const abilitySentences = charSentences.filter(p => 
                    ABILITY_KEYWORDS.some(kw => p.includes(kw))
                );

                for (let i = 0; i < abilitySentences.length; i++) {
                    const sentence = abilitySentences[i];
                    const paraVector = await this.vectorEnhancer.embedText(sentence);
                    const similarity = this.vectorEnhancer.cosineSimilarity(abilitiesVector, paraVector);
                    
                    if (similarity < Math.max(0.35, this.threshold - 0.2)) {
                        const paraIdx = charSentences.indexOf(sentence);
                        issues.push({
                            type: 'ability',
                            severity: 'medium',
                            description: `检测到可能超出设定范围的能力描述（相似度 ${(similarity * 100).toFixed(1)}%）`,
                            location: `第${paraIdx + 1}句附近`,
                            suggestion: '请确认该能力是否在人物设定的能力范围内',
                            confidence: 0.5
                        });
                    }
                }
                return issues;
            } catch (e) {
                log.warn('[CharacterConsistencyChecker] 向量能力检测失败，降级为关键词匹配', e);
            }
        }

        // 关键词回退：句子含能力关键词但没有任何已设定能力词 → 低置信度提示
        const terms = abilityTerms(abilitiesDesc);
        if (terms.length === 0) return issues;
        for (let i = 0; i < charSentences.length; i++) {
            const sentence = charSentences[i];
            if (!ABILITY_KEYWORDS.some((kw) => sentence.includes(kw))) continue;
            if (terms.some((term) => sentence.includes(term))) continue;
            issues.push({
                type: 'ability',
                severity: 'low',
                description: `能力描写可能超出设定（未命中已设定能力词）`,
                location: `第${i + 1}句附近`,
                suggestion: `人物设定能力：${terms.slice(0, 6).join('、')}；请确认该句是否引入了新能力`,
                confidence: 0.4
            });
        }

        return issues;
    }

    private async checkAppearance(text: string, character: CharacterInfo, allNames: string[]): Promise<InconsistencyItem[]> {
        const issues: InconsistencyItem[] = [];
        if (!character.appearance || character.appearance.length === 0) {
            return issues;
        }

        const charName = character.name;
        const appearanceDesc = character.appearance;

        const charSentences = sentencesForCharacter(text, charName, allNames);
        if (charSentences.length === 0) {
            return issues;
        }

        // 同一「人物 + 矛盾词」只报一次：矛盾组之间存在反义词重叠
        // （设定同时写「黑发」「金发」时，两组都把「白发」列为反义），
        // 集合必须跨组共用，否则同一问题会被重复计数。
        const reported = new Set<string>();

        for (let i = 0; i < charSentences.length; i++) {
            const sentenceText = charSentences[i];
            
            for (const contradiction of APPEARANCE_CONTRADICTIONS) {
                const hasAppearanceWord = contradiction.words.some(w => 
                    appearanceDesc.includes(w)
                );
                
                if (hasAppearanceWord) {
                    for (const opp of contradiction.opposite) {
                        if (reported.has(opp)) continue;
                        if (sentenceText.includes(opp)) {
                            reported.add(opp);
                            const sentence = this.extractSentence(sentenceText, opp);
                            issues.push({
                                type: 'appearance',
                                severity: 'high',
                                description: `外貌描述矛盾：设定为"${contradiction.words[0]}"，文中出现"${opp}"`,
                                location: `第${i + 1}句附近`,
                                suggestion: sentence ? `原文："${sentence}"，请修正外貌描述以保持一致` : '请修正外貌描述',
                                confidence: 0.9
                            });
                            break;
                        }
                    }
                }
            }
        }

        return issues;
    }

    private extractSentence(context: string, keyword: string): string {
        const keywordIdx = context.indexOf(keyword);
        if (keywordIdx === -1) return '';

        let start = keywordIdx;
        while (start > 0 && !/[。！？!?，,；;]/.test(context[start - 1])) {
            start--;
        }

        let end = keywordIdx + keyword.length;
        while (end < context.length && !/[。！？!?]/.test(context[end])) {
            end++;
        }
        if (end < context.length) end++;

        return context.substring(start, end).trim();
    }

    /**
     * 把人物设定文案解析为性格标签集合。
     * 设定常写「冷静」「沉默」「机智」这类关键词，而 PERSONALITY_TRAITS 的键是
     * 「沉稳」「内向」「聪明」——只匹配键会让这些常见写法完全跳过性格/行为检测。
     */
    private calculateCharacterScore(inconsistencies: InconsistencyItem[]): number {
        if (inconsistencies.length === 0) return 100;

        let penalty = 0;
        for (const item of inconsistencies) {
            const basePenalty = item.severity === 'high' ? 15 : item.severity === 'medium' ? 8 : 3;
            penalty += basePenalty * item.confidence;
        }

        return Math.max(0, Math.min(100, 100 - penalty));
    }

    private calculateOverallScore(result: ConsistencyCheckResult): number {
        const charNames = Object.keys(result.characterResults);
        if (charNames.length === 0) return 100;

        let totalScore = 0;
        for (const name of charNames) {
            totalScore += result.characterResults[name].score;
        }

        return Math.round(totalScore / charNames.length);
    }

    private generateSummary(result: ConsistencyCheckResult): string {
        const charNames = Object.keys(result.characterResults);
        if (charNames.length === 0) {
            return '无有效人物信息';
        }

        const totalIssues = charNames.reduce((sum, name) => 
            sum + result.characterResults[name].inconsistencies.length, 0
        );

        const highIssues = charNames.reduce((sum, name) => 
            sum + result.characterResults[name].inconsistencies.filter(i => i.severity === 'high').length, 0
        );

        if (totalIssues === 0) {
            return `检测了 ${charNames.length} 个人物，未发现明显的人设不一致问题，总体一致性得分 ${result.overallScore} 分。`;
        }

        return `检测了 ${charNames.length} 个人物，发现 ${totalIssues} 处可能的人设不一致（其中严重 ${highIssues} 处），总体一致性得分 ${result.overallScore} 分。`;
    }

    private generateDetails(result: ConsistencyCheckResult): string {
        const charNames = Object.keys(result.characterResults);
        if (charNames.length === 0) return '';

        const lines: string[] = [];

        for (const name of charNames) {
            const charResult = result.characterResults[name];
            lines.push(`### ${name}（得分：${charResult.score}）`);
            
            if (charResult.inconsistencies.length === 0) {
                lines.push('- 未发现明显不一致');
            } else {
                const typeLabels: Record<string, string> = {
                    personality: '性格语气',
                    behavior: '行为逻辑',
                    ability: '能力边界',
                    appearance: '外貌描述'
                };

                const severityLabels: Record<string, string> = {
                    high: '🔴 严重',
                    medium: '🟡 中等',
                    low: '🟢 轻微'
                };

                for (const item of charResult.inconsistencies) {
                    const severityLabel = severityLabels[item.severity] || item.severity;
                    const typeLabel = typeLabels[item.type] || item.type;
                    lines.push(`- ${severityLabel} [${typeLabel}] ${item.description}`);
                    if (item.location) {
                        lines.push(`  位置：${item.location}`);
                    }
                    if (item.suggestion) {
                        lines.push(`  建议：${item.suggestion}`);
                    }
                    lines.push(`  置信度：${(item.confidence * 100).toFixed(0)}%`);
                }
            }
            lines.push('');
        }

        return lines.join('\n');
    }
}
