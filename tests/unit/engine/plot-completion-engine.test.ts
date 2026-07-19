import { describe, it, expect, beforeEach } from 'vitest';
import {
  PlotCompletionEngine,
  getScoreColorClass,
  getScoreLabel,
} from '../../../engine/plot-completion-engine';
import type { PlotCompletionResult } from '../../../engine/plot-completion-engine';

function makeLongText(base: string, targetLen: number): string {
  let result = '';
  while (result.length < targetLen) {
    result += base + '\n\n';
  }
  return result;
}

describe('PlotCompletionEngine — 构造与配置', () => {
  it('默认构造函数不报错', () => {
    const engine = new PlotCompletionEngine();
    expect(engine).toBeDefined();
  });

  it('接受完整配置选项', () => {
    const engine = new PlotCompletionEngine({
      characterNames: ['林惊鸿', '苏白'],
      mainlineKeywords: ['复仇', '修仙'],
      chapterOutline: '主角踏上复仇之路',
      foreshadowPlanted: 3,
      foreshadowRevealed: 1,
    });
    expect(engine).toBeDefined();
  });

  it('updateOptions 可更新配置', () => {
    const engine = new PlotCompletionEngine({ characterNames: ['甲'] });
    engine.updateOptions({ characterNames: ['乙'], mainlineKeywords: ['主线'] });
    const result = engine.evaluate('乙出现在场景中，主线剧情推进。'.repeat(20));
    expect(result.wordCount).toBeGreaterThan(50);
  });
});

describe('PlotCompletionEngine — 边界情况', () => {
  it('空字符串返回空结果', () => {
    const engine = new PlotCompletionEngine();
    const result = engine.evaluate('');
    expect(result.wordCount).toBe(0);
    expect(result.overallCompletion.score).toBe(0);
    expect(result.sceneCompletion.score).toBe(0);
  });

  it('少于50字返回空结果', () => {
    const engine = new PlotCompletionEngine();
    const result = engine.evaluate('只有几十个字');
    expect(result.wordCount).toBeLessThan(50);
    expect(result.overallCompletion.score).toBe(0);
  });

  it('恰好50字以上正常评估', () => {
    const engine = new PlotCompletionEngine();
    const text = '这是一段用于测试剧情完成度引擎的文本内容，长度应该足够超过五十个字，以便系统能够正常进行评估工作，确保各项指标都被正确计算。';
    const result = engine.evaluate(text);
    expect(result.wordCount).toBeGreaterThanOrEqual(50);
    expect(result.overallCompletion.score).toBeGreaterThanOrEqual(0);
  });

  it('含 frontmatter 的文本会被清理', () => {
    const engine = new PlotCompletionEngine();
    const text = '---\ntitle: 测试\n---\n' + '正文内容很长，'.repeat(20);
    const result = engine.evaluate(text);
    expect(result.wordCount).toBeGreaterThan(50);
    expect(result.overallCompletion.score).toBeGreaterThanOrEqual(0);
  });

  it('超长文本（3000字以上）正常处理且不会崩溃', () => {
    const engine = new PlotCompletionEngine();
    const longText = makeLongText(
      '清晨的阳光洒在森林中，林惊鸿站在山顶，心中决定要去完成复仇的任务。' +
      '但是路途艰险，不料遇到了许多阻碍。他一路冲杀，终于在黄昏时分到达目的地。' +
      '苏白在一旁说道："你终于来了。"林惊鸿冷静地回答："是的，我来完成我的使命。"',
      3500
    );
    const result = engine.evaluate(longText);
    expect(result.wordCount).toBeGreaterThan(3000);
    expect(result.overallCompletion.score).toBeGreaterThanOrEqual(0);
    expect(result.overallCompletion.score).toBeLessThanOrEqual(100);
  });
});

