import { createLogger } from '../shared/logger';
import { splitParagraphs, splitSentences } from '../shared/text-utils';
import { DEVIATION_MIN_EVALUABLE_CHARS } from '../shared/thresholds';
import { isRisingDivergence } from '../shared/divergence-trend';

const log = createLogger('PlotDivergenceEngine');
/**
 * plot-divergence-engine.ts — 实时剧情偏离预警引擎
 *
 * 功能：基于规则的多维度剧情偏离检测
 * 5 个维度：主线偏离、角色偏离、节奏偏离、伏笔偏离、设定偏离
 * 不依赖 AI 调用，保证实时性（< 100ms / 万字）
 */

/**
 * 偏离等级。
 */
export type DivergenceLevel = 'normal' | 'warning' | 'danger';

/**
 * 偏离维度。
 */
export interface DivergenceDimension {
  score: number;
  level: DivergenceLevel;
  details: Record<string, number | string>;
  issues: string[];
  suggestions: string[];
}

/**
 * 偏离检测结果。
 */
export interface DivergenceResult {
  mainlineDivergence: DivergenceDimension;
  characterDivergence: DivergenceDimension;
  rhythmDivergence: DivergenceDimension;
  foreshadowDivergence: DivergenceDimension;
  settingDivergence: DivergenceDimension;
  overallDivergence: number;
  overallLevel: DivergenceLevel;
  evaluatedAt: number;
  wordCount: number;
  shouldAlert: boolean;
  alertReason?: string;
}

/**
 * 引擎选项。
 */
export interface PlotDivergenceEngineOptions {
  chapterOutline?: string;
  mainlineKeywords?: string[];
  characterNames?: string[];
  characterTraits?: Record<string, string[]>;
  settingKeywords?: string[];
  expectedRhythm?: 'fast' | 'medium' | 'slow';
  foreshadowToRecover?: string[];
  activeForeshadows?: string[];
  previousDivergence?: number;
  ignoredIssues?: string[];
}

const CHARACTER_TRAIT_KEYWORDS: Record<string, string[]> = {
  '冷静': ['冷静', '镇定', '平静', '不动声色', '面无表情', '淡然', '沉着'],
  '暴躁': ['暴躁', '怒吼', '咆哮', '怒', '烦躁', '恼火', '气急败坏'],
  '聪明': ['聪明', '机智', '灵机一动', '计上心来', '转念一想', '恍然大悟', '睿智'],
  '鲁莽': ['鲁莽', '冲动', '不管不顾', '冲上去', '二话不说', '贸然'],
  '谨慎': ['谨慎', '小心', '犹豫', '再三考虑', '思忖', '掂量', '小心翼翼'],
  '乐观': ['乐观', '开朗', '笑', '轻松', '无所谓', '满不在乎', '豁达'],
  '腹黑': ['腹黑', '阴笑', '冷笑', '算计', '盘算', '奸笑', '意味深长'],
  '温柔': ['温柔', '柔和', '轻声', '温柔地', '柔声', '体贴', '暖心'],
  '孤傲': ['孤傲', '冷漠', '不屑', '冷哼', '傲慢', '高高在上', '鄙夷'],
  '重情义': ['重情义', '兄弟', '朋友', '义气', '挺身而出', '相助', '患难'],
};

const SETTING_CONTRADICTION_PATTERNS = [
  { pattern: /(现代|科技|手机|电脑|互联网|飞机|汽车)/, setting: '现代科技' },
  { pattern: /(修仙|灵力|真气|丹药|御剑|元婴|金丹)/, setting: '修仙修真' },
  { pattern: /(魔法|巫师|魔杖|咒语|精灵|矮人|巨龙)/, setting: '西幻魔法' },
  { pattern: /(武侠|内力|轻功|门派|江湖|盟主|侠客)/, setting: '武侠江湖' },
  { pattern: /(科幻|飞船|机甲|外星人|基因改造|星际)/, setting: '科幻星际' },
  { pattern: /(古代|王朝|皇帝|大臣|皇宫|奏折|科举)/, setting: '古代王朝' },
];

const RHYTHM_ACTION_WORDS = [
  '冲', '打', '砍', '刺', '杀', '击', '扑', '跃', '闪', '躲',
  '跑', '追', '逃', '赶', '撞', '砸', '摔', '飞', '落', '起',
];

