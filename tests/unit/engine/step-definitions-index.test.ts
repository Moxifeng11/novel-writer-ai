import { describe, expect, it } from 'vitest';
import { ALL_FULL_STEPS, STEP_INDEX_MIGRATION_MAP } from '../../../engine/step-definitions';

/**
 * 导航/执行器大量按数组位置取步骤（如 `ALL_FULL_STEPS[currentStepIndex]`），
 * 同时又有按 `index` 字段查找的路径。两者一旦漂移，步骤推进会跳过或重跑。
 * 这组契约用例锁定「index === 数组下标」与迁移映射目标合法。
 */
describe('ALL_FULL_STEPS 下标契约', () => {
    it('index 必须等于数组下标', () => {
        expect(ALL_FULL_STEPS.map(step => step.index)).toEqual(
            ALL_FULL_STEPS.map((_, i) => i),
        );
    });

    it('除首尾空 key 外，步骤 key 唯一', () => {
        const keys = ALL_FULL_STEPS.map(step => step.key).filter(Boolean);
        expect(new Set(keys).size).toBe(keys.length);
    });

    it('迁移映射的每个目标都是合法下标且与 index 一致', () => {
        for (const target of Object.values(STEP_INDEX_MIGRATION_MAP)) {
            expect(target).toBeGreaterThanOrEqual(0);
            expect(target).toBeLessThan(ALL_FULL_STEPS.length);
            expect(ALL_FULL_STEPS[target].index).toBe(target);
        }
    });
});
