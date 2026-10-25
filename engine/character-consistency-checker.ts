import { VectorEnhancer } from './vector-enhancer';
import { createLogger } from '../shared/logger';


const log = createLogger('CharacterConsistencyChecker');
export interface InconsistencyItem {
    type: 'personality' | 'behavior' | 'ability' | 'appearance';
    severity: 'low' | 'medium' | 'high';
    description: string;
    location?: string;
    suggestion?: string;
    confidence: number;
}

export interface ConsistencyCheckResult {
    overallScore: number;
    characterResults: Record<string, {
        score: number;
        inconsistencies: InconsistencyItem[];
    }>;
    summary: string;
    details: string;
}

interface CharacterInfo {
    name: string;
    personality?: string;
    appearance?: string;
    abilities?: string;
    background?: string;
}

const PERSONALITY_TRAITS: Record<string, string[]> = {
    '冷漠': ['冷漠', '冷淡', '冷酷', '淡漠', '疏离', '不苟言笑'],
    '热情': ['热情', '热心', '开朗', '活泼', '亲热', '热情洋溢'],
    '温柔': ['温柔', '柔和', '温和', '柔声', '温柔体贴'],
    '暴躁': ['暴躁', '易怒', '火爆', '怒吼', '咆哮', '勃然大怒'],
    '沉稳': ['沉稳', '冷静', '镇定', '从容', '沉着', '不动声色'],
    '冲动': ['冲动', '鲁莽', '莽撞', '意气用事', '不计后果'],
    '勇敢': ['勇敢', '英勇', '无畏', '挺身而出', '奋勇'],
    '懦弱': ['懦弱', '胆小', '怯懦', '畏缩', '害怕'],
    '聪明': ['聪明', '机智', '聪慧', '睿智', '足智多谋'],
    '愚蠢': ['愚蠢', '愚笨', '迟钝', '呆笨', '傻气'],
    '狡猾': ['狡猾', '狡诈', '奸诈', '诡计多端', '城府深'],
    '老实': ['老实', '忠厚', '诚实', '坦诚', '直率'],
    '正直': ['正直', '刚正', '公正', '光明磊落'],
    '虚伪': ['虚伪', '虚假', '伪善', '表里不一', '口是心非'],
    '豪爽': ['豪爽', '豪迈', '爽快', '不拘小节'],
    '细腻': ['细腻', '细致', '体贴', '细心', '周到'],
    '霸道': ['霸道', '蛮横', '专横', '强势', '盛气凌人'],
    '善良': ['善良', '仁慈', '慈悲', '心软', '乐于助人'],
    '邪恶': ['邪恶', '狠毒', '残忍', '心狠手辣', '冷酷无情'],
    '内向': ['内向', '沉默', '寡言', '腼腆', '害羞'],
    '开朗': ['开朗', '外向', '活泼', '健谈', '乐观']
};

const BEHAVIOR_PATTERNS: Array<{ trait: string; incompatibleActions: string[] }> = [
    { trait: '冷漠', incompatibleActions: ['激动地说', '热情地', '兴奋地', '感动得', '泪流满面', '激动不已'] },
    { trait: '沉稳', incompatibleActions: ['慌了神', '惊慌失措', '手忙脚乱', '大惊失色', '慌乱'] },
    { trait: '温柔', incompatibleActions: ['怒吼道', '厉声喝道', '勃然大怒', '摔门而去', '暴跳如雷'] },
    { trait: '老实', incompatibleActions: ['狡黠地笑', '眼珠一转', '暗中盘算', '撒谎', '欺骗'] },
    { trait: '正直', incompatibleActions: ['阴险地', '暗算', '偷袭', '不择手段', '耍阴谋'] },
    { trait: '霸道', incompatibleActions: ['唯唯诺诺', '低声下气', '卑躬屈膝', '俯首帖耳'] },
    { trait: '勇敢', incompatibleActions: ['吓得发抖', '缩成一团', '落荒而逃', '胆战心惊'] },
    { trait: '懦弱', incompatibleActions: ['挺身而出', '毫不畏惧', '英勇抗争', '视死如归'] }
];

