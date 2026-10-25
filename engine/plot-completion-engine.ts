import { createLogger } from '../shared/logger';
import { PLOT_COMPLETION_MIN_EVALUABLE_CHARS } from '../shared/thresholds';

const log = createLogger('PlotCompletionEngine');
/**
 * plot-completion-engine.ts — 实时剧情完成度监控引擎
 *
 * 功能：基于规则 + 轻量 NLP 实现章节剧情完成度实时评估
 * 7 个维度：场景、目标、人物、伏笔、情绪弧、综合、情节牵引
 * 不依赖 AI 调用，保证实时性（< 100ms / 万字）
 */

export interface PlotCompletionDimension {
  score: number;
  details: Record<string, number | string>;
  suggestions: string[];
}

export interface PlotCompletionResult {
  sceneCompletion: PlotCompletionDimension;
  goalCompletion: PlotCompletionDimension;
  characterEngagement: PlotCompletionDimension;
  foreshadowProgress: PlotCompletionDimension;
  emotionArcProgress: PlotCompletionDimension;
  overallCompletion: PlotCompletionDimension;
  plotTraction: PlotCompletionDimension;
  evaluatedAt: number;
  wordCount: number;
}

export interface PlotCompletionEngineOptions {
  characterNames?: string[];
  mainlineKeywords?: string[];
  chapterOutline?: string;
  foreshadowPlanted?: number;
  foreshadowRevealed?: number;
}

const SCENE_LOCATION_WORDS = [
  '在', '位于', '坐落在', '地处', '置身于', '来到', '进入', '走出',
  '房间', '大厅', '宫殿', '山洞', '森林', '城市', '村庄', '街道',
  '山顶', '海边', '河畔', '山谷', '平原', '沙漠', '雪原',
];

const SCENE_TIME_WORDS = [
  '清晨', '黎明', '早晨', '上午', '中午', '正午', '下午', '傍晚',
  '黄昏', '日落', '夜晚', '深夜', '午夜', '凌晨', '子时', '卯时',
  '第一天', '第二天', '三天后', '一个月后', '一年后',
];

const SCENE_ENV_WORDS = [
  '阳光', '月光', '星光', '灯光', '火光', '黑暗', '昏暗', '明亮',
  '风', '雨', '雪', '雷', '电', '云', '雾', '烟',
  '温暖', '寒冷', '炎热', '凉爽', '潮湿', '干燥', '静谧', '喧嚣',
  '花香', '血腥味', '硝烟味', '清新', '浑浊',
];

const SCENE_ATMOSPHERE_WORDS = [
  '紧张', '压抑', '沉重', '轻松', '欢快', '悲伤', '愤怒', '恐惧',
  '神秘', '诡异', '神圣', '庄严', '温馨', '浪漫', '诡异', '肃杀',
  '剑拔弩张', '一触即发', '暗流涌动', '风平浪静',
];

const GOAL_START_PATTERNS = [
  /决定.{0,20}(要|去|做|完成|达成)/,
  /目标是/,
  /任务是/,
  /必须.{0,10}(完成|做到|找到|救出|打败)/,
  /为了.{0,20}(，|,).{0,10}(要|得|必须)/,
  /计划.{0,10}(去|做|实施|执行)/,
];

const GOAL_OBSTACLE_PATTERNS = [
  /但是.{0,30}(却|可是|然而|没想到)/,
  /不料/,
  /没想到/,
  /谁知/,
  /可.{0,10}(困难|阻碍|麻烦|问题)/,
  /遇到.{0,10}(阻碍|困难|麻烦|挑战)/,
  /遭到.{0,10}(拒绝|阻击|伏击|暗算)/,
  /突然.{0,10}(出现|发生|冒出来)/,
];

const GOAL_RESULT_PATTERNS = [
  /终于.{0,10}(成功|完成|达到|实现)/,
  /最后.{0,10}(还是|终究|总算)/,
  /结果.{0,10}(成功|失败|如何|怎样)/,
  /最终/,
  /至此.{0,10}(告一段落|结束|完成)/,
  /(成功|失败)了/,
];

