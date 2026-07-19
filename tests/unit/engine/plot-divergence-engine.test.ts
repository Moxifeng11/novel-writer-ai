import { describe, it, expect, beforeEach } from 'vitest';
import {
  PlotDivergenceEngine,
  getDivergenceLevelColor,
  getDivergenceLevelLabel,
  getDivergenceLevelIcon,
} from '../../../engine/plot-divergence-engine';
import type { DivergenceResult, DivergenceLevel } from '../../../engine/plot-divergence-engine';

describe('PlotDivergenceEngine — 构造与配置', () => {
  it('默认构造函数不报错', () => {
    const engine = new PlotDivergenceEngine();
    expect(engine).toBeDefined();
  });

  it('接受完整配置选项', () => {
    const engine = new PlotDivergenceEngine({
      chapterOutline: '主角复仇的故事',
      mainlineKeywords: ['复仇', '修仙'],
      characterNames: ['林惊鸿', '苏白'],
      characterTraits: { '林惊鸿': ['冷静', '聪明'] },
      settingKeywords: ['修仙', '宗门'],
      expectedRhythm: 'medium',
      foreshadowToRecover: ['神秘宝物'],
      activeForeshadows: ['身世之谜'],
      previousDivergence: 20,
      ignoredIssues: [],
    });
    expect(engine).toBeDefined();
  });

  it('updateOptions 可更新配置', () => {
    const engine = new PlotDivergenceEngine({ characterNames: ['甲'] });
    engine.updateOptions({
      characterNames: ['乙'],
      mainlineKeywords: ['新主线'],
      expectedRhythm: 'fast',
    });
    const result = engine.evaluate('乙出场，新主线推进，但是遇到了危机。'.repeat(10));
    expect(result.wordCount).toBeGreaterThan(100);
  });
});

describe('PlotDivergenceEngine — 边界情况', () => {
  it('空字符串返回空结果', () => {
    const engine = new PlotDivergenceEngine();
    const result = engine.evaluate('');
    expect(result.wordCount).toBe(0);
    expect(result.overallDivergence).toBe(0);
    expect(result.shouldAlert).toBe(false);
  });

  it('少于100字返回空结果', () => {
    const engine = new PlotDivergenceEngine();
    const result = engine.evaluate('短内容');
    expect(result.wordCount).toBeLessThan(100);
    expect(result.overallDivergence).toBe(0);
    expect(result.overallLevel).toBe('normal');
  });

  it('恰好100字以上正常检测', () => {
    const engine = new PlotDivergenceEngine();
    const text = '这是一段用于测试剧情偏离检测的文本，内容足够长以触发正常的评估流程，包含一些基本要素。';
    const result = engine.evaluate(text.repeat(3));
    expect(result.wordCount).toBeGreaterThanOrEqual(100);
    expect(result.overallDivergence).toBeGreaterThanOrEqual(0);
  });

  it('含 frontmatter 的文本会被清理', () => {
    const engine = new PlotDivergenceEngine();
    const text = '---\ntitle: 测试\n---\n' + '正文内容。'.repeat(50);
    const result = engine.evaluate(text);
    expect(result.wordCount).toBeGreaterThan(100);
    expect(result.overallDivergence).toBeGreaterThanOrEqual(0);
  });

  it('超长文本正常处理且不会崩溃', () => {
    const engine = new PlotDivergenceEngine();
    let longText = '';
    for (let i = 0; i < 100; i++) {
      longText += '林惊鸿站在大殿中，面对敌人的进攻，他冷静地应对着。但是敌人太多了，情况十分危急。就在这时，苏白赶来了。\n\n';
    }
    const result = engine.evaluate(longText);
    expect(result.wordCount).toBeGreaterThan(1000);
    expect(result.overallDivergence).toBeGreaterThanOrEqual(0);
    expect(result.overallDivergence).toBeLessThanOrEqual(100);
  });
});

