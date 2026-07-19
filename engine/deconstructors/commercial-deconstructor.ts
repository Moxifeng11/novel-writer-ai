import { kbBookCommercialAnalysisFile } from '../../shared/paths';
import { yieldToUI } from '../../shared/yield';
import { HOOK_WORDS, GOLDEN_FINGER_WORDS, WORLDVIEW_WORDS } from '../dimension-keywords';
import { GenreDetector, GenreConfigRegistry } from '../genre';
import type { GenreConfig, WaveRhythmKeywords } from '../genre';
import { createLogger } from '../../shared/logger';


const log = createLogger('CommercialDeconstructor');
export interface GoldenThreeChaptersResult {
  totalScore: number;
  subScores: {
    openingConflict: number;
    infoDensity: number;
    protagonistGoal: number;
    goldenFinger: number;
    chapterHooks: number;
  };
  improvementSuggestions: {
    category: string;
    severity: 'high' | 'medium' | 'low';
    suggestion: string;
    location?: string;
  }[];
  details: {
    firstChapter: {
      wordCount: number;
      conflictDensity: number;
      hookStrength: number;
      infoOverloadRisk: boolean;
    };
    secondChapter: {
      wordCount: number;
      goalClarity: number;
      goldenFingerHint: boolean;
      hookStrength: number;
    };
    thirdChapter: {
      wordCount: number;
      miniClimax: boolean;
      goldenFingerReveal: boolean;
      hookStrength: number;
    };
  };
}

export interface WaveRhythmResult {
  complianceRate: number;
  smallCoolPointInterval: number;
  mediumReversalInterval: number;
  bigClimaxInterval: number;
  violations: Array<{
    type: 'small_cool' | 'medium_reversal' | 'big_climax';
    startChapter: number;
    endChapter: number;
    gap: number;
    threshold: number;
  }>;
}

export interface CommercialAnalysisResult {
  goldenThreeChapters: GoldenThreeChaptersResult;
  waveRhythm?: WaveRhythmResult;
  overallScore: number;
  overallLevel: 'S' | 'A' | 'B' | 'C' | 'D';
}

const GOAL_WORDS = [
  '想要', '必须', '决定', '目标', '誓言', '发誓', '一定要', '决心', '立志', '誓要',
  '抱负', '理想', '追求', '渴望', '希望', '期望', '立志于', '下定决心', '立下誓言',
  '不惜一切', '无论如何', '不管怎样', '非要', '偏要', '就是要', '绝不能', '决不放弃'
];

const CONFLICT_WORDS = [
  '冲突', '对抗', '矛盾', '危机', '危险', '威胁', '挑战', '对决', '决战', '生死',
  '战斗', '争斗', '斗争', '厮杀', '决斗', '冲突', '对立', '抗衡', '较量', '角逐',
  '愤怒', '仇恨', '敌意', '嫉妒', '怨恨', '暴怒', '震怒', '怒斥', '怒吼', '咆哮',
  '打', '杀', '砍', '劈', '刺', '冲', '退', '躲', '挡', '攻',
  '危机', '危险', '威胁', '挑战', '千钧一发', '危在旦夕', '岌岌可危', '剑拔弩张', '一触即发'
];

const ACTION_VERBS = [
  '冲', '打', '杀', '砍', '劈', '撞', '跃', '跳', '跑', '追',
  '逃', '躲', '闪', '挡', '攻', '防', '击', '踢', '摔', '推',
  '拉', '抓', '捏', '握', '挥', '斩', '刺', '砸', '甩', '扑'
];

/**
 * 通用兜底 waveRhythm 关键词（跨题材通用，按"爽点/反转/高潮"三类划分）。
 *
 * 题材相关词（如修仙"突破/渡劫"、言情"告白/破镜重圆"、悬疑"破案/真相大白"）
 * 通过 genre.json 的 waveRhythmKeywords 字段注入，由 mergeGenreWaveRhythmWords
 * 在题材识别后动态合并到 smallCoolSet/mediumReversalSet/bigClimaxSet。
 *
 * 合并策略：题材词 + 通用词（并集，保留通用词保证基础覆盖）。
 */
const SMALL_COOL_WORDS = [
  '胜利', '胜', '赢', '成功', '突破', '震惊', '震撼', '爽', '痛快', '酣畅',
  '大笑', '大笑道', '畅快', '痛快', '得意', '傲然', '冷笑', '冷哼', '嘲讽',
  '打脸', '反击', '反杀', '逆袭', '碾压', '秒杀', '一招', '一击', '一拳'
];

const MEDIUM_REVERSAL_WORDS = [
  '反转', '逆转', '不料', '谁知', '哪知', '岂知', '岂料', '没想到', '未曾想',
  '突然', '忽然', '陡然', '骤然', '猛然', '霎时', '瞬息', '瞬变', '变故',
  '意外', '失算', '中计', '陷阱', '埋伏', '圈套', '暗算', '反间', '内奸'
];

const BIG_CLIMAX_WORDS = [
  '决战', '决战时刻', '最终', '终极', '巅峰', '高潮', '生死', '生死关头',
  '绝境', '绝地', '背水一战', '孤注一掷', '破釜沉舟', '一决高下', '一决生死',
  '总攻', '全军出击', '大决战', '大战', '血战', '激战', '惨烈', '溃败', '全军覆没'
];