const ACTION_VERBS = [
  '走', '跑', '跳', '飞', '冲', '打', '砍', '刺', '挡', '躲',
  '拿', '抓', '握', '扔', '推', '拉', '开', '关', '爬', '跃',
  '站', '坐', '躺', '跪', '蹲', '靠', '倚', '伏',
  '说', '喊', '叫', '吼', '问', '答', '道', '言', '诉',
  '笑', '哭', '怒', '叹', '惊', '喜', '悲', '恨',
];

const POSITIVE_EMOTION_WORDS = [
  '喜悦', '开心', '高兴', '快乐', '幸福', '满足', '欣慰', '激动',
  '兴奋', '期待', '希望', '热情', '感激', '感动', '骄傲', '自豪',
  '轻松', '平静', '安宁', '温馨', '浪漫', '甜蜜',
];

const NEGATIVE_EMOTION_WORDS = [
  '悲伤', '痛苦', '绝望', '恐惧', '害怕', '愤怒', '生气', '憎恨',
  '厌恶', '嫉妒', '羞愧', '内疚', '后悔', '焦虑', '紧张', '担忧',
  '失落', '孤独', '寂寞', '沮丧', '气馁', '绝望',
];

const STRONG_EMOTION_WORDS = [
  '震惊', '骇然', '骇然', '狂喜', '暴怒', '痛哭', '惨叫', '咆哮',
  '颤抖', '战栗', '窒息', '心如刀绞', '肝肠寸断', '欣喜若狂',
  '怒发冲冠', '毛骨悚然', '惊心动魄',
];

export class PlotCompletionEngine {
  private characterNames: string[];
  private mainlineKeywords: string[];
  private chapterOutline: string;
  private foreshadowPlanted: number;
  private foreshadowRevealed: number;

  constructor(options: PlotCompletionEngineOptions = {}) {
    this.characterNames = options.characterNames || [];
    this.mainlineKeywords = options.mainlineKeywords || [];
    this.chapterOutline = options.chapterOutline || '';
    this.foreshadowPlanted = options.foreshadowPlanted || 0;
    this.foreshadowRevealed = options.foreshadowRevealed || 0;
  }

  updateOptions(options: Partial<PlotCompletionEngineOptions>): void {
    if (options.characterNames !== undefined) this.characterNames = options.characterNames;
    if (options.mainlineKeywords !== undefined) this.mainlineKeywords = options.mainlineKeywords;
    if (options.chapterOutline !== undefined) this.chapterOutline = options.chapterOutline;
    if (options.foreshadowPlanted !== undefined) this.foreshadowPlanted = options.foreshadowPlanted;
    if (options.foreshadowRevealed !== undefined) this.foreshadowRevealed = options.foreshadowRevealed;
  }