const APPEARANCE_CONTRADICTIONS: Array<{ words: string[]; opposite: string[] }> = [
    { words: ['黑发', '乌黑', '墨发'], opposite: ['金发', '白发', '银发', '红发', '棕发'] },
    { words: ['金发', '金色头发'], opposite: ['黑发', '白发', '银发', '红发', '棕发'] },
    { words: ['白发', '银发', '花白'], opposite: ['黑发', '金发', '红发', '棕发'] },
    { words: ['高大', '魁梧', '身高八尺', '人高马大'], opposite: ['瘦小', '矮小', '侏儒', '身高不足五尺'] },
    { words: ['瘦小', '矮小', '瘦弱'], opposite: ['高大', '魁梧', '壮硕', '膀大腰圆'] },
    { words: ['英俊', '帅气', '俊朗', '美男子'], opposite: ['丑陋', '难看', '其貌不扬'] },
    { words: ['美丽', '漂亮', '绝色', '倾城'], opposite: ['丑陋', '难看', '其貌不扬'] },
    { words: ['肥胖', '臃肿', '大腹便便'], opposite: ['清瘦', '苗条', '骨瘦如柴'] },
    { words: ['清瘦', '苗条', '纤细'], opposite: ['肥胖', '臃肿', '壮硕'] },
    { words: ['年轻', '少年', '青年', '二十岁'], opposite: ['年老', '年迈', '白发苍苍', '古稀之年'] },
    { words: ['年老', '年迈', '老者', '老人'], opposite: ['年轻', '少年', '青年'] }
];

const ABILITY_KEYWORDS = [
    '功法', '武技', '武功', '法术', '神通', '绝技', '绝招', '秘法',
    '修炼', '修为', '境界', '实力', '功力', '内力', '真气', '灵力',
    '擅长', '精通', '掌握', '炼成', '练成', '习得', '学会'
];

export class CharacterConsistencyChecker {
    private vectorEnhancer?: VectorEnhancer;
    private threshold: number;
    private readonly vectorThreshold = 0.6;
    private readonly personalityKeywordSet: Set<string>;
    private readonly abilityKeywordSet: Set<string>;

    constructor(vectorEnhancer?: VectorEnhancer, threshold?: number) {
        this.vectorEnhancer = vectorEnhancer;
        this.threshold = threshold || 0.6;
        this.personalityKeywordSet = new Set(
            Object.values(PERSONALITY_TRAITS).flat()
        );
        this.abilityKeywordSet = new Set(ABILITY_KEYWORDS);
    }

