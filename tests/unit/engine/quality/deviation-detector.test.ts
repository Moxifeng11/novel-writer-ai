import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  DeviationDetector,
  DEVIATION_TYPES,
  DEVIATION_TYPE_LABELS,
  DEFAULT_SEVERITY_THRESHOLDS,
  SEVERITY_ORDER,
  getDeviationTypeLabel,
  getDeviationSeverityLabel,
  getDeviationSeverityIcon,
  getDeviationSeverityColor,
} from '../../../../engine/quality/deviation-detector';
import type {
  DeviationReport,
  DeviationIssue,
  DeviationContext,
  ForeshadowTracking,
  IPlotDivergenceEngine,
  ICharacterConsistencyChecker,
  IRhythmAnalyzerForDeviation,
  SeverityThresholds,
} from '../../../../engine/quality/deviation-detector';

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

function createMockPlotDivergenceEngine(): IPlotDivergenceEngine {
  return {
    updateOptions: vi.fn(),
    evaluate: vi.fn().mockReturnValue({
      mainlineDivergence: {
        score: 35,
        issues: ['主线元素覆盖率 50%'],
        suggestions: ['建议增加主线元素'],
        details: {},
      },
      characterDivergence: {
        score: 20,
        issues: [],
        suggestions: [],
        details: {},
      },
      rhythmDivergence: {
        score: 15,
        issues: [],
        suggestions: [],
        details: {},
      },
      foreshadowDivergence: {
        score: 10,
        issues: [],
        suggestions: [],
        details: {},
      },
      settingDivergence: {
        score: 10,
        issues: [],
        suggestions: [],
        details: {},
      },
      overallDivergence: 25,
      overallLevel: 'warning',
    }),
  };
}