  evaluate(text: string): PlotCompletionResult {
    const startTime = Date.now();
    const cleanText = text.replace(/^---\n[\s\S]*?\n---\n?/, '').trim();
    const wordCount = cleanText.length;

    if (wordCount < PLOT_COMPLETION_MIN_EVALUABLE_CHARS) {
      return this.getEmptyResult(wordCount);
    }

    const paragraphs = this.splitParagraphs(cleanText);
    const sentences = this.splitSentences(cleanText);
    const totalParagraphs = paragraphs.length;
    const totalSentences = sentences.length;

    const sceneCompletion = this.evaluateScene(cleanText, paragraphs, totalParagraphs);
    const goalCompletion = this.evaluateGoal(cleanText, paragraphs, totalParagraphs);
    const characterEngagement = this.evaluateCharacter(cleanText, sentences, totalSentences);
    const foreshadowProgress = this.evaluateForeshadow(cleanText);
    const emotionArcProgress = this.evaluateEmotionArc(paragraphs, totalParagraphs);
    const plotTraction = this.evaluatePlotTraction(cleanText);

    const weights = {
      scene: 0.15,
      goal: 0.25,
      character: 0.2,
      foreshadow: 0.1,
      emotion: 0.15,
      traction: 0.15,
    };

    const overallScore = Math.round(
      sceneCompletion.score * weights.scene +
      goalCompletion.score * weights.goal +
      characterEngagement.score * weights.character +
      foreshadowProgress.score * weights.foreshadow +
      emotionArcProgress.score * weights.emotion +
      plotTraction.score * weights.traction
    );

    const overallSuggestions = this.generateOverallSuggestions(
      sceneCompletion.score,
      goalCompletion.score,
      characterEngagement.score,
      foreshadowProgress.score,
      emotionArcProgress.score,
      plotTraction.score
    );

    const elapsed = Date.now() - startTime;
    log.debug('[PlotCompletionEngine] 评估完成，耗时', elapsed, 'ms，字数', wordCount);

    return {
      sceneCompletion,
      goalCompletion,
      characterEngagement,
      foreshadowProgress,
      emotionArcProgress,
      overallCompletion: {
        score: overallScore,
        details: {
          wordCount,
          paragraphs: totalParagraphs,
          sentences: totalSentences,
          evalTimeMs: elapsed,
        },
        suggestions: overallSuggestions,
      },
      plotTraction,
      evaluatedAt: Date.now(),
      wordCount,
    };
  }

  private evaluateScene(text: string, paragraphs: string[], totalParagraphs: number): PlotCompletionDimension {
    const suggestions: string[] = [];
    const details: Record<string, number | string> = {};

    const locationCount = this.countKeywords(text, SCENE_LOCATION_WORDS);
    const timeCount = this.countKeywords(text, SCENE_TIME_WORDS);
    const envCount = this.countKeywords(text, SCENE_ENV_WORDS);
    const atmosphereCount = this.countKeywords(text, SCENE_ATMOSPHERE_WORDS);

    details.locationMentions = locationCount;
    details.timeMentions = timeCount;
    details.envMentions = envCount;
    details.atmosphereMentions = atmosphereCount;

    const locationScore = Math.min(100, locationCount * 15);
    const timeScore = Math.min(100, timeCount * 20);
    const envScore = Math.min(100, envCount * 8);
    const atmosphereScore = Math.min(100, atmosphereCount * 12);

    const locationDensity = locationCount / Math.max(1, totalParagraphs);
    const envDensity = envCount / Math.max(1, totalParagraphs);

    let distributionScore = 0;
    if (totalParagraphs >= 3) {
      const firstThird = paragraphs.slice(0, Math.ceil(totalParagraphs / 3));
      const midThird = paragraphs.slice(Math.ceil(totalParagraphs / 3), Math.ceil(totalParagraphs * 2 / 3));
      const lastThird = paragraphs.slice(Math.ceil(totalParagraphs * 2 / 3));

      const firstHasScene = firstThird.some(p =>
        this.countKeywords(p, SCENE_LOCATION_WORDS) > 0 || this.countKeywords(p, SCENE_ENV_WORDS) > 0
      );
      const midHasScene = midThird.some(p =>
        this.countKeywords(p, SCENE_LOCATION_WORDS) > 0 || this.countKeywords(p, SCENE_ENV_WORDS) > 0
      );
      const lastHasScene = lastThird.some(p =>
        this.countKeywords(p, SCENE_LOCATION_WORDS) > 0 || this.countKeywords(p, SCENE_ENV_WORDS) > 0
      );

      const covered = [firstHasScene, midHasScene, lastHasScene].filter(Boolean).length;
      distributionScore = (covered / 3) * 100;
    } else {
      distributionScore = 50;
    }

    const sceneScore = Math.round(
      locationScore * 0.2 +
      timeScore * 0.15 +
      envScore * 0.3 +
      atmosphereScore * 0.2 +
      distributionScore * 0.15
    );

    if (locationScore < 30) suggestions.push('场景地点描写不足，建议明确故事发生的具体位置');
    if (timeScore < 30) suggestions.push('时间标识不清晰，建议补充时间背景（清晨/傍晚/几日后等）');
    if (envScore < 40) suggestions.push('环境描写偏少，建议增加视觉、听觉、嗅觉等感官描写');
    if (atmosphereScore < 30) suggestions.push('氛围渲染不足，建议通过环境烘托情绪基调');
    if (distributionScore < 50 && totalParagraphs >= 5) suggestions.push('场景描写分布不均，建议在情节推进中穿插环境描写');

    if (suggestions.length === 0) suggestions.push('场景要素齐全，描写分布合理');

    return { score: Math.min(100, sceneScore), details, suggestions };
  }