    async check(
        chapterText: string,
        characterInfos: CharacterInfo[]
    ): Promise<ConsistencyCheckResult> {
        const result: ConsistencyCheckResult = {
            overallScore: 100,
            characterResults: {},
            summary: '',
            details: ''
        };

        if (!chapterText || chapterText.length === 0 || characterInfos.length === 0) {
            result.summary = '无有效文本或人物信息，跳过一致性检测';
            result.details = '';
            return result;
        }

        for (const char of characterInfos) {
            const charInconsistencies: InconsistencyItem[] = [];

            try {
                const personalityIssues = await this.checkPersonality(chapterText, char);
                charInconsistencies.push(...personalityIssues);
            } catch (e) {
                log.warn(`[CharacterConsistencyChecker] ${char.name} 性格检测失败`, e);
            }

            try {
                const behaviorIssues = await this.checkBehavior(chapterText, char);
                charInconsistencies.push(...behaviorIssues);
            } catch (e) {
                log.warn(`[CharacterConsistencyChecker] ${char.name} 行为检测失败`, e);
            }

            try {
                const abilityIssues = await this.checkAbility(chapterText, char);
                charInconsistencies.push(...abilityIssues);
            } catch (e) {
                log.warn(`[CharacterConsistencyChecker] ${char.name} 能力检测失败`, e);
            }

            try {
                const appearanceIssues = await this.checkAppearance(chapterText, char);
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

        result.overallScore = this.calculateOverallScore(result);
        result.summary = this.generateSummary(result);
        result.details = this.generateDetails(result);

        return result;
    }

    private async checkPersonality(text: string, character: CharacterInfo): Promise<InconsistencyItem[]> {
        const issues: InconsistencyItem[] = [];
        if (!character.personality || character.personality.length === 0) {
            return issues;
        }

        const charName = character.name;
        const personalityDesc = character.personality;

        const charParagraphs = this.extractCharacterParagraphs(text, charName);
        if (charParagraphs.length === 0) {
            return issues;
        }

        const useVector = this.vectorEnhancer ? await this.vectorEnhancer.isAvailable() : false;

        if (useVector && this.vectorEnhancer) {
            try {
                const personalityVector = await this.vectorEnhancer.embedText(personalityDesc);
                
                for (let i = 0; i < charParagraphs.length; i++) {
                    const para = charParagraphs[i];
                    const paraVector = await this.vectorEnhancer.embedText(para);
                    const similarity = this.vectorEnhancer.cosineSimilarity(personalityVector, paraVector);
                    
                    if (similarity < this.vectorThreshold) {
                        const severity = similarity < 0.3 ? 'high' : similarity < 0.45 ? 'medium' : 'low';
                        const confidence = 1 - similarity;
                        
                        issues.push({
                            type: 'personality',
                            severity,
                            description: `第${i + 1}段人物描写与设定性格相似度较低（${(similarity * 100).toFixed(1)}%）`,
                            location: `第${i + 1}段附近`,
                            suggestion: '请确认该段落中人物的言行是否符合其性格设定',
                            confidence: Math.min(confidence, 0.9)
                        });
                    }
                }
            } catch (e) {
                log.warn('[CharacterConsistencyChecker] 向量性格检测失败，降级为关键词匹配', e);
                return this.checkPersonalityKeyword(text, character, charParagraphs);
            }
        } else {
            return this.checkPersonalityKeyword(text, character, charParagraphs);
        }

        return issues;
    }

    private checkPersonalityKeyword(
        text: string,
        character: CharacterInfo,
        paragraphs: string[]
    ): InconsistencyItem[] {
        const issues: InconsistencyItem[] = [];
        const personalityDesc = character.personality || '';
        const charName = character.name;

        const detectedTraits = this.resolveConfiguredTraits(personalityDesc);

        if (detectedTraits.length === 0) {
            return issues;
        }

        for (let i = 0; i < paragraphs.length; i++) {
            const para = paragraphs[i];
            const paraTraits: string[] = [];
            
            for (const [trait, keywords] of Object.entries(PERSONALITY_TRAITS)) {
                for (const kw of keywords) {
                    if (para.includes(kw) && para.includes(charName)) {
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
                    description: `第${i + 1}段检测到与设定不符的性格特征：${mismatchingTraits.join('、')}`,
                    location: `第${i + 1}段附近`,
                    suggestion: `设定性格为：${detectedTraits.join('、')}，请确认该段描写是否合理`,
                    confidence: 0.6
                });
            }
        }

        return issues;
    }

    private async checkBehavior(text: string, character: CharacterInfo): Promise<InconsistencyItem[]> {
        const issues: InconsistencyItem[] = [];
        if (!character.personality || character.personality.length === 0) {
            return issues;
        }

        const charName = character.name;
        const personalityDesc = character.personality;

        const configuredTraits = new Set(this.resolveConfiguredTraits(personalityDesc));
        const relevantPatterns = BEHAVIOR_PATTERNS.filter(p => configuredTraits.has(p.trait));

        if (relevantPatterns.length === 0) {
            return issues;
        }

        const charParagraphs = this.extractCharacterParagraphs(text, charName);
        if (charParagraphs.length === 0) {
            return issues;
        }

        for (let i = 0; i < charParagraphs.length; i++) {
            const para = charParagraphs[i];
            
            for (const pattern of relevantPatterns) {
                for (const action of pattern.incompatibleActions) {
                    if (para.includes(action) && para.includes(charName)) {
                        const sentence = this.extractSentence(para, action);
                        issues.push({
                            type: 'behavior',
                            severity: 'medium',
                            description: `"${pattern.trait}"的人出现了不符的行为：${action}`,
                            location: `第${i + 1}段附近`,
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

    private async checkAbility(text: string, character: CharacterInfo): Promise<InconsistencyItem[]> {
        const issues: InconsistencyItem[] = [];
        if (!character.abilities || character.abilities.length === 0) {
            return issues;
        }

        const charName = character.name;
        const abilitiesDesc = character.abilities;

        const charParagraphs = this.extractCharacterParagraphs(text, charName);
        if (charParagraphs.length === 0) {
            return issues;
        }

        const useVector = this.vectorEnhancer ? await this.vectorEnhancer.isAvailable() : false;

        if (useVector && this.vectorEnhancer) {
            try {
                const abilitiesVector = await this.vectorEnhancer.embedText(abilitiesDesc);
                
                const abilityParagraphs = charParagraphs.filter(p => 
                    ABILITY_KEYWORDS.some(kw => p.includes(kw))
                );

                for (let i = 0; i < abilityParagraphs.length; i++) {
                    const para = abilityParagraphs[i];
                    const paraVector = await this.vectorEnhancer.embedText(para);
                    const similarity = this.vectorEnhancer.cosineSimilarity(abilitiesVector, paraVector);
                    
                    if (similarity < 0.4) {
                        const paraIdx = charParagraphs.indexOf(para);
                        issues.push({
                            type: 'ability',
                            severity: 'medium',
                            description: `检测到可能超出设定范围的能力描述（相似度 ${(similarity * 100).toFixed(1)}%）`,
                            location: `第${paraIdx + 1}段附近`,
                            suggestion: '请确认该能力是否在人物设定的能力范围内',
                            confidence: 0.5
                        });
                    }
                }
            } catch (e) {
                log.warn('[CharacterConsistencyChecker] 向量能力检测失败，降级为关键词匹配', e);
            }
        }

        return issues;
    }

    private async checkAppearance(text: string, character: CharacterInfo): Promise<InconsistencyItem[]> {
        const issues: InconsistencyItem[] = [];
        if (!character.appearance || character.appearance.length === 0) {
            return issues;
        }

        const charName = character.name;
        const appearanceDesc = character.appearance;

        const charParagraphs = this.extractCharacterParagraphs(text, charName);
        if (charParagraphs.length === 0) {
            return issues;
        }

        // 同一「人物 + 矛盾词」只报一次：矛盾组之间存在反义词重叠
        // （设定同时写「黑发」「金发」时，两组都把「白发」列为反义），
        // 集合必须跨组共用，否则同一问题会被重复计数。
        const reported = new Set<string>();

        for (let i = 0; i < charParagraphs.length; i++) {
            const para = charParagraphs[i];
            
            for (const contradiction of APPEARANCE_CONTRADICTIONS) {
                const hasAppearanceWord = contradiction.words.some(w => 
                    appearanceDesc.includes(w)
                );
                
                if (hasAppearanceWord) {
                    for (const opp of contradiction.opposite) {
                        if (reported.has(opp)) continue;
                        if (para.includes(opp) && para.includes(charName)) {
                            reported.add(opp);
                            const sentence = this.extractSentence(para, opp);
                            issues.push({
                                type: 'appearance',
                                severity: 'high',
                                description: `外貌描述矛盾：设定为"${contradiction.words[0]}"，文中出现"${opp}"`,
                                location: `第${i + 1}段附近`,
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

    private extractCharacterParagraphs(text: string, name: string): string[] {
        // 中文网文常用单换行分段，只按空行切会把整章当成一段，
        // 导致「另一个角色金发」被算到主角头上。口径与 DeviationDetector 一致。
        const paragraphs = text
            .split(/\r?\n+/)
            .map(p => p.trim())
            .filter(p => p.length > 0 && p.includes(name));
        return paragraphs;
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
    private resolveConfiguredTraits(personalityDesc: string): string[] {
        const traits: string[] = [];
        for (const [trait, keywords] of Object.entries(PERSONALITY_TRAITS)) {
            if (personalityDesc.includes(trait) || keywords.some(kw => personalityDesc.includes(kw))) {
                traits.push(trait);
            }
        }
        return traits;
    }

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
