/**
 * quality/deviation-detector.ts — 偏离检测引擎（实时监控 V2 Task 2）
 *
 * 检测 5 类偏离：
 *   1. 剧情偏离主线 mainline          — 章节大纲与实际内容对比、关键情节点覆盖、支线偏离
 *   2. 人物 OOC     characterOOC      — 行为/对话/能力是否符合性格设定
 *   3. 前后矛盾     contradiction     — 时间线/设定/战力矛盾
 *   4. 伏笔遗忘     foreshadowForgot   — 追踪埋设的伏笔，N 章后未回收告警
 *   5. 节奏偏离     rhythm            — 大纲预设节奏 vs 实际节奏
 *
 * 设计原则：
 *   - 零外部依赖
 *   - 向后兼容：V1 引擎（PlotDivergenceEngine / CharacterConsistencyChecker / CoherenceChecker / RhythmAnalyzer）完全保留
 *   - 外科手术式改动：不修改现有引擎，通过依赖注入复用
 *   - 增量检测：传入 changedRange 时只检测变更部分相关维度
 *   - 支持取消：传入 AbortSignal
 *   - 结果缓存（复用 LruCache）
 */

import { LruCache } from '../repository/lru-cache';
import { analyzeCoherence, CoherenceReport } from '../coherence-checker';
import type { CharacterContextInfo } from './quality-score-engine';

// ============================================================
// 一、偏离类型与严重度
// ============================================================

export type DeviationType =
  | 'mainline'
  | 'characterOOC'
  | 'contradiction'
  | 'foreshadowForgot'
  | 'rhythm'
  | 'emotionBreak';

export const DEVIATION_TYPES: readonly DeviationType[] = [
  'mainline',
  'characterOOC',
  'contradiction',
  'foreshadowForgot',
  'rhythm',
  'emotionBreak',
] as const;

export const DEVIATION_TYPE_LABELS: Record<DeviationType, string> = {
  mainline: '剧情偏离主线',
  characterOOC: '人物 OOC',
  contradiction: '前后矛盾',
  foreshadowForgot: '伏笔遗忘',
  rhythm: '节奏偏离',
  emotionBreak: '情绪断层',
};

/** 预警级别（由低到高） */
export type DeviationSeverity = 'info' | 'warning' | 'critical';

export const SEVERITY_ORDER: Record<DeviationSeverity, number> = {
  info: 0,
  warning: 1,
  critical: 2,
};

export const SEVERITY_LABELS: Record<DeviationSeverity, string> = {
  info: '提示',
  warning: '警告',
  critical: '严重',
};

// ============================================================
// 二、偏离问题与报告模型
// ============================================================

export interface DeviationLocation {
  /** 行号（1-based） */
  line?: number;
  /** 字符偏移（0-based） */
  charOffset?: number;
  /** 问题文本长度 */
  length?: number;
  /** 涉及人物名（OOC 专用） */
  character?: string;
  /** 涉及的章节 ID（前后矛盾专用） */
  chapterRef?: string;
}

export interface DeviationIssue {
  id: string;
  type: DeviationType;
  severity: DeviationSeverity;
  /** 偏离度 0-100（越高越严重） */
  degree: number;
  description: string;
  location?: DeviationLocation;
  /** 修正建议 */
  suggestion?: string;
  /** 置信度 0-1 */
  confidence?: number;
  /** 证据片段（用于溯源） */
  evidence?: string[];
}

export interface DeviationSuggestion {
  id: string;
  type: DeviationType;
  content: string;
  priority: DeviationSeverity;
  /** 关联的 issue id */
  relatedIssueIds?: string[];
}

export interface DeviationReport {
  /** 总偏离分数 0-100（越高越严重） */
  overallScore: number;
  /** 总体预警级别 */
  overallSeverity: DeviationSeverity;
  /** 各类型偏离分数 */
  typeScores: Record<DeviationType, number>;
  /** 全部问题列表（按严重度倒序） */
  issues: DeviationIssue[];
  /** 改进建议列表（按优先级倒序，最多 10 条） */
  suggestions: DeviationSuggestion[];
  evaluatedAt: number;
  wordCount: number;
  evalTimeMs: number;
  /** 是否命中缓存 */
  fromCache: boolean;
  /** 是否仅做了增量检测 */
  incremental: boolean;
}

// ============================================================
// 三、伏笔追踪模型
// ============================================================

export interface ForeshadowTracking {
  id: string;
  /** 伏笔描述 */
  description: string;
  /** 埋设章节 ID */
  plantedChapterId?: string;
  /** 埋设章节序号（用于计算章节数差距） */
  plantedChapterNum?: number;
  /** 关键词（用于在后续章节正文中检索是否回收） */
  keywords: string[];
  /** 期望回收章节序号（可选） */
  expectedRecoverChapterNum?: number;
  /** 是否已回收 */
  recovered: boolean;
  /** 实际回收章节 ID */
  recoveredChapterId?: string;
  /** 当前章序号（用于计算距离） */
  currentChapterNum?: number;
}

// ============================================================
// 四、检测上下文
// ============================================================

export interface PreviousChapterContext {
  chapterId: string;
  chapterNum: number;
  /** 章节正文（用于前后矛盾检测） */
  text: string;
  /** 该章节 frontmatter（用于读取伏笔标记） */
  frontmatter?: Record<string, unknown>;
}

export interface DeviationContext {
  /** 当前章节 ID */
  chapterId?: string;
  /** 当前章序号（用于伏笔追踪） */
  chapterNum?: number;
  /** 章节大纲（用于剧情偏离主线检测） */
  chapterOutline?: string;
  /** 主线关键词 */
  mainlineKeywords?: string[];
  /** 涉及人物信息（用于 OOC 检测） */
  characterInfos?: CharacterContextInfo[];
  /** 前文章节上下文（用于前后矛盾检测） */
  previousChapters?: PreviousChapterContext[];
  /** 伏笔追踪列表（若不提供，则从 previousChapters 的 frontmatter 解析） */
  foreshadows?: ForeshadowTracking[];
  /** 期望节奏（用于节奏偏离检测） */
  expectedRhythm?: 'fast' | 'medium' | 'slow';
  /** 风格指纹（保留扩展位） */
  styleFingerprint?: Record<string, number>;
  /** 变更范围（用于增量检测，字符偏移） */
  changedRange?: { start: number; end: number };
}

// ============================================================
// 五、依赖注入接口（复用现有引擎，避免循环依赖）
// ============================================================

/** V1 PlotDivergenceEngine 的子集接口 */
export interface IPlotDivergenceEngine {
  updateOptions(options: Record<string, unknown>): void;
  evaluate(text: string): {
    mainlineDivergence: { score: number; issues: string[]; suggestions: string[]; details: Record<string, number | string> };
    characterDivergence: { score: number; issues: string[]; suggestions: string[]; details: Record<string, number | string> };
    rhythmDivergence: { score: number; issues: string[]; suggestions: string[]; details: Record<string, number | string> };
    foreshadowDivergence: { score: number; issues: string[]; suggestions: string[]; details: Record<string, number | string> };
    settingDivergence: { score: number; issues: string[]; suggestions: string[]; details: Record<string, number | string> };
    overallDivergence: number;
    overallLevel: 'normal' | 'warning' | 'danger';
  };
}

