/**
 * quality/quality-score-engine.ts — 六维质量评分引擎（实时监控 V2 Task 1）
 *
 * 六个维度：
 *   1. 可读性 Readability         — 句长适中度、段落结构、标点使用、语言流畅度
 *   2. 节奏   Rhythm              — 快慢节奏交替、张弛有度、高潮分布
 *   3. 情绪饱满度 Emotion          — 情绪表达丰富度、情绪变化自然度
 *   4. 人物一致性 CharacterConsistency — 人物行为符合设定、对话风格一致
 *   5. 情节连贯性 Coherence        — 前后逻辑一致、因果链完整、时间线正确
 *   6. 语言质感 LanguageTexture    — 用词精准度、修辞丰富度、风格统一性
 *
 * 设计原则：
 *   - 零外部依赖
 *   - 向后兼容：V1 质量引擎（WritingQualityEngine）完全保留，本引擎调用它
 *   - 外科手术式改动：不修改现有引擎，通过依赖注入复用
 *   - 增量评估：只评估变更部分（传入 changedRange）
 *   - 支持取消：传入 AbortSignal
 *   - 评估结果缓存（复用 LruCache）
 */

import { LruCache } from '@/shared/lru-cache';
import { WritingQualityEngine, type WritingQualityResult } from '@/engine/writing-quality-engine';
import { analyzeCoherence, CoherenceReport } from '@/engine/coherence-checker';
import {
  QUALITY_MIN_EVALUABLE_CHARS,
  QSE_CALIBRATION,
  QSE_DIMENSION_WEIGHTS,
  QSE_SUB_WEIGHTS,
} from '@/shared/thresholds';
import { createLogger } from '@/shared/logger';

const log = createLogger('QualityScoreEngine');

// ============================================================
// 一、维度定义
// ============================================================

type QualityDimension =
  | 'readability'
  | 'rhythm'
  | 'emotion'
  | 'characterConsistency'
  | 'coherence'
  | 'languageTexture';

/**
 * 质量维度列表。
 */
export const QUALITY_DIMENSIONS: readonly QualityDimension[] = [
  'readability',
  'rhythm',
  'emotion',
  'characterConsistency',
  'coherence',
  'languageTexture',
] as const;

/**
 * 质量维度中文名。
 */
export const DIMENSION_LABELS: Record<QualityDimension, string> = {
  readability: '可读性',
  rhythm: '节奏',
  emotion: '情绪饱满度',
  characterConsistency: '人物一致性',
  coherence: '情节连贯性',
  languageTexture: '语言质感',
};

// 维度权重（用于综合评分；数值统一在 shared/thresholds.ts）
/**
 * 质量维度权重。
 */
export const DIMENSION_WEIGHTS: Record<QualityDimension, number> = QSE_DIMENSION_WEIGHTS;

// ============================================================
// 二、评估结果模型
// ============================================================

type IssueSeverity = 'high' | 'medium' | 'low';
type SuggestionPriority = 'high' | 'medium' | 'low';
type ScoreTrend = 'rising' | 'falling' | 'stable';

interface IssueLocation {
  /** 行号（1-based） */
  line?: number;
  /** 字符偏移（0-based） */
  charOffset?: number;
  /** 问题文本长度 */
  length?: number;
}

interface QualityIssue {
  id: string;
  dimension: QualityDimension;
  description: string;
  severity: IssueSeverity;
  location?: IssueLocation;
}

interface ImprovementSuggestion {
  id: string;
  dimension: QualityDimension;
  content: string;
  priority: SuggestionPriority;
  estimatedEffort?: string;
}

/**
 * 单维度得分。
 */
export interface DimensionScore {
  dimension: QualityDimension;
  /** 评分 0-100 */
  score: number;
  /** 评分依据（具体的评分规则说明） */
  basis: string[];
  /** 低分时给出具体问题列表 */
  issues: QualityIssue[];
  /** 可操作的改进方向 */
  suggestions: ImprovementSuggestion[];
  /** 量化细节 */
  details: Record<string, number | string>;
}

/**
 * 质量总分。
 */
export interface QualityScore {
  /** 总分数 0-100 */
  overallScore: number;
  /** 六维分数 */
  dimensions: Record<QualityDimension, DimensionScore>;
  /** 全部问题列表（合并六维） */
  issues: QualityIssue[];
  /** 全部改进建议（合并六维，按优先级排序） */
  suggestions: ImprovementSuggestion[];
  evaluatedAt: number;
  wordCount: number;
  evalTimeMs: number;
  /** 历史趋势 */
  trend: ScoreTrend;
  /** 评估是否命中缓存 */
  fromCache: boolean;
  /**
   * 注入 v1Engine 时的原始 WritingQualityEngine 结果。
   * 六维映射丢失了 structure（QSE 六维不含该维度），落盘历史/基线需要完整六维时直接读这里，
   * 避免调用方为了拿 structure 再跑一遍同文本评估。
   */
  v1Result?: WritingQualityResult;
}

// ============================================================
// 三、评估上下文
// ============================================================

/**
 * 人物上下文信息。
 */
export interface CharacterContextInfo {
  name: string;
  personality?: string;
  appearance?: string;
  abilities?: string;
  background?: string;
}

/**
 * 评估上下文。
 */
export interface EvaluationContext {
  chapterId?: string;
  chapterTitle?: string;
  /** 后一章正文（用于连贯性上下文） */
  nextChapterText?: string;
  /** 人物名称列表 */
  characterNames?: string[];
  /** 人物设定信息（用于人物一致性维度） */
  characterInfos?: CharacterContextInfo[];
  /** 主线关键词 */
  mainlineKeywords?: string[];
  /** 章节大纲 */
  chapterOutline?: string;
  /** 风格指纹（用于语言质感维度） */
  styleFingerprint?: Record<string, number>;
  /** 变更范围（用于增量评估，字符偏移） */
  changedRange?: { start: number; end: number };
}

// ============================================================
// 四、依赖注入接口（复用现有引擎，避免循环依赖）
// ============================================================

/** 节奏分析器接口（对应 RhythmAnalyzer） */
export interface IRhythmAnalyzer {
  analyze(text: string): Promise<{
    segments: Array<{
      pace: 'fast' | 'medium' | 'slow';
      type: 'action' | 'dialogue' | 'description' | 'introspection';
      density: number;
      tensionLevel: number;
      issues: string[];
    }>;
    overallPace: string;
    suggestions: string[];
  }>;
}

/** 情绪曲线分析器接口（对应 EmotionCurveAnalyzer） */
export interface IEmotionAnalyzer {
  analyze(text: string): Promise<{
    points: Array<{ emotion: string; intensity: number }>;
    dominantEmotion: string;
    volatility: number;
    arcType: 'rise' | 'fall' | 'wave' | 'flat';
  }>;
}

/** 人物一致性检查器接口（对应 CharacterConsistencyChecker） */
export interface ICharacterChecker {
  // 只做「当前章 vs 人物档案」。跨章设定一致性由 DeviationDetector 负责，
  // 不得在此声明 historyTexts 这类无实现承诺的参数（曾声明但从未被使用）。
  check(
    chapterText: string,
    characterInfos: CharacterContextInfo[],
  ): Promise<{
    overallScore: number;
    characterResults: Record<string, {
      score: number;
      inconsistencies: Array<{
        type: string;
        severity: 'low' | 'medium' | 'high';
        description: string;
        location?: string;
        suggestion?: string;
        confidence: number;
      }>;
    }>;
    summary: string;
  }>;
}

// ============================================================
// 五、引擎选项
// ============================================================

interface QualityScoreEngineOptions {
  /**
   * 复用 V1 质量引擎。注入后 V1 是**唯一评分口径**：六维与总分全部来自
   * `WritingQualityEngine`，下面三个分析器一律不生效。
   */
  v1Engine?: WritingQualityEngine;
  /** 节奏分析器（仅未注入 `v1Engine` 时生效） */
  rhythmAnalyzer?: IRhythmAnalyzer;
  /** 情绪曲线分析器（仅未注入 `v1Engine` 时生效） */
  emotionAnalyzer?: IEmotionAnalyzer;
  /** 人物一致性检查器（仅未注入 `v1Engine` 时生效；生产的人物逐条比对由 DeviationDetector 负责） */
  characterChecker?: ICharacterChecker;
  /** 缓存最大条目数 */
  cacheSize?: number;
  /** 缓存存活时间（毫秒），0 表示永不过期 */
  cacheTtlMs?: number;
  /** 历史记录最大条数 */
  historySize?: number;
}

// ============================================================
// 六、QualityScoreEngine 实现
// ============================================================

