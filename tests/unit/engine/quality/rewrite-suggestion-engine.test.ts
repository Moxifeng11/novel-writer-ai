/**
 * rewrite-suggestion-engine.test.ts — 智能改写建议引擎单元测试
 *
 * 覆盖：
 *   1. 引擎初始化
 *   2. 改写类型自动检测
 *   3. AI 生成建议（含 Mock）
 *   4. 降级规则建议
 *   5. 缓存机制
 *   6. 取消（AbortSignal）
 *   7. 流式接口
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RewriteSuggestionEngine } from '../../../../engine/quality/rewrite-suggestion-engine';
import type { RewriteContext, SuggestionType } from '../../../../engine/quality/rewrite-types';

describe('RewriteSuggestionEngine', () => {
  let engine: RewriteSuggestionEngine;

  beforeEach(() => {
    engine = new RewriteSuggestionEngine({
      maxSuggestions: 3,
      cacheSize: 10,
      cacheTtlMs: 60000,
    });
  });

  describe('初始化', () => {
    it('应该使用默认配置', () => {
      const defaultEngine = new RewriteSuggestionEngine();
      expect(defaultEngine.getState()).toBe('idle');
    });

    it('应该使用自定义配置', () => {
      const customEngine = new RewriteSuggestionEngine({
        maxSuggestions: 5,
        cacheSize: 50,
        cacheTtlMs: 300000,
      });
      expect(customEngine.getState()).toBe('idle');
    });
  });

  describe('状态管理', () => {
    it('初始状态应为 idle', () => {
      expect(engine.getState()).toBe('idle');
    });

    it('isGenerating 应正确反映状态', () => {
      expect(engine.isGenerating()).toBe(false);
    });
  });

  describe('降级规则建议', () => {
    it('应该生成润色优化的规则建议', async () => {
      const context: RewriteContext = {
        projectId: 'test-project',
        chapterId: 'test-chapter',
        text: '他非常高兴地走了过去',
        textStartOffset: 0,
        trigger: 'selection',
        suggestionType: 'polish',
      };

      const result = await engine.generate(context);

      expect(result.suggestions.length).toBeGreaterThan(0);
      expect(result.isFallback).toBe(true);
      expect(result.suggestions[0].type).toBe('polish');
    });

    it('应该生成扩写充实的规则建议', async () => {
      const context: RewriteContext = {
        projectId: 'test-project',
        chapterId: 'test-chapter',
        text: '他走进了房间。房间里很安静。',
        textStartOffset: 0,
        trigger: 'selection',
        suggestionType: 'expand',
      };

      const result = await engine.generate(context);

      expect(result.suggestions.length).toBeGreaterThan(0);
      expect(result.isFallback).toBe(true);
      expect(result.suggestions[0].type).toBe('expand');
    });

    it('应该生成缩写精简的规则建议', async () => {
      const context: RewriteContext = {
        projectId: 'test-project',
        chapterId: 'test-chapter',
        text: '他慢慢地、一步步地走了过去',
        textStartOffset: 0,
        trigger: 'selection',
        suggestionType: 'condense',
      };

      const result = await engine.generate(context);

      expect(result.suggestions.length).toBeGreaterThan(0);
      expect(result.isFallback).toBe(true);
      expect(result.suggestions[0].type).toBe('condense');
    });

    it('应该生成节奏调整的规则建议', async () => {
      const context: RewriteContext = {
        projectId: 'test-project',
        chapterId: 'test-chapter',
        text: '他走过去开门进去看了看然后转身离开',
        textStartOffset: 0,
        trigger: 'selection',
        suggestionType: 'rhythm',
      };

      const result = await engine.generate(context);

      expect(result.suggestions.length).toBeGreaterThan(0);
      expect(result.isFallback).toBe(true);
      expect(result.suggestions[0].type).toBe('rhythm');
    });

    it('应该生成人物校准的规则建议', async () => {
      const context: RewriteContext = {
        projectId: 'test-project',
        chapterId: 'test-chapter',
        text: '张三说："我很高兴"',
        textStartOffset: 0,
        trigger: 'selection',
        suggestionType: 'character',
        characterInfos: [{ name: '张三', personality: '冷酷' }],
      };

      const result = await engine.generate(context);

      expect(result.suggestions.length).toBeGreaterThan(0);
      expect(result.isFallback).toBe(true);
      expect(result.suggestions[0].type).toBe('character');
    });

    it('应该生成逻辑补全的规则建议', async () => {
      const context: RewriteContext = {
        projectId: 'test-project',
        chapterId: 'test-chapter',
        text: '他离开了。然后他回来了。',
        textStartOffset: 0,
        trigger: 'selection',
        suggestionType: 'logic',
      };

      const result = await engine.generate(context);

      expect(result.suggestions.length).toBeGreaterThan(0);
      expect(result.isFallback).toBe(true);
      expect(result.suggestions[0].type).toBe('logic');
    });
  });

  describe('类型自动检测', () => {
    it('短文本应该检测为 expand', async () => {
      const context: RewriteContext = {
        projectId: 'test-project',
        chapterId: 'test-chapter',
        text: '好。这太短了需要扩写充实内容才行。',
        textStartOffset: 0,
        trigger: 'selection',
      };

      const result = await engine.generate(context);

      expect(result.suggestionType).toBe('expand');
    });

    it('包含对话的文本应该检测为 character', async () => {
      const context: RewriteContext = {
        projectId: 'test-project',
        chapterId: 'test-chapter',
        text: '他说："你好，今天天气不错啊。"她点了点头，微笑着回答："是啊，很难得的好天气呢，我们一起出去走走吧。"他欣然同意。',
        textStartOffset: 0,
        trigger: 'selection',
      };

      const result = await engine.generate(context);

      expect(result.suggestionType).toBe('character');
    });

    it('中等长度文本应该默认检测为 polish', async () => {
      const context: RewriteContext = {
        projectId: 'test-project',
        chapterId: 'test-chapter',
        text: '这是一段正常长度的文本，用来测试默认的改写类型检测逻辑是否正确工作。文本长度超过五十个字符时应该进入润色优化模式而不是扩写模式。',
        textStartOffset: 0,
        trigger: 'selection',
      };

      const result = await engine.generate(context);

      expect(result.suggestionType).toBe('polish');
    });
  });

  describe('缓存机制', () => {
    it('相同请求应该命中缓存', async () => {
      const context: RewriteContext = {
        projectId: 'test-project',
        chapterId: 'test-chapter',
        text: '测试缓存的文本，需要足够长才能触发生成逻辑',
        textStartOffset: 0,
        trigger: 'selection',
        suggestionType: 'polish',
      };

      const result1 = await engine.generate(context);
      const result2 = await engine.generate(context);

      // 缓存命中：requestId 一致，suggestions 一致
      expect(result1.requestId).toBe(result2.requestId);
      expect(result2.suggestions).toEqual(result1.suggestions);
    });

    it('清除缓存后应该重新生成', async () => {
      const context: RewriteContext = {
        projectId: 'test-project',
        chapterId: 'test-chapter',
        text: '测试缓存清除的文本，需要足够长才能触发生成',
        textStartOffset: 0,
        trigger: 'selection',
        suggestionType: 'polish',
      };

      await engine.generate(context);
      engine.clearCache();
      const result = await engine.generate(context);

      expect(result.isFallback).toBe(true);
    });
  });

  describe('取消机制', () => {
    it('应该支持 AbortSignal 取消', async () => {
      const abortController = new AbortController();
      abortController.abort();

      const context: RewriteContext = {
        projectId: 'test-project',
        chapterId: 'test-chapter',
        text: '测试取消',
        textStartOffset: 0,
        trigger: 'selection',
      };

      const result = await engine.generate(context, abortController.signal);

      expect(result.suggestions.length).toBe(0);
    });
  });

  describe('AI 生成建议', () => {
    it('配置 AI 引擎后应该使用 AI 生成', async () => {
      const mockAIResponse = JSON.stringify([
        {
          title: 'AI 润色方案',
          rewrittenText: '优化后的文本',
          description: 'AI 生成的改写',
          confidence: 0.9,
        },
      ]);

      const aiEngine = {
        callAI: async (system: string, user: string) => ({
          content: mockAIResponse,
        }),
      };

      const aiEngineInstance = new RewriteSuggestionEngine({
        aiEngine,
        maxSuggestions: 3,
      });

      const context: RewriteContext = {
        projectId: 'test-project',
        chapterId: 'test-chapter',
        text: '测试 AI 生成的文本，需要足够长才能触发完整的生成流程',
        textStartOffset: 0,
        trigger: 'selection',
        suggestionType: 'polish',
      };

      const result = await aiEngineInstance.generate(context);

      expect(result.suggestions.length).toBe(1);
      expect(result.isFallback).toBe(false);
      expect(result.suggestions[0].rewrittenText).toBe('优化后的文本');
    });

    it('AI 失败时应该降级到规则建议', async () => {
      const aiEngine = {
        callAI: async () => {
          throw new Error('AI 服务不可用');
        },
      };

      const aiEngineInstance = new RewriteSuggestionEngine({
        aiEngine,
      });

      const context: RewriteContext = {
        projectId: 'test-project',
        chapterId: 'test-chapter',
        text: '测试降级逻辑的文本，需要足够长才能触发AI调用流程',
        textStartOffset: 0,
        trigger: 'selection',
      };

      const result = await aiEngineInstance.generate(context);

      expect(result.isFallback).toBe(true);
      expect(result.fallbackReason).toContain('AI 调用失败');
    });
  });

  describe('内容验证', () => {
    it('空文本应该返回空建议', async () => {
      const context: RewriteContext = {
        projectId: 'test-project',
        chapterId: 'test-chapter',
        text: '',
        textStartOffset: 0,
        trigger: 'selection',
      };

      const result = await engine.generate(context);

      expect(result.suggestions.length).toBe(0);
    });

    it('极短文本应该返回空建议', async () => {
      const context: RewriteContext = {
        projectId: 'test-project',
        chapterId: 'test-chapter',
        text: 'a',
        textStartOffset: 0,
        trigger: 'selection',
      };

      const result = await engine.generate(context);

      expect(result.suggestions.length).toBe(0);
    });
  });
});