  private evaluateGoal(text: string, paragraphs: string[], totalParagraphs: number): PlotCompletionDimension {
    const suggestions: string[] = [];
    const details: Record<string, number | string> = {};

    let startScore = 0;
    let obstacleScore = 0;
    let resultScore = 0;

    const firstQuarter = paragraphs.slice(0, Math.max(1, Math.ceil(totalParagraphs * 0.25))).join('\n');
    const middleHalf = paragraphs.slice(
      Math.ceil(totalParagraphs * 0.2),
      Math.ceil(totalParagraphs * 0.8)
    ).join('\n');
    const lastQuarter = paragraphs.slice(Math.floor(totalParagraphs * 0.75)).join('\n');

    let startMatches = 0;
    for (const pattern of GOAL_START_PATTERNS) {
      if (pattern.test(firstQuarter)) startMatches++;
    }
    startScore = Math.min(100, startMatches * 35 + 20);
    details.goalIndicators = startMatches;

    if (this.chapterOutline) {
      const outlineKeywords = this.chapterOutline
        .replace(/[，。！？、；：""''（）【】\s]/g, '')
        .slice(0, 50);
      let outlineMatchCount = 0;
      for (let i = 0; i < outlineKeywords.length - 1; i++) {
        const bigram = outlineKeywords.slice(i, i + 2);
        if (text.includes(bigram)) outlineMatchCount++;
      }
      const outlineMatchRate = outlineMatchCount / Math.max(1, outlineKeywords.length - 1);
      details.outlineMatchRate = Math.round(outlineMatchRate * 100) + '%';
      startScore = Math.max(startScore, Math.round(outlineMatchRate * 80));
    }

    let obstacleMatches = 0;
    for (const pattern of GOAL_OBSTACLE_PATTERNS) {
      if (pattern.test(middleHalf)) obstacleMatches++;
    }
    obstacleScore = Math.min(100, obstacleMatches * 30 + 15);
    details.obstacleIndicators = obstacleMatches;

    let resultMatches = 0;
    for (const pattern of GOAL_RESULT_PATTERNS) {
      if (pattern.test(lastQuarter)) resultMatches++;
    }
    resultScore = Math.min(100, resultMatches * 40);
    details.resultIndicators = resultMatches;

    const progressRatio = Math.min(1, text.length / 3000);
    if (progressRatio < 0.3) {
      resultScore = 0;
    } else if (progressRatio < 0.6) {
      resultScore = Math.round(resultScore * 0.5);
    }

    const goalScore = Math.round(
      startScore * 0.35 +
      obstacleScore * 0.35 +
      resultScore * 0.3
    );

    if (startScore < 40) suggestions.push('本章目标不够明确，建议在开头清晰交代角色要做什么');
    if (obstacleScore < 30 && totalParagraphs > 3) suggestions.push('缺少阻碍和冲突，情节过于平顺，建议增加波折');
    if (resultScore < 20 && progressRatio > 0.7) suggestions.push('接近章节末尾，建议给当前情节一个阶段性结果');
    if (obstacleScore > 70 && resultScore < 30 && progressRatio > 0.8) suggestions.push('冲突已充分铺垫，建议尽快收束给出结果');

    if (suggestions.length === 0) {
      if (progressRatio < 0.5) {
        suggestions.push('开篇目标清晰，继续推进情节发展');
      } else {
        suggestions.push('情节结构完整，起承转合清晰');
      }
    }

    return { score: Math.min(100, goalScore), details, suggestions };
  }