/**
 * 六维质量评分引擎
 *
 * 使用方式：
 *   const engine = new QualityScoreEngine({ v1Engine: new WritingQualityEngine() });
 *   const score = await engine.evaluate(text);
 *
 * 增量评估：
 *   const score = await engine.evaluate(text, { changedRange: { start: 100, end: 200 } });
 *
 * 取消评估：
 *   const controller = new AbortController();
 *   controller.abort();
 *   await engine.evaluate(text, {}, controller.signal); // 抛出 AbortError
 */
export class QualityScoreEngine {
  private readonly v1Engine?: WritingQualityEngine;
  private readonly rhythmAnalyzer?: IRhythmAnalyzer;
  private readonly emotionAnalyzer?: IEmotionAnalyzer;
  private readonly characterChecker?: ICharacterChecker;

  /** 维度结果缓存：key = `${dimension}:${textHash}` */
  private readonly dimensionCache: LruCache<string, DimensionScore>;
  /** 完整结果缓存：key = textHash */
  private readonly fullCache: LruCache<string, QualityScore>;
  /** 历史趋势记录 */
  private history: number[] = [];
  private readonly historySize: number;
  /**
   * 已同步进 V1 内核的上下文签名（人物名单 / 章节大纲 / 主线关键词）。
   * V1 是注入后的有效评分路径，同一段正文在不同名单下分数不同，
   * 签名变化时必须让 textHash 的缓存失效，否则新名单算不出新分。
   */
  private v1ContextSignature = '';
  /**
   * C4：评估串行队列。
   * syncV1Context 会直接 updateOptions 修改注入的 V1 内核——这是共享可变实例，
   * 两次评估交错时 B 的名单/大纲会覆盖 A 正在用的上下文。
   * 所有公开评估入口统一排队，保证「同步上下文 → 内核评分」不被另一次调用插入。
   */
  private evalQueue: Promise<void> = Promise.resolve();

  constructor(options: QualityScoreEngineOptions = {}) {
    this.v1Engine = options.v1Engine;
    this.rhythmAnalyzer = options.rhythmAnalyzer;
    this.emotionAnalyzer = options.emotionAnalyzer;
    this.characterChecker = options.characterChecker;

    // C1: 双内核并存会让调用方误以为「注入 checker 就启用逐人物比对」，
    // 实际 V1 分支整段绕过它们。这里只提示一次，不改变 V1 口径。
    if (options.v1Engine) {
      const ignored = [
        options.rhythmAnalyzer ? 'rhythmAnalyzer' : '',
        options.emotionAnalyzer ? 'emotionAnalyzer' : '',
        options.characterChecker ? 'characterChecker' : '',
      ].filter(Boolean);
      if (ignored.length > 0) {
        log.warn(
          `已注入 v1Engine（统一内核），${ignored.join(' / ')} 不会生效：六维与总分全部取自 WritingQualityEngine`,
        );
      }
    }

    const cacheSize = options.cacheSize ?? 50;
    const cacheTtlMs = options.cacheTtlMs ?? 60_000;
    this.dimensionCache = new LruCache<string, DimensionScore>({
      maxSize: cacheSize * 6,
      ttlMs: cacheTtlMs,
    });
    this.fullCache = new LruCache<string, QualityScore>({
      maxSize: cacheSize,
      ttlMs: cacheTtlMs,
    });
    this.historySize = options.historySize ?? 20;
  }

  // ── 公开 API ──────────────────────────────────────────────

  /**
   * 评估文本的六维质量
   * @param text 正文文本
   * @param context 评估上下文
   * @param signal 取消信号
    * @returns QualityScore 实例
   */
  async evaluate(
    text: string,
    context: EvaluationContext = {},
    signal?: AbortSignal
  ): Promise<QualityScore> {
    return this.enqueueEvaluation(() => this.evaluateInternal(text, context, signal));
  }

  /** C4：所有评估入口共用的串行队列（见 evalQueue 注释） */
  private enqueueEvaluation<T>(run: () => Promise<T>): Promise<T> {
    const task = this.evalQueue.then(run, run);
    this.evalQueue = task.then(() => undefined, () => undefined);
    return task;
  }

  private async evaluateInternal(
    text: string,
    context: EvaluationContext,
    signal?: AbortSignal
  ): Promise<QualityScore> {
    const startTime = Date.now();
    const cleanText = this.cleanText(text);
    const wordCount = cleanText.length;
    const textHash = this.hashText(cleanText);

    // 上下文进内核必须在读缓存之前：换了人物名单/大纲，同一 textHash 的旧分不成立
    this.syncV1Context(context);

    // 完整结果缓存命中（仅在无变更范围时）
    if (!context.changedRange) {
      const cached = this.fullCache.get(textHash);
      if (cached) {
        return { ...cached, fromCache: true, evalTimeMs: Date.now() - startTime };
      }
    }

    // 内容不足时返回空结果（与 WritingQualityEngine 共用同一门槛）
    if (wordCount < QUALITY_MIN_EVALUABLE_CHARS) {
      const empty = this.getEmptyScore(wordCount, startTime);
      this.fullCache.set(textHash, empty);
      return empty;
    }

    this.throwIfAborted(signal);

    // 统一内核：注入 v1Engine 时，六维与总分全部取自 WritingQualityEngine，
    // 保证同一段正文在监控面板、协同视图、质量看板得到同一分数。
    // 上下文已在读缓存前同步进内核（见 syncV1Context）。
    const v1 = this.v1Engine ? this.v1Engine.evaluate(cleanText) : undefined;

    // 逐维评估
    const dimensions: Record<QualityDimension, DimensionScore> = {} as Record<
      QualityDimension,
      DimensionScore
    >;

    for (const dim of QUALITY_DIMENSIONS) {
      this.throwIfAborted(signal);
      dimensions[dim] = await this.evaluateDimensionInternal(cleanText, dim, context, signal, v1);
    }

    this.throwIfAborted(signal);

    const overallScore = v1 ? v1.overallScore : this.calculateOverallScore(dimensions);
    const allIssues = this.collectIssues(dimensions);
    const allSuggestions = this.collectSuggestions(dimensions);
    const trend = this.calculateTrend(overallScore);

    this.recordHistory(overallScore);

    const result: QualityScore = {
      overallScore,
      dimensions,
      issues: allIssues,
      suggestions: allSuggestions,
      evaluatedAt: Date.now(),
      wordCount,
      evalTimeMs: Date.now() - startTime,
      trend,
      fromCache: false,
      v1Result: v1,
    };

    this.fullCache.set(textHash, result);
    return result;
  }

  /**
   * 评估单个维度
   * @param text 正文文本
   * @param dimension 维度
   * @param context 评估上下文
   * @param signal 取消信号
    * @returns DimensionScore 实例
   */
  async evaluateDimension(
    text: string,
    dimension: QualityDimension,
    context: EvaluationContext = {},
    signal?: AbortSignal
  ): Promise<DimensionScore> {
    return this.enqueueEvaluation(() => {
      const cleanText = this.cleanText(text);
      this.syncV1Context(context);
      const v1 = this.v1Engine ? this.v1Engine.evaluate(cleanText) : undefined;
      return this.evaluateDimensionInternal(cleanText, dimension, context, signal, v1);
    });
  }

  /**
   * 获取历史趋势记录
   *
   * @returns 结果数组
   */
  getHistory(): number[] {
    return [...this.history];
  }

  /** 清空所有缓存 */
  clearCache(): void {
    this.dimensionCache.clear();
    this.fullCache.clear();
  }

  /**
   * 按 key 失效缓存
   *
   * @param text - 文本内容
   */
  invalidateCache(text?: string): void {
    if (text === undefined) {
      this.clearCache();
      return;
    }
    const textHash = this.hashText(this.cleanText(text));
    this.fullCache.delete(textHash);
    for (const dim of QUALITY_DIMENSIONS) {
      this.dimensionCache.delete(`${dim}:${textHash}`);
    }
  }

  /** 清空历史记录 */
  clearHistory(): void {
    this.history = [];
  }

