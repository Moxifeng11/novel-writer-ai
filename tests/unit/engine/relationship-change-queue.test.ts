import { describe, expect, it } from 'vitest';
import { App } from 'obsidian';
import {
    appendRelationshipChanges,
    consumePendingRelationshipChanges,
    entityChangesToRelationshipChanges,
    loadPendingRelationshipChanges,
    parseRelationshipChangeQueue,
    qualitativeDeltas,
} from '../../../engine/relationship-change-queue';

const PROJECT = '长篇小说/测试书';

describe('relationship-change-queue — 解析与去重', () => {
    const content = `# 关系变更待确认

| 章 | 角色A | 角色B | 维度 | 增量 | 原因 | 来源 |
|---|---|---|---|---|---|---|
| 第3章 | 林惊鸿 | 苏雪 | trust | +3 | 并肩作战 | co-writer |
| 第3章 | 林惊鸿 | 苏雪 | bad | +3 | 非法维度 | co-writer |
| 第4章 | 林惊鸿 | 王玄 | fear | -2 | 被威胁 | co-writer |
`;

    it('只解析合法维度行', () => {
        const rows = parseRelationshipChangeQueue(content);
        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({ chapter: '第3章', dimension: 'trust', delta: 3 });
        expect(rows[1]).toMatchObject({ dimension: 'fear', delta: -2 });
    });

    it('协同实体变化转关系变更', () => {
        const changes = entityChangesToRelationshipChanges([
            { entityType: 'relationship', entityName: '林惊鸿 ↔ 苏雪', newStatus: '并肩作战后彼此信任' },
            { entityType: 'relationship', entityName: '林惊鸿 ↔ 王玄', newStatus: '被威胁后心生恐惧' },
            { entityType: 'character', entityName: '林惊鸿', newStatus: '受伤' },
        ], '第3章');
        expect(changes).toHaveLength(2);
        expect(changes[0]).toMatchObject({ charA: '林惊鸿', charB: '苏雪', dimension: 'trust', delta: 3 });
        expect(changes[1]).toMatchObject({ dimension: 'fear', delta: 3 });
    });

    it('定性词映射小增量', () => {
        expect(qualitativeDeltas('两人决裂')).toEqual([
            { dimension: 'resentment', delta: 6 },
            { dimension: 'trust', delta: -5 },
        ]);
        expect(qualitativeDeltas('他开始依赖她')).toEqual([{ dimension: 'dependence', delta: 3 }]);
    });
});

describe('relationship-change-queue — 追加/读取/消费', () => {
    it('同一条变更重复追加只写一行，消费后清空', async () => {
        const app = new App();
        const change = { charA: '林惊鸿', charB: '苏雪', dimension: 'trust' as const, delta: 3, reason: '并肩作战' };
        expect(await appendRelationshipChanges(app, PROJECT, '第3章', [change])).toBe(1);
        expect(await appendRelationshipChanges(app, PROJECT, '第3章', [change])).toBe(0);

        const pending = await loadPendingRelationshipChanges(app, PROJECT);
        expect(pending).toHaveLength(1);
        expect(pending[0]).toMatchObject({ chapter: '第3章', dimension: 'trust', delta: 3 });

        const consumed = await consumePendingRelationshipChanges(app, PROJECT);
        expect(consumed).toHaveLength(1);
        expect(await loadPendingRelationshipChanges(app, PROJECT)).toHaveLength(0);
    });
});