// waveRhythm 期望间隔（章）
const EXPECTED_SMALL_INTERVAL = 2;
const EXPECTED_MEDIUM_INTERVAL = 5;
const EXPECTED_BIG_INTERVAL = 15;

export class CommercialDeconstructor {
  private vectorEnhancer: any;
  private suspenseSet: Set<string>;
  private foreshadowSet: Set<string>;
  private conflictSet: Set<string>;
  private goldenFingerSet: Set<string>;
  private worldviewSet: Set<string>;
  private goalSet: Set<string>;
  private conflictWordSet: Set<string>;
  private actionVerbSet: Set<string>;
  private smallCoolSet: Set<string>;
  private mediumReversalSet: Set<string>;
  private bigClimaxSet: Set<string>;
  // 题材自适应配置（由构造函数注入或 analyze 时自动识别）
  private adaptiveGenreConfig: GenreConfig | null;

  constructor(vectorEnhancer?: any, genreConfig?: GenreConfig) {
    this.vectorEnhancer = vectorEnhancer;
    this.suspenseSet = new Set(HOOK_WORDS.suspense);
    this.foreshadowSet = new Set(HOOK_WORDS.foreshadow);
    this.conflictSet = new Set(HOOK_WORDS.conflict);
    this.goldenFingerSet = new Set(GOLDEN_FINGER_WORDS);
    this.goalSet = new Set(GOAL_WORDS);
    this.conflictWordSet = new Set(CONFLICT_WORDS);
    this.actionVerbSet = new Set(ACTION_VERBS);
    this.smallCoolSet = new Set(SMALL_COOL_WORDS);
    this.mediumReversalSet = new Set(MEDIUM_REVERSAL_WORDS);
    this.bigClimaxSet = new Set(BIG_CLIMAX_WORDS);
    this.adaptiveGenreConfig = genreConfig ?? null;

    // 若构造时已注入 genreConfig，立即合并题材冲突词与 waveRhythm 词到对应 Set
    if (this.adaptiveGenreConfig) {
      this.mergeGenreConflictWords(this.adaptiveGenreConfig);
      this.mergeGenreWaveRhythmWords(this.adaptiveGenreConfig);
    }

    const allWorldviewWords = [
      ...WORLDVIEW_WORDS.system,
      ...WORLDVIEW_WORDS.geography,
      ...WORLDVIEW_WORDS.faction,
      ...WORLDVIEW_WORDS.rule
    ];
    this.worldviewSet = new Set(allWorldviewWords);
  }

  /**
   * 将 genreConfig.conflictKeywords 合并到 conflictWordSet，扩展冲突词列表。
   * 幂等：重复调用不会重复添加（Set 去重）。
   */
  private mergeGenreConflictWords(config: GenreConfig): void {
    if (!config || !Array.isArray(config.conflictKeywords)) return;
    for (const word of config.conflictKeywords) {
      if (word && word.length > 0) {
        this.conflictWordSet.add(word);
      }
    }
  }

  /**
   * 将 genreConfig.waveRhythmKeywords 合并到 smallCoolSet/mediumReversalSet/bigClimaxSet。
   * 题材相关爽点/反转/高潮词追加到通用兜底集合，保留通用词保证基础覆盖。
   * 幂等：Set 去重。
   */
  private mergeGenreWaveRhythmWords(config: GenreConfig): void {
    if (!config || !config.waveRhythmKeywords) return;
    const wave: WaveRhythmKeywords = config.waveRhythmKeywords;
    if (Array.isArray(wave.smallCool)) {
      for (const word of wave.smallCool) {
        if (word && word.length > 0) this.smallCoolSet.add(word);
      }
    }
    if (Array.isArray(wave.mediumReversal)) {
      for (const word of wave.mediumReversal) {
        if (word && word.length > 0) this.mediumReversalSet.add(word);
      }
    }
    if (Array.isArray(wave.bigClimax)) {
      for (const word of wave.bigClimax) {
        if (word && word.length > 0) this.bigClimaxSet.add(word);
      }
    }
  }

  async analyze(text: string): Promise<CommercialAnalysisResult> {
    if (!text || text.length === 0) {
      return this.getEmptyResult();
    }

    // 若构造时未注入 genreConfig，自动识别题材并合并冲突词与 waveRhythm 词
    if (!this.adaptiveGenreConfig) {
      const detected = new GenreDetector().detect(text);
      const config = GenreConfigRegistry.getInstance().getGenreConfig(detected.genreId);
      this.adaptiveGenreConfig = config;
      this.mergeGenreConflictWords(config);
      this.mergeGenreWaveRhythmWords(config);
    }

    const goldenThreeChapters = this.validateGoldenThreeChapters(text);
    await yieldToUI();

    const waveRhythm = this.validateWaveRhythm(text);
    await yieldToUI();

    const overallScore = this.calculateOverallScore(goldenThreeChapters, waveRhythm);
    const overallLevel = this.calculateOverallLevel(overallScore);

    return {
      goldenThreeChapters,
      waveRhythm,
      overallScore: this.round2(overallScore),
      overallLevel
    };
  }

