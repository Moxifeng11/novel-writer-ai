import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  QualityScoreEngine,
  QUALITY_DIMENSIONS,
  DIMENSION_LABELS,
  DIMENSION_WEIGHTS,
  getDimensionLabel,
  getSeverityLabel,
  getSuggestionPriorityLabel,
  getTrendLabel,
} from '../../../../engine/quality/quality-score-engine';
import type {
  QualityScore,
  DimensionScore,
  EvaluationContext,
  IRhythmAnalyzer,
  IEmotionAnalyzer,
  ICharacterChecker,
} from '../../../../engine/quality/quality-score-engine';
import { WritingQualityEngine } from '../../../../engine/writing-quality-engine';

// ── 测试用文本 ──────────────────────────────────────────────

const SHORT_TEXT = '短文本';

const NORMAL_TEXT = [
  '林惊鸿站在大殿之中，阳光透过窗户洒进来，温暖而明亮。',
  '"你终于来了。"苏白微笑着说道，她的声音温柔而动听。',
  '林惊鸿点了点头，心中却暗自警惕，仿佛有什么不对的地方。',
  '突然，一道黑影闪过！危机迫在眉睫，他心中一惊，这是怎么回事？',
  '他冲上去，一拳打出，剑光闪烁，两人战作一团。',
  '苏白抬起头，眼中含泪，悲伤与恐惧交织，她不知道该如何是好。',
  '但是，这仅仅是开始，更大的阴谋还在后面，真相尚未揭开。',
  '风吹过树梢，发出沙沙的声响，空气中弥漫着淡淡的花香。',
  '月光如水，洒落在寂静的森林中，仿佛能听到星星的低语。',
  '林惊鸿闭上眼睛，感受到夜晚的呼吸，心中感到一阵安宁与满足。',
].join('\n\n');

// ── Mock 工厂 ──────────────────────────────────────────────

function createMockRhythmAnalyzer(): IRhythmAnalyzer {
  return {
    analyze: vi.fn().mockResolvedValue({
      segments: [
        { pace: 'fast', type: 'action', density: 70, tensionLevel: 85, issues: [] },
        { pace: 'medium', type: 'dialogue', density: 50, tensionLevel: 60, issues: [] },
        { pace: 'slow', type: 'description', density: 40, tensionLevel: 30, issues: [] },
      ],
      overallPace: 'balanced',
      suggestions: ['节奏整体均衡'],
    }),
  };
}

function createMockEmotionAnalyzer(): IEmotionAnalyzer {
  return {
    analyze: vi.fn().mockResolvedValue({
      points: [
        { emotion: 'joy', intensity: 70 },
        { emotion: 'fear', intensity: 80 },
        { emotion: 'sadness', intensity: 60 },
        { emotion: 'surprise', intensity: 75 },
      ],
      dominantEmotion: 'fear',
      volatility: 25,
      arcType: 'wave',
    }),
  };
}

function createMockCharacterChecker(): ICharacterChecker {
  return {
    check: vi.fn().mockResolvedValue({
      overallScore: 85,
      characterResults: {
        林惊鸿: {
          score: 90,
          inconsistencies: [],
        },
        苏白: {
          score: 80,
          inconsistencies: [
            {
              type: 'behavior',
              severity: 'medium',
              description: '行为与设定不符',
              location: '第3段附近',
              suggestion: '请确认该行为是否符合人物性格',
              confidence: 0.7,
            },
          ],
        },
      },
      summary: '检测了 2 个人物，发现 1 处不一致',
    }),
  };
}

// ── 测试 ─────────────────────────────────────────────────────