  private evaluateCharacter(text: string, sentences: string[], totalSentences: number): PlotCompletionDimension {
    const suggestions: string[] = [];
    const details: Record<string, number | string> = {};

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

    let actionCount = 0;
    for (const verb of ACTION_VERBS) {
      actionCount += (text.match(new RegExp(verb, 'g')) || []).length;
    }

    const actionDensity = text.length > 0 ? actionCount / text.length * 100 : 0;

    details.characterMentions = charMentionCount;
    details.dialogRatio = Math.round(dialogRatio * 100) + '%';
    details.actionDensity = Math.round(actionDensity * 10) / 10;
    details.uniqueCharacters = Object.keys(charMentions).length || '未知';

    const mentionScore = Math.min(100, charMentionCount * 5);
    const dialogScore = Math.min(100, dialogRatio * 200);
    const actionScore = Math.min(100, actionDensity * 15);

    let distributionScore = 0;
    if (totalSentences >= 10) {
      const third = Math.floor(totalSentences / 3);
      const firstDialog = sentences.slice(0, third).filter(s => /"[^"]*"|「[^」]*」/.test(s)).length;
      const midDialog = sentences.slice(third, third * 2).filter(s => /"[^"]*"|「[^」]*」/.test(s)).length;
      const lastDialog = sentences.slice(third * 2).filter(s => /"[^"]*"|「[^」]*」/.test(s)).length;

      const hasDialog = [firstDialog > 0, midDialog > 0, lastDialog > 0].filter(Boolean).length;
      distributionScore = (hasDialog / 3) * 100;
    } else {
      distributionScore = 50;
    }

    const charScore = Math.round(
      mentionScore * 0.3 +
      dialogScore * 0.3 +
      actionScore * 0.25 +
      distributionScore * 0.15
    );

    if (mentionScore < 30) suggestions.push('主要角色出场不足，建议增加主角视角和互动');
    if (dialogRatio < 0.1 && totalSentences > 5) suggestions.push('对话偏少，建议通过对话展现人物性格和推进情节');
    if (actionScore < 30) suggestions.push('动作描写不足，建议增加角色行为和肢体语言');
    if (Object.keys(charMentions).length === 1 && charMentionCount > 10) {
      suggestions.push('单角色戏份过重，建议引入其他角色互动');
    }

    if (suggestions.length === 0) suggestions.push('人物参与度良好，角色互动自然');

    return { score: Math.min(100, charScore), details, suggestions };
  }

