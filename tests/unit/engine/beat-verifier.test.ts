import { describe, it, expect } from 'vitest';
import { BeatVerifier } from '../../../engine/beat-verifier';
import type { StoryBeat } from '../../../engine/story-state-types';

function beat(partial: Partial<StoryBeat> & { id: string; description: string }): StoryBeat {
  return {
    type: 'event',
    required: true,
    ...partial,
  };
}

describe('BeatVerifier — 边界与降级', () => {
  it('空任务卡时 passed 为 true', () => {
    const v = new BeatVerifier();
    const r = v.verify('任意正文内容', []);
    expect(r.passed).toBe(true);
    expect(r.missingRequired).toEqual([]);
  });

  it('正文为空时所有 required beat 判为未完成', () => {
    const v = new BeatVerifier();
    const r = v.verify('', [beat({ id: 'b1', description: '救出人质' })]);
    expect(r.passed).toBe(false);
    expect(r.missingRequired).toHaveLength(1);
    expect(r.missingRequired[0].id).toBe('b1');
  });
});

describe('BeatVerifier — 命中判定', () => {
  it('正文包含 beat 描述关键词时判为完成', () => {
    const v = new BeatVerifier();
    const body = '主角冲进牢房，最终救出人质，众人松了一口气。';
    const r = v.verify(body, [beat({ id: 'b1', description: '救出人质' })]);
    expect(r.passed).toBe(true);
    expect(r.results[0].completed).toBe(true);
  });

  it('未命中的 required beat 进入 missingRequired', () => {
    const v = new BeatVerifier();
    const body = '主角在城中闲逛了一整天。';
    const beats = [
      beat({ id: 'b1', description: '救出人质' }),
      beat({ id: 'b2', description: '主角在城中闲逛', required: false }),
    ];
    const r = v.verify(body, beats);
    expect(r.passed).toBe(false);
    expect(r.missingRequired.map((b) => b.id)).toEqual(['b1']);
  });

  it('可选 beat 未命中不影响 passed', () => {
    const v = new BeatVerifier();
    const body = '主角赶到了现场。';
    const beats = [beat({ id: 'b1', description: '一段无关支线', required: false })];
    const r = v.verify(body, beats);
    expect(r.passed).toBe(true);
    expect(r.results[0].completed).toBe(false);
  });

  it('completionRate 反映完成比例', () => {
    const v = new BeatVerifier();
    const body = '主角救出人质。';
    const beats = [
      beat({ id: 'b1', description: '救出人质' }),
      beat({ id: 'b2', description: '击败反派头目' }),
    ];
    const r = v.verify(body, beats);
    expect(r.completionRate).toBeCloseTo(0.5, 5);
  });
});