/** V1 CharacterConsistencyChecker 的子集接口 */
export interface ICharacterConsistencyChecker {
  check(
    chapterText: string,
    characterInfos: CharacterContextInfo[],
    historyTexts?: string[]
  ): Promise<{
    overallScore: number;
    characterResults: Record<
      string,
      {
        score: number;
        inconsistencies: Array<{
          type: string;
          severity: 'low' | 'medium' | 'high';
          description: string;
          location?: string;
          suggestion?: string;
          confidence: number;
        }>;
      }
    >;
    summary: string;
  }>;
}

/** V1 RhythmAnalyzer 的子集接口（与 quality-score-engine 一致） */
export interface IRhythmAnalyzerForDeviation {
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

// ============================================================
// 六、预警阈值配置
// ============================================================

export interface SeverityThresholds {
  /** 偏离度 >= 此值 → critical */
  critical: number;
  /** 偏离度 >= 此值 → warning */
  warning: number;
  /** 低于 warning → info */
  info: number;
}

export const DEFAULT_SEVERITY_THRESHOLDS: SeverityThresholds = {
  critical: 60,
  warning: 30,
  info: 0,
};

// ============================================================
// 七、引擎选项
// ============================================================

export interface DeviationDetectorOptions {
  /** V1 剧情偏离引擎（注入后复用，否则使用内置规则） */
  plotDivergenceEngine?: IPlotDivergenceEngine;
  /** V1 人物一致性检查器 */
  characterChecker?: ICharacterConsistencyChecker;
  /** V1 节奏分析器 */
  rhythmAnalyzer?: IRhythmAnalyzerForDeviation;
  /** 预警阈值（默认使用 DEFAULT_SEVERITY_THRESHOLDS） */
  severityThresholds?: Partial<SeverityThresholds>;
  /** 伏笔回收默认阈值章节数（默认 10） */
  foreshadowRecoverChapters?: number;
  /** 缓存最大条目数 */
  cacheSize?: number;
  /** 缓存存活时间（毫秒），0 表示永不过期 */
  cacheTtlMs?: number;
}

// ============================================================
// 八、DeviationDetector 实现
// ============================================================

/**
 * 偏离检测引擎
 *
 * 使用方式：
 *   const detector = new DeviationDetector();
 *   const report = await detector.detect(text, context);
 *
 * 增量检测：
 *   const report = await detector.detect(text, { changedRange: { start: 100, end: 200 } });
 *
 * 取消检测：
 *   const controller = new AbortController();
 *   controller.abort();
 *   await detector.detect(text, {}, controller.signal); // 抛出 AbortError
 *
 * 按类型检测：
 *   const issues = await detector.detectByType(text, 'characterOOC', context);
 */
export class DeviationDetector {
  private readonly plotDivergenceEngine?: IPlotDivergenceEngine;
  private readonly characterChecker?: ICharacterConsistencyChecker;
  private readonly rhythmAnalyzer?: IRhythmAnalyzerForDeviation;
  private readonly severityThresholds: SeverityThresholds;
  private readonly foreshadowRecoverChapters: number;

  /** 类型结果缓存：key = `${type}:${textHash}` */
  private readonly typeCache: LruCache<string, DeviationIssue[]>;
  /** 完整结果缓存：key = textHash */
  private readonly fullCache: LruCache<string, DeviationReport>;

  constructor(options: DeviationDetectorOptions = {}) {
    this.plotDivergenceEngine = options.plotDivergenceEngine;
    this.characterChecker = options.characterChecker;
    this.rhythmAnalyzer = options.rhythmAnalyzer;
    this.severityThresholds = {
      ...DEFAULT_SEVERITY_THRESHOLDS,
      ...options.severityThresholds,
    };
    this.foreshadowRecoverChapters = options.foreshadowRecoverChapters ?? 10;

    const cacheSize = options.cacheSize ?? 50;
    const cacheTtlMs = options.cacheTtlMs ?? 60_000;
    this.typeCache = new LruCache<string, DeviationIssue[]>({
      maxSize: cacheSize * 5,
      ttlMs: cacheTtlMs,
    });
    this.fullCache = new LruCache<string, DeviationReport>({
      maxSize: cacheSize,
      ttlMs: cacheTtlMs,
    });
  }

  // ── 公开 API ──────────────────────────────────────────────

  /**
   * 检测全部 5 类偏离
   * @param text 正文文本
   * @param context 检测上下文
   * @param signal 取消信号
   */
  async detect(
    text: string,
    context: DeviationContext = {},
    signal?: AbortSignal
  ): Promise<DeviationReport> {
    const startTime = Date.now();
    const cleanText = this.cleanText(text);
    const wordCount = cleanText.length;
    const textHash = this.hashText(cleanText);

    // 完整结果缓存命中（仅在无变更范围时）
    if (!context.changedRange) {
      const cached = this.fullCache.get(textHash);
      if (cached) {
        return { ...cached, fromCache: true, evalTimeMs: Date.now() - startTime };
      }
    }

    // 内容不足时返回空结果
    if (wordCount < 100) {
      const empty = this.getEmptyReport(wordCount, startTime);
      this.fullCache.set(textHash, empty);
      return empty;
    }

    this.throwIfAborted(signal);

    const typeScores: Record<DeviationType, number> = {} as Record<DeviationType, number>;
    const allIssues: DeviationIssue[] = [];

    for (const type of DEVIATION_TYPES) {
      this.throwIfAborted(signal);
      // 增量检测：可跳过的类型直接跳过
      if (this.canSkipType(type, cleanText, context)) {
        typeScores[type] = 0;
        continue;
      }
      const issues = await this.detectByTypeInternal(cleanText, type, context, signal);
      allIssues.push(...issues);
      typeScores[type] = this.calculateTypeScore(issues);
    }

    this.throwIfAborted(signal);

    const overallScore = this.calculateOverallScore(typeScores);
    const overallSeverity = this.severityFromDegree(overallScore);
    const suggestions = this.buildSuggestions(allIssues);
    const sortedIssues = this.sortIssues(allIssues);

    const report: DeviationReport = {
      overallScore,
      overallSeverity,
      typeScores,
      issues: sortedIssues,
      suggestions,
      evaluatedAt: Date.now(),
      wordCount,
      evalTimeMs: Date.now() - startTime,
      fromCache: false,
      incremental: !!context.changedRange,
    };

    this.fullCache.set(textHash, report);
    return report;
  }

  /**
   * 按类型检测偏离
   * @param text 正文文本
   * @param type 偏离类型
   * @param context 检测上下文
   * @param signal 取消信号
   */
  async detectByType(
    text: string,
    type: DeviationType,
    context: DeviationContext = {},
    signal?: AbortSignal
  ): Promise<DeviationIssue[]> {
    const cleanText = this.cleanText(text);
    return this.detectByTypeInternal(cleanText, type, context, signal);
  }

  /** 清空所有缓存 */
  clearCache(): void {
    this.typeCache.clear();
    this.fullCache.clear();
  }

  /** 按文本失效缓存 */
  invalidateCache(text?: string): void {
    if (text === undefined) {
      this.clearCache();
      return;
    }
    const textHash = this.hashText(this.cleanText(text));
    this.fullCache.delete(textHash);
    for (const type of DEVIATION_TYPES) {
      this.typeCache.delete(`${type}:${textHash}`);
    }
  }

  /** 获取当前预警阈值 */
  getSeverityThresholds(): SeverityThresholds {
    return { ...this.severityThresholds };
  }