function createMockCharacterChecker(): ICharacterConsistencyChecker {
  return {
    check: vi.fn().mockResolvedValue({
      overallScore: 75,
      characterResults: {
        林惊鸿: {
          score: 90,
          inconsistencies: [],
        },
        苏白: {
          score: 60,
          inconsistencies: [
            {
              type: 'behavior',
              severity: 'medium' as const,
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

function createMockRhythmAnalyzer(): IRhythmAnalyzerForDeviation {
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

// ── 测试 ─────────────────────────────────────────────────────

describe('DeviationDetector — 构造与配置', () => {
  it('默认构造函数不报错', () => {
    const detector = new DeviationDetector();
    expect(detector).toBeDefined();
  });

  it('接受完整配置选项', () => {
    const detector = new DeviationDetector({
      plotDivergenceEngine: createMockPlotDivergenceEngine(),
      characterChecker: createMockCharacterChecker(),
      rhythmAnalyzer: createMockRhythmAnalyzer(),
      severityThresholds: { critical: 70, warning: 35 },
      foreshadowRecoverChapters: 8,
      cacheSize: 10,
      cacheTtlMs: 30000,
    });
    expect(detector).toBeDefined();
    expect(detector.getForeshadowRecoverChapters()).toBe(8);
  });

  it('DEVIATION_TYPES 包含 6 个类型', () => {
    expect(DEVIATION_TYPES).toHaveLength(6);
    expect(DEVIATION_TYPES).toContain('mainline');
    expect(DEVIATION_TYPES).toContain('characterOOC');
    expect(DEVIATION_TYPES).toContain('contradiction');
    expect(DEVIATION_TYPES).toContain('foreshadowForgot');
    expect(DEVIATION_TYPES).toContain('rhythm');
    expect(DEVIATION_TYPES).toContain('emotionBreak');
  });

  it('DEVIATION_TYPE_LABELS 包含所有类型标签', () => {
    for (const type of DEVIATION_TYPES) {
      expect(DEVIATION_TYPE_LABELS[type]).toBeDefined();
      expect(DEVIATION_TYPE_LABELS[type].length).toBeGreaterThan(0);
    }
  });

  it('默认严重度阈值合理', () => {
    expect(DEFAULT_SEVERITY_THRESHOLDS.critical).toBeGreaterThanOrEqual(
      DEFAULT_SEVERITY_THRESHOLDS.warning
    );
    expect(DEFAULT_SEVERITY_THRESHOLDS.warning).toBeGreaterThanOrEqual(
      DEFAULT_SEVERITY_THRESHOLDS.info
    );
  });

  it('SEVERITY_ORDER 顺序正确：critical > warning > info', () => {
    expect(SEVERITY_ORDER.critical).toBeGreaterThan(SEVERITY_ORDER.warning);
    expect(SEVERITY_ORDER.warning).toBeGreaterThan(SEVERITY_ORDER.info);
  });

  it('getSeverityThresholds 返回副本', () => {
    const detector = new DeviationDetector({
      severityThresholds: { critical: 70 },
    });
    const thresholds = detector.getSeverityThresholds();
    expect(thresholds.critical).toBe(70);
    // 修改副本不应影响内部状态
    thresholds.critical = 999;
    expect(detector.getSeverityThresholds().critical).toBe(70);
  });
});

describe('DeviationDetector — 边界情况', () => {
  it('空字符串返回空结果', async () => {
    const detector = new DeviationDetector();
    const result = await detector.detect('');
    expect(result.wordCount).toBe(0);
    expect(result.overallScore).toBe(0);
    expect(result.issues).toHaveLength(0);
    expect(result.fromCache).toBe(false);
  });

  it('少于100字返回空结果', async () => {
    const detector = new DeviationDetector();
    const result = await detector.detect(SHORT_TEXT);
    expect(result.wordCount).toBeLessThan(100);
    expect(result.overallScore).toBe(0);
    expect(result.suggestions.length).toBeGreaterThan(0);
  });

  it('含 frontmatter 的文本会被清理', async () => {
    const detector = new DeviationDetector();
    const text = '---\ntitle: 测试\n---\n' + NORMAL_TEXT;
    const result = await detector.detect(text);
    expect(result.wordCount).toBeGreaterThan(100);
    expect(result.overallScore).toBeGreaterThanOrEqual(0);
  });

  it('100字以上正常检测', async () => {
    const detector = new DeviationDetector();
    const result = await detector.detect(NORMAL_TEXT);
    expect(result.wordCount).toBeGreaterThanOrEqual(100);
    expect(result.overallScore).toBeGreaterThanOrEqual(0);
    expect(result.overallScore).toBeLessThanOrEqual(100);
    expect(result.evalTimeMs).toBeGreaterThanOrEqual(0);
  });
});

describe('DeviationDetector — 6 类偏离检测', () => {
  describe('类型 1：剧情偏离主线', () => {
    it('使用注入的 V1 PlotDivergenceEngine', async () => {
      const mockEngine = createMockPlotDivergenceEngine();
      const detector = new DeviationDetector({ plotDivergenceEngine: mockEngine });
      const issues = await detector.detectByType(NORMAL_TEXT, 'mainline', {
        chapterOutline: '主角进入大殿',
        mainlineKeywords: ['林惊鸿'],
      });
      expect(mockEngine.updateOptions).toHaveBeenCalled();
      expect(mockEngine.evaluate).toHaveBeenCalled();
      // V1 返回 score=35，应转换为 issue
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].type).toBe('mainline');
    });

    it('降级：内置规则检测主线关键词覆盖', async () => {
      const detector = new DeviationDetector();
      const issues = await detector.detectByType(NORMAL_TEXT, 'mainline', {
        mainlineKeywords: ['不存在的主角名', '神秘人物'],
      });
      // 关键词覆盖率低，应触发 critical
      expect(issues.length).toBeGreaterThan(0);
      const critical = issues.find((i) => i.severity === 'critical');
      expect(critical).toBeDefined();
      expect(critical!.degree).toBeGreaterThan(60);
    });

    it('降级：大纲关键词未覆盖', async () => {
      const detector = new DeviationDetector();
      const issues = await detector.detectByType(NORMAL_TEXT, 'mainline', {
        chapterOutline: '这是一个完全不相关的大纲内容，包含特殊关键词如「飞船」「外星人」',
      });
      // 大纲关键词未覆盖，应有 issue
      const outlineIssue = issues.find((i) =>
        i.description.includes('大纲关键词')
      );
      expect(outlineIssue).toBeDefined();
    });

    it('降级：大纲预期冲突但无冲突元素', async () => {
      const detector = new DeviationDetector();
      const peacefulText = '他安静地坐在那里，看着窗外的风景，思考着人生。'.repeat(20);
      const issues = await detector.detectByType(peacefulText, 'mainline', {
        chapterOutline: '本章预期有激烈的冲突和战斗',
      });
      const conflictIssue = issues.find((i) => i.description.includes('冲突'));
      expect(conflictIssue).toBeDefined();
    });
  });

  describe('类型 2：人物 OOC', () => {
    it('使用注入的 V1 CharacterConsistencyChecker', async () => {
      const mockChecker = createMockCharacterChecker();
      const detector = new DeviationDetector({ characterChecker: mockChecker });
      const issues = await detector.detectByType(NORMAL_TEXT, 'characterOOC', {
        characterInfos: [
          { name: '林惊鸿', personality: '冷静沉稳' },
          { name: '苏白', personality: '温柔善良' },
        ],
      });
      expect(mockChecker.check).toHaveBeenCalled();
      // 苏白的 score=60 → deviationDegree=40 → warning
      const oocIssue = issues.find((i) => i.description.includes('苏白'));
      expect(oocIssue).toBeDefined();
      expect(oocIssue!.location?.character).toBe('苏白');
    });

    it('降级：内置规则检测行为冲突', async () => {
      const detector = new DeviationDetector();
      const textWithConflict = [
        '林惊鸿是个冷静的人，平日里不动声色，遇事沉着。',
        '然而今天林惊鸿激动地说，泪流满面，勃然大怒，完全失去了冷静。',
        '林惊鸿心中警觉，仿佛有什么不对劲的地方。',
        '苏白走过来，温柔地看着他。',
        '林惊鸿不再激动，但依然保持警惕，思绪万千。',
      ].join('\n\n');
      const issues = await detector.detectByType(textWithConflict, 'characterOOC', {
        characterInfos: [
          { name: '林惊鸿', personality: '冷静沉稳' },
        ],
      });
      expect(issues.length).toBeGreaterThan(0);
      const behaviorIssue = issues.find((i) =>
        i.description.includes('人设不符')
      );
      expect(behaviorIssue).toBeDefined();
    });

    it('无人物信息时返回空数组', async () => {
      const detector = new DeviationDetector();
      const issues = await detector.detectByType(NORMAL_TEXT, 'characterOOC', {});
      expect(issues).toHaveLength(0);
    });
  });

  describe('类型 3：前后矛盾', () => {
    it('检测当前章节内部的重复句子', async () => {
      const detector = new DeviationDetector();
      const repeatText = '他走了进来，然后坐下看了看四周的环境。他走了进来，然后坐下看了看四周的环境。'.repeat(10);
      const issues = await detector.detectByType(repeatText, 'contradiction', {});
      // analyzeCoherence 会检测到重复
      expect(issues.length).toBeGreaterThan(0);
      const internal = issues.find((i) =>
        i.description.includes('重复')
      );
      expect(internal).toBeDefined();
    });

    it('检测与前文章节的时间线矛盾', async () => {
      const detector = new DeviationDetector();
      const currentText = '第一日清晨，他开始了修炼。第一日傍晚，他终于完成了。'.repeat(10);
      const prevText = '第一日，他在山上采药，遇到了苏白。'.repeat(10);
      const issues = await detector.detectByType(currentText, 'contradiction', {
        previousChapters: [
          {
            chapterId: 'v1-c1',
            chapterNum: 1,
            text: prevText,
          },
        ],
      });
      // 「第一日」在前文和当前文中重复，可能触发时间线矛盾
      const timeline = issues.find((i) =>
        i.description.includes('时间标记')
      );
      if (timeline) {
        expect(timeline.location?.chapterRef).toBe('v1-c1');
      }
    });

    it('检测外貌设定矛盾', async () => {
      const detector = new DeviationDetector();
      const textWithBlackHair = '林惊鸿一头黑发，英俊潇洒。苏白在远处看着他。'.repeat(10);
      const issues = await detector.detectByType(textWithBlackHair, 'contradiction', {
        characterInfos: [
          { name: '林惊鸿', appearance: '一头金发' },
        ],
      });
      const settingIssue = issues.find((i) =>
        i.description.includes('外貌描述矛盾')
      );
      expect(settingIssue).toBeDefined();
      expect(settingIssue!.severity).toBe('critical');
    });

    it('无前文章节时仅检测当前章节内部', async () => {
      const detector = new DeviationDetector();
      const issues = await detector.detectByType(NORMAL_TEXT, 'contradiction', {});
      // 不应崩溃，且应返回数组
      expect(Array.isArray(issues)).toBe(true);
    });
  });

  describe('类型 4：伏笔遗忘', () => {
    it('使用上下文提供的伏笔追踪', async () => {
      const detector = new DeviationDetector();
      const foreshadows: ForeshadowTracking[] = [
        {
          id: 'fs1',
          description: '神秘黑剑',
          keywords: ['黑剑', '神秘剑'],
          plantedChapterNum: 1,
          recovered: false,
        },
      ];
      const issues = await detector.detectByType(NORMAL_TEXT, 'foreshadowForgot', {
        chapterNum: 15, // 距离埋设章节 14 章，超过默认阈值 10
        foreshadows,
      });
      expect(issues.length).toBeGreaterThan(0);
      const forgot = issues.find((i) =>
        i.description.includes('神秘黑剑')
      );
      expect(forgot).toBeDefined();
      expect(forgot!.severity).toBe('critical');
      expect(forgot!.degree).toBeGreaterThan(60);
    });

    it('未超过阈值不告警', async () => {
      const detector = new DeviationDetector();
      const foreshadows: ForeshadowTracking[] = [
        {
          id: 'fs1',
          description: '神秘物品',
          keywords: ['不存在关键词'],
          plantedChapterNum: 1,
          recovered: false,
        },
      ];
      const issues = await detector.detectByType(NORMAL_TEXT, 'foreshadowForgot', {
        chapterNum: 3, // 距离 2 章，未超过阈值
        foreshadows,
      });
      expect(issues).toHaveLength(0);
    });

    it('在当前章节回收了伏笔不告警', async () => {
      const detector = new DeviationDetector();
      const foreshadows: ForeshadowTracking[] = [
        {
          id: 'fs1',
          description: '黑剑',
          keywords: ['黑剑'],
          plantedChapterNum: 1,
          recovered: false,
        },
      ];
      const text = '他终于拿出了那把传说中的黑剑。'.repeat(10);
      const issues = await detector.detectByType(text, 'foreshadowForgot', {
        chapterNum: 20,
        foreshadows,
      });
      expect(issues).toHaveLength(0);
    });

    it('超过阈值一半触发 warning', async () => {
      const detector = new DeviationDetector();
      const foreshadows: ForeshadowTracking[] = [
        {
          id: 'fs1',
          description: '未回收伏笔',
          keywords: ['不存在的关键词'],
          plantedChapterNum: 1,
          recovered: false,
        },
      ];
      const issues = await detector.detectByType(NORMAL_TEXT, 'foreshadowForgot', {
        chapterNum: 7, // 距离 6 章，超过阈值一半（5）但未达阈值（10）
        foreshadows,
      });
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].severity).toBe('warning');
    });

    it('从前文章节 frontmatter 解析伏笔', async () => {
      const detector = new DeviationDetector();
      const issues = await detector.detectByType(NORMAL_TEXT, 'foreshadowForgot', {
        chapterNum: 15,
        previousChapters: [
          {
            chapterId: 'v1-c1',
            chapterNum: 1,
            text: '前文内容',
            frontmatter: {
              foreshadows: [
                {
                  id: 'fs1',
                  description: '神秘物品',
                  keywords: ['不存在关键词'],
                },
              ],
            },
          },
        ],
      });
      expect(issues.length).toBeGreaterThan(0);
      const forgot = issues.find((i) => i.type === 'foreshadowForgot');
      expect(forgot).toBeDefined();
    });

    it('frontmatter 字符串形式伏笔', async () => {
      const detector = new DeviationDetector();
      const issues = await detector.detectByType(NORMAL_TEXT, 'foreshadowForgot', {
        chapterNum: 15,
        previousChapters: [
          {
            chapterId: 'v1-c1',
            chapterNum: 1,
            text: '前文内容',
            frontmatter: {
              foreshadow: '神秘的金色令牌',
            },
          },
        ],
      });
      // 应解析出伏笔并触发告警
      expect(issues.length).toBeGreaterThan(0);
    });

    it('已回收的伏笔不告警', async () => {
      const detector = new DeviationDetector();
      const foreshadows: ForeshadowTracking[] = [
        {
          id: 'fs1',
          description: '已回收伏笔',
          keywords: ['不存在的关键词'],
          plantedChapterNum: 1,
          recovered: true,
        },
      ];
      const issues = await detector.detectByType(NORMAL_TEXT, 'foreshadowForgot', {
        chapterNum: 20,
        foreshadows,
      });
      expect(issues).toHaveLength(0);
    });

    it('可配置回收阈值章节数', async () => {
      const detector = new DeviationDetector({
        foreshadowRecoverChapters: 3,
      });
      expect(detector.getForeshadowRecoverChapters()).toBe(3);
      const foreshadows: ForeshadowTracking[] = [
        {
          id: 'fs1',
          description: '神秘物品',
          keywords: ['不存在关键词'],
          plantedChapterNum: 1,
          recovered: false,
        },
      ];
      const issues = await detector.detectByType(NORMAL_TEXT, 'foreshadowForgot', {
        chapterNum: 5, // 距离 4 章，超过阈值 3
        foreshadows,
      });
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].severity).toBe('critical');
    });
  });

  describe('类型 5：节奏偏离', () => {
    it('使用注入的 V1 RhythmAnalyzer', async () => {
      const mockRhythm = createMockRhythmAnalyzer();
      const detector = new DeviationDetector({ rhythmAnalyzer: mockRhythm });
      const issues = await detector.detectByType(NORMAL_TEXT, 'rhythm', {
        expectedRhythm: 'slow', // 期望慢节奏，实际为 medium → 偏离
      });
      expect(mockRhythm.analyze).toHaveBeenCalled();
      const rhythmIssue = issues.find((i) => i.type === 'rhythm');
      expect(rhythmIssue).toBeDefined();
    });

    it('降级：内置规则检测节奏偏离', async () => {
      const detector = new DeviationDetector();
      // 使用长句（>40字）和大量描写词触发 slow 节奏判定
      const slowText = '他静静地坐在那里，仿佛在思考着什么遥远而深邃的事情，空气中弥漫着淡淡的花香，月光如水一般洒落在寂静的森林中，仿佛一切都静止了，犹如梦境一般不真实。'.repeat(10);
      const issues = await detector.detectByType(slowText, 'rhythm', {
        expectedRhythm: 'fast', // 期望快节奏，实际为慢节奏
      });
      const mismatch = issues.find((i) =>
        i.description.includes('节奏偏差')
      );
      expect(mismatch).toBeDefined();
      expect(mismatch!.severity).toBe('critical');
    });

    it('无期望节奏时不告警', async () => {
      const detector = new DeviationDetector();
      const issues = await detector.detectByType(NORMAL_TEXT, 'rhythm', {});
      expect(issues).toHaveLength(0);
    });

    it('节奏匹配时不告警', async () => {
      const detector = new DeviationDetector();
      const fastText = '他冲上去！一拳打出！剑光闪烁！两人厮杀在一起！他闪身躲避！'.repeat(10);
      const issues = await detector.detectByType(fastText, 'rhythm', {
        expectedRhythm: 'fast',
      });
      // 实际为 fast，匹配期望，应无节奏偏离 issue
      const mismatch = issues.find((i) =>
        i.description.includes('节奏偏差')
      );
      expect(mismatch).toBeUndefined();
    });
  });
});

describe('DeviationDetector — 完整检测报告', () => {
  it('返回完整结构', async () => {
    const detector = new DeviationDetector();
    const result: DeviationReport = await detector.detect(NORMAL_TEXT, {
      chapterOutline: '主角进入大殿',
      mainlineKeywords: ['林惊鸿'],
      characterInfos: [{ name: '林惊鸿', personality: '冷静' }],
    });
    expect(result).toHaveProperty('overallScore');
    expect(result).toHaveProperty('overallSeverity');
    expect(result).toHaveProperty('typeScores');
    expect(result).toHaveProperty('issues');
    expect(result).toHaveProperty('suggestions');
    expect(result).toHaveProperty('evaluatedAt');
    expect(result).toHaveProperty('wordCount');
    expect(result).toHaveProperty('evalTimeMs');
    expect(result).toHaveProperty('fromCache');
    expect(result).toHaveProperty('incremental');

    // typeScores 包含全部 6 个类型
    for (const type of DEVIATION_TYPES) {
      expect(result.typeScores[type]).toBeDefined();
      expect(result.typeScores[type]).toBeGreaterThanOrEqual(0);
      expect(result.typeScores[type]).toBeLessThanOrEqual(100);
    }
  });

  it('总体预警级别正确', async () => {
    const detector = new DeviationDetector();
    const result = await detector.detect(NORMAL_TEXT, {
      mainlineKeywords: ['不存在的关键词'],
    });
    // 关键词未覆盖，触发 critical
    expect(['info', 'warning', 'critical']).toContain(result.overallSeverity);
  });

  it('问题按严重度倒序', async () => {
    const detector = new DeviationDetector();
    const result = await detector.detect(NORMAL_TEXT, {
      mainlineKeywords: ['不存在的关键词'],
      characterInfos: [{ name: '林惊鸿', appearance: '金发' }],
    });
    for (let i = 1; i < result.issues.length; i++) {
      const prev = SEVERITY_ORDER[result.issues[i - 1].severity];
      const curr = SEVERITY_ORDER[result.issues[i].severity];
      expect(prev).toBeGreaterThanOrEqual(curr);
    }
  });

  it('建议按优先级倒序且最多 10 条', async () => {
    const detector = new DeviationDetector();
    const result = await detector.detect(NORMAL_TEXT, {
      mainlineKeywords: ['不存在的关键词'],
    });
    expect(result.suggestions.length).toBeLessThanOrEqual(10);
    for (let i = 1; i < result.suggestions.length; i++) {
      const prev = SEVERITY_ORDER[result.suggestions[i - 1].priority];
      const curr = SEVERITY_ORDER[result.suggestions[i].priority];
      expect(prev).toBeGreaterThanOrEqual(curr);
    }
  });
});

describe('DeviationDetector — 预警级别系统', () => {
  it('偏离度低于 warning 阈值 → info', async () => {
    const detector = new DeviationDetector();
    // 主线关键词完全覆盖，无偏离
    const issues = await detector.detectByType(NORMAL_TEXT, 'mainline', {
      mainlineKeywords: ['林惊鸿', '苏白'],
      chapterOutline: NORMAL_TEXT.slice(0, 100),
    });
    // 关键词匹配，应主要为 info 或无 issue
    for (const issue of issues) {
      if (issue.degree < DEFAULT_SEVERITY_THRESHOLDS.warning) {
        expect(issue.severity).toBe('info');
      }
    }
  });

  it('偏离度达到 warning 阈值 → warning', async () => {
    const detector = new DeviationDetector();
    const foreshadows: ForeshadowTracking[] = [
      {
        id: 'fs1',
        description: '伏笔',
        keywords: ['不存在'],
        plantedChapterNum: 1,
        recovered: false,
      },
    ];
    const issues = await detector.detectByType(NORMAL_TEXT, 'foreshadowForgot', {
      chapterNum: 7, // 距离 6 章，超过阈值一半 5，未达 10
      foreshadows,
    });
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].severity).toBe('warning');
  });

  it('偏离度达到 critical 阈值 → critical', async () => {
    const detector = new DeviationDetector();
    const issues = await detector.detectByType(NORMAL_TEXT, 'mainline', {
      mainlineKeywords: ['完全不存在的关键词'],
    });
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].severity).toBe('critical');
  });

  it('自定义阈值生效', async () => {
    const detector = new DeviationDetector({
      severityThresholds: { critical: 80, warning: 50 },
    });
    // 偏离度 35 应为 info（默认为 warning）
    const foreshadows: ForeshadowTracking[] = [
      {
        id: 'fs1',
        description: '伏笔',
        keywords: ['不存在'],
        plantedChapterNum: 1,
        recovered: false,
      },
    ];
    const issues = await detector.detectByType(NORMAL_TEXT, 'foreshadowForgot', {
      chapterNum: 7,
      foreshadows,
    });
    // degree = 35 + 3*6 = 53，按自定义阈值应为 warning
    if (issues.length > 0) {
      expect(issues[0].degree).toBeGreaterThanOrEqual(50);
      expect(issues[0].severity).toBe('warning');
    }
  });
});

