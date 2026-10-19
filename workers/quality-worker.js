"use strict";

// services/worker-runtime.ts
var taskHandlers = /* @__PURE__ */ new Map();
var abortControllers = /* @__PURE__ */ new Map();
function postMessageToMain(type, taskId, payload, error) {
  const message = { type, taskId, payload, error };
  self.postMessage(message);
}
function sendProgress(taskId, progress, message) {
  const payload = { progress, message };
  postMessageToMain("task:progress", taskId, payload);
}
function sendComplete(taskId, result) {
  const payload = { result };
  postMessageToMain("task:complete", taskId, payload);
}
function sendTaskError(taskId, error) {
  postMessageToMain("task:error", taskId, void 0, error.message);
}
async function handleTaskStart(payload) {
  const { taskId, taskType, input } = payload;
  const handler = taskHandlers.get(taskType);
  if (!handler) {
    sendTaskError(taskId, new Error(`Unknown task type: ${taskType}`));
    return;
  }
  const abortController = new AbortController();
  abortControllers.set(taskId, abortController);
  try {
    const result = await handler(input, {
      onProgress: (progress, message) => {
        sendProgress(taskId, progress, message);
      },
      signal: abortController.signal
    });
    sendComplete(taskId, result);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return;
    }
    sendTaskError(taskId, error instanceof Error ? error : new Error(String(error)));
  } finally {
    abortControllers.delete(taskId);
  }
}
function handleTaskCancel(taskId) {
  const abortController = abortControllers.get(taskId);
  if (abortController) {
    abortController.abort();
    abortControllers.delete(taskId);
  }
}
function handleMessage(event) {
  const { type, taskId, payload } = event.data;
  switch (type) {
    case "task:start":
      handleTaskStart(payload);
      break;
    case "task:cancel":
      if (taskId) {
        handleTaskCancel(taskId);
      }
      break;
    default:
      break;
  }
}
function registerTaskHandler(taskType, handler) {
  taskHandlers.set(taskType, handler);
}
function startWorkerRuntime() {
  self.onmessage = handleMessage;
  postMessageToMain("worker:ready");
}

// engine/repository/lru-cache.ts
var LruCache = class {
  constructor(options = {}) {
    this.cache = /* @__PURE__ */ new Map();
    this.maxSize = options.maxSize ?? 100;
    this.ttlMs = options.ttlMs ?? 0;
  }
  // ── 基础操作 ──────────────────────────────────────────────
  /**
   * 获取缓存值
   * 命中时更新访问时间并将条目移到末尾（最新）
   * 未命中或已过期返回 undefined
   */
  get(key) {
    const entry = this.cache.get(key);
    if (!entry)
      return void 0;
    if (this.isExpired(entry)) {
      this.cache.delete(key);
      return void 0;
    }
    this.cache.delete(key);
    entry.lastAccessedAt = Date.now();
    this.cache.set(key, entry);
    return entry.value;
  }
  /**
   * 设置缓存值
   * 超过 maxSize 时淘汰最久未使用的条目
   */
  set(key, value) {
    const now = Date.now();
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }
    this.cache.set(key, {
      value,
      lastAccessedAt: now,
      createdAt: now
    });
    this.evictIfNeeded();
  }
  /**
   * 删除指定缓存条目
   * 返回是否存在并删除成功
   */
  delete(key) {
    return this.cache.delete(key);
  }
  /**
   * 检查键是否存在（考虑 TTL）
   */
  has(key) {
    const entry = this.cache.get(key);
    if (!entry)
      return false;
    if (this.isExpired(entry)) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }
  /**
   * 清空所有缓存
   */
  clear() {
    this.cache.clear();
  }
  // ── 批量操作 ──────────────────────────────────────────────
  /**
   * 按前缀批量删除缓存
   * 适用于：目录变更时失效该目录下所有文件缓存
   */
  deleteByPrefix(prefix) {
    let count = 0;
    for (const key of this.cache.keys()) {
      if (typeof key === "string" && key.startsWith(prefix)) {
        this.cache.delete(key);
        count++;
      }
    }
    return count;
  }
  /**
   * 清理所有已过期的条目
   * 返回清理的条目数
   */
  pruneExpired() {
    if (this.ttlMs <= 0)
      return 0;
    let count = 0;
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now - entry.createdAt > this.ttlMs) {
        this.cache.delete(key);
        count++;
      }
    }
    return count;
  }
  // ── 元信息 ────────────────────────────────────────────────
  /** 当前缓存条目数 */
  get size() {
    return this.cache.size;
  }
  /** 获取所有键（按访问顺序，最旧在前） */
  keys() {
    return Array.from(this.cache.keys());
  }
  // ── 内部方法 ──────────────────────────────────────────────
  /** 判断条目是否已过期 */
  isExpired(entry) {
    if (this.ttlMs <= 0)
      return false;
    return Date.now() - entry.createdAt > this.ttlMs;
  }
  /** 超过最大容量时淘汰最久未使用的条目 */
  evictIfNeeded() {
    while (this.cache.size > this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== void 0) {
        this.cache.delete(firstKey);
      }
    }
  }
};

// engine/coherence-checker.ts
var SENTENCE_SPLIT = /[\u3002\uff01\uff1f\uff1b\n]+/;
var STOPWORDS = /* @__PURE__ */ new Set([
  "\u7684",
  "\u4E86",
  "\u662F",
  "\u5728",
  "\u6211",
  "\u4F60",
  "\u4ED6",
  "\u5979",
  "\u5B83",
  "\u4EEC",
  "\u8FD9",
  "\u90A3",
  "\u548C",
  "\u4E0E",
  "\u4E5F",
  "\u90FD",
  "\u5C31",
  "\u8FD8",
  "\u4E0D",
  "\u6CA1",
  "\u4E00\u4E2A",
  "\u4EC0\u4E48",
  "\u600E\u4E48",
  "\u53EF\u4EE5",
  "\u6240\u4EE5",
  "\u56E0\u4E3A",
  "\u4F46\u662F",
  "\u8FD9\u6837",
  "\u8D77\u6765",
  "\u4E0B\u53BB",
  "\u4E00\u4E9B",
  "\u81EA\u5DF1",
  "\u4E8E\u662F",
  "\u7136\u540E"
]);
function normalize(sentence) {
  return sentence.replace(/[\s\u3000\uff0c\u3001\u201c\u201d\u2018\u2019\uff08\uff09\u2014\u2026]/g, "").trim();
}
function analyzeCoherence(body, recentWindow = 1500) {
  const issues = [];
  const text = (body || "").slice(-recentWindow);
  const rawSentences = text.split(SENTENCE_SPLIT).map((s) => s.trim()).filter((s) => s.length >= 6);
  const norm = rawSentences.map(normalize).filter((s) => s.length >= 6);
  const seen = /* @__PURE__ */ new Map();
  for (const s of norm) {
    seen.set(s, (seen.get(s) || 0) + 1);
  }
  for (const [s, c] of seen) {
    if (c >= 2) {
      issues.push({
        type: "duplicate_sentence",
        message: `\u6709\u53E5\u5B50\u91CD\u590D\u51FA\u73B0 ${c} \u6B21\uFF0C\u8003\u8651\u5408\u5E76\u6216\u5220\u9664`,
        sample: s.slice(0, 24),
        count: c
      });
    }
  }
  const phraseCounts = /* @__PURE__ */ new Map();
  const plain = norm.join("");
  const N = 4;
  for (let i = 0; i + N <= plain.length; i++) {
    const gram = plain.slice(i, i + N);
    if (/^[\u4e00-\u9fa5]{4}$/.test(gram)) {
      phraseCounts.set(gram, (phraseCounts.get(gram) || 0) + 1);
    }
  }
  const phraseHits = [...phraseCounts.entries()].filter(([, c]) => c >= 3).sort((a, b) => b[1] - a[1]).slice(0, 3);
  for (const [gram, c] of phraseHits) {
    issues.push({
      type: "repeated_phrase",
      message: `\u77ED\u8BED\u300C${gram}\u300D\u5728\u8FD1\u6587\u91CD\u590D ${c} \u6B21`,
      sample: gram,
      count: c
    });
  }
  const wordCounts = /* @__PURE__ */ new Map();
  const tokens = plain.match(/[\u4e00-\u9fa5]{2,3}/g) || [];
  for (const t of tokens) {
    if (STOPWORDS.has(t))
      continue;
    wordCounts.set(t, (wordCounts.get(t) || 0) + 1);
  }
  const wordHits = [...wordCounts.entries()].filter(([, c]) => c >= 5).sort((a, b) => b[1] - a[1]).slice(0, 3);
  for (const [w, c] of wordHits) {
    issues.push({
      type: "overused_word",
      message: `\u8BCD\u300C${w}\u300D\u5728\u8FD1\u6587\u51FA\u73B0 ${c} \u6B21\uFF0C\u8003\u8651\u6362\u4E2A\u8BF4\u6CD5`,
      sample: w,
      count: c
    });
  }
  return { issues, sentenceCount: rawSentences.length, checkedAt: Date.now() };
}