  async analyzeWithVector(text: string): Promise<CommercialAnalysisResult> {
    const baseResult = await this.analyze(text);
    await yieldToUI();

    if (!this.vectorEnhancer || !text || text.length === 0) {
      return baseResult;
    }

    try {
      const available = await this.vectorEnhancer.isAvailable();
      if (!available) {
        log.warn('[CommercialDeconstructor] 向量模型不可用，返回纯统计结果');
        return baseResult;
      }
    } catch (e) {
      log.warn('[CommercialDeconstructor] 向量增强不可用，降级为纯统计', e);
      return baseResult;
    }

    return baseResult;
  }

  async saveAnalysisToMarkdown(
    app: { vault: { adapter: { exists: (p: string) => Promise<boolean>; mkdir: (p: string) => Promise<void>; write: (p: string, d: string) => Promise<void> } } },
    bookName: string,
    result: CommercialAnalysisResult,
    baseDir?: string
  ): Promise<void> {
    const filePath = kbBookCommercialAnalysisFile(bookName, baseDir);

    const frontmatter = this.buildFrontmatter(result);
    const body = this.buildMarkdownBody(result, bookName);
    const content = `---\n${frontmatter}\n---\n\n${body}`;

    const dirPath = filePath.substring(0, filePath.lastIndexOf('/'));
    if (!(await app.vault.adapter.exists(dirPath))) {
      await app.vault.adapter.mkdir(dirPath);
    }

    await app.vault.adapter.write(filePath, content);
  }

  validateGoldenThreeChapters(text: string): GoldenThreeChaptersResult {
    const chapters = this.splitChapters(text);
    const firstThreeChapters = chapters.slice(0, 3);

    if (firstThreeChapters.length === 0) {
      return this.getEmptyGoldenThreeChaptersResult();
    }

    const chapterTexts: string[] = [];
    for (let i = 0; i < Math.min(3, chapters.length); i++) {
      const ch = chapters[i];
      chapterTexts.push(text.slice(ch.startIndex, ch.endIndex));
    }

    while (chapterTexts.length < 3) {
      chapterTexts.push('');
    }

    const openingConflict = this.calculateOpeningConflict(chapterTexts[0]);
    const infoDensity = this.calculateInfoDensity(chapterTexts);
    const protagonistGoal = this.calculateProtagonistGoal(chapterTexts);
    const goldenFinger = this.calculateGoldenFinger(chapterTexts);
    const chapterHooks = this.calculateChapterHooks(chapterTexts);

    const totalScore = 0.2 * openingConflict + 0.15 * infoDensity 
      + 0.2 * protagonistGoal + 0.25 * goldenFinger + 0.2 * chapterHooks;

    const improvementSuggestions = this.generateImprovementSuggestions({
      openingConflict,
      infoDensity,
      protagonistGoal,
      goldenFinger,
      chapterHooks
    });

    const details = this.buildChapterDetails(chapterTexts, {
      openingConflict,
      infoDensity,
      protagonistGoal,
      goldenFinger,
      chapterHooks
    });

    return {
      totalScore: this.round2(totalScore),
      subScores: {
        openingConflict: this.round2(openingConflict),
        infoDensity: this.round2(infoDensity),
        protagonistGoal: this.round2(protagonistGoal),
        goldenFinger: this.round2(goldenFinger),
        chapterHooks: this.round2(chapterHooks)
      },
      improvementSuggestions,
      details
    };
  }

  validateWaveRhythm(text: string, rhythmResult?: any): WaveRhythmResult {
    if (!text || text.length === 0) {
      return {
        complianceRate: 0,
        smallCoolPointInterval: 0,
        mediumReversalInterval: 0,
        bigClimaxInterval: 0,
        violations: []
      };
    }

    const chapters = this.splitChapters(text);
    if (chapters.length === 0) {
      return {
        complianceRate: 0,
        smallCoolPointInterval: 0,
        mediumReversalInterval: 0,
        bigClimaxInterval: 0,
        violations: []
      };
    }

    // 统计每章三类关键词命中数
    const smallHits: number[] = [];
    const mediumHits: number[] = [];
    const bigHits: number[] = [];

    for (const ch of chapters) {
      const chapterText = text.slice(ch.startIndex, ch.endIndex);
      smallHits.push(this.countKeywordHits(chapterText, this.smallCoolSet));
      mediumHits.push(this.countKeywordHits(chapterText, this.mediumReversalSet));
      bigHits.push(this.countKeywordHits(chapterText, this.bigClimaxSet));
    }

    // 命中阈值：每章命中数 >= 1 视为"该章有此类型节奏点"
    // 阈值取 1 而非更高，保证短章节样本也能识别（紫川前 20000 字可能只有 2-3 章）
    const SMALL_THRESHOLD = 1;
    const MEDIUM_THRESHOLD = 1;
    const BIG_THRESHOLD = 1;

    const smallChapters = smallHits.filter(h => h >= SMALL_THRESHOLD).length;
    const mediumChapters = mediumHits.filter(h => h >= MEDIUM_THRESHOLD).length;
    const bigChapters = bigHits.filter(h => h >= BIG_THRESHOLD).length;

    const totalChapters = chapters.length;

    // 间隔 = 总章节数 / 命中章节数（命中章节数为 0 时返回 0）
    const smallInterval = smallChapters > 0 ? this.round2(totalChapters / smallChapters) : 0;
    const mediumInterval = mediumChapters > 0 ? this.round2(totalChapters / mediumChapters) : 0;
    const bigInterval = bigChapters > 0 ? this.round2(totalChapters / bigChapters) : 0;

    // 合规度 = min(1, 命中章节数 / 期望章节数)
    // 期望章节数 = max(1, 总章节数 / 期望间隔)
    const expectedSmall = Math.max(1, totalChapters / EXPECTED_SMALL_INTERVAL);
    const expectedMedium = Math.max(1, totalChapters / EXPECTED_MEDIUM_INTERVAL);
    const expectedBig = Math.max(1, totalChapters / EXPECTED_BIG_INTERVAL);

    const smallCompliance = Math.min(1, smallChapters / expectedSmall);
    const mediumCompliance = Math.min(1, mediumChapters / expectedMedium);
    const bigCompliance = Math.min(1, bigChapters / expectedBig);

    // 综合 complianceRate = 三类合规度平均
    const complianceRate = this.round2(
      (smallCompliance + mediumCompliance + bigCompliance) / 3
    );

    return {
      complianceRate,
      smallCoolPointInterval: smallInterval,
      mediumReversalInterval: mediumInterval,
      bigClimaxInterval: bigInterval,
      violations: []
    };
  }

