/**
 * 上下文配额策略（G2-4）
 *
 * 配额由「本次输入预算」推导，而入口是进程级单值。这里锁住两件事：
 *  1. 预算越大切片越大，但有绝对上限，小窗口不会比旧常量更差
 *  2. withActiveInputBudget 必须成对还原——异步流程交错时不能把上一个流程的
 *     预算留给下一个流程（否则云端流程可能按本地配额切上下文，反之亦然）
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
    activeContextQuotas,
    getActiveInputBudget,
    resetActiveInputBudget,
    resolveContextQuotas,
    setActiveInputBudget,
    withActiveInputBudget,
} from '../../../shared/context-budget-policy';

afterEach(() => { resetActiveInputBudget(); });

describe('resolveContextQuotas', () => {
    it('小窗口不劣于旧常量（32K 仍保留基准下限）', () => {
        const small = resolveContextQuotas(32_000);
        expect(small.prevChapterEndingChars).toBeGreaterThanOrEqual(400);
        expect(small.longTermMemoryChars).toBeGreaterThanOrEqual(1000);
        expect(small.knowledgePerDimensionChars).toBeGreaterThanOrEqual(600);
    });

    it('窗口越大配额越大，并受绝对上限约束', () => {
        const small = resolveContextQuotas(32_000);
        const base = resolveContextQuotas(120_000);
        const huge = resolveContextQuotas(1_000_000);

        expect(base.longTermMemoryChars).toBeGreaterThan(small.longTermMemoryChars);
        expect(huge.longTermMemoryChars).toBeGreaterThan(base.longTermMemoryChars);
        // 绝对上限：再大的窗口也不会无限放大
        expect(huge.longTermMemoryChars).toBeLessThanOrEqual(12_000);
        expect(huge.prevChapterEndingChars).toBeLessThanOrEqual(4_000);
        expect(huge.knowledgePerDimensionChars).toBeLessThanOrEqual(6_000);
    });

    it('未传预算时按默认参考窗口（120K）计算', () => {
        expect(resolveContextQuotas()).toEqual(resolveContextQuotas(120_000));
    });
});

describe('withActiveInputBudget', () => {
    it('流程内生效、结束后恢复（默认 → 临时 → 默认）', async () => {
        expect(getActiveInputBudget()).toBe(0);
        const seen = await withActiveInputBudget(64_000, () => getActiveInputBudget());
        expect(seen).toBe(64_000);
        expect(getActiveInputBudget()).toBe(0);
    });

    it('嵌套时逐层还原，不把内层预算留给外层', async () => {
        setActiveInputBudget(120_000);
        const outer = await withActiveInputBudget(64_000, async () => {
            const inner = await withActiveInputBudget(8_000, () => getActiveInputBudget());
            return { inner, afterInner: getActiveInputBudget() };
        });
        expect(outer.inner).toBe(8_000);
        expect(outer.afterInner).toBe(64_000);
        expect(getActiveInputBudget()).toBe(120_000);
    });

    it('流程抛错也必须还原，否则后续流程会用错配额', async () => {
        setActiveInputBudget(32_000);
        await expect(withActiveInputBudget(200_000, async () => {
            throw new Error('boom');
        })).rejects.toThrow('boom');
        expect(getActiveInputBudget()).toBe(32_000);
    });

    it('activeContextQuotas 跟随临时预算变化，而不是停留在旧缓存', async () => {
        const small = await withActiveInputBudget(32_000, () => activeContextQuotas().longTermMemoryChars);
        const large = await withActiveInputBudget(1_000_000, () => activeContextQuotas().longTermMemoryChars);
        expect(large).toBeGreaterThan(small);
    });

    it('传 0 视为恢复默认预算', async () => {
        setActiveInputBudget(64_000);
        const seen = await withActiveInputBudget(0, () => getActiveInputBudget());
        expect(seen).toBe(0);
        expect(getActiveInputBudget()).toBe(64_000);
    });
});