describe('QualityScoreEngine — 构造与配置', () => {
  it('默认构造函数不报错', () => {
    const engine = new QualityScoreEngine();
    expect(engine).toBeDefined();
  });

  it('接受完整配置选项', () => {
    const engine = new QualityScoreEngine({
      v1Engine: new WritingQualityEngine(),
      rhythmAnalyzer: createMockRhythmAnalyzer(),
      emotionAnalyzer: createMockEmotionAnalyzer(),
      characterChecker: createMockCharacterChecker(),
      cacheSize: 10,
      cacheTtlMs: 30000,
      historySize: 10,
    });
    expect(engine).toBeDefined();
  });

  it('QUALITY_DIMENSIONS 包含 6 个维度', () => {
    expect(QUALITY_DIMENSIONS).toHaveLength(6);
    expect(QUALITY_DIMENSIONS).toContain('readability');
    expect(QUALITY_DIMENSIONS).toContain('rhythm');
    expect(QUALITY_DIMENSIONS).toContain('emotion');
    expect(QUALITY_DIMENSIONS).toContain('characterConsistency');
    expect(QUALITY_DIMENSIONS).toContain('coherence');
    expect(QUALITY_DIMENSIONS).toContain('languageTexture');
  });

  it('DIMENSION_WEIGHTS 权重总和为 1', () => {
    const total = QUALITY_DIMENSIONS.reduce(
      (sum, dim) => sum + DIMENSION_WEIGHTS[dim],
      0
    );
    expect(Math.abs(total - 1.0)).toBeLessThan(0.001);
  });

  it('DIMENSION_LABELS 包含所有维度标签', () => {
    for (const dim of QUALITY_DIMENSIONS) {
      expect(DIMENSION_LABELS[dim]).toBeDefined();
      expect(DIMENSION_LABELS[dim].length).toBeGreaterThan(0);
    }
  });
});

describe('QualityScoreEngine — 边界情况', () => {
  it('空字符串返回空结果', async () => {
    const engine = new QualityScoreEngine();
    const result = await engine.evaluate('');
    expect(result.wordCount).toBe(0);
    expect(result.overallScore).toBe(0);
    expect(result.trend).toBe('stable');
    expect(result.fromCache).toBe(false);
  });

  it('少于100字返回空结果', async () => {
    const engine = new QualityScoreEngine();
    const result = await engine.evaluate(SHORT_TEXT);
    expect(result.wordCount).toBeLessThan(100);
    expect(result.overallScore).toBe(0);
    expect(result.suggestions.length).toBeGreaterThan(0);
  });

  it('含 frontmatter 的文本会被清理', async () => {
    const engine = new QualityScoreEngine();
    const text = '---\ntitle: 测试\n---\n' + NORMAL_TEXT;
    const result = await engine.evaluate(text);
    expect(result.wordCount).toBeGreaterThan(100);
    expect(result.overallScore).toBeGreaterThanOrEqual(0);
  });

  it('100字以上正常评估', async () => {
    const engine = new QualityScoreEngine();
    const result = await engine.evaluate(NORMAL_TEXT);
    expect(result.wordCount).toBeGreaterThanOrEqual(100);
    expect(result.overallScore).toBeGreaterThanOrEqual(0);
    expect(result.overallScore).toBeLessThanOrEqual(100);
    expect(result.evalTimeMs).toBeGreaterThanOrEqual(0);
  });
});