  /**
   * 统计关键词集合在文本中的总命中次数。
   */
  private countKeywordHits(text: string, wordSet: Set<string>): number {
    let total = 0;
    for (const word of wordSet) {
      if (!word) continue;
      let idx = 0;
      while ((idx = text.indexOf(word, idx)) !== -1) {
        total++;
        idx += word.length;
      }
    }
    return total;
  }

  private calculateOpeningConflict(firstChapterText: string): number {
    if (!firstChapterText || firstChapterText.length === 0) return 0;

    const first300Chars = firstChapterText.slice(0, 300);
    const wordCount = this.countWords(first300Chars);

    let conflictWordCount = 0;
    for (const word of this.conflictWordSet) {
      conflictWordCount += (first300Chars.match(new RegExp(word, 'g')) || []).length;
    }

    let actionVerbCount = 0;
    for (const word of this.actionVerbSet) {
      actionVerbCount += (first300Chars.match(new RegExp(word, 'g')) || []).length;
    }

    const totalConflictWords = conflictWordCount + actionVerbCount;
    const conflictDensity = Math.min(1, totalConflictWords / Math.max(wordCount * 0.05, 1));

    let hookWordCount = 0;
    for (const word of this.suspenseSet) {
      hookWordCount += (first300Chars.match(new RegExp(word, 'g')) || []).length;
    }
    for (const word of this.conflictSet) {
      hookWordCount += (first300Chars.match(new RegExp(word, 'g')) || []).length;
    }
    const hookScore = Math.min(1, hookWordCount / Math.max(wordCount * 0.03, 1));

    return this.clamp01(0.6 * conflictDensity + 0.4 * hookScore) * 100;
  }

  private calculateInfoDensity(chapterTexts: string[]): number {
    const allText = chapterTexts.join('');
    if (!allText || allText.length === 0) return 100;

    const paragraphs = this.splitParagraphs(allText);
    let overloadParagraphs = 0;

    for (const para of paragraphs) {
      let settingWordCount = 0;
      for (const word of this.worldviewSet) {
        if (para.includes(word)) {
          settingWordCount += (para.match(new RegExp(word, 'g')) || []).length;
        }
      }
      if (settingWordCount > 5) {
        overloadParagraphs++;
      }
    }

    const totalParagraphs = Math.max(paragraphs.length, 1);
    const overloadRatio = overloadParagraphs / totalParagraphs;
    const overloadDegree = overloadRatio * 10;

    return this.clamp01(1 - Math.min(1, overloadDegree * 0.2)) * 100;
  }

  private calculateProtagonistGoal(chapterTexts: string[]): number {
    let goalFound = false;
    let goalChapter = -1;
    let goalClarity = 0;

    for (let i = 0; i < chapterTexts.length; i++) {
      const chapterText = chapterTexts[i];
      if (!chapterText || chapterText.length === 0) continue;

      let goalWordCount = 0;
      for (const word of this.goalSet) {
        goalWordCount += (chapterText.match(new RegExp(word, 'g')) || []).length;
      }

      if (goalWordCount > 0) {
        goalFound = true;
        if (goalChapter === -1) {
          goalChapter = i;
        }
        const wordCount = this.countWords(chapterText);
        goalClarity = Math.max(goalClarity, Math.min(1, goalWordCount / Math.max(wordCount * 0.01, 1)));
      }
    }

    if (!goalFound) {
      return 20;
    }

    let timingBonus = 0;
    if (goalChapter === 0) {
      timingBonus = 30;
    } else if (goalChapter === 1) {
      timingBonus = 20;
    } else if (goalChapter === 2) {
      timingBonus = 10;
    }

    const baseScore = goalClarity * 70;
    return this.clamp01((baseScore + timingBonus) / 100) * 100;
  }