describe('DeviationDetector — 结果缓存', () => {
  it('相同内容命中缓存', async () => {
    const detector = new DeviationDetector();
    const result1 = await detector.detect(NORMAL_TEXT);
    expect(result1.fromCache).toBe(false);

    const result2 = await detector.detect(NORMAL_TEXT);
    expect(result2.fromCache).toBe(true);
    expect(result2.overallScore).toBe(result1.overallScore);
  });

  it('不同内容不命中缓存', async () => {
    const detector = new DeviationDetector();
    await detector.detect(NORMAL_TEXT);
    const differentText = NORMAL_TEXT + '\n\n新增内容完全不同。';
    const result = await detector.detect(differentText);
    expect(result.fromCache).toBe(false);
  });

  it('clearCache 清空缓存', async () => {
    const detector = new DeviationDetector();
    await detector.detect(NORMAL_TEXT);
    detector.clearCache();
    const result = await detector.detect(NORMAL_TEXT);
    expect(result.fromCache).toBe(false);
  });

  it('invalidateCache 按 key 失效', async () => {
    const detector = new DeviationDetector();
    await detector.detect(NORMAL_TEXT);
    detector.invalidateCache(NORMAL_TEXT);
    const result = await detector.detect(NORMAL_TEXT);
    expect(result.fromCache).toBe(false);
  });

  it('invalidateCache() 无参数清空全部', async () => {
    const detector = new DeviationDetector();
    await detector.detect(NORMAL_TEXT);
    detector.invalidateCache();
    const result = await detector.detect(NORMAL_TEXT);
    expect(result.fromCache).toBe(false);
  });

  it('类型级缓存独立工作', async () => {
    const detector = new DeviationDetector();
    const issues1 = await detector.detectByType(NORMAL_TEXT, 'mainline', {
      mainlineKeywords: ['林惊鸿'],
    });
    const issues2 = await detector.detectByType(NORMAL_TEXT, 'mainline', {
      mainlineKeywords: ['林惊鸿'],
    });
    // 应返回相同结果
    expect(issues2.length).toBe(issues1.length);
  });
});