  private evaluateForeshadow(text: string): PlotCompletionDimension {
    const suggestions: string[] = [];
    const details: Record<string, number | string> = {};

    const foreshadowPatterns = [
      /据说|传闻|传说|没人知道|无人知晓|谁也不知道|世人皆知/,
      /神秘|诡异|蹊跷|古怪|不对劲|不同寻常/,
      /那东西|此物|这物件|那把剑|这枚/,
      /总有一天|到时候|将来|以后|三年后|五年后/,
      /那件事|当年的事|那个秘密|那个约定/,
      /仿佛|似乎|好像|隐约|依稀/,
      /心里暗想|心中一动|若有所思/,
    ];

    let foreshadowMatches = 0;
    for (const pattern of foreshadowPatterns) {
      foreshadowMatches += (text.match(pattern) || []).length;
    }

    const revealPatterns = [
      /原来|真相|果然|不出所料|正如所料/,
      /终于明白|恍然大悟|豁然开朗|这才知道/,
      /揭开|揭晓|揭晓|暴露|露出马脚/,
      /答案|谜底|真相大白/,
    ];

    let revealMatches = 0;
    for (const pattern of revealPatterns) {
      revealMatches += (text.match(pattern) || []).length;
    }

    details.detectedForeshadows = foreshadowMatches;
    details.detectedReveals = revealMatches;

    if (this.foreshadowPlanted > 0 || this.foreshadowRevealed > 0) {
      details.projectForeshadowPlanted = this.foreshadowPlanted;
      details.projectForeshadowRevealed = this.foreshadowRevealed;
    }

    const plantScore = Math.min(100, foreshadowMatches * 20);
    const revealScore = Math.min(100, revealMatches * 25);

    const balanceScore = foreshadowMatches > 0 && revealMatches > 0
      ? 80
      : foreshadowMatches > 0 || revealMatches > 0
        ? 40
        : 0;

    let foreshadowScore = Math.round(
      plantScore * 0.4 +
      revealScore * 0.35 +
      balanceScore * 0.25
    );

    if (foreshadowMatches === 0 && text.length > 1000) {
      suggestions.push('未检测到伏笔元素，建议适当埋设伏笔增加故事深度');
    } else if (foreshadowMatches > 5 && revealMatches === 0) {
      suggestions.push('伏笔埋设较多，注意适时回收，避免信息债过高');
      foreshadowScore = Math.min(100, foreshadowScore - 10);
    } else if (revealMatches > 0 && foreshadowMatches === 0) {
      suggestions.push('有回收但缺少铺垫，建议在揭示前增加伏笔暗示');
    }

    if (suggestions.length === 0) {
      if (foreshadowMatches > 0 && revealMatches > 0) {
        suggestions.push('伏笔埋设与回收节奏良好');
      } else {
        suggestions.push('情节推进中，可根据需要安排伏笔');
      }
    }

    return { score: Math.min(100, Math.max(0, foreshadowScore)), details, suggestions };
  }

  private evaluateEmotionArc(paragraphs: string[], totalParagraphs: number): PlotCompletionDimension {
    const suggestions: string[] = [];
    const details: Record<string, number | string> = {};

    if (totalParagraphs < 3) {
      return {
        score: 30,
        details: { note: '段落太少，无法完整评估情绪弧' },
        suggestions: ['内容较短，继续写作以展现情绪变化'],
      };
    }

    const emotionScores: number[] = [];
    const emotionTypes: ('positive' | 'negative' | 'neutral')[] = [];

    for (const para of paragraphs) {
      const posCount = this.countKeywords(para, POSITIVE_EMOTION_WORDS);
      const negCount = this.countKeywords(para, NEGATIVE_EMOTION_WORDS);
      const strongCount = this.countKeywords(para, STRONG_EMOTION_WORDS);

      const intensity = Math.min(100, (posCount + negCount) * 15 + strongCount * 25);
      const netEmotion = posCount - negCount;

      emotionScores.push(intensity);
      emotionTypes.push(netEmotion > 0 ? 'positive' : netEmotion < 0 ? 'negative' : 'neutral');
    }

    const third = Math.max(1, Math.floor(totalParagraphs / 3));
    const startScores = emotionScores.slice(0, third);
    const midScores = emotionScores.slice(third, totalParagraphs - third);
    const endScores = emotionScores.slice(totalParagraphs - third);

    const avgStart = this.average(startScores);
    const avgMid = this.average(midScores);
    const avgEnd = this.average(endScores);

    details.startIntensity = Math.round(avgStart);
    details.midIntensity = Math.round(avgMid);
    details.endIntensity = Math.round(avgEnd);

    const hasRise = avgMid > avgStart + 10;
    const hasPeak = avgMid > avgStart + 15 && avgMid > avgEnd + 5;
    const hasFall = avgEnd < avgMid - 10;

    let arcCompleteness = 0;
    if (hasRise) arcCompleteness += 30;
    if (hasPeak) arcCompleteness += 35;
    if (hasFall) arcCompleteness += 25;

    const overallIntensity = this.average(emotionScores);
    const intensityScore = Math.min(100, overallIntensity * 2);

    const typeChanges = this.countEmotionChanges(emotionTypes);
    const volatilityScore = Math.min(100, typeChanges * 20);

    details.arcCompleteness = arcCompleteness + '%';
    details.intensity = Math.round(overallIntensity);
    details.emotionShifts = typeChanges;

    const emotionScore = Math.round(
      arcCompleteness * 0.4 +
      intensityScore * 0.35 +
      volatilityScore * 0.25
    );

    if (overallIntensity < 20) {
      suggestions.push('情绪表达偏平淡，建议增加角色的心理活动和情感描写');
    }
    if (!hasRise && totalParagraphs > 5) {
      suggestions.push('情绪缺少上升阶段，建议逐步积累张力');
    }
    if (!hasPeak && totalParagraphs > 8) {
      suggestions.push('缺少情绪高潮点，建议设置关键场景强化情感冲击');
    }
    if (typeChanges === 0 && totalParagraphs > 5) {
      suggestions.push('情绪类型单一，建议通过冲突带来情绪起伏');
    }

    if (suggestions.length === 0) suggestions.push('情绪弧完整，起伏有致');

    return { score: Math.min(100, emotionScore), details, suggestions };
  }

