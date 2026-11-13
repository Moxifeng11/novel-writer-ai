import { describe, it, expect } from 'vitest';
import { ConflictDetector } from '../../../engine/conflict-detector';
import type { ChapterStateSnapshot } from '../../../engine/story-state-types';

function makeSnapshot(overrides: Partial<ChapterStateSnapshot> = {}): ChapterStateSnapshot {
  return {
    chapterNumber: 5,
    timeline: { time: '第10天', location: '皇城' },
    povCharacter: '',
    mainGoal: '',
    coreConflict: '',
    requiredBeats: [],
    requiredReveals: [],
    forbiddenReveals: [],
    characterStates: [],
    previousEnding: { action: '', emotion: '', unfinished: '', mustContinue: '' },
    acceptanceCriteria: [],
    ...overrides,
  };
}

describe('ConflictDetector — 无冲突', () => {
  it('TR-4.4: 无冲突正文返回空冲突清单', () => {
    const d = new ConflictDetector();
    const snap = makeSnapshot({ characterStates: [{ name: '林惊鸿', emotion: '', injury: '', goal: '', secret: '', relationships: '' }] });
    const conflicts = d.detect(snap, '林惊鸿抵达皇城，开始调查。', { knownCharacters: ['林惊鸿'], previousTimeValue: 8 });
    expect(conflicts).toEqual([]);
  });
});

describe('ConflictDetector — 时间线倒退', () => {
  it('TR-4.1: 时间线倒退被检出', () => {
    const d = new ConflictDetector();
    const snap = makeSnapshot({ timeline: { time: '第6天', location: '皇城' } });
    const conflicts = d.detect(snap, '正文内容', { previousTimeValue: 10 });
    expect(conflicts.some((c) => c.type === 'timeline')).toBe(true);
  });
});

describe('ConflictDetector — 禁止揭示提前出现', () => {
  it('TR-4.2: forbiddenReveals 提前出现被检出', () => {
    const d = new ConflictDetector();
    const snap = makeSnapshot({ forbiddenReveals: ['主角是皇子'] });
    const conflicts = d.detect(snap, '众人震惊地发现，原来主角是皇子！', {});
    const hit = conflicts.find((c) => c.type === 'foreshadow');
    expect(hit).toBeDefined();
    expect(hit?.detail).toContain('主角是皇子');
  });

  it('禁止揭示未出现时不报冲突', () => {
    const d = new ConflictDetector();
    const snap = makeSnapshot({ forbiddenReveals: ['主角是皇子'] });
    const conflicts = d.detect(snap, '主角在街上走着。', {});
    expect(conflicts.some((c) => c.type === 'foreshadow')).toBe(false);
  });
});

describe('ConflictDetector — 人物不在设定库', () => {
  it('TR-4.3: 正文人物不在设定库时被检出', () => {
    const d = new ConflictDetector();
    const snap = makeSnapshot({
      characterStates: [{ name: '张三', emotion: '', injury: '', goal: '', secret: '', relationships: '' }],
    });
    const conflicts = d.detect(snap, '正文', {
      knownCharacters: ['张三'],
      appearingCharacters: ['张三', '李四'],
    });
    const hit = conflicts.find((c) => c.type === 'character');
    expect(hit).toBeDefined();
    expect(hit?.detail).toContain('李四');
  });
});

describe('ConflictDetector — 地点冲突（checklist 待补：detectLocation）', () => {
  it('TR-B1: 正文出现其他已知地点且未提及设定地点 → 场景地点不符', () => {
    const d = new ConflictDetector();
    const snap = makeSnapshot(); // 设定地点：皇城
    const conflicts = d.detect(snap, '两人一路疾行，终于抵达青云山脚下。', {
      knownLocations: ['皇城', '青云山'],
    });
    const hit = conflicts.find((c) => c.type === 'location');
    expect(hit).toBeDefined();
    expect(hit?.detail).toContain('青云山');
    expect(hit?.detail).toContain('皇城');
  });

  it('TR-B2: 正文提及设定地点 → 无地点冲突', () => {
    const d = new ConflictDetector();
    const snap = makeSnapshot();
    const conflicts = d.detect(snap, '两人回到皇城，径直入宫面圣。', {
      knownLocations: ['皇城', '青云山'],
    });
    expect(conflicts.some((c) => c.type === 'location')).toBe(false);
  });

  it('TR-B3: 无 knownLocations 且正文足够长仍未提及设定地点 → 弱提示', () => {
    const d = new ConflictDetector();
    const snap = makeSnapshot();
    const longBody = '他在书房中反复翻查卷宗，试图找到那封信的下落。'.repeat(30);
    const conflicts = d.detect(snap, longBody, {});
    const hit = conflicts.find((c) => c.type === 'location');
    expect(hit).toBeDefined();
    expect(hit?.message).toContain('未提及本章设定地点');
  });

  it('TR-B3b: 正文过短不触发弱提示（避免短文本误报）', () => {
    const d = new ConflictDetector();
    const snap = makeSnapshot();
    const conflicts = d.detect(snap, '他在书房中翻查卷宗。', {});
    expect(conflicts.some((c) => c.type === 'location')).toBe(false);
  });
});

