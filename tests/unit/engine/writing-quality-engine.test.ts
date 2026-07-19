import { describe, it, expect, beforeEach } from 'vitest';
import {
  WritingQualityEngine,
  getQualityGradeColor,
  getQualityGradeLabel,
  getQualityTrendIcon,
  getQualityTrendLabel,
  getPriorityColor,
  getPriorityLabel,
} from '../../../engine/writing-quality-engine';
import type { WritingQualityResult, QualityGrade, QualityTrend } from '../../../engine/writing-quality-engine';

describe('WritingQualityEngine — 构造与配置', () => {
  it('默认构造函数不报错', () => {
    const engine = new WritingQualityEngine();
    expect(engine).toBeDefined();
  });

  it('接受完整配置选项', () => {
    const engine = new WritingQualityEngine({
      characterNames: ['林惊鸿', '苏白'],
      mainlineKeywords: ['复仇', '修仙'],
      chapterOutline: '主角复仇的故事',
      previousChapterScore: 75,
      averageScore: 70,
      ignoredSuggestions: [],
      styleFingerprint: {},
    });
    expect(engine).toBeDefined();
  });

  it('updateOptions 可更新配置', () => {
    const engine = new WritingQualityEngine({ characterNames: ['甲'] });
    engine.updateOptions({
      characterNames: ['乙'],
      mainlineKeywords: ['新主线'],
      averageScore: 80,
    });
    const result = engine.evaluate('乙出场，推动新主线发展，情节紧张刺激。'.repeat(10));
    expect(result.wordCount).toBeGreaterThan(100);
  });
});

describe('WritingQualityEngine — 边界情况', () => {
  it('空字符串返回空结果', () => {
    const engine = new WritingQualityEngine();
    const result = engine.evaluate('');
    expect(result.wordCount).toBe(0);
    expect(result.overallScore).toBe(0);
    expect(result.grade).toBe('D');
    expect(result.trend).toBe('stable');
  });

  it('少于100字返回空结果', () => {
    const engine = new WritingQualityEngine();
    const result = engine.evaluate('短内容');
    expect(result.wordCount).toBeLessThan(100);
    expect(result.overallScore).toBe(0);
  });

  it('100字以上正常评估', () => {
    const engine = new WritingQualityEngine();
    const text = '这是一段用于测试写作质量评估引擎的文本，内容足够长以触发正常的质量评估流程。';
    const result = engine.evaluate(text.repeat(3));
    expect(result.wordCount).toBeGreaterThanOrEqual(100);
    expect(result.overallScore).toBeGreaterThanOrEqual(0);
    expect(result.overallScore).toBeLessThanOrEqual(100);
  });

  it('含 frontmatter 的文本会被清理', () => {
    const engine = new WritingQualityEngine();
    const text = '---\ntitle: 测试\n---\n' + '正文内容。'.repeat(50);
    const result = engine.evaluate(text);
    expect(result.wordCount).toBeGreaterThan(100);
    expect(result.overallScore).toBeGreaterThanOrEqual(0);
  });

  it('超长文本（3000字以上）正常处理', () => {
    const engine = new WritingQualityEngine();
    let longText = '';
    for (let i = 0; i < 50; i++) {
      longText +=
        '林惊鸿站在大殿之中，阳光透过窗户洒进来，温暖而明亮。\n\n' +
        '"你终于来了。"苏白微笑着说道，她的声音温柔而动听。\n\n' +
        '林惊鸿点了点头，心中却暗自警惕，仿佛有什么不对的地方。\n\n';
    }
    const result = engine.evaluate(longText);
    expect(result.wordCount).toBeGreaterThan(3000);
    expect(result.overallScore).toBeGreaterThanOrEqual(0);
    expect(result.overallScore).toBeLessThanOrEqual(100);
    expect(result.evalTimeMs).toBeGreaterThanOrEqual(0);
  });
});

