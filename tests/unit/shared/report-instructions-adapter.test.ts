import { describe, expect, it } from 'vitest';
import { instructionsToWritebackInputs } from '@/shared/report-instructions-adapter';

describe('instructionsToWritebackInputs', () => {
    it('UPDATE_* 转成 update_entity 输入', () => {
        const inputs = instructionsToWritebackInputs({
            uc: [{ name: '林玄', field: '境界', value: '筑基' }],
            ufa: [{ name: '青云宗', field: '实力', value: '一流' }],
            uloc: [{ name: '山门', field: '状态', value: '破损' }],
            uitem: [{ name: '青锋剑', field: '品阶', value: '灵器' }],
        });
        expect(inputs.map(i => i.marker)).toEqual(['UPDATE_CHARACTER', 'UPDATE_FACTION', 'UPDATE_LOCATION', 'UPDATE_ITEM']);
        expect(inputs[0].fields).toEqual({ 境界: '筑基' });
    });

    it('NEW_* 转成新建输入', () => {
        const inputs = instructionsToWritebackInputs({
            nc: [{ name: '新角色', description: '描述' }],
            nfs: [{ chapter: '第3章', reveal: '断剑来历' }],
            nt: [{ desc: '大战爆发', event: '大战' }],
        });
        expect(inputs[0].marker).toBe('NEW_CHARACTER');
        expect(inputs[0].fields).toEqual({ 描述: '描述' });
        expect(inputs[1].marker).toBe('NEW_FORESHADOW');
        expect(inputs[1].name).toBe('断剑来历');
        expect(inputs[2].marker).toBe('NEW_TIMELINE');
    });

    it('关系/成长/情绪映射', () => {
        const inputs = instructionsToWritebackInputs({
            rel: [{ entityA: '林玄', entityB: '苏婉', relType: '师徒', desc: '拜师' }],
            growth: [{ name: '林玄', type: '心境', value: '坚定', desc: '突破' }],
            emotion: [{ name: '林玄', emotion: '愤怒', desc: '被辱' }],
        });
        expect(inputs.map(i => i.marker)).toEqual(['RELATION', 'GROWTH', 'EMOTION']);
        expect(inputs[0].fields['对方']).toBe('苏婉');
    });

    it('空指令返回空数组', () => {
        expect(instructionsToWritebackInputs({})).toEqual([]);
        expect(instructionsToWritebackInputs(undefined)).toEqual([]);
    });

    it('DELETE 不进入审查输入（删除走独立通道）', () => {
        const inputs = instructionsToWritebackInputs({ del: [{ entityType: 'character', entityName: '路人' }] });
        expect(inputs).toEqual([]);
    });
});
