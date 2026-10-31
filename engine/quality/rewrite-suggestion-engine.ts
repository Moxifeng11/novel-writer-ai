/**
 * quality/rewrite-suggestion-engine.ts — 智能改写建议引擎（实时监控 V2 Task 4）
 *
 * 职责：
 *   1. 基于 AI 生成或规则降级，提供 6 类改写建议
 *   2. 支持 4 种触发场景（光标停留/选中文本/预警点击/低分配方）
 *   3. 每次生成 2-3 个改写方案
 *   4. 支持取消（AbortSignal）
 *   5. AI 失败时降级为规则建议
 *   6. 结果缓存（复用 LruCache）
 *
 * 设计原则：
 *   - 零外部依赖（AIEngine 通过接口注入）
 *   - 与现有引擎零耦合
 *   - 向后兼容：不修改任何现有代码
 */

import { LruCache } from '../../shared/lru-cache';
import type {
  SuggestionType,
  RewriteContext,
  RewriteResult,
  RewriteSuggestion,
  RewriteSuggestionEngineOptions,
  RewriteStreamHandler,
} from './rewrite-types';
import { SUGGESTION_TYPES, SUGGESTION_TYPE_LABELS, SUGGESTION_TYPE_DESC } from './rewrite-types';
import {
  buildSystemPrompt,
  buildUserPrompt,
  buildAutoTypePrompt,
  AUTO_TYPE_DETECTION_SYSTEM,
  extractJSONFromResponse,
} from './rewrite-prompts';

// ============================================================
// 一、引擎状态
// ============================================================

export type RewriteEngineState = 'idle' | 'generating' | 'success' | 'failed' | 'cancelled';

// ============================================================
// 二、RewriteSuggestionEngine 实现
// ============================================================

export class RewriteSuggestionEngine {
  private readonly aiEngine?: RewriteSuggestionEngineOptions['aiEngine'];
  private readonly maxSuggestions: number;
  private readonly cache: LruCache<string, RewriteResult>;
  private state: RewriteEngineState = 'idle';
  private currentAbort?: AbortController;

  constructor(options: RewriteSuggestionEngineOptions = {}) {
    this.aiEngine = options.aiEngine;
    this.maxSuggestions = Math.min(5, Math.max(1, options.maxSuggestions ?? 3));
    this.cache = new LruCache<string, RewriteResult>({
      maxSize: options.cacheSize ?? 30,
      ttlMs: options.cacheTtlMs ?? 5 * 60 * 1000,
    });
  }

  // ----------------------------------------------------------
  // 状态查询
  // ----------------------------------------------------------

  getState(): RewriteEngineState {
    return this.state;
  }

  isGenerating(): boolean {
    return this.state === 'generating';
  }

  // ----------------------------------------------------------
  // 主入口：生成改写建议
  // ----------------------------------------------------------

  /**
   * 生成改写建议（批量模式）
   * @param context 改写上下文
   * @param signal 取消信号
   * @returns 改写结果
   */
  async generate(context: RewriteContext, signal?: AbortSignal): Promise<RewriteResult> {
    if (this.state === 'generating') {
      throw new Error('busy: rewrite engine is already generating');
    }

    const requestId = this.buildRequestId(context);
    const startTime = Date.now();

    // 检查缓存
    const cached = this.cache.get(requestId);
    if (cached) {
      return { ...cached, durationMs: Date.now() - startTime };
    }

    // 内容过短直接返回空
    if (context.text.trim().length < 10) {
      return this.buildEmptyResult(context, startTime);
    }

    // 创建内部 AbortController
    const internalAbort = new AbortController();
    this.currentAbort = internalAbort;

    if (signal) {
      if (signal.aborted) {
        return this.buildCancelledResult(context, startTime);
      }
      signal.addEventListener('abort', () => internalAbort.abort(), { once: true });
    }

    this.state = 'generating';

    try {
      // 1. 确定改写类型（若未指定）
      const suggestionType = context.suggestionType ?? await this.detectType(context, internalAbort.signal);

      this.throwIfAborted(internalAbort.signal);

      // 2. 构建 Prompt
      const systemPrompt = buildSystemPrompt(suggestionType);
      const userPrompt = this.buildPromptFromContext(context, suggestionType);

      // 3. 调用 AI 或降级
      let suggestions: RewriteSuggestion[];
      let isFallback = false;
      let fallbackReason: string | undefined;

      if (this.aiEngine) {
        try {
          const aiSuggestions = await this.callAI(systemPrompt, userPrompt, suggestionType, context, internalAbort.signal);
          suggestions = aiSuggestions;
          if (suggestions.length === 0) {
            // AI 返回空，降级
            suggestions = this.generateFallbackSuggestions(context, suggestionType);
            isFallback = true;
            fallbackReason = 'AI 返回空结果';
          }
        } catch (e) {
          if (this.isAbortError(e)) {
            throw e;
          }
          suggestions = this.generateFallbackSuggestions(context, suggestionType);
          isFallback = true;
          fallbackReason = `AI 调用失败: ${(e as Error)?.message || String(e)}`;
        }
      } else {
        suggestions = this.generateFallbackSuggestions(context, suggestionType);
        isFallback = true;
        fallbackReason = '未配置 AI 引擎';
      }

      this.throwIfAborted(internalAbort.signal);

      const result: RewriteResult = {
        requestId,
        trigger: context.trigger,
        suggestionType,
        suggestions: suggestions.slice(0, this.maxSuggestions),
        isFallback,
        fallbackReason,
        durationMs: Date.now() - startTime,
        timestamp: Date.now(),
      };

      this.cache.set(requestId, result);
      this.state = 'success';
      this.cleanup();
      return result;

    } catch (e) {
      if (this.isAbortError(e)) {
        this.state = 'cancelled';
        this.cleanup();
        return this.buildCancelledResult(context, startTime);
      }
      this.state = 'failed';
      this.cleanup();
      throw e;
    }
  }