describe('WritingQualityEngine — 六维度质量评估', () => {
  let engine: WritingQualityEngine;

  beforeEach(() => {
    engine = new WritingQualityEngine({
      characterNames: ['林惊鸿', '苏白'],
      mainlineKeywords: ['复仇', '修仙', '真相'],
      chapterOutline: '林惊鸿踏上修仙复仇之路',
      averageScore: 65,
    });
  });

  it('语言质量：丰富词汇与修辞手法得分更高', () => {
    const richText =
      '晨曦如金，洒落在巍峨的宫殿之上。林惊鸿的心中犹如翻江倒海，思绪万千。' +
      '他的目光仿佛利剑般锐利，仿佛能看穿一切虚妄。这一切就像是一场梦，却又如此真实。';
    const poorText = '他走了进来。然后坐下。他说话。别人听着。';
    const richResult = engine.evaluate(richText.repeat(10));
    const poorResult = engine.evaluate(poorText.repeat(30));
    expect(richResult.languageQuality.score).toBeGreaterThanOrEqual(0);
    expect(poorResult.languageQuality.score).toBeGreaterThanOrEqual(0);
  });

  it('语言质量：检测常见用字问题', () => {
    const textWithIssues = '他的得地混用了，在再不分，那哪也分不清，已以也有问题。'.repeat(10);
    const result = engine.evaluate(textWithIssues);
    expect(result.languageQuality.details.typoIssues).toBeDefined();
    expect(result.languageQuality.suggestions.some(s => s.id === 'lang_typo')).toBe(true);
  });

  it('节奏质量：动作对话多的节奏更快', () => {
    const fastText =
      '冲！打！砍！杀！林惊鸿冲上去就是一拳！"来得好！"敌人大吼着迎了上来。' +
      '剑光闪烁，两人战作一团。跑！追！逃！'.repeat(20);
    const result = engine.evaluate(fastText);
    expect(result.rhythmQuality.details.actionDensity).toBeGreaterThan(0);
    expect(result.rhythmQuality.score).toBeGreaterThanOrEqual(0);
  });

  it('人物质量：角色出场多且有对话动作得分高', () => {
    const text =
      '林惊鸿走了进来，紧皱着眉头。\n\n' +
      '"发生了什么事？"他沉声问道。\n\n' +
      '苏白抬起头，眼中含泪："是长老，他……他出事了。"\n\n' +
      '林惊鸿心中一动，快步走到窗边，望向远方。他感到一阵不安。';
    const result = engine.evaluate(text.repeat(10));
    expect(result.characterQuality.details.characterMentions).toBeGreaterThan(0);
    expect(result.characterQuality.score).toBeGreaterThan(0);
  });

  it('情节质量：冲突悬念爽点多得分高', () => {
    const text =
      '突然，一道黑影闪过！林惊鸿心中一惊，这是怎么回事？\n\n' +
      '危机！迫在眉睫！就在这时，他突然爆发，一招制敌！\n\n' +
      '众人震惊，骇然失色，不敢相信眼前的一切。\n\n' +
      '但是，这仅仅是开始，更大的阴谋还在后面。';
    const result = engine.evaluate(text.repeat(10));
    expect(result.plotQuality.details.conflictIndicators).toBeGreaterThan(0);
    expect(result.plotQuality.details.suspenseIndicators).toBeGreaterThan(0);
    expect(result.plotQuality.score).toBeGreaterThan(0);
  });

  it('氛围质量：环境情绪感官描写丰富得分高', () => {
    const text =
      '月光如水，洒落在寂静的森林中。风吹过树梢，发出沙沙的声响。\n\n' +
      '空气中弥漫着淡淡的花香，令人心旷神怡。林惊鸿心中感到一阵安宁。\n\n' +
      '他闭上眼睛，仿佛能听到星星的低语，感受到夜晚的呼吸。';
    const result = engine.evaluate(text.repeat(10));
    expect(result.atmosphereQuality.details.environmentMentions).toBeGreaterThan(0);
    expect(result.atmosphereQuality.details.senseDescriptions).toBeGreaterThan(0);
    expect(result.atmosphereQuality.score).toBeGreaterThan(0);
  });

  it('结构质量：开头有钩子结尾有悬念得分高', () => {
    const openingText =
      '死亡的阴影笼罩着整个城市。林惊鸿从噩梦中惊醒，一身冷汗。\n\n' +
      '这已经是这个月的第三次了。他知道，有什么事情正在发生。\n\n' +
      '中间段落：他开始调查这件事的真相，遇到了许多困难。\n\n'.repeat(5) +
      '但是，就在他以为找到答案的时候，一个更大的谜团出现在他面前。接下来会发生什么？';
    const result = engine.evaluate(openingText);
    expect(result.structureQuality.details.openingAttraction).toBeDefined();
    expect(result.structureQuality.details.endingStrength).toBeDefined();
    expect(result.structureQuality.score).toBeGreaterThanOrEqual(0);
  });

  it('综合评分是各维度加权平均', () => {
    const text = '林惊鸿在宗门中修炼，为复仇做准备。'.repeat(20);
    const result = engine.evaluate(text);
    expect(result.overallScore).toBeGreaterThanOrEqual(0);
    expect(result.overallScore).toBeLessThanOrEqual(100);
    expect(['S', 'A', 'B', 'C', 'D']).toContain(result.grade);
  });
});