  /**
   * 把本次评估的上下文写进 V1 内核。
   * 注入 v1Engine 后六维与总分都取自它，但 V1 的 evaluate(text) 只收文本：
   * 不在这里注入人物名单，人物维度就只能靠「X说 / X道」正则估算，
   * 协同视图已加载的人物档案与章节大纲等于完全没用上。
   * 三样上下文都没给时不动内核，避免把调用方构造时配置的名单覆盖成空。
   */
  private syncV1Context(context: EvaluationContext): void {
    const v1 = this.v1Engine;
    if (!v1) return;

    const names = (context.characterNames ?? context.characterInfos?.map(c => c.name) ?? [])
      .map(name => name.trim())
      .filter(Boolean);
    const outline = (context.chapterOutline ?? '').trim();
    const keywords = context.mainlineKeywords ?? [];
    if (names.length === 0 && !outline && keywords.length === 0) return;

    const signature = [names.join('\u0001'), outline, keywords.join('\u0001')].join('\u0002');
    if (signature === this.v1ContextSignature) return;
    this.v1ContextSignature = signature;

    v1.updateOptions({
      ...(names.length > 0 ? { characterNames: names } : {}),
      ...(outline ? { chapterOutline: outline } : {}),
      ...(keywords.length > 0 ? { mainlineKeywords: keywords } : {}),
    });
    // 上下文变了：同一段正文的旧六维与旧总分不再成立
    this.dimensionCache.clear();
    this.fullCache.clear();
  }

  // ── 维度评估实现 ──────────────────────────────────────────

  /**
   * 把 WritingQualityEngine 的六维映射到本引擎的六维口径。
   * 映射关系固定，避免两个引擎各算一套：
   *   readability ← languageQuality / rhythm ← rhythmQuality / emotion ← atmosphereQuality
   *   characterConsistency ← characterQuality / coherence ← plotQuality
   *   languageTexture ← languageQuality.details 派生（词汇丰富度 + 修辞密度）
   *
   * C2：languageTexture 不再直接复用 languageQuality.score，否则雷达图上
   * 「可读性」与「语言质感」两轴同源，等于把语言质量算了两遍。
   */
  private mapV1Dimension(v1: WritingQualityResult, dimension: QualityDimension): DimensionScore {
    const source = {
      readability: v1.languageQuality,
      rhythm: v1.rhythmQuality,
      emotion: v1.atmosphereQuality,
      characterConsistency: v1.characterQuality,
      coherence: v1.plotQuality,
      languageTexture: v1.languageQuality,
    }[dimension];

    let score = source.score;
    let basis: string[] = ['统一内核：WritingQualityEngine 六维规则评分'];
    let details = source.details;

    if (dimension === 'languageTexture') {
      const derived = this.deriveLanguageTextureFromV1(source);
      if (derived) {
        score = derived.score;
        basis = [
          '统一内核派生：语言质感 = 词汇丰富度 × 0.6 + 修辞密度 × 0.4'
          + '（取自 WritingQualityEngine.languageQuality.details，不引入第二套文本评分）',
        ];
        details = { ...source.details, ...derived.details };
      } else {
        basis = ['统一内核：语言质量原值（V1 未产出词汇/修辞子项，无法派生文采口径）'];
      }
    }

    return {
      dimension,
      score,
      basis,
      issues: source.suggestions
        .filter(s => s.priority === 'high')
        .map(s => ({ id: s.id, dimension, description: s.content, severity: 'high' as const })),
      suggestions: source.suggestions.map(s => ({
        id: s.id,
        dimension,
        content: s.content,
        priority: s.priority,
        estimatedEffort: s.estimatedEffort,
      })),
      details,
    };
  }

  /**
   * 从 V1 已产出的子项派生「语言质感」（文采）分：
   * 词汇丰富度（vocabRichness）+ 修辞密度（rhetoricCount），系数统一在 thresholds。
   * 子项缺失（正文不足门槛时 V1 只返回 note）返回 null，由调用方回退原值。
   */
  private deriveLanguageTextureFromV1(
    source: WritingQualityResult['languageQuality'],
  ): { score: number; details: Record<string, number | string> } | null {
    const vocabPct = Number.parseFloat(String(source.details.vocabRichness ?? ''));
    const rhetoricCount = Number(source.details.rhetoricCount);
    if (!Number.isFinite(vocabPct) || !Number.isFinite(rhetoricCount)) return null;

    const vocabScore = Math.min(100, vocabPct * QSE_CALIBRATION.readability.vocabScale);
    const rhetoricScore = Math.min(100, rhetoricCount * QSE_CALIBRATION.languageTexture.rhetoricPerHit);
    const weights = QSE_SUB_WEIGHTS.languageTextureFromV1;

    return {
      score: Math.round(vocabScore * weights.vocab + rhetoricScore * weights.rhetoric),
      details: {
        vocabScore: Math.round(vocabScore),
        rhetoricScore: Math.round(rhetoricScore),
        derivation: 'vocabRichness×0.6 + rhetoricCount×0.4',
      },
    };
  }

  private async evaluateDimensionInternal(
    text: string,
    dimension: QualityDimension,
    context: EvaluationContext,
    signal?: AbortSignal,
    v1?: WritingQualityResult
  ): Promise<DimensionScore> {
    if (v1) {
      // 统一内核路径：不再走各自的启发式规则，避免同一文本出现两套分
      const mapped = this.mapV1Dimension(v1, dimension);
      const cacheKey = `${dimension}:${this.hashText(text)}`;
      this.dimensionCache.set(cacheKey, mapped);
      return mapped;
    }

    const textHash = this.hashText(text);
    const cacheKey = `${dimension}:${textHash}`;

    // 增量评估：changedRange 不含人物名 → 人物一致性可复用旧缓存；
    // 变更范围包含人物名时必须绕过缓存重算（旧分对应的是旧正文）。
    // 其余维度与无 changedRange 时保持一致，照常查缓存。
    const canSkip = this.canSkipDimension(dimension, text, context);
    if (!(context.changedRange && !canSkip)) {
      const cached = this.dimensionCache.get(cacheKey);
      if (cached) {
        return cached;
      }
    }

    this.throwIfAborted(signal);

    let result: DimensionScore;
    switch (dimension) {
      case 'readability':
        result = this.evaluateReadability(text, context);
        break;
      case 'rhythm':
        result = await this.evaluateRhythm(text, context, signal);
        break;
      case 'emotion':
        result = await this.evaluateEmotion(text, context, signal);
        break;
      case 'characterConsistency':
        result = await this.evaluateCharacterConsistency(text, context, signal);
        break;
      case 'coherence':
        result = this.evaluateCoherence(text, context);
        break;
      case 'languageTexture':
        result = this.evaluateLanguageTexture(text, context);
        break;
      default:
        result = this.getEmptyDimension(dimension);
    }

    this.dimensionCache.set(cacheKey, result);
    return result;
  }

  // ── 维度 1：可读性 ───────────────────────────────────────