const RHYTHM_DIALOGUE_MARKERS = [
  '说', '道', '问', '答', '喊', '叫', '吼', '哭', '笑', '叹',
];

const RHYTHM_DESCRIPTION_WORDS = [
  '的', '了', '着', '是', '在', '有', '很', '都', '就', '又',
  '仿佛', '似乎', '好像', '犹如', '宛如', '如同', '一般', '一样',
];

const FORESHADOW_RECOVERY_PATTERNS = [
  /原来如此/, /难怪/, /怪不得/, /果然/, /不出所料/,
  /真相是/, /揭开了/, /谜底/, /终于明白/, /豁然开朗/,
  /这就是/, /原来是/, /回想起来/, /想起当初/,
];

const FORESHADOW_PLANT_PATTERNS = [
  /据说/, /传闻/, /传说/, /没人知道/, /神秘/, /诡异/,
  /那东西/, /此物/, /总有一天/, /到时候/, /那件事/,
  /仿佛/, /似乎/, /好像/, /隐约/, /依稀/, /若有所思/,
  /心里暗想/, /心中一动/, /暗自/, /悄悄/, /不动声色/,
];

/**
 * 剧情偏离引擎。
 */
export class PlotDivergenceEngine {
  private chapterOutline: string;
  private mainlineKeywords: string[];
  private characterNames: string[];
  private characterTraits: Record<string, string[]>;
  private settingKeywords: string[];
  private expectedRhythm: 'fast' | 'medium' | 'slow';
  private foreshadowToRecover: string[];
  private activeForeshadows: string[];
  private previousDivergence: number;
  private ignoredIssues: Set<string>;

  private divergenceHistory: number[] = [];
  /** 与 divergenceHistory 一一对应的时间戳，「持续上升」需要时间跨度 */
  private divergenceHistoryAt: number[] = [];
  private lastAlertTime: Record<string, number> = {};
  private readonly ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

  constructor(options: PlotDivergenceEngineOptions = {}) {
    this.chapterOutline = options.chapterOutline || '';
    this.mainlineKeywords = options.mainlineKeywords || [];
    this.characterNames = options.characterNames || [];
    this.characterTraits = options.characterTraits || {};
    this.settingKeywords = options.settingKeywords || [];
    this.expectedRhythm = options.expectedRhythm || 'medium';
    this.foreshadowToRecover = options.foreshadowToRecover || [];
    this.activeForeshadows = options.activeForeshadows || [];
    this.previousDivergence = options.previousDivergence || 0;
    this.ignoredIssues = new Set(options.ignoredIssues || []);
  }

  /**
   * 更新选项列表。
   * @param options - 配置项
   */
  updateOptions(options: Partial<PlotDivergenceEngineOptions>): void {
    if (options.chapterOutline !== undefined) this.chapterOutline = options.chapterOutline;
    if (options.mainlineKeywords !== undefined) this.mainlineKeywords = options.mainlineKeywords;
    if (options.characterNames !== undefined) this.characterNames = options.characterNames;
    if (options.characterTraits !== undefined) this.characterTraits = options.characterTraits;
    if (options.settingKeywords !== undefined) this.settingKeywords = options.settingKeywords;
    if (options.expectedRhythm !== undefined) this.expectedRhythm = options.expectedRhythm;
    if (options.foreshadowToRecover !== undefined) this.foreshadowToRecover = options.foreshadowToRecover;
    if (options.activeForeshadows !== undefined) this.activeForeshadows = options.activeForeshadows;
    if (options.previousDivergence !== undefined) this.previousDivergence = options.previousDivergence;
    if (options.ignoredIssues !== undefined) this.ignoredIssues = new Set(options.ignoredIssues);
  }