  /** 获取伏笔回收阈值章节数 */
  getForeshadowRecoverChapters(): number {
    return this.foreshadowRecoverChapters;
  }

  // ── 各类型检测实现 ──────────────────────────────────────

  private async detectByTypeInternal(
    text: string,
    type: DeviationType,
    context: DeviationContext,
    signal?: AbortSignal
  ): Promise<DeviationIssue[]> {
    const textHash = this.hashText(text);
    const cacheKey = `${type}:${textHash}`;

    // 缓存命中（仅无变更范围时）
    if (!context.changedRange) {
      const cached = this.typeCache.get(cacheKey);
      if (cached) {
        return cached;
      }
    }

    this.throwIfAborted(signal);

    let issues: DeviationIssue[];
    switch (type) {
      case 'mainline':
        issues = this.detectMainline(text, context);
        break;
      case 'characterOOC':
        issues = await this.detectCharacterOOC(text, context, signal);
        break;
      case 'contradiction':
        issues = this.detectContradiction(text, context);
        break;
      case 'foreshadowForgot':
        issues = this.detectForeshadowForgot(text, context);
        break;
      case 'rhythm':
        issues = await this.detectRhythm(text, context, signal);
        break;
      case 'emotionBreak':
        issues = this.detectEmotionBreak(text, context);
        break;
      default:
        issues = [];
    }

    this.typeCache.set(cacheKey, issues);
    return issues;
  }

  // ── 类型 1：剧情偏离主线 ───────────────────────────────────

  /**
   * 剧情偏离主线检测：
   * - 对比章节大纲与实际内容
   * - 检测关键情节点是否被覆盖
   * - 检测新增的偏离主线的支线
   * 复用 V1 PlotDivergenceEngine（若注入），否则使用内置规则
   */
  private detectMainline(text: string, context: DeviationContext): DeviationIssue[] {
    const issues: DeviationIssue[] = [];

    // 优先使用 V1 PlotDivergenceEngine
    if (this.plotDivergenceEngine) {
      this.plotDivergenceEngine.updateOptions({
        chapterOutline: context.chapterOutline,
        mainlineKeywords: context.mainlineKeywords,
      });
      const result = this.plotDivergenceEngine.evaluate(text);
      const mainline = result.mainlineDivergence;
      // V1 score 越高偏离越大，转换为 issue
      if (mainline.score > 0) {
        for (let i = 0; i < mainline.issues.length; i++) {
          issues.push({
            id: `mainline_v1_${i}`,
            type: 'mainline',
            severity: this.severityFromDegree(mainline.score),
            degree: mainline.score,
            description: mainline.issues[i],
            suggestion: mainline.suggestions[i] || mainline.suggestions[0],
            confidence: 0.7,
          });
        }
        // 若 V1 未生成 issue 但偏离度高，仍生成一条概要 issue
        if (issues.length === 0 && mainline.score >= this.severityThresholds.warning) {
          issues.push({
            id: 'mainline_v1_summary',
            type: 'mainline',
            severity: this.severityFromDegree(mainline.score),
            degree: mainline.score,
            description: `剧情偏离主线（V1 引擎测得偏离度 ${mainline.score}%）`,
            suggestion: mainline.suggestions[0],
            confidence: 0.7,
          });
        }
      }
      return issues;
    }

    // 降级：内置规则
    return this.detectMainlineFallback(text, context);
  }

  private detectMainlineFallback(
    text: string,
    context: DeviationContext
  ): DeviationIssue[] {
    const issues: DeviationIssue[] = [];
    let outlineMatchRate = 50;
    let keywordCoverage = 50;

    // 大纲关键词覆盖
    if (context.chapterOutline) {
      const outlineKeywords = this.extractKeywords(context.chapterOutline);
      const unmatched: string[] = [];
      for (const kw of outlineKeywords) {
        if (kw.length >= 2 && !text.includes(kw)) {
          unmatched.push(kw);
        }
      }
      const matched = outlineKeywords.length - unmatched.length;
      outlineMatchRate =
        outlineKeywords.length > 0
          ? Math.round((matched / outlineKeywords.length) * 100)
          : 50;

      if (unmatched.length > 0 && outlineMatchRate < 60) {
        issues.push({
          id: 'mainline_outline_unmatched',
          type: 'mainline',
          severity: this.severityFromDegree(100 - outlineMatchRate),
          degree: 100 - outlineMatchRate,
          description: `大纲关键词未覆盖：${unmatched.slice(0, 5).join('、')}${unmatched.length > 5 ? '...' : ''}`,
          suggestion: '建议回顾本章大纲，确保核心情节按计划推进',
          confidence: 0.7,
          evidence: unmatched.slice(0, 3),
        });
      }
    }

    // 主线关键词覆盖
    if (context.mainlineKeywords && context.mainlineKeywords.length > 0) {
      const matched = context.mainlineKeywords.filter(
        (kw) => kw.length >= 2 && text.includes(kw)
      );
      keywordCoverage = Math.round(
        (matched.length / context.mainlineKeywords.length) * 100
      );

      if (keywordCoverage < 30) {
        issues.push({
          id: 'mainline_keyword_low',
          type: 'mainline',
          severity: 'critical',
          degree: 100 - keywordCoverage,
          description: `主线元素覆盖率仅 ${keywordCoverage}%，剧情可能偏离主线`,
          suggestion: '可适当穿插主线元素，强化主线关联',
          confidence: 0.75,
          evidence: context.mainlineKeywords
            .filter((kw) => !text.includes(kw))
            .slice(0, 3),
        });
      } else if (keywordCoverage < 60) {
        issues.push({
          id: 'mainline_keyword_medium',
          type: 'mainline',
          severity: 'warning',
          degree: 100 - keywordCoverage,
          description: `主线元素覆盖率 ${keywordCoverage}%，部分主线要点未覆盖`,
          suggestion: '注意在后续段落中补充主线要点',
          confidence: 0.6,
        });
      }
    }

    // 冲突元素检测
    const conflictPatterns = [
      /但是|然而|可是|却|不料|没想到/g,
      /突然|忽然|就在这时|就在此刻/g,
      /危机|危险|紧急|迫在眉睫|千钧一发/g,
      /对峙|对抗|较量|决斗|战斗|厮杀/g,
    ];
    let conflictCount = 0;
    for (const pattern of conflictPatterns) {
      conflictCount += (text.match(pattern) || []).length;
    }
    if (
      context.chapterOutline &&
      /冲突|对抗|战斗|危机|危险|挑战/.test(context.chapterOutline) &&
      conflictCount === 0
    ) {
      issues.push({
        id: 'mainline_no_conflict',
        type: 'mainline',
        severity: 'warning',
        degree: 40,
        description: '大纲预期有冲突，但本章未检测到冲突元素',
        suggestion: '建议增加冲突或对抗场景以符合大纲预期',
        confidence: 0.6,
      });
    }

    return issues;
  }

  // ── 类型 2：人物 OOC ──────────────────────────────────────