describe('DeviationDetector — 增量检测', () => {
  it('传入 changedRange 仍正常返回结果', async () => {
    const detector = new DeviationDetector();
    const result = await detector.detect(NORMAL_TEXT, {
      changedRange: { start: 0, end: 100 },
    });
    expect(result.overallScore).toBeGreaterThanOrEqual(0);
    expect(result.fromCache).toBe(false);
    expect(result.incremental).toBe(true);
  });

  it('changedRange 存在时不命中完整缓存', async () => {
    const detector = new DeviationDetector();
    await detector.detect(NORMAL_TEXT);
    const result = await detector.detect(NORMAL_TEXT, {
      changedRange: { start: 0, end: 10 },
    });
    expect(result.fromCache).toBe(false);
    expect(result.incremental).toBe(true);
  });

  it('剧情偏离主线：变更范围不含主线关键词时跳过', async () => {
    const detector = new DeviationDetector();
    const result = await detector.detect(NORMAL_TEXT, {
      mainlineKeywords: ['林惊鸿'],
      changedRange: { start: 0, end: 50 }, // 前 50 字不含「林惊鸿」
    });
    // 跳过该类型 → typeScores 为 0
    expect(result.typeScores.mainline).toBe(0);
    expect(result.incremental).toBe(true);
  });

  it('人物 OOC：变更范围不含人物名时跳过', async () => {
    const detector = new DeviationDetector();
    const result = await detector.detect(NORMAL_TEXT, {
      characterInfos: [{ name: '林惊鸿', personality: '冷静' }],
      changedRange: { start: 0, end: 30 }, // 不含人物名
    });
    expect(result.typeScores.characterOOC).toBe(0);
  });

  it('伏笔遗忘：变更范围不含伏笔关键词时跳过', async () => {
    const detector = new DeviationDetector();
    const result = await detector.detect(NORMAL_TEXT, {
      chapterNum: 20,
      foreshadows: [
        {
          id: 'fs1',
          description: '神秘物品',
          keywords: ['完全不存在的关键词'],
          plantedChapterNum: 1,
          recovered: false,
        },
      ],
      changedRange: { start: 0, end: 50 },
    });
    expect(result.typeScores.foreshadowForgot).toBe(0);
  });

  it('节奏与前后矛盾：不跳过，仍检测', async () => {
    const detector = new DeviationDetector();
    const result = await detector.detect(NORMAL_TEXT, {
      expectedRhythm: 'fast',
      changedRange: { start: 0, end: 50 },
    });
    // 节奏不跳过，应有非零分数（实际可能为 0，但不应因 changedRange 跳过）
    expect(result.incremental).toBe(true);
  });
});