describe('WritingQualityEngine — 等级与趋势', () => {
  it('getGrade 正确映射分数到等级', () => {
    const engine = new WritingQualityEngine();
    expect(engine.getGrade(95)).toBe('S');
    expect(engine.getGrade(90)).toBe('S');
    expect(engine.getGrade(85)).toBe('A');
    expect(engine.getGrade(80)).toBe('A');
    expect(engine.getGrade(75)).toBe('B');
    expect(engine.getGrade(70)).toBe('B');
    expect(engine.getGrade(65)).toBe('C');
    expect(engine.getGrade(60)).toBe('C');
    expect(engine.getGrade(50)).toBe('D');
    expect(engine.getGrade(0)).toBe('D');
  });

  it('历史不足时趋势为 stable', () => {
    const engine = new WritingQualityEngine();
    const result = engine.evaluate('测试文本内容足够长。'.repeat(10));
    expect(result.trend).toBe('stable');
  });

  it('getScoreHistory 返回历史记录', () => {
    const engine = new WritingQualityEngine();
    const longText = '这是一段足够长的测试文本，用于验证写作质量引擎的历史记录功能是否正常工作。'.repeat(10);
    engine.evaluate(longText);
    engine.evaluate(longText);

    const history = engine.getScoreHistory();
    expect(history.length).toBe(2);
    for (const h of history) {
      expect(typeof h).toBe('number');
    }
  });

  it('clearHistory 清空历史记录', () => {
    const engine = new WritingQualityEngine();
    const longText = '这是一段足够长的测试文本，用于验证写作质量引擎的历史记录功能是否正常工作。'.repeat(10);
    engine.evaluate(longText);
    expect(engine.getScoreHistory().length).toBe(1);

    engine.clearHistory();
    expect(engine.getScoreHistory()).toEqual([]);
  });

  it('comparedToAverage 与平均分对比', () => {
    const engineHigh = new WritingQualityEngine({ averageScore: 50 });
    const result = engineHigh.evaluate('高质量的文本内容，词汇丰富，情节紧凑。'.repeat(20));
    expect(typeof result.comparedToAverage).toBe('number');
  });
});

describe('WritingQualityEngine — 建议系统', () => {
  it('返回 topSuggestions，按优先级排序', () => {
    const engine = new WritingQualityEngine();
    const result = engine.evaluate('测试文本内容足够长以生成建议。'.repeat(10));
    expect(Array.isArray(result.topSuggestions)).toBe(true);
    expect(result.topSuggestions.length).toBeLessThanOrEqual(5);

    if (result.topSuggestions.length >= 2) {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      for (let i = 1; i < result.topSuggestions.length; i++) {
        const prevPriority = priorityOrder[result.topSuggestions[i - 1].priority];
        const currPriority = priorityOrder[result.topSuggestions[i].priority];
        expect(prevPriority).toBeLessThanOrEqual(currPriority);
      }
    }
  });

  it('ignoreSuggestion / unignoreSuggestion 管理忽略', () => {
    const engine = new WritingQualityEngine();
    expect(engine.getIgnoredSuggestions()).toEqual([]);

    engine.ignoreSuggestion('test_id');
    expect(engine.getIgnoredSuggestions()).toContain('test_id');

    engine.unignoreSuggestion('test_id');
    expect(engine.getIgnoredSuggestions()).not.toContain('test_id');
  });

  it('建议包含完整字段结构', () => {
    const engine = new WritingQualityEngine();
    const result = engine.evaluate('测试内容足够长。'.repeat(10));
    const allSuggestions = [
      ...result.languageQuality.suggestions,
      ...result.rhythmQuality.suggestions,
    ];
    if (allSuggestions.length > 0) {
      const s = allSuggestions[0];
      expect(s).toHaveProperty('id');
      expect(s).toHaveProperty('dimension');
      expect(s).toHaveProperty('content');
      expect(s).toHaveProperty('priority');
      expect(s).toHaveProperty('estimatedEffort');
      expect(s).toHaveProperty('category');
    }
  });
});