  /**
   * 人物 OOC 检测：
   * - 行为是否符合性格设定
   * - 对话风格是否一致
   * - 能力是否超出设定
   * 复用 V1 CharacterConsistencyChecker（若注入），否则使用内置规则
   */
  private async detectCharacterOOC(
    text: string,
    context: DeviationContext,
    signal?: AbortSignal
  ): Promise<DeviationIssue[]> {
    const issues: DeviationIssue[] = [];
    const characterInfos = context.characterInfos || [];
    if (characterInfos.length === 0) {
      return issues;
    }

    // 优先使用 V1 CharacterConsistencyChecker
    if (this.characterChecker) {
      const historyTexts = (context.previousChapters || [])
        .filter((c) => c.text && c.text.length > 0)
        .map((c) => c.text);
      const result = await this.characterChecker.check(
        text,
        characterInfos,
        historyTexts.length > 0 ? historyTexts : undefined
      );
      this.throwIfAborted(signal);

      for (const [name, charResult] of Object.entries(result.characterResults)) {
        const deviationDegree = 100 - charResult.score;
        for (let i = 0; i < charResult.inconsistencies.length; i++) {
          const inc = charResult.inconsistencies[i];
          issues.push({
            id: `charOOC_v1_${name}_${i}`,
            type: 'characterOOC',
            severity: this.mapV1Severity(inc.severity, deviationDegree),
            degree: deviationDegree,
            description: `[${name}] ${inc.description}`,
            location: inc.location ? { character: name } : { character: name },
            suggestion: inc.suggestion,
            confidence: inc.confidence,
          });
        }
        // 若 V1 未生成 issue 但偏离度高，仍生成一条概要 issue
        if (
          charResult.inconsistencies.length === 0 &&
          deviationDegree >= this.severityThresholds.warning
        ) {
          issues.push({
            id: `charOOC_v1_summary_${name}`,
            type: 'characterOOC',
            severity: this.severityFromDegree(deviationDegree),
            degree: deviationDegree,
            description: `[${name}] 人物行为偏离设定（一致性得分 ${charResult.score}）`,
            suggestion: '建议检查角色行为是否符合人设',
            confidence: 0.7,
          });
        }
      }
      return issues;
    }

    // 降级：内置规则（基于行为关键词冲突）
    return this.detectCharacterOOCFallback(text, characterInfos);
  }

  private detectCharacterOOCFallback(
    text: string,
    characterInfos: CharacterContextInfo[]
  ): DeviationIssue[] {
    const issues: DeviationIssue[] = [];

    // 性格-行为冲突表（简化版）
    const BEHAVIOR_CONFLICTS: Record<string, string[]> = {
      冷静: ['激动地说', '热情地', '兴奋地', '泪流满面', '勃然大怒', '暴跳如雷'],
      沉稳: ['慌了神', '惊慌失措', '手忙脚乱', '大惊失色'],
      温柔: ['怒吼道', '厉声喝道', '摔门而去'],
      老实: ['狡黠地笑', '眼珠一转', '暗中盘算', '撒谎'],
      正直: ['阴险地', '暗算', '偷袭', '不择手段'],
      勇敢: ['吓得发抖', '缩成一团', '落荒而逃', '胆战心惊'],
    };

    for (const char of characterInfos) {
      if (!char.name || char.name.length < 2) continue;
      if (!char.personality) continue;

      const charParagraphs = this.extractCharacterParagraphs(text, char.name);
      if (charParagraphs.length === 0) continue;

      // 检查性格设定中包含哪些性格关键词
      const detectedTraits = Object.keys(BEHAVIOR_CONFLICTS).filter((trait) =>
        char.personality!.includes(trait)
      );
      if (detectedTraits.length === 0) continue;

      let conflictCount = 0;
      const evidences: string[] = [];

      for (const trait of detectedTraits) {
        const incompatibleActions = BEHAVIOR_CONFLICTS[trait];
        for (const action of incompatibleActions) {
          // 仅检测与该人物相关的段落
          for (const para of charParagraphs) {
            if (para.includes(action)) {
              conflictCount++;
              const sentence = this.extractSentence(para, action);
              if (sentence) evidences.push(sentence);
            }
          }
        }
      }

      if (conflictCount > 0) {
        const degree = Math.min(100, 30 + conflictCount * 20);
        issues.push({
          id: `charOOC_${char.name}_behavior`,
          type: 'characterOOC',
          severity: this.severityFromDegree(degree),
          degree,
          description: `[${char.name}] 行为与「${detectedTraits.join('、')}」人设不符`,
          location: { character: char.name },
          suggestion: `请确认该行为是否符合人物设定（性格：${char.personality}）`,
          confidence: 0.65,
          evidence: evidences.slice(0, 3),
        });
      }
    }

    return issues;
  }

  // ── 类型 3：前后矛盾 ──────────────────────────────────────

  /**
   * 前后矛盾检测：
   * - 时间线矛盾：事件发生顺序不一致
   * - 设定矛盾：同一设定在不同章节不一致
   * - 战力矛盾：人物战力忽高忽低
   * 复用 V1 analyzeCoherence + 章节间对比
   */
  private detectContradiction(
    text: string,
    context: DeviationContext
  ): DeviationIssue[] {
    const issues: DeviationIssue[] = [];

    // 1. 当前章节内部的连贯性问题（复用 CoherenceChecker）
    const report: CoherenceReport = analyzeCoherence(text);
    for (let i = 0; i < report.issues.length; i++) {
      const issue = report.issues[i];
      const degree =
        issue.type === 'duplicate_sentence'
          ? 70
          : issue.type === 'repeated_phrase'
          ? 50
          : 30;
      issues.push({
        id: `contradiction_internal_${i}`,
        type: 'contradiction',
        severity: this.severityFromDegree(degree),
        degree,
        description: issue.message,
        suggestion: '建议精简或改写重复部分',
        confidence: 0.7,
        evidence: issue.sample ? [issue.sample] : undefined,
      });
    }

    // 2. 与前文章节的时间线矛盾检测
    const prevChapters = context.previousChapters || [];
    if (prevChapters.length > 0) {
      const timelineIssues = this.detectTimelineContradictions(text, prevChapters);
      issues.push(...timelineIssues);
    }

    // 3. 设定矛盾检测
    if (context.characterInfos && context.characterInfos.length > 0) {
      const settingIssues = this.detectSettingContradictions(
        text,
        context.characterInfos,
        prevChapters
      );
      issues.push(...settingIssues);
    }

    return issues;
  }

  private detectTimelineContradictions(
    text: string,
    prevChapters: PreviousChapterContext[]
  ): DeviationIssue[] {
    const issues: DeviationIssue[] = [];

    // 时间标记提取
    const TIME_PATTERN =
      /第([一二三四五六七八九十百千零〇\d]+)(天|日|年|月|周|个星期)|次日|几日后|几年后|不久|片刻后|与此同时/g;
    const currentTimeMarks = this.extractTimeMarks(text, TIME_PATTERN);
    if (currentTimeMarks.length === 0) return issues;

    // 检测与前文的时间线冲突（简单规则：相同时间标记重复使用即视为潜在矛盾）
    for (const prev of prevChapters) {
      const prevTimeMarks = this.extractTimeMarks(prev.text, TIME_PATTERN);
      // 检测冲突的时间标记（如「第一日」在前文和当前文中都出现且语境不同）
      for (const curr of currentTimeMarks) {
        for (const prevMark of prevTimeMarks) {
          if (curr.normalized === prevMark.normalized && curr.text !== prevMark.text) {
            // 简单启发式：相同时间标记重复使用
            issues.push({
              id: `contradiction_timeline_${prev.chapterId}`,
              type: 'contradiction',
              severity: 'warning',
              degree: 45,
              description: `时间标记「${curr.text}」与章节 ${prev.chapterId} 重复，可能存在时间线矛盾`,
              location: { chapterRef: prev.chapterId },
              suggestion: '请检查时间线顺序是否一致',
              confidence: 0.5,
              evidence: [prevMark.text, curr.text],
            });
            break;
          }
        }
      }
    }

    return issues;
  }