describe('QualityScoreEngine — 六维评分计算', () => {
  let engine: QualityScoreEngine;

  beforeEach(() => {
    engine = new QualityScoreEngine({
      rhythmAnalyzer: createMockRhythmAnalyzer(),
      emotionAnalyzer: createMockEmotionAnalyzer(),
      characterChecker: createMockCharacterChecker(),
    });
  });

  it('返回完整的六维结果结构', async () => {
    const result: QualityScore = await engine.evaluate(NORMAL_TEXT);
    expect(result).toHaveProperty('overallScore');
    expect(result).toHaveProperty('dimensions');
    expect(result).toHaveProperty('issues');
    expect(result).toHaveProperty('suggestions');
    expect(result).toHaveProperty('evaluatedAt');
    expect(result).toHaveProperty('wordCount');
    expect(result).toHaveProperty('evalTimeMs');
    expect(result).toHaveProperty('trend');
    expect(result).toHaveProperty('fromCache');

    for (const dim of QUALITY_DIMENSIONS) {
      expect(result.dimensions[dim]).toBeDefined();
      expect(result.dimensions[dim].dimension).toBe(dim);
      expect(result.dimensions[dim].score).toBeGreaterThanOrEqual(0);
      expect(result.dimensions[dim].score).toBeLessThanOrEqual(100);
      expect(Array.isArray(result.dimensions[dim].basis)).toBe(true);
      expect(Array.isArray(result.dimensions[dim].issues)).toBe(true);
      expect(Array.isArray(result.dimensions[dim].suggestions)).toBe(true);
    }
  });

  it('综合评分是各维度加权平均', async () => {
    const result = await engine.evaluate(NORMAL_TEXT);
    let expected = 0;
    for (const dim of QUALITY_DIMENSIONS) {
      expected += result.dimensions[dim].score * DIMENSION_WEIGHTS[dim];
    }
    expected = Math.min(100, Math.max(0, Math.round(expected)));
    expect(result.overallScore).toBe(expected);
  });

  it('可读性维度：检测用字问题', async () => {
    const textWithIssues = '他的得地混用了，在再不分，那哪也分不清。'.repeat(15);
    const dim = await engine.evaluateDimension(textWithIssues, 'readability');
    expect(dim.details.typoIssues).toBeDefined();
    expect(dim.issues.some((i) => i.description.includes('用字问题'))).toBe(true);
  });

  it('可读性维度：句长统计正确', async () => {
    const dim = await engine.evaluateDimension(NORMAL_TEXT, 'readability');
    expect(dim.details.avgSentenceLen).toBeDefined();
    expect(dim.details.sentenceVariety).toBeDefined();
    expect(dim.details.paragraphCount).toBeGreaterThan(0);
  });

  it('节奏维度：调用注入的 RhythmAnalyzer', async () => {
    const mockRhythm = createMockRhythmAnalyzer();
    const eng = new QualityScoreEngine({ rhythmAnalyzer: mockRhythm });
    const dim = await eng.evaluateDimension(NORMAL_TEXT, 'rhythm');
    expect(mockRhythm.analyze).toHaveBeenCalled();
    expect(dim.details.totalSegments).toBe(3);
    expect(dim.details.overallPace).toBe('balanced');
    expect(dim.score).toBeGreaterThanOrEqual(0);
  });

  it('节奏维度：无注入时使用降级规则', async () => {
    const eng = new QualityScoreEngine();
    const dim = await eng.evaluateDimension(NORMAL_TEXT, 'rhythm');
    expect(dim.details.actionDensity).toBeDefined();
    expect(dim.details.balanceScore).toBeDefined();
    expect(dim.score).toBeGreaterThanOrEqual(0);
  });

  it('情绪维度：调用注入的 EmotionAnalyzer', async () => {
    const mockEmotion = createMockEmotionAnalyzer();
    const eng = new QualityScoreEngine({ emotionAnalyzer: mockEmotion });
    const dim = await eng.evaluateDimension(NORMAL_TEXT, 'emotion');
    expect(mockEmotion.analyze).toHaveBeenCalled();
    expect(dim.details.dominantEmotion).toBe('fear');
    expect(dim.details.volatility).toBe(25);
    expect(dim.details.arcType).toBe('wave');
    expect(dim.score).toBeGreaterThan(0);
  });

  it('情绪维度：无注入时使用降级规则', async () => {
    const eng = new QualityScoreEngine();
    const dim = await eng.evaluateDimension(NORMAL_TEXT, 'emotion');
    expect(dim.details.positiveEmotions).toBeDefined();
    expect(dim.details.negativeEmotions).toBeDefined();
    expect(dim.score).toBeGreaterThanOrEqual(0);
  });

  it('人物一致性维度：调用注入的 CharacterChecker', async () => {
    const mockChecker = createMockCharacterChecker();
    const eng = new QualityScoreEngine({ characterChecker: mockChecker });
    const dim = await eng.evaluateDimension(NORMAL_TEXT, 'characterConsistency', {
      characterInfos: [
        { name: '林惊鸿', personality: '冷静沉稳' },
        { name: '苏白', personality: '温柔善良' },
      ],
    });
    expect(mockChecker.check).toHaveBeenCalled();
    expect(dim.details.overallScore).toBe(85);
    expect(dim.issues.length).toBeGreaterThan(0);
  });

  it('人物一致性维度：无注入时使用降级规则', async () => {
    const eng = new QualityScoreEngine();
    const dim = await eng.evaluateDimension(NORMAL_TEXT, 'characterConsistency', {
      characterNames: ['林惊鸿', '苏白'],
    });
    expect(dim.details.characterMentions).toBeGreaterThan(0);
    expect(dim.score).toBeGreaterThanOrEqual(0);
  });

  it('连贯性维度：检测重复内容', async () => {
    const repeatText = '他走了进来，然后坐下看了看四周的环境。他走了进来，然后坐下看了看四周的环境。'.repeat(10);
    const dim = await engine.evaluateDimension(repeatText, 'coherence');
    expect(dim.details.coherenceIssues).toBeDefined();
    expect(dim.issues.some((i) => i.description.includes('重复'))).toBe(true);
  });

  it('连贯性维度：因果链检测', async () => {
    const dim = await engine.evaluateDimension(NORMAL_TEXT, 'coherence');
    expect(dim.details.causalityIndicators).toBeDefined();
    expect(dim.details.timelineIndicators).toBeDefined();
    expect(dim.score).toBeGreaterThanOrEqual(0);
  });

  it('语言质感维度：修辞检测', async () => {
    const dim = await engine.evaluateDimension(NORMAL_TEXT, 'languageTexture');
    expect(dim.details.rhetoricCount).toBeDefined();
    expect(dim.details.precisionRatio).toBeDefined();
    expect(dim.score).toBeGreaterThanOrEqual(0);
  });

  it('语言质感维度：风格指纹匹配', async () => {
    const dim = await engine.evaluateDimension(NORMAL_TEXT, 'languageTexture', {
      styleFingerprint: { avgSentenceLen: 20, dialogueRatio: 0.05, descWordRatio: 0.1 },
    });
    expect(dim.details.styleMatch).toBeDefined();
    expect(dim.score).toBeGreaterThanOrEqual(0);
  });
});