  private evaluatePlotTraction(text: string): PlotCompletionDimension {
    const suggestions: string[] = [];
    const details: Record<string, number | string> = {};

    let mainlineScore = 0;
    if (this.mainlineKeywords.length > 0) {
      let matchCount = 0;
      for (const kw of this.mainlineKeywords) {
        if (kw.length >= 2 && text.includes(kw)) {
          matchCount++;
        }
      }
      mainlineScore = Math.round((matchCount / Math.max(1, this.mainlineKeywords.length)) * 100);
      details.mainlineKeywordMatches = matchCount + '/' + this.mainlineKeywords.length;
    } else {
      mainlineScore = 50;
      details.note = '未设置主线关键词，使用默认评估';
    }

    const conflictPatterns = [
      /但是|然而|可是|却|不料|没想到/,
      /突然|忽然|就在这时/,
      /危机|危险|紧急|迫在眉睫/,
      /对峙|对抗|较量|决斗|战斗/,
      /秘密|阴谋|真相|谜底/,
    ];

    let conflictCount = 0;
    for (const pattern of conflictPatterns) {
      conflictCount += (text.match(pattern) || []).length;
    }
    const conflictScore = Math.min(100, conflictCount * 12);
    details.conflictIndicators = conflictCount;

    const forwardPatterns = [
      /接下来|下一步|然后|随后|之后/,
      /计划|打算|准备|决定/,
      /明天|明日|下次|改日|来日/,
    ];

    let forwardCount = 0;
    for (const pattern of forwardPatterns) {
      forwardCount += (text.match(pattern) || []).length;
    }
    const forwardScore = Math.min(100, forwardCount * 20);
    details.forwardIndicators = forwardCount;

    const tractionScore = Math.round(
      mainlineScore * 0.4 +
      conflictScore * 0.35 +
      forwardScore * 0.25
    );

    if (mainlineScore < 30 && this.mainlineKeywords.length > 0) {
      suggestions.push('与主线关联较弱，建议穿插主线元素保持情节牵引');
    }
    if (conflictScore < 30) {
      suggestions.push('冲突张力不足，建议增加矛盾对立提升紧迫感');
    }
    if (forwardScore < 20 && text.length > 1500) {
      suggestions.push('缺少对后续的铺垫和展望，建议为下一章留钩子');
    }

    if (suggestions.length === 0) suggestions.push('情节牵引有力，主线关联紧密');

    return { score: Math.min(100, tractionScore), details, suggestions };
  }