  /**
   * evaluate 方法。
   * @param text - 文本内容
    * @returns DivergenceResult 实例
   */
  evaluate(text: string): DivergenceResult {
    const startTime = Date.now();
    const cleanText = text.replace(/^---\n[\s\S]*?\n---\n?/, '').trim();
    const wordCount = cleanText.length;

    if (wordCount < DEVIATION_MIN_EVALUABLE_CHARS) {
      return this.getEmptyResult(wordCount);
    }

    const paragraphs = this.splitParagraphs(cleanText);
    const sentences = splitSentences(cleanText);

    const mainlineDivergence = this.evaluateMainline(cleanText);
    const characterDivergence = this.evaluateCharacter(cleanText, sentences);
    const rhythmDivergence = this.evaluateRhythm(cleanText, sentences, paragraphs);
    const foreshadowDivergence = this.evaluateForeshadow(cleanText);
    const settingDivergence = this.evaluateSetting(cleanText);

    const weights = {
      mainline: 0.3,
      character: 0.25,
      rhythm: 0.15,
      foreshadow: 0.15,
      setting: 0.15,
    };

    const overallDivergence = Math.round(
      mainlineDivergence.score * weights.mainline +
      characterDivergence.score * weights.character +
      rhythmDivergence.score * weights.rhythm +
      foreshadowDivergence.score * weights.foreshadow +
      settingDivergence.score * weights.setting
    );

    const overallLevel = this.getDivergenceLevel(overallDivergence);

    this.divergenceHistory.push(overallDivergence);
    this.divergenceHistoryAt.push(Date.now());
    if (this.divergenceHistory.length > 10) {
      this.divergenceHistory = this.divergenceHistory.slice(-10);
      this.divergenceHistoryAt = this.divergenceHistoryAt.slice(-10);
    }

    const { shouldAlert, alertReason } = this.checkShouldAlert(overallDivergence, overallLevel, {
      mainlineDivergence,
      characterDivergence,
      rhythmDivergence,
      foreshadowDivergence,
      settingDivergence,
    });

    const elapsed = Date.now() - startTime;
    log.debug('[PlotDivergenceEngine] 偏离检测完成，耗时', elapsed, 'ms，偏离度', overallDivergence + '%');

    return {
      mainlineDivergence,
      characterDivergence,
      rhythmDivergence,
      foreshadowDivergence,
      settingDivergence,
      overallDivergence,
      overallLevel,
      evaluatedAt: Date.now(),
      wordCount,
      shouldAlert,
      alertReason,
    };
  }

  private evaluateMainline(text: string): DivergenceDimension {
    const issues: string[] = [];
    const suggestions: string[] = [];
    const details: Record<string, number | string> = {};

    let outlineMatchRate = 0;
    let keywordCoverage = 0;
    let coreConflictMatch = 0;

    if (this.chapterOutline) {
      const outlineKeywords = this.extractKeywords(this.chapterOutline);
      const matchedKeywords: string[] = [];
      const unmatchedKeywords: string[] = [];

      for (const kw of outlineKeywords) {
        if (kw.length >= 2 && text.includes(kw)) {
          matchedKeywords.push(kw);
        } else if (kw.length >= 2) {
          unmatchedKeywords.push(kw);
        }
      }

      outlineMatchRate = outlineKeywords.length > 0
        ? Math.round((matchedKeywords.length / outlineKeywords.length) * 100)
        : 50;

      details.outlineMatched = matchedKeywords.length;
      details.outlineTotal = outlineKeywords.length;
      details.outlineMatchRate = outlineMatchRate + '%';

      if (unmatchedKeywords.length > 0 && outlineMatchRate < 60) {
        issues.push(`大纲关键词未覆盖：${unmatchedKeywords.slice(0, 5).join('、')}${unmatchedKeywords.length > 5 ? '...' : ''}`);
      }
    } else {
      outlineMatchRate = 50;
      details.note = '未设置章节大纲';
    }

    if (this.mainlineKeywords.length > 0) {
      let matched = 0;
      for (const kw of this.mainlineKeywords) {
        if (kw.length >= 2 && text.includes(kw)) {
          matched++;
        }
      }
      keywordCoverage = Math.round((matched / this.mainlineKeywords.length) * 100);
      details.mainlineMatched = matched + '/' + this.mainlineKeywords.length;
      details.mainlineCoverage = keywordCoverage + '%';

      if (keywordCoverage < 30) {
        issues.push('主线元素出现过少，剧情可能偏离主线');
      }
    } else {
      keywordCoverage = 50;
      details.mainlineNote = '未设置主线关键词';
    }

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
    details.conflictIndicators = conflictCount;

    if (this.chapterOutline && /冲突|对抗|战斗|危机|危险|挑战/.test(this.chapterOutline)) {
      coreConflictMatch = conflictCount > 0 ? Math.min(100, conflictCount * 20) : 20;
      if (conflictCount === 0) {
        issues.push('大纲预期有冲突，但本章未检测到冲突元素');
      }
    } else {
      coreConflictMatch = 70;
    }

    const divergenceScore = Math.round(
      (100 - outlineMatchRate) * 0.4 +
      (100 - keywordCoverage) * 0.35 +
      (100 - coreConflictMatch) * 0.25
    );

    if (divergenceScore >= 60) {
      suggestions.push('建议回顾本章大纲，确保核心情节按计划推进');
      if (this.mainlineKeywords.length > 0) {
        suggestions.push('可适当穿插主线元素，强化主线关联');
      }
    } else if (divergenceScore >= 30) {
      suggestions.push('部分大纲要点未覆盖，注意在后续段落中补充');
    } else {
      suggestions.push('主线贴合度良好，继续保持');
    }

    return {
      score: Math.min(100, Math.max(0, divergenceScore)),
      level: this.getDivergenceLevel(divergenceScore),
      details,
      issues: this.filterIgnored(issues),
      suggestions,
    };
  }

