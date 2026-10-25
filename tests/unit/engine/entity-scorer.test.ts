import { describe, it, expect } from 'vitest';
import { scoreAndFilterEntities, scoreAndFilterEntitiesByType } from '../../../engine/entity-scorer';
import type { ScoredEntity } from '../../../engine/entity-scorer';

function makeEntity(
    name: string,
    fields: Record<string, string>,
    type: 'character' | 'faction' | 'location' | 'item' = 'character',
): ScoredEntity {
    const fieldLines = Object.entries(fields).map(([k, v]) => `- ${k}：${v}`).join('\n');
    return {
        name,
        fields,
        type,
        formatText: `### ${name}\n${fieldLines}`,
    };
}

describe('scoreAndFilterEntities — 边界情况', () => {
    it('空实体列表返回空结果', () => {
        const r = scoreAndFilterEntities([], '任意上下文', 8);
        expect(r).toEqual([]);
    });

    it('空上下文时不崩溃且返回结果', () => {
        const e = makeEntity('林惊鸿', { 欲望: '复仇' });
        const r = scoreAndFilterEntities([e], '', 8);
        expect(r.length).toBe(1);
    });

    it('topN=0 时回退返回至少 1 个实体（无正向分回退）', () => {
        const e1 = makeEntity('甲', { a: 'b' });
        const e2 = makeEntity('乙', { a: 'c' });
        const r = scoreAndFilterEntities([e1, e2], '无关上下文', 0);
        // 无正向分时按 topN 上限回退，不再全量返回
        expect(r.length).toBe(1);
    });
});

describe('scoreAndFilterEntitiesByType — 分类预算', () => {
    it('人物不会被势力/地点/物品挤掉名额', () => {
        const characters = Array.from({ length: 12 }, (_, i) =>
            makeEntity(`角色${i}`, { 欲望: '复仇' }, 'character'),
        );
        const factions = Array.from({ length: 20 }, (_, i) =>
            makeEntity(`势力${i}`, { 类型: '宗门' }, 'faction'),
        );
        const locations = Array.from({ length: 20 }, (_, i) =>
            makeEntity(`地点${i}`, { 类型: '城池' }, 'location'),
        );
        const items = Array.from({ length: 20 }, (_, i) =>
            makeEntity(`物品${i}`, { 类型: '法宝' }, 'item'),
        );
        const context = [...characters, ...factions, ...locations, ...items]
            .map((e) => e.name)
            .join(' ');

        const r = scoreAndFilterEntitiesByType(
            [...characters, ...factions, ...locations, ...items],
            context,
            { character: 12, faction: 6, location: 6, item: 6 },
        );

        expect(r.filter((e) => e.type === 'character')).toHaveLength(12);
        expect(r.filter((e) => e.type === 'faction')).toHaveLength(6);
        expect(r.filter((e) => e.type === 'location')).toHaveLength(6);
        expect(r.filter((e) => e.type === 'item')).toHaveLength(6);
    });
});

describe('scoreAndFilterEntities — 名称命中加分', () => {
    it('实体名出现在上下文中时获得加分（分数更高）', () => {
        const eHit = makeEntity('林惊鸿', { 欲望: '复仇' });
        const eMiss = makeEntity('苏白', { 欲望: '寻母' });
        const context = '林惊鸿立于祠堂之前，长剑出鞘。';
        const r = scoreAndFilterEntities([eHit, eMiss], context, 8);
        const hit = r.find(x => x.name === '林惊鸿');
        const miss = r.find(x => x.name === '苏白');
        expect(hit).toBeDefined();
        expect(miss).toBeDefined();
        expect(hit!.score).toBeGreaterThan(miss!.score);
    });

    it('名称命中加分使实体排在结果前列', () => {
        const eHit = makeEntity('主角', { 欲望: '复仇' });
        const eMiss = makeEntity('配角', { 欲望: '寻母' });
        const context = '主角出场';
        const r = scoreAndFilterEntities([eMiss, eHit], context, 8);
        expect(r[0].name).toBe('主角');
    });
});

describe('scoreAndFilterEntities — 关系字段加分', () => {
    it('含"所属势力"且值引用其他实体名时获得关系加分', () => {
        const e1 = makeEntity('林惊鸿', { 所属势力: '青云宗' });
        const e2 = makeEntity('青云宗', { 类型: '宗门' }, 'faction');
        const context = '林惊鸿与青云宗的故事';
        const r = scoreAndFilterEntities([e1, e2], context, 8);
        const lin = r.find(x => x.name === '林惊鸿');
        // 关系字段 + 名称命中都加分
        expect(lin!.score).toBeGreaterThan(0);
    });

    it('含"当前状态"字段时获得状态加分', () => {
        const e = makeEntity('林惊鸿', { 当前状态: '重伤未愈' });
        const context = '林惊鸿出场';
        const r = scoreAndFilterEntities([e], context, 8);
        expect(r[0].score).toBeGreaterThan(0);
    });
});