  private extractTimeMarks(
    text: string,
    pattern: RegExp
  ): Array<{ text: string; normalized: string }> {
    const marks: Array<{ text: string; normalized: string }> = [];
    let match: RegExpExecArray | null;
    const globalPattern = new RegExp(pattern.source, 'g');
    while ((match = globalPattern.exec(text)) !== null) {
      const matched = match[0];
      // 归一化：将中文数字转阿拉伯
      const normalized = matched
        .replace(/一二三四五六七八九十/g, (s) => '一二三四五六七八九十'.indexOf(s).toString())
        .replace(/百|千|零|〇/g, '');
      marks.push({ text: matched, normalized });
    }
    return marks;
  }

  private detectSettingContradictions(
    text: string,
    characterInfos: CharacterContextInfo[],
    prevChapters: PreviousChapterContext[]
  ): DeviationIssue[] {
    const issues: DeviationIssue[] = [];

    // 外貌矛盾检测
    const APPEARANCE_CONTRADICTIONS: Array<{
      words: string[];
      opposite: string[];
    }> = [
      { words: ['黑发', '乌黑', '墨发'], opposite: ['金发', '白发', '银发', '红发'] },
      { words: ['金发'], opposite: ['黑发', '白发', '银发', '红发'] },
      { words: ['白发', '银发'], opposite: ['黑发', '金发', '红发'] },
      { words: ['高大', '魁梧'], opposite: ['瘦小', '矮小', '侏儒'] },
      { words: ['瘦小', '矮小'], opposite: ['高大', '魁梧', '壮硕'] },
      { words: ['英俊', '帅气'], opposite: ['丑陋', '难看'] },
      { words: ['美丽', '漂亮'], opposite: ['丑陋', '难看'] },
      { words: ['年轻', '少年'], opposite: ['年老', '年迈', '白发苍苍'] },
      { words: ['年老', '年迈'], opposite: ['年轻', '少年', '青年'] },
    ];

    for (const char of characterInfos) {
      if (!char.name || !char.appearance) continue;
      for (const contradiction of APPEARANCE_CONTRADICTIONS) {
        const hasSetting = contradiction.words.some((w) => char.appearance!.includes(w));
        if (!hasSetting) continue;

        // 在当前文本和前文中查找矛盾描述
        for (const opp of contradiction.opposite) {
          if (text.includes(opp) && text.includes(char.name)) {
            const sentence = this.extractSentence(text, opp);
            issues.push({
              id: `contradiction_setting_${char.name}_${opp}`,
              type: 'contradiction',
              severity: 'critical',
              degree: 75,
              description: `[${char.name}] 外貌描述矛盾：设定为「${contradiction.words[0]}」，文中出现「${opp}」`,
              location: { character: char.name },
              suggestion: '请修正外貌描述以保持一致',
              confidence: 0.85,
              evidence: sentence ? [sentence] : undefined,
            });
          }
        }

        // 检查前文章节中的矛盾
        for (const prev of prevChapters) {
          for (const opp of contradiction.opposite) {
            if (prev.text.includes(opp) && prev.text.includes(char.name)) {
              issues.push({
                id: `contradiction_setting_${char.name}_${opp}_${prev.chapterId}`,
                type: 'contradiction',
                severity: 'critical',
                degree: 80,
                description: `[${char.name}] 外貌描述与章节 ${prev.chapterId} 矛盾：设定「${contradiction.words[0]}」，前文出现「${opp}」`,
                location: { character: char.name, chapterRef: prev.chapterId },
                suggestion: '请统一人物外貌描述',
                confidence: 0.85,
              });
            }
          }
        }
      }
    }

    return issues;
  }

  // ── 类型 4：伏笔遗忘 ───────────────────────────────────────

  /**
   * 伏笔遗忘检测：
   * - 追踪埋设的伏笔（context.foreshadows 或从前文章节 frontmatter 解析）
   * - 检查 N 章后是否回收
   * - 列出未回收的伏笔列表
   */
  private detectForeshadowForgot(
    text: string,
    context: DeviationContext
  ): DeviationIssue[] {
    const issues: DeviationIssue[] = [];

    // 收集伏笔追踪列表：优先使用上下文提供的，否则从前文章节 frontmatter 解析
    let foreshadows = context.foreshadows;
    if (!foreshadows || foreshadows.length === 0) {
      foreshadows = this.parseForeshadowsFromFrontmatter(context.previousChapters || []);
    }
    if (foreshadows.length === 0) return issues;

    const currentChapterNum = context.chapterNum ?? 0;

    for (const fs of foreshadows) {
      if (fs.recovered) continue;

      // 检查当前章节是否回收了该伏笔（关键词匹配）
      const isRecoveredInCurrent = fs.keywords.some(
        (kw) => kw.length >= 2 && text.includes(kw)
      );

      if (isRecoveredInCurrent) {
        // 在当前章节回收了
        continue;
      }

      // 计算与埋设章节的距离
      const plantedNum = fs.plantedChapterNum ?? 0;
      const distance = currentChapterNum - plantedNum;

      // 若距离超过阈值，标记为遗忘
      if (distance >= this.foreshadowRecoverChapters) {
        issues.push({
          id: `foreshadowForgot_${fs.id}`,
          type: 'foreshadowForgot',
          severity: 'critical',
          degree: Math.min(100, 60 + (distance - this.foreshadowRecoverChapters) * 5),
          description: `伏笔「${fs.description}」已埋设 ${distance} 章未回收（阈值 ${this.foreshadowRecoverChapters} 章）`,
          suggestion: '建议尽快安排伏笔回收，避免读者遗忘',
          confidence: 0.8,
          evidence: fs.keywords.slice(0, 3),
        });
      } else if (distance >= this.foreshadowRecoverChapters / 2) {
        // 超过阈值一半，预警提示
        issues.push({
          id: `foreshadowForgot_${fs.id}_approaching`,
          type: 'foreshadowForgot',
          severity: 'warning',
          degree: 35 + distance * 3,
          description: `伏笔「${fs.description}」已埋设 ${distance} 章，建议尽快回收`,
          suggestion: '可考虑在后续章节中安排伏笔回收',
          confidence: 0.6,
          evidence: fs.keywords.slice(0, 3),
        });
      }
    }

    return issues;
  }