  private evaluateCharacter(text: string, sentences: string[]): DivergenceDimension {
    const issues: string[] = [];
    const suggestions: string[] = [];
    const details: Record<string, number | string> = {};

    let totalScore = 0;
    let charCount = 0;

    const characterBehavior: Record<string, { mentions: number; actions: string[]; dialogues: number }> = {};

    for (const name of this.characterNames) {
      if (!name || name.length < 2) continue;
      const mentions = (text.match(new RegExp(this.escapeRegex(name), 'g')) || []).length;
      if (mentions === 0) continue;

      characterBehavior[name] = { mentions, actions: [], dialogues: 0 };

      const dialogPattern = new RegExp(this.escapeRegex(name) + '["「『].*?["」』]', 'g');
      characterBehavior[name].dialogues = (text.match(dialogPattern) || []).length;

      const traits = this.characterTraits[name] || [];
      if (traits.length > 0) {
        let traitMatchScore = 0;
        let traitMismatchScore = 0;

        for (const trait of traits) {
          const traitWords = CHARACTER_TRAIT_KEYWORDS[trait] || [trait];
          let matchCount = 0;
          for (const word of traitWords) {
            const nearPattern = new RegExp(this.escapeRegex(name) + '.{0,50}' + this.escapeRegex(word), 'g');
            matchCount += (text.match(nearPattern) || []).length;
          }
          if (matchCount > 0) {
            traitMatchScore += Math.min(30, matchCount * 10);
          }
        }

        const oppositeTraits = this.getOppositeTraits(traits);
        for (const oppTrait of oppositeTraits) {
          const oppWords = CHARACTER_TRAIT_KEYWORDS[oppTrait] || [oppTrait];
          let mismatchCount = 0;
          for (const word of oppWords) {
            const nearPattern = new RegExp(this.escapeRegex(name) + '.{0,50}' + this.escapeRegex(word), 'g');
            mismatchCount += (text.match(nearPattern) || []).length;
          }
          if (mismatchCount > 0) {
            traitMismatchScore += Math.min(40, mismatchCount * 15);
          }
        }

        const charScore = Math.max(0, Math.min(100, 50 + traitMatchScore - traitMismatchScore));
        totalScore += charScore;
        charCount++;

        details[`${name}_consistency`] = charScore + '%';
        if (traitMismatchScore > 20) {
          issues.push(`${name} 的行为可能与「${traits.join('、')}」人设不符`);
        }
      }
    }

    if (charCount === 0) {
      details.note = '未检测到主要角色活动';
      return {
        score: 30,
        level: 'normal',
        details,
        issues: [],
        suggestions: ['主要角色未出场，待角色出场后检测人设一致性'],
      };
    }

    const avgConsistency = Math.round(totalScore / charCount);
    const divergenceScore = 100 - avgConsistency;

    details.charactersAnalyzed = charCount;
    details.avgConsistency = avgConsistency + '%';

    if (divergenceScore >= 60) {
      suggestions.push('建议检查角色行为是否符合人设，必要时调整描写');
      suggestions.push('可通过心理活动或旁白解释角色行为动机');
    } else if (divergenceScore >= 30) {
      suggestions.push('部分角色行为略有偏差，注意保持人设一致性');
    } else {
      suggestions.push('角色行为符合人设，表现稳定');
    }

    return {
      score: Math.min(100, Math.max(0, divergenceScore)),
      level: this.getDivergenceLevel(divergenceScore),
      details,
      issues: this.filterIgnored(issues),
      suggestions,
    };
  }

