import { describe, expect, it } from 'vitest';
import { getValidFrontmatterKeys } from '../../../shared/entity-field-mappings';

describe('getValidFrontmatterKeys — 结算字段白名单（v4.20 守卫）', () => {
    it('人物白名单包含修为等级/当前位置（回归：境界变更不再被静默丢弃）', () => {
        const keys = getValidFrontmatterKeys('character');
        expect(keys.has('修为等级')).toBe(true);
        expect(keys.has('当前位置')).toBe(true);
        // 旧白名单超集兼容
        expect(keys.has('当前情绪')).toBe(true);
        expect(keys.has('所属势力')).toBe(true);
        expect(keys.has('存续状态')).toBe(true);
    });

    it('物品白名单包含当前状态与所属/归属', () => {
        const keys = getValidFrontmatterKeys('item');
        expect(keys.has('当前状态')).toBe(true);
        expect(keys.has('所属/归属')).toBe(true);
        expect(keys.has('品阶/等级')).toBe(true);
    });

    it('势力/地点白名单不混入其他类别字段', () => {
        expect(getValidFrontmatterKeys('faction').has('领袖')).toBe(true);
        expect(getValidFrontmatterKeys('faction').has('修为等级')).toBe(false);
        expect(getValidFrontmatterKeys('location').has('主要居民/势力')).toBe(true);
        expect(getValidFrontmatterKeys('location').has('品阶/等级')).toBe(false);
    });

    it('白名单不含 entity_ 内部管理键之外的自由字段（垃圾字段被拒）', () => {
        const keys = getValidFrontmatterKeys('character');
        expect(keys.has('随便什么字段')).toBe(false);
    });
});