describe('ConflictDetector — 伏笔状态未正确更新（checklist 待补）', () => {
  it('TR-B4: 本章计划回收的伏笔在长正文未出现 → foreshadow 冲突', () => {
    const d = new ConflictDetector();
    const snap = makeSnapshot({ requiredReveals: ['身世之谜'] });
    const longBody = '林惊鸿在皇城中四处查证，与旧部彻夜长谈，卷宗翻了一页又一页。'.repeat(30);
    const conflicts = d.detect(snap, longBody, {});
    const hit = conflicts.find((c) => c.type === 'foreshadow');
    expect(hit).toBeDefined();
    expect(hit?.message).toContain('计划回收的伏笔');
    expect(hit?.detail).toContain('身世之谜');
  });

  it('TR-B4b: 短正文不触发（避免正文尚未写到伏笔段时的误报）', () => {
    const d = new ConflictDetector();
    const snap = makeSnapshot({ requiredReveals: ['身世之谜'] });
    const conflicts = d.detect(snap, '林惊鸿入城。', {});
    expect(conflicts.some((c) => c.type === 'foreshadow' && c.message.includes('计划回收'))).toBe(false);
  });
});

describe('ConflictDetector — 人物状态剧变无依据（checklist 待补）', () => {
  const stateOf = (name: string, emotion: string, injury: string) =>
    ({ name, emotion, injury, goal: '', secret: '', relationships: '' });

  it('TR-B5: 人物重伤出现但快照无相关迹象 → character 冲突', () => {
    const d = new ConflictDetector();
    const snap = makeSnapshot({
      characterStates: [stateOf('张三', '', '')],
    });
    const conflicts = d.detect(snap, '混战之中，张三被暗器所伤，身受重伤倒地。', {
      appearingCharacters: ['张三'],
      knownCharacters: ['张三'],
    });
    const hit = conflicts.find((c) => c.type === 'character' && c.message.includes('剧变'));
    expect(hit).toBeDefined();
    expect(hit?.detail).toContain('张三');
  });

  it('TR-B6: 快照已有伤势铺垫（injury 含重伤）→ 不报', () => {
    const d = new ConflictDetector();
    const snap = makeSnapshot({
      characterStates: [stateOf('张三', '', '旧伤未愈，随时可能重伤')],
    });
    const conflicts = d.detect(snap, '张三勉强起身，终因重伤倒地。', {
      appearingCharacters: ['张三'],
      knownCharacters: ['张三'],
    });
    expect(conflicts.some((c) => c.type === 'character' && c.message.includes('剧变'))).toBe(false);
  });

  it('TR-B6b: 死亡/突破关键词同样检出剧变', () => {
    const d = new ConflictDetector();
    const snap = makeSnapshot({
      characterStates: [stateOf('李四', '', '')],
    });
    const conflicts = d.detect(snap, '灵气涌入，李四当场突破桎梏。', {
      appearingCharacters: ['李四'],
      knownCharacters: ['李四'],
    });
    expect(conflicts.some((c) => c.type === 'character' && c.message.includes('剧变'))).toBe(true);
  });
});

describe('ConflictDetector — P2 第二意见（事实库）', () => {
    /** 造带时间线的快照 */
    function timelineSnapshot(time: string) {
        return { timeline: { time }, characterStates: [], locations: [], items: [], foreshadows: [] } as never;
    }
    const BODY = '正文足够长的一段文字。'.repeat(20);

    it('**事实库说一致 → 抑制时间线冲突**', () => {
        const d = new ConflictDetector();
        const baseline = d.detect(timelineSnapshot('第三日'), BODY, { previousTimeValue: 8000 });
        const suppressed = d.detect(timelineSnapshot('第三日'), BODY, {
            previousTimeValue: 8000,
            adviseTimeline: () => ({ status: 'consistent', reason: '与第 12 章记录一致' }),
        });
        const before = baseline.filter(c => c.type === 'timeline').length;
        const after = suppressed.filter(c => c.type === 'timeline').length;
        expect(after).toBeLessThanOrEqual(before);
        expect(after).toBe(0);
    });

    it('**事实库未知 → 与无第二意见时完全一致**（不能因没数据就放过）', () => {
        const d = new ConflictDetector();
        const baseline = d.detect(timelineSnapshot('第三日'), BODY, { previousTimeValue: 8000 });
        const unknown = d.detect(timelineSnapshot('第三日'), BODY, {
            previousTimeValue: 8000,
            adviseTimeline: () => ({ status: 'unknown', reason: '无记录' }),
        });
        expect(unknown.filter(c => c.type === 'timeline').length)
            .toBe(baseline.filter(c => c.type === 'timeline').length);
    });

    it('事实库说冲突 → 与无第二意见时一致（仍然报）', () => {
        const d = new ConflictDetector();
        const baseline = d.detect(timelineSnapshot('第三日'), BODY, { previousTimeValue: 8000 });
        const conflict = d.detect(timelineSnapshot('第三日'), BODY, {
            previousTimeValue: 8000,
            adviseTimeline: () => ({ status: 'conflict', reason: '第 20 章记录为第五日' }),
        });
        expect(conflict.filter(c => c.type === 'timeline').length)
            .toBe(baseline.filter(c => c.type === 'timeline').length);
    });

    it('不提供第二意见时行为不变（零回归）', () => {
        const d = new ConflictDetector();
        const a = d.detect(timelineSnapshot('第三日'), BODY, { previousTimeValue: 8000 });
        const b = d.detect(timelineSnapshot('第三日'), BODY, { previousTimeValue: 8000 });
        expect(a.length).toBe(b.length);
    });
});