  /**
   * 从前文章节的 frontmatter 解析伏笔追踪信息
   * 支持的 frontmatter 字段名：
   *   - foreshadows: [{ id, description, keywords: [...] }]
   *   - foreshadow: string 或 string[]
   */
  private parseForeshadowsFromFrontmatter(
    prevChapters: PreviousChapterContext[]
  ): ForeshadowTracking[] {
    const result: ForeshadowTracking[] = [];
    for (const prev of prevChapters) {
      if (!prev.frontmatter) continue;
      const fm = prev.frontmatter;

      // 数组形式
      const rawList = (fm['foreshadows'] || fm['foreshadow']) as
        | Array<Record<string, unknown>>
        | string
        | string[]
        | undefined;
      if (!rawList) continue;

      if (Array.isArray(rawList)) {
        for (let i = 0; i < rawList.length; i++) {
          const item = rawList[i];
          if (typeof item === 'string') {
            result.push({
              id: `${prev.chapterId}_fs_${i}`,
              description: item,
              keywords: this.extractKeywords(item).slice(0, 5),
              plantedChapterId: prev.chapterId,
              plantedChapterNum: prev.chapterNum,
              recovered: false,
              currentChapterNum: prev.chapterNum,
            });
          } else if (item && typeof item === 'object') {
            const desc = String(item['description'] || item['desc'] || '');
            const keywords = Array.isArray(item['keywords'])
              ? (item['keywords'] as string[]).map(String)
              : this.extractKeywords(desc).slice(0, 5);
            result.push({
              id: String(item['id'] || `${prev.chapterId}_fs_${i}`),
              description: desc,
              keywords,
              plantedChapterId: prev.chapterId,
              plantedChapterNum: prev.chapterNum,
              recovered: Boolean(item['recovered']),
              currentChapterNum: prev.chapterNum,
            });
          }
        }
      } else if (typeof rawList === 'string') {
        // 单字符串形式
        result.push({
          id: `${prev.chapterId}_fs_0`,
          description: rawList,
          keywords: this.extractKeywords(rawList).slice(0, 5),
          plantedChapterId: prev.chapterId,
          plantedChapterNum: prev.chapterNum,
          recovered: false,
          currentChapterNum: prev.chapterNum,
        });
      }
    }
    return result;
  }

  // ── 类型 5：节奏偏离 ───────────────────────────────────────

  /**
   * 节奏偏离检测：
   * - 对比大纲预设的节奏与实际节奏
   * - 检测是否有拖沓或跳跃
   * 复用 V1 RhythmAnalyzer（若注入），否则使用内置规则
   */
  private async detectRhythm(
    text: string,
    context: DeviationContext,
    signal?: AbortSignal
  ): Promise<DeviationIssue[]> {
    const issues: DeviationIssue[] = [];
    const expectedRhythm = context.expectedRhythm;
    if (!expectedRhythm) {
      // 无期望节奏信息，无法判断偏离
      return issues;
    }

    // 优先使用 V1 RhythmAnalyzer
    if (this.rhythmAnalyzer) {
      const analysis = await this.rhythmAnalyzer.analyze(text);
      this.throwIfAborted(signal);

      const segments = analysis.segments;
      const total = segments.length;
      if (total === 0) return issues;

      const paceCounts = { fast: 0, medium: 0, slow: 0 };
      for (const seg of segments) paceCounts[seg.pace]++;

      // 实际节奏判定
      let actualPace: 'fast' | 'medium' | 'slow';
      if (paceCounts.fast > total * 0.5) actualPace = 'fast';
      else if (paceCounts.slow > total * 0.5) actualPace = 'slow';
      else actualPace = 'medium';

      if (actualPace !== expectedRhythm) {
        const degree =
          (expectedRhythm === 'fast' && actualPace === 'slow') ||
          (expectedRhythm === 'slow' && actualPace === 'fast')
            ? 70
            : 35;
        issues.push({
          id: 'rhythm_pace_mismatch',
          type: 'rhythm',
          severity: this.severityFromDegree(degree),
          degree,
          description: `节奏偏差：预期${this.getPaceLabel(expectedRhythm)}，实际${this.getPaceLabel(actualPace)}`,
          suggestion: this.getRhythmSuggestion(actualPace, expectedRhythm),
          confidence: 0.75,
        });
      }

      // 紧张度峰值检测
      const tensions = segments.map((s) => s.tensionLevel);
      const maxTension = tensions.length > 0 ? Math.max(...tensions) : 0;
      if (expectedRhythm === 'fast' && maxTension < 50) {
        issues.push({
          id: 'rhythm_low_tension',
          type: 'rhythm',
          severity: 'warning',
          degree: 40,
          description: `预期快节奏但紧张度峰值仅 ${maxTension}，节奏偏弱`,
          suggestion: '建议增加冲突或动作描写以提升紧张度',
          confidence: 0.6,
        });
      }

      // 整合 RhythmAnalyzer 的建议
      for (const seg of analysis.suggestions.slice(0, 1)) {
        issues.push({
          id: 'rhythm_analyzer_suggestion',
          type: 'rhythm',
          severity: 'info',
          degree: 20,
          description: seg,
          confidence: 0.5,
        });
      }

      return issues;
    }

    // 降级：内置规则
    return this.detectRhythmFallback(text, expectedRhythm);
  }

  private detectRhythmFallback(
    text: string,
    expectedRhythm: 'fast' | 'medium' | 'slow'
  ): DeviationIssue[] {
    const issues: DeviationIssue[] = [];
    const sentences = this.splitSentences(text);
    if (sentences.length < 5) return issues;

    const avgSentenceLen = text.length / sentences.length;

    const RHYTHM_ACTION_WORDS = [
      '冲', '打', '砍', '刺', '杀', '击', '扑', '跃', '闪', '躲',
      '跑', '追', '逃', '赶', '撞', '砸',
    ];
    const RHYTHM_DESC_WORDS = [
      '仿佛', '似乎', '好像', '犹如', '宛如', '如同', '一般', '一样',
    ];

    let actionCount = 0;
    for (const w of RHYTHM_ACTION_WORDS) {
      actionCount += (text.match(new RegExp(w, 'g')) || []).length;
    }
    let descCount = 0;
    for (const w of RHYTHM_DESC_WORDS) {
      descCount += (text.match(new RegExp(w, 'g')) || []).length;
    }

    const actionRatio = text.length > 0 ? (actionCount / text.length) * 100 : 0;
    const descRatio = text.length > 0 ? (descCount / text.length) * 100 : 0;

    let actualPace: 'fast' | 'medium' | 'slow';
    if (avgSentenceLen < 20 && actionRatio > 3) actualPace = 'fast';
    else if (avgSentenceLen > 40 && descRatio > 5) actualPace = 'slow';
    else actualPace = 'medium';

    if (actualPace !== expectedRhythm) {
      const degree =
        (expectedRhythm === 'fast' && actualPace === 'slow') ||
        (expectedRhythm === 'slow' && actualPace === 'fast')
          ? 70
          : 35;
      issues.push({
        id: 'rhythm_fallback_mismatch',
        type: 'rhythm',
        severity: this.severityFromDegree(degree),
        degree,
        description: `节奏偏差：预期${this.getPaceLabel(expectedRhythm)}，实际${this.getPaceLabel(actualPace)}（平均句长 ${Math.round(avgSentenceLen)} 字）`,
        suggestion: this.getRhythmSuggestion(actualPace, expectedRhythm),
        confidence: 0.65,
      });
    }

    return issues;
  }

  // ── 类型 6：情绪断层 ───────────────────────────────────────