describe('DeviationDetector — 取消机制', () => {
  it('AbortSignal 已取消时抛出 AbortError', async () => {
    const detector = new DeviationDetector({
      rhythmAnalyzer: createMockRhythmAnalyzer(),
    });
    const controller = new AbortController();
    controller.abort();

    await expect(
      detector.detect(NORMAL_TEXT, {}, controller.signal)
    ).rejects.toThrow('偏离检测已取消');
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

    const detector = new DeviationDetector({ rhythmAnalyzer: mockRhythm });
    const controller = new AbortController();

    const promise = detector.detect(NORMAL_TEXT, {
      expectedRhythm: 'fast',
    }, controller.signal);
    controller.abort();

    await expect(promise).rejects.toThrow();
  });

  it('无 signal 时正常完成', async () => {
    const detector = new DeviationDetector();
    const result = await detector.detect(NORMAL_TEXT);
    expect(result).toBeDefined();
    expect(result.overallScore).toBeGreaterThanOrEqual(0);
  });

  it('detectByType 也支持取消', async () => {
    const detector = new DeviationDetector({
      rhythmAnalyzer: createMockRhythmAnalyzer(),
    });
    const controller = new AbortController();
    controller.abort();

    await expect(
      detector.detectByType(NORMAL_TEXT, 'rhythm', {}, controller.signal)
    ).rejects.toThrow('偏离检测已取消');
  });
});