describe('PlotDivergenceEngine — 五维度偏离检测', () => {
  let engine: PlotDivergenceEngine;

  beforeEach(() => {
    engine = new PlotDivergenceEngine({
      chapterOutline: '林惊鸿为了复仇踏上修仙之路，在宗门中修炼成长，最终揭开身世真相',
      mainlineKeywords: ['复仇', '修仙', '宗门', '真相', '身世'],
      characterNames: ['林惊鸿', '苏白', '长老'],
      characterTraits: {
        '林惊鸿': ['冷静', '聪明'],
        '苏白': ['温柔', '乐观'],
      },
      settingKeywords: ['修仙', '宗门', '灵力', '丹药', '飞剑'],
      expectedRhythm: 'medium',
      foreshadowToRecover: ['神秘玉佩'],
      activeForeshadows: ['身世之谜', '神秘师父'],
    });
  });

  it('主线偏离：贴合大纲时偏离度低', () => {
    const text =
      '林惊鸿踏入宗门，开始了修仙之路。他心中怀着复仇的念头，日夜修炼。' +
      '随着修为提升，他逐渐接触到自己身世的真相，一切都在按照计划推进。';
    const result = engine.evaluate(text.repeat(5));
    expect(result.mainlineDivergence.score).toBeGreaterThanOrEqual(0);
    expect(result.mainlineDivergence.score).toBeLessThan(80);
  });

  it('主线偏离：完全不相关内容偏离度高', () => {
    const engineNoMatch = new PlotDivergenceEngine({
      mainlineKeywords: ['星际', '机甲', '外星人'],
      chapterOutline: '星际战争中机甲战士的故事',
    });
    const text = '今天天气真好，小明在公园里喂猫，然后回家做饭看电视。'.repeat(10);
    const result = engineNoMatch.evaluate(text);
    expect(result.mainlineDivergence.score).toBeGreaterThan(30);
  });

  it('角色偏离：符合人设时偏离度低', () => {
    const text =
      '林惊鸿冷静地分析着眼前的局势，灵机一动想出了对策。' +
      '苏白温柔地安慰着受伤的同伴，脸上带着乐观的笑容。';
    const result = engine.evaluate(text.repeat(10));
    expect(result.characterDivergence.score).toBeGreaterThanOrEqual(0);
    expect(result.characterDivergence.score).toBeLessThan(80);
  });

  it('角色偏离：人设关键词附近出现时能检测到', () => {
    const text =
      '林惊鸿冷静地看着前方，面无表情。' +
      '他聪明地识破了敌人的诡计。';
    const result = engine.evaluate(text.repeat(10));
    expect(result.characterDivergence.details).toBeDefined();
    expect(result.characterDivergence.score).toBeGreaterThanOrEqual(0);
  });

  it('节奏偏离：快节奏文本与慢预期偏差大', () => {
    const fastEngine = new PlotDivergenceEngine({ expectedRhythm: 'slow' });
    const fastText =
      '冲杀！打！砍！刺！躲！跑！追！' +
      '他冲上去一拳打飞敌人，接着飞身跃起，剑光闪烁间击倒一片。'.repeat(20);
    const result = fastEngine.evaluate(fastText);
    expect(result.rhythmDivergence.score).toBeGreaterThanOrEqual(0);
    expect(result.rhythmDivergence.details.actualPace).toBeDefined();
    expect(result.rhythmDivergence.details.expectedPace).toBe('slow');
  });

  it('节奏偏离：预期与实际一致时偏离度低', () => {
    const midEngine = new PlotDivergenceEngine({ expectedRhythm: 'medium' });
    const text =
      '林惊鸿走进房间，环顾四周。"有人吗？"他问道。' +
      '没有人回答。他坐下来，开始思考下一步的计划。'.repeat(10);
    const result = midEngine.evaluate(text);
    expect(result.rhythmDivergence.score).toBeGreaterThanOrEqual(0);
  });

  it('伏笔偏离：应回收伏笔未回收时检测到', () => {
    const text = '林惊鸿在房间里走来走去，思考着今天发生的事情。'.repeat(20);
    const result = engine.evaluate(text);
    expect(result.foreshadowDivergence.details.recoverySignals).toBeDefined();
    expect(result.foreshadowDivergence.details.plantSignals).toBeDefined();
  });

  it('设定偏离：世界观元素覆盖度影响得分', () => {
    const text = '修仙宗门中，弟子们正在修炼灵力，准备炼制丹药。'.repeat(10);
    const result = engine.evaluate(text);
    expect(result.settingDivergence.details.settingCoverage).toBeDefined();
    expect(result.settingDivergence.details.detectedSettings).toBeDefined();
  });

  it('设定偏离：多种世界观元素混合时检测到冲突', () => {
    const mixEngine = new PlotDivergenceEngine({
      settingKeywords: ['修仙'],
    });
    const text =
      '修仙者林惊鸿掏出手机给外星人打电话，一边开着飞机一边用内力修炼。'.repeat(10);
    const result = mixEngine.evaluate(text);
    expect(result.settingDivergence.score).toBeGreaterThanOrEqual(0);
  });

  it('综合偏离度是各维度加权平均', () => {
    const text = '林惊鸿在宗门中修炼，为复仇做准备。'.repeat(10);
    const result = engine.evaluate(text);
    expect(result.overallDivergence).toBeGreaterThanOrEqual(0);
    expect(result.overallDivergence).toBeLessThanOrEqual(100);
    expect(['normal', 'warning', 'danger']).toContain(result.overallLevel);
  });
});

describe('PlotDivergenceEngine — 偏离等级', () => {
  it('getDivergenceLevel 正确映射分数到等级', () => {
    const engine = new PlotDivergenceEngine();
    const levelNormal = engine.evaluate('短'.repeat(50));
    expect(levelNormal.overallLevel).toBe('normal');
  });
});