  private evaluateRhythm(text: string, sentences: string[], paragraphs: string[]): DivergenceDimension {
    const issues: string[] = [];
    const suggestions: string[] = [];
    const details: Record<string, number | string> = {};

    if (sentences.length < 5) {
      details.note = '句子太少，无法准确评估节奏';
      return {
        score: 20,
        level: 'normal',
        details,
        issues: [],
        suggestions: ['内容较短，继续写作后可评估节奏'],
      };
    }

    const avgSentenceLen = text.length / sentences.length;

    let actionCount = 0;
    for (const word of RHYTHM_ACTION_WORDS) {
      actionCount += (text.match(new RegExp(word, 'g')) || []).length;
    }

    let dialogueCount = 0;
    for (const marker of RHYTHM_DIALOGUE_MARKERS) {
      dialogueCount += (text.match(new RegExp(marker + '["「『]', 'g')) || []).length;
    }

    let descCount = 0;
    for (const word of RHYTHM_DESCRIPTION_WORDS) {
      descCount += (text.match(new RegExp(word, 'g')) || []).length;
    }

    const actionRatio = text.length > 0 ? actionCount / text.length * 100 : 0;
    const dialogueRatio = sentences.length > 0 ? dialogueCount / sentences.length : 0;
    const descRatio = text.length > 0 ? descCount / text.length * 100 : 0;

    details.avgSentenceLen = Math.round(avgSentenceLen) + '字';
    details.actionDensity = Math.round(actionRatio * 10) / 10;
    details.dialogueRatio = Math.round(dialogueRatio * 100) + '%';
    details.descriptionDensity = Math.round(descRatio * 10) / 10;

    let actualPace: 'fast' | 'medium' | 'slow';
    if (avgSentenceLen < 20 && actionRatio > 3) {
      actualPace = 'fast';
    } else if (avgSentenceLen > 40 && descRatio > 15) {
      actualPace = 'slow';
    } else {
      actualPace = 'medium';
    }
    details.actualPace = actualPace;
    details.expectedPace = this.expectedRhythm;

    let divergenceScore = 0;

    if (actualPace !== this.expectedRhythm) {
      if (
        (this.expectedRhythm === 'fast' && actualPace === 'slow') ||
        (this.expectedRhythm === 'slow' && actualPace === 'fast')
      ) {
        divergenceScore = 70;
        issues.push(`节奏偏差较大：预期${this.getPaceLabel(this.expectedRhythm)}，实际${this.getPaceLabel(actualPace)}`);
      } else {
        divergenceScore = 35;
        issues.push(`节奏略有偏差：预期${this.getPaceLabel(this.expectedRhythm)}，实际${this.getPaceLabel(actualPace)}`);
      }
    } else {
      divergenceScore = 10;
    }

    if (paragraphs.length >= 3) {
      const sceneShifts = this.detectSceneShifts(paragraphs);
      details.sceneShifts = sceneShifts;
      const expectedShifts = this.expectedRhythm === 'fast' ? 3 : this.expectedRhythm === 'slow' ? 1 : 2;
      if (sceneShifts > expectedShifts * 2) {
        divergenceScore = Math.min(100, divergenceScore + 20);
        issues.push('场景切换过于频繁，可能影响阅读体验');
      }
    }

    if (divergenceScore >= 60) {
      if (actualPace === 'slow' && this.expectedRhythm !== 'slow') {
        suggestions.push('建议增加动作描写和冲突，加快叙事节奏');
        suggestions.push('可缩短句子长度，减少冗长的环境描写');
      } else if (actualPace === 'fast' && this.expectedRhythm !== 'fast') {
        suggestions.push('建议适当放慢节奏，增加心理描写和环境铺垫');
        suggestions.push('可穿插一些静态描写和角色内心活动');
      }
    } else if (divergenceScore >= 30) {
      suggestions.push('节奏基本符合预期，可根据需要微调');
    } else {
      suggestions.push('节奏把控良好，张弛有度');
    }

    return {
      score: Math.min(100, Math.max(0, divergenceScore)),
      level: this.getDivergenceLevel(divergenceScore),
      details,
      issues: this.filterIgnored(issues),
      suggestions,
    };
  }

