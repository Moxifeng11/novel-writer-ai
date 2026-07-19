import { describe, it, expect, vi } from 'vitest';

// step-runner.ts 间接依赖 obsidian，需要在导入前 mock
vi.mock('obsidian', () => ({}));

import {
    ALL_FULL_STEPS,
    STEP_INDEX_MIGRATION_MAP,
    migrateStepIndex,
} from '../../../engine/step-definitions';

describe('ALL_FULL_STEPS 完整性', () => {
    it('共 11 个步骤', () => {
        expect(ALL_FULL_STEPS.length).toBe(11);
    });

    it('index 字段连续 0..10', () => {
        const indices = ALL_FULL_STEPS.map(s => s.index);
        expect(indices).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    });

    it('非空 key 不重复', () => {
        const keys = ALL_FULL_STEPS.map(s => s.key).filter(k => k !== '');
        expect(new Set(keys).size).toBe(keys.length);
    });

    it('required 步骤恰好 4 个（上下文加载/信息规划/正文生成/章节结算）', () => {
        const required = ALL_FULL_STEPS.filter(s => s.required);
        expect(required.length).toBe(4);
        const indices = required.map(s => s.index).sort((a, b) => a - b);
        expect(indices).toEqual([0, 1, 7, 10]);
    });

    it('正文生成位于 index=7', () => {
        const body = ALL_FULL_STEPS.find(s => s.key === 'bodyGeneration');
        expect(body?.index).toBe(7);
    });

    it('V2 灵魂驱动三步均存在', () => {
        expect(ALL_FULL_STEPS.find(s => s.key === 'characterSoul')?.index).toBe(3);
        expect(ALL_FULL_STEPS.find(s => s.key === 'emotionPlan')?.index).toBe(5);
        expect(ALL_FULL_STEPS.find(s => s.key === 'sceneExpand')?.index).toBe(6);
    });

    it('auto 步骤恰好 3 个（上下文加载/角色灵魂提取/章节结算）', () => {
        const autos = ALL_FULL_STEPS.filter(s => s.auto).map(s => s.index).sort((a, b) => a - b);
        expect(autos).toEqual([0, 3, 10]);
    });
});

describe('STEP_INDEX_MIGRATION_MAP 完整性', () => {
    it('覆盖全部 15 个旧索引', () => {
        const oldIndices = Object.keys(STEP_INDEX_MIGRATION_MAP).map(Number).sort((a, b) => a - b);
        expect(oldIndices).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    });

    it('所有新值在 0..10 范围内', () => {
        for (const v of Object.values(STEP_INDEX_MIGRATION_MAP)) {
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(10);
        }
    });

    it('新值覆盖全部 11 个新索引（多对一合并）', () => {
        const newValues = Object.values(STEP_INDEX_MIGRATION_MAP);
        const uniqueNewValues = new Set(newValues);
        expect(uniqueNewValues.size).toBe(11);
        for (let i = 0; i <= 10; i++) {
            expect(uniqueNewValues.has(i)).toBe(true);
        }
    });

    it('对象被 Object.freeze 保护', () => {
        expect(Object.isFrozen(STEP_INDEX_MIGRATION_MAP)).toBe(true);
    });
});

describe('migrateStepIndex 行为', () => {
    const cases: Array<[number, number]> = [
        [0, 0],
        [1, 1],
        [2, 2],
        [12, 3],
        [3, 4],
        [13, 5],
        [14, 6],
        [4, 7],
        [5, 8],
        [6, 8],
        [7, 8],
        [8, 8],
        [9, 8],
        [10, 9],
        [11, 10],
    ];

    it.each(cases)('oldIndex=%i → newIndex=%i', (oldIdx, newIdx) => {
        expect(migrateStepIndex(oldIdx)).toBe(newIdx);
    });

    it('超出范围输入原样返回（容错）', () => {
        expect(migrateStepIndex(99)).toBe(99);
        expect(migrateStepIndex(-1)).toBe(-1);
    });

    it('非有限数字回退到 0', () => {
        expect(migrateStepIndex(NaN)).toBe(0);
        expect(migrateStepIndex(Infinity)).toBe(0);
        expect(migrateStepIndex('1' as any)).toBe(0);
    });
});
