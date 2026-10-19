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