  private calculateGoldenFinger(chapterTexts: string[]): number {
    let gfFound = false;
    let gfChapter = -1;
    let gfStrength = 0;
    let gfTypeCount = 0;

    const gfCategories = [
      { type: 'system', words: ['系统', '签到', '任务', '奖励', '积分', '兑换', '商城', '面板', '属性', '技能', '叮', '宿主'] },
      { type: 'rebirth', words: ['重生', '穿越', '转世', '重生回到', '穿越到'] },
      { type: 'bloodline', words: ['血脉', '天赋', '体质', '灵根', '传承'] },
      { type: 'item', words: ['老爷爷', '戒指', '玉佩', '空间', '法宝', '神器'] },
      { type: 'power', words: ['异能', '超能力', '金手指', '外挂', '作弊', '主角光环'] }
    ];

    for (let i = 0; i < chapterTexts.length; i++) {
      const chapterText = chapterTexts[i];
      if (!chapterText || chapterText.length === 0) continue;

      let chapterGfCount = 0;
      let chapterTypeCount = 0;

      for (const category of gfCategories) {
        let categoryFound = false;
        for (const word of category.words) {
          const count = (chapterText.match(new RegExp(word, 'g')) || []).length;
          if (count > 0) {
            chapterGfCount += count;
            if (!categoryFound) {
              chapterTypeCount++;
              categoryFound = true;
            }
          }
        }
      }

      if (chapterGfCount > 0) {
        gfFound = true;
        if (gfChapter === -1) {
          gfChapter = i;
        }
        const wordCount = this.countWords(chapterText);
        const strength = Math.min(1, chapterGfCount / Math.max(wordCount * 0.02, 1));
        gfStrength = Math.max(gfStrength, strength);
        gfTypeCount = Math.max(gfTypeCount, chapterTypeCount);
      }
    }

    if (!gfFound) {
      return 10;
    }

    let timingBonus = 0;
    if (gfChapter === 0) {
      timingBonus = 35;
    } else if (gfChapter === 1) {
      timingBonus = 25;
    } else if (gfChapter === 2) {
      timingBonus = 15;
    }

    const typeBonus = Math.min(15, gfTypeCount * 5);
    const baseScore = gfStrength * 50;

    return this.clamp01((baseScore + timingBonus + typeBonus) / 100) * 100;
  }

  private calculateChapterHooks(chapterTexts: string[]): number {
    let totalHookStrength = 0;
    let validChapters = 0;

    for (let i = 0; i < chapterTexts.length; i++) {
      const chapterText = chapterTexts[i];
      if (!chapterText || chapterText.length === 0) continue;

      const endRegion = chapterText.slice(-200);
      const wordCount = this.countWords(endRegion);

      const suspenseResult = this.calculateHookIntensity(endRegion, wordCount, this.suspenseSet, 'suspense');
      const foreshadowResult = this.calculateHookIntensity(endRegion, wordCount, this.foreshadowSet, 'foreshadow');
      const conflictResult = this.calculateHookIntensity(endRegion, wordCount, this.conflictSet, 'conflict');

      const results = [suspenseResult, foreshadowResult, conflictResult];
      results.sort((a, b) => b.intensity - a.intensity);

      totalHookStrength += results[0].intensity;
      validChapters++;
    }

    if (validChapters === 0) return 0;

    const avgHookStrength = totalHookStrength / validChapters;
    const chapterBonus = Math.min(validChapters / 3, 1) * 30;

    return this.clamp01((avgHookStrength * 70 + chapterBonus) / 100) * 100;
  }

  private calculateHookIntensity(
    text: string,
    wordCount: number,
    wordSet: Set<string>,
    type: string
  ): { type: string; intensity: number; matchedWords: string[] } {
    const matchedWords: string[] = [];
    let matchCount = 0;

    for (const word of wordSet) {
      if (text.includes(word)) {
        matchedWords.push(word);
        const count = (text.match(new RegExp(word, 'g')) || []).length;
        matchCount += count;
      }
    }

    const keywordDensity = Math.min(1, matchCount / Math.max(wordCount * 0.02, 1));

    const questionMarkCount = (text.match(/[？?]/g) || []).length;
    const exclamationMarkCount = (text.match(/[！!]/g) || []).length;
    const punctuationScore = Math.min(1, (questionMarkCount * 2 + exclamationMarkCount) / Math.max(wordCount * 0.03, 1));

    const textLength = text.length;
    const positionWeights: number[] = [];
    for (const word of matchedWords) {
      let idx = 0;
      while ((idx = text.indexOf(word, idx)) !== -1) {
        const position = idx / Math.max(textLength - 1, 1);
        positionWeights.push(position);
        idx += word.length;
      }
    }

    let positionWeight = 0.5;
    if (positionWeights.length > 0) {
      const avgPosition = positionWeights.reduce((a, b) => a + b, 0) / positionWeights.length;
      positionWeight = avgPosition;
    }

    const intensity = 0.4 * keywordDensity + 0.3 * punctuationScore + 0.3 * positionWeight;

    return { type, intensity, matchedWords: matchedWords.slice(0, 10) };
  }