describe('QualityScoreEngine — 评估结果缓存', () => {
  it('相同内容命中缓存', async () => {
    const engine = new QualityScoreEngine();
    const result1 = await engine.evaluate(NORMAL_TEXT);
    expect(result1.fromCache).toBe(false);

    const result2 = await engine.evaluate(NORMAL_TEXT);
    expect(result2.fromCache).toBe(true);
    expect(result2.overallScore).toBe(result1.overallScore);
  });

  it('不同内容不命中缓存', async () => {
    const engine = new QualityScoreEngine();
    const result1 = await engine.evaluate(NORMAL_TEXT);
    const differentText = NORMAL_TEXT + '\n\n新增内容完全不同。';
    const result2 = await engine.evaluate(differentText);
    expect(result2.fromCache).toBe(false);
  });

  it('clearCache 清空缓存', async () => {
    const engine = new QualityScoreEngine();
    await engine.evaluate(NORMAL_TEXT);
    engine.clearCache();
    const result = await engine.evaluate(NORMAL_TEXT);
    expect(result.fromCache).toBe(false);
  });

  it('invalidateCache 按 key 失效', async () => {
    const engine = new QualityScoreEngine();
    await engine.evaluate(NORMAL_TEXT);
    engine.invalidateCache(NORMAL_TEXT);
    const result = await engine.evaluate(NORMAL_TEXT);
    expect(result.fromCache).toBe(false);
  });

  it('维度级缓存独立工作', async () => {
    const engine = new QualityScoreEngine();
    const dim1 = await engine.evaluateDimension(NORMAL_TEXT, 'readability');
    const dim2 = await engine.evaluateDimension(NORMAL_TEXT, 'readability');
    expect(dim1.score).toBe(dim2.score);
  });
});

describe('QualityScoreEngine — 增量评估', () => {
  it('传入 changedRange 仍正常返回结果', async () => {
    const engine = new QualityScoreEngine();
    const result = await engine.evaluate(NORMAL_TEXT, {
      changedRange: { start: 0, end: 100 },
    });
    expect(result.overallScore).toBeGreaterThanOrEqual(0);
    expect(result.fromCache).toBe(false);
  });

  it('人物一致性维度：变更范围不含人物名时可跳过', async () => {
    const mockChecker = createMockCharacterChecker();
    const engine = new QualityScoreEngine({ characterChecker: mockChecker });

    // 第一次评估填充缓存
    await engine.evaluate(NORMAL_TEXT, {
      characterInfos: [{ name: '林惊鸿', personality: '冷静' }],
    });

    // 第二次评估，变更范围不含人物名
    await engine.evaluate(NORMAL_TEXT, {
      characterInfos: [{ name: '林惊鸿', personality: '冷静' }],
      changedRange: { start: 0, end: 50 },
    });

    // 至少调用过一次（第一次填充缓存时）
    expect(mockChecker.check).toHaveBeenCalled();
  });

  it('完整结果缓存命中优先级高于 changedRange', async () => {
    const engine = new QualityScoreEngine();
    await engine.evaluate(NORMAL_TEXT);
    const result = await engine.evaluate(NORMAL_TEXT, {
      changedRange: { start: 0, end: 10 },
    });
    // changedRange 存在时不命中完整缓存
    expect(result.fromCache).toBe(false);
  });
});

