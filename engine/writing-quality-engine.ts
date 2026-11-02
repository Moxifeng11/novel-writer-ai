/**
 * writing-quality-engine.ts — 实时写作质量评分引擎
 *
 * 功能：基于规则 + 轻量 NLP 实现多维度写作质量实时评估
 * 6 个维度：语言质量、节奏质量、人物质量、情节质量、氛围质量、结构质量
 * 不依赖 AI 调用，保证实时性（< 100ms / 万字）
 */

import { splitParagraphs, splitSentences } from '../shared/text-utils';
import {
  gradeFromScore,
  qualityGradeColor,
  qualityGradeLabel,
  type QualityGrade,
} from '../shared/quality-grade';
import {
  QUALITY_MIN_EVALUABLE_CHARS,
  WQE_CALIBRATION,
  WQE_DIMENSION_WEIGHTS,
  WQE_SUB_WEIGHTS,
} from '../shared/thresholds';

export type { QualityGrade };
/**
 * 建议优先级。
 */
export type SuggestionPriority = 'high' | 'medium' | 'low';
/**
 * 质量趋势。
 */
export type QualityTrend = 'rising' | 'falling' | 'stable';

/**
 * 质量建议。
 */
export interface QualitySuggestion {
  id: string;
  dimension: string;
  content: string;
  priority: SuggestionPriority;
  estimatedEffort: string;
  category: 'language' | 'rhythm' | 'character' | 'plot' | 'atmosphere' | 'structure';
}

/**
 * 质量维度。
 */
export interface QualityDimension {
  score: number;
  details: Record<string, number | string>;
  suggestions: QualitySuggestion[];
}

/**
 * 质量评估结果。
 */
export interface WritingQualityResult {
  languageQuality: QualityDimension;
  rhythmQuality: QualityDimension;
  characterQuality: QualityDimension;
  plotQuality: QualityDimension;
  atmosphereQuality: QualityDimension;
  structureQuality: QualityDimension;
  overallScore: number;
  grade: QualityGrade;
  trend: QualityTrend;
  comparedToAverage: number;
  topSuggestions: QualitySuggestion[];
  evaluatedAt: number;
  wordCount: number;
  evalTimeMs: number;
  milestoneReached?: string;
}

/**
 * 引擎选项。
 */
export interface WritingQualityEngineOptions {
  characterNames?: string[];
  mainlineKeywords?: string[];
  chapterOutline?: string;
  previousChapterScore?: number;
  averageScore?: number;
  ignoredSuggestions?: string[];
  styleFingerprint?: Record<string, number>;
}

const RHYTHM_VERBS = [
  '冲', '打', '砍', '刺', '杀', '击', '扑', '跃', '闪', '躲',
  '跑', '追', '逃', '赶', '撞', '砸', '摔', '飞', '落', '起',
];

const DIALOGUE_MARKERS = [
  '说', '道', '问', '答', '喊', '叫', '吼', '哭', '笑', '叹',
  '低语', '轻声', '沉声', '冷声道', '淡淡道', '缓缓道',
];

const DESCRIPTION_WORDS = [
  '的', '了', '着', '是', '在', '有', '很', '都', '就', '又',
  '仿佛', '似乎', '好像', '犹如', '宛如', '如同', '一般', '一样',
];

const COMMON_TYPO_PATTERNS = [
  { pattern: /的得地/g, correct: '的/得/地混用' },
  { pattern: /在再/g, correct: '在/再混用' },
  { pattern: /那哪/g, correct: '那/哪混用' },
  { pattern: /已以/g, correct: '已/以混用' },
];

const RHETORIC_PATTERNS = [
  /像|如|似|仿佛|犹如|宛如|如同|好似|宛若|恰似/,
  /是…也是…|不仅…而且…|虽然…但是…|因为…所以…/,
  /反问|难道|怎么会|怎能|岂会/,
  /排比句|有的…有的…还有的…|一边…一边…/,
  /夸张|简直|要命|要死|不得了|够呛/,
];

const SUSPENSE_PATTERNS = [
  /突然|忽然|就在这时|猛然间|倏地/,
  /神秘|诡异|蹊跷|古怪|不对劲|不同寻常/,
  /秘密|阴谋|真相|谜底|隐藏|潜伏/,
  /悬念|疑惑|不解|困惑|纳闷|奇怪/,
];

const COOL_MOMENT_PATTERNS = [
  /冷笑|冷哼|不屑|鄙夷|傲慢|高高在上/,
  /出手|一招|一击|瞬间|刹那|电光火石/,
  /震惊|骇然|难以置信|目瞪口呆|不敢相信/,
  /逆袭|反转|翻盘|绝地反击|峰回路转/,
];

const EMOTION_WORDS_POSITIVE = [
  '喜悦', '开心', '高兴', '快乐', '幸福', '满足', '欣慰', '激动',
  '兴奋', '期待', '希望', '热情', '感激', '感动', '骄傲', '自豪',
  '轻松', '平静', '安宁', '温馨', '浪漫', '甜蜜',
];

const EMOTION_WORDS_NEGATIVE = [
  '悲伤', '痛苦', '绝望', '恐惧', '害怕', '愤怒', '生气', '憎恨',
  '厌恶', '嫉妒', '羞愧', '内疚', '后悔', '焦虑', '紧张', '担忧',
  '失落', '孤独', '寂寞', '沮丧', '气馁',
];

const ENVIRONMENT_WORDS = [
  '阳光', '月光', '星光', '灯光', '火光', '黑暗', '昏暗', '明亮',
  '风', '雨', '雪', '雷', '电', '云', '雾', '烟',
  '温暖', '寒冷', '炎热', '凉爽', '潮湿', '干燥', '静谧', '喧嚣',
  '花香', '血腥味', '硝烟味', '清新', '浑浊',
];

const OPENING_HOOK_PATTERNS = [
  /死亡|危机|危险|紧急|迫在眉睫|千钧一发/,
  /悬念|谜团|秘密|真相|未解之谜/,
  /穿越|重生|觉醒|系统|金手指/,
  /震惊|骇然|不敢相信|难以置信/,
];

const ENDING_HOOK_PATTERNS = [
  /但是|然而|可是|却|不料|没想到/,
  /突然|忽然|就在这时|就在此刻/,
  /悬念|伏笔|谜团|秘密|真相/,
  /接下来|下一步|然后|随后|之后/,
  /明天|明日|下次|改日|来日/,
];

