/**
 * 数组重排单一实现的回归（M3-3）。
 *
 * 旧实现各自手写 splice：场景拖拽漏掉「移除自身后插入点左移一位」，
 * 向下拖放到目标上半区时多走一位。这里把两种语义分别钉住：
 *  - moveArrayItem：最终位置（上下移动按钮）；
 *  - moveArrayItemToInsert：移除前插入坐标（拖拽 drop）。
 */

import { describe, expect, it } from 'vitest';
import { moveArrayItem, moveArrayItemToInsert } from '../../../shared/array-move';

describe('moveArrayItem — 最终位置语义', () => {
    it('上移/下移一位', () => {
        const items = ['A', 'B', 'C'];
        expect(moveArrayItem(items, 1, 0)).toBe(true);
        expect(items).toEqual(['B', 'A', 'C']);

        expect(moveArrayItem(items, 0, 1)).toBe(true);
        expect(items).toEqual(['A', 'B', 'C']);
    });

    it('非法下标与原地不动返回 false 且不改数组', () => {
        const items = ['A', 'B'];
        expect(moveArrayItem(items, 0, 0)).toBe(false);
        expect(moveArrayItem(items, -1, 1)).toBe(false);
        expect(moveArrayItem(items, 0, 2)).toBe(false);
        expect(moveArrayItem(items, 1.5, 0)).toBe(false);
        expect(items).toEqual(['A', 'B']);
    });
});

describe('moveArrayItemToInsert — 移除前插入坐标', () => {
    it('向下拖放到目标上半区不多走一位（旧缺陷）', () => {
        // [A,B,C] 把 B 放到 C 之前 → 原地不动（旧实现会变成 [A,C,B]）
        const items = ['A', 'B', 'C'];
        expect(moveArrayItemToInsert(items, 1, 2)).toBe(false);
        expect(items).toEqual(['A', 'B', 'C']);
    });

    it('向下拖放到目标下半区落到目标之后', () => {
        const items = ['A', 'B', 'C'];
        // 放到 C 之后：insertIndex = 3
        expect(moveArrayItemToInsert(items, 1, 3)).toBe(true);
        expect(items).toEqual(['A', 'C', 'B']);
    });

    it('向上拖放到目标上半区落到目标之前', () => {
        const items = ['A', 'B', 'C'];
        // C 放到 A 之前：insertIndex = 0
        expect(moveArrayItemToInsert(items, 2, 0)).toBe(true);
        expect(items).toEqual(['C', 'A', 'B']);
    });

    it('插入下标越界时夹到合法范围', () => {
        const items = ['A', 'B'];
        expect(moveArrayItemToInsert(items, 0, 99)).toBe(true);
        expect(items).toEqual(['B', 'A']);

        const items2 = ['A', 'B'];
        expect(moveArrayItemToInsert(items2, 1, -5)).toBe(true);
        expect(items2).toEqual(['B', 'A']);
    });

    it('源下标非法返回 false', () => {
        const items = ['A'];
        expect(moveArrayItemToInsert(items, 3, 0)).toBe(false);
        expect(items).toEqual(['A']);
    });
});