  /**
   * 可读性维度：句长适中度、段落结构、标点使用、语言流畅度
   * 复用 V1 WritingQualityEngine 的 languageQuality（含句式多样性、词汇丰富度、用字问题）
   */
  private evaluateReadability(text: string, context: EvaluationContext): DimensionScore {
    const basis: string[] = [
      '句长适中度（平均句长 15-30 字为佳）',
      '句式多样性（长短句搭配）',
      '标点使用规范度',
      '词汇丰富度与重复率',
    ];
    const issues: QualityIssue[] = [];
    const suggestions: ImprovementSuggestion[] = [];
    const details: Record<string, number | string> = {};
    const cal = QSE_CALIBRATION.readability;
    const sw = QSE_SUB_WEIGHTS.readability;

    const sentences = this.splitSentences(text);
    const totalSentences = sentences.length;
    const paragraphs = this.splitParagraphs(text);

    // 句长统计
    const sentenceLengths = sentences.map((s) => s.length);
    const avgSentenceLen =
      totalSentences > 0
        ? sentenceLengths.reduce((a, b) => a + b, 0) / totalSentences
        : 0;
    const sentenceVariance =
      totalSentences > 1
        ? sentenceLengths.reduce(
            (sum, len) => sum + Math.pow(len - avgSentenceLen, 2),
            0
          ) / totalSentences
        : 0;
    const sentenceStdDev = Math.sqrt(sentenceVariance);
    const sentenceVariety = Math.min(
      100,
      (sentenceStdDev / Math.max(1, avgSentenceLen)) * cal.sentenceVarietyScale
    );

    details.avgSentenceLen = Math.round(avgSentenceLen) + '字';
    details.sentenceVariety = Math.round(sentenceVariety) + '%';
    details.paragraphCount = paragraphs.length;

    // 标点使用
    const punctuationCount = (text.match(/[，。！？、；：""''（）【】《》…—]/g) || []).length;
    const punctRatio = text.length > 0 ? punctuationCount / text.length : 0;
    details.punctRatio = (Math.round(punctRatio * 1000) / 10) + '%';
    // 理想标点密度约 5%-12%
    const punctScore = this.scoreInRange(
      punctRatio,
      cal.idealPunctMin,
      cal.idealPunctMax,
      cal.hardPunctMin,
      cal.hardPunctMax
    );

    // 词汇丰富度
    const uniqueChars = new Set(
      text.replace(/[\s\n，。！？、；：""''（）【】《》…—]/g, '')
    ).size;
    const totalChars = text.replace(
      /[\s\n，。！？、；：""''（）【】《》…—]/g,
      ''
    ).length;
    const vocabRichness =
      totalChars > 0 ? (uniqueChars / Math.min(totalChars, cal.vocabSampleCap)) * 100 : 0;
    details.vocabRichness = Math.round(vocabRichness) + '%';

    // 用字问题检测
    const typoPatterns = [
      { pattern: /的得地/g, label: '的/得/地混用' },
      { pattern: /在再/g, label: '在/再混用' },
      { pattern: /那哪/g, label: '那/哪混用' },
      { pattern: /已以/g, label: '已/以混用' },
    ];
    const typoIssues: string[] = [];
    let typoPenalty = 0;
    for (const { pattern, label } of typoPatterns) {
      const count = (text.match(pattern) || []).length;
      if (count > 0) {
        typoIssues.push(label);
        typoPenalty += count * cal.typoPenaltyPerHit;
        // 全局正则无 index，用非全局正则获取首次匹配位置
        const match = new RegExp(pattern.source).exec(text);
        if (match && match.index !== undefined) {
          issues.push({
            id: `readability_typo_${label}_${issues.length}`,
            dimension: 'readability',
            description: `可能存在用字问题：${label}`,
            severity: 'high',
            location: { charOffset: match.index, length: match[0].length },
          });
        }
      }
    }
    details.typoIssues = typoIssues.length > 0 ? typoIssues.join('、') : '无';

    // 重复用字检测
    const repeatPattern = /(.{2,})\1{2,}/g;
    const repeatMatches = text.match(repeatPattern) || [];
    details.repetitionCount = repeatMatches.length;
    const repeatPenalty = repeatMatches.length * cal.repeatPenaltyPerHit;

    // 句长适中度评分（15-30 字为佳）
    const lenScore = this.scoreInRange(
      avgSentenceLen,
      cal.idealSentenceMin,
      cal.idealSentenceMax,
      cal.hardSentenceMin,
      cal.hardSentenceMax
    );
    const varietyScore = sentenceVariety;
    const vocabScore = Math.min(100, vocabRichness * cal.vocabScale);
    const finalTypoScore = Math.max(0, 100 - typoPenalty - repeatPenalty);

    const score = Math.round(
      lenScore * sw.sentenceLength +
        varietyScore * sw.variety +
        vocabScore * sw.vocab +
        punctScore * sw.punctuation +
        finalTypoScore * sw.typo
    );

    // 生成建议
    if (avgSentenceLen > 40) {
      suggestions.push({
        id: 'readability_long_sentence',
        dimension: 'readability',
        content: '平均句长偏长，建议拆分长句，提升可读性',
        priority: 'medium',
        estimatedEffort: '小',
      });
    }
    if (avgSentenceLen < 8 && totalSentences > 10) {
      suggestions.push({
        id: 'readability_short_sentence',
        dimension: 'readability',
        content: '句子过短，建议适当扩充细节，避免碎片化',
        priority: 'medium',
        estimatedEffort: '小',
      });
    }
    if (sentenceVariety < 30 && totalSentences > 10) {
      suggestions.push({
        id: 'readability_variety',
        dimension: 'readability',
        content: '句式变化较少，建议穿插使用不同长度的句子',
        priority: 'medium',
        estimatedEffort: '中等',
      });
    }
    if (vocabRichness < 40) {
      suggestions.push({
        id: 'readability_vocab',
        dimension: 'readability',
        content: '用词较为单一，建议增加词汇丰富度，使用更多近义词',
        priority: 'medium',
        estimatedEffort: '中等',
      });
    }
    if (typoIssues.length > 0) {
      suggestions.push({
        id: 'readability_typo',
        dimension: 'readability',
        content: `可能存在用字问题：${typoIssues.join('、')}，建议检查`,
        priority: 'high',
        estimatedEffort: '小',
      });
    }
    if (repeatMatches.length > 2) {
      suggestions.push({
        id: 'readability_repeat',
        dimension: 'readability',
        content: '存在重复用字/词现象，建议精简表达，避免冗余重复',
        priority: 'medium',
        estimatedEffort: '小',
      });
    }

    return {
      dimension: 'readability',
      score: Math.min(100, Math.max(0, score)),
      basis,
      issues,
      suggestions,
      details,
    };
  }

  // ── 维度 2：节奏 ────────────────────────────────────────

  /**
   * 节奏维度：快慢节奏交替、张弛有度、高潮分布
   * 复用 RhythmAnalyzer（若注入），否则使用内置规则
   */
  private async evaluateRhythm(
    text: string,
    context: EvaluationContext,
    signal?: AbortSignal
  ): Promise<DimensionScore> {
    const basis: string[] = [
      '快慢节奏交替（fast/medium/slow 分布）',
      '张弛有度（动作/对话/描写/内心戏均衡）',
      '高潮分布（紧张度峰值分布）',
    ];
    const issues: QualityIssue[] = [];
    const suggestions: ImprovementSuggestion[] = [];
    const details: Record<string, number | string> = {};
    const cal = QSE_CALIBRATION.rhythmAnalyzer;
    const sw = QSE_SUB_WEIGHTS.rhythmAnalyzer;

    // 若注入了 RhythmAnalyzer，调用它
    if (this.rhythmAnalyzer) {
      const analysis = await this.rhythmAnalyzer.analyze(text);
      this.throwIfAborted(signal);

      const segments = analysis.segments;
      const total = segments.length;
      const paceCounts = { fast: 0, medium: 0, slow: 0 };
      const typeCounts = { action: 0, dialogue: 0, description: 0, introspection: 0 };

      for (const seg of segments) {
        paceCounts[seg.pace]++;
        typeCounts[seg.type]++;
      }

      details.totalSegments = total;
      details.fastPaceRatio = total > 0 ? Math.round((paceCounts.fast / total) * 100) + '%' : '0%';
      details.slowPaceRatio = total > 0 ? Math.round((paceCounts.slow / total) * 100) + '%' : '0%';
      details.overallPace = analysis.overallPace;

      // 节奏多样性：三种 pace 分布越均匀越好
      const paceVariety =
        total > 0
          ? this.calculateDiversity([
              paceCounts.fast,
              paceCounts.medium,
              paceCounts.slow,
            ])
          : 0;
      details.paceVariety = Math.round(paceVariety) + '%';

      // 类型多样性
      const typeDiversity =
        total > 0
          ? this.calculateDiversity([
              typeCounts.action,
              typeCounts.dialogue,
              typeCounts.description,
              typeCounts.introspection,
            ])
          : 0;
      details.typeDiversity = Math.round(typeDiversity) + '%';

      // 紧张度峰值分布
      const tensions = segments.map((s) => s.tensionLevel);
      const avgTension =
        tensions.length > 0
          ? tensions.reduce((a, b) => a + b, 0) / tensions.length
          : 0;
      const maxTension = tensions.length > 0 ? Math.max(...tensions) : 0;
      details.avgTension = Math.round(avgTension);
      details.maxTension = maxTension;

      // 节奏分数
      const balanceScore = Math.min(100, paceVariety);
      const typeScore = Math.min(100, typeDiversity);
      const tensionScore = Math.min(100, avgTension * cal.tensionAvgWeight + maxTension * cal.tensionMaxWeight);

      const score = Math.round(
        balanceScore * sw.paceVariety + typeScore * sw.typeDiversity + tensionScore * sw.tension
      );

      // 生成建议
      for (const seg of analysis.suggestions) {
        suggestions.push({
          id: `rhythm_analyzer_${suggestions.length}`,
          dimension: 'rhythm',
          content: seg,
          priority: 'medium',
        });
      }
      if (paceCounts.slow > total * cal.dominantPaceRatio && total > cal.minSegments) {
        issues.push({
          id: 'rhythm_too_slow',
          dimension: 'rhythm',
          description: '整体节奏偏慢，慢节奏段落占比过高',
          severity: 'medium',
        });
        suggestions.push({
          id: 'rhythm_speed_up',
          dimension: 'rhythm',
          content: '整体节奏偏慢，建议增加动作或对话场景提升节奏',
          priority: 'high',
          estimatedEffort: '中等',
        });
      }
      if (paceCounts.fast > total * cal.dominantPaceRatio && total > cal.minSegments) {
        issues.push({
          id: 'rhythm_too_fast',
          dimension: 'rhythm',
          description: '整体节奏偏快，缺乏缓冲',
          severity: 'medium',
        });
        suggestions.push({
          id: 'rhythm_slow_down',
          dimension: 'rhythm',
          content: '整体节奏偏快，建议穿插描写或内心戏调节',
          priority: 'medium',
          estimatedEffort: '中等',
        });
      }

      return {
        dimension: 'rhythm',
        score: Math.min(100, Math.max(0, score)),
        basis,
        issues,
        suggestions,
        details,
      };
    }

    // 降级：使用内置规则（复用 V1 节奏逻辑）
    return this.evaluateRhythmFallback(text, basis, issues, suggestions, details);
  }

