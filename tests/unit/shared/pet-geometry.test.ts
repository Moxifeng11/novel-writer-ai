/**
 * pet-geometry 单测：桌宠边界钳制与边缘吸附
 */

import { describe, expect, it } from 'vitest';
import {
    clampPetPoint,
    PET_DEFAULT_SNAP_EDGES,
    petViewportOf,
    PET_EDGE_MARGIN,
    PET_SNAP_THRESHOLD,
    snapPetPoint,
    type PetViewport,
} from '@/shared/pet-geometry';

const view: PetViewport = petViewportOf(1200, 800);
const SIZE = 118;

describe('clampPetPoint 边界钳制', () => {
    it('区域内的坐标不变', () => {
        expect(clampPetPoint({ x: 400, y: 300 }, view, SIZE)).toEqual({ x: 400, y: 300 });
    });

    it('左上越界被拉回留白内', () => {
        expect(clampPetPoint({ x: -50, y: -20 }, view, SIZE))
            .toEqual({ x: PET_EDGE_MARGIN, y: PET_EDGE_MARGIN });
    });

    it('右下越界被拉回可视区', () => {
        expect(clampPetPoint({ x: 5000, y: 5000 }, view, SIZE))
            .toEqual({ x: 1200 - SIZE - PET_EDGE_MARGIN, y: 800 - SIZE - PET_EDGE_MARGIN });
    });

    it('窗口小于桌宠时不产生负数区间（min <= max）', () => {
        const tiny = petViewportOf(60, 60);
        const result = clampPetPoint({ x: 30, y: 30 }, tiny, SIZE);
        expect(result.x).toBe(PET_EDGE_MARGIN);
        expect(result.y).toBe(PET_EDGE_MARGIN);
    });
});

describe('snapPetPoint 边缘吸附', () => {
    it('靠近左边缘 → 贴左', () => {
        expect(snapPetPoint({ x: 20, y: 300 }, view, SIZE).x).toBe(PET_EDGE_MARGIN);
    });

    it('靠近右边缘 → 贴右', () => {
        const rightEdge = 1200 - SIZE - PET_EDGE_MARGIN;
        expect(snapPetPoint({ x: rightEdge - 10, y: 300 }, view, SIZE).x).toBe(rightEdge);
    });

    it('靠近底部 → 贴底', () => {
        const bottomEdge = 800 - SIZE - PET_EDGE_MARGIN;
        expect(snapPetPoint({ x: 400, y: bottomEdge - 5 }, view, SIZE).y).toBe(bottomEdge);
    });

    it('远离边缘 → 不吸附（保留原位）', () => {
        expect(snapPetPoint({ x: 400, y: 300 }, view, SIZE)).toEqual({ x: 400, y: 300 });
    });

    it('吸附阈值可配置：阈值 0 时只在完全贴边才吸附', () => {
        expect(snapPetPoint({ x: PET_EDGE_MARGIN + 5, y: 300 }, view, SIZE, 0).x)
            .toBe(PET_EDGE_MARGIN + 5);
    });

    it('默认阈值是 PET_SNAP_THRESHOLD', () => {
        expect(PET_SNAP_THRESHOLD).toBeGreaterThan(0);
        const edge = 1200 - SIZE - PET_EDGE_MARGIN;
        expect(snapPetPoint({ x: edge - PET_SNAP_THRESHOLD + 1, y: 300 }, view, SIZE).x).toBe(edge);
        expect(snapPetPoint({ x: edge - PET_SNAP_THRESHOLD - 1, y: 300 }, view, SIZE).x).toBe(edge - PET_SNAP_THRESHOLD - 1);
    });
});

describe('吸附边可自定义', () => {
    const rightEdge = 1200 - SIZE - PET_EDGE_MARGIN;
    const leftEdge = PET_EDGE_MARGIN;

    it('关闭右边吸附后，靠近右边缘不贴边', () => {
        const result = snapPetPoint({ x: rightEdge - 5, y: 300 }, view, SIZE, 28, { left: true, right: false, bottom: true });
        expect(result.x).toBe(rightEdge - 5);
    });

    it('只开底部吸附时，左右都不吸', () => {
        const result = snapPetPoint({ x: leftEdge + 5, y: 300 }, view, SIZE, 28, { left: false, right: false, bottom: true });
        expect(result.x).toBe(leftEdge + 5);
    });

    it('三条边全关等于只做钳制', () => {
        const result = snapPetPoint({ x: -100, y: 5000 }, view, SIZE, 28, { left: false, right: false, bottom: false });
        expect(result).toEqual(clampPetPoint({ x: -100, y: 5000 }, view, SIZE));
    });

    it('阈值 0 表示不吸附', () => {
        const result = snapPetPoint({ x: leftEdge + 1, y: 300 }, view, SIZE, 0);
        expect(result.x).toBe(leftEdge + 1);
    });

    it('默认边配置三条都开', () => {
        expect(PET_DEFAULT_SNAP_EDGES).toEqual({ left: true, right: true, bottom: true });
    });
});

describe('petViewportOf 可视区域', () => {
    it('无 visualViewport 偏移时等于窗口尺寸', () => {
        expect(petViewportOf(1000, 600)).toEqual({
            width: 1000, height: 600, left: 0, top: 0, right: 1000, bottom: 600,
        });
    });

    it('有偏移时 right/bottom 跟随可视区', () => {
        const v = petViewportOf(1000, 600, { left: 10, top: 20, width: 900, height: 500 });
        expect(v.right).toBe(910);
        expect(v.bottom).toBe(520);
    });

    it('非法尺寸回退到窗口尺寸', () => {
        const v = petViewportOf(1000, 600, { width: 0, height: -5 });
        expect(v.right).toBe(1000);
        expect(v.bottom).toBe(600);
    });
});