  private evaluateForeshadow(text: string): DivergenceDimension {
    const issues: string[] = [];
    const suggestions: string[] = [];
    const details: Record<string, number | string> = {};

    let recoveryCount = 0;
    for (const pattern of FORESHADOW_RECOVERY_PATTERNS) {
      recoveryCount += (text.match(pattern) || []).length;
    }

    let plantCount = 0;
    for (const pattern of FORESHADOW_PLANT_PATTERNS) {
      plantCount += (text.match(pattern) || []).length;
    }

    details.recoverySignals = recoveryCount;
    details.plantSignals = plantCount;

    let recoveryScore = 50;
    if (this.foreshadowToRecover.length > 0) {
      let recovered = 0;
      const missingForeshadows: string[] = [];
      for (const fs of this.foreshadowToRecover) {
        if (fs.length >= 2 && text.includes(fs)) {
          recovered++;
        } else {
          missingForeshadows.push(fs);
        }
      }
      recoveryScore = Math.round((recovered / this.foreshadowToRecover.length) * 100);
      details.toRecover = this.foreshadowToRecover.length;
      details.recovered = recovered;

      if (recoveryScore < 40 && text.length > 1500) {
        issues.push(`应回收的伏笔未回收：${missingForeshadows.slice(0, 3).join('、')}${missingForeshadows.length > 3 ? '...' : ''}`);
      }
    }

    let newForeshadowScore = 50;
    if (this.activeForeshadows.length > 0) {
      let newForeshadowCount = 0;
      for (const fs of this.activeForeshadows) {
        if (fs.length >= 2 && text.includes(fs)) {
          newForeshadowCount++;
        }
      }
      const newPlantRatio = plantCount > 0 ? Math.min(1, newForeshadowCount / plantCount) : 1;
      newForeshadowScore = Math.round(newPlantRatio * 100);
      details.activeForeshadows = this.activeForeshadows.length;
      details.mentionedActive = newForeshadowCount;

      if (plantCount > 3 && newForeshadowCount === 0) {
        issues.push('出现较多新伏笔埋设信号，但未关联已有伏笔线');
      }
    }

    const divergenceScore = Math.round(
      (100 - recoveryScore) * 0.5 +
      (100 - newForeshadowScore) * 0.5
    );

    if (divergenceScore >= 60) {
      if (this.foreshadowToRecover.length > 0) {
        suggestions.push('本章计划回收的伏笔尚未回收，注意安排回收时机');
      }
      suggestions.push('建议检查伏笔线的连贯性，避免伏笔过多过杂');
    } else if (divergenceScore >= 30) {
      suggestions.push('伏笔进度基本正常，注意把握回收节奏');
    } else {
      suggestions.push('伏笔埋设与回收节奏良好');
    }

    return {
      score: Math.min(100, Math.max(0, divergenceScore)),
      level: this.getDivergenceLevel(divergenceScore),
      details,
      issues: this.filterIgnored(issues),
      suggestions,
    };
  }