  private evaluateRhythmFallback(
    text: string,
    basis: string[],
    issues: QualityIssue[],
    suggestions: ImprovementSuggestion[],
    details: Record<string, number | string>
  ): DimensionScore {
    const RHYTHM_VERBS = [
      '冲', '打', '砍', '刺', '杀', '击', '扑', '跃', '闪', '躲',
      '跑', '追', '逃', '赶', '撞', '砸', '摔', '飞', '落', '起',
    ];
    const DIALOGUE_MARKERS = [
      '说', '道', '问', '答', '喊', '叫', '吼', '哭', '笑', '叹',
    ];
    const DESCRIPTION_WORDS = [
      '的', '了', '着', '是', '在', '有', '很', '都', '就', '又',
    ];

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

    const actionRatio = text.length > 0 ? (actionCount / text.length) * 100 : 0;
    const dialogueRatio = text.length > 0 ? (dialogueCount / text.length) * 100 : 0;
    const descRatio = text.length > 0 ? (descCount / text.length) * 100 : 0;

    details.actionDensity = Math.round(actionRatio * 10) / 10;
    details.dialogueDensity = Math.round(dialogueRatio * 10) / 10;
    details.descriptionDensity = Math.round(descRatio * 10) / 10;

    // 平衡度评分
    const balanceScore = this.calculateBalanceScore(actionRatio, dialogueRatio, descRatio);
    details.balanceScore = Math.round(balanceScore) + '%';

    const score = Math.round(balanceScore);

    if (actionRatio < 1.5 && text.length > 1000) {
      issues.push({
        id: 'rhythm_action_low',
        dimension: 'rhythm',
        description: '动作描写偏少',
        severity: 'medium',
      });
      suggestions.push({
        id: 'rhythm_action',
        dimension: 'rhythm',
        content: '动作描写偏少，建议增加角色行为和动态描写提升节奏',
        priority: 'medium',
        estimatedEffort: '中等',
      });
    }
    if (descRatio > 20) {
      issues.push({
        id: 'rhythm_desc_high',
        dimension: 'rhythm',
        description: '静态描写过多，可能拖慢节奏',
        severity: 'medium',
      });
      suggestions.push({
        id: 'rhythm_too_much_desc',
        dimension: 'rhythm',
        content: '静态描写过多可能拖慢节奏，建议精简描写，穿插动态情节',
        priority: 'medium',
        estimatedEffort: '中等',
      });
    }

    return {
      dimension: 'rhythm',
      score: Math.min(100, Math.max(0, score)),
      basis,
      issues,
      suggestions,
      details,
    };
  }

  // ── 维度 3：情绪饱满度 ───────────────────────────────────

  /**
   * 情绪饱满度维度：情绪表达丰富度、情绪变化自然度
   * 复用 EmotionCurveAnalyzer（若注入），否则使用内置规则
   */
  private async evaluateEmotion(
    text: string,
    context: EvaluationContext,
    signal?: AbortSignal
  ): Promise<DimensionScore> {
    const basis: string[] = [
      '情绪表达丰富度（情绪词汇密度）',
      '情绪变化自然度（波动度与弧线类型）',
      '情绪强度分布',
    ];
    const issues: QualityIssue[] = [];
    const suggestions: ImprovementSuggestion[] = [];
    const details: Record<string, number | string> = {};
    const cal = QSE_CALIBRATION.emotionAnalyzer;
    const sw = QSE_SUB_WEIGHTS.emotionAnalyzer;

    // 若注入了 EmotionCurveAnalyzer
    if (this.emotionAnalyzer) {
      const curve = await this.emotionAnalyzer.analyze(text);
      this.throwIfAborted(signal);

      const points = curve.points;
      const totalPoints = points.length;

      details.totalPoints = totalPoints;
      details.dominantEmotion = curve.dominantEmotion;
      details.volatility = curve.volatility;
      details.arcType = curve.arcType;

      // 情绪丰富度：不同情绪类型数量
      const emotionTypes = new Set(points.map((p) => p.emotion));
      details.emotionVariety = emotionTypes.size;

      // 平均强度
      const avgIntensity =
        totalPoints > 0
          ? points.reduce((sum, p) => sum + p.intensity, 0) / totalPoints
          : 0;
      details.avgIntensity = Math.round(avgIntensity);

      // 情绪分数
      const varietyScore = Math.min(100, emotionTypes.size * cal.varietyPerType);
      const intensityScore = Math.min(100, avgIntensity);
      // 波动度适中为佳（过高=跳跃，过低=平淡）
      const volatilityScore = this.scoreInRange(
        curve.volatility,
        cal.idealVolatilityMin,
        cal.idealVolatilityMax,
        cal.hardVolatilityMin,
        cal.hardVolatilityMax
      );
      // 弧线类型：wave > rise/fall > flat
      const arcScore =
        curve.arcType === 'wave'
          ? cal.arcWaveScore
          : curve.arcType === 'rise' || curve.arcType === 'fall'
            ? cal.arcRiseFallScore
            : cal.arcFlatScore;

      const score = Math.round(
        varietyScore * sw.variety +
          intensityScore * sw.intensity +
          volatilityScore * sw.volatility +
          arcScore * sw.arc
      );

      if (totalPoints === 0) {
        issues.push({
          id: 'emotion_no_points',
          dimension: 'emotion',
          description: '无法提取情绪节点',
          severity: 'medium',
        });
      }
      if (avgIntensity < 30) {
        issues.push({
          id: 'emotion_low_intensity',
          dimension: 'emotion',
          description: '情绪强度偏低，表达不够饱满',
          severity: 'low',
        });
        suggestions.push({
          id: 'emotion_intensity',
          dimension: 'emotion',
          content: '情绪强度偏低，建议加强情感表达和心理活动描写',
          priority: 'medium',
          estimatedEffort: '中等',
        });
      }
      if (curve.volatility > 50) {
        issues.push({
          id: 'emotion_too_volatile',
          dimension: 'emotion',
          description: '情绪波动过大，变化不够自然',
          severity: 'medium',
        });
        suggestions.push({
          id: 'emotion_smooth',
          dimension: 'emotion',
          content: '情绪变化过于剧烈，建议增加过渡描写使情绪转折更自然',
          priority: 'medium',
          estimatedEffort: '中等',
        });
      }
      if (curve.arcType === 'flat' && totalPoints > 3) {
        issues.push({
          id: 'emotion_flat',
          dimension: 'emotion',
          description: '情绪弧线过于平淡，缺乏起伏',
          severity: 'low',
        });
        suggestions.push({
          id: 'emotion_arc',
          dimension: 'emotion',
          content: '情绪弧线平淡，建议设计情绪起伏增强感染力',
          priority: 'low',
          estimatedEffort: '大',
        });
      }

      return {
        dimension: 'emotion',
        score: Math.min(100, Math.max(0, score)),
        basis,
        issues,
        suggestions,
        details,
      };
    }

    // 降级：内置规则
    return this.evaluateEmotionFallback(text, basis, issues, suggestions, details);
  }

