/**
 * co-writer-confirm-queue.test.ts — Task 12 队列接线测试
 *
 * 验证 CoWriterEngine.confirmStateChanges 的核心访问控制（AC-7）：
 * 用户确认动作不再直写正式库，而是转 PendingFact 进 Task 11 待确认队列；
 * 入队失败保留待处理项可重试；registry 缺失时降级返回 0 不崩溃。
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../main', () => ({
    default: class NovelWriterPlugin {},
}));

import { CoWriterEngine } from '../../../engine/co-writer-engine';
import type { EntityStateChange } from '../../../engine/entity-state-manager';

const SIX_CHANGES: EntityStateChange[] = [
    { entityName: '林晚', newStatus: '左臂受伤', reason: '', confidence: 0.9, entityType: 'character' },
    { entityName: '青云宗', newStatus: '新地点', reason: '', confidence: 0.8, entityType: 'location' },
    { entityName: '断魂剑', newStatus: '新道具', reason: '', confidence: 0.8, entityType: 'prop' },
    { entityName: '林晚与萧然', newStatus: '结盟', reason: '', confidence: 0.7, entityType: 'relationship' },
    { entityName: '玉佩之谜', newStatus: '新伏笔', reason: '', confidence: 0.7, entityType: 'foreshadow' },
    { entityName: '进入秘境', newStatus: '已完成', reason: '', confidence: 0.9, entityType: 'plotNode' },
];

/** 构造引擎：注入 mock session / pendingStateChanges / registry */
function makeEngine(opts: {
    changes?: EntityStateChange[];
    registry?: unknown;
    enqueueImpl?: (facts: unknown[]) => Promise<void>;
} = {}) {
    const enqueue = vi.fn(opts.enqueueImpl ?? (async (_facts: unknown[]) => {}));
    const manager = { enqueue, listPending: vi.fn(() => []) };
    const getFactIndexManager = vi.fn(async () => manager);
    const registry = opts.registry === null
        ? null
        : (opts.registry ?? { getFactIndexManager });

    const aiEngine = {
        getPlugin: () => ({ settings: {} }),
        callAI: vi.fn(async () => ({ content: '' })),
    };
    const contextManager = { gatherAll: vi.fn() };
    const engine = new CoWriterEngine(
        {} as never, aiEngine as never, contextManager as never, registry as never,
    ) as unknown as Record<string, unknown>;

    engine.session = { project: '测试项目', chapterNum: 1, chapterName: '第1章' };
    engine.pendingStateChanges = opts.changes ?? [];
    engine.entityStateManager = {
        applyStateChanges: vi.fn(async () => {}),
    };

    return { engine, enqueue, getFactIndexManager, applyStateChanges: (engine.entityStateManager as { applyStateChanges: ReturnType<typeof vi.fn> }).applyStateChanges };
}

describe('CoWriterEngine.confirmStateChanges — Task 12 队列接线', () => {
    it('TR-Q1: 确认后变化进待确认队列（enqueue 收到六类 facts），pending 清空', async () => {
        const { engine, enqueue } = makeEngine({ changes: SIX_CHANGES });

        const count = await (engine.confirmStateChanges as () => Promise<number>).call(engine);

        expect(count).toBe(6);
        expect(enqueue).toHaveBeenCalledTimes(1);
        const facts = enqueue.mock.calls[0][0] as Array<Record<string, unknown>>;
        expect(facts).toHaveLength(6);
        for (const f of facts) {
            expect(f.source).toBe('co-writer');
            expect(f.status).toBe('pending');
        }
        expect(engine.pendingStateChanges).toEqual([]);
    });

    it('TR-Q2: 不再调用 applyStateChanges（不直写正式库）', async () => {
        const { engine, applyStateChanges } = makeEngine({ changes: SIX_CHANGES });

        await (engine.confirmStateChanges as () => Promise<number>).call(engine);

        expect(applyStateChanges).not.toHaveBeenCalled();
    });

    it('TR-Q3: registry 缺失时返回 0 不崩溃，pending 保留', async () => {
        const { engine } = makeEngine({ changes: SIX_CHANGES, registry: null });
        // registry=null 时走 plugin 回退；mock plugin 无 engineRegistry → 降级路径

        const count = await (engine.confirmStateChanges as () => Promise<number>).call(engine);

        expect(count).toBe(0);
        expect(engine.pendingStateChanges).toHaveLength(6); // 保留待处理项
    });

    it('TR-Q4: enqueue 抛异常时返回 0，pending 保留可重试', async () => {
        const { engine } = makeEngine({
            changes: SIX_CHANGES,
            enqueueImpl: async () => { throw new Error('落盘失败'); },
        });

        const count = await (engine.confirmStateChanges as () => Promise<number>).call(engine);

        expect(count).toBe(0);
        expect(engine.pendingStateChanges).toHaveLength(6);
    });

    it('TR-Q5: 无待处理项时返回 0', async () => {
        const { engine, enqueue } = makeEngine({ changes: [] });

        const count = await (engine.confirmStateChanges as () => Promise<number>).call(engine);

        expect(count).toBe(0);
        expect(enqueue).not.toHaveBeenCalled();
    });
});