  /**
   * 生成改写建议（流式模式）
   * @param context 改写上下文
   * @param handler 流式事件处理器
   * @param signal 取消信号
   */
  async generateStream(
    context: RewriteContext,
    handler: RewriteStreamHandler,
    signal?: AbortSignal
  ): Promise<RewriteResult> {
    // 流式模式复用批量模式（当前版本简化实现）
    // 后续可扩展为真正的流式生成
    handler({ type: 'start', timestamp: Date.now() });

    try {
      const result = await this.generate(context, signal);

      for (let i = 0; i < result.suggestions.length; i++) {
        handler({
          type: 'suggestion',
          suggestionIndex: i,
          suggestion: result.suggestions[i],
          timestamp: Date.now(),
        });
      }

      handler({ type: 'complete', timestamp: Date.now() });
      return result;
    } catch (e) {
      if (this.isAbortError(e)) {
        handler({ type: 'cancelled', timestamp: Date.now() });
        return this.buildCancelledResult(context, Date.now());
      }
      handler({ type: 'error', error: String(e), timestamp: Date.now() });
      throw e;
    }
  }

  // ----------------------------------------------------------
  // 取消
  // ----------------------------------------------------------

  cancel(): void {
    if (this.currentAbort) {
      this.currentAbort.abort();
    }
  }

  // ----------------------------------------------------------
  // 缓存管理
  // ----------------------------------------------------------

  clearCache(): void {
    this.cache.clear();
  }

  // ----------------------------------------------------------
  // 类型自动检测
  // ----------------------------------------------------------

  private async detectType(context: RewriteContext, signal: AbortSignal): Promise<SuggestionType> {
    // 优先根据触发场景判断
    if (context.deviationIssue) {
      const type = this.mapDeviationToType(context.deviationIssue.type);
      if (type) return type;
    }

    if (context.qualityScore && context.qualityScore.score < 60) {
      const type = this.mapDimensionToType(context.qualityScore.dimension);
      if (type) return type;
    }

    // 使用 AI 自动判断（若可用）
    if (this.aiEngine) {
      try {
        const prompt = buildAutoTypePrompt(
          context.text,
          context.fullText
        );
        const response = await this.aiEngine.callAI(
          AUTO_TYPE_DETECTION_SYSTEM,
          prompt,
          { signal }
        );
        const detected = response.content.trim().toLowerCase();
        if (SUGGESTION_TYPES.includes(detected as SuggestionType)) {
          return detected as SuggestionType;
        }
      } catch {
        // 降级到启发式判断
      }
    }

    // 启发式判断
    return this.heuristicTypeDetection(context.text);
  }

  private mapDeviationToType(deviationType: string): SuggestionType | null {
    const map: Record<string, SuggestionType> = {
      mainline: 'logic',
      characterOOC: 'character',
      contradiction: 'logic',
      foreshadowForgot: 'logic',
      rhythm: 'rhythm',
      emotionBreak: 'expand',
    };
    return map[deviationType] || null;
  }

  private mapDimensionToType(dimension: string): SuggestionType | null {
    const map: Record<string, SuggestionType> = {
      readability: 'polish',
      rhythm: 'rhythm',
      emotion: 'expand',
      characterConsistency: 'character',
      coherence: 'logic',
      languageTexture: 'polish',
    };
    return map[dimension] || null;
  }