  /**
   * 情绪断层检测：
   * - 检测连续多段无情绪词、无身体反应、无心理活动的段落
   * - 检测情绪转换突兀（情绪类型跳跃过大）
   * - 检测章节结尾缺少情绪收束或钩子
   * 复用 emotion-auditor.ts 的规则，转为偏离检测格式
   */
  private detectEmotionBreak(text: string, context: DeviationContext): DeviationIssue[] {
    const issues: DeviationIssue[] = [];
    const paragraphs = text.split(/\n\n+/).filter((p) => p.trim().length > 10);
    if (paragraphs.length < 3) return issues;

    const psychPatterns = [
      /想[起着到]/,
      /觉得/,
      /知道/,
      /感觉/,
      /心里/,
      /脑海/,
      /回忆/,
      /意识/,
      /察觉/,
      /明白/,
      /忽然[想到起]/,
      /不禁/,
      /不自觉/,
      /隐隐/,
    ];

    const bodyPatterns = [
      /心跳/,
      /呼吸/,
      /手指/,
      /掌心/,
      /肩膀/,
      /背[脊后]/,
      /胸口/,
      /喉咙/,
      /眼眶/,
      /拳头/,
      /肌肉/,
      /发抖/,
      /发麻/,
      /发紧/,
      /发烫/,
      /发凉/,
      /收紧/,
      /绷紧/,
      /僵硬/,
    ];

    const emotionPatterns = [
      /愤怒/,
      /恐惧/,
      /害怕/,
      /紧张/,
      /担忧/,
      /焦虑/,
      /兴奋/,
      /喜悦/,
      /悲伤/,
      /绝望/,
      /希望/,
      /厌恶/,
      /惊喜/,
      /仇恨/,
      /爱/,
      /恨/,
      /悔/,
      /疚/,
      /愧/,
    ];

    const hasEmotionElement = (para: string): boolean => {
      return (
        psychPatterns.some((p) => p.test(para)) ||
        bodyPatterns.some((p) => p.test(para)) ||
        emotionPatterns.some((p) => p.test(para))
      );
    };

    // 检测1: 连续无情绪段落（情绪断层）
    let maxConsecutiveEmpty = 0;
    let currentEmpty = 0;
    let emptyStartIndex = -1;

    for (let i = 0; i < paragraphs.length; i++) {
      if (hasEmotionElement(paragraphs[i])) {
        if (currentEmpty > maxConsecutiveEmpty) {
          maxConsecutiveEmpty = currentEmpty;
          emptyStartIndex = i - currentEmpty;
        }
        currentEmpty = 0;
      } else {
        currentEmpty++;
      }
    }
    if (currentEmpty > maxConsecutiveEmpty) {
      maxConsecutiveEmpty = currentEmpty;
      emptyStartIndex = paragraphs.length - currentEmpty;
    }

    if (maxConsecutiveEmpty >= 4) {
      const degree = Math.min(100, 40 + (maxConsecutiveEmpty - 4) * 15);
      const sampleText = paragraphs[emptyStartIndex]?.slice(0, 50) || '';
      issues.push({
        id: 'emotionBreak_empty_streak',
        type: 'emotionBreak',
        severity: this.severityFromDegree(degree),
        degree,
        description: `情绪断层：连续 ${maxConsecutiveEmpty} 段无心理活动、情绪词或身体反应，读者可能失去共情`,
        location: { line: emptyStartIndex + 1 },
        suggestion: '建议在这段中插入角色的心理活动、身体反应或情绪描写，增强代入感',
        confidence: 0.7,
        evidence: sampleText ? [sampleText + '...'] : undefined,
      });
    } else if (maxConsecutiveEmpty >= 3) {
      issues.push({
        id: 'emotionBreak_low_density',
        type: 'emotionBreak',
        severity: 'info',
        degree: 25,
        description: `情绪密度偏低：连续 ${maxConsecutiveEmpty} 段无情绪元素`,
        suggestion: '可适当增加心理活动或身体反应描写',
        confidence: 0.55,
      });
    }

    // 检测2: 情绪转换突兀（相邻段落情绪类型差异过大）
    const emotionTypes: Record<string, 'positive' | 'negative' | 'neutral'> = {
      喜悦: 'positive',
      兴奋: 'positive',
      希望: 'positive',
      惊喜: 'positive',
      爱: 'positive',
      愤怒: 'negative',
      恐惧: 'negative',
      害怕: 'negative',
      悲伤: 'negative',
      绝望: 'negative',
      厌恶: 'negative',
      仇恨: 'negative',
      紧张: 'negative',
      担忧: 'negative',
      焦虑: 'negative',
    };

    for (let i = 0; i < paragraphs.length - 1; i++) {
      const currType = this.detectEmotionCategory(paragraphs[i], emotionTypes);
      const nextType = this.detectEmotionCategory(paragraphs[i + 1], emotionTypes);

      if (currType !== 'neutral' && nextType !== 'neutral' && currType !== nextType) {
        const degree = 55;
        issues.push({
          id: `emotionBreak_abrupt_${i}`,
          type: 'emotionBreak',
          severity: 'warning',
          degree,
          description: `情绪转换突兀：从「${currType === 'positive' ? '积极' : '消极'}」突然转为「${nextType === 'positive' ? '积极' : '消极'}」，缺少过渡`,
          location: { line: i + 2 },
          suggestion: '建议增加过渡描写，让情绪转换更自然',
          confidence: 0.6,
          evidence: [paragraphs[i]?.slice(0, 30), paragraphs[i + 1]?.slice(0, 30)],
        });
      }
    }

    // 检测3: 章节结尾缺少情绪收束
    const closingParagraphs = paragraphs.slice(-5);
    const hasClosingEmotion = closingParagraphs.some((p) => hasEmotionElement(p));

    const hookPatterns = [
      /但[他是她]不知道/,
      /真正[的之]/,
      /还[在要]/,
      /却[不发]/,
      /只[剩有]/,
      /等[待着]/,
      /即将/,
      /下一/,
      /开始/,
      /来了/,
      /终于/,
    ];
    const hasHook = hookPatterns.some((p) => closingParagraphs.join('').match(p));

    if (!hasClosingEmotion && !hasHook) {
      issues.push({
        id: 'emotionBreak_no_closing',
        type: 'emotionBreak',
        severity: 'warning',
        degree: 40,
        description: '章节结尾缺少情绪收束或情绪钩子',
        suggestion: '建议在结尾增加情绪描写或悬念元素，提升读者期待感',
        confidence: 0.65,
      });
    }

    return issues;
  }

  private detectEmotionCategory(
    text: string,
    emotionTypes: Record<string, 'positive' | 'negative' | 'neutral'>
  ): 'positive' | 'negative' | 'neutral' {
    for (const [word, category] of Object.entries(emotionTypes)) {
      if (text.includes(word)) {
        return category;
      }
    }
    return 'neutral';
  }

  // ── 工具方法 ─────────────────────────────────────────────

  /** 清理 frontmatter */
  private cleanText(text: string): string {
    return text.replace(/^---\n[\s\S]*?\n---\n?/, '').trim();
  }

  /** 计算文本哈希（简单 djb2，与 quality-score-engine 保持一致） */
  private hashText(text: string): string {
    let hash = 5381;
    for (let i = 0; i < text.length; i++) {
      hash = ((hash << 5) + hash + text.charCodeAt(i)) & 0x7fffffff;
    }
    return hash.toString(36);
  }