  private evaluateSetting(text: string): DivergenceDimension {
    const issues: string[] = [];
    const suggestions: string[] = [];
    const details: Record<string, number | string> = {};

    if (this.settingKeywords.length === 0) {
      details.note = '未设置世界观设定关键词';
      return {
        score: 20,
        level: 'normal',
        details,
        issues: [],
        suggestions: ['设置世界观关键词后可检测设定一致性'],
      };
    }

    const detectedSettings: string[] = [];
    for (const { pattern, setting } of SETTING_CONTRADICTION_PATTERNS) {
      if (pattern.test(text)) {
        detectedSettings.push(setting);
      }
    }

    details.detectedSettings = detectedSettings.length > 0 ? detectedSettings.join('、') : '无';

    let settingMatchCount = 0;
    const unmatchedKeywords: string[] = [];
    for (const kw of this.settingKeywords) {
      if (kw.length >= 2 && text.includes(kw)) {
        settingMatchCount++;
      } else if (kw.length >= 2) {
        unmatchedKeywords.push(kw);
      }
    }

    const settingCoverage = this.settingKeywords.length > 0
      ? Math.round((settingMatchCount / this.settingKeywords.length) * 100)
      : 50;

    details.settingCoverage = settingCoverage + '%';
    details.settingMatched = settingMatchCount + '/' + this.settingKeywords.length;

    let contradictionScore = 0;
    if (detectedSettings.length >= 2) {
      contradictionScore = 60;
      issues.push(`检测到多种世界观元素：${detectedSettings.join('、')}，可能存在设定冲突`);
    }

    const divergenceScore = Math.round(
      (100 - settingCoverage) * 0.4 +
      contradictionScore * 0.6
    );

    if (divergenceScore >= 60) {
      if (contradictionScore > 0) {
        suggestions.push('建议检查是否出现了与世界观不符的元素');
        suggestions.push('保持设定一致性，避免不同世界观元素混用');
      } else {
        suggestions.push('世界观元素体现不足，建议增加设定相关描写');
      }
    } else if (divergenceScore >= 30) {
      suggestions.push('设定基本一致，可适当增加世界观元素');
    } else {
      suggestions.push('世界观设定一致性良好');
    }

    return {
      score: Math.min(100, Math.max(0, divergenceScore)),
      level: this.getDivergenceLevel(divergenceScore),
      details,
      issues: this.filterIgnored(issues),
      suggestions,
    };
  }

  private checkShouldAlert(
    overallDivergence: number,
    overallLevel: DivergenceLevel,
    dimensions: {
      mainlineDivergence: DivergenceDimension;
      characterDivergence: DivergenceDimension;
      rhythmDivergence: DivergenceDimension;
      foreshadowDivergence: DivergenceDimension;
      settingDivergence: DivergenceDimension;
    }
  ): { shouldAlert: boolean; alertReason?: string } {
    const now = Date.now();

    if (overallDivergence > 60) {
      const alertKey = 'high_divergence';
      if (!this.isInCooldown(alertKey, now)) {
        this.lastAlertTime[alertKey] = now;
        return { shouldAlert: true, alertReason: `单章偏离度过高（${overallDivergence}%），请注意剧情走向` };
      }
    }

    if (this.divergenceHistory.length >= 3) {
      // 历史里存的是「评估次数」而非「章」：只看最近 3 次数值会把几秒内的
      // 三次编辑误判成「连续多章上升」，因此还必须跨过最小时间窗。
      const samples = this.divergenceHistory.map((value, index) => ({
        value,
        at: this.divergenceHistoryAt[index] ?? 0,
      }));
      if (isRisingDivergence(samples, now) && overallDivergence > 40) {
        const alertKey = 'rising_divergence';
        if (!this.isInCooldown(alertKey, now)) {
          this.lastAlertTime[alertKey] = now;
          return { shouldAlert: true, alertReason: '偏离度持续上升（近 3 次评估），建议及时调整' };
        }
      }
    }

    const highIssues: string[] = [];
    const dimMap: Record<string, DivergenceDimension> = {
      '主线偏离': dimensions.mainlineDivergence,
      '角色偏离': dimensions.characterDivergence,
      '节奏偏离': dimensions.rhythmDivergence,
      '伏笔偏离': dimensions.foreshadowDivergence,
      '设定偏离': dimensions.settingDivergence,
    };

    for (const [name, dim] of Object.entries(dimMap)) {
      if (dim.score > 70 && dim.issues.length > 0) {
        const issueKey = `${name}_${dim.issues[0].slice(0, 20)}`;
        if (!this.isInCooldown(issueKey, now)) {
          this.lastAlertTime[issueKey] = now;
          highIssues.push(`${name}：${dim.issues[0]}`);
        }
      }
    }

    if (highIssues.length > 0) {
      return { shouldAlert: true, alertReason: highIssues[0] };
    }

    return { shouldAlert: false };
  }

  private isInCooldown(key: string, now: number): boolean {
    const lastTime = this.lastAlertTime[key];
    if (!lastTime) return false;
    return now - lastTime < this.ALERT_COOLDOWN_MS;
  }

  /**
   * ignoreIssue 方法。
   * @param issueKey - 问题键
   */
  ignoreIssue(issueKey: string): void {
    this.ignoredIssues.add(issueKey);
  }

  /**
   * unignoreIssue 方法。
   * @param issueKey - 问题键
   */
  unignoreIssue(issueKey: string): void {
    this.ignoredIssues.delete(issueKey);
  }