  private evaluateEmotionFallback(
    text: string,
    basis: string[],
    issues: QualityIssue[],
    suggestions: ImprovementSuggestion[],
    details: Record<string, number | string>
  ): DimensionScore {
    const cal = QSE_CALIBRATION.emotionFallback;
    const sw = QSE_SUB_WEIGHTS.emotionFallback;
    const POS_EMOTIONS = [
      '喜悦', '开心', '高兴', '快乐', '幸福', '满足', '欣慰', '激动',
      '兴奋', '期待', '希望', '热情', '感激', '感动', '骄傲', '自豪',
    ];
    const NEG_EMOTIONS = [
      '悲伤', '痛苦', '绝望', '恐惧', '害怕', '愤怒', '生气', '憎恨',
      '厌恶', '嫉妒', '羞愧', '内疚', '后悔', '焦虑', '紧张', '担忧',
    ];

    let posCount = 0;
    for (const w of POS_EMOTIONS) {
      posCount += (text.match(new RegExp(w, 'g')) || []).length;
    }
    let negCount = 0;
    for (const w of NEG_EMOTIONS) {
      negCount += (text.match(new RegExp(w, 'g')) || []).length;
    }

    const totalEmotion = posCount + negCount;
    details.positiveEmotions = posCount;
    details.negativeEmotions = negCount;
    details.totalEmotions = totalEmotion;
    details.emotionDensity =
      text.length > 0 ? (Math.round((totalEmotion / text.length) * 10000) / 100) + '%' : '0%';

    const emotionScore = Math.min(100, totalEmotion * cal.emotionPerHit);
    const balanceScore =
      totalEmotion > 0
        ? Math.min(100, 100 - Math.abs(posCount - negCount) * cal.balancePenaltyPerHit)
        : cal.neutralBalanceScore;

    const score = Math.round(emotionScore * sw.emotion + balanceScore * sw.balance);

    if (totalEmotion < 3 && text.length > 1000) {
      issues.push({
        id: 'emotion_sparse',
        dimension: 'emotion',
        description: '情绪表达稀少',
        severity: 'medium',
      });
      suggestions.push({
        id: 'emotion_add',
        dimension: 'emotion',
        content: '情绪渲染偏弱，建议加强角色的情感表达和心理活动',
        priority: 'medium',
        estimatedEffort: '中等',
      });
    }

    return {
      dimension: 'emotion',
      score: Math.min(100, Math.max(0, score)),
      basis,
      issues,
      suggestions,
      details,
    };
  }

  // ── 维度 4：人物一致性 ───────────────────────────────────

  /**
   * 人物一致性维度：人物行为符合设定、对话风格一致
   * 复用 CharacterConsistencyChecker（若注入），否则使用内置规则
   */
  private async evaluateCharacterConsistency(
    text: string,
    context: EvaluationContext,
    signal?: AbortSignal
  ): Promise<DimensionScore> {
    const basis: string[] = [
      '人物行为符合性格设定',
      '对话风格一致性',
      '外貌描述一致性',
      '能力边界一致性',
    ];
    const issues: QualityIssue[] = [];
    const suggestions: ImprovementSuggestion[] = [];
    const details: Record<string, number | string> = {};

    const characterInfos = context.characterInfos || [];
    const characterNames = context.characterNames || characterInfos.map((c) => c.name);

    // 若注入了 CharacterConsistencyChecker 且有人物设定
    if (this.characterChecker && characterInfos.length > 0) {
      const result = await this.characterChecker.check(text, characterInfos);
      this.throwIfAborted(signal);

      details.overallScore = result.overallScore;
      details.checkedCharacters = Object.keys(result.characterResults).length;

      // 收集问题
      for (const [name, charResult] of Object.entries(result.characterResults)) {
        for (const inc of charResult.inconsistencies) {
          issues.push({
            id: `char_${name}_${inc.type}_${issues.length}`,
            dimension: 'characterConsistency',
            description: `[${name}] ${inc.description}`,
            severity: inc.severity,
          });
          if (inc.suggestion) {
            suggestions.push({
              id: `char_suggest_${name}_${inc.type}_${suggestions.length}`,
              dimension: 'characterConsistency',
              content: inc.suggestion,
              priority: inc.severity === 'high' ? 'high' : inc.severity === 'medium' ? 'medium' : 'low',
            });
          }
        }
      }

      const score = result.overallScore;

      if (issues.filter((i) => i.severity === 'high').length > 0) {
        suggestions.push({
          id: 'char_fix_high',
          dimension: 'characterConsistency',
          content: '存在严重的人设不一致，建议优先修正高严重度问题',
          priority: 'high',
          estimatedEffort: '大',
        });
      }

      return {
        dimension: 'characterConsistency',
        score: Math.min(100, Math.max(0, score)),
        basis,
        issues,
        suggestions,
        details,
      };
    }

    // 降级：内置规则（基于人物出场与对话）
    return this.evaluateCharacterFallback(
      text,
      characterNames,
      basis,
      issues,
      suggestions,
      details
    );
  }