  private heuristicTypeDetection(text: string): SuggestionType {
    const t = text.trim();
    const len = t.length;

    // 过短 → 扩写
    if (len < 50) return 'expand';

    // 过长且重复词多 → 缩写
    const sentences = t.split(/[。！？!?]+/).filter((s) => s.trim().length > 0);
    if (len > 300 && sentences.length > 0) {
      const avgLen = len / sentences.length;
      if (avgLen > 60) return 'condense';
    }

    // 检测是否有对话 → 人物校准
    if (/[\"\'\「\『].*?[\"\'\」\』]/s.test(t)) {
      return 'character';
    }

    // 默认润色
    return 'polish';
  }

  // ----------------------------------------------------------
  // AI 调用
  // ----------------------------------------------------------

  private async callAI(
    systemPrompt: string,
    userPrompt: string,
    suggestionType: SuggestionType,
    context: RewriteContext,
    signal: AbortSignal
  ): Promise<RewriteSuggestion[]> {
    if (!this.aiEngine) return [];

    const response = await this.aiEngine.callAI(systemPrompt, userPrompt, { signal });
    const items = extractJSONFromResponse(response.content);

    const suggestions: RewriteSuggestion[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i] as Record<string, unknown>;
      if (typeof item !== 'object' || item === null) continue;

      const rewrittenText = String(item['rewrittenText'] || item['text'] || '');
      if (!rewrittenText || rewrittenText.trim().length === 0) continue;

      suggestions.push({
        id: `${suggestionType}_${i}_${Date.now()}`,
        type: suggestionType,
        title: String(item['title'] || `${SUGGESTION_TYPE_LABELS[suggestionType]}方案 ${i + 1}`),
        rewrittenText,
        originalText: context.text,
        description: String(item['description'] || SUGGESTION_TYPE_DESC[suggestionType]),
        location: {
          start: context.textStartOffset,
          end: context.textStartOffset + context.text.length,
        },
        confidence: Math.min(1, Math.max(0, Number(item['confidence']) || 0.7)),
      });
    }

    return suggestions;
  }

  // ----------------------------------------------------------
  // Prompt 构建
  // ----------------------------------------------------------

  private buildPromptFromContext(context: RewriteContext, type: SuggestionType): string {
    const preceding = context.fullText
      ? context.fullText.slice(0, context.textStartOffset)
      : undefined;
    const following = context.fullText
      ? context.fullText.slice(context.textStartOffset + context.text.length)
      : undefined;

    const characterInfos = context.characterInfos
      ? context.characterInfos
          .map((c) => `${c.name}：${c.personality || ''} ${c.appearance || ''}`.trim())
          .join('\n')
      : undefined;

    return buildUserPrompt({
      text: context.text,
      type,
      precedingContext: preceding,
      followingContext: following,
      characterInfos,
      chapterOutline: context.chapterOutline,
      lowScoreDimension: context.qualityScore?.dimension,
      deviationDescription: context.deviationIssue?.description,
    });
  }

  // ----------------------------------------------------------
  // 降级：规则建议
  // ----------------------------------------------------------

  private generateFallbackSuggestions(
    context: RewriteContext,
    type: SuggestionType
  ): RewriteSuggestion[] {
    const text = context.text;
    const suggestions: RewriteSuggestion[] = [];

    switch (type) {
      case 'polish':
        suggestions.push(this.buildFallbackSuggestion(type, text, context, '用词优化', this.fallbackPolish(text)));
        break;
      case 'expand':
        suggestions.push(this.buildFallbackSuggestion(type, text, context, '细节扩充', this.fallbackExpand(text)));
        break;
      case 'condense':
        suggestions.push(this.buildFallbackSuggestion(type, text, context, '精简表达', this.fallbackCondense(text)));
        break;
      case 'rhythm':
        suggestions.push(this.buildFallbackSuggestion(type, text, context, '节奏调整', this.fallbackRhythm(text)));
        break;
      case 'character':
        suggestions.push(this.buildFallbackSuggestion(type, text, context, '人物校准', this.fallbackCharacter(text, context)));
        break;
      case 'logic':
        suggestions.push(this.buildFallbackSuggestion(type, text, context, '逻辑补全', this.fallbackLogic(text)));
        break;
    }

    return suggestions;
  }