  private generateImprovementSuggestions(subScores: {
    openingConflict: number;
    infoDensity: number;
    protagonistGoal: number;
    goldenFinger: number;
    chapterHooks: number;
  }): {
    category: string;
    severity: 'high' | 'medium' | 'low';
    suggestion: string;
    location?: string;
  }[] {
    const suggestions: {
      category: string;
      severity: 'high' | 'medium' | 'low';
      suggestion: string;
      location?: string;
    }[] = [];

    const scoreCategories = [
      { key: 'openingConflict', label: '开篇冲突密度', threshold: 70 },
      { key: 'infoDensity', label: '信息密度', threshold: 70 },
      { key: 'protagonistGoal', label: '主角目标清晰度', threshold: 70 },
      { key: 'goldenFinger', label: '金手指吸引力', threshold: 70 },
      { key: 'chapterHooks', label: '章末钩子强度', threshold: 70 }
    ];

    const suggestionTexts: Record<string, string> = {
      openingConflict: '建议在开篇300字内引入更强的冲突和动作场面，使用更多冲突词汇和动词，快速抓住读者注意力',
      infoDensity: '前三章设定信息过多，建议分散到后续章节，先聚焦于主角和核心冲突，世界观设定逐步展开',
      protagonistGoal: '建议在前三章明确主角的目标和动机，让读者知道主角想要什么、为什么要奋斗',
      goldenFinger: '建议在前三章引入金手指或明确主角的特殊优势，金手指出现越早、类型越明确，对读者吸引力越强',
      chapterHooks: '建议在每章结尾设置更强的悬念或冲突钩子，让读者产生继续阅读的欲望'
    };

    for (const { key, label, threshold } of scoreCategories) {
      const score = (subScores as any)[key];
      if (score < threshold) {
        let severity: 'high' | 'medium' | 'low';
        if (score < 40) {
          severity = 'high';
        } else if (score < 70) {
          severity = 'medium';
        } else {
          severity = 'low';
        }

        suggestions.push({
          category: label,
          severity,
          suggestion: suggestionTexts[key],
          location: '前三章'
        });
      }
    }

    suggestions.sort((a, b) => {
      const severityOrder = { high: 0, medium: 1, low: 2 };
      return severityOrder[a.severity] - severityOrder[b.severity];
    });

    return suggestions;
  }

  private buildChapterDetails(
    chapterTexts: string[],
    scores: {
      openingConflict: number;
      infoDensity: number;
      protagonistGoal: number;
      goldenFinger: number;
      chapterHooks: number;
    }
  ): GoldenThreeChaptersResult['details'] {
    const firstChapterText = chapterTexts[0] || '';
    const secondChapterText = chapterTexts[1] || '';
    const thirdChapterText = chapterTexts[2] || '';

    const firstWordCount = this.countWords(firstChapterText);
    const secondWordCount = this.countWords(secondChapterText);
    const thirdWordCount = this.countWords(thirdChapterText);

    let firstChapterConflictDensity = 0;
    if (firstChapterText.length > 0) {
      const first300 = firstChapterText.slice(0, 300);
      let conflictCount = 0;
      for (const word of this.conflictWordSet) {
        conflictCount += (first300.match(new RegExp(word, 'g')) || []).length;
      }
      firstChapterConflictDensity = this.round2(conflictCount / Math.max(firstWordCount * 0.05, 1));
    }

    let firstChapterHookStrength = 0;
    if (firstChapterText.length > 0) {
      const endRegion = firstChapterText.slice(-200);
      const wordCount = this.countWords(endRegion);
      const result = this.calculateHookIntensity(endRegion, wordCount, this.conflictSet, 'conflict');
      firstChapterHookStrength = this.round2(result.intensity);
    }

    let infoOverloadRisk = false;
    const allText = chapterTexts.join('');
    const paragraphs = this.splitParagraphs(allText);
    let overloadCount = 0;
    for (const para of paragraphs) {
      let settingCount = 0;
      for (const word of this.worldviewSet) {
        if (para.includes(word)) settingCount++;
      }
      if (settingCount > 5) overloadCount++;
    }
    infoOverloadRisk = overloadCount > 0;

    let goalClarity = 0;
    if (secondChapterText.length > 0) {
      let goalCount = 0;
      for (const word of this.goalSet) {
        goalCount += (secondChapterText.match(new RegExp(word, 'g')) || []).length;
      }
      goalClarity = this.round2(goalCount / Math.max(secondWordCount * 0.01, 1));
    }

    let goldenFingerHint = false;
    let goldenFingerReveal = false;
    for (let i = 0; i < 2; i++) {
      const text = chapterTexts[i] || '';
      for (const word of this.goldenFingerSet) {
        if (text.includes(word)) {
          if (i === 0) {
            goldenFingerHint = true;
            goldenFingerReveal = true;
          } else {
            goldenFingerHint = true;
          }
          break;
        }
      }
      if (goldenFingerReveal) break;
    }

    let secondChapterHookStrength = 0;
    if (secondChapterText.length > 0) {
      const endRegion = secondChapterText.slice(-200);
      const wordCount = this.countWords(endRegion);
      const result = this.calculateHookIntensity(endRegion, wordCount, this.suspenseSet, 'suspense');
      secondChapterHookStrength = this.round2(result.intensity);
    }

    let thirdChapterHookStrength = 0;
    if (thirdChapterText.length > 0) {
      const endRegion = thirdChapterText.slice(-200);
      const wordCount = this.countWords(endRegion);
      const result = this.calculateHookIntensity(endRegion, wordCount, this.conflictSet, 'conflict');
      thirdChapterHookStrength = this.round2(result.intensity);
    }

    let miniClimax = false;
    if (thirdChapterText.length > 0) {
      let conflictCount = 0;
      for (const word of this.conflictWordSet) {
        conflictCount += (thirdChapterText.match(new RegExp(word, 'g')) || []).length;
      }
      miniClimax = conflictCount > 10;
    }

    return {
      firstChapter: {
        wordCount: firstWordCount,
        conflictDensity: firstChapterConflictDensity,
        hookStrength: firstChapterHookStrength,
        infoOverloadRisk
      },
      secondChapter: {
        wordCount: secondWordCount,
        goalClarity,
        goldenFingerHint,
        hookStrength: secondChapterHookStrength
      },
      thirdChapter: {
        wordCount: thirdWordCount,
        miniClimax,
        goldenFingerReveal,
        hookStrength: thirdChapterHookStrength
      }
    };
  }