/**
 * WritingQualityEngine 类。
 */
export class WritingQualityEngine {
  private characterNames: string[];
  private mainlineKeywords: string[];
  private chapterOutline: string;
  private previousChapterScore: number;
  private averageScore: number;
  private ignoredSuggestions: Set<string>;
  private styleFingerprint: Record<string, number>;

  private scoreHistory: number[] = [];
  private lastMilestone = 0;
  private readonly MILESTONE_INTERVALS = WQE_CALIBRATION.milestones;

  constructor(options: WritingQualityEngineOptions = {}) {
    this.characterNames = options.characterNames || [];
    this.mainlineKeywords = options.mainlineKeywords || [];
    this.chapterOutline = options.chapterOutline || '';
    this.previousChapterScore = options.previousChapterScore || 0;
    this.averageScore = options.averageScore || 0;
    this.ignoredSuggestions = new Set(options.ignoredSuggestions || []);
    this.styleFingerprint = options.styleFingerprint || {};
  }

  /**
   * 更新评估选项。
   *
   * @param options - 配置项
   */
  updateOptions(options: Partial<WritingQualityEngineOptions>): void {
    if (options.characterNames !== undefined) this.characterNames = options.characterNames;
    if (options.mainlineKeywords !== undefined) this.mainlineKeywords = options.mainlineKeywords;
    if (options.chapterOutline !== undefined) this.chapterOutline = options.chapterOutline;
    if (options.previousChapterScore !== undefined) this.previousChapterScore = options.previousChapterScore;
    if (options.averageScore !== undefined) this.averageScore = options.averageScore;
    if (options.ignoredSuggestions !== undefined) this.ignoredSuggestions = new Set(options.ignoredSuggestions);
    if (options.styleFingerprint !== undefined) this.styleFingerprint = options.styleFingerprint;
  }