  private buildFallbackSuggestion(
    type: SuggestionType,
    originalText: string,
    context: RewriteContext,
    title: string,
    rewrittenText: string
  ): RewriteSuggestion {
    return {
      id: `fallback_${type}_${Date.now()}`,
      type,
      title: `【规则建议】${title}`,
      rewrittenText,
      originalText,
      description: `基于规则生成的 ${SUGGESTION_TYPE_LABELS[type]} 建议（AI 不可用时的降级方案）`,
      location: {
        start: context.textStartOffset,
        end: context.textStartOffset + originalText.length,
      },
      confidence: 0.5,
    };
  }

  // ── 各类型的规则降级实现 ──

  private fallbackPolish(text: string): string {
    // 简单润色：替换常见平庸词汇
    return text
      .replace(/非常/g, '格外')
      .replace(/很/g, '颇')
      .replace(/说/g, '道')
      .replace(/走/g, '迈步')
      .replace(/看/g, '望');
  }

  private fallbackExpand(text: string): string {
    // 简单扩写：在句末增加感官描写提示
    const sentences = text.split(/([。！？!?])/);
    const expanded: string[] = [];
    for (let i = 0; i < sentences.length; i += 2) {
      const sentence = sentences[i];
      const punct = sentences[i + 1] || '';
      if (sentence.trim().length > 0) {
        expanded.push(sentence + punct);
        if (i < sentences.length - 2 && Math.random() > 0.5) {
          expanded.push('（此处可增加心理活动或感官描写）');
        }
      }
    }
    return expanded.join('');
  }

  private fallbackCondense(text: string): string {
    // 简单缩写：删除冗余修饰
    return text
      .replace(/的/g, '')
      .replace(/了/g, '')
      .replace(/着/g, '');
  }

  private fallbackRhythm(text: string): string {
    // 简单节奏调整：长短句交替提示
    const sentences = text.split(/([。！？!?])/);
    const adjusted: string[] = [];
    for (let i = 0; i < sentences.length; i += 2) {
      const sentence = sentences[i];
      const punct = sentences[i + 1] || '';
      if (sentence.trim().length > 0) {
        if (i % 4 === 0 && sentence.length > 20) {
          adjusted.push('【建议拆分为短句以增加节奏感】' + sentence + punct);
        } else {
          adjusted.push(sentence + punct);
        }
      }
    }
    return adjusted.join('');
  }

  private fallbackCharacter(text: string, context: RewriteContext): string {
    // 简单人物校准：添加校准提示
    const chars = context.characterInfos?.map((c) => c.name).join('、') || '角色';
    return `${text}\n\n【人物校准提示】请检查 ${chars} 的行为和对话是否符合其性格设定。`;
  }

  private fallbackLogic(text: string): string {
    // 简单逻辑补全：添加过渡提示
    return `【建议补充过渡】${text}\n\n【逻辑检查】请检查此处是否需要添加因果过渡或时间/空间转换的衔接。`;
  }

  // ----------------------------------------------------------
  // 工具方法
  // ----------------------------------------------------------

  private buildRequestId(context: RewriteContext): string {
    const hash = this.hashText(context.text);
    return `${context.projectId}::${context.chapterId}::${context.suggestionType || 'auto'}::${hash}`;
  }

  private hashText(text: string): string {
    let hash = 5381;
    for (let i = 0; i < text.length; i++) {
      hash = ((hash << 5) + hash + text.charCodeAt(i)) & 0x7fffffff;
    }
    return hash.toString(36);
  }

  private buildEmptyResult(context: RewriteContext, startTime: number): RewriteResult {
    return {
      requestId: this.buildRequestId(context),
      trigger: context.trigger,
      suggestionType: context.suggestionType || 'polish',
      suggestions: [],
      isFallback: false,
      durationMs: Date.now() - startTime,
      timestamp: Date.now(),
    };
  }

  private buildCancelledResult(context: RewriteContext, startTime: number): RewriteResult {
    return {
      requestId: this.buildRequestId(context),
      trigger: context.trigger,
      suggestionType: context.suggestionType || 'polish',
      suggestions: [],
      isFallback: false,
      durationMs: Date.now() - startTime,
      timestamp: Date.now(),
    };
  }

  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw new DOMException('改写建议生成已取消', 'AbortError');
    }
  }

  private isAbortError(e: unknown): boolean {
    if (!e) return false;
    if (e instanceof Error && (e.name === 'AbortError' || e.message.includes('abort'))) {
      return true;
    }
    return false;
  }

  private cleanup(): void {
    this.currentAbort = undefined;
  }
}

// ============================================================
// 三、辅助函数导出
// ============================================================

export { SUGGESTION_TYPES, SUGGESTION_TYPE_LABELS, SUGGESTION_TYPE_DESC };
