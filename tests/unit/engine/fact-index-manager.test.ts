/**
 * Task 11: FactIndexManager 事实索引 + 待确认队列 — 测试
 * 对应 spec: story-quality-closed-loop-optimization TR-11.1 ~ TR-11.4
 *
 * 核心访问控制约束（AC-7）：AI 提取的事实必须先经用户确认才写正式库；
 * 未确认事实绝不进入正式世界观/人物库。
 */
import { describe, it, expect, vi } from 'vitest';
import {
    FactIndexManager,
    FACT_INDEX_VERSION,
} from '../../../engine/fact-index-manager';
import type {
    PersistedFactIndex,
    FactStoragePort,
    PendingFact,
} from '../../../engine/fact-index-manager';

function makeStorage(initial?: PersistedFactIndex) {
    let data: PersistedFactIndex | null = initial ?? null;
    const storage: FactStoragePort & { _getData: () => PersistedFactIndex | null } = {
        load: vi.fn(async () => data),
        save: vi.fn(async (d: PersistedFactIndex) => { data = d; }),
        _getData: () => data,
    };
    return storage;
}

function makeWriter() {
    return {
        writeFact: vi.fn(async (_fact: PendingFact) => {}),
    };
}

const BODY = '林晚踏入《皇城东市》，遇到了[[萧然]]。两人联手破解【密信之谜】。';

describe('FactIndexManager — TR-11.1 extractNewFacts 产出 pending 事实', () => {
    it('从正文程序性提取 character/world/plot 三类，status 均为 pending', async () => {
        const mgr = new FactIndexManager(makeStorage(), makeWriter());
        const facts = mgr.extractNewFacts(BODY);

        expect(facts.length).toBeGreaterThanOrEqual(3);

        const char = facts.find((f) => f.category === 'character');
        const world = facts.find((f) => f.category === 'world');
        const plot = facts.find((f) => f.category === 'plot');

        expect(char?.name).toBe('萧然');
        expect(world?.name).toBe('皇城东市');
        expect(plot?.name).toBe('密信之谜');

        for (const f of facts) {
            expect(f.status).toBe('pending');
            expect(f.id).toBeTruthy();
        }
    });

    it('无实体标记时返回空数组，不抛异常', () => {
        const mgr = new FactIndexManager(makeStorage(), makeWriter());
        expect(mgr.extractNewFacts('这是一段没有实体标记的普通正文。')).toEqual([]);
        expect(mgr.extractNewFacts('')).toEqual([]);
    });
});

describe('FactIndexManager — TR-11.2 confirm 才写正式库，ignore 不写', () => {
    it('confirm 调用 writer.writeFact 并将事实移入 confirmed', async () => {
        const writer = makeWriter();
        const mgr = new FactIndexManager(makeStorage(), writer);
        const facts = mgr.extractNewFacts(BODY);
        await mgr.enqueue(facts);

        const id = facts[0].id;
        const ok = await mgr.confirm(id);

        expect(ok).toBe(true);
        expect(writer.writeFact).toHaveBeenCalledTimes(1);
        expect(mgr.listPending()).not.toContainEqual(expect.objectContaining({ id }));
        expect(mgr.listConfirmed().some((c) => c.id === id)).toBe(true);
    });

    it('ignore 不调用 writer.writeFact 且移除事实', async () => {
        const writer = makeWriter();
        const mgr = new FactIndexManager(makeStorage(), writer);
        const facts = mgr.extractNewFacts(BODY);
        await mgr.enqueue(facts);

        const id = facts[0].id;
        const ok = await mgr.ignore(id);

        expect(ok).toBe(true);
        expect(writer.writeFact).not.toHaveBeenCalled();
        expect(mgr.listPending()).not.toContainEqual(expect.objectContaining({ id }));
        expect(mgr.listConfirmed()).toHaveLength(0);
    });

    it('confirm/ignore 不存在的事实返回 false', async () => {
        const writer = makeWriter();
        const mgr = new FactIndexManager(makeStorage(), writer);
        expect(await mgr.confirm('no-such-id')).toBe(false);
        expect(await mgr.ignore('no-such-id')).toBe(false);
        expect(writer.writeFact).not.toHaveBeenCalled();
    });
});

describe('FactIndexManager — TR-11.3 未确认事实绝不进正式库', () => {
    it('enqueue 仅入队与落盘，不调用 writer.writeFact', async () => {
        const writer = makeWriter();
        const storage = makeStorage();
        const mgr = new FactIndexManager(storage, writer);
        const facts = mgr.extractNewFacts(BODY);

        await mgr.enqueue(facts);

        expect(writer.writeFact).not.toHaveBeenCalled();
        expect(mgr.listPending().length).toBe(facts.length);
        expect(storage.save).toHaveBeenCalled();
    });
});

describe('FactIndexManager — TR-11.4 索引落盘后可重启恢复', () => {
    it('enqueue + confirm 后，新实例 load 恢复 pending 与 confirmed', async () => {
        const storage = makeStorage();
        const writer = makeWriter();
        const mgr = new FactIndexManager(storage, writer);
        const facts = mgr.extractNewFacts(BODY);
        await mgr.enqueue(facts);

        // 确认第一个事实，其余保持 pending
        await mgr.confirm(facts[0].id);
        const pendingIds = mgr.listPending().map((f) => f.id);
        const confirmedIds = mgr.listConfirmed().map((f) => f.id);

        // 模拟重启：用同一 storage 新建实例
        const mgr2 = new FactIndexManager(storage, makeWriter());
        await mgr2.load();

        expect(mgr2.listPending().map((f) => f.id)).toEqual(pendingIds);
        expect(mgr2.listConfirmed().map((f) => f.id)).toEqual(confirmedIds);
    });

    it('落盘数据结构含 version 字段', async () => {
        const storage = makeStorage();
        const mgr = new FactIndexManager(storage, makeWriter());
        await mgr.enqueue(mgr.extractNewFacts(BODY));

        const saved = storage._getData();
        expect(saved?.version).toBe(FACT_INDEX_VERSION);
        expect(Array.isArray(saved?.pending)).toBe(true);
        expect(Array.isArray(saved?.confirmed)).toBe(true);
    });
});