  private calculateOverallScore(
    golden: GoldenThreeChaptersResult,
    wave?: WaveRhythmResult
  ): number {
    let score = golden.totalScore;
    if (wave && wave.complianceRate > 0) {
      score = score * 0.7 + wave.complianceRate * 100 * 0.3;
    }
    return score;
  }

  private calculateOverallLevel(score: number): 'S' | 'A' | 'B' | 'C' | 'D' {
    if (score >= 90) return 'S';
    if (score >= 80) return 'A';
    if (score >= 70) return 'B';
    if (score >= 60) return 'C';
    return 'D';
  }

  private getEmptyResult(): CommercialAnalysisResult {
    return {
      goldenThreeChapters: this.getEmptyGoldenThreeChaptersResult(),
      waveRhythm: {
        complianceRate: 0,
        smallCoolPointInterval: 0,
        mediumReversalInterval: 0,
        bigClimaxInterval: 0,
        violations: []
      },
      overallScore: 0,
      overallLevel: 'D'
    };
  }

  private getEmptyGoldenThreeChaptersResult(): GoldenThreeChaptersResult {
    return {
      totalScore: 0,
      subScores: {
        openingConflict: 0,
        infoDensity: 0,
        protagonistGoal: 0,
        goldenFinger: 0,
        chapterHooks: 0
      },
      improvementSuggestions: [],
      details: {
        firstChapter: {
          wordCount: 0,
          conflictDensity: 0,
          hookStrength: 0,
          infoOverloadRisk: false
        },
        secondChapter: {
          wordCount: 0,
          goalClarity: 0,
          goldenFingerHint: false,
          hookStrength: 0
        },
        thirdChapter: {
          wordCount: 0,
          miniClimax: false,
          goldenFingerReveal: false,
          hookStrength: 0
        }
      }
    };
  }

  private splitChapters(text: string): { startIndex: number; endIndex: number; index: number }[] {
    const chapters: { startIndex: number; endIndex: number; index: number }[] = [];

    // 检测是否存在"第N章"格式：若存在则"节"为章内子单位（如紫川"第一章+第一节"层级），
    // 不应作为分章点；若不存在"章"只有"节"，则"节"作为顶级章节单位
    const hasChapter = /^第[一二三四五六七八九十百千零\d]+章/m.test(text);
    const unitChars = hasChapter ? '章部卷回折' : '章节部卷回折';
    const chapterRegex = new RegExp(`^第[一二三四五六七八九十百千零\\d]+[${unitChars}]`, 'gm');

    let match;
    let index = 0;

    while ((match = chapterRegex.exec(text)) !== null) {
      if (chapters.length > 0) {
        chapters[chapters.length - 1].endIndex = match.index;
      }
      chapters.push({
        startIndex: match.index,
        endIndex: text.length,
        index: index++
      });
    }

    return chapters;
  }

  private splitParagraphs(text: string): string[] {
    return text
      .split(/\r?\n\r?\n/)
      .map(p => p.trim())
      .filter(p => p.length > 0);
  }

  private countWords(text: string): number {
    let count = 0;
    let i = 0;

    while (i < text.length) {
      const char = text[i];
      if (this.isChineseChar(char)) {
        count++;
        i++;
      } else if (this.isEnglishLetter(char)) {
        let j = i;
        while (j < text.length && (this.isEnglishLetter(text[j]) || text[j] === "'" || text[j] === '-')) {
          j++;
        }
        if (j > i) count++;
        i = j;
      } else if (this.isDigit(char)) {
        let j = i;
        while (j < text.length && (this.isDigit(text[j]) || text[j] === '.' || text[j] === ',')) {
          j++;
        }
        if (j > i) count++;
        i = j;
      } else {
        i++;
      }
    }

    return Math.max(count, 1);
  }

  private isChineseChar(char: string): boolean {
    const code = char.charCodeAt(0);
    return code >= 0x4E00 && code <= 0x9FFF;
  }

  private isEnglishLetter(char: string): boolean {
    const code = char.charCodeAt(0);
    return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
  }

  private isDigit(char: string): boolean {
    const code = char.charCodeAt(0);
    return code >= 48 && code <= 57;
  }