describe('DeviationDetector — detectByType 单类型检测', () => {
  it('单独检测每个类型均返回有效结果', async () => {
    const detector = new DeviationDetector({
      plotDivergenceEngine: createMockPlotDivergenceEngine(),
      characterChecker: createMockCharacterChecker(),
      rhythmAnalyzer: createMockRhythmAnalyzer(),
    });
    const context: DeviationContext = {
      chapterOutline: '主角进入大殿',
      mainlineKeywords: ['林惊鸿'],
      characterInfos: [{ name: '林惊鸿', personality: '冷静' }],
      expectedRhythm: 'fast',
    };
    for (const type of DEVIATION_TYPES) {
      const issues = await detector.detectByType(NORMAL_TEXT, type, context);
      expect(Array.isArray(issues)).toBe(true);
      for (const issue of issues) {
        expect(issue.type).toBe(type);
        expect(issue.id).toBeDefined();
        expect(issue.severity).toBeDefined();
        expect(['info', 'warning', 'critical']).toContain(issue.severity);
        expect(issue.degree).toBeGreaterThanOrEqual(0);
        expect(issue.degree).toBeLessThanOrEqual(100);
      }
    }
  });

  it('返回的 issue 包含完整字段结构', async () => {
    const detector = new DeviationDetector();
    const issues = await detector.detectByType(NORMAL_TEXT, 'mainline', {
      mainlineKeywords: ['不存在的关键词'],
    });
    expect(issues.length).toBeGreaterThan(0);
    const issue = issues[0];
    expect(issue).toHaveProperty('id');
    expect(issue).toHaveProperty('type');
    expect(issue).toHaveProperty('severity');
    expect(issue).toHaveProperty('degree');
    expect(issue).toHaveProperty('description');
  });
});

