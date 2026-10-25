import { describe, expect, it } from 'vitest';
import { ALL_FULL_STEPS } from '../../../engine/step-definitions';
import { BATCH_STEP_KEYS } from '../../../ui/full-writer/batch-targets';

/**
 * 批量流水线的步骤口径契约。
 * 命令描述与弹窗文案都按 7 步撰写；若 BATCH_STEP_KEYS 与 ALL_FULL_STEPS 漂移，
 * 会出现「文案写 7 步、实际执行别的步骤」或顺序错乱。
 */
describe('批量流水线步骤契约', () => {
    it('BATCH_STEP_KEYS 都存在于 ALL_FULL_STEPS', () => {
        const known = new Set(ALL_FULL_STEPS.map((step) => step.key).filter(Boolean));
        for (const key of BATCH_STEP_KEYS) {
            expect(known.has(key), `未知步骤 key: ${key}`).toBe(true);
        }
    });

    it('BATCH_STEP_KEYS 顺序是 ALL_FULL_STEPS 的子序列', () => {
        const order = new Map<string, number>();
        ALL_FULL_STEPS.forEach((step, i) => {
            if (step.key) order.set(step.key, i);
        });

        const indices = BATCH_STEP_KEYS.map((key) => order.get(key));
        expect(indices.every((index) => index !== undefined)).toBe(true);

        const numeric = indices as number[];
        const ascending = numeric.every((value, i) => i === 0 || value > numeric[i - 1]);
        expect(ascending, `步骤顺序漂移: ${BATCH_STEP_KEYS.join(' → ')}`).toBe(true);
    });

    it('BATCH_STEP_KEYS 无重复且固定为 7 步', () => {
        expect(new Set(BATCH_STEP_KEYS).size).toBe(BATCH_STEP_KEYS.length);
        expect(BATCH_STEP_KEYS).toHaveLength(7);
    });
});