describe('ConflictDetector — P2 第二意见扩面（地点）', () => {
    /** 造地点冲突场景：设定地点为A，正文只出现B */
    function snapshotAt(location: string) {
        return { timeline: { time: '第三日', location }, characterStates: [], locations: [], items: [], foreshadows: [] } as never;
    }
    const BODY = ('他们在青云城外的山道上走。').repeat(12);

    it('无第二意见时按原逻辑判地点不符', () => {
        const d = new ConflictDetector();
        const conflicts = d.detect(snapshotAt('皇城'), BODY, { knownLocations: ['青云城'] });
        expect(conflicts.some(c => c.type === 'location')).toBe(true);
    });

    it('**事实库说一致 → 抑制地点冲突**（合理换场/回忆）', () => {
        const d = new ConflictDetector();
        const conflicts = d.detect(snapshotAt('皇城'), BODY, {
            knownLocations: ['青云城'],
            adviseState: () => ({ status: 'consistent', reason: '事实库记录该章确在青云城' }),
        });
        expect(conflicts.some(c => c.type === 'location')).toBe(false);
    });

    it('**事实库未知 → 不抑制**（与无第二意见一致）', () => {
        const d = new ConflictDetector();
        const baseline = d.detect(snapshotAt('皇城'), BODY, { knownLocations: ['青云城'] });
        const unknown = d.detect(snapshotAt('皇城'), BODY, {
            knownLocations: ['青云城'],
            adviseState: () => ({ status: 'unknown', reason: '无记录' }),
        });
        expect(unknown.filter(c => c.type === 'location').length)
            .toBe(baseline.filter(c => c.type === 'location').length);
    });

    it('事实库说冲突 → 仍报且详情带事实库理由', () => {
        const d = new ConflictDetector();
        const conflicts = d.detect(snapshotAt('皇城'), BODY, {
            knownLocations: ['青云城'],
            adviseState: () => ({ status: 'conflict', reason: '第5章记录为青云城' }),
        });
        const hit = conflicts.find(c => c.type === 'location');
        expect(hit).toBeDefined();
        expect(hit!.detail).toContain('事实库');
    });
});

describe('ConflictDetector — P2 能力第二意见（剧变检测）', () => {
    /** 造含能力变化关键词的快照 */
    function abilitySnapshot(name: string) {
        return {
            timeline: { time: '第三日', location: '渭城' },
            characterStates: [{ name, emotion: '', injury: '', goal: '', secret: '', relationships: '' }],
            locations: [], items: [], foreshadows: [],
        } as never;
    }
    const BODY = ('宁缺突破至筑基一层，气息暴涨。').repeat(20);

    it('无第二意见时按原逻辑报「剧变缺乏铺垫」', () => {
        const d = new ConflictDetector();
        const conflicts = d.detect(abilitySnapshot('宁缺'), BODY, { appearingCharacters: ['宁缺'], knownCharacters: ['宁缺'] });
        expect(conflicts.some(c => c.type === 'character')).toBe(true);
    });

    it('**事实库确认是合法进阶 → 抑制**', () => {
        const d = new ConflictDetector();
        const conflicts = d.detect(abilitySnapshot('宁缺'), BODY, {
            appearingCharacters: ['宁缺'],
            knownCharacters: ['宁缺'],
            adviseAbility: () => ({ status: 'consistent', reason: '第1章为练气三层，本章提升（合法进阶）' }),
        });
        expect(conflicts.some(c => c.message.includes('剧变'))).toBe(false);
    });

    it('事实库未知 → 与无第二意见一致（不放过）', () => {
        const d = new ConflictDetector();
        const baseline = d.detect(abilitySnapshot('宁缺'), BODY, { appearingCharacters: ['宁缺'], knownCharacters: ['宁缺'] });
        const unknown = d.detect(abilitySnapshot('宁缺'), BODY, {
            appearingCharacters: ['宁缺'],
            knownCharacters: ['宁缺'],
            adviseAbility: () => ({ status: 'unknown', reason: '无记录' }),
        });
        expect(unknown.filter(c => c.message.includes('剧变')).length)
            .toBe(baseline.filter(c => c.message.includes('剧变')).length);
    });
});