  /**
   * getIgnoredIssues 方法。
   * @returns 结果数组
   */
  getIgnoredIssues(): string[] {
    return Array.from(this.ignoredIssues);
  }

  private filterIgnored(issues: string[]): string[] {
    return issues.filter(issue => {
      const key = issue.slice(0, 30);
      return !this.ignoredIssues.has(key);
    });
  }

  /**
   * 获取偏离历史。
   * @returns 结果数组
   */
  getDivergenceHistory(): number[] {
    return [...this.divergenceHistory];
  }

  /**
   * 清空历史。
   */
  clearHistory(): void {
    this.divergenceHistory = [];
    this.divergenceHistoryAt = [];
  }

  private getOppositeTraits(traits: string[]): string[] {
    const opposites: Record<string, string> = {
      '冷静': '暴躁',
      '暴躁': '冷静',
      '谨慎': '鲁莽',
      '鲁莽': '谨慎',
      '乐观': '孤傲',
      '孤傲': '乐观',
      '温柔': '腹黑',
      '腹黑': '温柔',
    };
    return traits.map(t => opposites[t]).filter(Boolean);
  }

  private getPaceLabel(pace: 'fast' | 'medium' | 'slow'): string {
    const labels = { fast: '快节奏', medium: '中节奏', slow: '慢节奏' };
    return labels[pace];
  }

  private getDivergenceLevel(score: number): DivergenceLevel {
    if (score >= 60) return 'danger';
    if (score >= 30) return 'warning';
    return 'normal';
  }

  private extractKeywords(text: string): string[] {
    const clean = text.replace(/[，。！？、；：""''（）【】\s\n\d]/g, '');
    const keywords: string[] = [];
    for (let i = 0; i < clean.length - 1; i++) {
      const bigram = clean.slice(i, i + 2);
      if (!keywords.includes(bigram)) {
        keywords.push(bigram);
      }
    }
    return keywords.slice(0, 50);
  }

  private detectSceneShifts(paragraphs: string[]): number {
    let shifts = 0;
    const shiftIndicators = [
      '转瞬间', '转眼间', '片刻后', '不久后', '过了一会儿',
      '第二天', '次日', '三日后', '一个月后', '几年后',
      '画面一转', '镜头切换', '与此同时', '另一边',
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

  private getEmptyResult(wordCount: number): DivergenceResult {
    const emptyDim: DivergenceDimension = {
      score: 0,
      level: 'normal',
      details: { note: '内容不足100字，无法检测' },
      issues: [],
      suggestions: ['继续写作，系统将自动检测剧情偏离'],
    };

    return {
      mainlineDivergence: { ...emptyDim, suggestions: ['内容太短，待情节展开后可检测主线偏离'] },
      characterDivergence: { ...emptyDim, suggestions: ['内容太短，待角色出场后可检测人设偏离'] },
      rhythmDivergence: { ...emptyDim, suggestions: ['内容太短，节奏检测待更多内容'] },
      foreshadowDivergence: { ...emptyDim, suggestions: ['内容太短，伏笔检测待更多内容'] },
      settingDivergence: { ...emptyDim, suggestions: ['内容太短，设定检测待更多内容'] },
      overallDivergence: 0,
      overallLevel: 'normal',
      evaluatedAt: Date.now(),
      wordCount,
      shouldAlert: false,
    };
  }
}

/**
 * 偏离等级颜色。
 *
 * @param level - 层级或档位
 * @returns 颜色
 */
export function getDivergenceLevelColor(level: DivergenceLevel): string {
  if (level === 'danger') return 'var(--nw-danger, #ef4444)';
  if (level === 'warning') return 'var(--nw-warning, #f59e0b)';
  return 'var(--nw-success, #22c55e)';
}

/**
 * 偏离等级中文名。
 *
 * @param level - 层级或档位
 * @returns 名称
 */
export function getDivergenceLevelLabel(level: DivergenceLevel): string {
  if (level === 'danger') return '警告';
  if (level === 'warning') return '注意';
  return '正常';
}

/**
 * 偏离等级图标。
 *
 * @param level - 层级或档位
 * @returns 图标
 */
export function getDivergenceLevelIcon(level: DivergenceLevel): string {
  if (level === 'danger') return '🔴';
  if (level === 'warning') return '🟡';
  return '🟢';
}
