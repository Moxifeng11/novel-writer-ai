import { describe, expect, it } from 'vitest';
import { parseEmotionIntensities, renderEmotionCurve } from '@/shared/emotion-plan-parse';

describe('parseEmotionIntensities', () => {
    it('分块标题形式（## 场景N + 块内强度）能被解析（回归：\\s* 曾吞掉换行导致块正文为空）', () => {
        const text = '## 场景1：开头\n- 强度：30\n## 场景2：冲突\n- 强度：70\n## 场景3：收束\n- 强度：85\n';
        const scenes = parseEmotionIntensities(text);
        expect(scenes.map(scene => scene.intensity)).toEqual([30, 70, 85]);
    });

    it('分块形式', () => {
        const text = '## 场景1：山门初见\n- 强度：40\n\n## 场景2：夜谈\n- 情绪强度：70\n';
        const scenes = parseEmotionIntensities(text);
        expect(scenes).toHaveLength(2);
        expect(scenes[0]).toEqual({ index: 1, intensity: 40 });
        expect(scenes[1].intensity).toBe(70);
    });

    it('行内形式', () => {
        const scenes = parseEmotionIntensities('场景1：强度 55\n场景2：张力 80\n');
        expect(scenes.map(s => s.intensity)).toEqual([55, 80]);
    });

    it('表格形式', () => {
        const scenes = parseEmotionIntensities('| 场景 | 强度 |\n|---|---|\n| 场景1 | 30 |\n| 场景2 | 65 |\n');
        expect(scenes).toHaveLength(2);
    });

    it('越界值忽略', () => {
        expect(parseEmotionIntensities('场景1：强度 180')).toEqual([]);
    });

    it('无数据返回空', () => {
        expect(parseEmotionIntensities('普通文本')).toEqual([]);
    });

    it('按序号排序', () => {
        const scenes = parseEmotionIntensities('场景3：强度 90\n场景1：强度 20\n');
        expect(scenes.map(s => s.index)).toEqual([1, 3]);
    });
});

describe('renderEmotionCurve', () => {
    it('渲染曲线', () => {
        expect(renderEmotionCurve([{ index: 1, intensity: 30 }, { index: 2, intensity: 60 }])).toContain('场景1:30 → 场景2:60');
    });

    it('空返回空串', () => {
        expect(renderEmotionCurve([])).toBe('');
    });
});