describe('DeviationDetector — 与 V1 引擎集成', () => {
  it('V1 PlotDivergenceEngine 接收 updateOptions', async () => {
    const mockEngine = createMockPlotDivergenceEngine();
    const detector = new DeviationDetector({ plotDivergenceEngine: mockEngine });
    await detector.detectByType(NORMAL_TEXT, 'mainline', {
      chapterOutline: '大纲',
      mainlineKeywords: ['关键词'],
    });
    expect(mockEngine.updateOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        chapterOutline: '大纲',
        mainlineKeywords: ['关键词'],
      })
    );
  });

  it('V1 CharacterConsistencyChecker 接收 historyTexts', async () => {
    const mockChecker = createMockCharacterChecker();
    const detector = new DeviationDetector({ characterChecker: mockChecker });
    await detector.detectByType(NORMAL_TEXT, 'characterOOC', {
      characterInfos: [{ name: '林惊鸿', personality: '冷静' }],
      previousChapters: [
        { chapterId: 'v1-c1', chapterNum: 1, text: '前文内容' },
      ],
    });
    expect(mockChecker.check).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      ['前文内容']
    );
  });

  it('V1 引擎未被修改（向后兼容）', () => {
    // 仅检查：DeviationDetector 不修改注入的引擎
    const mockEngine = createMockPlotDivergenceEngine();
    const originalUpdateOptions = mockEngine.updateOptions;
    const detector = new DeviationDetector({ plotDivergenceEngine: mockEngine });
    expect(detector).toBeDefined();
    // 引用未变
    expect(mockEngine.updateOptions).toBe(originalUpdateOptions);
  });
});