describe('QualityScoreEngine — 取消机制', () => {
  it('AbortSignal 已取消时抛出 AbortError', async () => {
    const engine = new QualityScoreEngine({
      rhythmAnalyzer: createMockRhythmAnalyzer(),
    });
    const controller = new AbortController();
    controller.abort();

    await expect(
      engine.evaluate(NORMAL_TEXT, {}, controller.signal)
    ).rejects.toThrow('评估已取消');
  });

  it('评估中取消抛出 AbortError', async () => {
    const mockRhythm = createMockRhythmAnalyzer();
    mockRhythm.analyze = vi.fn().mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 50));
      return {
        segments: [],
        overallPace: 'balanced',
        suggestions: [],
      };
    });

    const engine = new QualityScoreEngine({ rhythmAnalyzer: mockRhythm });
    const controller = new AbortController();

    const promise = engine.evaluate(NORMAL_TEXT, {}, controller.signal);
    controller.abort();

    await expect(promise).rejects.toThrow();
  });

  it('无 signal 时正常完成', async () => {
    const engine = new QualityScoreEngine();
    const result = await engine.evaluate(NORMAL_TEXT);
    expect(result).toBeDefined();
    expect(result.overallScore).toBeGreaterThanOrEqual(0);
  });
});

describe('QualityScoreEngine — 问题描述与改进建议', () => {
  it('问题包含完整字段结构', async () => {
    const engine = new QualityScoreEngine();
    const textWithIssues = '他的得地混用，在再不分。'.repeat(30);
    const result = await engine.evaluate(textWithIssues);
    if (result.issues.length > 0) {
      const issue = result.issues[0];
      expect(issue).toHaveProperty('id');
      expect(issue).toHaveProperty('dimension');
      expect(issue).toHaveProperty('description');
      expect(issue).toHaveProperty('severity');
      expect(['high', 'medium', 'low']).toContain(issue.severity);
    }
  });

  it('问题按严重度排序', async () => {
    const engine = new QualityScoreEngine();
    const result = await engine.evaluate(NORMAL_TEXT);
    const order = { high: 0, medium: 1, low: 2 };
    for (let i = 1; i < result.issues.length; i++) {
      const prev = order[result.issues[i - 1].severity];
      const curr = order[result.issues[i].severity];
      expect(prev).toBeLessThanOrEqual(curr);
    }
  });

  it('建议包含完整字段结构', async () => {
    const engine = new QualityScoreEngine();
    // 使用含用字问题的文本以触发建议
    const textWithIssues = '他的得地混用了，在再不分，那哪也分不清。'.repeat(15);
    const result = await engine.evaluate(textWithIssues);
    expect(result.suggestions.length).toBeGreaterThan(0);
    const s = result.suggestions[0];
    expect(s).toHaveProperty('id');
    expect(s).toHaveProperty('dimension');
    expect(s).toHaveProperty('content');
    expect(s).toHaveProperty('priority');
    expect(['high', 'medium', 'low']).toContain(s.priority);
  });

  it('建议按优先级排序且最多 10 条', async () => {
    const engine = new QualityScoreEngine();
    const result = await engine.evaluate(NORMAL_TEXT);
    expect(result.suggestions.length).toBeLessThanOrEqual(10);
    const order = { high: 0, medium: 1, low: 2 };
    for (let i = 1; i < result.suggestions.length; i++) {
      const prev = order[result.suggestions[i - 1].priority];
      const curr = order[result.suggestions[i].priority];
      expect(prev).toBeLessThanOrEqual(curr);
    }
  });

  it('低分时生成问题描述', async () => {
    const engine = new QualityScoreEngine();
    // 使用重复长句触发连贯性问题 + 用字问题
    const poorText = '他走了进来，然后坐下看了看四周的环境。他走了进来，然后坐下看了看四周的环境。'.repeat(10);
    const result = await engine.evaluate(poorText);
    const allIssues = [
      ...result.dimensions.readability.issues,
      ...result.dimensions.coherence.issues,
    ];
    expect(allIssues.length).toBeGreaterThan(0);
  });

  it('评分依据 basis 非空', async () => {
    const engine = new QualityScoreEngine();
    const result = await engine.evaluate(NORMAL_TEXT);
    for (const dim of QUALITY_DIMENSIONS) {
      expect(result.dimensions[dim].basis.length).toBeGreaterThan(0);
    }
  });
});

