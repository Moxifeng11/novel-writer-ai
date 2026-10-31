import { describe, expect, it } from 'vitest';
import { mergeBehaviorRows, type BehaviorRow } from '../../../shared/behavior-log';

const row = (chapter: string, chapterNum: number, name: string, summary: string): BehaviorRow =>
    ({ chapter, chapterNum, name, summary });

describe('behavior-log — 出场记录合并', () => {
    it('章名不同但章号相同 → 视为同一条（新覆盖旧）', () => {
        const merged = mergeBehaviorRows(
            [row('第3章_测脉', 3, '沈砚', '他把袋子拍在案上，跟录事吵了一架，最后按了手印离开渡口。')],
            [row('第3章', 3, '沈砚', '过桥复测。')],
        );
        expect(merged).toHaveLength(1);
        expect(merged[0].summary).toBe('过桥复测。');
    });

    it('更短的新摘要直接覆盖旧摘要（最新优先）', () => {
        const merged = mergeBehaviorRows(
            [row('第3章', 3, '沈铁山', '很长很长的旧摘要'.repeat(10))],
            [row('第3章', 3, '沈铁山', '陪测。')],
        );
        expect(merged[0].summary).toBe('陪测。');
    });

    it('不同章号各自保留并按章号排序', () => {
        const merged = mergeBehaviorRows(
            [row('第5章', 5, '沈砚', 'a')],
            [row('第3章', 3, '沈砚', 'b')],
        );
        expect(merged.map(r => r.chapterNum)).toEqual([3, 5]);
    });
});