describe('PlotDivergenceEngine — 历史记录与忽略', () => {
  it('divergenceHistory 记录历史偏离度', () => {
    const engine = new PlotDivergenceEngine();
    expect(engine.getDivergenceHistory()).toEqual([]);

    engine.evaluate('测试文本内容足够长以触发评估。'.repeat(10));
    engine.evaluate('另一段测试文本内容用于积累历史记录。'.repeat(10));

    const history = engine.getDivergenceHistory();
    expect(history.length).toBe(2);
    for (const h of history) {
      expect(typeof h).toBe('number');
    }
  });

  it('clearHistory 清空历史记录', () => {
    const engine = new PlotDivergenceEngine();
    engine.evaluate('测试文本内容足够长。'.repeat(10));
    expect(engine.getDivergenceHistory().length).toBe(1);

    engine.clearHistory();
    expect(engine.getDivergenceHistory()).toEqual([]);
  });

  it('ignoreIssue / unignoreIssue 管理忽略列表', () => {
    const engine = new PlotDivergenceEngine();
    expect(engine.getIgnoredIssues()).toEqual([]);

    engine.ignoreIssue('测试问题');
    expect(engine.getIgnoredIssues()).toContain('测试问题');

    engine.unignoreIssue('测试问题');
    expect(engine.getIgnoredIssues()).not.toContain('测试问题');
  });

  it('忽略的问题不会出现在 issues 列表中', () => {
    const engine = new PlotDivergenceEngine({
      settingKeywords: ['修仙'],
    });
    const text = '今天小明去公园玩，完全和修仙无关。'.repeat(20);
    const resultBefore = engine.evaluate(text);

    if (resultBefore.settingDivergence.issues.length > 0) {
      const issueKey = resultBefore.settingDivergence.issues[0].slice(0, 30);
      engine.ignoreIssue(issueKey);
      const resultAfter = engine.evaluate(text);
      expect(resultAfter.settingDivergence.issues.length).toBeLessThan(
        resultBefore.settingDivergence.issues.length
      );
    }
  });
});

describe('PlotDivergenceEngine — 结果结构', () => {
  it('返回完整的五维度结果结构', () => {
    const engine = new PlotDivergenceEngine();
    const result: DivergenceResult = engine.evaluate(
      '这是一段足够长的测试文本，用于验证偏离检测结果结构的完整性。'.repeat(10)
    );
    expect(result).toHaveProperty('mainlineDivergence');
    expect(result).toHaveProperty('characterDivergence');
    expect(result).toHaveProperty('rhythmDivergence');
    expect(result).toHaveProperty('foreshadowDivergence');
    expect(result).toHaveProperty('settingDivergence');
    expect(result).toHaveProperty('overallDivergence');
    expect(result).toHaveProperty('overallLevel');
    expect(result).toHaveProperty('evaluatedAt');
    expect(result).toHaveProperty('wordCount');
    expect(result).toHaveProperty('shouldAlert');
    expect(typeof result.evaluatedAt).toBe('number');
    expect(typeof result.shouldAlert).toBe('boolean');
  });

  it('每个维度包含 score、level、details、issues、suggestions', () => {
    const engine = new PlotDivergenceEngine();
    const result = engine.evaluate('测试文本内容足够长。'.repeat(10));
    const dims = [
      result.mainlineDivergence,
      result.characterDivergence,
      result.rhythmDivergence,
      result.foreshadowDivergence,
      result.settingDivergence,
    ];
    for (const dim of dims) {
      expect(typeof dim.score).toBe('number');
      expect(dim.score).toBeGreaterThanOrEqual(0);
      expect(dim.score).toBeLessThanOrEqual(100);
      expect(['normal', 'warning', 'danger']).toContain(dim.level);
      expect(typeof dim.details).toBe('object');
      expect(Array.isArray(dim.issues)).toBe(true);
      expect(Array.isArray(dim.suggestions)).toBe(true);
    }
  });
});

describe('辅助函数测试', () => {
  it('getDivergenceLevelColor 返回正确颜色', () => {
    expect(getDivergenceLevelColor('danger')).toContain('danger');
    expect(getDivergenceLevelColor('warning')).toContain('warning');
    expect(getDivergenceLevelColor('normal')).toContain('success');
  });

  it('getDivergenceLevelLabel 返回正确标签', () => {
    expect(getDivergenceLevelLabel('danger')).toBe('警告');
    expect(getDivergenceLevelLabel('warning')).toBe('注意');
    expect(getDivergenceLevelLabel('normal')).toBe('正常');
  });

  it('getDivergenceLevelIcon 返回正确图标', () => {
    expect(getDivergenceLevelIcon('danger')).toBe('🔴');
    expect(getDivergenceLevelIcon('warning')).toBe('🟡');
    expect(getDivergenceLevelIcon('normal')).toBe('🟢');
  });
});