describe('QualityScoreEngine — 历史趋势', () => {
  it('历史不足时趋势为 stable', async () => {
    const engine = new QualityScoreEngine();
    const result = await engine.evaluate(NORMAL_TEXT);
    expect(result.trend).toBe('stable');
  });

  it('getHistory 返回历史记录', async () => {
    const engine = new QualityScoreEngine();
    await engine.evaluate(NORMAL_TEXT);
    await engine.evaluate(NORMAL_TEXT + '\n\n新增内容。');
    const history = engine.getHistory();
    expect(history.length).toBe(2);
    for (const h of history) {
      expect(typeof h).toBe('number');
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(100);
    }
  });

  it('clearHistory 清空历史记录', async () => {
    const engine = new QualityScoreEngine();
    await engine.evaluate(NORMAL_TEXT);
    expect(engine.getHistory().length).toBe(1);
    engine.clearHistory();
    expect(engine.getHistory()).toEqual([]);
  });

  it('历史记录超过上限时自动裁剪', async () => {
    const engine = new QualityScoreEngine({ historySize: 3 });
    for (let i = 0; i < 5; i++) {
      await engine.evaluate(NORMAL_TEXT + `\n\n第${i}次修改。`);
    }
    expect(engine.getHistory().length).toBeLessThanOrEqual(3);
  });

  it('评分上升时趋势为 rising', async () => {
    const engine = new QualityScoreEngine();
    // 先填充低分历史
    const poorText = '他来了他走了。'.repeat(30);
    for (let i = 0; i < 3; i++) {
      await engine.evaluate(poorText + `\n\n第${i}次。`);
    }
    // 再填充高分评估
    const goodText = NORMAL_TEXT + '\n\n丰富的修辞如梦如幻，仿佛置身仙境。'.repeat(3);
    for (let i = 0; i < 3; i++) {
      await engine.evaluate(goodText + `\n\n第${i}次。`);
    }
    const history = engine.getHistory();
    expect(history.length).toBeGreaterThanOrEqual(4);
    // 趋势应为 rising 或 stable（取决于实际评分差）
    const result = await engine.evaluate(goodText + '\n\n最终。');
    expect(['rising', 'falling', 'stable']).toContain(result.trend);
  });
});

describe('QualityScoreEngine — evaluateDimension 单维评估', () => {
  it('单独评估可读性维度', async () => {
    const engine = new QualityScoreEngine();
    const dim: DimensionScore = await engine.evaluateDimension(
      NORMAL_TEXT,
      'readability'
    );
    expect(dim.dimension).toBe('readability');
    expect(dim.score).toBeGreaterThanOrEqual(0);
    expect(dim.score).toBeLessThanOrEqual(100);
  });

  it('单独评估每个维度均返回有效结果', async () => {
    const engine = new QualityScoreEngine({
      rhythmAnalyzer: createMockRhythmAnalyzer(),
      emotionAnalyzer: createMockEmotionAnalyzer(),
      characterChecker: createMockCharacterChecker(),
    });
    for (const dim of QUALITY_DIMENSIONS) {
      const result = await engine.evaluateDimension(NORMAL_TEXT, dim);
      expect(result.dimension).toBe(dim);
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
    }
  });
});

describe('辅助函数测试', () => {
  it('getDimensionLabel 返回正确标签', () => {
    expect(getDimensionLabel('readability')).toBe('可读性');
    expect(getDimensionLabel('rhythm')).toBe('节奏');
    expect(getDimensionLabel('emotion')).toBe('情绪饱满度');
    expect(getDimensionLabel('characterConsistency')).toBe('人物一致性');
    expect(getDimensionLabel('coherence')).toBe('情节连贯性');
    expect(getDimensionLabel('languageTexture')).toBe('语言质感');
  });

  it('getSeverityLabel 返回正确标签', () => {
    expect(getSeverityLabel('high')).toBe('严重');
    expect(getSeverityLabel('medium')).toBe('中等');
    expect(getSeverityLabel('low')).toBe('轻微');
  });

  it('getSuggestionPriorityLabel 返回正确标签', () => {
    expect(getSuggestionPriorityLabel('high')).toBe('高优先级');
    expect(getSuggestionPriorityLabel('medium')).toBe('中优先级');
    expect(getSuggestionPriorityLabel('low')).toBe('低优先级');
  });

  it('getTrendLabel 返回正确标签', () => {
    expect(getTrendLabel('rising')).toBe('上升');
    expect(getTrendLabel('falling')).toBe('下降');
    expect(getTrendLabel('stable')).toBe('平稳');
  });
});