// engine/quality/quality-score-engine.ts
var QUALITY_DIMENSIONS = [
  "readability",
  "rhythm",
  "emotion",
  "characterConsistency",
  "coherence",
  "languageTexture"
];
var DIMENSION_WEIGHTS = {
  readability: 0.18,
  rhythm: 0.17,
  emotion: 0.17,
  characterConsistency: 0.18,
  coherence: 0.15,
  languageTexture: 0.15
};
var QualityScoreEngine = class {
  constructor(options = {}) {
    /** 历史趋势记录 */
    this.history = [];
    this.v1Engine = options.v1Engine;
    this.rhythmAnalyzer = options.rhythmAnalyzer;
    this.emotionAnalyzer = options.emotionAnalyzer;
    this.characterChecker = options.characterChecker;
    const cacheSize = options.cacheSize ?? 50;
    const cacheTtlMs = options.cacheTtlMs ?? 6e4;
    this.dimensionCache = new LruCache({
      maxSize: cacheSize * 6,
      ttlMs: cacheTtlMs
    });
    this.fullCache = new LruCache({
      maxSize: cacheSize,
      ttlMs: cacheTtlMs
    });
    this.historySize = options.historySize ?? 20;
  }
  // ── 公开 API ──────────────────────────────────────────────
  /**
   * 评估文本的六维质量
   * @param text 正文文本
   * @param context 评估上下文
   * @param signal 取消信号
   */
  async evaluate(text, context = {}, signal) {
    const startTime = Date.now();
    const cleanText = this.cleanText(text);
    const wordCount = cleanText.length;
    const textHash = this.hashText(cleanText);
    if (!context.changedRange) {
      const cached = this.fullCache.get(textHash);
      if (cached) {
        return { ...cached, fromCache: true, evalTimeMs: Date.now() - startTime };
      }
    }
    if (wordCount < 100) {
      const empty = this.getEmptyScore(wordCount, startTime);
      this.fullCache.set(textHash, empty);
      return empty;
    }
    this.throwIfAborted(signal);
    const dimensions = {};
    for (const dim of QUALITY_DIMENSIONS) {
      this.throwIfAborted(signal);
      dimensions[dim] = await this.evaluateDimensionInternal(cleanText, dim, context, signal);
    }
    this.throwIfAborted(signal);
    const overallScore = this.calculateOverallScore(dimensions);
    const allIssues = this.collectIssues(dimensions);
    const allSuggestions = this.collectSuggestions(dimensions);
    const trend = this.calculateTrend(overallScore);
    this.recordHistory(overallScore);
    const result = {
      overallScore,
      dimensions,
      issues: allIssues,
      suggestions: allSuggestions,
      evaluatedAt: Date.now(),
      wordCount,
      evalTimeMs: Date.now() - startTime,
      trend,
      fromCache: false
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
   */
  async evaluateDimension(text, dimension, context = {}, signal) {
    const cleanText = this.cleanText(text);
    return this.evaluateDimensionInternal(cleanText, dimension, context, signal);
  }
  /** 获取历史趋势记录 */
  getHistory() {
    return [...this.history];
  }
  /** 清空所有缓存 */
  clearCache() {
    this.dimensionCache.clear();
    this.fullCache.clear();
  }
  /** 按 key 失效缓存 */
  invalidateCache(text) {
    if (text === void 0) {
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
  clearHistory() {
    this.history = [];
  }
  // ── 维度评估实现 ──────────────────────────────────────────
  async evaluateDimensionInternal(text, dimension, context, signal) {
    const textHash = this.hashText(text);
    const cacheKey = `${dimension}:${textHash}`;
    const canSkip = this.canSkipDimension(dimension, text, context);
    if (canSkip) {
      const cached = this.dimensionCache.get(cacheKey);
      if (cached) {
        return cached;
      }
    } else {
      const cached = this.dimensionCache.get(cacheKey);
      if (cached) {
        return cached;
      }
    }
    this.throwIfAborted(signal);
    let result;
    switch (dimension) {
      case "readability":
        result = this.evaluateReadability(text, context);
        break;
      case "rhythm":
        result = await this.evaluateRhythm(text, context, signal);
        break;
      case "emotion":
        result = await this.evaluateEmotion(text, context, signal);
        break;
      case "characterConsistency":
        result = await this.evaluateCharacterConsistency(text, context, signal);
        break;
      case "coherence":
        result = this.evaluateCoherence(text, context);
        break;
      case "languageTexture":
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
  evaluateReadability(text, context) {
    const basis = [
      "\u53E5\u957F\u9002\u4E2D\u5EA6\uFF08\u5E73\u5747\u53E5\u957F 15-30 \u5B57\u4E3A\u4F73\uFF09",
      "\u53E5\u5F0F\u591A\u6837\u6027\uFF08\u957F\u77ED\u53E5\u642D\u914D\uFF09",
      "\u6807\u70B9\u4F7F\u7528\u89C4\u8303\u5EA6",
      "\u8BCD\u6C47\u4E30\u5BCC\u5EA6\u4E0E\u91CD\u590D\u7387"
    ];
    const issues = [];
    const suggestions = [];
    const details = {};
    const sentences = this.splitSentences(text);
    const totalSentences = sentences.length;
    const paragraphs = this.splitParagraphs(text);
    const sentenceLengths = sentences.map((s) => s.length);
    const avgSentenceLen = totalSentences > 0 ? sentenceLengths.reduce((a, b) => a + b, 0) / totalSentences : 0;
    const sentenceVariance = totalSentences > 1 ? sentenceLengths.reduce(
      (sum, len) => sum + Math.pow(len - avgSentenceLen, 2),
      0
    ) / totalSentences : 0;
    const sentenceStdDev = Math.sqrt(sentenceVariance);
    const sentenceVariety = Math.min(
      100,
      sentenceStdDev / Math.max(1, avgSentenceLen) * 200
    );
    details.avgSentenceLen = Math.round(avgSentenceLen) + "\u5B57";
    details.sentenceVariety = Math.round(sentenceVariety) + "%";
    details.paragraphCount = paragraphs.length;
    const punctuationCount = (text.match(/[，。！？、；：""''（）【】《》…—]/g) || []).length;
    const punctRatio = text.length > 0 ? punctuationCount / text.length : 0;
    details.punctRatio = Math.round(punctRatio * 1e3) / 10 + "%";
    const punctScore = this.scoreInRange(punctRatio, 0.05, 0.12, 0.02, 0.2);
    const uniqueChars = new Set(
      text.replace(/[\s\n，。！？、；：""''（）【】《》…—]/g, "")
    ).size;
    const totalChars = text.replace(
      /[\s\n，。！？、；：""''（）【】《》…—]/g,
      ""
    ).length;
    const vocabRichness = totalChars > 0 ? uniqueChars / Math.min(totalChars, 500) * 100 : 0;
    details.vocabRichness = Math.round(vocabRichness) + "%";
    const typoPatterns = [
      { pattern: /的得地/g, label: "\u7684/\u5F97/\u5730\u6DF7\u7528" },
      { pattern: /在再/g, label: "\u5728/\u518D\u6DF7\u7528" },
      { pattern: /那哪/g, label: "\u90A3/\u54EA\u6DF7\u7528" },
      { pattern: /已以/g, label: "\u5DF2/\u4EE5\u6DF7\u7528" }
    ];
    const typoIssues = [];
    let typoPenalty = 0;
    for (const { pattern, label } of typoPatterns) {
      const count = (text.match(pattern) || []).length;
      if (count > 0) {
        typoIssues.push(label);
        typoPenalty += count * 5;
        const match = new RegExp(pattern.source).exec(text);
        if (match && match.index !== void 0) {
          issues.push({
            id: `readability_typo_${label}_${issues.length}`,
            dimension: "readability",
            description: `\u53EF\u80FD\u5B58\u5728\u7528\u5B57\u95EE\u9898\uFF1A${label}`,
            severity: "high",
            location: { charOffset: match.index, length: match[0].length }
          });
        }
      }
    }
    details.typoIssues = typoIssues.length > 0 ? typoIssues.join("\u3001") : "\u65E0";
    const repeatPattern = /(.{2,})\1{2,}/g;
    const repeatMatches = text.match(repeatPattern) || [];
    details.repetitionCount = repeatMatches.length;
    const repeatPenalty = repeatMatches.length * 10;
    const lenScore = this.scoreInRange(avgSentenceLen, 15, 30, 5, 60);
    const varietyScore = sentenceVariety;
    const vocabScore = Math.min(100, vocabRichness * 1.5);
    const finalTypoScore = Math.max(0, 100 - typoPenalty - repeatPenalty);
    const score = Math.round(
      lenScore * 0.3 + varietyScore * 0.25 + vocabScore * 0.2 + punctScore * 0.1 + finalTypoScore * 0.15
    );
    if (avgSentenceLen > 40) {
      suggestions.push({
        id: "readability_long_sentence",
        dimension: "readability",
        content: "\u5E73\u5747\u53E5\u957F\u504F\u957F\uFF0C\u5EFA\u8BAE\u62C6\u5206\u957F\u53E5\uFF0C\u63D0\u5347\u53EF\u8BFB\u6027",
        priority: "medium",
        estimatedEffort: "\u5C0F"
      });
    }
    if (avgSentenceLen < 8 && totalSentences > 10) {
      suggestions.push({
        id: "readability_short_sentence",
        dimension: "readability",
        content: "\u53E5\u5B50\u8FC7\u77ED\uFF0C\u5EFA\u8BAE\u9002\u5F53\u6269\u5145\u7EC6\u8282\uFF0C\u907F\u514D\u788E\u7247\u5316",
        priority: "medium",
        estimatedEffort: "\u5C0F"
      });
    }
    if (sentenceVariety < 30 && totalSentences > 10) {
      suggestions.push({
        id: "readability_variety",
        dimension: "readability",
        content: "\u53E5\u5F0F\u53D8\u5316\u8F83\u5C11\uFF0C\u5EFA\u8BAE\u7A7F\u63D2\u4F7F\u7528\u4E0D\u540C\u957F\u5EA6\u7684\u53E5\u5B50",
        priority: "medium",
        estimatedEffort: "\u4E2D\u7B49"
      });
    }
    if (vocabRichness < 40) {
      suggestions.push({
        id: "readability_vocab",
        dimension: "readability",
        content: "\u7528\u8BCD\u8F83\u4E3A\u5355\u4E00\uFF0C\u5EFA\u8BAE\u589E\u52A0\u8BCD\u6C47\u4E30\u5BCC\u5EA6\uFF0C\u4F7F\u7528\u66F4\u591A\u8FD1\u4E49\u8BCD",
        priority: "medium",
        estimatedEffort: "\u4E2D\u7B49"
      });
    }
    if (typoIssues.length > 0) {
      suggestions.push({
        id: "readability_typo",
        dimension: "readability",
        content: `\u53EF\u80FD\u5B58\u5728\u7528\u5B57\u95EE\u9898\uFF1A${typoIssues.join("\u3001")}\uFF0C\u5EFA\u8BAE\u68C0\u67E5`,
        priority: "high",
        estimatedEffort: "\u5C0F"
      });
    }
    if (repeatMatches.length > 2) {
      suggestions.push({
        id: "readability_repeat",
        dimension: "readability",
        content: "\u5B58\u5728\u91CD\u590D\u7528\u5B57/\u8BCD\u73B0\u8C61\uFF0C\u5EFA\u8BAE\u7CBE\u7B80\u8868\u8FBE\uFF0C\u907F\u514D\u5197\u4F59\u91CD\u590D",
        priority: "medium",
        estimatedEffort: "\u5C0F"
      });
    }
    return {
      dimension: "readability",
      score: Math.min(100, Math.max(0, score)),
      basis,
      issues,
      suggestions,
      details
    };
  }
  // ── 维度 2：节奏 ────────────────────────────────────────
  /**
   * 节奏维度：快慢节奏交替、张弛有度、高潮分布
   * 复用 RhythmAnalyzer（若注入），否则使用内置规则
   */
  async evaluateRhythm(text, context, signal) {
    const basis = [
      "\u5FEB\u6162\u8282\u594F\u4EA4\u66FF\uFF08fast/medium/slow \u5206\u5E03\uFF09",
      "\u5F20\u5F1B\u6709\u5EA6\uFF08\u52A8\u4F5C/\u5BF9\u8BDD/\u63CF\u5199/\u5185\u5FC3\u620F\u5747\u8861\uFF09",
      "\u9AD8\u6F6E\u5206\u5E03\uFF08\u7D27\u5F20\u5EA6\u5CF0\u503C\u5206\u5E03\uFF09"
    ];
    const issues = [];
    const suggestions = [];
    const details = {};
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
      details.fastPaceRatio = total > 0 ? Math.round(paceCounts.fast / total * 100) + "%" : "0%";
      details.slowPaceRatio = total > 0 ? Math.round(paceCounts.slow / total * 100) + "%" : "0%";
      details.overallPace = analysis.overallPace;
      const paceVariety = total > 0 ? this.calculateDiversity([
        paceCounts.fast,
        paceCounts.medium,
        paceCounts.slow
      ]) : 0;
      details.paceVariety = Math.round(paceVariety) + "%";
      const typeDiversity = total > 0 ? this.calculateDiversity([
        typeCounts.action,
        typeCounts.dialogue,
        typeCounts.description,
        typeCounts.introspection
      ]) : 0;
      details.typeDiversity = Math.round(typeDiversity) + "%";
      const tensions = segments.map((s) => s.tensionLevel);
      const avgTension = tensions.length > 0 ? tensions.reduce((a, b) => a + b, 0) / tensions.length : 0;
      const maxTension = tensions.length > 0 ? Math.max(...tensions) : 0;
      details.avgTension = Math.round(avgTension);
      details.maxTension = maxTension;
      const balanceScore = Math.min(100, paceVariety);
      const typeScore = Math.min(100, typeDiversity);
      const tensionScore = Math.min(100, avgTension * 0.6 + maxTension * 0.4);
      const score = Math.round(
        balanceScore * 0.35 + typeScore * 0.35 + tensionScore * 0.3
      );
      for (const seg of analysis.suggestions) {
        suggestions.push({
          id: `rhythm_analyzer_${suggestions.length}`,
          dimension: "rhythm",
          content: seg,
          priority: "medium"
        });
      }
      if (paceCounts.slow > total * 0.5 && total > 4) {
        issues.push({
          id: "rhythm_too_slow",
          dimension: "rhythm",
          description: "\u6574\u4F53\u8282\u594F\u504F\u6162\uFF0C\u6162\u8282\u594F\u6BB5\u843D\u5360\u6BD4\u8FC7\u9AD8",
          severity: "medium"
        });
        suggestions.push({
          id: "rhythm_speed_up",
          dimension: "rhythm",
          content: "\u6574\u4F53\u8282\u594F\u504F\u6162\uFF0C\u5EFA\u8BAE\u589E\u52A0\u52A8\u4F5C\u6216\u5BF9\u8BDD\u573A\u666F\u63D0\u5347\u8282\u594F",
          priority: "high",
          estimatedEffort: "\u4E2D\u7B49"
        });
      }
      if (paceCounts.fast > total * 0.5 && total > 4) {
        issues.push({
          id: "rhythm_too_fast",
          dimension: "rhythm",
          description: "\u6574\u4F53\u8282\u594F\u504F\u5FEB\uFF0C\u7F3A\u4E4F\u7F13\u51B2",
          severity: "medium"
        });
        suggestions.push({
          id: "rhythm_slow_down",
          dimension: "rhythm",
          content: "\u6574\u4F53\u8282\u594F\u504F\u5FEB\uFF0C\u5EFA\u8BAE\u7A7F\u63D2\u63CF\u5199\u6216\u5185\u5FC3\u620F\u8C03\u8282",
          priority: "medium",
          estimatedEffort: "\u4E2D\u7B49"
        });
      }
      return {
        dimension: "rhythm",
        score: Math.min(100, Math.max(0, score)),
        basis,
        issues,
        suggestions,
        details
      };
    }
    return this.evaluateRhythmFallback(text, basis, issues, suggestions, details);
  }
  evaluateRhythmFallback(text, basis, issues, suggestions, details) {
    const RHYTHM_VERBS = [
      "\u51B2",
      "\u6253",
      "\u780D",
      "\u523A",
      "\u6740",
      "\u51FB",
      "\u6251",
      "\u8DC3",
      "\u95EA",
      "\u8EB2",
      "\u8DD1",
      "\u8FFD",
      "\u9003",
      "\u8D76",
      "\u649E",
      "\u7838",
      "\u6454",
      "\u98DE",
      "\u843D",
      "\u8D77"
    ];
    const DIALOGUE_MARKERS = [
      "\u8BF4",
      "\u9053",
      "\u95EE",
      "\u7B54",
      "\u558A",
      "\u53EB",
      "\u543C",
      "\u54ED",
      "\u7B11",
      "\u53F9"
    ];
    const DESCRIPTION_WORDS = [
      "\u7684",
      "\u4E86",
      "\u7740",
      "\u662F",
      "\u5728",
      "\u6709",
      "\u5F88",
      "\u90FD",
      "\u5C31",
      "\u53C8"
    ];
    let actionCount = 0;
    for (const word of RHYTHM_VERBS) {
      actionCount += (text.match(new RegExp(word, "g")) || []).length;
    }
    let dialogueCount = 0;
    for (const marker of DIALOGUE_MARKERS) {
      dialogueCount += (text.match(new RegExp(marker + '["\u300C\u300E]', "g")) || []).length;
    }
    let descCount = 0;
    for (const word of DESCRIPTION_WORDS) {
      descCount += (text.match(new RegExp(word, "g")) || []).length;
    }
    const actionRatio = text.length > 0 ? actionCount / text.length * 100 : 0;
    const dialogueRatio = text.length > 0 ? dialogueCount / text.length * 100 : 0;
    const descRatio = text.length > 0 ? descCount / text.length * 100 : 0;
    details.actionDensity = Math.round(actionRatio * 10) / 10;
    details.dialogueDensity = Math.round(dialogueRatio * 10) / 10;
    details.descriptionDensity = Math.round(descRatio * 10) / 10;
    const balanceScore = this.calculateBalanceScore(actionRatio, dialogueRatio, descRatio);
    details.balanceScore = Math.round(balanceScore) + "%";
    const score = Math.round(balanceScore);
    if (actionRatio < 1.5 && text.length > 1e3) {
      issues.push({
        id: "rhythm_action_low",
        dimension: "rhythm",
        description: "\u52A8\u4F5C\u63CF\u5199\u504F\u5C11",
        severity: "medium"
      });
      suggestions.push({
        id: "rhythm_action",
        dimension: "rhythm",
        content: "\u52A8\u4F5C\u63CF\u5199\u504F\u5C11\uFF0C\u5EFA\u8BAE\u589E\u52A0\u89D2\u8272\u884C\u4E3A\u548C\u52A8\u6001\u63CF\u5199\u63D0\u5347\u8282\u594F",
        priority: "medium",
        estimatedEffort: "\u4E2D\u7B49"
      });
    }
    if (descRatio > 20) {
      issues.push({
        id: "rhythm_desc_high",
        dimension: "rhythm",
        description: "\u9759\u6001\u63CF\u5199\u8FC7\u591A\uFF0C\u53EF\u80FD\u62D6\u6162\u8282\u594F",
        severity: "medium"
      });
      suggestions.push({
        id: "rhythm_too_much_desc",
        dimension: "rhythm",
        content: "\u9759\u6001\u63CF\u5199\u8FC7\u591A\u53EF\u80FD\u62D6\u6162\u8282\u594F\uFF0C\u5EFA\u8BAE\u7CBE\u7B80\u63CF\u5199\uFF0C\u7A7F\u63D2\u52A8\u6001\u60C5\u8282",
        priority: "medium",
        estimatedEffort: "\u4E2D\u7B49"
      });
    }
    return {
      dimension: "rhythm",
      score: Math.min(100, Math.max(0, score)),
      basis,
      issues,
      suggestions,
      details
    };
  }
  // ── 维度 3：情绪饱满度 ───────────────────────────────────
  /**
   * 情绪饱满度维度：情绪表达丰富度、情绪变化自然度
   * 复用 EmotionCurveAnalyzer（若注入），否则使用内置规则
   */
  async evaluateEmotion(text, context, signal) {
    const basis = [
      "\u60C5\u7EEA\u8868\u8FBE\u4E30\u5BCC\u5EA6\uFF08\u60C5\u7EEA\u8BCD\u6C47\u5BC6\u5EA6\uFF09",
      "\u60C5\u7EEA\u53D8\u5316\u81EA\u7136\u5EA6\uFF08\u6CE2\u52A8\u5EA6\u4E0E\u5F27\u7EBF\u7C7B\u578B\uFF09",
      "\u60C5\u7EEA\u5F3A\u5EA6\u5206\u5E03"
    ];
    const issues = [];
    const suggestions = [];
    const details = {};
    if (this.emotionAnalyzer) {
      const curve = await this.emotionAnalyzer.analyze(text);
      this.throwIfAborted(signal);
      const points = curve.points;
      const totalPoints = points.length;
      details.totalPoints = totalPoints;
      details.dominantEmotion = curve.dominantEmotion;
      details.volatility = curve.volatility;
      details.arcType = curve.arcType;
      const emotionTypes = new Set(points.map((p) => p.emotion));
      details.emotionVariety = emotionTypes.size;
      const avgIntensity = totalPoints > 0 ? points.reduce((sum, p) => sum + p.intensity, 0) / totalPoints : 0;
      details.avgIntensity = Math.round(avgIntensity);
      const varietyScore = Math.min(100, emotionTypes.size * 20);
      const intensityScore = Math.min(100, avgIntensity);
      const volatilityScore = this.scoreInRange(curve.volatility, 15, 30, 0, 60);
      const arcScore = curve.arcType === "wave" ? 100 : curve.arcType === "rise" || curve.arcType === "fall" ? 75 : 50;
      const score = Math.round(
        varietyScore * 0.3 + intensityScore * 0.3 + volatilityScore * 0.2 + arcScore * 0.2
      );
      if (totalPoints === 0) {
        issues.push({
          id: "emotion_no_points",
          dimension: "emotion",
          description: "\u65E0\u6CD5\u63D0\u53D6\u60C5\u7EEA\u8282\u70B9",
          severity: "medium"
        });
      }
      if (avgIntensity < 30) {
        issues.push({
          id: "emotion_low_intensity",
          dimension: "emotion",
          description: "\u60C5\u7EEA\u5F3A\u5EA6\u504F\u4F4E\uFF0C\u8868\u8FBE\u4E0D\u591F\u9971\u6EE1",
          severity: "low"
        });
        suggestions.push({
          id: "emotion_intensity",
          dimension: "emotion",
          content: "\u60C5\u7EEA\u5F3A\u5EA6\u504F\u4F4E\uFF0C\u5EFA\u8BAE\u52A0\u5F3A\u60C5\u611F\u8868\u8FBE\u548C\u5FC3\u7406\u6D3B\u52A8\u63CF\u5199",
          priority: "medium",
          estimatedEffort: "\u4E2D\u7B49"
        });
      }
      if (curve.volatility > 50) {
        issues.push({
          id: "emotion_too_volatile",
          dimension: "emotion",
          description: "\u60C5\u7EEA\u6CE2\u52A8\u8FC7\u5927\uFF0C\u53D8\u5316\u4E0D\u591F\u81EA\u7136",
          severity: "medium"
        });
        suggestions.push({
          id: "emotion_smooth",
          dimension: "emotion",
          content: "\u60C5\u7EEA\u53D8\u5316\u8FC7\u4E8E\u5267\u70C8\uFF0C\u5EFA\u8BAE\u589E\u52A0\u8FC7\u6E21\u63CF\u5199\u4F7F\u60C5\u7EEA\u8F6C\u6298\u66F4\u81EA\u7136",
          priority: "medium",
          estimatedEffort: "\u4E2D\u7B49"
        });
      }
      if (curve.arcType === "flat" && totalPoints > 3) {
        issues.push({
          id: "emotion_flat",
          dimension: "emotion",
          description: "\u60C5\u7EEA\u5F27\u7EBF\u8FC7\u4E8E\u5E73\u6DE1\uFF0C\u7F3A\u4E4F\u8D77\u4F0F",
          severity: "low"
        });
        suggestions.push({
          id: "emotion_arc",
          dimension: "emotion",
          content: "\u60C5\u7EEA\u5F27\u7EBF\u5E73\u6DE1\uFF0C\u5EFA\u8BAE\u8BBE\u8BA1\u60C5\u7EEA\u8D77\u4F0F\u589E\u5F3A\u611F\u67D3\u529B",
          priority: "low",
          estimatedEffort: "\u5927"
        });
      }
      return {
        dimension: "emotion",
        score: Math.min(100, Math.max(0, score)),
        basis,
        issues,
        suggestions,
        details
      };
    }
    return this.evaluateEmotionFallback(text, basis, issues, suggestions, details);
  }
  evaluateEmotionFallback(text, basis, issues, suggestions, details) {
    const POS_EMOTIONS = [
      "\u559C\u60A6",
      "\u5F00\u5FC3",
      "\u9AD8\u5174",
      "\u5FEB\u4E50",
      "\u5E78\u798F",
      "\u6EE1\u8DB3",
      "\u6B23\u6170",
      "\u6FC0\u52A8",
      "\u5174\u594B",
      "\u671F\u5F85",
      "\u5E0C\u671B",
      "\u70ED\u60C5",
      "\u611F\u6FC0",
      "\u611F\u52A8",
      "\u9A84\u50B2",
      "\u81EA\u8C6A"
    ];
    const NEG_EMOTIONS = [
      "\u60B2\u4F24",
      "\u75DB\u82E6",
      "\u7EDD\u671B",
      "\u6050\u60E7",
      "\u5BB3\u6015",
      "\u6124\u6012",
      "\u751F\u6C14",
      "\u618E\u6068",
      "\u538C\u6076",
      "\u5AC9\u5992",
      "\u7F9E\u6127",
      "\u5185\u759A",
      "\u540E\u6094",
      "\u7126\u8651",
      "\u7D27\u5F20",
      "\u62C5\u5FE7"
    ];
    let posCount = 0;
    for (const w of POS_EMOTIONS) {
      posCount += (text.match(new RegExp(w, "g")) || []).length;
    }
    let negCount = 0;
    for (const w of NEG_EMOTIONS) {
      negCount += (text.match(new RegExp(w, "g")) || []).length;
    }
    const totalEmotion = posCount + negCount;
    details.positiveEmotions = posCount;
    details.negativeEmotions = negCount;
    details.totalEmotions = totalEmotion;
    details.emotionDensity = text.length > 0 ? Math.round(totalEmotion / text.length * 1e4) / 100 + "%" : "0%";
    const emotionScore = Math.min(100, totalEmotion * 8);
    const balanceScore = totalEmotion > 0 ? Math.min(100, 100 - Math.abs(posCount - negCount) * 10) : 50;
    const score = Math.round(emotionScore * 0.6 + balanceScore * 0.4);
    if (totalEmotion < 3 && text.length > 1e3) {
      issues.push({
        id: "emotion_sparse",
        dimension: "emotion",
        description: "\u60C5\u7EEA\u8868\u8FBE\u7A00\u5C11",
        severity: "medium"
      });
      suggestions.push({
        id: "emotion_add",
        dimension: "emotion",
        content: "\u60C5\u7EEA\u6E32\u67D3\u504F\u5F31\uFF0C\u5EFA\u8BAE\u52A0\u5F3A\u89D2\u8272\u7684\u60C5\u611F\u8868\u8FBE\u548C\u5FC3\u7406\u6D3B\u52A8",
        priority: "medium",
        estimatedEffort: "\u4E2D\u7B49"
      });
    }
    return {
      dimension: "emotion",
      score: Math.min(100, Math.max(0, score)),
      basis,
      issues,
      suggestions,
      details
    };
  }
  // ── 维度 4：人物一致性 ───────────────────────────────────
  /**
   * 人物一致性维度：人物行为符合设定、对话风格一致
   * 复用 CharacterConsistencyChecker（若注入），否则使用内置规则
   */
  async evaluateCharacterConsistency(text, context, signal) {
    const basis = [
      "\u4EBA\u7269\u884C\u4E3A\u7B26\u5408\u6027\u683C\u8BBE\u5B9A",
      "\u5BF9\u8BDD\u98CE\u683C\u4E00\u81F4\u6027",
      "\u5916\u8C8C\u63CF\u8FF0\u4E00\u81F4\u6027",
      "\u80FD\u529B\u8FB9\u754C\u4E00\u81F4\u6027"
    ];
    const issues = [];
    const suggestions = [];
    const details = {};
    const characterInfos = context.characterInfos || [];
    const characterNames = context.characterNames || characterInfos.map((c) => c.name);
    if (this.characterChecker && characterInfos.length > 0) {
      const historyTexts = context.previousChapterText ? [context.previousChapterText] : void 0;
      const result = await this.characterChecker.check(text, characterInfos, historyTexts);
      this.throwIfAborted(signal);
      details.overallScore = result.overallScore;
      details.checkedCharacters = Object.keys(result.characterResults).length;
      for (const [name, charResult] of Object.entries(result.characterResults)) {
        for (const inc of charResult.inconsistencies) {
          issues.push({
            id: `char_${name}_${inc.type}_${issues.length}`,
            dimension: "characterConsistency",
            description: `[${name}] ${inc.description}`,
            severity: inc.severity
          });
          if (inc.suggestion) {
            suggestions.push({
              id: `char_suggest_${name}_${inc.type}_${suggestions.length}`,
              dimension: "characterConsistency",
              content: inc.suggestion,
              priority: inc.severity === "high" ? "high" : inc.severity === "medium" ? "medium" : "low"
            });
          }
        }
      }
      const score = result.overallScore;
      if (issues.filter((i) => i.severity === "high").length > 0) {
        suggestions.push({
          id: "char_fix_high",
          dimension: "characterConsistency",
          content: "\u5B58\u5728\u4E25\u91CD\u7684\u4EBA\u8BBE\u4E0D\u4E00\u81F4\uFF0C\u5EFA\u8BAE\u4F18\u5148\u4FEE\u6B63\u9AD8\u4E25\u91CD\u5EA6\u95EE\u9898",
          priority: "high",
          estimatedEffort: "\u5927"
        });
      }
      return {
        dimension: "characterConsistency",
        score: Math.min(100, Math.max(0, score)),
        basis,
        issues,
        suggestions,
        details
      };
    }
    return this.evaluateCharacterFallback(
      text,
      characterNames,
      basis,
      issues,
      suggestions,
      details
    );
  }
  evaluateCharacterFallback(text, characterNames, basis, issues, suggestions, details) {
    let charMentionCount = 0;
    const charMentions = {};
    if (characterNames.length > 0) {
      for (const name of characterNames) {
        if (!name || name.length < 2)
          continue;
        const count = (text.match(new RegExp(this.escapeRegex(name), "g")) || []).length;
        if (count > 0) {
          charMentions[name] = count;
          charMentionCount += count;
        }
      }
    }
    details.characterMentions = charMentionCount;
    details.uniqueCharacters = Object.keys(charMentions).length;
    const dialogues = [];
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
    if (dialogues.length >= 5) {
      const uniqueStarts = new Set(dialogues.map((d) => d.slice(0, 2)));
      const uniqueEnds = new Set(dialogues.map((d) => d.slice(-2)));
      const startVariety = uniqueStarts.size / dialogues.length * 100;
      const endVariety = uniqueEnds.size / dialogues.length * 100;
      dialoguePersonality = Math.min(100, startVariety * 0.3 + endVariety * 0.3 + 40);
    }
    details.dialoguePersonality = Math.round(dialoguePersonality) + "%";
    const mentionScore = Math.min(100, charMentionCount * 4);
    const score = Math.round(mentionScore * 0.4 + dialoguePersonality * 0.6);
    if (characterNames.length > 0 && charMentionCount === 0) {
      issues.push({
        id: "char_no_mention",
        dimension: "characterConsistency",
        description: "\u8BBE\u5B9A\u4EBA\u7269\u672A\u5728\u6B63\u6587\u4E2D\u51FA\u73B0",
        severity: "medium"
      });
      suggestions.push({
        id: "char_add_mention",
        dimension: "characterConsistency",
        content: "\u4E3B\u8981\u89D2\u8272\u672A\u51FA\u573A\uFF0C\u5EFA\u8BAE\u589E\u52A0\u4E3B\u89D2\u89C6\u89D2\u548C\u4E92\u52A8\u573A\u666F",
        priority: "high",
        estimatedEffort: "\u4E2D\u7B49"
      });
    }
    if (dialoguePersonality < 40 && dialogues.length > 5) {
      issues.push({
        id: "char_low_personality",
        dimension: "characterConsistency",
        description: "\u5BF9\u8BDD\u8FA8\u8BC6\u5EA6\u4E0D\u9AD8",
        severity: "low"
      });
      suggestions.push({
        id: "char_personality",
        dimension: "characterConsistency",
        content: "\u5BF9\u8BDD\u8FA8\u8BC6\u5EA6\u4E0D\u9AD8\uFF0C\u5EFA\u8BAE\u4E3A\u4E0D\u540C\u89D2\u8272\u8BBE\u8BA1\u72EC\u7279\u7684\u8BF4\u8BDD\u98CE\u683C\u548C\u53E3\u5934\u7985",
        priority: "medium",
        estimatedEffort: "\u4E2D\u7B49"
      });
    }
    return {
      dimension: "characterConsistency",
      score: Math.min(100, Math.max(0, score)),
      basis,
      issues,
      suggestions,
      details
    };
  }
  // ── 维度 5：情节连贯性 ───────────────────────────────────
  /**
   * 情节连贯性维度：前后逻辑一致、因果链完整、时间线正确
   * 复用 analyzeCoherence（冗余/重复检测）+ 因果链检测
   */
  evaluateCoherence(text, context) {
    const basis = [
      "\u91CD\u590D\u53E5\u5B50\u68C0\u6D4B\uFF08\u524D\u540E\u6587\u5197\u4F59\uFF09",
      "\u9AD8\u9891\u91CD\u590D\u77ED\u8BED\u68C0\u6D4B",
      "\u8FC7\u5EA6\u7528\u8BCD\u68C0\u6D4B",
      "\u56E0\u679C\u94FE\u5B8C\u6574\u5EA6\uFF08\u56E0\u679C\u5173\u8054\u8BCD\u5BC6\u5EA6\uFF09"
    ];
    const issues = [];
    const suggestions = [];
    const details = {};
    const report = analyzeCoherence(text);
    details.sentenceCount = report.sentenceCount;
    details.coherenceIssues = report.issues.length;
    const causalityPatterns = [
      /因为|所以|因此|于是|结果|导致|造成/g,
      /虽然|但是|然而|可是|却/g,
      /如果|那么|就|只要|就/g
    ];
    let causalityCount = 0;
    for (const pattern of causalityPatterns) {
      causalityCount += (text.match(pattern) || []).length;
    }
    details.causalityIndicators = causalityCount;
    const timelinePatterns = [
      /先|然后|接着|随后|之后|最后|最终/g,
      /此时|此刻|这时|那时|同时|与此同时/g,
      /第[一二三四五六七八九十]天|次日|几天后|不久|片刻后/g
    ];
    let timelineCount = 0;
    for (const pattern of timelinePatterns) {
      timelineCount += (text.match(pattern) || []).length;
    }
    details.timelineIndicators = timelineCount;
    const issuePenalty = report.issues.reduce((sum, issue) => {
      const base = issue.type === "duplicate_sentence" ? 15 : issue.type === "repeated_phrase" ? 10 : 5;
      return sum + base * Math.min(issue.count, 5);
    }, 0);
    const causalityScore = Math.min(100, 50 + causalityCount * 8);
    const timelineScore = Math.min(100, 50 + timelineCount * 10);
    const coherenceScore = Math.max(0, 100 - issuePenalty);
    const score = Math.round(
      coherenceScore * 0.5 + causalityScore * 0.3 + timelineScore * 0.2
    );
    for (const issue of report.issues) {
      const idx = issue.sample ? text.indexOf(issue.sample) : -1;
      issues.push({
        id: `coherence_${issue.type}_${issues.length}`,
        dimension: "coherence",
        description: issue.message,
        severity: issue.type === "duplicate_sentence" ? "high" : "medium",
        location: idx >= 0 ? { charOffset: idx, length: issue.sample.length } : void 0
      });
    }
    if (report.issues.length > 0) {
      suggestions.push({
        id: "coherence_fix_repetition",
        dimension: "coherence",
        content: "\u5B58\u5728\u91CD\u590D/\u5197\u4F59\u5185\u5BB9\uFF0C\u5EFA\u8BAE\u7CBE\u7B80\u6216\u6539\u5199\u91CD\u590D\u90E8\u5206",
        priority: report.issues.some((i) => i.type === "duplicate_sentence") ? "high" : "medium",
        estimatedEffort: "\u5C0F"
      });
    }
    if (causalityCount < 3 && text.length > 1e3) {
      issues.push({
        id: "coherence_low_causality",
        dimension: "coherence",
        description: "\u56E0\u679C\u5173\u8054\u8BCD\u504F\u5C11\uFF0C\u903B\u8F91\u94FE\u4E0D\u591F\u6E05\u6670",
        severity: "low"
      });
      suggestions.push({
        id: "coherence_add_causality",
        dimension: "coherence",
        content: "\u56E0\u679C\u5173\u7CFB\u4E0D\u591F\u6E05\u6670\uFF0C\u5EFA\u8BAE\u5F3A\u5316\u4E8B\u4EF6\u4E4B\u95F4\u7684\u903B\u8F91\u5173\u8054",
        priority: "medium",
        estimatedEffort: "\u4E2D\u7B49"
      });
    }
    return {
      dimension: "coherence",
      score: Math.min(100, Math.max(0, score)),
      basis,
      issues,
      suggestions,
      details
    };
  }
  // ── 维度 6：语言质感 ─────────────────────────────────────
  /**
   * 语言质感维度：用词精准度、修辞丰富度、风格统一性
   * 新实现（结合风格指纹）
   */
  evaluateLanguageTexture(text, context) {
    const basis = [
      "\u4FEE\u8F9E\u624B\u6CD5\u4E30\u5BCC\u5EA6\uFF08\u6BD4\u55BB/\u6392\u6BD4/\u5938\u5F20/\u53CD\u95EE\u7B49\uFF09",
      "\u7528\u8BCD\u7CBE\u51C6\u5EA6\uFF08\u5B9E\u8BCD\u4E0E\u865A\u8BCD\u6BD4\u4F8B\uFF09",
      "\u98CE\u683C\u7EDF\u4E00\u6027\uFF08\u4E0E\u98CE\u683C\u6307\u7EB9\u7684\u5339\u914D\u5EA6\uFF09",
      "\u8BED\u8A00\u72EC\u7279\u6027\uFF08\u4E2A\u6027\u5316\u8868\u8FBE\uFF09"
    ];
    const issues = [];
    const suggestions = [];
    const details = {};
    const RHETORIC_PATTERNS = [
      { pattern: /像|如|似|仿佛|犹如|宛如|如同|好似|宛若|恰似/g, label: "\u6BD4\u55BB" },
      { pattern: /是…也是…|不仅…而且…|虽然…但是…|因为…所以…/g, label: "\u590D\u53E5" },
      { pattern: /难道|怎么会|怎能|岂会/g, label: "\u53CD\u95EE" },
      { pattern: /有的…有的…还有的…|一边…一边…|既…又…|不但…而且…/g, label: "\u6392\u6BD4" },
      { pattern: /简直|要命|要死|不得了|够呛/g, label: "\u5938\u5F20" }
    ];
    let rhetoricCount = 0;
    const rhetoricTypes = [];
    for (const { pattern, label } of RHETORIC_PATTERNS) {
      const count = (text.match(pattern) || []).length;
      if (count > 0) {
        rhetoricCount += count;
        rhetoricTypes.push(label);
      }
    }
    details.rhetoricCount = rhetoricCount;
    details.rhetoricTypes = rhetoricTypes.length > 0 ? rhetoricTypes.join("\u3001") : "\u65E0";
    const rhetoricScore = Math.min(100, rhetoricCount * 8);
    const meaningfulChars = text.replace(
      /[的地得了着过吗呢吧啊，。！？、；：""''（）【】《》…—\s\n]/g,
      ""
    );
    const precisionRatio = text.length > 0 ? meaningfulChars.length / text.length : 0;
    details.precisionRatio = Math.round(precisionRatio * 1e3) / 10 + "%";
    const precisionScore = this.scoreInRange(precisionRatio, 0.6, 0.75, 0.3, 0.9);
    let styleScore = 70;
    if (context.styleFingerprint && Object.keys(context.styleFingerprint).length > 0) {
      const currentFingerprint = this.extractStyleFeatures(text);
      details.currentStyle = JSON.stringify(currentFingerprint).slice(0, 80);
      let matchCount = 0;
      let totalCount = 0;
      for (const [key, target] of Object.entries(context.styleFingerprint)) {
        const current = currentFingerprint[key] || 0;
        const diff = Math.abs(current - target);
        if (diff < 0.2)
          matchCount++;
        totalCount++;
      }
      styleScore = totalCount > 0 ? Math.round(matchCount / totalCount * 100) : 70;
      details.styleMatch = styleScore + "%";
    }
    const commonChars = new Set("\u7684\u4E00\u662F\u4E0D\u4E86\u5728\u548C\u6709\u6211\u5C31\u4ED6\u90FD\u8FD9\u4E2A\u4EBA\u4E0A\u6765\u5230\u8FC7\u65F6\u8981\u4E3A\u4ED6\u5979\u8BF4\u4E5F");
    const allChars = text.replace(/[\s\n，。！？、；：""''（）【】《》…—]/g, "").split("");
    const rareChars = allChars.filter((c) => !commonChars.has(c) && /[\u4e00-\u9fa5]/.test(c));
    const rareRatio = allChars.length > 0 ? rareChars.length / allChars.length : 0;
    details.rareCharRatio = Math.round(rareRatio * 1e3) / 10 + "%";
    const uniquenessScore = Math.min(100, rareRatio * 300);
    const score = Math.round(
      rhetoricScore * 0.3 + precisionScore * 0.25 + styleScore * 0.25 + uniquenessScore * 0.2
    );
    if (rhetoricCount < 3 && text.length > 1e3) {
      issues.push({
        id: "texture_low_rhetoric",
        dimension: "languageTexture",
        description: "\u4FEE\u8F9E\u624B\u6CD5\u8FD0\u7528\u8F83\u5C11",
        severity: "low"
      });
      suggestions.push({
        id: "texture_rhetoric",
        dimension: "languageTexture",
        content: "\u4FEE\u8F9E\u624B\u6CD5\u8FD0\u7528\u8F83\u5C11\uFF0C\u5EFA\u8BAE\u9002\u5F53\u4F7F\u7528\u6BD4\u55BB\u3001\u62DF\u4EBA\u3001\u6392\u6BD4\u7B49\u4FEE\u8F9E\u589E\u5F3A\u6587\u91C7",
        priority: "low",
        estimatedEffort: "\u4E2D\u7B49"
      });
    }
    if (precisionRatio < 0.5) {
      issues.push({
        id: "texture_low_precision",
        dimension: "languageTexture",
        description: "\u865A\u8BCD\u6BD4\u4F8B\u504F\u9AD8\uFF0C\u7528\u8BCD\u4E0D\u591F\u7CBE\u51C6",
        severity: "medium"
      });
      suggestions.push({
        id: "texture_precision",
        dimension: "languageTexture",
        content: "\u7528\u8BCD\u4E0D\u591F\u7CBE\u51C6\uFF0C\u5EFA\u8BAE\u51CF\u5C11\u865A\u8BCD\u4F7F\u7528\uFF0C\u589E\u52A0\u5B9E\u8BCD\u5BC6\u5EA6",
        priority: "medium",
        estimatedEffort: "\u4E2D\u7B49"
      });
    }
    if (context.styleFingerprint && styleScore < 60) {
      issues.push({
        id: "texture_style_mismatch",
        dimension: "languageTexture",
        description: "\u5F53\u524D\u98CE\u683C\u4E0E\u76EE\u6807\u98CE\u683C\u6307\u7EB9\u5339\u914D\u5EA6\u8F83\u4F4E",
        severity: "medium"
      });
      suggestions.push({
        id: "texture_style",
        dimension: "languageTexture",
        content: "\u98CE\u683C\u7EDF\u4E00\u6027\u4E0D\u8DB3\uFF0C\u5EFA\u8BAE\u5BF9\u7167\u98CE\u683C\u6307\u7EB9\u8C03\u6574\u7528\u8BCD\u548C\u53E5\u5F0F",
        priority: "medium",
        estimatedEffort: "\u5927"
      });
    }
    return {
      dimension: "languageTexture",
      score: Math.min(100, Math.max(0, score)),
      basis,
      issues,
      suggestions,
      details
    };
  }
  // ── 工具方法 ─────────────────────────────────────────────
  /** 清理 frontmatter */
  cleanText(text) {
    return text.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
  }
  /** 计算文本哈希（简单 djb2） */
  hashText(text) {
    let hash = 5381;
    for (let i = 0; i < text.length; i++) {
      hash = (hash << 5) + hash + text.charCodeAt(i) & 2147483647;
    }
    return hash.toString(36);
  }
  splitSentences(text) {
    return text.split(/[。！？!?]+/).filter((s) => s.trim().length > 0);
  }
  splitParagraphs(text) {
    return text.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p.length > 0);
  }
  escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  /**
   * 在理想区间内得分 100，偏离递减
   * @param value 当前值
   * @param idealMin 理想最小值
   * @param idealMax 理想最大值
   * @param hardMin 硬性最小值（低于此为 0 分）
   * @param hardMax 硬性最大值（高于此为 0 分）
   */
  scoreInRange(value, idealMin, idealMax, hardMin, hardMax) {
    if (value >= idealMin && value <= idealMax)
      return 100;
    if (value < hardMin || value > hardMax)
      return 0;
    if (value < idealMin) {
      return Math.round((value - hardMin) / (idealMin - hardMin) * 100);
    }
    return Math.round((hardMax - value) / (hardMax - idealMax) * 100);
  }
  /** 计算分布多样性（基于熵） */
  calculateDiversity(counts) {
    const total = counts.reduce((a, b) => a + b, 0);
    if (total === 0)
      return 0;
    let entropy = 0;
    for (const c of counts) {
      if (c > 0) {
        const p = c / total;
        entropy -= p * Math.log2(p);
      }
    }
    const maxEntropy = Math.log2(counts.length);
    return maxEntropy > 0 ? entropy / maxEntropy * 100 : 0;
  }
  /** 计算平衡度评分 */
  calculateBalanceScore(actionRatio, dialogueRatio, descRatio) {
    const idealAction = 2.5;
    const idealDialogue = 2.5;
    const idealDesc = 12;
    const actionDeviation = Math.abs(actionRatio - idealAction) / idealAction;
    const dialogueDeviation = Math.abs(dialogueRatio - idealDialogue) / idealDialogue;
    const descDeviation = Math.abs(descRatio - idealDesc) / idealDesc;
    const totalDeviation = (actionDeviation + dialogueDeviation + descDeviation) / 3;
    return Math.max(0, Math.min(100, 100 - totalDeviation * 80));
  }
  /** 提取风格特征 */
  extractStyleFeatures(text) {
    const features = {};
    const sentences = this.splitSentences(text);
    const avgLen = sentences.length > 0 ? sentences.reduce((a, s) => a + s.length, 0) / sentences.length : 0;
    features.avgSentenceLen = avgLen;
    const dialogueCount = (text.match(/["「『]/g) || []).length;
    features.dialogueRatio = text.length > 0 ? dialogueCount / text.length : 0;
    const descWords = (text.match(/的|了|着/g) || []).length;
    features.descWordRatio = text.length > 0 ? descWords / text.length : 0;
    return features;
  }
  /** 判断维度是否可跳过（增量评估） */
  canSkipDimension(dimension, text, context) {
    if (!context.changedRange)
      return false;
    if (dimension === "characterConsistency") {
      const names = context.characterNames || (context.characterInfos || []).map((c) => c.name);
      if (names.length === 0)
        return true;
      const changedText = text.slice(context.changedRange.start, context.changedRange.end);
      return !names.some((n) => n && n.length >= 2 && changedText.includes(n));
    }
    return false;
  }
  /** 计算综合评分 */
  calculateOverallScore(dimensions) {
    let total = 0;
    for (const dim of QUALITY_DIMENSIONS) {
      total += dimensions[dim].score * DIMENSION_WEIGHTS[dim];
    }
    return Math.min(100, Math.max(0, Math.round(total)));
  }
  /** 收集所有问题 */
  collectIssues(dimensions) {
    const all = [];
    for (const dim of QUALITY_DIMENSIONS) {
      all.push(...dimensions[dim].issues);
    }
    const order = { high: 0, medium: 1, low: 2 };
    return all.sort((a, b) => order[a.severity] - order[b.severity]);
  }
  /** 收集所有建议（按优先级排序） */
  collectSuggestions(dimensions) {
    const all = [];
    for (const dim of QUALITY_DIMENSIONS) {
      all.push(...dimensions[dim].suggestions);
    }
    const order = { high: 0, medium: 1, low: 2 };
    return all.sort((a, b) => order[a.priority] - order[b.priority]).slice(0, 10);
  }
  /** 计算趋势 */
  calculateTrend(currentScore) {
    if (this.history.length < 3)
      return "stable";
    const recent = this.history.slice(-5);
    const midPoint = Math.floor(recent.length / 2);
    const firstHalf = recent.slice(0, midPoint);
    const secondHalf = recent.slice(midPoint);
    const firstAvg = firstHalf.length > 0 ? firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length : 0;
    const secondAvg = secondHalf.length > 0 ? secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length : 0;
    const diff = secondAvg - firstAvg;
    if (diff > 5)
      return "rising";
    if (diff < -5)
      return "falling";
    return "stable";
  }
  /** 记录历史 */
  recordHistory(score) {
    this.history.push(score);
    if (this.history.length > this.historySize) {
      this.history = this.history.slice(-this.historySize);
    }
  }
  /** 检查取消信号 */
  throwIfAborted(signal) {
    if (signal?.aborted) {
      throw new DOMException("\u8BC4\u4F30\u5DF2\u53D6\u6D88", "AbortError");
    }
  }
  /** 空维度结果 */
  getEmptyDimension(dimension) {
    return {
      dimension,
      score: 0,
      basis: [],
      issues: [],
      suggestions: [],
      details: { note: "\u5185\u5BB9\u4E0D\u8DB3\uFF0C\u65E0\u6CD5\u8BC4\u4F30" }
    };
  }
  /** 空评分结果 */
  getEmptyScore(wordCount, startTime) {
    const dimensions = {};
    for (const dim of QUALITY_DIMENSIONS) {
      dimensions[dim] = this.getEmptyDimension(dim);
    }
    return {
      overallScore: 0,
      dimensions,
      issues: [],
      suggestions: [
        {
          id: "empty_continue",
          dimension: "readability",
          content: "\u7EE7\u7EED\u5199\u4F5C\uFF0C\u7CFB\u7EDF\u5C06\u81EA\u52A8\u8BC4\u4F30\u5199\u4F5C\u8D28\u91CF",
          priority: "low"
        }
      ],
      evaluatedAt: Date.now(),
      wordCount,
      evalTimeMs: Date.now() - startTime,
      trend: "stable",
      fromCache: false
    };
  }
};

// engine/quality/deviation-detector.ts
var DEVIATION_TYPES = [
  "mainline",
  "characterOOC",
  "contradiction",
  "foreshadowForgot",
  "rhythm",
  "emotionBreak"
];
var SEVERITY_ORDER = {
  info: 0,
  warning: 1,
  critical: 2
};
var DEFAULT_SEVERITY_THRESHOLDS = {
  critical: 60,
  warning: 30,
  info: 0
};
var DeviationDetector = class {
  constructor(options = {}) {
    this.plotDivergenceEngine = options.plotDivergenceEngine;
    this.characterChecker = options.characterChecker;
    this.rhythmAnalyzer = options.rhythmAnalyzer;
    this.severityThresholds = {
      ...DEFAULT_SEVERITY_THRESHOLDS,
      ...options.severityThresholds
    };
    this.foreshadowRecoverChapters = options.foreshadowRecoverChapters ?? 10;
    const cacheSize = options.cacheSize ?? 50;
    const cacheTtlMs = options.cacheTtlMs ?? 6e4;
    this.typeCache = new LruCache({
      maxSize: cacheSize * 5,
      ttlMs: cacheTtlMs
    });
    this.fullCache = new LruCache({
      maxSize: cacheSize,
      ttlMs: cacheTtlMs
    });
  }
  // ── 公开 API ──────────────────────────────────────────────
  /**
   * 检测全部 5 类偏离
   * @param text 正文文本
   * @param context 检测上下文
   * @param signal 取消信号
   */
  async detect(text, context = {}, signal) {
    const startTime = Date.now();
    const cleanText = this.cleanText(text);
    const wordCount = cleanText.length;
    const textHash = this.hashText(cleanText);
    if (!context.changedRange) {
      const cached = this.fullCache.get(textHash);
      if (cached) {
        return { ...cached, fromCache: true, evalTimeMs: Date.now() - startTime };
      }
    }
    if (wordCount < 100) {
      const empty = this.getEmptyReport(wordCount, startTime);
      this.fullCache.set(textHash, empty);
      return empty;
    }
    this.throwIfAborted(signal);
    const typeScores = {};
    const allIssues = [];
    for (const type of DEVIATION_TYPES) {
      this.throwIfAborted(signal);
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
    const report = {
      overallScore,
      overallSeverity,
      typeScores,
      issues: sortedIssues,
      suggestions,
      evaluatedAt: Date.now(),
      wordCount,
      evalTimeMs: Date.now() - startTime,
      fromCache: false,
      incremental: !!context.changedRange
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
  async detectByType(text, type, context = {}, signal) {
    const cleanText = this.cleanText(text);
    return this.detectByTypeInternal(cleanText, type, context, signal);
  }
  /** 清空所有缓存 */
  clearCache() {
    this.typeCache.clear();
    this.fullCache.clear();
  }
  /** 按文本失效缓存 */
  invalidateCache(text) {
    if (text === void 0) {
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
  getSeverityThresholds() {
    return { ...this.severityThresholds };
  }
  /** 获取伏笔回收阈值章节数 */
  getForeshadowRecoverChapters() {
    return this.foreshadowRecoverChapters;
  }
  // ── 各类型检测实现 ──────────────────────────────────────
  async detectByTypeInternal(text, type, context, signal) {
    const textHash = this.hashText(text);
    const cacheKey = `${type}:${textHash}`;
    if (!context.changedRange) {
      const cached = this.typeCache.get(cacheKey);
      if (cached) {
        return cached;
      }
    }
    this.throwIfAborted(signal);
    let issues;
    switch (type) {
      case "mainline":
        issues = this.detectMainline(text, context);
        break;
      case "characterOOC":
        issues = await this.detectCharacterOOC(text, context, signal);
        break;
      case "contradiction":
        issues = this.detectContradiction(text, context);
        break;
      case "foreshadowForgot":
        issues = this.detectForeshadowForgot(text, context);
        break;
      case "rhythm":
        issues = await this.detectRhythm(text, context, signal);
        break;
      case "emotionBreak":
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
  detectMainline(text, context) {
    const issues = [];
    if (this.plotDivergenceEngine) {
      this.plotDivergenceEngine.updateOptions({
        chapterOutline: context.chapterOutline,
        mainlineKeywords: context.mainlineKeywords
      });
      const result = this.plotDivergenceEngine.evaluate(text);
      const mainline = result.mainlineDivergence;
      if (mainline.score > 0) {
        for (let i = 0; i < mainline.issues.length; i++) {
          issues.push({
            id: `mainline_v1_${i}`,
            type: "mainline",
            severity: this.severityFromDegree(mainline.score),
            degree: mainline.score,
            description: mainline.issues[i],
            suggestion: mainline.suggestions[i] || mainline.suggestions[0],
            confidence: 0.7
          });
        }
        if (issues.length === 0 && mainline.score >= this.severityThresholds.warning) {
          issues.push({
            id: "mainline_v1_summary",
            type: "mainline",
            severity: this.severityFromDegree(mainline.score),
            degree: mainline.score,
            description: `\u5267\u60C5\u504F\u79BB\u4E3B\u7EBF\uFF08V1 \u5F15\u64CE\u6D4B\u5F97\u504F\u79BB\u5EA6 ${mainline.score}%\uFF09`,
            suggestion: mainline.suggestions[0],
            confidence: 0.7
          });
        }
      }
      return issues;
    }
    return this.detectMainlineFallback(text, context);
  }
  detectMainlineFallback(text, context) {
    const issues = [];
    let outlineMatchRate = 50;
    let keywordCoverage = 50;
    if (context.chapterOutline) {
      const outlineKeywords = this.extractKeywords(context.chapterOutline);
      const unmatched = [];
      for (const kw of outlineKeywords) {
        if (kw.length >= 2 && !text.includes(kw)) {
          unmatched.push(kw);
        }
      }
      const matched = outlineKeywords.length - unmatched.length;
      outlineMatchRate = outlineKeywords.length > 0 ? Math.round(matched / outlineKeywords.length * 100) : 50;
      if (unmatched.length > 0 && outlineMatchRate < 60) {
        issues.push({
          id: "mainline_outline_unmatched",
          type: "mainline",
          severity: this.severityFromDegree(100 - outlineMatchRate),
          degree: 100 - outlineMatchRate,
          description: `\u5927\u7EB2\u5173\u952E\u8BCD\u672A\u8986\u76D6\uFF1A${unmatched.slice(0, 5).join("\u3001")}${unmatched.length > 5 ? "..." : ""}`,
          suggestion: "\u5EFA\u8BAE\u56DE\u987E\u672C\u7AE0\u5927\u7EB2\uFF0C\u786E\u4FDD\u6838\u5FC3\u60C5\u8282\u6309\u8BA1\u5212\u63A8\u8FDB",
          confidence: 0.7,
          evidence: unmatched.slice(0, 3)
        });
      }
    }
    if (context.mainlineKeywords && context.mainlineKeywords.length > 0) {
      const matched = context.mainlineKeywords.filter(
        (kw) => kw.length >= 2 && text.includes(kw)
      );
      keywordCoverage = Math.round(
        matched.length / context.mainlineKeywords.length * 100
      );
      if (keywordCoverage < 30) {
        issues.push({
          id: "mainline_keyword_low",
          type: "mainline",
          severity: "critical",
          degree: 100 - keywordCoverage,
          description: `\u4E3B\u7EBF\u5143\u7D20\u8986\u76D6\u7387\u4EC5 ${keywordCoverage}%\uFF0C\u5267\u60C5\u53EF\u80FD\u504F\u79BB\u4E3B\u7EBF`,
          suggestion: "\u53EF\u9002\u5F53\u7A7F\u63D2\u4E3B\u7EBF\u5143\u7D20\uFF0C\u5F3A\u5316\u4E3B\u7EBF\u5173\u8054",
          confidence: 0.75,
          evidence: context.mainlineKeywords.filter((kw) => !text.includes(kw)).slice(0, 3)
        });
      } else if (keywordCoverage < 60) {
        issues.push({
          id: "mainline_keyword_medium",
          type: "mainline",
          severity: "warning",
          degree: 100 - keywordCoverage,
          description: `\u4E3B\u7EBF\u5143\u7D20\u8986\u76D6\u7387 ${keywordCoverage}%\uFF0C\u90E8\u5206\u4E3B\u7EBF\u8981\u70B9\u672A\u8986\u76D6`,
          suggestion: "\u6CE8\u610F\u5728\u540E\u7EED\u6BB5\u843D\u4E2D\u8865\u5145\u4E3B\u7EBF\u8981\u70B9",
          confidence: 0.6
        });
      }
    }
    const conflictPatterns = [
      /但是|然而|可是|却|不料|没想到/g,
      /突然|忽然|就在这时|就在此刻/g,
      /危机|危险|紧急|迫在眉睫|千钧一发/g,
      /对峙|对抗|较量|决斗|战斗|厮杀/g
    ];
    let conflictCount = 0;
    for (const pattern of conflictPatterns) {
      conflictCount += (text.match(pattern) || []).length;
    }
    if (context.chapterOutline && /冲突|对抗|战斗|危机|危险|挑战/.test(context.chapterOutline) && conflictCount === 0) {
      issues.push({
        id: "mainline_no_conflict",
        type: "mainline",
        severity: "warning",
        degree: 40,
        description: "\u5927\u7EB2\u9884\u671F\u6709\u51B2\u7A81\uFF0C\u4F46\u672C\u7AE0\u672A\u68C0\u6D4B\u5230\u51B2\u7A81\u5143\u7D20",
        suggestion: "\u5EFA\u8BAE\u589E\u52A0\u51B2\u7A81\u6216\u5BF9\u6297\u573A\u666F\u4EE5\u7B26\u5408\u5927\u7EB2\u9884\u671F",
        confidence: 0.6
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
  async detectCharacterOOC(text, context, signal) {
    const issues = [];
    const characterInfos = context.characterInfos || [];
    if (characterInfos.length === 0) {
      return issues;
    }
    if (this.characterChecker) {
      const historyTexts = (context.previousChapters || []).filter((c) => c.text && c.text.length > 0).map((c) => c.text);
      const result = await this.characterChecker.check(
        text,
        characterInfos,
        historyTexts.length > 0 ? historyTexts : void 0
      );
      this.throwIfAborted(signal);
      for (const [name, charResult] of Object.entries(result.characterResults)) {
        const deviationDegree = 100 - charResult.score;
        for (let i = 0; i < charResult.inconsistencies.length; i++) {
          const inc = charResult.inconsistencies[i];
          issues.push({
            id: `charOOC_v1_${name}_${i}`,
            type: "characterOOC",
            severity: this.mapV1Severity(inc.severity, deviationDegree),
            degree: deviationDegree,
            description: `[${name}] ${inc.description}`,
            location: inc.location ? { character: name } : { character: name },
            suggestion: inc.suggestion,
            confidence: inc.confidence
          });
        }
        if (charResult.inconsistencies.length === 0 && deviationDegree >= this.severityThresholds.warning) {
          issues.push({
            id: `charOOC_v1_summary_${name}`,
            type: "characterOOC",
            severity: this.severityFromDegree(deviationDegree),
            degree: deviationDegree,
            description: `[${name}] \u4EBA\u7269\u884C\u4E3A\u504F\u79BB\u8BBE\u5B9A\uFF08\u4E00\u81F4\u6027\u5F97\u5206 ${charResult.score}\uFF09`,
            suggestion: "\u5EFA\u8BAE\u68C0\u67E5\u89D2\u8272\u884C\u4E3A\u662F\u5426\u7B26\u5408\u4EBA\u8BBE",
            confidence: 0.7
          });
        }
      }
      return issues;
    }
    return this.detectCharacterOOCFallback(text, characterInfos);
  }
  detectCharacterOOCFallback(text, characterInfos) {
    const issues = [];
    const BEHAVIOR_CONFLICTS = {
      \u51B7\u9759: ["\u6FC0\u52A8\u5730\u8BF4", "\u70ED\u60C5\u5730", "\u5174\u594B\u5730", "\u6CEA\u6D41\u6EE1\u9762", "\u52C3\u7136\u5927\u6012", "\u66B4\u8DF3\u5982\u96F7"],
      \u6C89\u7A33: ["\u614C\u4E86\u795E", "\u60CA\u614C\u5931\u63AA", "\u624B\u5FD9\u811A\u4E71", "\u5927\u60CA\u5931\u8272"],
      \u6E29\u67D4: ["\u6012\u543C\u9053", "\u5389\u58F0\u559D\u9053", "\u6454\u95E8\u800C\u53BB"],
      \u8001\u5B9E: ["\u72E1\u9EE0\u5730\u7B11", "\u773C\u73E0\u4E00\u8F6C", "\u6697\u4E2D\u76D8\u7B97", "\u6492\u8C0E"],
      \u6B63\u76F4: ["\u9634\u9669\u5730", "\u6697\u7B97", "\u5077\u88AD", "\u4E0D\u62E9\u624B\u6BB5"],
      \u52C7\u6562: ["\u5413\u5F97\u53D1\u6296", "\u7F29\u6210\u4E00\u56E2", "\u843D\u8352\u800C\u9003", "\u80C6\u6218\u5FC3\u60CA"]
    };
    for (const char of characterInfos) {
      if (!char.name || char.name.length < 2)
        continue;
      if (!char.personality)
        continue;
      const charParagraphs = this.extractCharacterParagraphs(text, char.name);
      if (charParagraphs.length === 0)
        continue;
      const detectedTraits = Object.keys(BEHAVIOR_CONFLICTS).filter(
        (trait) => char.personality.includes(trait)
      );
      if (detectedTraits.length === 0)
        continue;
      let conflictCount = 0;
      const evidences = [];
      for (const trait of detectedTraits) {
        const incompatibleActions = BEHAVIOR_CONFLICTS[trait];
        for (const action of incompatibleActions) {
          for (const para of charParagraphs) {
            if (para.includes(action)) {
              conflictCount++;
              const sentence = this.extractSentence(para, action);
              if (sentence)
                evidences.push(sentence);
            }
          }
        }
      }
      if (conflictCount > 0) {
        const degree = Math.min(100, 30 + conflictCount * 20);
        issues.push({
          id: `charOOC_${char.name}_behavior`,
          type: "characterOOC",
          severity: this.severityFromDegree(degree),
          degree,
          description: `[${char.name}] \u884C\u4E3A\u4E0E\u300C${detectedTraits.join("\u3001")}\u300D\u4EBA\u8BBE\u4E0D\u7B26`,
          location: { character: char.name },
          suggestion: `\u8BF7\u786E\u8BA4\u8BE5\u884C\u4E3A\u662F\u5426\u7B26\u5408\u4EBA\u7269\u8BBE\u5B9A\uFF08\u6027\u683C\uFF1A${char.personality}\uFF09`,
          confidence: 0.65,
          evidence: evidences.slice(0, 3)
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
  detectContradiction(text, context) {
    const issues = [];
    const report = analyzeCoherence(text);
    for (let i = 0; i < report.issues.length; i++) {
      const issue = report.issues[i];
      const degree = issue.type === "duplicate_sentence" ? 70 : issue.type === "repeated_phrase" ? 50 : 30;
      issues.push({
        id: `contradiction_internal_${i}`,
        type: "contradiction",
        severity: this.severityFromDegree(degree),
        degree,
        description: issue.message,
        suggestion: "\u5EFA\u8BAE\u7CBE\u7B80\u6216\u6539\u5199\u91CD\u590D\u90E8\u5206",
        confidence: 0.7,
        evidence: issue.sample ? [issue.sample] : void 0
      });
    }
    const prevChapters = context.previousChapters || [];
    if (prevChapters.length > 0) {
      const timelineIssues = this.detectTimelineContradictions(text, prevChapters);
      issues.push(...timelineIssues);
    }
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
  detectTimelineContradictions(text, prevChapters) {
    const issues = [];
    const TIME_PATTERN = /第([一二三四五六七八九十百千零〇\d]+)(天|日|年|月|周|个星期)|次日|几日后|几年后|不久|片刻后|与此同时/g;
    const currentTimeMarks = this.extractTimeMarks(text, TIME_PATTERN);
    if (currentTimeMarks.length === 0)
      return issues;
    for (const prev of prevChapters) {
      const prevTimeMarks = this.extractTimeMarks(prev.text, TIME_PATTERN);
      for (const curr of currentTimeMarks) {
        for (const prevMark of prevTimeMarks) {
          if (curr.normalized === prevMark.normalized && curr.text !== prevMark.text) {
            issues.push({
              id: `contradiction_timeline_${prev.chapterId}`,
              type: "contradiction",
              severity: "warning",
              degree: 45,
              description: `\u65F6\u95F4\u6807\u8BB0\u300C${curr.text}\u300D\u4E0E\u7AE0\u8282 ${prev.chapterId} \u91CD\u590D\uFF0C\u53EF\u80FD\u5B58\u5728\u65F6\u95F4\u7EBF\u77DB\u76FE`,
              location: { chapterRef: prev.chapterId },
              suggestion: "\u8BF7\u68C0\u67E5\u65F6\u95F4\u7EBF\u987A\u5E8F\u662F\u5426\u4E00\u81F4",
              confidence: 0.5,
              evidence: [prevMark.text, curr.text]
            });
            break;
          }
        }
      }
    }
    return issues;
  }
  extractTimeMarks(text, pattern) {
    const marks = [];
    let match;
    const globalPattern = new RegExp(pattern.source, "g");
    while ((match = globalPattern.exec(text)) !== null) {
      const matched = match[0];
      const normalized = matched.replace(/一二三四五六七八九十/g, (s) => "\u4E00\u4E8C\u4E09\u56DB\u4E94\u516D\u4E03\u516B\u4E5D\u5341".indexOf(s).toString()).replace(/百|千|零|〇/g, "");
      marks.push({ text: matched, normalized });
    }
    return marks;
  }
  detectSettingContradictions(text, characterInfos, prevChapters) {
    const issues = [];
    const APPEARANCE_CONTRADICTIONS2 = [
      { words: ["\u9ED1\u53D1", "\u4E4C\u9ED1", "\u58A8\u53D1"], opposite: ["\u91D1\u53D1", "\u767D\u53D1", "\u94F6\u53D1", "\u7EA2\u53D1"] },
      { words: ["\u91D1\u53D1"], opposite: ["\u9ED1\u53D1", "\u767D\u53D1", "\u94F6\u53D1", "\u7EA2\u53D1"] },
      { words: ["\u767D\u53D1", "\u94F6\u53D1"], opposite: ["\u9ED1\u53D1", "\u91D1\u53D1", "\u7EA2\u53D1"] },
      { words: ["\u9AD8\u5927", "\u9B41\u68A7"], opposite: ["\u7626\u5C0F", "\u77EE\u5C0F", "\u4F8F\u5112"] },
      { words: ["\u7626\u5C0F", "\u77EE\u5C0F"], opposite: ["\u9AD8\u5927", "\u9B41\u68A7", "\u58EE\u7855"] },
      { words: ["\u82F1\u4FCA", "\u5E05\u6C14"], opposite: ["\u4E11\u964B", "\u96BE\u770B"] },
      { words: ["\u7F8E\u4E3D", "\u6F02\u4EAE"], opposite: ["\u4E11\u964B", "\u96BE\u770B"] },
      { words: ["\u5E74\u8F7B", "\u5C11\u5E74"], opposite: ["\u5E74\u8001", "\u5E74\u8FC8", "\u767D\u53D1\u82CD\u82CD"] },
      { words: ["\u5E74\u8001", "\u5E74\u8FC8"], opposite: ["\u5E74\u8F7B", "\u5C11\u5E74", "\u9752\u5E74"] }
    ];
    for (const char of characterInfos) {
      if (!char.name || !char.appearance)
        continue;
      for (const contradiction of APPEARANCE_CONTRADICTIONS2) {
        const hasSetting = contradiction.words.some((w) => char.appearance.includes(w));
        if (!hasSetting)
          continue;
        for (const opp of contradiction.opposite) {
          if (text.includes(opp) && text.includes(char.name)) {
            const sentence = this.extractSentence(text, opp);
            issues.push({
              id: `contradiction_setting_${char.name}_${opp}`,
              type: "contradiction",
              severity: "critical",
              degree: 75,
              description: `[${char.name}] \u5916\u8C8C\u63CF\u8FF0\u77DB\u76FE\uFF1A\u8BBE\u5B9A\u4E3A\u300C${contradiction.words[0]}\u300D\uFF0C\u6587\u4E2D\u51FA\u73B0\u300C${opp}\u300D`,
              location: { character: char.name },
              suggestion: "\u8BF7\u4FEE\u6B63\u5916\u8C8C\u63CF\u8FF0\u4EE5\u4FDD\u6301\u4E00\u81F4",
              confidence: 0.85,
              evidence: sentence ? [sentence] : void 0
            });
          }
        }
        for (const prev of prevChapters) {
          for (const opp of contradiction.opposite) {
            if (prev.text.includes(opp) && prev.text.includes(char.name)) {
              issues.push({
                id: `contradiction_setting_${char.name}_${opp}_${prev.chapterId}`,
                type: "contradiction",
                severity: "critical",
                degree: 80,
                description: `[${char.name}] \u5916\u8C8C\u63CF\u8FF0\u4E0E\u7AE0\u8282 ${prev.chapterId} \u77DB\u76FE\uFF1A\u8BBE\u5B9A\u300C${contradiction.words[0]}\u300D\uFF0C\u524D\u6587\u51FA\u73B0\u300C${opp}\u300D`,
                location: { character: char.name, chapterRef: prev.chapterId },
                suggestion: "\u8BF7\u7EDF\u4E00\u4EBA\u7269\u5916\u8C8C\u63CF\u8FF0",
                confidence: 0.85
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
  detectForeshadowForgot(text, context) {
    const issues = [];
    let foreshadows = context.foreshadows;
    if (!foreshadows || foreshadows.length === 0) {
      foreshadows = this.parseForeshadowsFromFrontmatter(context.previousChapters || []);
    }
    if (foreshadows.length === 0)
      return issues;
    const currentChapterNum = context.chapterNum ?? 0;
    for (const fs of foreshadows) {
      if (fs.recovered)
        continue;
      const isRecoveredInCurrent = fs.keywords.some(
        (kw) => kw.length >= 2 && text.includes(kw)
      );
      if (isRecoveredInCurrent) {
        continue;
      }
      const plantedNum = fs.plantedChapterNum ?? 0;
      const distance = currentChapterNum - plantedNum;
      if (distance >= this.foreshadowRecoverChapters) {
        issues.push({
          id: `foreshadowForgot_${fs.id}`,
          type: "foreshadowForgot",
          severity: "critical",
          degree: Math.min(100, 60 + (distance - this.foreshadowRecoverChapters) * 5),
          description: `\u4F0F\u7B14\u300C${fs.description}\u300D\u5DF2\u57CB\u8BBE ${distance} \u7AE0\u672A\u56DE\u6536\uFF08\u9608\u503C ${this.foreshadowRecoverChapters} \u7AE0\uFF09`,
          suggestion: "\u5EFA\u8BAE\u5C3D\u5FEB\u5B89\u6392\u4F0F\u7B14\u56DE\u6536\uFF0C\u907F\u514D\u8BFB\u8005\u9057\u5FD8",
          confidence: 0.8,
          evidence: fs.keywords.slice(0, 3)
        });
      } else if (distance >= this.foreshadowRecoverChapters / 2) {
        issues.push({
          id: `foreshadowForgot_${fs.id}_approaching`,
          type: "foreshadowForgot",
          severity: "warning",
          degree: 35 + distance * 3,
          description: `\u4F0F\u7B14\u300C${fs.description}\u300D\u5DF2\u57CB\u8BBE ${distance} \u7AE0\uFF0C\u5EFA\u8BAE\u5C3D\u5FEB\u56DE\u6536`,
          suggestion: "\u53EF\u8003\u8651\u5728\u540E\u7EED\u7AE0\u8282\u4E2D\u5B89\u6392\u4F0F\u7B14\u56DE\u6536",
          confidence: 0.6,
          evidence: fs.keywords.slice(0, 3)
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
  parseForeshadowsFromFrontmatter(prevChapters) {
    const result = [];
    for (const prev of prevChapters) {
      if (!prev.frontmatter)
        continue;
      const fm = prev.frontmatter;
      const rawList = fm["foreshadows"] || fm["foreshadow"];
      if (!rawList)
        continue;
      if (Array.isArray(rawList)) {
        for (let i = 0; i < rawList.length; i++) {
          const item = rawList[i];
          if (typeof item === "string") {
            result.push({
              id: `${prev.chapterId}_fs_${i}`,
              description: item,
              keywords: this.extractKeywords(item).slice(0, 5),
              plantedChapterId: prev.chapterId,
              plantedChapterNum: prev.chapterNum,
              recovered: false,
              currentChapterNum: prev.chapterNum
            });
          } else if (item && typeof item === "object") {
            const desc = String(item["description"] || item["desc"] || "");
            const keywords = Array.isArray(item["keywords"]) ? item["keywords"].map(String) : this.extractKeywords(desc).slice(0, 5);
            result.push({
              id: String(item["id"] || `${prev.chapterId}_fs_${i}`),
              description: desc,
              keywords,
              plantedChapterId: prev.chapterId,
              plantedChapterNum: prev.chapterNum,
              recovered: Boolean(item["recovered"]),
              currentChapterNum: prev.chapterNum
            });
          }
        }
      } else if (typeof rawList === "string") {
        result.push({
          id: `${prev.chapterId}_fs_0`,
          description: rawList,
          keywords: this.extractKeywords(rawList).slice(0, 5),
          plantedChapterId: prev.chapterId,
          plantedChapterNum: prev.chapterNum,
          recovered: false,
          currentChapterNum: prev.chapterNum
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
  async detectRhythm(text, context, signal) {
    const issues = [];
    const expectedRhythm = context.expectedRhythm;
    if (!expectedRhythm) {
      return issues;
    }
    if (this.rhythmAnalyzer) {
      const analysis = await this.rhythmAnalyzer.analyze(text);
      this.throwIfAborted(signal);
      const segments = analysis.segments;
      const total = segments.length;
      if (total === 0)
        return issues;
      const paceCounts = { fast: 0, medium: 0, slow: 0 };
      for (const seg of segments)
        paceCounts[seg.pace]++;
      let actualPace;
      if (paceCounts.fast > total * 0.5)
        actualPace = "fast";
      else if (paceCounts.slow > total * 0.5)
        actualPace = "slow";
      else
        actualPace = "medium";
      if (actualPace !== expectedRhythm) {
        const degree = expectedRhythm === "fast" && actualPace === "slow" || expectedRhythm === "slow" && actualPace === "fast" ? 70 : 35;
        issues.push({
          id: "rhythm_pace_mismatch",
          type: "rhythm",
          severity: this.severityFromDegree(degree),
          degree,
          description: `\u8282\u594F\u504F\u5DEE\uFF1A\u9884\u671F${this.getPaceLabel(expectedRhythm)}\uFF0C\u5B9E\u9645${this.getPaceLabel(actualPace)}`,
          suggestion: this.getRhythmSuggestion(actualPace, expectedRhythm),
          confidence: 0.75
        });
      }
      const tensions = segments.map((s) => s.tensionLevel);
      const maxTension = tensions.length > 0 ? Math.max(...tensions) : 0;
      if (expectedRhythm === "fast" && maxTension < 50) {
        issues.push({
          id: "rhythm_low_tension",
          type: "rhythm",
          severity: "warning",
          degree: 40,
          description: `\u9884\u671F\u5FEB\u8282\u594F\u4F46\u7D27\u5F20\u5EA6\u5CF0\u503C\u4EC5 ${maxTension}\uFF0C\u8282\u594F\u504F\u5F31`,
          suggestion: "\u5EFA\u8BAE\u589E\u52A0\u51B2\u7A81\u6216\u52A8\u4F5C\u63CF\u5199\u4EE5\u63D0\u5347\u7D27\u5F20\u5EA6",
          confidence: 0.6
        });
      }
      for (const seg of analysis.suggestions.slice(0, 1)) {
        issues.push({
          id: "rhythm_analyzer_suggestion",
          type: "rhythm",
          severity: "info",
          degree: 20,
          description: seg,
          confidence: 0.5
        });
      }
      return issues;
    }
    return this.detectRhythmFallback(text, expectedRhythm);
  }
  detectRhythmFallback(text, expectedRhythm) {
    const issues = [];
    const sentences = this.splitSentences(text);
    if (sentences.length < 5)
      return issues;
    const avgSentenceLen = text.length / sentences.length;
    const RHYTHM_ACTION_WORDS2 = [
      "\u51B2",
      "\u6253",
      "\u780D",
      "\u523A",
      "\u6740",
      "\u51FB",
      "\u6251",
      "\u8DC3",
      "\u95EA",
      "\u8EB2",
      "\u8DD1",
      "\u8FFD",
      "\u9003",
      "\u8D76",
      "\u649E",
      "\u7838"
    ];
    const RHYTHM_DESC_WORDS = [
      "\u4EFF\u4F5B",
      "\u4F3C\u4E4E",
      "\u597D\u50CF",
      "\u72B9\u5982",
      "\u5B9B\u5982",
      "\u5982\u540C",
      "\u4E00\u822C",
      "\u4E00\u6837"
    ];
    let actionCount = 0;
    for (const w of RHYTHM_ACTION_WORDS2) {
      actionCount += (text.match(new RegExp(w, "g")) || []).length;
    }
    let descCount = 0;
    for (const w of RHYTHM_DESC_WORDS) {
      descCount += (text.match(new RegExp(w, "g")) || []).length;
    }
    const actionRatio = text.length > 0 ? actionCount / text.length * 100 : 0;
    const descRatio = text.length > 0 ? descCount / text.length * 100 : 0;
    let actualPace;
    if (avgSentenceLen < 20 && actionRatio > 3)
      actualPace = "fast";
    else if (avgSentenceLen > 40 && descRatio > 5)
      actualPace = "slow";
    else
      actualPace = "medium";
    if (actualPace !== expectedRhythm) {
      const degree = expectedRhythm === "fast" && actualPace === "slow" || expectedRhythm === "slow" && actualPace === "fast" ? 70 : 35;
      issues.push({
        id: "rhythm_fallback_mismatch",
        type: "rhythm",
        severity: this.severityFromDegree(degree),
        degree,
        description: `\u8282\u594F\u504F\u5DEE\uFF1A\u9884\u671F${this.getPaceLabel(expectedRhythm)}\uFF0C\u5B9E\u9645${this.getPaceLabel(actualPace)}\uFF08\u5E73\u5747\u53E5\u957F ${Math.round(avgSentenceLen)} \u5B57\uFF09`,
        suggestion: this.getRhythmSuggestion(actualPace, expectedRhythm),
        confidence: 0.65
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
  detectEmotionBreak(text, context) {
    const issues = [];
    const paragraphs = text.split(/\n\n+/).filter((p) => p.trim().length > 10);
    if (paragraphs.length < 3)
      return issues;
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
      /隐隐/
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
      /僵硬/
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
      /愧/
    ];
    const hasEmotionElement = (para) => {
      return psychPatterns.some((p) => p.test(para)) || bodyPatterns.some((p) => p.test(para)) || emotionPatterns.some((p) => p.test(para));
    };
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
      const sampleText = paragraphs[emptyStartIndex]?.slice(0, 50) || "";
      issues.push({
        id: "emotionBreak_empty_streak",
        type: "emotionBreak",
        severity: this.severityFromDegree(degree),
        degree,
        description: `\u60C5\u7EEA\u65AD\u5C42\uFF1A\u8FDE\u7EED ${maxConsecutiveEmpty} \u6BB5\u65E0\u5FC3\u7406\u6D3B\u52A8\u3001\u60C5\u7EEA\u8BCD\u6216\u8EAB\u4F53\u53CD\u5E94\uFF0C\u8BFB\u8005\u53EF\u80FD\u5931\u53BB\u5171\u60C5`,
        location: { line: emptyStartIndex + 1 },
        suggestion: "\u5EFA\u8BAE\u5728\u8FD9\u6BB5\u4E2D\u63D2\u5165\u89D2\u8272\u7684\u5FC3\u7406\u6D3B\u52A8\u3001\u8EAB\u4F53\u53CD\u5E94\u6216\u60C5\u7EEA\u63CF\u5199\uFF0C\u589E\u5F3A\u4EE3\u5165\u611F",
        confidence: 0.7,
        evidence: sampleText ? [sampleText + "..."] : void 0
      });
    } else if (maxConsecutiveEmpty >= 3) {
      issues.push({
        id: "emotionBreak_low_density",
        type: "emotionBreak",
        severity: "info",
        degree: 25,
        description: `\u60C5\u7EEA\u5BC6\u5EA6\u504F\u4F4E\uFF1A\u8FDE\u7EED ${maxConsecutiveEmpty} \u6BB5\u65E0\u60C5\u7EEA\u5143\u7D20`,
        suggestion: "\u53EF\u9002\u5F53\u589E\u52A0\u5FC3\u7406\u6D3B\u52A8\u6216\u8EAB\u4F53\u53CD\u5E94\u63CF\u5199",
        confidence: 0.55
      });
    }
    const emotionTypes = {
      \u559C\u60A6: "positive",
      \u5174\u594B: "positive",
      \u5E0C\u671B: "positive",
      \u60CA\u559C: "positive",
      \u7231: "positive",
      \u6124\u6012: "negative",
      \u6050\u60E7: "negative",
      \u5BB3\u6015: "negative",
      \u60B2\u4F24: "negative",
      \u7EDD\u671B: "negative",
      \u538C\u6076: "negative",
      \u4EC7\u6068: "negative",
      \u7D27\u5F20: "negative",
      \u62C5\u5FE7: "negative",
      \u7126\u8651: "negative"
    };
    for (let i = 0; i < paragraphs.length - 1; i++) {
      const currType = this.detectEmotionCategory(paragraphs[i], emotionTypes);
      const nextType = this.detectEmotionCategory(paragraphs[i + 1], emotionTypes);
      if (currType !== "neutral" && nextType !== "neutral" && currType !== nextType) {
        const degree = 55;
        issues.push({
          id: `emotionBreak_abrupt_${i}`,
          type: "emotionBreak",
          severity: "warning",
          degree,
          description: `\u60C5\u7EEA\u8F6C\u6362\u7A81\u5140\uFF1A\u4ECE\u300C${currType === "positive" ? "\u79EF\u6781" : "\u6D88\u6781"}\u300D\u7A81\u7136\u8F6C\u4E3A\u300C${nextType === "positive" ? "\u79EF\u6781" : "\u6D88\u6781"}\u300D\uFF0C\u7F3A\u5C11\u8FC7\u6E21`,
          location: { line: i + 2 },
          suggestion: "\u5EFA\u8BAE\u589E\u52A0\u8FC7\u6E21\u63CF\u5199\uFF0C\u8BA9\u60C5\u7EEA\u8F6C\u6362\u66F4\u81EA\u7136",
          confidence: 0.6,
          evidence: [paragraphs[i]?.slice(0, 30), paragraphs[i + 1]?.slice(0, 30)]
        });
      }
    }
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
      /终于/
    ];
    const hasHook = hookPatterns.some((p) => closingParagraphs.join("").match(p));
    if (!hasClosingEmotion && !hasHook) {
      issues.push({
        id: "emotionBreak_no_closing",
        type: "emotionBreak",
        severity: "warning",
        degree: 40,
        description: "\u7AE0\u8282\u7ED3\u5C3E\u7F3A\u5C11\u60C5\u7EEA\u6536\u675F\u6216\u60C5\u7EEA\u94A9\u5B50",
        suggestion: "\u5EFA\u8BAE\u5728\u7ED3\u5C3E\u589E\u52A0\u60C5\u7EEA\u63CF\u5199\u6216\u60AC\u5FF5\u5143\u7D20\uFF0C\u63D0\u5347\u8BFB\u8005\u671F\u5F85\u611F",
        confidence: 0.65
      });
    }
    return issues;
  }
  detectEmotionCategory(text, emotionTypes) {
    for (const [word, category] of Object.entries(emotionTypes)) {
      if (text.includes(word)) {
        return category;
      }
    }
    return "neutral";
  }
  // ── 工具方法 ─────────────────────────────────────────────
  /** 清理 frontmatter */
  cleanText(text) {
    return text.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
  }
  /** 计算文本哈希（简单 djb2，与 quality-score-engine 保持一致） */
  hashText(text) {
    let hash = 5381;
    for (let i = 0; i < text.length; i++) {
      hash = (hash << 5) + hash + text.charCodeAt(i) & 2147483647;
    }
    return hash.toString(36);
  }
  splitSentences(text) {
    return text.split(/[。！？!?]+/).filter((s) => s.trim().length > 0);
  }
  escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  /** 提取文本关键词（2-gram 去重） */
  extractKeywords(text) {
    const clean = text.replace(
      /[，。！？、；：""''（）【】《》…—\s\n\d]/g,
      ""
    );
    const keywords = [];
    for (let i = 0; i < clean.length - 1; i++) {
      const bigram = clean.slice(i, i + 2);
      if (!keywords.includes(bigram)) {
        keywords.push(bigram);
      }
    }
    return keywords.slice(0, 50);
  }
  /** 提取人物相关段落 */
  extractCharacterParagraphs(text, name) {
    return text.split(/\r?\n\r?\n/).map((p) => p.trim()).filter((p) => p.length > 0 && p.includes(name));
  }
  /** 提取包含关键词的句子 */
  extractSentence(context, keyword) {
    const idx = context.indexOf(keyword);
    if (idx === -1)
      return "";
    let start = idx;
    while (start > 0 && !/[。！？!?，,；;]/.test(context[start - 1])) {
      start--;
    }
    let end = idx + keyword.length;
    while (end < context.length && !/[。！？!?]/.test(context[end])) {
      end++;
    }
    if (end < context.length)
      end++;
    return context.substring(start, end).trim();
  }
  /** 根据偏离度判定预警级别 */
  severityFromDegree(degree) {
    if (degree >= this.severityThresholds.critical)
      return "critical";
    if (degree >= this.severityThresholds.warning)
      return "warning";
    return "info";
  }
  /** V1 严重度（low/medium/high）映射到本引擎 severity */
  mapV1Severity(v1, degree) {
    if (v1 === "high" || degree >= this.severityThresholds.critical) {
      return "critical";
    }
    if (v1 === "medium" || degree >= this.severityThresholds.warning) {
      return "warning";
    }
    return "info";
  }
  /** 计算单类型偏离分数（基于该类型的 issues） */
  calculateTypeScore(issues) {
    if (issues.length === 0)
      return 0;
    return Math.max(...issues.map((i) => i.degree));
  }
  /** 计算总偏离分数 */
  calculateOverallScore(typeScores) {
    const weights = {
      mainline: 0.25,
      characterOOC: 0.2,
      contradiction: 0.18,
      foreshadowForgot: 0.12,
      rhythm: 0.1,
      emotionBreak: 0.15
    };
    let total = 0;
    for (const type of DEVIATION_TYPES) {
      total += (typeScores[type] || 0) * weights[type];
    }
    return Math.min(100, Math.max(0, Math.round(total)));
  }
  /** 排序问题（按严重度倒序） */
  sortIssues(issues) {
    return [...issues].sort(
      (a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity]
    );
  }
  /** 构建改进建议列表 */
  buildSuggestions(issues) {
    const suggestions = [];
    const seen = /* @__PURE__ */ new Set();
    for (const issue of issues) {
      if (!issue.suggestion)
        continue;
      if (seen.has(issue.suggestion))
        continue;
      seen.add(issue.suggestion);
      suggestions.push({
        id: `suggestion_${suggestions.length}`,
        type: issue.type,
        content: issue.suggestion,
        priority: issue.severity,
        relatedIssueIds: [issue.id]
      });
    }
    return suggestions.sort((a, b) => SEVERITY_ORDER[b.priority] - SEVERITY_ORDER[a.priority]).slice(0, 10);
  }
  /** 判断类型是否可跳过（增量检测） */
  canSkipType(type, text, context) {
    if (!context.changedRange)
      return false;
    const changedText = text.slice(
      context.changedRange.start,
      context.changedRange.end
    );
    if (type === "mainline") {
      const keywords = context.mainlineKeywords || [];
      if (keywords.length === 0)
        return true;
      return !keywords.some((kw) => kw.length >= 2 && changedText.includes(kw));
    }
    if (type === "characterOOC") {
      const names = (context.characterInfos || []).map((c) => c.name);
      if (names.length === 0)
        return true;
      return !names.some((n) => n && n.length >= 2 && changedText.includes(n));
    }
    if (type === "foreshadowForgot") {
      const foreshadows = context.foreshadows || [];
      if (foreshadows.length === 0)
        return true;
      return !foreshadows.some(
        (fs) => fs.keywords.some((kw) => kw.length >= 2 && changedText.includes(kw))
      );
    }
    return false;
  }
  /** 检查取消信号 */
  throwIfAborted(signal) {
    if (signal?.aborted) {
      throw new DOMException("\u504F\u79BB\u68C0\u6D4B\u5DF2\u53D6\u6D88", "AbortError");
    }
  }
  getPaceLabel(pace) {
    const labels = { fast: "\u5FEB\u8282\u594F", medium: "\u4E2D\u8282\u594F", slow: "\u6162\u8282\u594F" };
    return labels[pace];
  }
  getRhythmSuggestion(actual, expected) {
    if (actual === "slow" && expected !== "slow") {
      return "\u5EFA\u8BAE\u589E\u52A0\u52A8\u4F5C\u63CF\u5199\u548C\u51B2\u7A81\uFF0C\u52A0\u5FEB\u53D9\u4E8B\u8282\u594F";
    }
    if (actual === "fast" && expected !== "fast") {
      return "\u5EFA\u8BAE\u9002\u5F53\u653E\u6162\u8282\u594F\uFF0C\u589E\u52A0\u5FC3\u7406\u63CF\u5199\u548C\u73AF\u5883\u94FA\u57AB";
    }
    return "\u53EF\u6839\u636E\u9700\u8981\u5FAE\u8C03\u8282\u594F\u5206\u5E03";
  }
  /** 空报告 */
  getEmptyReport(wordCount, startTime) {
    const typeScores = {
      mainline: 0,
      characterOOC: 0,
      contradiction: 0,
      foreshadowForgot: 0,
      rhythm: 0,
      emotionBreak: 0
    };
    return {
      overallScore: 0,
      overallSeverity: "info",
      typeScores,
      issues: [],
      suggestions: [
        {
          id: "empty_continue",
          type: "mainline",
          content: "\u7EE7\u7EED\u5199\u4F5C\uFF0C\u7CFB\u7EDF\u5C06\u81EA\u52A8\u68C0\u6D4B\u5267\u60C5\u504F\u79BB",
          priority: "info"
        }
      ],
      evaluatedAt: Date.now(),
      wordCount,
      evalTimeMs: Date.now() - startTime,
      fromCache: false,
      incremental: false
    };
  }
};

// shared/logger.ts
var LOG_LEVEL_PRIORITY = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4
};
var globalLogLevel = "warn";
function createLogger(scope, level) {
  const prefix = `[${scope}]`;
  const shouldLog = (msgLevel) => {
    const effectiveLevel = level ?? globalLogLevel;
    return LOG_LEVEL_PRIORITY[msgLevel] >= LOG_LEVEL_PRIORITY[effectiveLevel];
  };
  return {
    debug(...args) {
      if (shouldLog("debug"))
        console.log(prefix, ...args);
    },
    info(...args) {
      if (shouldLog("info"))
        console.log(prefix, ...args);
    },
    warn(...args) {
      if (shouldLog("warn"))
        console.warn(prefix, ...args);
    },
    error(...args) {
      if (shouldLog("error"))
        console.error(prefix, ...args);
    },
    child(childScope) {
      return createLogger(`${scope}:${childScope}`, level);
    }
  };
}

// engine/character-consistency-checker.ts
var log = createLogger("CharacterConsistencyChecker");
var PERSONALITY_TRAITS = {
  "\u51B7\u6F20": ["\u51B7\u6F20", "\u51B7\u6DE1", "\u51B7\u9177", "\u6DE1\u6F20", "\u758F\u79BB", "\u4E0D\u82DF\u8A00\u7B11"],
  "\u70ED\u60C5": ["\u70ED\u60C5", "\u70ED\u5FC3", "\u5F00\u6717", "\u6D3B\u6CFC", "\u4EB2\u70ED", "\u70ED\u60C5\u6D0B\u6EA2"],
  "\u6E29\u67D4": ["\u6E29\u67D4", "\u67D4\u548C", "\u6E29\u548C", "\u67D4\u58F0", "\u6E29\u67D4\u4F53\u8D34"],
  "\u66B4\u8E81": ["\u66B4\u8E81", "\u6613\u6012", "\u706B\u7206", "\u6012\u543C", "\u5486\u54EE", "\u52C3\u7136\u5927\u6012"],
  "\u6C89\u7A33": ["\u6C89\u7A33", "\u51B7\u9759", "\u9547\u5B9A", "\u4ECE\u5BB9", "\u6C89\u7740", "\u4E0D\u52A8\u58F0\u8272"],
  "\u51B2\u52A8": ["\u51B2\u52A8", "\u9C81\u83BD", "\u83BD\u649E", "\u610F\u6C14\u7528\u4E8B", "\u4E0D\u8BA1\u540E\u679C"],
  "\u52C7\u6562": ["\u52C7\u6562", "\u82F1\u52C7", "\u65E0\u754F", "\u633A\u8EAB\u800C\u51FA", "\u594B\u52C7"],
  "\u61E6\u5F31": ["\u61E6\u5F31", "\u80C6\u5C0F", "\u602F\u61E6", "\u754F\u7F29", "\u5BB3\u6015"],
  "\u806A\u660E": ["\u806A\u660E", "\u673A\u667A", "\u806A\u6167", "\u777F\u667A", "\u8DB3\u667A\u591A\u8C0B"],
  "\u611A\u8822": ["\u611A\u8822", "\u611A\u7B28", "\u8FDF\u949D", "\u5446\u7B28", "\u50BB\u6C14"],
  "\u72E1\u733E": ["\u72E1\u733E", "\u72E1\u8BC8", "\u5978\u8BC8", "\u8BE1\u8BA1\u591A\u7AEF", "\u57CE\u5E9C\u6DF1"],
  "\u8001\u5B9E": ["\u8001\u5B9E", "\u5FE0\u539A", "\u8BDA\u5B9E", "\u5766\u8BDA", "\u76F4\u7387"],
  "\u6B63\u76F4": ["\u6B63\u76F4", "\u521A\u6B63", "\u516C\u6B63", "\u5149\u660E\u78CA\u843D"],
  "\u865A\u4F2A": ["\u865A\u4F2A", "\u865A\u5047", "\u4F2A\u5584", "\u8868\u91CC\u4E0D\u4E00", "\u53E3\u662F\u5FC3\u975E"],
  "\u8C6A\u723D": ["\u8C6A\u723D", "\u8C6A\u8FC8", "\u723D\u5FEB", "\u4E0D\u62D8\u5C0F\u8282"],
  "\u7EC6\u817B": ["\u7EC6\u817B", "\u7EC6\u81F4", "\u4F53\u8D34", "\u7EC6\u5FC3", "\u5468\u5230"],
  "\u9738\u9053": ["\u9738\u9053", "\u86EE\u6A2A", "\u4E13\u6A2A", "\u5F3A\u52BF", "\u76DB\u6C14\u51CC\u4EBA"],
  "\u5584\u826F": ["\u5584\u826F", "\u4EC1\u6148", "\u6148\u60B2", "\u5FC3\u8F6F", "\u4E50\u4E8E\u52A9\u4EBA"],
  "\u90AA\u6076": ["\u90AA\u6076", "\u72E0\u6BD2", "\u6B8B\u5FCD", "\u5FC3\u72E0\u624B\u8FA3", "\u51B7\u9177\u65E0\u60C5"],
  "\u5185\u5411": ["\u5185\u5411", "\u6C89\u9ED8", "\u5BE1\u8A00", "\u817C\u8146", "\u5BB3\u7F9E"],
  "\u5F00\u6717": ["\u5F00\u6717", "\u5916\u5411", "\u6D3B\u6CFC", "\u5065\u8C08", "\u4E50\u89C2"]
};
var BEHAVIOR_PATTERNS = [
  { trait: "\u51B7\u6F20", incompatibleActions: ["\u6FC0\u52A8\u5730\u8BF4", "\u70ED\u60C5\u5730", "\u5174\u594B\u5730", "\u611F\u52A8\u5F97", "\u6CEA\u6D41\u6EE1\u9762", "\u6FC0\u52A8\u4E0D\u5DF2"] },
  { trait: "\u6C89\u7A33", incompatibleActions: ["\u614C\u4E86\u795E", "\u60CA\u614C\u5931\u63AA", "\u624B\u5FD9\u811A\u4E71", "\u5927\u60CA\u5931\u8272", "\u614C\u4E71"] },
  { trait: "\u6E29\u67D4", incompatibleActions: ["\u6012\u543C\u9053", "\u5389\u58F0\u559D\u9053", "\u52C3\u7136\u5927\u6012", "\u6454\u95E8\u800C\u53BB", "\u66B4\u8DF3\u5982\u96F7"] },
  { trait: "\u8001\u5B9E", incompatibleActions: ["\u72E1\u9EE0\u5730\u7B11", "\u773C\u73E0\u4E00\u8F6C", "\u6697\u4E2D\u76D8\u7B97", "\u6492\u8C0E", "\u6B3A\u9A97"] },
  { trait: "\u6B63\u76F4", incompatibleActions: ["\u9634\u9669\u5730", "\u6697\u7B97", "\u5077\u88AD", "\u4E0D\u62E9\u624B\u6BB5", "\u800D\u9634\u8C0B"] },
  { trait: "\u9738\u9053", incompatibleActions: ["\u552F\u552F\u8BFA\u8BFA", "\u4F4E\u58F0\u4E0B\u6C14", "\u5351\u8EAC\u5C48\u819D", "\u4FEF\u9996\u5E16\u8033"] },
  { trait: "\u52C7\u6562", incompatibleActions: ["\u5413\u5F97\u53D1\u6296", "\u7F29\u6210\u4E00\u56E2", "\u843D\u8352\u800C\u9003", "\u80C6\u6218\u5FC3\u60CA"] },
  { trait: "\u61E6\u5F31", incompatibleActions: ["\u633A\u8EAB\u800C\u51FA", "\u6BEB\u4E0D\u754F\u60E7", "\u82F1\u52C7\u6297\u4E89", "\u89C6\u6B7B\u5982\u5F52"] }
];
var APPEARANCE_CONTRADICTIONS = [
  { words: ["\u9ED1\u53D1", "\u4E4C\u9ED1", "\u58A8\u53D1"], opposite: ["\u91D1\u53D1", "\u767D\u53D1", "\u94F6\u53D1", "\u7EA2\u53D1", "\u68D5\u53D1"] },
  { words: ["\u91D1\u53D1", "\u91D1\u8272\u5934\u53D1"], opposite: ["\u9ED1\u53D1", "\u767D\u53D1", "\u94F6\u53D1", "\u7EA2\u53D1", "\u68D5\u53D1"] },
  { words: ["\u767D\u53D1", "\u94F6\u53D1", "\u82B1\u767D"], opposite: ["\u9ED1\u53D1", "\u91D1\u53D1", "\u7EA2\u53D1", "\u68D5\u53D1"] },
  { words: ["\u9AD8\u5927", "\u9B41\u68A7", "\u8EAB\u9AD8\u516B\u5C3A", "\u4EBA\u9AD8\u9A6C\u5927"], opposite: ["\u7626\u5C0F", "\u77EE\u5C0F", "\u4F8F\u5112", "\u8EAB\u9AD8\u4E0D\u8DB3\u4E94\u5C3A"] },
  { words: ["\u7626\u5C0F", "\u77EE\u5C0F", "\u7626\u5F31"], opposite: ["\u9AD8\u5927", "\u9B41\u68A7", "\u58EE\u7855", "\u8180\u5927\u8170\u5706"] },
  { words: ["\u82F1\u4FCA", "\u5E05\u6C14", "\u4FCA\u6717", "\u7F8E\u7537\u5B50"], opposite: ["\u4E11\u964B", "\u96BE\u770B", "\u5176\u8C8C\u4E0D\u626C"] },
  { words: ["\u7F8E\u4E3D", "\u6F02\u4EAE", "\u7EDD\u8272", "\u503E\u57CE"], opposite: ["\u4E11\u964B", "\u96BE\u770B", "\u5176\u8C8C\u4E0D\u626C"] },
  { words: ["\u80A5\u80D6", "\u81C3\u80BF", "\u5927\u8179\u4FBF\u4FBF"], opposite: ["\u6E05\u7626", "\u82D7\u6761", "\u9AA8\u7626\u5982\u67F4"] },
  { words: ["\u6E05\u7626", "\u82D7\u6761", "\u7EA4\u7EC6"], opposite: ["\u80A5\u80D6", "\u81C3\u80BF", "\u58EE\u7855"] },
  { words: ["\u5E74\u8F7B", "\u5C11\u5E74", "\u9752\u5E74", "\u4E8C\u5341\u5C81"], opposite: ["\u5E74\u8001", "\u5E74\u8FC8", "\u767D\u53D1\u82CD\u82CD", "\u53E4\u7A00\u4E4B\u5E74"] },
  { words: ["\u5E74\u8001", "\u5E74\u8FC8", "\u8001\u8005", "\u8001\u4EBA"], opposite: ["\u5E74\u8F7B", "\u5C11\u5E74", "\u9752\u5E74"] }
];
var ABILITY_KEYWORDS = [
  "\u529F\u6CD5",
  "\u6B66\u6280",
  "\u6B66\u529F",
  "\u6CD5\u672F",
  "\u795E\u901A",
  "\u7EDD\u6280",
  "\u7EDD\u62DB",
  "\u79D8\u6CD5",
  "\u4FEE\u70BC",
  "\u4FEE\u4E3A",
  "\u5883\u754C",
  "\u5B9E\u529B",
  "\u529F\u529B",
  "\u5185\u529B",
  "\u771F\u6C14",
  "\u7075\u529B",
  "\u64C5\u957F",
  "\u7CBE\u901A",
  "\u638C\u63E1",
  "\u70BC\u6210",
  "\u7EC3\u6210",
  "\u4E60\u5F97",
  "\u5B66\u4F1A"
];
var CharacterConsistencyChecker = class {
  constructor(vectorEnhancer, threshold) {
    this.vectorThreshold = 0.6;
    this.vectorEnhancer = vectorEnhancer;
    this.threshold = threshold || 0.6;
    this.personalityKeywordSet = new Set(
      Object.values(PERSONALITY_TRAITS).flat()
    );
    this.abilityKeywordSet = new Set(ABILITY_KEYWORDS);
  }
  async check(chapterText, characterInfos, historyTexts) {
    const result = {
      overallScore: 100,
      characterResults: {},
      summary: "",
      details: ""
    };
    if (!chapterText || chapterText.length === 0 || characterInfos.length === 0) {
      result.summary = "\u65E0\u6709\u6548\u6587\u672C\u6216\u4EBA\u7269\u4FE1\u606F\uFF0C\u8DF3\u8FC7\u4E00\u81F4\u6027\u68C0\u6D4B";
      result.details = "";
      return result;
    }
    for (const char of characterInfos) {
      const charInconsistencies = [];
      try {
        const personalityIssues = await this.checkPersonality(chapterText, char);
        charInconsistencies.push(...personalityIssues);
      } catch (e) {
        log.warn(`[CharacterConsistencyChecker] ${char.name} \u6027\u683C\u68C0\u6D4B\u5931\u8D25`, e);
      }
      try {
        const behaviorIssues = await this.checkBehavior(chapterText, char);
        charInconsistencies.push(...behaviorIssues);
      } catch (e) {
        log.warn(`[CharacterConsistencyChecker] ${char.name} \u884C\u4E3A\u68C0\u6D4B\u5931\u8D25`, e);
      }
      try {
        const abilityIssues = await this.checkAbility(chapterText, char);
        charInconsistencies.push(...abilityIssues);
      } catch (e) {
        log.warn(`[CharacterConsistencyChecker] ${char.name} \u80FD\u529B\u68C0\u6D4B\u5931\u8D25`, e);
      }
      try {
        const appearanceIssues = await this.checkAppearance(chapterText, char);
        charInconsistencies.push(...appearanceIssues);
      } catch (e) {
        log.warn(`[CharacterConsistencyChecker] ${char.name} \u5916\u8C8C\u68C0\u6D4B\u5931\u8D25`, e);
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
  async checkPersonality(text, character) {
    const issues = [];
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
            const severity = similarity < 0.3 ? "high" : similarity < 0.45 ? "medium" : "low";
            const confidence = 1 - similarity;
            issues.push({
              type: "personality",
              severity,
              description: `\u7B2C${i + 1}\u6BB5\u4EBA\u7269\u63CF\u5199\u4E0E\u8BBE\u5B9A\u6027\u683C\u76F8\u4F3C\u5EA6\u8F83\u4F4E\uFF08${(similarity * 100).toFixed(1)}%\uFF09`,
              location: `\u7B2C${i + 1}\u6BB5\u9644\u8FD1`,
              suggestion: "\u8BF7\u786E\u8BA4\u8BE5\u6BB5\u843D\u4E2D\u4EBA\u7269\u7684\u8A00\u884C\u662F\u5426\u7B26\u5408\u5176\u6027\u683C\u8BBE\u5B9A",
              confidence: Math.min(confidence, 0.9)
            });
          }
        }
      } catch (e) {
        log.warn("[CharacterConsistencyChecker] \u5411\u91CF\u6027\u683C\u68C0\u6D4B\u5931\u8D25\uFF0C\u964D\u7EA7\u4E3A\u5173\u952E\u8BCD\u5339\u914D", e);
        return this.checkPersonalityKeyword(text, character, charParagraphs);
      }
    } else {
      return this.checkPersonalityKeyword(text, character, charParagraphs);
    }
    return issues;
  }
  checkPersonalityKeyword(text, character, paragraphs) {
    const issues = [];
    const personalityDesc = character.personality || "";
    const charName = character.name;
    const detectedTraits = [];
    for (const [trait, keywords] of Object.entries(PERSONALITY_TRAITS)) {
      if (personalityDesc.includes(trait)) {
        detectedTraits.push(trait);
      }
    }
    if (detectedTraits.length === 0) {
      return issues;
    }
    for (let i = 0; i < paragraphs.length; i++) {
      const para = paragraphs[i];
      const paraTraits = [];
      for (const [trait, keywords] of Object.entries(PERSONALITY_TRAITS)) {
        for (const kw of keywords) {
          if (para.includes(kw) && para.includes(charName)) {
            paraTraits.push(trait);
            break;
          }
        }
      }
      const matchingTraits = paraTraits.filter((t) => detectedTraits.includes(t));
      const mismatchingTraits = paraTraits.filter((t) => !detectedTraits.includes(t));
      if (mismatchingTraits.length > 0 && matchingTraits.length === 0) {
        const severity = mismatchingTraits.length >= 2 ? "medium" : "low";
        issues.push({
          type: "personality",
          severity,
          description: `\u7B2C${i + 1}\u6BB5\u68C0\u6D4B\u5230\u4E0E\u8BBE\u5B9A\u4E0D\u7B26\u7684\u6027\u683C\u7279\u5F81\uFF1A${mismatchingTraits.join("\u3001")}`,
          location: `\u7B2C${i + 1}\u6BB5\u9644\u8FD1`,
          suggestion: `\u8BBE\u5B9A\u6027\u683C\u4E3A\uFF1A${detectedTraits.join("\u3001")}\uFF0C\u8BF7\u786E\u8BA4\u8BE5\u6BB5\u63CF\u5199\u662F\u5426\u5408\u7406`,
          confidence: 0.6
        });
      }
    }
    return issues;
  }
  async checkBehavior(text, character) {
    const issues = [];
    if (!character.personality || character.personality.length === 0) {
      return issues;
    }
    const charName = character.name;
    const personalityDesc = character.personality;
    const relevantPatterns = BEHAVIOR_PATTERNS.filter(
      (p) => personalityDesc.includes(p.trait)
    );
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
              type: "behavior",
              severity: "medium",
              description: `"${pattern.trait}"\u7684\u4EBA\u51FA\u73B0\u4E86\u4E0D\u7B26\u7684\u884C\u4E3A\uFF1A${action}`,
              location: `\u7B2C${i + 1}\u6BB5\u9644\u8FD1`,
              suggestion: sentence ? `\u539F\u6587\uFF1A"${sentence}"\uFF0C\u8BF7\u786E\u8BA4\u8BE5\u884C\u4E3A\u662F\u5426\u7B26\u5408\u4EBA\u7269\u6027\u683C` : "\u8BF7\u786E\u8BA4\u8BE5\u884C\u4E3A\u662F\u5426\u7B26\u5408\u4EBA\u7269\u6027\u683C\u8BBE\u5B9A",
              confidence: 0.7
            });
            break;
          }
        }
      }
    }
    return issues;
  }
  async checkAbility(text, character) {
    const issues = [];
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
        const abilityParagraphs = charParagraphs.filter(
          (p) => ABILITY_KEYWORDS.some((kw) => p.includes(kw))
        );
        for (let i = 0; i < abilityParagraphs.length; i++) {
          const para = abilityParagraphs[i];
          const paraVector = await this.vectorEnhancer.embedText(para);
          const similarity = this.vectorEnhancer.cosineSimilarity(abilitiesVector, paraVector);
          if (similarity < 0.4) {
            const paraIdx = charParagraphs.indexOf(para);
            issues.push({
              type: "ability",
              severity: "medium",
              description: `\u68C0\u6D4B\u5230\u53EF\u80FD\u8D85\u51FA\u8BBE\u5B9A\u8303\u56F4\u7684\u80FD\u529B\u63CF\u8FF0\uFF08\u76F8\u4F3C\u5EA6 ${(similarity * 100).toFixed(1)}%\uFF09`,
              location: `\u7B2C${paraIdx + 1}\u6BB5\u9644\u8FD1`,
              suggestion: "\u8BF7\u786E\u8BA4\u8BE5\u80FD\u529B\u662F\u5426\u5728\u4EBA\u7269\u8BBE\u5B9A\u7684\u80FD\u529B\u8303\u56F4\u5185",
              confidence: 0.5
            });
          }
        }
      } catch (e) {
        log.warn("[CharacterConsistencyChecker] \u5411\u91CF\u80FD\u529B\u68C0\u6D4B\u5931\u8D25\uFF0C\u964D\u7EA7\u4E3A\u5173\u952E\u8BCD\u5339\u914D", e);
      }
    }
    return issues;
  }
  async checkAppearance(text, character) {
    const issues = [];
    if (!character.appearance || character.appearance.length === 0) {
      return issues;
    }
    const charName = character.name;
    const appearanceDesc = character.appearance;
    const charParagraphs = this.extractCharacterParagraphs(text, charName);
    if (charParagraphs.length === 0) {
      return issues;
    }
    for (let i = 0; i < charParagraphs.length; i++) {
      const para = charParagraphs[i];
      for (const contradiction of APPEARANCE_CONTRADICTIONS) {
        const hasAppearanceWord = contradiction.words.some(
          (w) => appearanceDesc.includes(w)
        );
        if (hasAppearanceWord) {
          for (const opp of contradiction.opposite) {
            if (para.includes(opp) && para.includes(charName)) {
              const sentence = this.extractSentence(para, opp);
              issues.push({
                type: "appearance",
                severity: "high",
                description: `\u5916\u8C8C\u63CF\u8FF0\u77DB\u76FE\uFF1A\u8BBE\u5B9A\u4E3A"${contradiction.words[0]}"\uFF0C\u6587\u4E2D\u51FA\u73B0"${opp}"`,
                location: `\u7B2C${i + 1}\u6BB5\u9644\u8FD1`,
                suggestion: sentence ? `\u539F\u6587\uFF1A"${sentence}"\uFF0C\u8BF7\u4FEE\u6B63\u5916\u8C8C\u63CF\u8FF0\u4EE5\u4FDD\u6301\u4E00\u81F4` : "\u8BF7\u4FEE\u6B63\u5916\u8C8C\u63CF\u8FF0",
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
  extractCharacterParagraphs(text, name) {
    const paragraphs = text.split(/\r?\n\r?\n/).map((p) => p.trim()).filter((p) => p.length > 0 && p.includes(name));
    return paragraphs;
  }
  extractSentence(context, keyword) {
    const keywordIdx = context.indexOf(keyword);
    if (keywordIdx === -1)
      return "";
    let start = keywordIdx;
    while (start > 0 && !/[。！？!?，,；;]/.test(context[start - 1])) {
      start--;
    }
    let end = keywordIdx + keyword.length;
    while (end < context.length && !/[。！？!?]/.test(context[end])) {
      end++;
    }
    if (end < context.length)
      end++;
    return context.substring(start, end).trim();
  }
  calculateCharacterScore(inconsistencies) {
    if (inconsistencies.length === 0)
      return 100;
    let penalty = 0;
    for (const item of inconsistencies) {
      const basePenalty = item.severity === "high" ? 15 : item.severity === "medium" ? 8 : 3;
      penalty += basePenalty * item.confidence;
    }
    return Math.max(0, Math.min(100, 100 - penalty));
  }
  calculateOverallScore(result) {
    const charNames = Object.keys(result.characterResults);
    if (charNames.length === 0)
      return 100;
    let totalScore = 0;
    for (const name of charNames) {
      totalScore += result.characterResults[name].score;
    }
    return Math.round(totalScore / charNames.length);
  }
  generateSummary(result) {
    const charNames = Object.keys(result.characterResults);
    if (charNames.length === 0) {
      return "\u65E0\u6709\u6548\u4EBA\u7269\u4FE1\u606F";
    }
    const totalIssues = charNames.reduce(
      (sum, name) => sum + result.characterResults[name].inconsistencies.length,
      0
    );
    const highIssues = charNames.reduce(
      (sum, name) => sum + result.characterResults[name].inconsistencies.filter((i) => i.severity === "high").length,
      0
    );
    if (totalIssues === 0) {
      return `\u68C0\u6D4B\u4E86 ${charNames.length} \u4E2A\u4EBA\u7269\uFF0C\u672A\u53D1\u73B0\u660E\u663E\u7684\u4EBA\u8BBE\u4E0D\u4E00\u81F4\u95EE\u9898\uFF0C\u603B\u4F53\u4E00\u81F4\u6027\u5F97\u5206 ${result.overallScore} \u5206\u3002`;
    }
    return `\u68C0\u6D4B\u4E86 ${charNames.length} \u4E2A\u4EBA\u7269\uFF0C\u53D1\u73B0 ${totalIssues} \u5904\u53EF\u80FD\u7684\u4EBA\u8BBE\u4E0D\u4E00\u81F4\uFF08\u5176\u4E2D\u4E25\u91CD ${highIssues} \u5904\uFF09\uFF0C\u603B\u4F53\u4E00\u81F4\u6027\u5F97\u5206 ${result.overallScore} \u5206\u3002`;
  }
  generateDetails(result) {
    const charNames = Object.keys(result.characterResults);
    if (charNames.length === 0)
      return "";
    const lines = [];
    for (const name of charNames) {
      const charResult = result.characterResults[name];
      lines.push(`### ${name}\uFF08\u5F97\u5206\uFF1A${charResult.score}\uFF09`);
      if (charResult.inconsistencies.length === 0) {
        lines.push("- \u672A\u53D1\u73B0\u660E\u663E\u4E0D\u4E00\u81F4");
      } else {
        const typeLabels = {
          personality: "\u6027\u683C\u8BED\u6C14",
          behavior: "\u884C\u4E3A\u903B\u8F91",
          ability: "\u80FD\u529B\u8FB9\u754C",
          appearance: "\u5916\u8C8C\u63CF\u8FF0"
        };
        const severityLabels = {
          high: "\u{1F534} \u4E25\u91CD",
          medium: "\u{1F7E1} \u4E2D\u7B49",
          low: "\u{1F7E2} \u8F7B\u5FAE"
        };
        for (const item of charResult.inconsistencies) {
          const severityLabel = severityLabels[item.severity] || item.severity;
          const typeLabel = typeLabels[item.type] || item.type;
          lines.push(`- ${severityLabel} [${typeLabel}] ${item.description}`);
          if (item.location) {
            lines.push(`  \u4F4D\u7F6E\uFF1A${item.location}`);
          }
          if (item.suggestion) {
            lines.push(`  \u5EFA\u8BAE\uFF1A${item.suggestion}`);
          }
          lines.push(`  \u7F6E\u4FE1\u5EA6\uFF1A${(item.confidence * 100).toFixed(0)}%`);
        }
      }
      lines.push("");
    }
    return lines.join("\n");
  }
};

// engine/plot-divergence-engine.ts
var log2 = createLogger("PlotDivergenceEngine");
var CHARACTER_TRAIT_KEYWORDS = {
  "\u51B7\u9759": ["\u51B7\u9759", "\u9547\u5B9A", "\u5E73\u9759", "\u4E0D\u52A8\u58F0\u8272", "\u9762\u65E0\u8868\u60C5", "\u6DE1\u7136", "\u6C89\u7740"],
  "\u66B4\u8E81": ["\u66B4\u8E81", "\u6012\u543C", "\u5486\u54EE", "\u6012", "\u70E6\u8E81", "\u607C\u706B", "\u6C14\u6025\u8D25\u574F"],
  "\u806A\u660E": ["\u806A\u660E", "\u673A\u667A", "\u7075\u673A\u4E00\u52A8", "\u8BA1\u4E0A\u5FC3\u6765", "\u8F6C\u5FF5\u4E00\u60F3", "\u604D\u7136\u5927\u609F", "\u777F\u667A"],
  "\u9C81\u83BD": ["\u9C81\u83BD", "\u51B2\u52A8", "\u4E0D\u7BA1\u4E0D\u987E", "\u51B2\u4E0A\u53BB", "\u4E8C\u8BDD\u4E0D\u8BF4", "\u8D38\u7136"],
  "\u8C28\u614E": ["\u8C28\u614E", "\u5C0F\u5FC3", "\u72B9\u8C6B", "\u518D\u4E09\u8003\u8651", "\u601D\u5FD6", "\u6382\u91CF", "\u5C0F\u5FC3\u7FFC\u7FFC"],
  "\u4E50\u89C2": ["\u4E50\u89C2", "\u5F00\u6717", "\u7B11", "\u8F7B\u677E", "\u65E0\u6240\u8C13", "\u6EE1\u4E0D\u5728\u4E4E", "\u8C41\u8FBE"],
  "\u8179\u9ED1": ["\u8179\u9ED1", "\u9634\u7B11", "\u51B7\u7B11", "\u7B97\u8BA1", "\u76D8\u7B97", "\u5978\u7B11", "\u610F\u5473\u6DF1\u957F"],
  "\u6E29\u67D4": ["\u6E29\u67D4", "\u67D4\u548C", "\u8F7B\u58F0", "\u6E29\u67D4\u5730", "\u67D4\u58F0", "\u4F53\u8D34", "\u6696\u5FC3"],
  "\u5B64\u50B2": ["\u5B64\u50B2", "\u51B7\u6F20", "\u4E0D\u5C51", "\u51B7\u54FC", "\u50B2\u6162", "\u9AD8\u9AD8\u5728\u4E0A", "\u9119\u5937"],
  "\u91CD\u60C5\u4E49": ["\u91CD\u60C5\u4E49", "\u5144\u5F1F", "\u670B\u53CB", "\u4E49\u6C14", "\u633A\u8EAB\u800C\u51FA", "\u76F8\u52A9", "\u60A3\u96BE"]
};
var SETTING_CONTRADICTION_PATTERNS = [
  { pattern: /(现代|科技|手机|电脑|互联网|飞机|汽车)/, setting: "\u73B0\u4EE3\u79D1\u6280" },
  { pattern: /(修仙|灵力|真气|丹药|御剑|元婴|金丹)/, setting: "\u4FEE\u4ED9\u4FEE\u771F" },
  { pattern: /(魔法|巫师|魔杖|咒语|精灵|矮人|巨龙)/, setting: "\u897F\u5E7B\u9B54\u6CD5" },
  { pattern: /(武侠|内力|轻功|门派|江湖|盟主|侠客)/, setting: "\u6B66\u4FA0\u6C5F\u6E56" },
  { pattern: /(科幻|飞船|机甲|外星人|基因改造|星际)/, setting: "\u79D1\u5E7B\u661F\u9645" },
  { pattern: /(古代|王朝|皇帝|大臣|皇宫|奏折|科举)/, setting: "\u53E4\u4EE3\u738B\u671D" }
];
var RHYTHM_ACTION_WORDS = [
  "\u51B2",
  "\u6253",
  "\u780D",
  "\u523A",
  "\u6740",
  "\u51FB",
  "\u6251",
  "\u8DC3",
  "\u95EA",
  "\u8EB2",
  "\u8DD1",
  "\u8FFD",
  "\u9003",
  "\u8D76",
  "\u649E",
  "\u7838",
  "\u6454",
  "\u98DE",
  "\u843D",
  "\u8D77"
];
var RHYTHM_DIALOGUE_MARKERS = [
  "\u8BF4",
  "\u9053",
  "\u95EE",
  "\u7B54",
  "\u558A",
  "\u53EB",
  "\u543C",
  "\u54ED",
  "\u7B11",
  "\u53F9"
];
var RHYTHM_DESCRIPTION_WORDS = [
  "\u7684",
  "\u4E86",
  "\u7740",
  "\u662F",
  "\u5728",
  "\u6709",
  "\u5F88",
  "\u90FD",
  "\u5C31",
  "\u53C8",
  "\u4EFF\u4F5B",
  "\u4F3C\u4E4E",
  "\u597D\u50CF",
  "\u72B9\u5982",
  "\u5B9B\u5982",
  "\u5982\u540C",
  "\u4E00\u822C",
  "\u4E00\u6837"
];
var FORESHADOW_RECOVERY_PATTERNS = [
  /原来如此/,
  /难怪/,
  /怪不得/,
  /果然/,
  /不出所料/,
  /真相是/,
  /揭开了/,
  /谜底/,
  /终于明白/,
  /豁然开朗/,
  /这就是/,
  /原来是/,
  /回想起来/,
  /想起当初/
];
var FORESHADOW_PLANT_PATTERNS = [
  /据说/,
  /传闻/,
  /传说/,
  /没人知道/,
  /神秘/,
  /诡异/,
  /那东西/,
  /此物/,
  /总有一天/,
  /到时候/,
  /那件事/,
  /仿佛/,
  /似乎/,
  /好像/,
  /隐约/,
  /依稀/,
  /若有所思/,
  /心里暗想/,
  /心中一动/,
  /暗自/,
  /悄悄/,
  /不动声色/
];
var PlotDivergenceEngine = class {
  constructor(options = {}) {
    this.divergenceHistory = [];
    this.lastAlertTime = {};
    this.ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1e3;
    this.chapterOutline = options.chapterOutline || "";
    this.mainlineKeywords = options.mainlineKeywords || [];
    this.characterNames = options.characterNames || [];
    this.characterTraits = options.characterTraits || {};
    this.settingKeywords = options.settingKeywords || [];
    this.expectedRhythm = options.expectedRhythm || "medium";
    this.foreshadowToRecover = options.foreshadowToRecover || [];
    this.activeForeshadows = options.activeForeshadows || [];
    this.previousDivergence = options.previousDivergence || 0;
    this.ignoredIssues = new Set(options.ignoredIssues || []);
  }
  updateOptions(options) {
    if (options.chapterOutline !== void 0)
      this.chapterOutline = options.chapterOutline;
    if (options.mainlineKeywords !== void 0)
      this.mainlineKeywords = options.mainlineKeywords;
    if (options.characterNames !== void 0)
      this.characterNames = options.characterNames;
    if (options.characterTraits !== void 0)
      this.characterTraits = options.characterTraits;
    if (options.settingKeywords !== void 0)
      this.settingKeywords = options.settingKeywords;
    if (options.expectedRhythm !== void 0)
      this.expectedRhythm = options.expectedRhythm;
    if (options.foreshadowToRecover !== void 0)
      this.foreshadowToRecover = options.foreshadowToRecover;
    if (options.activeForeshadows !== void 0)
      this.activeForeshadows = options.activeForeshadows;
    if (options.previousDivergence !== void 0)
      this.previousDivergence = options.previousDivergence;
    if (options.ignoredIssues !== void 0)
      this.ignoredIssues = new Set(options.ignoredIssues);
  }
  evaluate(text) {
    const startTime = Date.now();
    const cleanText = text.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
    const wordCount = cleanText.length;
    if (wordCount < 100) {
      return this.getEmptyResult(wordCount);
    }
    const paragraphs = this.splitParagraphs(cleanText);
    const sentences = this.splitSentences(cleanText);
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
      setting: 0.15
    };
    const overallDivergence = Math.round(
      mainlineDivergence.score * weights.mainline + characterDivergence.score * weights.character + rhythmDivergence.score * weights.rhythm + foreshadowDivergence.score * weights.foreshadow + settingDivergence.score * weights.setting
    );
    const overallLevel = this.getDivergenceLevel(overallDivergence);
    this.divergenceHistory.push(overallDivergence);
    if (this.divergenceHistory.length > 10) {
      this.divergenceHistory = this.divergenceHistory.slice(-10);
    }
    const { shouldAlert, alertReason } = this.checkShouldAlert(overallDivergence, overallLevel, {
      mainlineDivergence,
      characterDivergence,
      rhythmDivergence,
      foreshadowDivergence,
      settingDivergence
    });
    const elapsed = Date.now() - startTime;
    log2.debug("[PlotDivergenceEngine] \u504F\u79BB\u68C0\u6D4B\u5B8C\u6210\uFF0C\u8017\u65F6", elapsed, "ms\uFF0C\u504F\u79BB\u5EA6", overallDivergence + "%");
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
      alertReason
    };
  }
  evaluateMainline(text) {
    const issues = [];
    const suggestions = [];
    const details = {};
    let outlineMatchRate = 0;
    let keywordCoverage = 0;
    let coreConflictMatch = 0;
    if (this.chapterOutline) {
      const outlineKeywords = this.extractKeywords(this.chapterOutline);
      const matchedKeywords = [];
      const unmatchedKeywords = [];
      for (const kw of outlineKeywords) {
        if (kw.length >= 2 && text.includes(kw)) {
          matchedKeywords.push(kw);
        } else if (kw.length >= 2) {
          unmatchedKeywords.push(kw);
        }
      }
      outlineMatchRate = outlineKeywords.length > 0 ? Math.round(matchedKeywords.length / outlineKeywords.length * 100) : 50;
      details.outlineMatched = matchedKeywords.length;
      details.outlineTotal = outlineKeywords.length;
      details.outlineMatchRate = outlineMatchRate + "%";
      if (unmatchedKeywords.length > 0 && outlineMatchRate < 60) {
        issues.push(`\u5927\u7EB2\u5173\u952E\u8BCD\u672A\u8986\u76D6\uFF1A${unmatchedKeywords.slice(0, 5).join("\u3001")}${unmatchedKeywords.length > 5 ? "..." : ""}`);
      }
    } else {
      outlineMatchRate = 50;
      details.note = "\u672A\u8BBE\u7F6E\u7AE0\u8282\u5927\u7EB2";
    }
    if (this.mainlineKeywords.length > 0) {
      let matched = 0;
      for (const kw of this.mainlineKeywords) {
        if (kw.length >= 2 && text.includes(kw)) {
          matched++;
        }
      }
      keywordCoverage = Math.round(matched / this.mainlineKeywords.length * 100);
      details.mainlineMatched = matched + "/" + this.mainlineKeywords.length;
      details.mainlineCoverage = keywordCoverage + "%";
      if (keywordCoverage < 30) {
        issues.push("\u4E3B\u7EBF\u5143\u7D20\u51FA\u73B0\u8FC7\u5C11\uFF0C\u5267\u60C5\u53EF\u80FD\u504F\u79BB\u4E3B\u7EBF");
      }
    } else {
      keywordCoverage = 50;
      details.mainlineNote = "\u672A\u8BBE\u7F6E\u4E3B\u7EBF\u5173\u952E\u8BCD";
    }
    const conflictPatterns = [
      /但是|然而|可是|却|不料|没想到/,
      /突然|忽然|就在这时|就在此刻/,
      /危机|危险|紧急|迫在眉睫|千钧一发/,
      /对峙|对抗|较量|决斗|战斗|厮杀/
    ];
    let conflictCount = 0;
    for (const pattern of conflictPatterns) {
      conflictCount += (text.match(pattern) || []).length;
    }
    details.conflictIndicators = conflictCount;
    if (this.chapterOutline && /冲突|对抗|战斗|危机|危险|挑战/.test(this.chapterOutline)) {
      coreConflictMatch = conflictCount > 0 ? Math.min(100, conflictCount * 20) : 20;
      if (conflictCount === 0) {
        issues.push("\u5927\u7EB2\u9884\u671F\u6709\u51B2\u7A81\uFF0C\u4F46\u672C\u7AE0\u672A\u68C0\u6D4B\u5230\u51B2\u7A81\u5143\u7D20");
      }
    } else {
      coreConflictMatch = 70;
    }
    const divergenceScore = Math.round(
      (100 - outlineMatchRate) * 0.4 + (100 - keywordCoverage) * 0.35 + (100 - coreConflictMatch) * 0.25
    );
    if (divergenceScore >= 60) {
      suggestions.push("\u5EFA\u8BAE\u56DE\u987E\u672C\u7AE0\u5927\u7EB2\uFF0C\u786E\u4FDD\u6838\u5FC3\u60C5\u8282\u6309\u8BA1\u5212\u63A8\u8FDB");
      if (this.mainlineKeywords.length > 0) {
        suggestions.push("\u53EF\u9002\u5F53\u7A7F\u63D2\u4E3B\u7EBF\u5143\u7D20\uFF0C\u5F3A\u5316\u4E3B\u7EBF\u5173\u8054");
      }
    } else if (divergenceScore >= 30) {
      suggestions.push("\u90E8\u5206\u5927\u7EB2\u8981\u70B9\u672A\u8986\u76D6\uFF0C\u6CE8\u610F\u5728\u540E\u7EED\u6BB5\u843D\u4E2D\u8865\u5145");
    } else {
      suggestions.push("\u4E3B\u7EBF\u8D34\u5408\u5EA6\u826F\u597D\uFF0C\u7EE7\u7EED\u4FDD\u6301");
    }
    return {
      score: Math.min(100, Math.max(0, divergenceScore)),
      level: this.getDivergenceLevel(divergenceScore),
      details,
      issues: this.filterIgnored(issues),
      suggestions
    };
  }
  evaluateCharacter(text, sentences) {
    const issues = [];
    const suggestions = [];
    const details = {};
    let totalScore = 0;
    let charCount = 0;
    const characterBehavior = {};
    for (const name of this.characterNames) {
      if (!name || name.length < 2)
        continue;
      const mentions = (text.match(new RegExp(this.escapeRegex(name), "g")) || []).length;
      if (mentions === 0)
        continue;
      characterBehavior[name] = { mentions, actions: [], dialogues: 0 };
      const dialogPattern = new RegExp(this.escapeRegex(name) + '["\u300C\u300E].*?["\u300D\u300F]', "g");
      characterBehavior[name].dialogues = (text.match(dialogPattern) || []).length;
      const traits = this.characterTraits[name] || [];
      if (traits.length > 0) {
        let traitMatchScore = 0;
        let traitMismatchScore = 0;
        for (const trait of traits) {
          const traitWords = CHARACTER_TRAIT_KEYWORDS[trait] || [trait];
          let matchCount = 0;
          for (const word of traitWords) {
            const nearPattern = new RegExp(this.escapeRegex(name) + ".{0,50}" + this.escapeRegex(word), "g");
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
            const nearPattern = new RegExp(this.escapeRegex(name) + ".{0,50}" + this.escapeRegex(word), "g");
            mismatchCount += (text.match(nearPattern) || []).length;
          }
          if (mismatchCount > 0) {
            traitMismatchScore += Math.min(40, mismatchCount * 15);
          }
        }
        const charScore = Math.max(0, Math.min(100, 50 + traitMatchScore - traitMismatchScore));
        totalScore += charScore;
        charCount++;
        details[`${name}_consistency`] = charScore + "%";
        if (traitMismatchScore > 20) {
          issues.push(`${name} \u7684\u884C\u4E3A\u53EF\u80FD\u4E0E\u300C${traits.join("\u3001")}\u300D\u4EBA\u8BBE\u4E0D\u7B26`);
        }
      }
    }
    if (charCount === 0) {
      details.note = "\u672A\u68C0\u6D4B\u5230\u4E3B\u8981\u89D2\u8272\u6D3B\u52A8";
      return {
        score: 30,
        level: "normal",
        details,
        issues: [],
        suggestions: ["\u4E3B\u8981\u89D2\u8272\u672A\u51FA\u573A\uFF0C\u5F85\u89D2\u8272\u51FA\u573A\u540E\u68C0\u6D4B\u4EBA\u8BBE\u4E00\u81F4\u6027"]
      };
    }
    const avgConsistency = Math.round(totalScore / charCount);
    const divergenceScore = 100 - avgConsistency;
    details.charactersAnalyzed = charCount;
    details.avgConsistency = avgConsistency + "%";
    if (divergenceScore >= 60) {
      suggestions.push("\u5EFA\u8BAE\u68C0\u67E5\u89D2\u8272\u884C\u4E3A\u662F\u5426\u7B26\u5408\u4EBA\u8BBE\uFF0C\u5FC5\u8981\u65F6\u8C03\u6574\u63CF\u5199");
      suggestions.push("\u53EF\u901A\u8FC7\u5FC3\u7406\u6D3B\u52A8\u6216\u65C1\u767D\u89E3\u91CA\u89D2\u8272\u884C\u4E3A\u52A8\u673A");
    } else if (divergenceScore >= 30) {
      suggestions.push("\u90E8\u5206\u89D2\u8272\u884C\u4E3A\u7565\u6709\u504F\u5DEE\uFF0C\u6CE8\u610F\u4FDD\u6301\u4EBA\u8BBE\u4E00\u81F4\u6027");
    } else {
      suggestions.push("\u89D2\u8272\u884C\u4E3A\u7B26\u5408\u4EBA\u8BBE\uFF0C\u8868\u73B0\u7A33\u5B9A");
    }
    return {
      score: Math.min(100, Math.max(0, divergenceScore)),
      level: this.getDivergenceLevel(divergenceScore),
      details,
      issues: this.filterIgnored(issues),
      suggestions
    };
  }
  evaluateRhythm(text, sentences, paragraphs) {
    const issues = [];
    const suggestions = [];
    const details = {};
    if (sentences.length < 5) {
      details.note = "\u53E5\u5B50\u592A\u5C11\uFF0C\u65E0\u6CD5\u51C6\u786E\u8BC4\u4F30\u8282\u594F";
      return {
        score: 20,
        level: "normal",
        details,
        issues: [],
        suggestions: ["\u5185\u5BB9\u8F83\u77ED\uFF0C\u7EE7\u7EED\u5199\u4F5C\u540E\u53EF\u8BC4\u4F30\u8282\u594F"]
      };
    }
    const avgSentenceLen = text.length / sentences.length;
    let actionCount = 0;
    for (const word of RHYTHM_ACTION_WORDS) {
      actionCount += (text.match(new RegExp(word, "g")) || []).length;
    }
    let dialogueCount = 0;
    for (const marker of RHYTHM_DIALOGUE_MARKERS) {
      dialogueCount += (text.match(new RegExp(marker + '["\u300C\u300E]', "g")) || []).length;
    }
    let descCount = 0;
    for (const word of RHYTHM_DESCRIPTION_WORDS) {
      descCount += (text.match(new RegExp(word, "g")) || []).length;
    }
    const actionRatio = text.length > 0 ? actionCount / text.length * 100 : 0;
    const dialogueRatio = sentences.length > 0 ? dialogueCount / sentences.length : 0;
    const descRatio = text.length > 0 ? descCount / text.length * 100 : 0;
    details.avgSentenceLen = Math.round(avgSentenceLen) + "\u5B57";
    details.actionDensity = Math.round(actionRatio * 10) / 10;
    details.dialogueRatio = Math.round(dialogueRatio * 100) + "%";
    details.descriptionDensity = Math.round(descRatio * 10) / 10;
    let actualPace;
    if (avgSentenceLen < 20 && actionRatio > 3) {
      actualPace = "fast";
    } else if (avgSentenceLen > 40 && descRatio > 15) {
      actualPace = "slow";
    } else {
      actualPace = "medium";
    }
    details.actualPace = actualPace;
    details.expectedPace = this.expectedRhythm;
    let divergenceScore = 0;
    if (actualPace !== this.expectedRhythm) {
      if (this.expectedRhythm === "fast" && actualPace === "slow" || this.expectedRhythm === "slow" && actualPace === "fast") {
        divergenceScore = 70;
        issues.push(`\u8282\u594F\u504F\u5DEE\u8F83\u5927\uFF1A\u9884\u671F${this.getPaceLabel(this.expectedRhythm)}\uFF0C\u5B9E\u9645${this.getPaceLabel(actualPace)}`);
      } else {
        divergenceScore = 35;
        issues.push(`\u8282\u594F\u7565\u6709\u504F\u5DEE\uFF1A\u9884\u671F${this.getPaceLabel(this.expectedRhythm)}\uFF0C\u5B9E\u9645${this.getPaceLabel(actualPace)}`);
      }
    } else {
      divergenceScore = 10;
    }
    if (paragraphs.length >= 3) {
      const sceneShifts = this.detectSceneShifts(paragraphs);
      details.sceneShifts = sceneShifts;
      const expectedShifts = this.expectedRhythm === "fast" ? 3 : this.expectedRhythm === "slow" ? 1 : 2;
      if (sceneShifts > expectedShifts * 2) {
        divergenceScore = Math.min(100, divergenceScore + 20);
        issues.push("\u573A\u666F\u5207\u6362\u8FC7\u4E8E\u9891\u7E41\uFF0C\u53EF\u80FD\u5F71\u54CD\u9605\u8BFB\u4F53\u9A8C");
      }
    }
    if (divergenceScore >= 60) {
      if (actualPace === "slow" && this.expectedRhythm !== "slow") {
        suggestions.push("\u5EFA\u8BAE\u589E\u52A0\u52A8\u4F5C\u63CF\u5199\u548C\u51B2\u7A81\uFF0C\u52A0\u5FEB\u53D9\u4E8B\u8282\u594F");
        suggestions.push("\u53EF\u7F29\u77ED\u53E5\u5B50\u957F\u5EA6\uFF0C\u51CF\u5C11\u5197\u957F\u7684\u73AF\u5883\u63CF\u5199");
      } else if (actualPace === "fast" && this.expectedRhythm !== "fast") {
        suggestions.push("\u5EFA\u8BAE\u9002\u5F53\u653E\u6162\u8282\u594F\uFF0C\u589E\u52A0\u5FC3\u7406\u63CF\u5199\u548C\u73AF\u5883\u94FA\u57AB");
        suggestions.push("\u53EF\u7A7F\u63D2\u4E00\u4E9B\u9759\u6001\u63CF\u5199\u548C\u89D2\u8272\u5185\u5FC3\u6D3B\u52A8");
      }
    } else if (divergenceScore >= 30) {
      suggestions.push("\u8282\u594F\u57FA\u672C\u7B26\u5408\u9884\u671F\uFF0C\u53EF\u6839\u636E\u9700\u8981\u5FAE\u8C03");
    } else {
      suggestions.push("\u8282\u594F\u628A\u63A7\u826F\u597D\uFF0C\u5F20\u5F1B\u6709\u5EA6");
    }
    return {
      score: Math.min(100, Math.max(0, divergenceScore)),
      level: this.getDivergenceLevel(divergenceScore),
      details,
      issues: this.filterIgnored(issues),
      suggestions
    };
  }
  evaluateForeshadow(text) {
    const issues = [];
    const suggestions = [];
    const details = {};
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
      const missingForeshadows = [];
      for (const fs of this.foreshadowToRecover) {
        if (fs.length >= 2 && text.includes(fs)) {
          recovered++;
        } else {
          missingForeshadows.push(fs);
        }
      }
      recoveryScore = Math.round(recovered / this.foreshadowToRecover.length * 100);
      details.toRecover = this.foreshadowToRecover.length;
      details.recovered = recovered;
      if (recoveryScore < 40 && text.length > 1500) {
        issues.push(`\u5E94\u56DE\u6536\u7684\u4F0F\u7B14\u672A\u56DE\u6536\uFF1A${missingForeshadows.slice(0, 3).join("\u3001")}${missingForeshadows.length > 3 ? "..." : ""}`);
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
        issues.push("\u51FA\u73B0\u8F83\u591A\u65B0\u4F0F\u7B14\u57CB\u8BBE\u4FE1\u53F7\uFF0C\u4F46\u672A\u5173\u8054\u5DF2\u6709\u4F0F\u7B14\u7EBF");
      }
    }
    const divergenceScore = Math.round(
      (100 - recoveryScore) * 0.5 + (100 - newForeshadowScore) * 0.5
    );
    if (divergenceScore >= 60) {
      if (this.foreshadowToRecover.length > 0) {
        suggestions.push("\u672C\u7AE0\u8BA1\u5212\u56DE\u6536\u7684\u4F0F\u7B14\u5C1A\u672A\u56DE\u6536\uFF0C\u6CE8\u610F\u5B89\u6392\u56DE\u6536\u65F6\u673A");
      }
      suggestions.push("\u5EFA\u8BAE\u68C0\u67E5\u4F0F\u7B14\u7EBF\u7684\u8FDE\u8D2F\u6027\uFF0C\u907F\u514D\u4F0F\u7B14\u8FC7\u591A\u8FC7\u6742");
    } else if (divergenceScore >= 30) {
      suggestions.push("\u4F0F\u7B14\u8FDB\u5EA6\u57FA\u672C\u6B63\u5E38\uFF0C\u6CE8\u610F\u628A\u63E1\u56DE\u6536\u8282\u594F");
    } else {
      suggestions.push("\u4F0F\u7B14\u57CB\u8BBE\u4E0E\u56DE\u6536\u8282\u594F\u826F\u597D");
    }
    return {
      score: Math.min(100, Math.max(0, divergenceScore)),
      level: this.getDivergenceLevel(divergenceScore),
      details,
      issues: this.filterIgnored(issues),
      suggestions
    };
  }
  evaluateSetting(text) {
    const issues = [];
    const suggestions = [];
    const details = {};
    if (this.settingKeywords.length === 0) {
      details.note = "\u672A\u8BBE\u7F6E\u4E16\u754C\u89C2\u8BBE\u5B9A\u5173\u952E\u8BCD";
      return {
        score: 20,
        level: "normal",
        details,
        issues: [],
        suggestions: ["\u8BBE\u7F6E\u4E16\u754C\u89C2\u5173\u952E\u8BCD\u540E\u53EF\u68C0\u6D4B\u8BBE\u5B9A\u4E00\u81F4\u6027"]
      };
    }
    const detectedSettings = [];
    for (const { pattern, setting } of SETTING_CONTRADICTION_PATTERNS) {
      if (pattern.test(text)) {
        detectedSettings.push(setting);
      }
    }
    details.detectedSettings = detectedSettings.length > 0 ? detectedSettings.join("\u3001") : "\u65E0";
    let settingMatchCount = 0;
    const unmatchedKeywords = [];
    for (const kw of this.settingKeywords) {
      if (kw.length >= 2 && text.includes(kw)) {
        settingMatchCount++;
      } else if (kw.length >= 2) {
        unmatchedKeywords.push(kw);
      }
    }
    const settingCoverage = this.settingKeywords.length > 0 ? Math.round(settingMatchCount / this.settingKeywords.length * 100) : 50;
    details.settingCoverage = settingCoverage + "%";
    details.settingMatched = settingMatchCount + "/" + this.settingKeywords.length;
    let contradictionScore = 0;
    if (detectedSettings.length >= 2) {
      contradictionScore = 60;
      issues.push(`\u68C0\u6D4B\u5230\u591A\u79CD\u4E16\u754C\u89C2\u5143\u7D20\uFF1A${detectedSettings.join("\u3001")}\uFF0C\u53EF\u80FD\u5B58\u5728\u8BBE\u5B9A\u51B2\u7A81`);
    }
    const divergenceScore = Math.round(
      (100 - settingCoverage) * 0.4 + contradictionScore * 0.6
    );
    if (divergenceScore >= 60) {
      if (contradictionScore > 0) {
        suggestions.push("\u5EFA\u8BAE\u68C0\u67E5\u662F\u5426\u51FA\u73B0\u4E86\u4E0E\u4E16\u754C\u89C2\u4E0D\u7B26\u7684\u5143\u7D20");
        suggestions.push("\u4FDD\u6301\u8BBE\u5B9A\u4E00\u81F4\u6027\uFF0C\u907F\u514D\u4E0D\u540C\u4E16\u754C\u89C2\u5143\u7D20\u6DF7\u7528");
      } else {
        suggestions.push("\u4E16\u754C\u89C2\u5143\u7D20\u4F53\u73B0\u4E0D\u8DB3\uFF0C\u5EFA\u8BAE\u589E\u52A0\u8BBE\u5B9A\u76F8\u5173\u63CF\u5199");
      }
    } else if (divergenceScore >= 30) {
      suggestions.push("\u8BBE\u5B9A\u57FA\u672C\u4E00\u81F4\uFF0C\u53EF\u9002\u5F53\u589E\u52A0\u4E16\u754C\u89C2\u5143\u7D20");
    } else {
      suggestions.push("\u4E16\u754C\u89C2\u8BBE\u5B9A\u4E00\u81F4\u6027\u826F\u597D");
    }
    return {
      score: Math.min(100, Math.max(0, divergenceScore)),
      level: this.getDivergenceLevel(divergenceScore),
      details,
      issues: this.filterIgnored(issues),
      suggestions
    };
  }
  checkShouldAlert(overallDivergence, overallLevel, dimensions) {
    const now = Date.now();
    if (overallDivergence > 60) {
      const alertKey = "high_divergence";
      if (!this.isInCooldown(alertKey, now)) {
        this.lastAlertTime[alertKey] = now;
        return { shouldAlert: true, alertReason: `\u5355\u7AE0\u504F\u79BB\u5EA6\u8FC7\u9AD8\uFF08${overallDivergence}%\uFF09\uFF0C\u8BF7\u6CE8\u610F\u5267\u60C5\u8D70\u5411` };
      }
    }
    if (this.divergenceHistory.length >= 2) {
      const recent = this.divergenceHistory.slice(-3);
      let risingCount = 0;
      for (let i = 1; i < recent.length; i++) {
        if (recent[i] > recent[i - 1] + 5) {
          risingCount++;
        }
      }
      if (risingCount >= 2 && overallDivergence > 40) {
        const alertKey = "rising_divergence";
        if (!this.isInCooldown(alertKey, now)) {
          this.lastAlertTime[alertKey] = now;
          return { shouldAlert: true, alertReason: "\u8FDE\u7EED\u591A\u7AE0\u504F\u79BB\u5EA6\u4E0A\u5347\uFF0C\u5EFA\u8BAE\u53CA\u65F6\u8C03\u6574" };
        }
      }
    }
    const highIssues = [];
    const dimMap = {
      "\u4E3B\u7EBF\u504F\u79BB": dimensions.mainlineDivergence,
      "\u89D2\u8272\u504F\u79BB": dimensions.characterDivergence,
      "\u8282\u594F\u504F\u79BB": dimensions.rhythmDivergence,
      "\u4F0F\u7B14\u504F\u79BB": dimensions.foreshadowDivergence,
      "\u8BBE\u5B9A\u504F\u79BB": dimensions.settingDivergence
    };
    for (const [name, dim] of Object.entries(dimMap)) {
      if (dim.score > 70 && dim.issues.length > 0) {
        const issueKey = `${name}_${dim.issues[0].slice(0, 20)}`;
        if (!this.isInCooldown(issueKey, now)) {
          this.lastAlertTime[issueKey] = now;
          highIssues.push(`${name}\uFF1A${dim.issues[0]}`);
        }
      }
    }
    if (highIssues.length > 0) {
      return { shouldAlert: true, alertReason: highIssues[0] };
    }
    return { shouldAlert: false };
  }
  isInCooldown(key, now) {
    const lastTime = this.lastAlertTime[key];
    if (!lastTime)
      return false;
    return now - lastTime < this.ALERT_COOLDOWN_MS;
  }
  ignoreIssue(issueKey) {
    this.ignoredIssues.add(issueKey);
  }
  unignoreIssue(issueKey) {
    this.ignoredIssues.delete(issueKey);
  }
  getIgnoredIssues() {
    return Array.from(this.ignoredIssues);
  }
  filterIgnored(issues) {
    return issues.filter((issue) => {
      const key = issue.slice(0, 30);
      return !this.ignoredIssues.has(key);
    });
  }
  getDivergenceHistory() {
    return [...this.divergenceHistory];
  }
  clearHistory() {
    this.divergenceHistory = [];
  }
  getOppositeTraits(traits) {
    const opposites = {
      "\u51B7\u9759": "\u66B4\u8E81",
      "\u66B4\u8E81": "\u51B7\u9759",
      "\u8C28\u614E": "\u9C81\u83BD",
      "\u9C81\u83BD": "\u8C28\u614E",
      "\u4E50\u89C2": "\u5B64\u50B2",
      "\u5B64\u50B2": "\u4E50\u89C2",
      "\u6E29\u67D4": "\u8179\u9ED1",
      "\u8179\u9ED1": "\u6E29\u67D4"
    };
    return traits.map((t) => opposites[t]).filter(Boolean);
  }
  getPaceLabel(pace) {
    const labels = { fast: "\u5FEB\u8282\u594F", medium: "\u4E2D\u8282\u594F", slow: "\u6162\u8282\u594F" };
    return labels[pace];
  }
  getDivergenceLevel(score) {
    if (score >= 60)
      return "danger";
    if (score >= 30)
      return "warning";
    return "normal";
  }
  extractKeywords(text) {
    const clean = text.replace(/[，。！？、；：""''（）【】\s\n\d]/g, "");
    const keywords = [];
    for (let i = 0; i < clean.length - 1; i++) {
      const bigram = clean.slice(i, i + 2);
      if (!keywords.includes(bigram)) {
        keywords.push(bigram);
      }
    }
    return keywords.slice(0, 50);
  }
  detectSceneShifts(paragraphs) {
    let shifts = 0;
    const shiftIndicators = [
      "\u8F6C\u77AC\u95F4",
      "\u8F6C\u773C\u95F4",
      "\u7247\u523B\u540E",
      "\u4E0D\u4E45\u540E",
      "\u8FC7\u4E86\u4E00\u4F1A\u513F",
      "\u7B2C\u4E8C\u5929",
      "\u6B21\u65E5",
      "\u4E09\u65E5\u540E",
      "\u4E00\u4E2A\u6708\u540E",
      "\u51E0\u5E74\u540E",
      "\u753B\u9762\u4E00\u8F6C",
      "\u955C\u5934\u5207\u6362",
      "\u4E0E\u6B64\u540C\u65F6",
      "\u53E6\u4E00\u8FB9"
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
  splitParagraphs(text) {
    return text.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p.length > 0);
  }
  splitSentences(text) {
    return text.split(/[。！？!?]+/).filter((s) => s.trim().length > 0);
  }
  escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  getEmptyResult(wordCount) {
    const emptyDim = {
      score: 0,
      level: "normal",
      details: { note: "\u5185\u5BB9\u4E0D\u8DB3100\u5B57\uFF0C\u65E0\u6CD5\u68C0\u6D4B" },
      issues: [],
      suggestions: ["\u7EE7\u7EED\u5199\u4F5C\uFF0C\u7CFB\u7EDF\u5C06\u81EA\u52A8\u68C0\u6D4B\u5267\u60C5\u504F\u79BB"]
    };
    return {
      mainlineDivergence: { ...emptyDim, suggestions: ["\u5185\u5BB9\u592A\u77ED\uFF0C\u5F85\u60C5\u8282\u5C55\u5F00\u540E\u53EF\u68C0\u6D4B\u4E3B\u7EBF\u504F\u79BB"] },
      characterDivergence: { ...emptyDim, suggestions: ["\u5185\u5BB9\u592A\u77ED\uFF0C\u5F85\u89D2\u8272\u51FA\u573A\u540E\u53EF\u68C0\u6D4B\u4EBA\u8BBE\u504F\u79BB"] },
      rhythmDivergence: { ...emptyDim, suggestions: ["\u5185\u5BB9\u592A\u77ED\uFF0C\u8282\u594F\u68C0\u6D4B\u5F85\u66F4\u591A\u5185\u5BB9"] },
      foreshadowDivergence: { ...emptyDim, suggestions: ["\u5185\u5BB9\u592A\u77ED\uFF0C\u4F0F\u7B14\u68C0\u6D4B\u5F85\u66F4\u591A\u5185\u5BB9"] },
      settingDivergence: { ...emptyDim, suggestions: ["\u5185\u5BB9\u592A\u77ED\uFF0C\u8BBE\u5B9A\u68C0\u6D4B\u5F85\u66F4\u591A\u5185\u5BB9"] },
      overallDivergence: 0,
      overallLevel: "normal",
      evaluatedAt: Date.now(),
      wordCount,
      shouldAlert: false
    };
  }
};

// engine/quality/quality-worker.ts
var log3 = createLogger("QualityWorker");
var qualityScoreEngine = null;
var deviationDetector = null;
function ensureEngines() {
  if (!qualityScoreEngine) {
    qualityScoreEngine = new QualityScoreEngine({
      characterChecker: new CharacterConsistencyChecker()
    });
    const qe = qualityScoreEngine;
    const qeMissing = ["rhythmAnalyzer", "emotionAnalyzer", "characterChecker"].filter((k) => !qe[k]);
    if (qeMissing.length > 0) {
      log3.warn(
        `[\u8D28\u91CF\u5F15\u64CE] \u6761\u4EF6\u5206\u6790\u5668\u672A\u6CE8\u5165: ${qeMissing.join(", ")}\uFF08\u4F9D\u8D56\u4E3B\u7EBF\u7A0B AI \u80FD\u529B\uFF09\uFF0C\u76F8\u5173\u7EF4\u5EA6\u4F7F\u7528\u5185\u7F6E\u89C4\u5219`
      );
      self.postMessage({
        type: "worker:warning",
        payload: { code: "INJECTION_PARTIAL", engine: "QualityScoreEngine", missing: qeMissing, fallback: "keyword_stats" }
      });
    }
  }
  if (!deviationDetector) {
    deviationDetector = new DeviationDetector({
      plotDivergenceEngine: new PlotDivergenceEngine(),
      characterChecker: new CharacterConsistencyChecker()
    });
    const dd = deviationDetector;
    const ddMissing = ["plotDivergenceEngine", "characterChecker", "rhythmAnalyzer"].filter((k) => !dd[k]);
    if (ddMissing.length > 0) {
      log3.warn(
        `[\u504F\u79BB\u68C0\u6D4B\u5F15\u64CE] \u6761\u4EF6\u5206\u6790\u5668\u672A\u6CE8\u5165: ${ddMissing.join(", ")}\uFF08\u4F9D\u8D56\u4E3B\u7EBF\u7A0B AI \u80FD\u529B\uFF09\uFF0C\u76F8\u5173\u7EF4\u5EA6\u4F7F\u7528\u5185\u7F6E\u89C4\u5219`
      );
      self.postMessage({
        type: "worker:warning",
        payload: { code: "INJECTION_PARTIAL", engine: "DeviationDetector", missing: ddMissing, fallback: "keyword_stats" }
      });
    }
  }
}
registerTaskHandler("quality:evaluate", async (input, context) => {
  context.onProgress(0, "\u5F00\u59CB\u8D28\u91CF\u8BC4\u5206");
  ensureEngines();
  const result = await qualityScoreEngine.evaluate(input.text, input.context);
  context.onProgress(100, "\u8D28\u91CF\u8BC4\u5206\u5B8C\u6210");
  return result;
});
registerTaskHandler("quality:evaluate:realtime", async (input, context) => {
  context.onProgress(0, "\u5F00\u59CB\u5B9E\u65F6\u8D28\u91CF\u8BC4\u5206");
  ensureEngines();
  const result = await qualityScoreEngine.evaluate(input.text, input.context);
  context.onProgress(100, "\u5B9E\u65F6\u8D28\u91CF\u8BC4\u5206\u5B8C\u6210");
  return result;
});
registerTaskHandler("deviation:detect", async (input, context) => {
  context.onProgress(0, "\u5F00\u59CB\u504F\u79BB\u68C0\u6D4B");
  ensureEngines();
  const result = await deviationDetector.detect(input.text, input.context);
  context.onProgress(100, "\u504F\u79BB\u68C0\u6D4B\u5B8C\u6210");
  return result;
});
registerTaskHandler("deviation:detect:realtime", async (input, context) => {
  context.onProgress(0, "\u5F00\u59CB\u5B9E\u65F6\u504F\u79BB\u68C0\u6D4B");
  ensureEngines();
  const result = await deviationDetector.detect(input.text, input.context);
  context.onProgress(100, "\u5B9E\u65F6\u504F\u79BB\u68C0\u6D4B\u5B8C\u6210");
  return result;
});
startWorkerRuntime();
