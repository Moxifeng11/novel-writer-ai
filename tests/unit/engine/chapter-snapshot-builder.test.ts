import { describe, it, expect } from 'vitest';
import { ChapterSnapshotBuilder } from '../../../engine/chapter-snapshot-builder';
import type { GatheredContext } from '../../../engine/context/context-types';

function emptyContext(overrides: Partial<GatheredContext['data']> = {}): GatheredContext {
  return {
    project: 'demo',
    gatheredAt: new Date().toISOString(),
    data: { ...overrides },
    issues: [],
  };
}

describe('ChapterSnapshotBuilder — 基础构造与降级', () => {
  it('默认构造函数不报错', () => {
    const builder = new ChapterSnapshotBuilder();
    expect(builder).toBeDefined();
  });

  it('空上下文时返回带默认空字段的快照，不抛异常', () => {
    const builder = new ChapterSnapshotBuilder();
    const snap = builder.buildFromContext(5, emptyContext());
    expect(snap.chapterNumber).toBe(5);
    expect(snap.characterStates).toEqual([]);
    expect(snap.requiredReveals).toEqual([]);
    expect(snap.forbiddenReveals).toEqual([]);
    expect(snap.timeline).toEqual({ time: '', location: '' });
    expect(snap.previousEnding.action).toBe('');
  });
});

describe('ChapterSnapshotBuilder — 数据映射', () => {
  it('从 character_state 映射 characterStates', () => {
    const builder = new ChapterSnapshotBuilder();
    const ctx = emptyContext({
      character_state: [
        {
          姓名: '林惊鸿',
          当前情绪: '愤怒',
          当前状态: '左臂受伤',
          当前目标: '复仇',
          核心驱动力_软肋: '妹妹的死',
          所属势力: '天剑门',
        } as any,
      ],
    });
    const snap = builder.buildFromContext(1, ctx);
    expect(snap.characterStates).toHaveLength(1);
    const c = snap.characterStates[0];
    expect(c.name).toBe('林惊鸿');
    expect(c.emotion).toBe('愤怒');
    expect(c.injury).toBe('左臂受伤');
    expect(c.goal).toBe('复仇');
    expect(c.secret).toBe('妹妹的死');
    expect(c.relationships).toBe('天剑门');
  });

  it('姓名缺失时回退到 name 字段', () => {
    const builder = new ChapterSnapshotBuilder();
    const ctx = emptyContext({
      character_state: [{ name: 'Alice' } as any],
    });
    const snap = builder.buildFromContext(1, ctx);
    expect(snap.characterStates[0].name).toBe('Alice');
  });

  it('从 timeline 取匹配章节的时间与地点', () => {
    const builder = new ChapterSnapshotBuilder();
    const ctx = emptyContext({
      timeline: [
        { time: '第一天', chapter: '2', event: 'e', impact: 'i', location: '山谷' },
        { time: '第三天', chapter: '3', event: 'e', impact: 'i', location: '城门' },
      ],
    });
    const snap = builder.buildFromContext(3, ctx);
    expect(snap.timeline).toEqual({ time: '第三天', location: '城门' });
  });

  it('从 foreshadows 映射 requiredReveals 与 forbiddenReveals', () => {
    const builder = new ChapterSnapshotBuilder();
    const ctx = emptyContext({
      foreshadows: {
        unrevealed: [
          { id: 'f1', name: '身世之谜', plannedReveal: '3' },
          { id: 'f2', name: '神秘信物', plannedReveal: '10' },
        ],
        revealed: [],
        abandoned: [],
      },
    });
    const snap = builder.buildFromContext(3, ctx);
    expect(snap.requiredReveals).toContain('身世之谜');
    expect(snap.forbiddenReveals).toContain('神秘信物');
    expect(snap.requiredReveals).not.toContain('神秘信物');
  });

  it('从 previous_chapter 映射 previousEnding', () => {
    const builder = new ChapterSnapshotBuilder();
    const ctx = emptyContext({
      previous_chapter: {
        chapterNumber: 4,
        content: null,
        outline: null,
        ending: '主角推开门，看见血泊中的师父',
        analysisReport: null,
        continuityReview: null,
        infoPlan: null,
        bodySummary: null,
      },
    });
    const snap = builder.buildFromContext(5, ctx);
    expect(snap.previousEnding.action).toBe('主角推开门，看见血泊中的师父');
  });
});

describe('ChapterSnapshotBuilder — 章节规划五字段接入（checklist 待补项）', () => {
  const PLAN = [
    '视角：林晚',
    '本章目标：查清玉佩来历',
    '核心冲突：林晚与萧然的信任危机',
    '- 事件：林晚潜入书房取证',
    '- 必须推进：萧然发现林晚行踪',
    '- 冲突：两人在书房对峙',
    '验收标准：',
    '- 玉佩线索必须向前推进',
    '- 萧然立场不可软化',
  ].join('\n');

  it('从 chapterPlan 解析 povCharacter / mainGoal / coreConflict', () => {
    const snap = new ChapterSnapshotBuilder().buildFromContext(1, emptyContext(), { chapterPlan: PLAN });
    expect(snap.povCharacter).toBe('林晚');
    expect(snap.mainGoal).toBe('查清玉佩来历');
    expect(snap.coreConflict).toBe('林晚与萧然的信任危机');
  });

  it('requiredBeats 复用 StoryBeatExtractor，仅取 required=true 的必做剧情', () => {
    const snap = new ChapterSnapshotBuilder().buildFromContext(1, emptyContext(), { chapterPlan: PLAN });
    expect(snap.requiredBeats).toContain('必须推进：萧然发现林晚行踪');
    expect(snap.requiredBeats).not.toContain('两人在书房对峙');
    expect(snap.requiredBeats).not.toContain('林晚潜入书房取证');
  });

  it('acceptanceCriteria 从「验收标准」小节提取列表项', () => {
    const snap = new ChapterSnapshotBuilder().buildFromContext(1, emptyContext(), { chapterPlan: PLAN });
    expect(snap.acceptanceCriteria).toContain('玉佩线索必须向前推进');
    expect(snap.acceptanceCriteria).toContain('萧然立场不可软化');
  });

  it('无 chapterPlan 时五字段留空（降级不抛异常）', () => {
    const snap = new ChapterSnapshotBuilder().buildFromContext(1, emptyContext());
    expect(snap.povCharacter).toBe('');
    expect(snap.mainGoal).toBe('');
    expect(snap.coreConflict).toBe('');
    expect(snap.requiredBeats).toEqual([]);
    expect(snap.acceptanceCriteria).toEqual([]);
  });

  it('规划文本存在但无对应字段时留空', () => {
    const snap = new ChapterSnapshotBuilder().buildFromContext(1, emptyContext(), { chapterPlan: '其他内容，无规划字段' });
    expect(snap.povCharacter).toBe('');
    expect(snap.mainGoal).toBe('');
    expect(snap.acceptanceCriteria).toEqual([]);
  });

  it('验收标准支持单行内联形式', () => {
    const snap = new ChapterSnapshotBuilder().buildFromContext(1, emptyContext(), {
      chapterPlan: '验收：玉佩线索必须推进',
    });
    expect(snap.acceptanceCriteria).toContain('玉佩线索必须推进');
  });
});
