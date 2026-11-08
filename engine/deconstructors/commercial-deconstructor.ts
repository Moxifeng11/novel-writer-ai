import { kbBookCommercialAnalysisFile } from '@/shared/paths';
import { isChineseChar } from '@/shared/text-utils';
import { countCjkWordsAndNumbers } from '@/shared/word-count';
import { yieldToUI } from '@/shared/yield';
import { HOOK_WORDS, GOLDEN_FINGER_WORDS, WORLDVIEW_WORDS } from '@/engine/dimension-keywords';
import { GenreDetector, GenreConfigRegistry } from '@/engine/genre';
import type { GenreConfig, WaveRhythmKeywords } from '@/engine/genre';
import { createLogger } from '@/shared/logger';
import { countTotalChars, countWords } from '@/engine/text-segmenter';
import { writeVaultText } from '@/shared/file-system-port';


const log = createLogger('CommercialDeconstructor');
/**
 * 黄金三章分析结果。
 */
export interface GoldenThreeChaptersResult {
  totalScore: number;
  subScores: {
    openingConflict: number;
    infoDensity: number;
    protagonistGoal: number;
    goldenFinger: number;
    chapterHooks: number;
    characterImmersion: number;
    worldviewAttraction: number;
    dialogueQuality: number;
    suspenseIntensity: number;
    emotionalImpact: number;
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

/**
 * 波浪节奏结果。
 */
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

/**
 * 全局分析结果。
 */
export interface GlobalAnalysisResult {
  rhythmBalance: number;
  emotionalFluctuation: number;
  worldviewCompleteness: number;
  characterDiversity: number;
  plotDensity: number;
  readerRetention: number;
  ipValue: number;
  marketCompetitiveness: number;
  subScores: {
    rhythmBalance: number;
    emotionalFluctuation: number;
    worldviewCompleteness: number;
    characterDiversity: number;
    plotDensity: number;
  };
}

/**
 * 商业性分析结果。
 */
export interface CommercialAnalysisResult {
  goldenThreeChapters: GoldenThreeChaptersResult;
  waveRhythm?: WaveRhythmResult;
  globalAnalysis?: GlobalAnalysisResult;
  overallScore: number;
  overallLevel: 'S' | 'A' | 'B' | 'C' | 'D';
  wordCount?: {
    total: number;
    chineseOnly: number;
    platformStyle: number;
  };
  aggregation?: {
    segmentCount: number;
    weightingStrategy: 'equal';
    dataStatus: 'complete' | 'partial';
  };
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

const EMOTION_WORDS = [
  '心痛', '心碎', '难过', '悲伤', '哀伤', '痛苦', '绝望', '崩溃', '哭泣', '落泪',
  '愤怒', '暴怒', '震怒', '愤慨', '愤恨', '仇恨', '恨意', '咬牙切齿', '怒不可遏',
  '感动', '温暖', '欣慰', '开心', '喜悦', '狂喜', '兴奋', '激动', '热血沸腾',
  '心酸', '委屈', '不甘', '遗憾', '后悔', '愧疚', '羞愧', '难堪', '尴尬',
  '害怕', '恐惧', '惊恐', '慌张', '紧张', '焦虑', '担忧', '不安', '忐忑'
];

const DIALOGUE_MARKERS = [
  '道：', '说：', '说道：', '喊道：', '叫道：', '喝道：', '冷声：', '冷笑：',
  '问：', '问道：', '答：', '答道：', '回应：', '回答：', '低语：', '喃喃：',
  '"', '"', '「', '」', '『', '』'
];

const IMMERSION_WORDS = [
  '我', '自己', '亲身', '亲眼', '亲手', '亲自', '当下', '此刻', '如今', '现在',
  '心中', '心里', '内心', '心底', '心思', '念头', '想法', '感受', '感觉',
  '仿佛', '犹如', '好像', '就像', '如同', '宛若', '好似', '恰似'
];

const SUSPENSE_WORDS = [
  '究竟', '到底', '竟然', '居然', '难道', '莫非', '岂知', '哪知', '谁知',
  '不料', '想不到', '没想到', '未曾想', '匪夷所思', '不可思议', '难以置信',
  '秘密', '谜团', '疑惑', '困惑', '不解', '奇怪', '诡异', '神秘', '悬疑',
  '真相', '谜底', '揭开', '浮现', '显露', '露出', '端倪', '线索', '蛛丝马迹'
];

// waveRhythm 期望间隔（章）
const EXPECTED_SMALL_INTERVAL = 2;
const EXPECTED_MEDIUM_INTERVAL = 5;
const EXPECTED_BIG_INTERVAL = 15;

/**
 * 向量增强器的最小契约：商业拆解器只做可用性探测与降级，
 * 不直接消费检索结果（避免把宿主实现细节带进 engine）。
 */
export interface VectorEnhancerPort {
  isAvailable(): Promise<boolean>;
}

/**
 * 商业拆解器：黄金三章、波浪节奏与全局分析。
 */
export class CommercialDeconstructor {
  private vectorEnhancer?: VectorEnhancerPort;
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
  private emotionSet: Set<string>;
  private immersionSet: Set<string>;
  private suspenseSet2: Set<string>;
  // 题材自适应配置（由构造函数注入或 analyze 时自动识别）
  private adaptiveGenreConfig: GenreConfig | null;

  constructor(vectorEnhancer?: VectorEnhancerPort, genreConfig?: GenreConfig) {
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
    this.emotionSet = new Set(EMOTION_WORDS);
    this.immersionSet = new Set(IMMERSION_WORDS);
    this.suspenseSet2 = new Set(SUSPENSE_WORDS);
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

  /**
   * 分析。
   * @param text - 文本内容
    * @returns CommercialAnalysisResult 实例
   */
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

    const globalAnalysis = this.analyzeGlobalMetrics(text);
    await yieldToUI();

    const overallScore = this.calculateOverallScore(goldenThreeChapters, waveRhythm, globalAnalysis);
    const overallLevel = this.calculateOverallLevel(overallScore);

    const wordCount = {
      total: countTotalChars(text),
      chineseOnly: countWords(text, 'chinese_only'),
      platformStyle: countWords(text, 'platform')
    };

    const safeOverallScore = (text && text.trim().length > 0 && overallScore < 1)
      ? 26
      : this.round2(overallScore);

    return {
      goldenThreeChapters,
      waveRhythm,
      globalAnalysis,
      overallScore: safeOverallScore,
      overallLevel,
      wordCount
    };
  }

  /**
   * analyzeWithVector 方法。
   * @param text - 文本内容
    * @returns CommercialAnalysisResult 实例
   */
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

  /**
   * saveAnalysisToMarkdown 方法。
   * @param app - Obsidian 应用实例
   * @param bookName - 书名
   * @param result - 结果
   * @param baseDir - 参数值
   */
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

    // 用户可见分析报告：必须走 vault 索引写入，adapter.write 不触发 metadataCache。
    await writeVaultText(app as unknown as import('obsidian').App, filePath, content);
  }

  /**
   * validateGoldenThreeChapters 方法。
   * @param text - 文本内容
    * @returns GoldenThreeChaptersResult 实例
   */
  validateGoldenThreeChapters(text: string): GoldenThreeChaptersResult {
    const chapters = this.splitChapters(text);
    const firstThreeChapters = chapters.slice(0, 3);

    // 无"第N章/节"行首标记时返回空结果（totalScore=0）。
    // 非空文本的全零兜底由 analyze() 的 safeOverallScore 与聚合器 combineCommercialResults 统一处理，
    // 此处保持"无法分章即空结果"的契约，避免误判正文中的数字片段为章节。
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
    const characterImmersion = this.calculateCharacterImmersion(chapterTexts);
    const worldviewAttraction = this.calculateWorldviewAttraction(chapterTexts);
    const dialogueQuality = this.calculateDialogueQuality(chapterTexts);
    const suspenseIntensity = this.calculateSuspenseIntensity(chapterTexts);
    const emotionalImpact = this.calculateEmotionalImpact(chapterTexts);

    // 基线保护：仅当"全部子项算得 0 且原文非空"时，才一次性给保守兜底；
    // 非全 0 的有效结果原样保留其相对高低，避免抹平评分区分度。
    const totalWords = countTotalChars(text);
    const baseChapterCount = Math.max(1, chapters.length);

    const allZero = openingConflict === 0 && infoDensity === 0
      && protagonistGoal === 0 && goldenFinger === 0 && chapterHooks === 0
      && characterImmersion === 0 && worldviewAttraction === 0
      && dialogueQuality === 0 && suspenseIntensity === 0 && emotionalImpact === 0;
    const textNonEmpty = !!(text && text.trim().length > 0);
    const applyFallback = allZero && textNonEmpty;
    if (applyFallback) {
      log.info('goldenThreeChapters 子项全 0 且原文非空，启用一次性保守兜底');
    }

    const safeOpeningConflict = applyFallback ? 30 : openingConflict;
    const safeInfoDensity = applyFallback ? 50 : infoDensity;
    const safeProtagonistGoal = applyFallback ? 20 : protagonistGoal;
    const safeGoldenFinger = applyFallback ? 10 : goldenFinger;
    const safeChapterHooks = applyFallback ? 30 : chapterHooks;
    const safeCharacterImmersion = applyFallback ? 25 : characterImmersion;
    const safeWorldviewAttraction = applyFallback ? 35 : worldviewAttraction;
    const safeDialogueQuality = applyFallback ? 40 : dialogueQuality;
    const safeSuspenseIntensity = applyFallback ? 30 : suspenseIntensity;
    const safeEmotionalImpact = applyFallback ? 20 : emotionalImpact;

    const weights = {
      openingConflict: 0.12,
      infoDensity: 0.08,
      protagonistGoal: 0.12,
      goldenFinger: 0.15,
      chapterHooks: 0.12,
      characterImmersion: 0.10,
      worldviewAttraction: 0.08,
      dialogueQuality: 0.08,
      suspenseIntensity: 0.08,
      emotionalImpact: 0.07
    };

    const totalScore = 
      weights.openingConflict * safeOpeningConflict +
      weights.infoDensity * safeInfoDensity +
      weights.protagonistGoal * safeProtagonistGoal +
      weights.goldenFinger * safeGoldenFinger +
      weights.chapterHooks * safeChapterHooks +
      weights.characterImmersion * safeCharacterImmersion +
      weights.worldviewAttraction * safeWorldviewAttraction +
      weights.dialogueQuality * safeDialogueQuality +
      weights.suspenseIntensity * safeSuspenseIntensity +
      weights.emotionalImpact * safeEmotionalImpact;

    const allSubScores = {
      openingConflict: safeOpeningConflict,
      infoDensity: safeInfoDensity,
      protagonistGoal: safeProtagonistGoal,
      goldenFinger: safeGoldenFinger,
      chapterHooks: safeChapterHooks,
      characterImmersion: safeCharacterImmersion,
      worldviewAttraction: safeWorldviewAttraction,
      dialogueQuality: safeDialogueQuality,
      suspenseIntensity: safeSuspenseIntensity,
      emotionalImpact: safeEmotionalImpact
    };

    const improvementSuggestions = this.generateImprovementSuggestions(allSubScores);

    const details = this.buildChapterDetails(chapterTexts, allSubScores, totalWords, baseChapterCount);

    return {
      totalScore: this.round2(totalScore),
      subScores: {
        openingConflict: this.round2(safeOpeningConflict),
        infoDensity: this.round2(safeInfoDensity),
        protagonistGoal: this.round2(safeProtagonistGoal),
        goldenFinger: this.round2(safeGoldenFinger),
        chapterHooks: this.round2(safeChapterHooks),
        characterImmersion: this.round2(safeCharacterImmersion),
        worldviewAttraction: this.round2(safeWorldviewAttraction),
        dialogueQuality: this.round2(safeDialogueQuality),
        suspenseIntensity: this.round2(safeSuspenseIntensity),
        emotionalImpact: this.round2(safeEmotionalImpact)
      },
      improvementSuggestions,
      details
    };
  }

  /**
   * validateWaveRhythm 方法。
   * @param text - 文本内容
   * @param rhythmResult - 节奏结果
    * @returns WaveRhythmResult 实例
   */
  validateWaveRhythm(text: string, rhythmResult?: unknown): WaveRhythmResult {
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
    const wordCount = countCjkWordsAndNumbers(first300Chars);

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
        const wordCount = countCjkWordsAndNumbers(chapterText);
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
        const wordCount = countCjkWordsAndNumbers(chapterText);
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
      const wordCount = countCjkWordsAndNumbers(endRegion);

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

  private calculateCharacterImmersion(chapterTexts: string[]): number {
    let totalImmersion = 0;
    let validChapters = 0;

    for (let i = 0; i < chapterTexts.length; i++) {
      const chapterText = chapterTexts[i];
      if (!chapterText || chapterText.length === 0) continue;

      const wordCount = countCjkWordsAndNumbers(chapterText);

      let immersionWordCount = 0;
      for (const word of this.immersionSet) {
        immersionWordCount += (chapterText.match(new RegExp(word, 'g')) || []).length;
      }

      const firstPersonCount = (chapterText.match(/我/g) || []).length;
      const innerThoughtCount = (chapterText.match(/心中|心里|内心|心底|暗道|心想/g) || []).length;

      const immersionDensity = Math.min(1, (immersionWordCount + firstPersonCount * 0.5 + innerThoughtCount * 2) / Math.max(wordCount * 0.03, 1));

      const dialogueCount = this.countDialogueLines(chapterText);
      const dialogueRatio = Math.min(1, dialogueCount / Math.max(wordCount * 0.005, 1));

      const chapterImmersion = 0.6 * immersionDensity + 0.4 * dialogueRatio;
      totalImmersion += chapterImmersion;
      validChapters++;
    }

    if (validChapters === 0) return 0;

    const avgImmersion = totalImmersion / validChapters;
    return this.clamp01(avgImmersion) * 100;
  }

  private calculateWorldviewAttraction(chapterTexts: string[]): number {
    const allText = chapterTexts.join('');
    if (!allText || allText.length === 0) return 0;

    const wordCount = countCjkWordsAndNumbers(allText);

    let worldviewWordCount = 0;
    for (const word of this.worldviewSet) {
      worldviewWordCount += (allText.match(new RegExp(word, 'g')) || []).length;
    }

    const worldviewDensity = Math.min(1, worldviewWordCount / Math.max(wordCount * 0.02, 1));

    const categories = ['system', 'geography', 'faction', 'rule'] as const;
    let categoryHit = 0;
    for (const cat of categories) {
      const catWords = WORLDVIEW_WORDS[cat] || [];
      for (const word of catWords) {
        if (allText.includes(word)) {
          categoryHit++;
          break;
        }
      }
    }
    const categoryDiversity = categoryHit / categories.length;

    const properNounCount = this.countProperNouns(allText);
    const properNounDensity = Math.min(1, properNounCount / Math.max(wordCount * 0.01, 1));

    const attractionScore = 0.4 * worldviewDensity + 0.35 * categoryDiversity + 0.25 * properNounDensity;
    return this.clamp01(attractionScore) * 100;
  }

  private calculateDialogueQuality(chapterTexts: string[]): number {
    let totalQuality = 0;
    let validChapters = 0;

    for (let i = 0; i < chapterTexts.length; i++) {
      const chapterText = chapterTexts[i];
      if (!chapterText || chapterText.length === 0) continue;

      const wordCount = countCjkWordsAndNumbers(chapterText);
      const dialogueLines = this.countDialogueLines(chapterText);

      if (dialogueLines === 0) {
        totalQuality += 0.2;
        validChapters++;
        continue;
      }

      const dialogueRatio = Math.min(1, dialogueLines / Math.max(wordCount * 0.008, 1));

      let markerCount = 0;
      for (const marker of DIALOGUE_MARKERS) {
        if (marker.length >= 2) {
          markerCount += (chapterText.match(new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
        }
      }
      const markerDiversity = Math.min(1, markerCount / Math.max(dialogueLines * 0.3, 1));

      let emotionInDialogue = 0;
      const dialogueSegments = this.extractDialogueSegments(chapterText);
      for (const seg of dialogueSegments) {
        for (const word of this.emotionSet) {
          if (seg.includes(word)) {
            emotionInDialogue++;
            break;
          }
        }
      }
      const emotionRatio = dialogueSegments.length > 0 ? Math.min(1, emotionInDialogue / dialogueSegments.length) : 0;

      const quality = 0.35 * dialogueRatio + 0.25 * markerDiversity + 0.4 * emotionRatio;
      totalQuality += quality;
      validChapters++;
    }

    if (validChapters === 0) return 0;

    const avgQuality = totalQuality / validChapters;
    return this.clamp01(avgQuality) * 100;
  }

  private calculateSuspenseIntensity(chapterTexts: string[]): number {
    let totalSuspense = 0;
    let validChapters = 0;

    for (let i = 0; i < chapterTexts.length; i++) {
      const chapterText = chapterTexts[i];
      if (!chapterText || chapterText.length === 0) continue;

      const wordCount = countCjkWordsAndNumbers(chapterText);

      let suspenseWordCount = 0;
      for (const word of this.suspenseSet2) {
        suspenseWordCount += (chapterText.match(new RegExp(word, 'g')) || []).length;
      }

      const suspenseDensity = Math.min(1, suspenseWordCount / Math.max(wordCount * 0.015, 1));

      const questionCount = (chapterText.match(/[？?]/g) || []).length;
      const questionDensity = Math.min(1, questionCount / Math.max(wordCount * 0.005, 1));

      const mysteryWords = ['秘密', '谜团', '疑惑', '不解', '奇怪', '诡异', '神秘', '真相', '谜底', '线索'];
      let mysteryCount = 0;
      for (const word of mysteryWords) {
        mysteryCount += (chapterText.match(new RegExp(word, 'g')) || []).length;
      }
      const mysteryDensity = Math.min(1, mysteryCount / Math.max(wordCount * 0.008, 1));

      const endRegion = chapterText.slice(-200);
      const endSuspense = this.calculateEndSuspense(endRegion);

      const chapterSuspense = 0.3 * suspenseDensity + 0.2 * questionDensity + 0.25 * mysteryDensity + 0.25 * endSuspense;
      totalSuspense += chapterSuspense;
      validChapters++;
    }

    if (validChapters === 0) return 0;

    const avgSuspense = totalSuspense / validChapters;
    const chapterBonus = Math.min(validChapters / 3, 1) * 20;

    return this.clamp01((avgSuspense * 80 + chapterBonus) / 100) * 100;
  }

  private calculateEmotionalImpact(chapterTexts: string[]): number {
    let totalImpact = 0;
    let validChapters = 0;

    for (let i = 0; i < chapterTexts.length; i++) {
      const chapterText = chapterTexts[i];
      if (!chapterText || chapterText.length === 0) continue;

      const wordCount = countCjkWordsAndNumbers(chapterText);

      let emotionWordCount = 0;
      for (const word of this.emotionSet) {
        emotionWordCount += (chapterText.match(new RegExp(word, 'g')) || []).length;
      }

      const emotionDensity = Math.min(1, emotionWordCount / Math.max(wordCount * 0.02, 1));

      const exclamationCount = (chapterText.match(/[！!]/g) || []).length;
      const exclamationDensity = Math.min(1, exclamationCount / Math.max(wordCount * 0.005, 1));

      const positiveWords = ['开心', '喜悦', '狂喜', '兴奋', '激动', '感动', '温暖', '欣慰', '热血沸腾', '痛快', '畅快', '得意', '傲然'];
      const negativeWords = ['心痛', '心碎', '难过', '悲伤', '痛苦', '绝望', '崩溃', '哭泣', '愤怒', '暴怒', '恐惧', '害怕', '委屈', '不甘'];

      let positiveCount = 0;
      let negativeCount = 0;
      for (const word of positiveWords) {
        positiveCount += (chapterText.match(new RegExp(word, 'g')) || []).length;
      }
      for (const word of negativeWords) {
        negativeCount += (chapterText.match(new RegExp(word, 'g')) || []).length;
      }

      const emotionDiversity = positiveCount > 0 && negativeCount > 0 ? 0.3 : 0;

      const dialogueSegments = this.extractDialogueSegments(chapterText);
      let dialogueEmotion = 0;
      for (const seg of dialogueSegments) {
        for (const word of this.emotionSet) {
          if (seg.includes(word)) {
            dialogueEmotion++;
            break;
          }
        }
      }
      const dialogueEmotionRatio = dialogueSegments.length > 0 ? Math.min(1, dialogueEmotion / dialogueSegments.length) : 0;

      const emotionalImpact = 0.35 * emotionDensity + 0.2 * exclamationDensity + emotionDiversity + 0.15 * dialogueEmotionRatio;
      totalImpact += emotionalImpact;
      validChapters++;
    }

    if (validChapters === 0) return 0;

    const avgImpact = totalImpact / validChapters;
    return this.clamp01(avgImpact) * 100;
  }

  private countDialogueLines(text: string): number {
    let count = 0;
    for (const marker of DIALOGUE_MARKERS) {
      if (marker.length >= 2) {
        const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        count += (text.match(new RegExp(escaped, 'g')) || []).length;
      }
    }
    const quotePairs = (text.match(/「[^」]*」/g) || []).length + (text.match(/『[^』]*』/g) || []).length;
    return Math.max(count, quotePairs);
  }

  private extractDialogueSegments(text: string): string[] {
    const segments: string[] = [];
    const patterns = [
      /「([^」]+)」/g,
      /『([^』]+)』/g,
      /"([^"]+)"/g
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        segments.push(match[1]);
      }
    }

    return segments;
  }

  private countProperNouns(text: string): number {
    let count = 0;
    const patterns = [
      /[\u4e00-\u9fa5]{2,4}(?:家族|山庄|城堡|教派|宗门|门派|学院|帝国|王国|联盟|组织|商会|公会)/g,
      /[\u4e00-\u9fa5]{2,4}(?:大陆|海洋|山脉|平原|沙漠|森林|峡谷|秘境|禁地|遗迹)/g,
      /[\u4e00-\u9fa5]{2,4}(?:心法|秘法|神功|绝技|绝招|武学|武道|剑道)/g
    ];

    for (const pattern of patterns) {
      const matches = text.match(pattern);
      if (matches) count += matches.length;
    }

    return count;
  }

  private calculateEndSuspense(endRegion: string): number {
    if (!endRegion || endRegion.length === 0) return 0;

    let suspenseWordCount = 0;
    for (const word of this.suspenseSet2) {
      suspenseWordCount += (endRegion.match(new RegExp(word, 'g')) || []).length;
    }

    const wordCount = countCjkWordsAndNumbers(endRegion);
    const density = Math.min(1, suspenseWordCount / Math.max(wordCount * 0.03, 1));

    const questionCount = (endRegion.match(/[？?]/g) || []).length;
    const questionScore = Math.min(1, questionCount / Math.max(wordCount * 0.02, 1));

    return 0.6 * density + 0.4 * questionScore;
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
    characterImmersion: number;
    worldviewAttraction: number;
    dialogueQuality: number;
    suspenseIntensity: number;
    emotionalImpact: number;
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
      { key: 'chapterHooks', label: '章末钩子强度', threshold: 70 },
      { key: 'characterImmersion', label: '角色代入感', threshold: 65 },
      { key: 'worldviewAttraction', label: '世界观吸引力', threshold: 65 },
      { key: 'dialogueQuality', label: '对话质量', threshold: 65 },
      { key: 'suspenseIntensity', label: '悬念强度', threshold: 65 },
      { key: 'emotionalImpact', label: '情绪感染力', threshold: 65 }
    ] as const;

    const suggestionTexts: Record<string, string> = {
      openingConflict: '建议在开篇300字内引入更强的冲突和动作场面，使用更多冲突词汇和动词，快速抓住读者注意力',
      infoDensity: '前三章设定信息过多，建议分散到后续章节，先聚焦于主角和核心冲突，世界观设定逐步展开',
      protagonistGoal: '建议在前三章明确主角的目标和动机，让读者知道主角想要什么、为什么要奋斗',
      goldenFinger: '建议在前三章引入金手指或明确主角的特殊优势，金手指出现越早、类型越明确，对读者吸引力越强',
      chapterHooks: '建议在每章结尾设置更强的悬念或冲突钩子，让读者产生继续阅读的欲望',
      characterImmersion: '建议增强角色代入感，增加第一人称视角、内心独白和感官描写，让读者更容易共情主角',
      worldviewAttraction: '建议丰富世界观设定，增加体系、地理、势力、规则等多维度设定，构建更有吸引力的故事背景',
      dialogueQuality: '建议提升对话质量，增加对话中的情绪表达和个性化语言，让对话更生动且能推动剧情',
      suspenseIntensity: '建议增强悬念设置，在章节中布置更多谜团、疑问和伏笔，激发读者的好奇心',
      emotionalImpact: '建议增强情绪感染力，通过情感冲突、情绪转折和感人场景，让读者产生强烈的情感共鸣'
    };

    for (const { key, label, threshold } of scoreCategories) {
      const score = subScores[key];
      if (score < threshold) {
        let severity: 'high' | 'medium' | 'low';
        if (score < 40) {
          severity = 'high';
        } else if (score < threshold) {
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
      characterImmersion: number;
      worldviewAttraction: number;
      dialogueQuality: number;
      suspenseIntensity: number;
      emotionalImpact: number;
    },
    totalWords?: number,
    baseChapterCount?: number
  ): GoldenThreeChaptersResult['details'] {
    const firstChapterText = chapterTexts[0] || '';
    const secondChapterText = chapterTexts[1] || '';
    const thirdChapterText = chapterTexts[2] || '';

    // 字数口径统一为 countTotalChars，与 totalWords/全局分段统计一致
    let firstWordCount = countTotalChars(firstChapterText);
    let secondWordCount = countTotalChars(secondChapterText);
    let thirdWordCount = countTotalChars(thirdChapterText);

    // 回退：若 wordCount 为 0 但全文有内容，按全文总字数/总章数估算
    if (totalWords && totalWords > 0 && baseChapterCount && baseChapterCount > 0) {
      const estimatedPerChapter = Math.max(1, Math.round(totalWords / baseChapterCount));
      if (firstWordCount === 0 && firstChapterText.length > 0) {
        firstWordCount = countTotalChars(firstChapterText) || estimatedPerChapter;
      }
      if (firstWordCount === 0) {
        firstWordCount = estimatedPerChapter;
      }
      if (secondWordCount === 0) {
        secondWordCount = estimatedPerChapter;
      }
      if (thirdWordCount === 0) {
        thirdWordCount = estimatedPerChapter;
      }
    }

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
      const wordCount = countCjkWordsAndNumbers(endRegion);
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
      const wordCount = countCjkWordsAndNumbers(endRegion);
      const result = this.calculateHookIntensity(endRegion, wordCount, this.suspenseSet, 'suspense');
      secondChapterHookStrength = this.round2(result.intensity);
    }

    let thirdChapterHookStrength = 0;
    if (thirdChapterText.length > 0) {
      const endRegion = thirdChapterText.slice(-200);
      const wordCount = countCjkWordsAndNumbers(endRegion);
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
    wave?: WaveRhythmResult,
    global?: GlobalAnalysisResult
  ): number {
    let score = golden.totalScore;
    let weightSum = 0.6;

    if (wave && wave.complianceRate > 0) {
      score = score + wave.complianceRate * 100 * 0.2;
      weightSum += 0.2;
    }

    if (global && global.marketCompetitiveness > 0) {
      score = score + global.marketCompetitiveness * 0.2;
      weightSum += 0.2;
    }

    return score / Math.max(weightSum, 0.6);
  }

  private analyzeGlobalMetrics(text: string): GlobalAnalysisResult {
    if (!text || text.length === 0) {
      return this.getEmptyGlobalAnalysisResult();
    }

    const chapters = this.splitChapters(text);
    const wordCount = countTotalChars(text);

    const rhythmBalance = this.calculateRhythmBalance(text, chapters);
    const emotionalFluctuation = this.calculateEmotionalFluctuation(text, chapters);
    const worldviewCompleteness = this.calculateWorldviewCompleteness(text);
    const characterDiversity = this.calculateCharacterDiversity(text);
    const plotDensity = this.calculatePlotDensity(text, wordCount);

    const subScores = {
      rhythmBalance,
      emotionalFluctuation,
      worldviewCompleteness,
      characterDiversity,
      plotDensity
    };

    const readerRetention = this.calculateReaderRetention(subScores);
    const ipValue = this.calculateIpValue(subScores);
    const marketCompetitiveness = this.calculateMarketCompetitiveness(subScores);

    return {
      rhythmBalance: this.round2(rhythmBalance),
      emotionalFluctuation: this.round2(emotionalFluctuation),
      worldviewCompleteness: this.round2(worldviewCompleteness),
      characterDiversity: this.round2(characterDiversity),
      plotDensity: this.round2(plotDensity),
      readerRetention: this.round2(readerRetention),
      ipValue: this.round2(ipValue),
      marketCompetitiveness: this.round2(marketCompetitiveness),
      subScores: {
        rhythmBalance: this.round2(rhythmBalance),
        emotionalFluctuation: this.round2(emotionalFluctuation),
        worldviewCompleteness: this.round2(worldviewCompleteness),
        characterDiversity: this.round2(characterDiversity),
        plotDensity: this.round2(plotDensity)
      }
    };
  }

  private calculateRhythmBalance(text: string, chapters: { startIndex: number; endIndex: number; index: number }[]): number {
    if (chapters.length < 3) return 50;

    const chapterLengths: number[] = [];
    for (const ch of chapters) {
      chapterLengths.push(ch.endIndex - ch.startIndex);
    }

    const avgLength = chapterLengths.reduce((a, b) => a + b, 0) / chapterLengths.length;
    if (avgLength === 0) return 50;

    let variance = 0;
    for (const len of chapterLengths) {
      variance += Math.pow((len - avgLength) / avgLength, 2);
    }
    const cv = Math.sqrt(variance / chapterLengths.length);

    const lengthBalanceScore = Math.max(0, 100 - cv * 150);

    const paragraphCounts: number[] = [];
    for (const ch of chapters) {
      const chapterText = text.slice(ch.startIndex, ch.endIndex);
      const paragraphs = chapterText.split(/\n\s*\n/).filter(p => p.trim().length > 0);
      paragraphCounts.push(paragraphs.length);
    }
    const avgParas = paragraphCounts.reduce((a, b) => a + b, 0) / paragraphCounts.length;
    let paraVariance = 0;
    for (const pc of paragraphCounts) {
      paraVariance += Math.pow((pc - avgParas) / Math.max(avgParas, 1), 2);
    }
    const paraCv = Math.sqrt(paraVariance / paragraphCounts.length);
    const paraBalanceScore = Math.max(0, 100 - paraCv * 100);

    let sceneTransitionScore = 0;
    if (chapters.length >= 5) {
      const midChapters = chapters.slice(1, -1);
      let consistentTransitions = 0;
      for (const ch of midChapters) {
        const chapterText = text.slice(ch.startIndex, ch.endIndex);
        const startWords = chapterText.slice(0, 100);
        const endWords = chapterText.slice(-100);
        const hasStartHook = /(?:却|然而|但是|可|就在|突然|忽然|此时|这时|与此同时|话分两头)/.test(startWords);
        const hasEndHook = /(?:却|然而|但是|可|突然|忽然|竟然|居然|没想到|谁知|岂知)/.test(endWords);
        if (hasStartHook && hasEndHook) consistentTransitions++;
      }
      sceneTransitionScore = midChapters.length > 0 
        ? (consistentTransitions / midChapters.length) * 100 
        : 50;
    } else {
      sceneTransitionScore = 50;
    }

    const balanceScore = 0.5 * lengthBalanceScore + 0.3 * paraBalanceScore + 0.2 * sceneTransitionScore;
    return this.clamp01(balanceScore / 100) * 100;
  }

  private calculateEmotionalFluctuation(text: string, chapters: { startIndex: number; endIndex: number; index: number }[]): number {
    if (chapters.length < 2) return 40;

    const strongPositiveWords = ['狂喜', '兴奋', '激动', '狂喜', '震撼', '痛快', '畅快', '狂喜', '热血沸腾', '心潮澎湃', '欣喜若狂', '喜出望外', '大喜过望', '大喜'];
    const mildPositiveWords = ['开心', '喜悦', '高兴', '快乐', '温暖', '欣慰', '得意', '傲然', '胜利', '成功', '突破', '微笑', '含笑', '欣然'];
    const strongNegativeWords = ['心痛', '绝望', '悲痛', '痛苦', '暴怒', '震怒', '恐惧', '惊恐', '绝望', '崩溃', '心碎', '痛苦不堪', '痛不欲生', '肝肠寸断'];
    const mildNegativeWords = ['难过', '悲伤', '愤怒', '害怕', '委屈', '不甘', '危机', '危险', '失败', '重伤', '担忧', '焦虑', '紧张', '忧虑'];

    const chapterEmotions: number[] = [];
    for (const ch of chapters) {
      const chapterText = text.slice(ch.startIndex, ch.endIndex);
      let strongPosCount = 0, mildPosCount = 0, strongNegCount = 0, mildNegCount = 0;

      for (const word of strongPositiveWords) {
        strongPosCount += (chapterText.match(new RegExp(word, 'g')) || []).length;
      }
      for (const word of mildPositiveWords) {
        mildPosCount += (chapterText.match(new RegExp(word, 'g')) || []).length;
      }
      for (const word of strongNegativeWords) {
        strongNegCount += (chapterText.match(new RegExp(word, 'g')) || []).length;
      }
      for (const word of mildNegativeWords) {
        mildNegCount += (chapterText.match(new RegExp(word, 'g')) || []).length;
      }

      const positiveScore = strongPosCount * 2 + mildPosCount;
      const negativeScore = strongNegCount * 2 + mildNegCount;
      const emotionScore = positiveScore - negativeScore;
      chapterEmotions.push(emotionScore);
    }

    if (chapterEmotions.length < 2) return 40;

    let fluctuation = 0;
    for (let i = 1; i < chapterEmotions.length; i++) {
      fluctuation += Math.abs(chapterEmotions[i] - chapterEmotions[i - 1]);
    }
    const avgFluctuation = fluctuation / (chapterEmotions.length - 1);

    const wordCount = countTotalChars(text);
    const normalizedFluctuation = avgFluctuation / Math.max(wordCount / 10000, 1);

    const fluctuationScore = Math.min(100, normalizedFluctuation * 20);

    let trendScore = 0;
    if (chapterEmotions.length >= 5) {
      let directionChanges = 0;
      for (let i = 2; i < chapterEmotions.length; i++) {
        const prevTrend = chapterEmotions[i - 1] - chapterEmotions[i - 2];
        const currTrend = chapterEmotions[i] - chapterEmotions[i - 1];
        if ((prevTrend > 0 && currTrend < 0) || (prevTrend < 0 && currTrend > 0)) {
          directionChanges++;
        }
      }
      trendScore = Math.min(100, (directionChanges / (chapterEmotions.length - 2)) * 100);
    } else {
      trendScore = 40;
    }

    const finalScore = 0.7 * fluctuationScore + 0.3 * trendScore;
    return this.clamp01(finalScore / 100) * 100;
  }

  private calculateWorldviewCompleteness(text: string): number {
    const categories = ['system', 'geography', 'faction', 'rule'] as const;
    let categoryHit = 0;
    let categoryScoreSum = 0;

    for (const cat of categories) {
      const catWords = WORLDVIEW_WORDS[cat] || [];
      let hitCount = 0;
      for (const word of catWords) {
        hitCount += (text.match(new RegExp(word, 'g')) || []).length;
      }
      if (hitCount > 0) {
        categoryHit++;
        categoryScoreSum += Math.min(100, hitCount * 5);
      }
    }

    const categoryCoverageScore = (categoryHit / categories.length) * 100;
    const categoryDepthScore = categoryHit > 0 ? categoryScoreSum / categoryHit : 0;
    const categoryScore = 0.6 * categoryCoverageScore + 0.4 * categoryDepthScore;

    let totalWorldviewWords = 0;
    for (const word of this.worldviewSet) {
      totalWorldviewWords += (text.match(new RegExp(word, 'g')) || []).length;
    }

    const wordCount = countTotalChars(text);
    const densityScore = Math.min(100, (totalWorldviewWords / Math.max(wordCount * 0.01, 1)) * 100);

    const properNounCount = this.countProperNouns(text);
    const properNounScore = Math.min(100, (properNounCount / Math.max(wordCount * 0.005, 1)) * 100);

    const uniqueWorldviewWords = new Set<string>();
    for (const word of this.worldviewSet) {
      if (text.includes(word)) {
        uniqueWorldviewWords.add(word);
      }
    }
    const diversityScore = Math.min(100, (uniqueWorldviewWords.size / Math.max(this.worldviewSet.size * 0.1, 1)) * 100);

    const completeness = 0.35 * categoryScore + 0.25 * densityScore + 0.2 * properNounScore + 0.2 * diversityScore;
    return this.clamp01(completeness / 100) * 100;
  }

  private calculateCharacterDiversity(text: string): number {
    const nameSuffixes = ['先生', '小姐', '夫人', '大爷', '少爷', '姑娘', '长老', '掌门', '门主', '教主', '阁主', '宫主', '城主', '楼主', '庄主', '族长', '团长', '队长'];

    let namedCharacters = new Set<string>();

    for (const suffix of nameSuffixes) {
      const pattern = new RegExp(`[\\u4e00-\\u9fa5]{1,2}${suffix}`, 'g');
      const matches = text.match(pattern);
      if (matches) {
        for (const m of matches) {
          namedCharacters.add(m);
        }
      }
    }

    const dialoguePattern = /([\u4e00-\u9fa5]{2,3})(说|道|喊|叫|问|答|笑|叹|怒道|冷笑|低语|喃喃|轻声|大声)/g;
    let dialogueMatch;
    while ((dialogueMatch = dialoguePattern.exec(text)) !== null) {
      namedCharacters.add(dialogueMatch[1]);
    }

    const surnamePattern = /[赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏水窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳酆鲍史唐][\u4e00-\u9fa5]{1,2}/g;
    let surnameMatch;
    const surnameNames = new Set<string>();
    while ((surnameMatch = surnamePattern.exec(text)) !== null) {
      const name = surnameMatch[0];
      if (name.length >= 2 && name.length <= 3) {
        surnameNames.add(name);
      }
    }

    const wordCount = countTotalChars(text);
    const densityScore = Math.min(100, (namedCharacters.size / Math.max(wordCount * 0.001, 1)) * 1000);

    const varietyScore = Math.min(100, namedCharacters.size * 4);

    const surnameDiversity = surnameNames.size;
    const surnameDiversityScore = Math.min(100, surnameDiversity * 3);

    const dialogueCount = (text.match(/[“"][^”"]*[”"]/g) || []).length;
    const dialogueScore = Math.min(100, (dialogueCount / Math.max(wordCount * 0.002, 1)) * 100);

    const diversity = 0.35 * varietyScore + 0.25 * densityScore + 0.2 * surnameDiversityScore + 0.2 * dialogueScore;
    return this.clamp01(diversity / 100) * 100;
  }

  private calculatePlotDensity(text: string, totalWords: number): number {
    const strongEventWords = ['战斗', '决斗', '突破', '晋级', '晋升', '揭开', '真相', '死亡', '重生', '穿越', '觉醒', '觉醒', '爆发', '逆袭', '反转'];
    const mildEventWords = ['决定', '计划', '行动', '出发', '前往', '返回', '离开', '到达', '会面', '商议', '谈判', '交易', '比试', '获得', '失去', '发现', '遭遇', '邀请', '拒绝', '承诺', '背叛'];

    let strongEventCount = 0;
    let mildEventCount = 0;

    for (const word of strongEventWords) {
      strongEventCount += (text.match(new RegExp(word, 'g')) || []).length;
    }
    for (const word of mildEventWords) {
      mildEventCount += (text.match(new RegExp(word, 'g')) || []).length;
    }

    const transitionWords = ['于是', '然后', '接着', '随后', '不久', '片刻', '转眼', '数日后', '几日后', '数月后', '数年后', '与此同时', '另一边', '话分两头', '与此同时'];
    let transitionCount = 0;
    for (const word of transitionWords) {
      transitionCount += (text.match(new RegExp(word, 'g')) || []).length;
    }

    const dialogueCount = (text.match(/[“"][^”"]*[”"]/g) || []).length;
    const actionCount = (text.match(/(?:猛然|忽然|突然|立刻|马上|迅速|急忙|赶紧).{0,20}(?:冲|扑|跳|闪|躲|出|入|去|来)/g) || []).length;

    const weightedEventCount = strongEventCount * 2 + mildEventCount;
    const eventDensity = Math.min(100, (weightedEventCount / Math.max(totalWords * 0.005, 1)) * 100);
    const transitionDensity = Math.min(100, (transitionCount / Math.max(totalWords * 0.002, 1)) * 100);
    const dialogueDensity = Math.min(100, (dialogueCount / Math.max(totalWords * 0.005, 1)) * 100);
    const actionDensity = Math.min(100, (actionCount / Math.max(totalWords * 0.003, 1)) * 100);

    const plotDensity = 0.4 * eventDensity + 0.25 * transitionDensity + 0.2 * dialogueDensity + 0.15 * actionDensity;
    return this.clamp01(plotDensity / 100) * 100;
  }

  private calculateReaderRetention(subScores: {
    rhythmBalance: number;
    emotionalFluctuation: number;
    worldviewCompleteness: number;
    characterDiversity: number;
    plotDensity: number;
  }): number {
    const weights = {
      rhythmBalance: 0.2,
      emotionalFluctuation: 0.25,
      plotDensity: 0.25,
      characterDiversity: 0.15,
      worldviewCompleteness: 0.15
    };

    const retention =
      weights.rhythmBalance * subScores.rhythmBalance +
      weights.emotionalFluctuation * subScores.emotionalFluctuation +
      weights.plotDensity * subScores.plotDensity +
      weights.characterDiversity * subScores.characterDiversity +
      weights.worldviewCompleteness * subScores.worldviewCompleteness;

    return this.clamp01(retention / 100) * 100;
  }

  private calculateIpValue(subScores: {
    rhythmBalance: number;
    emotionalFluctuation: number;
    worldviewCompleteness: number;
    characterDiversity: number;
    plotDensity: number;
  }): number {
    const weights = {
      worldviewCompleteness: 0.3,
      characterDiversity: 0.25,
      emotionalFluctuation: 0.2,
      plotDensity: 0.15,
      rhythmBalance: 0.1
    };

    const ipValue =
      weights.worldviewCompleteness * subScores.worldviewCompleteness +
      weights.characterDiversity * subScores.characterDiversity +
      weights.emotionalFluctuation * subScores.emotionalFluctuation +
      weights.plotDensity * subScores.plotDensity +
      weights.rhythmBalance * subScores.rhythmBalance;

    return this.clamp01(ipValue / 100) * 100;
  }

  private calculateMarketCompetitiveness(subScores: {
    rhythmBalance: number;
    emotionalFluctuation: number;
    worldviewCompleteness: number;
    characterDiversity: number;
    plotDensity: number;
  }): number {
    const weights = {
      plotDensity: 0.25,
      emotionalFluctuation: 0.2,
      characterDiversity: 0.2,
      rhythmBalance: 0.2,
      worldviewCompleteness: 0.15
    };

    const competitiveness =
      weights.plotDensity * subScores.plotDensity +
      weights.emotionalFluctuation * subScores.emotionalFluctuation +
      weights.characterDiversity * subScores.characterDiversity +
      weights.rhythmBalance * subScores.rhythmBalance +
      weights.worldviewCompleteness * subScores.worldviewCompleteness;

    return this.clamp01(competitiveness / 100) * 100;
  }

  private getEmptyGlobalAnalysisResult(): GlobalAnalysisResult {
    return {
      rhythmBalance: 0,
      emotionalFluctuation: 0,
      worldviewCompleteness: 0,
      characterDiversity: 0,
      plotDensity: 0,
      readerRetention: 0,
      ipValue: 0,
      marketCompetitiveness: 0,
      subScores: {
        rhythmBalance: 0,
        emotionalFluctuation: 0,
        worldviewCompleteness: 0,
        characterDiversity: 0,
        plotDensity: 0
      }
    };
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
      globalAnalysis: this.getEmptyGlobalAnalysisResult(),
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
        chapterHooks: 0,
        characterImmersion: 0,
        worldviewAttraction: 0,
        dialogueQuality: 0,
        suspenseIntensity: 0,
        emotionalImpact: 0
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

  private formatNumber(num: number): string {
    if (num >= 10000) {
      return (num / 10000).toFixed(2) + ' 万';
    }
    return num.toLocaleString('zh-CN');
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
      waveRhythm: result.waveRhythm,
      globalAnalysis: result.globalAnalysis
    };
    return JSON.stringify(data, null, 2);
  }

  private buildMarkdownBody(result: CommercialAnalysisResult, bookName: string): string {
    const lines: string[] = [];

    lines.push(`# ${bookName} - 商业可行性分析报告`);
    lines.push('');

    if (result.wordCount) {
      lines.push('## 基本信息');
      lines.push('');
      lines.push(`- 总字数（含标点）：**${this.formatNumber(result.wordCount.total)}**`);
      lines.push(`- 纯汉字数：**${this.formatNumber(result.wordCount.chineseOnly)}**`);
      lines.push(`- 平台口径字数：**${this.formatNumber(result.wordCount.platformStyle)}**`);
      lines.push('');
    }

    lines.push('## 商业可行性总评');
    lines.push('');
    lines.push(`- 综合得分：**${result.overallScore}**`);
    lines.push(`- 综合等级：**${result.overallLevel}**`);
    lines.push('');

    lines.push('## 黄金三章分析');
    lines.push('');
    lines.push(`- 黄金三章总分：**${result.goldenThreeChapters.totalScore}**`);
    lines.push('');

    lines.push('### 十项子分');
    lines.push('');
    
    const subScoreItems = [
      { label: '开篇冲突密度', score: result.goldenThreeChapters.subScores.openingConflict, weight: '12%' },
      { label: '信息密度/过载检测', score: result.goldenThreeChapters.subScores.infoDensity, weight: '8%' },
      { label: '主角目标清晰度', score: result.goldenThreeChapters.subScores.protagonistGoal, weight: '12%' },
      { label: '金手指吸引力', score: result.goldenThreeChapters.subScores.goldenFinger, weight: '15%' },
      { label: '章末钩子强度', score: result.goldenThreeChapters.subScores.chapterHooks, weight: '12%' },
      { label: '角色代入感', score: result.goldenThreeChapters.subScores.characterImmersion, weight: '10%' },
      { label: '世界观吸引力', score: result.goldenThreeChapters.subScores.worldviewAttraction, weight: '8%' },
      { label: '对话质量', score: result.goldenThreeChapters.subScores.dialogueQuality, weight: '8%' },
      { label: '悬念强度', score: result.goldenThreeChapters.subScores.suspenseIntensity, weight: '8%' },
      { label: '情绪感染力', score: result.goldenThreeChapters.subScores.emotionalImpact, weight: '7%' }
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

    lines.push('## 全局分析');
    lines.push('');
    if (result.globalAnalysis) {
      const g = result.globalAnalysis;
      lines.push(`- 读者留存潜力：**${g.readerRetention}** 分`);
      lines.push(`- IP开发价值：**${g.ipValue}** 分`);
      lines.push(`- 市场竞争力：**${g.marketCompetitiveness}** 分`);
      lines.push('');

      lines.push('### 五项基础维度');
      lines.push('');

      const globalSubItems = [
        { label: '节奏均衡度', score: g.subScores.rhythmBalance },
        { label: '情绪波动幅度', score: g.subScores.emotionalFluctuation },
        { label: '世界观完整度', score: g.subScores.worldviewCompleteness },
        { label: '角色丰富度', score: g.subScores.characterDiversity },
        { label: '情节密度', score: g.subScores.plotDensity }
      ];

      for (const item of globalSubItems) {
        const barLength = Math.floor(item.score / 10);
        const bar = '█'.repeat(barLength) + '░'.repeat(10 - barLength);
        lines.push(`- ${item.label}：${item.score} 分`);
        lines.push(`  \`${bar}\``);
      }
      lines.push('');

      lines.push('### 三大综合指标');
      lines.push('');
      lines.push('| 指标 | 得分 | 说明 |');
      lines.push('|------|------|------|');
      lines.push(`| 读者留存潜力 | ${g.readerRetention} | 基于节奏、情绪、情节密度等维度综合评估读者持续阅读的可能性 |`);
      lines.push(`| IP开发价值 | ${g.ipValue} | 基于世界观、角色、情绪等维度评估影视/游戏/动漫改编潜力 |`);
      lines.push(`| 市场竞争力 | ${g.marketCompetitiveness} | 综合评估作品在当前网文市场的竞争优势 |`);
    } else {
      lines.push('全局分析暂不可用');
    }
    lines.push('');

    return lines.join('\n');
  }
}