  private clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
  }

  private round2(value: number): number {
    return Math.round(value * 100) / 100;
  }

  private buildFrontmatter(result: CommercialAnalysisResult): string {
    const data = {
      overallScore: result.overallScore,
      overallLevel: result.overallLevel,
      goldenThreeChapters: {
        totalScore: result.goldenThreeChapters.totalScore,
        subScores: result.goldenThreeChapters.subScores,
        improvementSuggestions: result.goldenThreeChapters.improvementSuggestions,
        details: result.goldenThreeChapters.details
      },
      waveRhythm: result.waveRhythm
    };
    return JSON.stringify(data, null, 2);
  }

  private buildMarkdownBody(result: CommercialAnalysisResult, bookName: string): string {
    const lines: string[] = [];

    lines.push(`# ${bookName} - 商业可行性分析报告`);
    lines.push('');

    lines.push('## 商业可行性总评');
    lines.push('');
    lines.push(`- 综合得分：**${result.overallScore}**`);
    lines.push(`- 综合等级：**${result.overallLevel}**`);
    lines.push('');

    lines.push('## 黄金三章分析');
    lines.push('');
    lines.push(`- 黄金三章总分：**${result.goldenThreeChapters.totalScore}**`);
    lines.push('');

    lines.push('### 五项子分');
    lines.push('');
    
    const subScoreItems = [
      { label: '开篇冲突密度', score: result.goldenThreeChapters.subScores.openingConflict, weight: '20%' },
      { label: '信息密度/过载检测', score: result.goldenThreeChapters.subScores.infoDensity, weight: '15%' },
      { label: '主角目标清晰度', score: result.goldenThreeChapters.subScores.protagonistGoal, weight: '20%' },
      { label: '金手指吸引力', score: result.goldenThreeChapters.subScores.goldenFinger, weight: '25%' },
      { label: '章末钩子强度', score: result.goldenThreeChapters.subScores.chapterHooks, weight: '20%' }
    ];

    for (const item of subScoreItems) {
      const barLength = Math.floor(item.score / 10);
      const bar = '█'.repeat(barLength) + '░'.repeat(10 - barLength);
      lines.push(`- ${item.label}（权重${item.weight}）：${item.score} 分`);
      lines.push(`  \`${bar}\``);
    }
    lines.push('');

    lines.push('### 改进建议');
    lines.push('');
    if (result.goldenThreeChapters.improvementSuggestions.length === 0) {
      lines.push('黄金三章表现优秀，暂无改进建议');
    } else {
      lines.push('| 严重程度 | 类别 | 建议 | 位置 |');
      lines.push('|----------|------|------|------|');
      for (const sug of result.goldenThreeChapters.improvementSuggestions) {
        const severityLabel = sug.severity === 'high' ? '🔴 高' : sug.severity === 'medium' ? '🟡 中' : '🟢 低';
        lines.push(`| ${severityLabel} | ${sug.category} | ${sug.suggestion} | ${sug.location || '-'} |`);
      }
    }
    lines.push('');

    lines.push('### 各章详情');
    lines.push('');
    lines.push('| 章节 | 字数 | 冲突密度 | 钩子强度 | 备注 |');
    lines.push('|------|------|----------|----------|------|');
    
    const d = result.goldenThreeChapters.details;
    lines.push(`| 第一章 | ${d.firstChapter.wordCount} | ${d.firstChapter.conflictDensity} | ${d.firstChapter.hookStrength} | ${d.firstChapter.infoOverloadRisk ? '⚠️ 信息过载风险' : '✅ 正常'} |`);
    lines.push(`| 第二章 | ${d.secondChapter.wordCount} | - | ${d.secondChapter.hookStrength} | 目标清晰度: ${d.secondChapter.goalClarity}${d.secondChapter.goldenFingerHint ? ' / 💡 金手指暗示' : ''} |`);
    lines.push(`| 第三章 | ${d.thirdChapter.wordCount} | - | ${d.thirdChapter.hookStrength} | ${d.thirdChapter.miniClimax ? '🎯 有小高潮' : ''}${d.thirdChapter.goldenFingerReveal ? ' / ✨ 金手指揭示' : ''} |`);
    lines.push('');

    lines.push('## 波浪节奏验证');
    lines.push('');
    if (result.waveRhythm) {
      lines.push(`- 合规率：**${(result.waveRhythm.complianceRate * 100).toFixed(1)}%**`);
      lines.push(`- 平均小爽点间隔：**${result.waveRhythm.smallCoolPointInterval}** 章`);
      lines.push(`- 平均中型反转间隔：**${result.waveRhythm.mediumReversalInterval}** 章`);
      lines.push(`- 平均大型高潮间隔：**${result.waveRhythm.bigClimaxInterval}** 章`);
      lines.push('');
      
      lines.push('### 违规列表');
      lines.push('');
      if (result.waveRhythm.violations.length === 0) {
        lines.push('暂未检测到节奏违规（骨架实现，后续完善）');
      } else {
        lines.push('| 类型 | 起始章节 | 结束章节 | 间隔 | 阈值 |');
        lines.push('|------|----------|----------|------|------|');
        for (const v of result.waveRhythm.violations) {
          const typeLabel = v.type === 'small_cool' ? '小爽点' : v.type === 'medium_reversal' ? '中型反转' : '大型高潮';
          lines.push(`| ${typeLabel} | ${v.startChapter} | ${v.endChapter} | ${v.gap} | ${v.threshold} |`);
        }
      }
    } else {
      lines.push('波浪节奏分析暂不可用');
    }
    lines.push('');

    return lines.join('\n');
  }
}
