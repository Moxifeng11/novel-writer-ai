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

describe('verifyForeshadowLoop — 名字归一（真实项目回放发现）', () => {
    it('中文弯引号被归一：「裴无极“记下名字”」能被「…记下名字…」覆盖', () => {
        const result = verifyForeshadowLoop({
            updates: [{ name: '锁脉环裂纹', value: '已埋设' }],
            newForeshadows: ['裴无极让姜晚"记下名字"并远喊"三个月"'],
            plan: { recycle: [], plant: ['裴无极“记下名字”'] },
        });
        expect(result.missingPlant).toEqual([]);
    });

    it('人工简写与模型描述差异被容忍：「姜晚的断口」vs「姜晚剑柄缠绳断口」', () => {
        const result = verifyForeshadowLoop({
            updates: [{ name: 'A', value: '推进' }],
            newForeshadows: ['姜晚剑柄缠绳断口磨得起毛，拇指反复摩挲'],
            plan: { recycle: [], plant: ['姜晚的断口'] },
        });
        expect(result.missingPlant).toEqual([]);
    });

    it('短名不做覆盖率放宽：「三个月」不会误配含「个月」的无关名称', () => {
        const result = verifyForeshadowLoop({
            updates: [{ name: 'A', value: '推进' }],
            newForeshadows: ['三个月后矿道塌方的隐患'],
            plan: { recycle: [], plant: ['“三个月”'] },
        });
        // 名称里确实含「三个月」，属于包含匹配，算覆盖
        expect(result.missingPlant).toEqual([]);

        const unrelated = verifyForeshadowLoop({
            updates: [{ name: 'A', value: '推进' }],
            newForeshadows: ['每个月的账册都要重抄一遍'],
            plan: { recycle: [], plant: ['“三个月”'] },
        });
        expect(unrelated.missingPlant).toEqual(['“三个月”']);
    });

    it('真正缺失仍然报出（陆昭案关联：章纲要求埋设但报告没有）', () => {
        const result = verifyForeshadowLoop({
            updates: [{ name: '锁脉环裂纹', value: '已埋设' }],
            newForeshadows: ['姜晚剑柄缠绳断口磨得起毛'],
            plan: { recycle: [], plant: ['陆昭案关联'] },
        });
        expect(result.missingPlant).toEqual(['陆昭案关联']);
        expect(result.pass).toBe(false);
    });
});