  private generateOverallSuggestions(
    scene: number,
    goal: number,
    character: number,
    foreshadow: number,
    emotion: number,
    traction: number
  ): string[] {
    const suggestions: string[] = [];
    const scores: Record<string, number> = { scene, goal, character, foreshadow, emotion, traction };
    const labels: Record<string, string> = {
      scene: '场景描写',
      goal: '目标推进',
      character: '人物参与',
      foreshadow: '伏笔进度',
      emotion: '情绪弧',
      traction: '情节牵引',
    };

    const sorted = Object.entries(scores).sort((a, b) => a[1] - b[1]);
    const weakest = sorted[0];
    const secondWeakest = sorted[1];

    if (weakest[1] < 40) {
      suggestions.push(`最薄弱项：${labels[weakest[0]]}（${weakest[1]}分），建议优先加强`);
    }
    if (secondWeakest[1] < 50) {
      suggestions.push(`次薄弱项：${labels[secondWeakest[0]]}（${secondWeakest[1]}分），可同步优化`);
    }

    const strongItems = sorted.filter(([_, s]) => s >= 70);
    if (strongItems.length >= 3) {
      suggestions.push(`优势维度：${strongItems.slice(0, 3).map(([k]) => labels[k]).join('、')}，继续保持`);
    }

    const avg = Math.round(Object.values(scores).reduce((a, b) => a + b, 0) / 6);
    if (avg >= 70) {
      suggestions.push('整体完成度良好，章节结构均衡');
    } else if (avg >= 50) {
      suggestions.push('整体中等偏上，重点补强短板即可提升质量');
    } else {
      suggestions.push('整体完成度偏低，建议从多个维度充实内容');
    }

    return suggestions;
  }

  private splitParagraphs(text: string): string[] {
    return text.split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length > 0);
  }

  private splitSentences(text: string): string[] {
    return text.split(/[。！？!?]+/).filter(s => s.trim().length > 0);
  }

  private countKeywords(text: string, keywords: string[]): number {
    let count = 0;
    for (const kw of keywords) {
      const matches = text.match(new RegExp(this.escapeRegex(kw), 'g'));
      if (matches) count += matches.length;
    }
    return count;
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private average(arr: number[]): number {
    if (arr.length === 0) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  private countEmotionChanges(types: ('positive' | 'negative' | 'neutral')[]): number {
    let changes = 0;
    for (let i = 1; i < types.length; i++) {
      if (types[i] !== types[i - 1] && types[i] !== 'neutral') {
        changes++;
      }
    }
    return changes;
  }

  private getEmptyResult(wordCount: number): PlotCompletionResult {
    const emptyDim: PlotCompletionDimension = {
      score: 0,
      details: { note: '内容不足50字，无法评估' },
      suggestions: ['继续写作，系统将自动评估剧情完成度'],
    };
    return {
      sceneCompletion: { ...emptyDim, suggestions: ['内容太短，增加场景描写后可评估'] },
      goalCompletion: { ...emptyDim, suggestions: ['内容太短，待情节展开后可评估'] },
      characterEngagement: { ...emptyDim, suggestions: ['内容太短，增加角色后可评估'] },
      foreshadowProgress: { ...emptyDim, suggestions: ['内容太短，可评估伏笔后显示'] },
      emotionArcProgress: { ...emptyDim, suggestions: ['内容太短，情绪弧需更多段落'] },
      overallCompletion: {
        score: 0,
        details: { wordCount, paragraphs: 0, sentences: 0, evalTimeMs: 0 },
        suggestions: ['继续写作以获取完成度评估'],
      },
      plotTraction: { ...emptyDim, suggestions: ['内容太短，情节牵引待展开后评估'] },
      evaluatedAt: Date.now(),
      wordCount,
    };
  }
}

export function getScoreColorClass(score: number): string {
  if (score >= 70) return 'nw-float-ok';
  if (score >= 40) return 'nw-float-warn-text';
  return 'nw-float-danger';
}

export function getScoreLabel(score: number): string {
  if (score >= 85) return '优秀';
  if (score >= 70) return '良好';
  if (score >= 55) return '中等';
  if (score >= 40) return '待加强';
  if (score >= 20) return '薄弱';
  return '待开始';
}
