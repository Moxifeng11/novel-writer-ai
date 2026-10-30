import { describe, expect, it } from 'vitest';
import { verifyForeshadowLoop } from '../../../shared/foreshadow-loop';

describe('foreshadow-loop — 每章伏笔闭环核对', () => {
    it('回收≥1 且埋设≥1：通过', () => {
        const result = verifyForeshadowLoop({
            updates: [{ name: '黑色石头', value: '已揭示' }],
            newForeshadows: ['守卫的徽记'],
            plan: { recycle: [], plant: [] },
        });
        expect(result.pass).toBe(true);
        expect(result.recycledCount).toBe(1);
        expect(result.plantedCount).toBe(1);
        expect(result.summary).toContain('通过');
    });

    it('零回收：不通过并给出原因', () => {
        const result = verifyForeshadowLoop({
            updates: [],
            newForeshadows: ['守卫的徽记'],
        });
        expect(result.pass).toBe(false);
        expect(result.issues.some((issue) => issue.includes('没有回收任何旧伏笔'))).toBe(true);
    });

    it('零埋设：不通过并给出原因', () => {
        const result = verifyForeshadowLoop({
            updates: [{ name: '黑色石头', value: '推进' }],
            newForeshadows: [],
        });
        expect(result.pass).toBe(false);
        expect(result.issues.some((issue) => issue.includes('没有埋设任何新伏笔'))).toBe(true);
    });

    it('章纲计划回收的伏笔结算里没出现：列入 missingRecycle', () => {
        const result = verifyForeshadowLoop({
            updates: [{ name: '倒S纹路', value: '推进' }],
            newForeshadows: ['新钩子'],
            plan: { recycle: ['黑色石头', '倒S纹路'], plant: [] },
        });
        expect(result.missingRecycle).toEqual(['黑色石头']);
        expect(result.pass).toBe(false);
        expect(result.issues.some((issue) => issue.includes('计划回收「黑色石头」'))).toBe(true);
    });

    it('章纲计划埋设的伏笔结算里没出现：列入 missingPlant', () => {
        const result = verifyForeshadowLoop({
            updates: [{ name: '黑色石头', value: '已揭示' }],
            newForeshadows: ['别的伏笔'],
            plan: { recycle: [], plant: ['守卫的徽记'] },
        });
        expect(result.missingPlant).toEqual(['守卫的徽记']);
        expect(result.issues.some((issue) => issue.includes('计划埋设「守卫的徽记」'))).toBe(true);
    });

    it('名称匹配容忍包含关系与括号修饰', () => {
        const result = verifyForeshadowLoop({
            updates: [{ name: '【黑色石头】', value: '推进' }],
            newForeshadows: ['守卫徽记的来历'],
            plan: { recycle: ['黑色石头'], plant: ['守卫徽记'] },
        });
        expect(result.missingRecycle).toEqual([]);
        expect(result.missingPlant).toEqual([]);
        expect(result.pass).toBe(true);
    });

    it('计划为空时只做数量核对', () => {
        const result = verifyForeshadowLoop({
            updates: [{ name: 'A', value: '推进' }, { name: 'B', value: '已揭示' }],
            newForeshadows: ['C'],
        });
        expect(result.pass).toBe(true);
        expect(result.recycledCount).toBe(2);
    });
});