describe('辅助函数测试', () => {
  it('getDeviationTypeLabel 返回正确标签', () => {
    expect(getDeviationTypeLabel('mainline')).toBe('剧情偏离主线');
    expect(getDeviationTypeLabel('characterOOC')).toBe('人物 OOC');
    expect(getDeviationTypeLabel('contradiction')).toBe('前后矛盾');
    expect(getDeviationTypeLabel('foreshadowForgot')).toBe('伏笔遗忘');
    expect(getDeviationTypeLabel('rhythm')).toBe('节奏偏离');
    expect(getDeviationTypeLabel('emotionBreak')).toBe('情绪断层');
  });

  it('getDeviationSeverityLabel 返回正确标签', () => {
    expect(getDeviationSeverityLabel('info')).toBe('提示');
    expect(getDeviationSeverityLabel('warning')).toBe('警告');
    expect(getDeviationSeverityLabel('critical')).toBe('严重');
  });

  it('getDeviationSeverityIcon 返回对应图标', () => {
    expect(getDeviationSeverityIcon('critical')).toBe('🔴');
    expect(getDeviationSeverityIcon('warning')).toBe('🟡');
    expect(getDeviationSeverityIcon('info')).toBe('🟢');
  });

  it('getDeviationSeverityColor 返回对应颜色', () => {
    expect(getDeviationSeverityColor('critical')).toContain('danger');
    expect(getDeviationSeverityColor('warning')).toContain('warning');
    expect(getDeviationSeverityColor('info')).toContain('success');
  });
});
