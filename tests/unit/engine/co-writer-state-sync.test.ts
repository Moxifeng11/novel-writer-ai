/**
 * Task 12: co-writer 接受即更新状态（进确认队列） — 测试
 * 对应 spec: story-quality-closed-loop-optimization TR-12.1 ~ TR-12.3
 *
 * 核心：co-writer 接受建议后提取的状态变化（EntityStateChange）转为 PendingFact
 * 进 Task 11 待确认队列（source='co-writer'），未确认前不写正式库。
 */
import { describe, it, expect, vi } from 'vitest';
import { entityStateChangesToFacts } from '../../../engine/co-writer-state-sync';
import { FactIndexManager } from '../../../engine/fact-index-manager';
import type { EntityStateChange } from '../../../engine/entity-state-manager';
import type { PersistedFactIndex, FactStoragePort, PendingFact } from '../../../engine/fact-index-manager';

const CHANGES: EntityStateChange[] = [
    { entityName: '林晚', newStatus: '左臂受伤', reason: '巷口缠斗被划伤', confidence: 0.9 },
    { entityName: '萧然', newStatus: '对林晚产生怀疑', reason: '发现玉佩来历不明', confidence: 0.8 },
];

function makeStorage() {
    let data: PersistedFactIndex | null = null;
    const storage: FactStoragePort = {
        load: vi.fn(async () => data),
        save: vi.fn(async (d: PersistedFactIndex) => { data = d; }),
    };
    return storage;
}

function makeWriter() {
    return {
        writeFact: vi.fn(async (_fact: PendingFact) => {}),
    };
}

describe('co-writer 状态同步 — TR-12.1 接受段落后提取到状态变化项', () => {
    it('EntityStateChange 转为 PendingFact，content 对映 newStatus', () => {
        const facts = entityStateChangesToFacts(CHANGES);

        expect(facts.length).toBe(CHANGES.length);
        expect(facts[0]).toMatchObject({
            category: 'character',
            name: '林晚',
            content: '左臂受伤',
            status: 'pending',
        });
        expect(facts[1].name).toBe('萧然');
        expect(facts[1].content).toBe('对林晚产生怀疑');
    });

    it('过滤掉 entityName 或 newStatus 缺失的无效变更', () => {
        const invalid: EntityStateChange[] = [
            { entityName: '', newStatus: '空名', reason: '', confidence: 0.5 },
            { entityName: '有效', newStatus: '', reason: '', confidence: 0.5 },
            { entityName: '正常', newStatus: '正常状态', reason: '', confidence: 0.5 },
        ];
        const facts = entityStateChangesToFacts(invalid);
        expect(facts.length).toBe(1);
        expect(facts[0].name).toBe('正常');
    });

    it('空变更列表返回空数组', () => {
        expect(entityStateChangesToFacts([])).toEqual([]);
    });
});

describe('co-writer 状态同步 — TR-12.2 变化项进待确认队列，source=co-writer', () => {
    it('enqueue 后 listPending 含 source=co-writer 的项', async () => {
        const mgr = new FactIndexManager(makeStorage(), makeWriter());
        const facts = entityStateChangesToFacts(CHANGES);
        await mgr.enqueue(facts);

        const pending = mgr.listPending();
        expect(pending.length).toBe(CHANGES.length);
        for (const f of pending) {
            expect(f.source).toBe('co-writer');
        }
    });
});

describe('co-writer 状态同步 — TR-12.3 未确认前正式库不变', () => {
    it('enqueue 不调用 writer.writeFact（未确认不写正式库）', async () => {
        const writer = makeWriter();
        const mgr = new FactIndexManager(makeStorage(), writer);
        await mgr.enqueue(entityStateChangesToFacts(CHANGES));

        expect(writer.writeFact).not.toHaveBeenCalled();
        expect(mgr.listConfirmed()).toHaveLength(0);
    });

    it('confirm 后才调用 writer.writeFact', async () => {
        const writer = makeWriter();
        const mgr = new FactIndexManager(makeStorage(), writer);
        const facts = entityStateChangesToFacts(CHANGES);
        await mgr.enqueue(facts);

        await mgr.confirm(facts[0].id);

        expect(writer.writeFact).toHaveBeenCalledTimes(1);
        expect(writer.writeFact.mock.calls[0][0]).toMatchObject({ name: '林晚', source: 'co-writer' });
    });
});

describe('co-writer 状态同步 — Task 12 六类映射', () => {
    it('按 entityType 映射到正确事实类别', () => {
        const six: EntityStateChange[] = [
            { entityName: '林晚', newStatus: '受伤', reason: '', confidence: 0.9, entityType: 'character' },
            { entityName: '青云宗', newStatus: '新地点', reason: '', confidence: 0.8, entityType: 'location' },
            { entityName: '断魂剑', newStatus: '新道具', reason: '', confidence: 0.8, entityType: 'prop' },
            { entityName: '林晚与萧然', newStatus: '结盟', reason: '', confidence: 0.7, entityType: 'relationship' },
            { entityName: '玉佩之谜', newStatus: '新伏笔', reason: '', confidence: 0.7, entityType: 'foreshadow' },
            { entityName: '进入秘境', newStatus: '已完成', reason: '', confidence: 0.9, entityType: 'plotNode' },
        ];
        const facts = entityStateChangesToFacts(six);
        expect(facts.map((f) => f.category)).toEqual([
            'character', 'world', 'world', 'character', 'plot', 'plot',
        ]);
        expect(facts[1].id).toBe('world:青云宗');
        expect(facts[4].id).toBe('plot:玉佩之谜');
    });

    it('无 entityType 时默认按 character 处理（向后兼容）', () => {
        const facts = entityStateChangesToFacts([
            { entityName: '林晚', newStatus: '受伤', reason: '', confidence: 0.9 },
        ]);
        expect(facts[0].category).toBe('character');
        expect(facts[0].id).toBe('character:林晚');
    });
});