describe('PlotCompletionEngine — 七维度评分', () => {
  let engine: PlotCompletionEngine;

  beforeEach(() => {
    engine = new PlotCompletionEngine({
      characterNames: ['林惊鸿', '苏白'],
      mainlineKeywords: ['复仇', '修仙', '真相'],
      chapterOutline: '林惊鸿为了复仇踏上修仙之路，逐步揭开真相',
      foreshadowPlanted: 5,
      foreshadowRevealed: 2,
    });
  });

  it('场景维度：丰富场景描写得分更高', () => {
    const richScene =
      '清晨的阳光洒在古老的宫殿中，温暖而明亮。\n\n' +
      '林惊鸿站在大厅里，四周弥漫着淡淡的花香，空气中透着紧张的氛围。\n\n' +
      '黄昏时分，他来到海边，海风呼啸，波涛汹涌。';
    const poorScene = '林惊鸿走了进来，然后坐下说话。';
    const richResult = engine.evaluate(richScene.repeat(3));
    const poorResult = engine.evaluate(poorScene.repeat(20));
    expect(richResult.sceneCompletion.score).toBeGreaterThan(poorResult.sceneCompletion.score);
  });

  it('目标维度：有明确目标-阻碍-结果结构得分高', () => {
    const text =
      '林惊鸿决定要去完成复仇的目标，任务是找到仇人。\n\n' +
      '但是路途艰险，不料遇到了许多阻碍，遭到敌人的伏击。\n\n' +
      '经过一番苦战，他终于成功击败了对手，完成了阶段性的任务。';
    const result = engine.evaluate(text.repeat(5));
    expect(result.goalCompletion.score).toBeGreaterThan(30);
    expect(result.goalCompletion.details.goalIndicators).toBeDefined();
  });

  it('人物维度：指定角色名时能正确统计出场', () => {
    const text =
      '林惊鸿走了进来。林惊鸿说："你好。"\n\n' +
      '苏白回答道："你也来了。"\n\n' +
      '林惊鸿点了点头，苏白笑了笑。';
    const result = engine.evaluate(text.repeat(10));
    expect(result.characterEngagement.details.characterMentions).toBeGreaterThan(0);
    expect(result.characterEngagement.score).toBeGreaterThan(0);
  });

  it('人物维度：无角色名时基于对话标记估算', () => {
    const engineNoNames = new PlotCompletionEngine();
    const text = '张三说："你好。"李四道："也好。"王五问："去哪？"赵六答："回家。"';
    const result = engineNoNames.evaluate(text.repeat(10));
    expect(result.characterEngagement.details.estimation).toBe('基于对话标记估算');
    expect(result.characterEngagement.score).toBeGreaterThan(0);
  });

  it('伏笔维度：埋设与回收都有得分更高', () => {
    const text =
      '据说这座山中有一件神秘的宝物，没人知道它的来历。\n\n' +
      '林惊鸿心中暗想，总有一天他会找到答案。\n\n' +
      '后来他终于明白，原来这就是当年的真相。';
    const result = engine.evaluate(text.repeat(10));
    expect(result.foreshadowProgress.details.detectedForeshadows).toBeGreaterThan(0);
    expect(result.foreshadowProgress.details.detectedReveals).toBeGreaterThan(0);
    expect(result.foreshadowProgress.score).toBeGreaterThan(0);
  });

  it('情绪弧维度：多段落情绪变化得分高', () => {
    const paragraphs = [
      '平静的一天，林惊鸿心中安宁。',
      '突然传来消息，他感到一阵紧张和担忧。',
      '敌人出现了，他心中充满了愤怒和恐惧。',
      '战斗达到高潮，他震惊地发现了真相。',
      '战斗结束后，他感到一丝欣慰和轻松。',
    ];
    const text = paragraphs.join('\n\n').repeat(3);
    const result = engine.evaluate(text);
    expect(result.emotionArcProgress.score).toBeGreaterThan(0);
    expect(result.emotionArcProgress.details.startIntensity).toBeDefined();
  });

  it('情节牵引维度：主线关键词匹配得分高', () => {
    const textWithMainline = '复仇的火焰在他心中燃烧，修仙之路漫漫，真相逐渐浮出水面。';
    const textWithout = '今天天气不错，他出去散步了。';
    const resultWith = engine.evaluate(textWithMainline.repeat(20));
    const resultWithout = engine.evaluate(textWithout.repeat(20));
    expect(resultWith.plotTraction.score).toBeGreaterThan(resultWithout.plotTraction.score);
  });

  it('综合得分在合理范围内', () => {
    const text =
      '清晨，林惊鸿站在宫殿中，决定踏上复仇之路。' +
      '但是路上遇到了许多阻碍，遭到敌人的伏击。' +
      '经过一番苦战，他终于成功击败了对手。' +
      '苏白在一旁说道："你做得很好。"';
    const result = engine.evaluate(text.repeat(10));
    expect(result.overallCompletion.score).toBeGreaterThanOrEqual(0);
    expect(result.overallCompletion.score).toBeLessThanOrEqual(100);
    expect(result.overallCompletion.suggestions.length).toBeGreaterThan(0);
  });
});