  private splitSentences(text: string): string[] {
    return text.split(/[。！？!?]+/).filter((s) => s.trim().length > 0);
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /** 提取文本关键词（2-gram 去重） */
  private extractKeywords(text: string): string[] {
    const clean = text.replace(
      /[，。！？、；：""''（）【】《》…—\s\n\d]/g,
      ''
    );
    const keywords: string[] = [];
    for (let i = 0; i < clean.length - 1; i++) {
      const bigram = clean.slice(i, i + 2);
      if (!keywords.includes(bigram)) {
        keywords.push(bigram);
      }
    }
    return keywords.slice(0, 50);
  }

  /** 提取人物相关段落 */
  private extractCharacterParagraphs(text: string, name: string): string[] {
    return text
      .split(/\r?\n\r?\n/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0 && p.includes(name));
  }

  /** 提取包含关键词的句子 */
  private extractSentence(context: string, keyword: string): string {
    const idx = context.indexOf(keyword);
    if (idx === -1) return '';
    let start = idx;
    while (start > 0 && !/[。！？!?，,；;]/.test(context[start - 1])) {
      start--;
    }
    let end = idx + keyword.length;
    while (end < context.length && !/[。！？!?]/.test(context[end])) {
      end++;
    }
    if (end < context.length) end++;
    return context.substring(start, end).trim();
  }

  /** 根据偏离度判定预警级别 */
  private severityFromDegree(degree: number): DeviationSeverity {
    if (degree >= this.severityThresholds.critical) return 'critical';
    if (degree >= this.severityThresholds.warning) return 'warning';
    return 'info';
  }

  /** V1 严重度（low/medium/high）映射到本引擎 severity */
  private mapV1Severity(
    v1: 'low' | 'medium' | 'high',
    degree: number
  ): DeviationSeverity {
    if (v1 === 'high' || degree >= this.severityThresholds.critical) {
      return 'critical';
    }
    if (v1 === 'medium' || degree >= this.severityThresholds.warning) {
      return 'warning';
    }
    return 'info';
  }

  /** 计算单类型偏离分数（基于该类型的 issues） */
  private calculateTypeScore(issues: DeviationIssue[]): number {
    if (issues.length === 0) return 0;
    // 取最高 degree 作为类型分数
    return Math.max(...issues.map((i) => i.degree));
  }

  /** 计算总偏离分数 */
  private calculateOverallScore(
    typeScores: Record<DeviationType, number>
  ): number {
    // 加权：剧情偏离主线最重要，伏笔/节奏次之
    const weights: Record<DeviationType, number> = {
      mainline: 0.25,
      characterOOC: 0.2,
      contradiction: 0.18,
      foreshadowForgot: 0.12,
      rhythm: 0.1,
      emotionBreak: 0.15,
    };
    let total = 0;
    for (const type of DEVIATION_TYPES) {
      total += (typeScores[type] || 0) * weights[type];
    }
    return Math.min(100, Math.max(0, Math.round(total)));
  }

  /** 排序问题（按严重度倒序） */
  private sortIssues(issues: DeviationIssue[]): DeviationIssue[] {
    return [...issues].sort(
      (a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity]
    );
  }

  /** 构建改进建议列表 */
  private buildSuggestions(
    issues: DeviationIssue[]
  ): DeviationSuggestion[] {
    const suggestions: DeviationSuggestion[] = [];
    const seen = new Set<string>();
    for (const issue of issues) {
      if (!issue.suggestion) continue;
      if (seen.has(issue.suggestion)) continue;
      seen.add(issue.suggestion);
      suggestions.push({
        id: `suggestion_${suggestions.length}`,
        type: issue.type,
        content: issue.suggestion,
        priority: issue.severity,
        relatedIssueIds: [issue.id],
      });
    }
    // 按优先级倒序，最多 10 条
    return suggestions
      .sort((a, b) => SEVERITY_ORDER[b.priority] - SEVERITY_ORDER[a.priority])
      .slice(0, 10);
  }

  /** 判断类型是否可跳过（增量检测） */
  private canSkipType(
    type: DeviationType,
    text: string,
    context: DeviationContext
  ): boolean {
    if (!context.changedRange) return false;
    const changedText = text.slice(
      context.changedRange.start,
      context.changedRange.end
    );

    // 剧情偏离主线：变更范围不含大纲关键词则可跳过
    if (type === 'mainline') {
      const keywords = context.mainlineKeywords || [];
      if (keywords.length === 0) return true;
      return !keywords.some((kw) => kw.length >= 2 && changedText.includes(kw));
    }
    // 人物 OOC：变更范围不含人物名则可跳过
    if (type === 'characterOOC') {
      const names = (context.characterInfos || []).map((c) => c.name);
      if (names.length === 0) return true;
      return !names.some((n) => n && n.length >= 2 && changedText.includes(n));
    }
    // 伏笔遗忘：变更范围不含任何伏笔关键词则可跳过
    if (type === 'foreshadowForgot') {
      const foreshadows = context.foreshadows || [];
      if (foreshadows.length === 0) return true;
      return !foreshadows.some((fs) =>
        fs.keywords.some((kw) => kw.length >= 2 && changedText.includes(kw))
      );
    }
    // 节奏与前后矛盾：不跳过，需整体分析
    // 情绪断层：不跳过，需整体段落分析
    return false;
  }

  /** 检查取消信号 */
  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw new DOMException('偏离检测已取消', 'AbortError');
    }
  }

  private getPaceLabel(pace: 'fast' | 'medium' | 'slow'): string {
    const labels = { fast: '快节奏', medium: '中节奏', slow: '慢节奏' };
    return labels[pace];
  }

  private getRhythmSuggestion(
    actual: 'fast' | 'medium' | 'slow',
    expected: 'fast' | 'medium' | 'slow'
  ): string {
    if (actual === 'slow' && expected !== 'slow') {
      return '建议增加动作描写和冲突，加快叙事节奏';
    }
    if (actual === 'fast' && expected !== 'fast') {
      return '建议适当放慢节奏，增加心理描写和环境铺垫';
    }
    return '可根据需要微调节奏分布';
  }

  /** 空报告 */
  private getEmptyReport(
    wordCount: number,
    startTime: number
  ): DeviationReport {
    const typeScores: Record<DeviationType, number> = {
      mainline: 0,
      characterOOC: 0,
      contradiction: 0,
      foreshadowForgot: 0,
      rhythm: 0,
      emotionBreak: 0,
    };
    return {
      overallScore: 0,
      overallSeverity: 'info',
      typeScores,
      issues: [],
      suggestions: [
        {
          id: 'empty_continue',
          type: 'mainline',
          content: '继续写作，系统将自动检测剧情偏离',
          priority: 'info',
        },
      ],
      evaluatedAt: Date.now(),
      wordCount,
      evalTimeMs: Date.now() - startTime,
      fromCache: false,
      incremental: false,
    };
  }
}

// ============================================================
// 九、辅助函数
// ============================================================

/** 获取偏离类型标签 */
export function getDeviationTypeLabel(type: DeviationType): string {
  return DEVIATION_TYPE_LABELS[type] || type;
}

/** 获取严重度标签 */
export function getDeviationSeverityLabel(severity: DeviationSeverity): string {
  return SEVERITY_LABELS[severity] || severity;
}

/** 获取严重度对应的图标 */
export function getDeviationSeverityIcon(severity: DeviationSeverity): string {
  if (severity === 'critical') return '🔴';
  if (severity === 'warning') return '🟡';
  return '🟢';
}

/** 获取严重度对应的颜色 */
export function getDeviationSeverityColor(severity: DeviationSeverity): string {
  if (severity === 'critical') return 'var(--nw-danger, #ef4444)';
  if (severity === 'warning') return 'var(--nw-warning, #f59e0b)';
  return 'var(--nw-success, #22c55e)';
}
