import { describe, expect, it } from 'vitest';
import {
    applyRelationshipChanges,
    extractRelationshipChanges,
    formatRelationshipFile,
    parseRelationshipFile,
    type CharacterPairRelation,
} from '../../../engine/relationship-engine';
import { qualitativeDeltas } from '../../../engine/relationship-change-queue';

function relation(trust = 50): CharacterPairRelation {
    return {
        charA: '林惊鸿',
        charB: '苏雪',
        state: {
            trust, attraction: 50, fear: 50, resentment: 50, dependence: 50,
            status: '普通', history: '', historyKeys: [],
        },
        lastUpdatedChapter: '第1章',
    };
}

describe('relationship-engine — 5 维增量', () => {
    it('RELATION_5D 一行可产生多个维度变化', () => {
        const changes = extractRelationshipChanges(
            'RELATION_5D: 林惊鸿|苏雪|trust+6,attraction+2|并肩闯过剑阵',
        );
        expect(changes).toHaveLength(2);
        expect(changes.map((change) => change.dimension)).toEqual(['trust', 'attraction']);
        expect(changes.map((change) => change.delta)).toEqual([6, 2]);
        expect(changes[0].source).toBe('explicit');
        expect(changes[0].reason).toContain('并肩');
    });

    it('旧 RELATION 显式增量仍可解析', () => {
        const changes = extractRelationshipChanges('RELATION: 林惊鸿|苏雪|信任|trust +5');
        expect(changes).toHaveLength(1);
        expect(changes[0]).toMatchObject({ dimension: 'trust', delta: 5, source: 'explicit' });
    });

    it('旧 RELATION 无显式增量时按定性映射', () => {
        const changes = extractRelationshipChanges('RELATION: 林惊鸿|苏雪|师徒|林惊鸿收苏雪为徒');
        expect(changes).toHaveLength(1);
        expect(changes[0]).toMatchObject({ dimension: 'trust', delta: 2, source: 'qualitative' });
        expect(qualitativeDeltas('两人决裂，彼此仇恨')).toEqual([
            { dimension: 'resentment', delta: 6 },
            { dimension: 'trust', delta: -5 },
        ]);
    });
});

describe('relationship-engine — 幂等与合并', () => {
    it('同章同维度同原因只应用一次（history 截断后也不重复）', () => {
        const relations = [relation()];
        const change = {
            charA: '林惊鸿', charB: '苏雪', dimension: 'trust', delta: 6,
            reason: '并肩作战', source: 'explicit' as const,
        };
        const first = applyRelationshipChanges(relations, [change], '第3章');
        expect(first.applied).toBe(1);
        expect(relations[0].state.trust).toBe(56);
        expect(relations[0].state.historyKeys).toContain('第3章: trust+6 | 并肩作战');

        // 模拟 history 被 2000 字上限截断：幂等键仍在，不能二次累加
        relations[0].state.history = '旧'.repeat(2500);
        const second = applyRelationshipChanges(relations, [change], '第3章');
        expect(second.skipped).toBe(1);
        expect(relations[0].state.trust).toBe(56);
    });

    it('重复 ## A ↔ B 段合并为一条，并以更近的章节为准', () => {
        const content = `---
tags: [关系状态]
---
## 林惊鸿 ↔ 苏雪
trust: 50
attraction: 50
fear: 50
resentment: 50
dependence: 50
status: 普通
last_updated_chapter: 第1章
history: |
  第1章: 初遇

## 林惊鸿 ↔ 苏雪
trust: 62
attraction: 50
fear: 50
resentment: 50
dependence: 50
status: 基本信任
last_updated_chapter: 第4章
history: |
  第4章: 并肩作战
`;
        const relations = parseRelationshipFile(content);
        expect(relations).toHaveLength(1);
        expect(relations[0].state.trust).toBe(62);
        expect(relations[0].lastUpdatedChapter).toBe('第4章');
        expect(relations[0].state.history).toContain('第1章: 初遇');
        expect(relations[0].state.history).toContain('第4章: 并肩作战');
    });

    it('格式化落盘包含 nw 标签与 history_keys', () => {
        const relations = [relation()];
        applyRelationshipChanges(relations, [{
            charA: '林惊鸿', charB: '苏雪', dimension: 'trust', delta: 3, reason: '相助',
        }], '第2章');
        const content = formatRelationshipFile(relations, '第2章');
        expect(content).toContain('nw/设定/关系状态');
        expect(content).toContain('关系对数: 1');
        expect(content).toContain('history_keys: |');
        expect(content).toContain('第2章: trust+3 | 相助');
    });
});