describe('PlotCompletionEngine — 结果结构', () => {
  it('返回完整的七维度结果结构', () => {
    const engine = new PlotCompletionEngine();
    const result = engine.evaluate('这是一段足够长的测试文本，用于验证结果结构的完整性。'.repeat(10));
    expect(result).toHaveProperty('sceneCompletion');
    expect(result).toHaveProperty('goalCompletion');
    expect(result).toHaveProperty('characterEngagement');
    expect(result).toHaveProperty('foreshadowProgress');
    expect(result).toHaveProperty('emotionArcProgress');
    expect(result).toHaveProperty('overallCompletion');
    expect(result).toHaveProperty('plotTraction');
    expect(result).toHaveProperty('evaluatedAt');
    expect(result).toHaveProperty('wordCount');
    expect(typeof result.evaluatedAt).toBe('number');
  });

  it('每个维度都包含 score、details、suggestions', () => {
    const engine = new PlotCompletionEngine();
    const result: PlotCompletionResult = engine.evaluate(
      '测试文本内容足够长，包含多个维度的要素。'.repeat(10)
    );
    const dims = [
      result.sceneCompletion,
      result.goalCompletion,
      result.characterEngagement,
      result.foreshadowProgress,
      result.emotionArcProgress,
      result.overallCompletion,
      result.plotTraction,
    ];
    for (const dim of dims) {
      expect(typeof dim.score).toBe('number');
      expect(dim.score).toBeGreaterThanOrEqual(0);
      expect(dim.score).toBeLessThanOrEqual(100);
      expect(typeof dim.details).toBe('object');
      expect(Array.isArray(dim.suggestions)).toBe(true);
    }
  });
});

describe('getScoreColorClass — 辅助函数', () => {
  it('高分返回 ok 类', () => {
    expect(getScoreColorClass(80)).toBe('nw-float-ok');
    expect(getScoreColorClass(70)).toBe('nw-float-ok');
  });

  it('中等分数返回 warn 类', () => {
    expect(getScoreColorClass(50)).toBe('nw-float-warn-text');
    expect(getScoreColorClass(40)).toBe('nw-float-warn-text');
  });

  it('低分返回 danger 类', () => {
    expect(getScoreColorClass(30)).toBe('nw-float-danger');
    expect(getScoreColorClass(0)).toBe('nw-float-danger');
  });
});

describe('getScoreLabel — 辅助函数', () => {
  it('各分数段返回对应标签', () => {
    expect(getScoreLabel(90)).toBe('优秀');
    expect(getScoreLabel(85)).toBe('优秀');
    expect(getScoreLabel(75)).toBe('良好');
    expect(getScoreLabel(70)).toBe('良好');
    expect(getScoreLabel(60)).toBe('中等');
    expect(getScoreLabel(55)).toBe('中等');
    expect(getScoreLabel(45)).toBe('待加强');
    expect(getScoreLabel(40)).toBe('待加强');
    expect(getScoreLabel(25)).toBe('薄弱');
    expect(getScoreLabel(20)).toBe('薄弱');
    expect(getScoreLabel(10)).toBe('待开始');
    expect(getScoreLabel(0)).toBe('待开始');
  });
});