describe('scoreAndFilterEntities — topN 截断', () => {
    it('正向分实体 >=3 时按 topN 截断', () => {
        const entities: ScoredEntity[] = [];
        for (let i = 0; i < 6; i++) {
            entities.push(makeEntity(`角色${i}`, { 欲望: '复仇' }));
        }
        // 上下文同时命中全部 6 个名称 → 全部 score>0
        const context = entities.map(e => e.name).join(' ');
        const r = scoreAndFilterEntities(entities, context, 3);
        expect(r.length).toBe(3);
        // 按分数降序
        for (let i = 1; i < r.length; i++) {
            expect(r[i - 1].score).toBeGreaterThanOrEqual(r[i].score);
        }
    });

    it('正向分实体 <3 时按 topN 截断而非全量返回', () => {
        const e1 = makeEntity('甲', { a: 'b' });
        const e2 = makeEntity('乙', { a: 'c' });
        const e3 = makeEntity('丙', { a: 'd' });
        // 上下文不命中任何名称与关键词 → 无正向分
        const context = '完全无关的文本内容';
        const r = scoreAndFilterEntities([e1, e2, e3], context, 2);
        expect(r.length).toBe(2);
    });
});

describe('scoreAndFilterEntities — 结果结构与排序', () => {
    it('返回结果包含 text/name/type/score 字段', () => {
        const e = makeEntity('林惊鸿', { 欲望: '复仇' });
        const r = scoreAndFilterEntities([e], '林惊鸿', 8);
        expect(r[0].text).toContain('林惊鸿');
        expect(r[0].name).toBe('林惊鸿');
        expect(r[0].type).toBe('character');
        expect(typeof r[0].score).toBe('number');
    });

    it('结果按 score 降序排列', () => {
        const eLow = makeEntity('甲', { 欲望: '复仇' });
        const eHigh = makeEntity('乙', { 欲望: '复仇' });
        const eMid = makeEntity('丙', { 欲望: '复仇' });
        // 上下文只命中"乙" → 乙分数最高，甲丙分数较低且相等
        const context = '乙出场';
        const r = scoreAndFilterEntities([eLow, eHigh, eMid], context, 8);
        expect(r[0].name).toBe('乙');
        for (let i = 1; i < r.length; i++) {
            expect(r[i - 1].score).toBeGreaterThanOrEqual(r[i].score);
        }
    });

    it('formatText 原样透传到结果 text 字段', () => {
        const e = makeEntity('林惊鸿', { 欲望: '复仇' });
        const r = scoreAndFilterEntities([e], '林惊鸿', 8);
        expect(r[0].text).toBe(e.formatText);
    });
});

describe('scoreAndFilterEntities — 实体数据隔离（防污染）', () => {
    it('不修改入参 entities 数组及其元素字段', () => {
        const e1 = makeEntity('林惊鸿', { 欲望: '复仇', 所属势力: '青云宗' });
        const e2 = makeEntity('苏白', { 欲望: '寻母' });
        const snapshot = JSON.stringify([e1, e2]);
        scoreAndFilterEntities([e1, e2], '林惊鸿出场', 8);
        expect(JSON.stringify([e1, e2])).toBe(snapshot);
    });

    it('多任务连续调用：第二次结果不受第一次影响（无交叉污染）', () => {
        const taskA = [makeEntity('甲', { 欲望: '复仇' }), makeEntity('乙', { 欲望: '寻母' })];
        const taskB = [makeEntity('丙', { 欲望: '复仇' }), makeEntity('丁', { 欲望: '寻母' })];
        const r1 = scoreAndFilterEntities(taskA, '甲出场', 8);
        const r2 = scoreAndFilterEntities(taskB, '丁出场', 8);
        const names1 = r1.map(x => x.name);
        const names2 = r2.map(x => x.name);
        expect(names1).toContain('甲');
        expect(names1).not.toContain('丙');
        expect(names1).not.toContain('丁');
        expect(names2).toContain('丁');
        expect(names2).not.toContain('甲');
        expect(names2).not.toContain('乙');
    });

    it('正向分不足且实体数远大于 topN 时，仅返回 topN 个（不因实体多而全量回退）', () => {
        const entities: ScoredEntity[] = [];
        for (let i = 0; i < 30; i++) {
            entities.push(makeEntity(`角色${i}`, { a: 'b' }));
        }
        const r = scoreAndFilterEntities(entities, '完全无关上下文文本', 8);
        expect(r.length).toBe(8);
        expect(r.length).toBeLessThan(entities.length);
    });

    it('多轮重复调用同一实体集合，结果稳定且不累积实体', () => {
        const entities = [makeEntity('甲', { 欲望: '复仇' }), makeEntity('乙', { 欲望: '寻母' }), makeEntity('丙', { 欲望: '复仇' })];
        const context = '甲出场';
        const first = scoreAndFilterEntities(entities, context, 8);
        const second = scoreAndFilterEntities(entities, context, 8);
        expect(second.length).toBe(first.length);
        expect(second.map(x => x.name)).toEqual(first.map(x => x.name));
    });
});