  /**
   * 评估正文写作质量。
   *
   * @param text - 文本内容
   * @returns 质量结果
   */
  evaluate(text: string): WritingQualityResult {
    const startTime = Date.now();
    const cleanText = text.replace(/^---\n[\s\S]*?\n---\n?/, '').trim();
    const wordCount = cleanText.length;

    if (wordCount < QUALITY_MIN_EVALUABLE_CHARS) {
      return this.getEmptyResult(wordCount, startTime);
    }

    const paragraphs = this.splitParagraphs(cleanText);
    const sentences = splitSentences(cleanText);
    const totalParagraphs = paragraphs.length;
    const totalSentences = sentences.length;

    const languageQuality = this.evaluateLanguage(cleanText, sentences, totalSentences);
    const rhythmQuality = this.evaluateRhythm(cleanText, sentences, paragraphs, totalSentences, totalParagraphs);
    const characterQuality = this.evaluateCharacter(cleanText, sentences, totalSentences);
    const plotQuality = this.evaluatePlot(cleanText, paragraphs, totalParagraphs);
    const atmosphereQuality = this.evaluateAtmosphere(cleanText, paragraphs, totalParagraphs);
    const structureQuality = this.evaluateStructure(cleanText, paragraphs, totalParagraphs);

    const weights = WQE_DIMENSION_WEIGHTS;

    const overallScore = Math.round(
      languageQuality.score * weights.language +
      rhythmQuality.score * weights.rhythm +
      characterQuality.score * weights.character +
      plotQuality.score * weights.plot +
      atmosphereQuality.score * weights.atmosphere +
      structureQuality.score * weights.structure
    );

    const grade = this.getGrade(overallScore);
    const trend = this.calculateTrend(overallScore);

    this.scoreHistory.push(overallScore);
    if (this.scoreHistory.length > WQE_CALIBRATION.trend.historyMax) {
      this.scoreHistory = this.scoreHistory.slice(-WQE_CALIBRATION.trend.historyMax);
    }

    const comparedToAverage = this.averageScore > 0
      ? overallScore - this.averageScore
      : 0;

    const allSuggestions = [
      ...languageQuality.suggestions,
      ...rhythmQuality.suggestions,
      ...characterQuality.suggestions,
      ...plotQuality.suggestions,
      ...atmosphereQuality.suggestions,
      ...structureQuality.suggestions,
    ].filter(s => !this.ignoredSuggestions.has(s.id));

    const sortedSuggestions = allSuggestions.sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });

    const milestoneReached = this.checkMilestone(wordCount);

    const elapsed = Date.now() - startTime;

    return {
      languageQuality,
      rhythmQuality,
      characterQuality,
      plotQuality,
      atmosphereQuality,
      structureQuality,
      overallScore: Math.min(100, Math.max(0, overallScore)),
      grade,
      trend,
      comparedToAverage,
      topSuggestions: sortedSuggestions.slice(0, 5),
      evaluatedAt: Date.now(),
      wordCount,
      evalTimeMs: elapsed,
      milestoneReached,
    };
  }

  private evaluateLanguage(text: string, sentences: string[], totalSentences: number): QualityDimension {
    const suggestions: QualitySuggestion[] = [];
    const details: Record<string, number | string> = {};
    const cal = WQE_CALIBRATION.language;
    const sw = WQE_SUB_WEIGHTS.language;

    const uniqueChars = new Set(text.replace(/[\s\n，。！？、；：""''（）【】《》…—]/g, '')).size;
    const totalChars = text.replace(/[\s\n，。！？、；：""''（）【】《》…—]/g, '').length;
    const vocabRichness = totalChars > 0 ? (uniqueChars / Math.min(totalChars, cal.vocabSampleCap)) * 100 : 0;

    details.uniqueChars = uniqueChars;
    details.vocabRichness = Math.round(vocabRichness) + '%';

    const sentenceLengths = sentences.map(s => s.length);
    const avgSentenceLen = totalSentences > 0 ? sentenceLengths.reduce((a, b) => a + b, 0) / totalSentences : 0;
    const sentenceVariance = totalSentences > 1
      ? sentenceLengths.reduce((sum, len) => sum + Math.pow(len - avgSentenceLen, 2), 0) / totalSentences
      : 0;
    const sentenceStdDev = Math.sqrt(sentenceVariance);
    const sentenceVariety = Math.min(100, (sentenceStdDev / Math.max(1, avgSentenceLen)) * cal.sentenceVarietyScale);

    details.avgSentenceLen = Math.round(avgSentenceLen) + '字';
    details.sentenceVariety = Math.round(sentenceVariety) + '%';

    let rhetoricCount = 0;
    for (const pattern of RHETORIC_PATTERNS) {
      rhetoricCount += (text.match(pattern) || []).length;
    }
    const rhetoricScore = Math.min(100, rhetoricCount * cal.rhetoricPerHit);
    details.rhetoricCount = rhetoricCount;

    let typoScore = 100;
    const typoIssues: string[] = [];
    for (const { pattern, correct } of COMMON_TYPO_PATTERNS) {
      const count = (text.match(pattern) || []).length;
      if (count > 0) {
        typoIssues.push(correct);
        typoScore -= count * cal.typoPenaltyPerHit;
      }
    }
    typoScore = Math.max(0, typoScore);
    details.typoIssues = typoIssues.length > 0 ? typoIssues.join('、') : '无';

    const repeatPattern = /(.{2,})\1{2,}/g;
    const repeatMatches = text.match(repeatPattern) || [];
    const repeatPenalty = repeatMatches.length * cal.repeatPenaltyPerHit;
    details.repetitionCount = repeatMatches.length;

    const vocabScore = Math.min(100, vocabRichness * cal.vocabScale);
    const varietyScore = sentenceVariety;
    const finalTypoScore = Math.max(0, typoScore - repeatPenalty);

    const languageScore = Math.round(
      vocabScore * sw.vocab +
      varietyScore * sw.variety +
      rhetoricScore * sw.rhetoric +
      finalTypoScore * sw.typo
    );

    if (vocabScore < 40) {
      suggestions.push({
        id: 'lang_vocab',
        dimension: '语言质量',
        content: '用词较为单一，建议增加词汇丰富度，使用更多近义词和表达手法',
        priority: 'medium',
        estimatedEffort: '中等',
        category: 'language',
      });
    }

    if (sentenceVariety < 30 && totalSentences > 10) {
      suggestions.push({
        id: 'lang_sentence_var',
        dimension: '语言质量',
        content: '句式变化较少，长短句搭配可以更灵活，建议穿插使用不同长度的句子',
        priority: 'medium',
        estimatedEffort: '中等',
        category: 'language',
      });
    }

    if (rhetoricCount < 3 && text.length > 1000) {
      suggestions.push({
        id: 'lang_rhetoric',
        dimension: '语言质量',
        content: '修辞手法运用较少，建议适当使用比喻、拟人、排比等修辞增强文采',
        priority: 'low',
        estimatedEffort: '小',
        category: 'language',
      });
    }

    if (typoIssues.length > 0) {
      suggestions.push({
        id: 'lang_typo',
        dimension: '语言质量',
        content: `可能存在用字问题：${typoIssues.slice(0, 2).join('、')}，建议检查`,
        priority: 'high',
        estimatedEffort: '小',
        category: 'language',
      });
    }

    if (repeatMatches.length > 2) {
      suggestions.push({
        id: 'lang_repeat',
        dimension: '语言质量',
        content: '存在重复用字/词现象，建议精简表达，避免冗余重复',
        priority: 'medium',
        estimatedEffort: '小',
        category: 'language',
      });
    }

    if (suggestions.length === 0) {
      suggestions.push({
        id: 'lang_good',
        dimension: '语言质量',
        content: '语言表达流畅，词汇丰富，句式多变',
        priority: 'low',
        estimatedEffort: '-',
        category: 'language',
      });
    }

    return { score: Math.min(100, Math.max(0, languageScore)), details, suggestions };
  }

  private evaluateRhythm(
    text: string,
    sentences: string[],
    paragraphs: string[],
    totalSentences: number,
    totalParagraphs: number
  ): QualityDimension {
    const suggestions: QualitySuggestion[] = [];
    const details: Record<string, number | string> = {};
    const cal = WQE_CALIBRATION.rhythm;
    const sw = WQE_SUB_WEIGHTS.rhythm;

    let actionCount = 0;
    for (const word of RHYTHM_VERBS) {
      actionCount += (text.match(new RegExp(word, 'g')) || []).length;
    }

    let dialogueCount = 0;
    for (const marker of DIALOGUE_MARKERS) {
      dialogueCount += (text.match(new RegExp(marker + '["「『]', 'g')) || []).length;
    }

    let descCount = 0;
    for (const word of DESCRIPTION_WORDS) {
      descCount += (text.match(new RegExp(word, 'g')) || []).length;
    }

    const actionRatio = text.length > 0 ? actionCount / text.length * 100 : 0;
    const dialogueRatio = totalSentences > 0 ? dialogueCount / totalSentences : 0;
    const descRatio = text.length > 0 ? descCount / text.length * 100 : 0;

    details.actionDensity = Math.round(actionRatio * 10) / 10;
    details.dialogueRatio = Math.round(dialogueRatio * 100) + '%';
    details.descriptionDensity = Math.round(descRatio * 10) / 10;

    let paceVariety = 0;
    if (totalParagraphs >= 5) {
      const third = Math.floor(totalParagraphs / 3);
      const sections = [
        paragraphs.slice(0, third),
        paragraphs.slice(third, third * 2),
        paragraphs.slice(third * 2),
      ];

      const sectionPaces: number[] = [];
      for (const section of sections) {
        const sectionText = section.join('\n');
        const sectionActions = RHYTHM_VERBS.reduce((sum, word) =>
          sum + (sectionText.match(new RegExp(word, 'g')) || []).length, 0);
        const sectionDesc = DESCRIPTION_WORDS.reduce((sum, word) =>
          sum + (sectionText.match(new RegExp(word, 'g')) || []).length, 0);
        const pace = sectionDesc > 0 ? sectionActions / sectionDesc : 1;
        sectionPaces.push(pace);
      }

      const paceVariance = sectionPaces.length > 1
        ? sectionPaces.reduce((sum, p) => sum + Math.pow(p - this.average(sectionPaces), 2), 0) / sectionPaces.length
        : 0;
      paceVariety = Math.min(100, paceVariance * cal.paceVarianceScale);
    }
    details.paceVariety = Math.round(paceVariety) + '%';

    const sceneShifts = this.detectSceneShifts(paragraphs);
    details.sceneShifts = sceneShifts;
    const sceneShiftScore = Math.min(100, sceneShifts * cal.sceneShiftPerHit);

    const dialogueScore = Math.min(100, dialogueRatio * cal.dialogueScale);
    const actionScore = Math.min(100, actionRatio * cal.actionScale);

    const balanceScore = this.calculateBalanceScore(actionRatio, dialogueRatio, descRatio);

    const rhythmScore = Math.round(
      paceVariety * sw.paceVariety +
      balanceScore * sw.balance +
      dialogueScore * sw.dialogue +
      sceneShiftScore * sw.sceneShift +
      actionScore * sw.action
    );

    if (actionRatio < 1.5 && text.length > 1000) {
      suggestions.push({
        id: 'rhythm_action',
        dimension: '节奏质量',
        content: '动作描写偏少，建议增加角色行为和动态描写提升节奏',
        priority: 'medium',
        estimatedEffort: '中等',
        category: 'rhythm',
      });
    }

    if (dialogueRatio < 0.1 && totalSentences > 10) {
      suggestions.push({
        id: 'rhythm_dialogue',
        dimension: '节奏质量',
        content: '对话占比偏低，建议通过对话推动情节、展现人物，加快节奏',
        priority: 'medium',
        estimatedEffort: '中等',
        category: 'rhythm',
      });
    }

    if (paceVariety < 20 && totalParagraphs > 8) {
      suggestions.push({
        id: 'rhythm_pace_var',
        dimension: '节奏质量',
        content: '节奏变化不够丰富，建议张弛有度，快慢结合，避免平铺直叙',
        priority: 'high',
        estimatedEffort: '大',
        category: 'rhythm',
      });
    }

    if (sceneShifts === 0 && totalParagraphs > 10) {
      suggestions.push({
        id: 'rhythm_scene_shift',
        dimension: '节奏质量',
        content: '场景过于单一，建议适当切换场景或视角，增加叙事层次',
        priority: 'low',
        estimatedEffort: '中等',
        category: 'rhythm',
      });
    }

    if (descRatio > 20) {
      suggestions.push({
        id: 'rhythm_too_much_desc',
        dimension: '节奏质量',
        content: '静态描写过多可能拖慢节奏，建议精简描写，穿插动态情节',
        priority: 'medium',
        estimatedEffort: '中等',
        category: 'rhythm',
      });
    }

    if (suggestions.length === 0) {
      suggestions.push({
        id: 'rhythm_good',
        dimension: '节奏质量',
        content: '节奏把控良好，张弛有度，场景切换自然',
        priority: 'low',
        estimatedEffort: '-',
        category: 'rhythm',
      });
    }

    return { score: Math.min(100, Math.max(0, rhythmScore)), details, suggestions };
  }

  private evaluateCharacter(text: string, sentences: string[], totalSentences: number): QualityDimension {
    const suggestions: QualitySuggestion[] = [];
    const details: Record<string, number | string> = {};
    const cal = WQE_CALIBRATION.character;
    const sw = WQE_SUB_WEIGHTS.character;

    let charMentionCount = 0;
    const charMentions: Record<string, number> = {};

    if (this.characterNames.length > 0) {
      for (const name of this.characterNames) {
        if (!name || name.length < 2) continue;
        const count = (text.match(new RegExp(this.escapeRegex(name), 'g')) || []).length;
        if (count > 0) {
          charMentions[name] = count;
          charMentionCount += count;
        }
      }
    } else {
      const namePattern = /[\u4e00-\u9fa5]{2,4}(说|道|问|答|喊|叫|笑|哭)/g;
      const matches = text.match(namePattern) || [];
      charMentionCount = matches.length;
      details.estimation = '基于对话标记估算';
    }

    const dialogSentences = sentences.filter(s => /"[^"]*"|「[^」]*」/.test(s)).length;
    const dialogRatio = totalSentences > 0 ? dialogSentences / totalSentences : 0;

    const actionPattern = /[\u4e00-\u9fa5]{1,3}(着|地|地)(跑|走|冲|打|看|想|笑|哭|站|坐)/g;
    const actionWithChar = (text.match(actionPattern) || []).length;

    details.characterMentions = charMentionCount;
    details.dialogRatio = Math.round(dialogRatio * 100) + '%';
    details.actionDescriptions = actionWithChar;
    details.uniqueCharacters = Object.keys(charMentions).length || '未知';

    const mentionScore = Math.min(100, charMentionCount * cal.mentionScale);
    const dialogScore = Math.min(100, dialogRatio * cal.dialogueScale);
    const actionScore = Math.min(100, actionWithChar * cal.actionScale);

    let characterDepth = 50;
    if (this.characterNames.length > 0) {
      const multiAngleChars = Object.entries(charMentions).filter(([name, count]) => {
        if (count < cal.depthMinMentions) return false;
        const nearPattern = new RegExp(this.escapeRegex(name) + '.{0,30}(想|觉得|认为|感到|心里|心中|暗想)', 'g');
        const hasThought = (text.match(nearPattern) || []).length > 0;
        const actionPattern2 = new RegExp(this.escapeRegex(name) + '.{0,10}(着|地)', 'g');
        const hasAction = (text.match(actionPattern2) || []).length > 0;
        return hasThought && hasAction;
      }).length;
      characterDepth = Math.min(100, cal.depthBase + multiAngleChars * cal.depthPerCharacter);
    }
    details.characterDepth = characterDepth + '%';

    const dialoguePersonality = this.evaluateDialoguePersonality(text, sentences);
    details.dialoguePersonality = Math.round(dialoguePersonality) + '%';

    const charScore = Math.round(
      mentionScore * sw.mention +
      dialogScore * sw.dialogue +
      actionScore * sw.action +
      characterDepth * sw.depth +
      dialoguePersonality * sw.personality
    );

    if (mentionScore < 30) {
      suggestions.push({
        id: 'char_mention',
        dimension: '人物质量',
        content: '主要角色出场不足，建议增加主角视角和互动场景',
        priority: 'high',
        estimatedEffort: '中等',
        category: 'character',
      });
    }

    if (dialogRatio < 0.15 && totalSentences > 10) {
      suggestions.push({
        id: 'char_dialogue',
        dimension: '人物质量',
        content: '对话偏少，建议通过个性化对话展现人物性格',
        priority: 'medium',
        estimatedEffort: '中等',
        category: 'character',
      });
    }

    if (actionScore < 30) {
      suggestions.push({
        id: 'char_action',
        dimension: '人物质量',
        content: '角色动作描写不足，建议增加肢体语言和行为细节',
        priority: 'medium',
        estimatedEffort: '小',
        category: 'character',
      });
    }

    if (characterDepth < 50 && this.characterNames.length > 0) {
      suggestions.push({
        id: 'char_depth',
        dimension: '人物质量',
        content: '角色立体感不足，建议增加心理活动、动作、语言等多维度描写',
        priority: 'high',
        estimatedEffort: '大',
        category: 'character',
      });
    }

    if (dialoguePersonality < 40 && dialogSentences > 5) {
      suggestions.push({
        id: 'char_personality',
        dimension: '人物质量',
        content: '对话辨识度不高，建议为不同角色设计独特的说话风格和口头禅',
        priority: 'medium',
        estimatedEffort: '中等',
        category: 'character',
      });
    }

    if (suggestions.length === 0) {
      suggestions.push({
        id: 'char_good',
        dimension: '人物质量',
        content: '人物塑造立体，对话生动，角色辨识度高',
        priority: 'low',
        estimatedEffort: '-',
        category: 'character',
      });
    }

    return { score: Math.min(100, Math.max(0, charScore)), details, suggestions };
  }

  private evaluatePlot(text: string, paragraphs: string[], totalParagraphs: number): QualityDimension {
    const suggestions: QualitySuggestion[] = [];
    const details: Record<string, number | string> = {};
    const cal = WQE_CALIBRATION.plot;
    const sw = WQE_SUB_WEIGHTS.plot;

    let suspenseCount = 0;
    for (const pattern of SUSPENSE_PATTERNS) {
      suspenseCount += (text.match(pattern) || []).length;
    }
    const suspenseScore = Math.min(100, suspenseCount * cal.suspensePerHit);
    details.suspenseIndicators = suspenseCount;

    let coolMomentCount = 0;
    for (const pattern of COOL_MOMENT_PATTERNS) {
      coolMomentCount += (text.match(pattern) || []).length;
    }
    const coolScore = Math.min(100, coolMomentCount * cal.coolPerHit);
    details.coolMoments = coolMomentCount;

    const conflictPatterns = [
      /但是|然而|可是|却|不料|没想到/,
      /突然|忽然|就在这时|就在此刻/,
      /危机|危险|紧急|迫在眉睫|千钧一发/,
      /对峙|对抗|较量|决斗|战斗|厮杀/,
    ];
    let conflictCount = 0;
    for (const pattern of conflictPatterns) {
      conflictCount += (text.match(pattern) || []).length;
    }
    const conflictScore = Math.min(100, conflictCount * cal.conflictPerHit);
    details.conflictIndicators = conflictCount;

    let logicScore = 70;
    const causalityPatterns = [
      /因为|所以|因此|于是|结果|导致|造成/,
      /虽然|但是|然而|可是|却/,
      /如果|那么|就|只要|就/,
    ];
    let causalityCount = 0;
    for (const pattern of causalityPatterns) {
      causalityCount += (text.match(pattern) || []).length;
    }
    logicScore = Math.min(100, cal.logicBase + causalityCount * cal.logicPerHit);
    details.causalityIndicators = causalityCount;

    const foreshadowPatterns = [
      /据说|传闻|传说|没人知道|无人知晓|谁也不知道/,
      /神秘|诡异|蹊跷|古怪|不对劲|不同寻常/,
      /那东西|此物|这物件|那把剑|这枚/,
      /总有一天|到时候|将来|以后|三年后|五年后/,
      /那件事|当年的事|那个秘密|那个约定/,
      /仿佛|似乎|好像|隐约|依稀/,
      /心里暗想|心中一动|若有所思/,
    ];
    let foreshadowCount = 0;
    for (const pattern of foreshadowPatterns) {
      foreshadowCount += (text.match(pattern) || []).length;
    }
    const foreshadowScore = Math.min(100, foreshadowCount * cal.foreshadowPerHit);
    details.foreshadowCount = foreshadowCount;

    const plotScore = Math.round(
      conflictScore * sw.conflict +
      suspenseScore * sw.suspense +
      coolScore * sw.cool +
      logicScore * sw.logic +
      foreshadowScore * sw.foreshadow
    );

    if (conflictScore < 30 && text.length > 1000) {
      suggestions.push({
        id: 'plot_conflict',
        dimension: '情节质量',
        content: '冲突张力不足，建议增加矛盾对立，强化情节紧迫感',
        priority: 'high',
        estimatedEffort: '大',
        category: 'plot',
      });
    }

    if (suspenseScore < 30 && text.length > 1500) {
      suggestions.push({
        id: 'plot_suspense',
        dimension: '情节质量',
        content: '悬念设置不足，建议适当留白和设疑，吸引读者继续阅读',
        priority: 'medium',
        estimatedEffort: '中等',
        category: 'plot',
      });
    }

    if (coolMomentCount < 2 && text.length > 2000) {
      suggestions.push({
        id: 'plot_cool',
        dimension: '情节质量',
        content: '爽点/高光时刻偏少，建议设置角色出彩的名场面',
        priority: 'medium',
        estimatedEffort: '中等',
        category: 'plot',
      });
    }

    if (foreshadowCount < 2 && text.length > 1000) {
      suggestions.push({
        id: 'plot_foreshadow',
        dimension: '情节质量',
        content: '伏笔埋设较少，建议适当埋设伏笔增加故事深度和期待感',
        priority: 'low',
        estimatedEffort: '小',
        category: 'plot',
      });
    }

    if (logicScore < 50) {
      suggestions.push({
        id: 'plot_logic',
        dimension: '情节质量',
        content: '因果关系不够清晰，建议强化事件之间的逻辑关联',
        priority: 'high',
        estimatedEffort: '大',
        category: 'plot',
      });
    }

    if (suggestions.length === 0) {
      suggestions.push({
        id: 'plot_good',
        dimension: '情节质量',
        content: '情节紧凑，冲突有力，悬念设置得当',
        priority: 'low',
        estimatedEffort: '-',
        category: 'plot',
      });
    }

    return { score: Math.min(100, Math.max(0, plotScore)), details, suggestions };
  }

  private evaluateAtmosphere(text: string, paragraphs: string[], totalParagraphs: number): QualityDimension {
    const suggestions: QualitySuggestion[] = [];
    const details: Record<string, number | string> = {};
    const cal = WQE_CALIBRATION.atmosphere;
    const sw = WQE_SUB_WEIGHTS.atmosphere;

    let envCount = 0;
    for (const word of ENVIRONMENT_WORDS) {
      envCount += (text.match(new RegExp(word, 'g')) || []).length;
    }
    const envScore = Math.min(100, envCount * cal.environmentPerHit);
    details.environmentMentions = envCount;

    let posEmotionCount = 0;
    let negEmotionCount = 0;
    for (const word of EMOTION_WORDS_POSITIVE) {
      posEmotionCount += (text.match(new RegExp(word, 'g')) || []).length;
    }
    for (const word of EMOTION_WORDS_NEGATIVE) {
      negEmotionCount += (text.match(new RegExp(word, 'g')) || []).length;
    }
    const totalEmotion = posEmotionCount + negEmotionCount;
    const emotionScore = Math.min(100, totalEmotion * cal.emotionPerHit);
    details.positiveEmotions = posEmotionCount;
    details.negativeEmotions = negEmotionCount;

    const sensePatterns = [
      /看到|听见|闻到|尝到|摸到|感到|觉得/,
      /眼中|耳边|鼻尖|指尖|心里/,
      /色彩|光芒|声音|气味|味道|触感/,
    ];
    let senseCount = 0;
    for (const pattern of sensePatterns) {
      senseCount += (text.match(pattern) || []).length;
    }
    const senseScore = Math.min(100, senseCount * cal.sensePerHit);
    details.senseDescriptions = senseCount;

    let immersionScore = 50;
    if (totalParagraphs >= 3) {
      const firstPerson = (text.match(/我|吾|在下|敝人/g) || []).length;
      const thirdPersonLimited = (text.match(/他|她|它/g) || []).length;
      const perspectiveRatio = firstPerson > 0 ? firstPerson / (firstPerson + thirdPersonLimited) : 0;
      if (perspectiveRatio > cal.firstPersonRatioMin) {
        immersionScore = Math.min(100, cal.firstPersonBase + firstPerson * cal.firstPersonPerHit);
      } else {
        immersionScore = Math.min(100, cal.thirdPersonBase + thirdPersonLimited * cal.thirdPersonPerHit);
      }
    }
    details.immersion = Math.round(immersionScore) + '%';

    const atmosphereScore = Math.round(
      envScore * sw.environment +
      emotionScore * sw.emotion +
      senseScore * sw.sense +
      immersionScore * sw.immersion
    );

    if (envScore < 30) {
      suggestions.push({
        id: 'atmosphere_env',
        dimension: '氛围质量',
        content: '环境描写不足，建议增加视觉、听觉、嗅觉等多感官环境描写',
        priority: 'medium',
        estimatedEffort: '小',
        category: 'atmosphere',
      });
    }

    if (emotionScore < 30 && text.length > 1000) {
      suggestions.push({
        id: 'atmosphere_emotion',
        dimension: '氛围质量',
        content: '情绪渲染偏弱，建议加强角色的情感表达和心理活动',
        priority: 'medium',
        estimatedEffort: '中等',
        category: 'atmosphere',
      });
    }

    if (senseScore < 25) {
      suggestions.push({
        id: 'atmosphere_sense',
        dimension: '氛围质量',
        content: '感官描写较少，建议调动视觉、听觉、嗅觉等多种感官增强代入感',
        priority: 'low',
        estimatedEffort: '小',
        category: 'atmosphere',
      });
    }

    if (immersionScore < 40 && text.length > 1500) {
      suggestions.push({
        id: 'atmosphere_immersion',
        dimension: '氛围质量',
        content: '代入感有待提升，建议加强视角统一和心理描写',
        priority: 'medium',
        estimatedEffort: '中等',
        category: 'atmosphere',
      });
    }

    if (suggestions.length === 0) {
      suggestions.push({
        id: 'atmosphere_good',
        dimension: '氛围质量',
        content: '氛围渲染到位，代入感强，情绪饱满',
        priority: 'low',
        estimatedEffort: '-',
        category: 'atmosphere',
      });
    }

    return { score: Math.min(100, Math.max(0, atmosphereScore)), details, suggestions };
  }

  private evaluateStructure(text: string, paragraphs: string[], totalParagraphs: number): QualityDimension {
    const suggestions: QualitySuggestion[] = [];
    const details: Record<string, number | string> = {};
    const cal = WQE_CALIBRATION.structure;
    const sw = WQE_SUB_WEIGHTS.structure;

    let openingScore = 50;
    if (totalParagraphs >= 2) {
      const firstTwo = paragraphs.slice(0, 2).join('\n');
      let hookCount = 0;
      for (const pattern of OPENING_HOOK_PATTERNS) {
        hookCount += (firstTwo.match(pattern) || []).length;
      }
      openingScore = Math.min(100, cal.openingBase + hookCount * cal.openingPerHook);

      const firstLen = firstTwo.length;
      if (firstLen > cal.openingLengthMin && firstLen < cal.openingLengthMax) {
        openingScore = Math.min(100, openingScore + cal.openingLengthBonus);
      }
    }
    details.openingAttraction = openingScore + '%';

    let middleScore = 50;
    if (totalParagraphs >= 5) {
      const middleStart = Math.floor(totalParagraphs * 0.2);
      const middleEnd = Math.ceil(totalParagraphs * 0.8);
      const middleSection = paragraphs.slice(middleStart, middleEnd);
      const middleText = middleSection.join('\n');

      const conflictCount = (middleText.match(/但是|然而|可是|却|不料|没想到|突然|忽然/g) || []).length;
      const dialogCount = (middleText.match(/["「『]/g) || []).length / 2;
      const midDensity = (conflictCount + dialogCount) / Math.max(1, middleSection.length);

      middleScore = Math.min(100, cal.middleBase + midDensity * cal.middleDensityScale);
    }
    details.middleRichness = Math.round(middleScore) + '%';

    let endingScore = 50;
    if (totalParagraphs >= 3) {
      const lastTwo = paragraphs.slice(-2).join('\n');
      let hookCount = 0;
      for (const pattern of ENDING_HOOK_PATTERNS) {
        hookCount += (lastTwo.match(pattern) || []).length;
      }

      const lastLen = lastTwo.length;
      if (lastLen > cal.endingLengthMin && lastLen < cal.endingLengthMax) {
        endingScore = Math.min(100, cal.endingBase + hookCount * cal.endingPerHook + cal.endingLengthBonus);
      } else {
        endingScore = Math.min(100, cal.endingBase + hookCount * cal.endingPerHook);
      }
    }
    details.endingStrength = endingScore + '%';

    let structureBalance = 50;
    if (totalParagraphs >= 5) {
      const firstPart = paragraphs.slice(0, Math.floor(totalParagraphs * 0.25)).join('\n').length;
      const midPart = paragraphs.slice(Math.floor(totalParagraphs * 0.25), Math.ceil(totalParagraphs * 0.75)).join('\n').length;
      const lastPart = paragraphs.slice(Math.ceil(totalParagraphs * 0.75)).join('\n').length;
      const totalLen = firstPart + midPart + lastPart;

      const firstRatio = firstPart / totalLen;
      const midRatio = midPart / totalLen;
      const lastRatio = lastPart / totalLen;

      const idealFirst = cal.idealFirstRatio;
      const idealMid = cal.idealMiddleRatio;
      const idealLast = cal.idealLastRatio;

      const deviation =
        Math.abs(firstRatio - idealFirst) +
        Math.abs(midRatio - idealMid) +
        Math.abs(lastRatio - idealLast);

      structureBalance = Math.max(0, Math.min(100, 100 - deviation * cal.balancePenaltyScale));
    }
    details.structureBalance = Math.round(structureBalance) + '%';

    const structureScore = Math.round(
      openingScore * sw.opening +
      middleScore * sw.middle +
      endingScore * sw.ending +
      structureBalance * sw.balance
    );

    if (openingScore < 40 && totalParagraphs >= 2) {
      suggestions.push({
        id: 'struct_opening',
        dimension: '结构质量',
        content: '开头吸引力不足，建议在开篇设置悬念、冲突或金手指，快速抓住读者',
        priority: 'high',
        estimatedEffort: '大',
        category: 'structure',
      });
    }

    if (middleScore < 40 && totalParagraphs >= 5) {
      suggestions.push({
        id: 'struct_middle',
        dimension: '结构质量',
        content: '中段内容偏单薄，建议增加情节起伏、冲突升级和角色互动',
        priority: 'high',
        estimatedEffort: '大',
        category: 'structure',
      });
    }

    if (endingScore < 40 && totalParagraphs >= 3 && text.length > 1500) {
      suggestions.push({
        id: 'struct_ending',
        dimension: '结构质量',
        content: '结尾力道不足，建议设置悬念钩子或留下期待，吸引读者继续阅读',
        priority: 'medium',
        estimatedEffort: '中等',
        category: 'structure',
      });
    }

    if (structureBalance < 50 && totalParagraphs >= 5) {
      suggestions.push({
        id: 'struct_balance',
        dimension: '结构质量',
        content: '章节结构比例失衡，建议调整开头、中段、结尾的篇幅分配',
        priority: 'low',
        estimatedEffort: '中等',
        category: 'structure',
      });
    }

    if (suggestions.length === 0) {
      suggestions.push({
        id: 'struct_good',
        dimension: '结构质量',
        content: '结构完整，开头抓人，中段饱满，结尾有力',
        priority: 'low',
        estimatedEffort: '-',
        category: 'structure',
      });
    }

    return { score: Math.min(100, Math.max(0, structureScore)), details, suggestions };
  }

  private evaluateDialoguePersonality(text: string, sentences: string[]): number {
    const dialogues: string[] = [];
    const dialogPattern = /"([^"]*)"|「([^」]*)」|『([^』]*)』/g;
    let match;
    while ((match = dialogPattern.exec(text)) !== null) {
      const dialog = match[1] || match[2] || match[3];
      if (dialog && dialog.length > 1) {
        dialogues.push(dialog);
      }
    }

    const cal = WQE_CALIBRATION.dialoguePersonality;

    if (dialogues.length < cal.minDialogues) return 50;

    const uniqueStarts = new Set(dialogues.map(d => d.slice(0, 2)));
    const uniqueEnds = new Set(dialogues.map(d => d.slice(-2)));

    const startVariety = (uniqueStarts.size / dialogues.length) * 100;
    const endVariety = (uniqueEnds.size / dialogues.length) * 100;

    const avgDialogLen = dialogues.reduce((sum, d) => sum + d.length, 0) / dialogues.length;
    const lenVariety = dialogues.filter(d => Math.abs(d.length - avgDialogLen) > avgDialogLen * cal.lengthDeviationRatio).length / dialogues.length;

    return Math.min(100, startVariety * cal.startWeight + endVariety * cal.endWeight + lenVariety * 100 * cal.lengthWeight);
  }

  private calculateBalanceScore(actionRatio: number, dialogueRatio: number, descRatio: number): number {
    const cal = WQE_CALIBRATION.balance;
    const idealAction = cal.idealActionRatio;
    const idealDialogue = cal.idealDialogueRatio;
    const idealDesc = cal.idealDescRatio;

    const actionDeviation = Math.abs(actionRatio - idealAction) / idealAction;
    const dialogueDeviation = Math.abs(dialogueRatio - idealDialogue) / idealDialogue;
    const descDeviation = Math.abs(descRatio - idealDesc) / idealDesc;

    const totalDeviation = (actionDeviation + dialogueDeviation + descDeviation) / 3;
    return Math.max(0, Math.min(100, 100 - totalDeviation * cal.deviationScale));
  }

  private calculateTrend(currentScore: number): QualityTrend {
    const cal = WQE_CALIBRATION.trend;
    if (this.scoreHistory.length < cal.minSamples) return 'stable';

    const recent = this.scoreHistory.slice(-cal.windowSize);
    const midPoint = Math.floor(recent.length / 2);
    const firstHalf = recent.slice(0, midPoint);
    const secondHalf = recent.slice(midPoint);

    const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

    const diff = secondAvg - firstAvg;
    if (diff > cal.delta) return 'rising';
    if (diff < -cal.delta) return 'falling';
    return 'stable';
  }

  private checkMilestone(wordCount: number): string | undefined {
    for (const milestone of this.MILESTONE_INTERVALS) {
      if (wordCount >= milestone && this.lastMilestone < milestone) {
        this.lastMilestone = milestone;
        return `${milestone}字里程碑`;
      }
    }
    return undefined;
  }

  /**
   * 分数对应的等级。
   *
   * @param score - 分数
   * @returns 等级
   */
  getGrade(score: number): QualityGrade {
    // 分界统一在 shared/thresholds.ts，禁止在此另写 90/80/70/60
    return gradeFromScore(score);
  }

  /**
   * 读取分数历史。
   * @returns 分数数组
   */
  getScoreHistory(): number[] {
    return [...this.scoreHistory];
  }

  /**
   * 忽略一条建议。
   *
   * @param suggestionId - 建议 ID
   */
  ignoreSuggestion(suggestionId: string): void {
    this.ignoredSuggestions.add(suggestionId);
  }

  /**
   * 取消忽略。
   *
   * @param suggestionId - 建议 ID
   */
  unignoreSuggestion(suggestionId: string): void {
    this.ignoredSuggestions.delete(suggestionId);
  }

  /**
   * 读取已忽略建议。
   * @returns id 数组
   */
  getIgnoredSuggestions(): string[] {
    return Array.from(this.ignoredSuggestions);
  }

  /**
   * 清空分数历史。
   */
  clearHistory(): void {
    this.scoreHistory = [];
    this.lastMilestone = 0;
  }

  private detectSceneShifts(paragraphs: string[]): number {
    let shifts = 0;
    const shiftIndicators = [
      '转瞬间', '转眼间', '片刻后', '不久后', '过了一会儿',
      '第二天', '次日', '三日后', '一个月后', '几年后',
      '画面一转', '镜头切换', '与此同时', '另一边',
      '而在', '此时', '此刻',
    ];

    for (let i = 1; i < paragraphs.length; i++) {
      const para = paragraphs[i];
      for (const indicator of shiftIndicators) {
        if (para.startsWith(indicator) || para.slice(0, 20).includes(indicator)) {
          shifts++;
          break;
        }
      }
    }

    return shifts;
  }

  private splitParagraphs(text: string): string[] {
    return text.split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length > 0);
  }

  private splitSentences(text: string): string[] {
    return text.split(/[。！？!?]+/).filter(s => s.trim().length > 0);
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private average(arr: number[]): number {
    if (arr.length === 0) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  private getEmptyResult(wordCount: number, startTime: number): WritingQualityResult {
    const emptyDim: QualityDimension = {
      score: 0,
      details: { note: '内容不足100字，无法评估' },
      suggestions: [{
        id: 'empty',
        dimension: '通用',
        content: '继续写作，系统将自动评估写作质量',
        priority: 'low',
        estimatedEffort: '-',
        category: 'language',
      }],
    };

    return {
      languageQuality: { ...emptyDim, suggestions: [{ ...emptyDim.suggestions[0], id: 'empty_lang', dimension: '语言质量' }] },
      rhythmQuality: { ...emptyDim, suggestions: [{ ...emptyDim.suggestions[0], id: 'empty_rhythm', dimension: '节奏质量' }] },
      characterQuality: { ...emptyDim, suggestions: [{ ...emptyDim.suggestions[0], id: 'empty_char', dimension: '人物质量' }] },
      plotQuality: { ...emptyDim, suggestions: [{ ...emptyDim.suggestions[0], id: 'empty_plot', dimension: '情节质量' }] },
      atmosphereQuality: { ...emptyDim, suggestions: [{ ...emptyDim.suggestions[0], id: 'empty_atmos', dimension: '氛围质量' }] },
      structureQuality: { ...emptyDim, suggestions: [{ ...emptyDim.suggestions[0], id: 'empty_struct', dimension: '结构质量' }] },
      overallScore: 0,
      grade: 'D',
      trend: 'stable',
      comparedToAverage: 0,
      topSuggestions: [],
      evaluatedAt: Date.now(),
      wordCount,
      evalTimeMs: Date.now() - startTime,
    };
  }
}

/**
 * 等级颜色。
 *
 * @param grade - 等级
 * @returns 颜色
 */
export function getQualityGradeColor(grade: QualityGrade): string {
  return qualityGradeColor(grade);
}

/**
 * 等级中文名。
 *
 * @param grade - 等级
 * @returns 名称
 */
export function getQualityGradeLabel(grade: QualityGrade): string {
  return qualityGradeLabel(grade);
}

// 历史记录从磁盘恢复时 trend 是字符串，这里按字符串收口并提供兜底
/**
 * 趋势图标。
 *
 * @param trend - 趋势
 * @returns 图标
 */
export function getQualityTrendIcon(trend: string): string {
  const icons: Record<string, string> = {
    'rising': '📈',
    'falling': '📉',
    'stable': '➡️',
  };
  return icons[trend] || icons['stable'];
}

/**
 * 趋势中文名。
 *
 * @param trend - 趋势
 * @returns 名称
 */
export function getQualityTrendLabel(trend: string): string {
  const labels: Record<string, string> = {
    'rising': '上升',
    'falling': '下降',
    'stable': '平稳',
  };
  return labels[trend] || labels['stable'];
}

/**
 * 优先级颜色。
 *
 * @param priority - 优先级
 * @returns 颜色
 */
export function getPriorityColor(priority: SuggestionPriority): string {
  const colors: Record<SuggestionPriority, string> = {
    'high': 'var(--nw-danger, #ef4444)',
    'medium': 'var(--nw-warning, #f59e0b)',
    'low': 'var(--nw-text-muted, var(--text-faint))',
  };
  return colors[priority];
}

/**
 * 优先级中文名。
 *
 * @param priority - 优先级
 * @returns 名称
 */
export function getPriorityLabel(priority: SuggestionPriority): string {
  const labels: Record<SuggestionPriority, string> = {
    'high': '高优先级',
    'medium': '中优先级',
    'low': '低优先级',
  };
  return labels[priority];
}