  private evaluateCharacterFallback(
    text: string,
    characterNames: string[],
    basis: string[],
    issues: QualityIssue[],
    suggestions: ImprovementSuggestion[],
    details: Record<string, number | string>
  ): DimensionScore {
    const cal = QSE_CALIBRATION.characterFallback;
    const sw = QSE_SUB_WEIGHTS.characterFallback;
    let charMentionCount = 0;
    const charMentions: Record<string, number> = {};

    if (characterNames.length > 0) {
      for (const name of characterNames) {
        if (!name || name.length < 2) continue;
        const count = (text.match(new RegExp(this.escapeRegex(name), 'g')) || []).length;
        if (count > 0) {
          charMentions[name] = count;
          charMentionCount += count;
        }
      }
    }

    details.characterMentions = charMentionCount;
    details.uniqueCharacters = Object.keys(charMentions).length;

    // 对话个性化检测
    const dialogues: string[] = [];
    const dialogPattern = /"([^"]*)"|「([^」]*)」|『([^』]*)』/g;
    let match;
    while ((match = dialogPattern.exec(text)) !== null) {
      const dialog = match[1] || match[2] || match[3];
      if (dialog && dialog.length > 1) {
        dialogues.push(dialog);
      }
    }
    details.dialogueCount = dialogues.length;

    let dialoguePersonality = 50;
    if (dialogues.length >= cal.minDialogues) {
      const uniqueStarts = new Set(dialogues.map((d) => d.slice(0, 2)));
      const uniqueEnds = new Set(dialogues.map((d) => d.slice(-2)));
      const startVariety = (uniqueStarts.size / dialogues.length) * 100;
      const endVariety = (uniqueEnds.size / dialogues.length) * 100;
      dialoguePersonality = Math.min(
        100,
        startVariety * cal.startWeight + endVariety * cal.endWeight + cal.personalityBase
      );
    }
    details.dialoguePersonality = Math.round(dialoguePersonality) + '%';

    const mentionScore = Math.min(100, charMentionCount * cal.mentionScale);
    const score = Math.round(mentionScore * sw.mention + dialoguePersonality * sw.personality);

    if (characterNames.length > 0 && charMentionCount === 0) {
      issues.push({
        id: 'char_no_mention',
        dimension: 'characterConsistency',
        description: '设定人物未在正文中出现',
        severity: 'medium',
      });
      suggestions.push({
        id: 'char_add_mention',
        dimension: 'characterConsistency',
        content: '主要角色未出场，建议增加主角视角和互动场景',
        priority: 'high',
        estimatedEffort: '中等',
      });
    }
    if (dialoguePersonality < 40 && dialogues.length > 5) {
      issues.push({
        id: 'char_low_personality',
        dimension: 'characterConsistency',
        description: '对话辨识度不高',
        severity: 'low',
      });
      suggestions.push({
        id: 'char_personality',
        dimension: 'characterConsistency',
        content: '对话辨识度不高，建议为不同角色设计独特的说话风格和口头禅',
        priority: 'medium',
        estimatedEffort: '中等',
      });
    }

    return {
      dimension: 'characterConsistency',
      score: Math.min(100, Math.max(0, score)),
      basis,
      issues,
      suggestions,
      details,
    };
  }

  // ── 维度 5：情节连贯性 ───────────────────────────────────

  /**
   * 情节连贯性维度：前后逻辑一致、因果链完整、时间线正确
   * 复用 analyzeCoherence（冗余/重复检测）+ 因果链检测
   */
  private evaluateCoherence(text: string, context: EvaluationContext): DimensionScore {
    const basis: string[] = [
      '重复句子检测（前后文冗余）',
      '高频重复短语检测',
      '过度用词检测',
      '因果链完整度（因果关联词密度）',
    ];
    const issues: QualityIssue[] = [];
    const suggestions: ImprovementSuggestion[] = [];
    const details: Record<string, number | string> = {};
    const cal = QSE_CALIBRATION.coherence;
    const sw = QSE_SUB_WEIGHTS.coherence;

    // 复用 CoherenceChecker
    const report: CoherenceReport = analyzeCoherence(text);
    details.sentenceCount = report.sentenceCount;
    details.coherenceIssues = report.issues.length;

    // 因果链检测
    const causalityPatterns = [
      /因为|所以|因此|于是|结果|导致|造成/g,
      /虽然|但是|然而|可是|却/g,
      /如果|那么|就|只要|就/g,
    ];
    let causalityCount = 0;
    for (const pattern of causalityPatterns) {
      causalityCount += (text.match(pattern) || []).length;
    }
    details.causalityIndicators = causalityCount;

    // 时间线检测
    const timelinePatterns = [
      /先|然后|接着|随后|之后|最后|最终/g,
      /此时|此刻|这时|那时|同时|与此同时/g,
      /第[一二三四五六七八九十]天|次日|几天后|不久|片刻后/g,
    ];
    let timelineCount = 0;
    for (const pattern of timelinePatterns) {
      timelineCount += (text.match(pattern) || []).length;
    }
    details.timelineIndicators = timelineCount;

    // 评分：issues 越少分越高
    const issuePenalty = report.issues.reduce((sum, issue) => {
      const base =
        issue.type === 'duplicate_sentence'
          ? cal.duplicateSentencePenalty
          : issue.type === 'repeated_phrase'
            ? cal.repeatedPhrasePenalty
            : cal.otherPenalty;
      return sum + base * Math.min(issue.count, cal.countCap);
    }, 0);

    const causalityScore = Math.min(100, cal.causalityBase + causalityCount * cal.causalityPerHit);
    const timelineScore = Math.min(100, cal.timelineBase + timelineCount * cal.timelinePerHit);
    const coherenceScore = Math.max(0, 100 - issuePenalty);

    const score = Math.round(
      coherenceScore * sw.coherence + causalityScore * sw.causality + timelineScore * sw.timeline
    );

    // 生成问题
    for (const issue of report.issues) {
      // 用 sample 在原文定位首现位置，供质量仪表盘局部重写取段落
      // （sample 为句内连续子串，跨句拼接的假 gram 找不到时 location 留空，UI 走兜底提示）
      const idx = issue.sample ? text.indexOf(issue.sample) : -1;
      issues.push({
        id: `coherence_${issue.type}_${issues.length}`,
        dimension: 'coherence',
        description: issue.message,
        severity: issue.type === 'duplicate_sentence' ? 'high' : 'medium',
        location: idx >= 0 ? { charOffset: idx, length: issue.sample.length } : undefined,
      });
    }

    if (report.issues.length > 0) {
      suggestions.push({
        id: 'coherence_fix_repetition',
        dimension: 'coherence',
        content: '存在重复/冗余内容，建议精简或改写重复部分',
        priority: report.issues.some((i) => i.type === 'duplicate_sentence') ? 'high' : 'medium',
        estimatedEffort: '小',
      });
    }
    if (causalityCount < 3 && text.length > 1000) {
      issues.push({
        id: 'coherence_low_causality',
        dimension: 'coherence',
        description: '因果关联词偏少，逻辑链不够清晰',
        severity: 'low',
      });
      suggestions.push({
        id: 'coherence_add_causality',
        dimension: 'coherence',
        content: '因果关系不够清晰，建议强化事件之间的逻辑关联',
        priority: 'medium',
        estimatedEffort: '中等',
      });
    }

    return {
      dimension: 'coherence',
      score: Math.min(100, Math.max(0, score)),
      basis,
      issues,
      suggestions,
      details,
    };
  }

  // ── 维度 6：语言质感 ─────────────────────────────────────

  /**
   * 语言质感维度：用词精准度、修辞丰富度、风格统一性
   * 新实现（结合风格指纹）
   */
  private evaluateLanguageTexture(text: string, context: EvaluationContext): DimensionScore {
    const basis: string[] = [
      '修辞手法丰富度（比喻/排比/夸张/反问等）',
      '用词精准度（实词与虚词比例）',
      '风格统一性（与风格指纹的匹配度）',
      '语言独特性（个性化表达）',
    ];
    const issues: QualityIssue[] = [];
    const suggestions: ImprovementSuggestion[] = [];
    const details: Record<string, number | string> = {};
    const cal = QSE_CALIBRATION.languageTexture;
    const sw = QSE_SUB_WEIGHTS.languageTexture;

    // 修辞检测
    const RHETORIC_PATTERNS = [
      { pattern: /像|如|似|仿佛|犹如|宛如|如同|好似|宛若|恰似/g, label: '比喻' },
      { pattern: /是…也是…|不仅…而且…|虽然…但是…|因为…所以…/g, label: '复句' },
      { pattern: /难道|怎么会|怎能|岂会/g, label: '反问' },
      { pattern: /有的…有的…还有的…|一边…一边…|既…又…|不但…而且…/g, label: '排比' },
      { pattern: /简直|要命|要死|不得了|够呛/g, label: '夸张' },
    ];

    let rhetoricCount = 0;
    const rhetoricTypes: string[] = [];
    for (const { pattern, label } of RHETORIC_PATTERNS) {
      const count = (text.match(pattern) || []).length;
      if (count > 0) {
        rhetoricCount += count;
        rhetoricTypes.push(label);
      }
    }
    details.rhetoricCount = rhetoricCount;
    details.rhetoricTypes = rhetoricTypes.length > 0 ? rhetoricTypes.join('、') : '无';

    const rhetoricScore = Math.min(100, rhetoricCount * cal.rhetoricPerHit);

    // 用词精准度：实词比例
    const meaningfulChars = text.replace(
      /[的地得了着过吗呢吧啊，。！？、；：""''（）【】《》…—\s\n]/g,
      ''
    );
    const precisionRatio =
      text.length > 0 ? meaningfulChars.length / text.length : 0;
    details.precisionRatio = (Math.round(precisionRatio * 1000) / 10) + '%';
    const precisionScore = this.scoreInRange(
      precisionRatio,
      cal.idealPrecisionMin,
      cal.idealPrecisionMax,
      cal.hardPrecisionMin,
      cal.hardPrecisionMax
    );

    // 风格统一性：与风格指纹匹配
    let styleScore: number = cal.defaultStyleScore; // 默认
    if (context.styleFingerprint && Object.keys(context.styleFingerprint).length > 0) {
      // 计算当前文本的风格特征
      const currentFingerprint = this.extractStyleFeatures(text);
      details.currentStyle = JSON.stringify(currentFingerprint).slice(0, 80);
      // 与目标指纹对比（简单匹配）
      let matchCount = 0;
      let totalCount = 0;
      for (const [key, target] of Object.entries(context.styleFingerprint)) {
        const current = currentFingerprint[key] || 0;
        const diff = Math.abs(current - target);
        if (diff < cal.styleMatchTolerance) matchCount++;
        totalCount++;
      }
      styleScore = totalCount > 0 ? Math.round((matchCount / totalCount) * 100) : cal.defaultStyleScore;
      details.styleMatch = styleScore + '%';
    }

    // 语言独特性：罕见用字比例
    const commonChars = new Set('的一是不了在和有我就他都这个人上来到过时要为他她说也');
    const allChars = text.replace(/[\s\n，。！？、；：""''（）【】《》…—]/g, '').split('');
    const rareChars = allChars.filter((c) => !commonChars.has(c) && /[\u4e00-\u9fa5]/.test(c));
    const rareRatio = allChars.length > 0 ? rareChars.length / allChars.length : 0;
    details.rareCharRatio = (Math.round(rareRatio * 1000) / 10) + '%';
    const uniquenessScore = Math.min(100, rareRatio * cal.rareCharScale);

    const score = Math.round(
      rhetoricScore * sw.rhetoric +
        precisionScore * sw.precision +
        styleScore * sw.style +
        uniquenessScore * sw.uniqueness
    );

    if (rhetoricCount < 3 && text.length > 1000) {
      issues.push({
        id: 'texture_low_rhetoric',
        dimension: 'languageTexture',
        description: '修辞手法运用较少',
        severity: 'low',
      });
      suggestions.push({
        id: 'texture_rhetoric',
        dimension: 'languageTexture',
        content: '修辞手法运用较少，建议适当使用比喻、拟人、排比等修辞增强文采',
        priority: 'low',
        estimatedEffort: '中等',
      });
    }
    if (precisionRatio < 0.5) {
      issues.push({
        id: 'texture_low_precision',
        dimension: 'languageTexture',
        description: '虚词比例偏高，用词不够精准',
        severity: 'medium',
      });
      suggestions.push({
        id: 'texture_precision',
        dimension: 'languageTexture',
        content: '用词不够精准，建议减少虚词使用，增加实词密度',
        priority: 'medium',
        estimatedEffort: '中等',
      });
    }
    if (context.styleFingerprint && styleScore < 60) {
      issues.push({
        id: 'texture_style_mismatch',
        dimension: 'languageTexture',
        description: '当前风格与目标风格指纹匹配度较低',
        severity: 'medium',
      });
      suggestions.push({
        id: 'texture_style',
        dimension: 'languageTexture',
        content: '风格统一性不足，建议对照风格指纹调整用词和句式',
        priority: 'medium',
        estimatedEffort: '大',
      });
    }

    return {
      dimension: 'languageTexture',
      score: Math.min(100, Math.max(0, score)),
      basis,
      issues,
      suggestions,
      details,
    };
  }

  // ── 工具方法 ─────────────────────────────────────────────

  /** 清理 frontmatter */
  private cleanText(text: string): string {
    return text.replace(/^---\n[\s\S]*?\n---\n?/, '').trim();
  }

  /** 计算文本哈希（简单 djb2） */
  private hashText(text: string): string {
    let hash = 5381;
    for (let i = 0; i < text.length; i++) {
      hash = ((hash << 5) + hash + text.charCodeAt(i)) & 0x7fffffff;
    }
    return hash.toString(36);
  }

  private splitSentences(text: string): string[] {
    return text
      .split(/[。！？!?]+/)
      .filter((s) => s.trim().length > 0);
  }

  private splitParagraphs(text: string): string[] {
    return text
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * 在理想区间内得分 100，偏离递减
   * @param value 当前值
   * @param idealMin 理想最小值
   * @param idealMax 理想最大值
   * @param hardMin 硬性最小值（低于此为 0 分）
   * @param hardMax 硬性最大值（高于此为 0 分）
   */
  private scoreInRange(
    value: number,
    idealMin: number,
    idealMax: number,
    hardMin: number,
    hardMax: number
  ): number {
    if (value >= idealMin && value <= idealMax) return 100;
    if (value < hardMin || value > hardMax) return 0;
    if (value < idealMin) {
      return Math.round(((value - hardMin) / (idealMin - hardMin)) * 100);
    }
    return Math.round(((hardMax - value) / (hardMax - idealMax)) * 100);
  }

  /** 计算分布多样性（基于熵） */
  private calculateDiversity(counts: number[]): number {
    const total = counts.reduce((a, b) => a + b, 0);
    if (total === 0) return 0;
    let entropy = 0;
    for (const c of counts) {
      if (c > 0) {
        const p = c / total;
        entropy -= p * Math.log2(p);
      }
    }
    const maxEntropy = Math.log2(counts.length);
    return maxEntropy > 0 ? (entropy / maxEntropy) * 100 : 0;
  }

  /** 计算平衡度评分 */
  private calculateBalanceScore(
    actionRatio: number,
    dialogueRatio: number,
    descRatio: number
  ): number {
    const cal = QSE_CALIBRATION.rhythmFallback;
    const idealAction = cal.idealActionRatio;
    const idealDialogue = cal.idealDialogueRatio;
    const idealDesc = cal.idealDescRatio;

    const actionDeviation = Math.abs(actionRatio - idealAction) / idealAction;
    const dialogueDeviation = Math.abs(dialogueRatio - idealDialogue) / idealDialogue;
    const descDeviation = Math.abs(descRatio - idealDesc) / idealDesc;

    const totalDeviation = (actionDeviation + dialogueDeviation + descDeviation) / 3;
    return Math.max(0, Math.min(100, 100 - totalDeviation * cal.deviationScale));
  }

  /** 提取风格特征 */
  private extractStyleFeatures(text: string): Record<string, number> {
    const features: Record<string, number> = {};
    const sentences = this.splitSentences(text);
    const avgLen =
      sentences.length > 0
        ? sentences.reduce((a, s) => a + s.length, 0) / sentences.length
        : 0;
    features.avgSentenceLen = avgLen;
    const dialogueCount = (text.match(/["「『]/g) || []).length;
    features.dialogueRatio = text.length > 0 ? dialogueCount / text.length : 0;
    const descWords = (text.match(/的|了|着/g) || []).length;
    features.descWordRatio = text.length > 0 ? descWords / text.length : 0;
    return features;
  }

  /** 判断维度是否可跳过（增量评估） */
  private canSkipDimension(
    dimension: QualityDimension,
    text: string,
    context: EvaluationContext
  ): boolean {
    if (!context.changedRange) return false;
    // 人物一致性维度：若变更范围不含人物名，可跳过
    if (dimension === 'characterConsistency') {
      const names = context.characterNames || (context.characterInfos || []).map((c) => c.name);
      if (names.length === 0) return true;
      const changedText = text.slice(context.changedRange.start, context.changedRange.end);
      return !names.some((n) => n && n.length >= 2 && changedText.includes(n));
    }
    return false;
  }

  /** 计算综合评分 */
  private calculateOverallScore(dimensions: Record<QualityDimension, DimensionScore>): number {
    let total = 0;
    for (const dim of QUALITY_DIMENSIONS) {
      total += dimensions[dim].score * DIMENSION_WEIGHTS[dim];
    }
    return Math.min(100, Math.max(0, Math.round(total)));
  }

  /** 收集所有问题 */
  private collectIssues(dimensions: Record<QualityDimension, DimensionScore>): QualityIssue[] {
    const all: QualityIssue[] = [];
    for (const dim of QUALITY_DIMENSIONS) {
      all.push(...dimensions[dim].issues);
    }
    // 按严重度排序
    const order = { high: 0, medium: 1, low: 2 };
    return all.sort((a, b) => order[a.severity] - order[b.severity]);
  }

  /** 收集所有建议（按优先级排序） */
  private collectSuggestions(
    dimensions: Record<QualityDimension, DimensionScore>
  ): ImprovementSuggestion[] {
    const all: ImprovementSuggestion[] = [];
    for (const dim of QUALITY_DIMENSIONS) {
      all.push(...dimensions[dim].suggestions);
    }
    const order = { high: 0, medium: 1, low: 2 };
    return all.sort((a, b) => order[a.priority] - order[b.priority]).slice(0, 10);
  }

  /** 计算趋势 */
  private calculateTrend(currentScore: number): ScoreTrend {
    if (this.history.length < 3) return 'stable';
    const recent = this.history.slice(-5);
    const midPoint = Math.floor(recent.length / 2);
    const firstHalf = recent.slice(0, midPoint);
    const secondHalf = recent.slice(midPoint);
    const firstAvg =
      firstHalf.length > 0
        ? firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length
        : 0;
    const secondAvg =
      secondHalf.length > 0
        ? secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length
        : 0;
    const diff = secondAvg - firstAvg;
    if (diff > 5) return 'rising';
    if (diff < -5) return 'falling';
    return 'stable';
  }

  /** 记录历史 */
  private recordHistory(score: number): void {
    this.history.push(score);
    if (this.history.length > this.historySize) {
      this.history = this.history.slice(-this.historySize);
    }
  }

  /** 检查取消信号 */
  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw new DOMException('评估已取消', 'AbortError');
    }
  }

  /** 空维度结果 */
  private getEmptyDimension(dimension: QualityDimension): DimensionScore {
    return {
      dimension,
      score: 0,
      basis: [],
      issues: [],
      suggestions: [],
      details: { note: '内容不足，无法评估' },
    };
  }

  /** 空评分结果 */
  private getEmptyScore(wordCount: number, startTime: number): QualityScore {
    const dimensions: Record<QualityDimension, DimensionScore> = {} as Record<
      QualityDimension,
      DimensionScore
    >;
    for (const dim of QUALITY_DIMENSIONS) {
      dimensions[dim] = this.getEmptyDimension(dim);
    }
    return {
      overallScore: 0,
      dimensions,
      issues: [],
      suggestions: [
        {
          id: 'empty_continue',
          dimension: 'readability',
          content: '继续写作，系统将自动评估写作质量',
          priority: 'low',
        },
      ],
      evaluatedAt: Date.now(),
      wordCount,
      evalTimeMs: Date.now() - startTime,
      trend: 'stable',
      fromCache: false,
    };
  }
}

// ============================================================
// 七、辅助函数
// ============================================================

/**
 * 获取维度标签
 *
 * @param dimension - 维度
 * @returns 文本结果
 */
export function getDimensionLabel(dimension: QualityDimension): string {
  return DIMENSION_LABELS[dimension] || dimension;
}

/**
 * 获取问题严重度标签
 *
 * @param severity - 严重度
 * @returns 文本结果
 */
export function getSeverityLabel(severity: IssueSeverity): string {
  const labels: Record<IssueSeverity, string> = {
    high: '严重',
    medium: '中等',
    low: '轻微',
  };
  return labels[severity];
}

/**
 * 获取建议优先级标签
 *
 * @param priority - 优先级
 * @returns 文本结果
 */
export function getSuggestionPriorityLabel(priority: SuggestionPriority): string {
  const labels: Record<SuggestionPriority, string> = {
    high: '高优先级',
    medium: '中优先级',
    low: '低优先级',
  };
  return labels[priority];
}

/**
 * 获取趋势标签
 *
 * @param trend - 趋势
 * @returns 文本结果
 */
export function getTrendLabel(trend: ScoreTrend): string {
  const labels: Record<ScoreTrend, string> = {
    rising: '上升',
    falling: '下降',
    stable: '平稳',
  };
  return labels[trend];
}
