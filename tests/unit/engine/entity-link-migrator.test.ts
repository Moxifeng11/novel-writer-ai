import { describe, expect, it } from 'vitest';
import { planEntityLinkChanges } from '../../../engine/entity-link-migrator';
import { LINK_FIELD_POLICY, parseLinkValue } from '../../../shared/entity-links';

describe('entity-link-migrator — 迁移计划（dry-run 纯函数）', () => {
    it('DEBUG 策略键与解析', () => {
        console.log('POLICY KEYS:', Object.keys(LINK_FIELD_POLICY));
        console.log('parse 武昭:', parseLinkValue('武昭'));
    });

    it('纯字符串归属 → 单链接', () => {
        const changes = planEntityLinkChanges('item', { '所属/归属': '武昭' });
        console.log('DEBUG item changes:', JSON.stringify(changes), 'policies:', Object.keys(LINK_FIELD_POLICY).filter((k) => k.startsWith('item.')));
        expect(changes).toEqual([{ field: '所属/归属', from: '武昭', to: '[[武昭]]' }]);
    });

    it('已是链接的字段跳过', () => {
        expect(planEntityLinkChanges('item', { '所属/归属': '[[武昭]]' })).toEqual([]);
    });

    it('人物所属势力/当前位置都进计划', () => {
        const changes = planEntityLinkChanges('character', {
            '所属势力': '青云宗',
            '当前位置': '断刃城',
        });
        expect(changes.map((change) => change.field).sort()).toEqual(['当前位置', '所属势力'].sort());
    });

    it('list 字段：分隔串转链接数组；全链接数组跳过', () => {
        const changed = planEntityLinkChanges('character', { '持有物品': '轩辕剑、玄铁令' });
        expect(changed).toEqual([{ field: '持有物品', from: '轩辕剑、玄铁令', to: ['[[轩辕剑]]', '[[玄铁令]]'] }]);

        expect(planEntityLinkChanges('character', { '持有物品': ['[[轩辕剑]]', '[[玄铁令]]'] })).toEqual([]);
    });

    it('空值跳过', () => {
        expect(planEntityLinkChanges('item', { '所属/归属': '' })).toEqual([]);
        expect(planEntityLinkChanges('item', {})).toEqual([]);
    });

    it('无关类别无策略字段', () => {
        expect(planEntityLinkChanges('faction', { 所属势力: '青云宗' })).toEqual([]);
    });
});