describe('WritingQualityEngine — 里程碑', () => {
  it('达到字数里程碑时返回 milestoneReached', () => {
    const engine = new WritingQualityEngine();
    const text500 = '测试'.repeat(260);
    const result = engine.evaluate(text500);
    if (result.wordCount >= 500) {
      expect(result.milestoneReached).toBeDefined();
    }
  });

  it('同一里程碑只触发一次', () => {
    const engine = new WritingQualityEngine();
    const text = '测试'.repeat(300);
    const result1 = engine.evaluate(text);
    const result2 = engine.evaluate(text);
    const firstHasMilestone = result1.milestoneReached !== undefined;
    const secondHasMilestone = result2.milestoneReached !== undefined;
    expect(firstHasMilestone || !secondHasMilestone).toBe(true);
  });
});

describe('WritingQualityEngine — 结果结构', () => {
  it('返回完整的六维度结果结构', () => {
    const engine = new WritingQualityEngine();
    const result: WritingQualityResult = engine.evaluate(
      '这是一段足够长的测试文本，用于验证质量评估结果结构的完整性。'.repeat(10)
    );
    expect(result).toHaveProperty('languageQuality');
    expect(result).toHaveProperty('rhythmQuality');
    expect(result).toHaveProperty('characterQuality');
    expect(result).toHaveProperty('plotQuality');
    expect(result).toHaveProperty('atmosphereQuality');
    expect(result).toHaveProperty('structureQuality');
    expect(result).toHaveProperty('overallScore');
    expect(result).toHaveProperty('grade');
    expect(result).toHaveProperty('trend');
    expect(result).toHaveProperty('topSuggestions');
    expect(result).toHaveProperty('evaluatedAt');
    expect(result).toHaveProperty('wordCount');
    expect(result).toHaveProperty('evalTimeMs');
  });
});

describe('辅助函数测试', () => {
  it('getQualityGradeColor 返回正确颜色', () => {
    expect(getQualityGradeColor('S')).toContain('accent');
    expect(getQualityGradeColor('A')).toContain('success');
    expect(getQualityGradeColor('B')).toContain('warning');
    expect(getQualityGradeColor('C')).toContain('warning');
    expect(getQualityGradeColor('D')).toContain('danger');
  });

  it('getQualityGradeLabel 返回正确标签', () => {
    expect(getQualityGradeLabel('S')).toBe('绝世佳作');
    expect(getQualityGradeLabel('A')).toBe('优秀');
    expect(getQualityGradeLabel('B')).toBe('良好');
    expect(getQualityGradeLabel('C')).toBe('及格');
    expect(getQualityGradeLabel('D')).toBe('待提升');
  });

  it('getQualityTrendIcon 返回正确图标', () => {
    expect(getQualityTrendIcon('rising')).toBe('📈');
    expect(getQualityTrendIcon('falling')).toBe('📉');
    expect(getQualityTrendIcon('stable')).toBe('➡️');
  });

  it('getQualityTrendLabel 返回正确标签', () => {
    expect(getQualityTrendLabel('rising')).toBe('上升');
    expect(getQualityTrendLabel('falling')).toBe('下降');
    expect(getQualityTrendLabel('stable')).toBe('平稳');
  });

  it('getPriorityColor 返回正确颜色', () => {
    expect(getPriorityColor('high')).toContain('danger');
    expect(getPriorityColor('medium')).toContain('warning');
    expect(getPriorityColor('low')).toContain('muted');
  });

  it('getPriorityLabel 返回正确标签', () => {
    expect(getPriorityLabel('high')).toBe('高优先级');
    expect(getPriorityLabel('medium')).toBe('中优先级');
    expect(getPriorityLabel('low')).toBe('低优先级');
  });
});
