/**
 * writing-pet 图层信息单测（v1.2 分层重构）
 *
 * 锁住三件事：
 *  1. 图层清单稳定（5 层，必需层齐全，顺序即 z 序）
 *  2. 状态到雪碧图帧的坐标换算正确（有美术图后切帧不出错）
 *  3. 必需层/可选层的语义约定
 */

import { describe, expect, it } from 'vitest';
import { PET_LAYERS, PET_POSE_FRAMES, poseFrameFor, type PetLayerId } from '@/ui/writing-pet';

describe('PET_LAYERS 图层信息', () => {
    it('5 层，顺序即 z 序（shadow → aura → body → detail → fx）', () => {
        expect(PET_LAYERS.map(layer => layer.id)).toEqual(['shadow', 'aura', 'body', 'detail', 'fx']);
    });

    it('必需层齐全：shadow / body / detail', () => {
        const required = PET_LAYERS.filter(layer => layer.required).map(layer => layer.id);
        expect(required).toEqual(['shadow', 'body', 'detail']);
    });

    it('可选层：aura 默认关，fx 默认开', () => {
        const aura = PET_LAYERS.find(layer => layer.id === 'aura')!;
        const fx = PET_LAYERS.find(layer => layer.id === 'fx')!;
        expect(aura.required).toBe(false);
        expect(aura.defaultVisible).toBe(false);
        expect(fx.required).toBe(false);
        expect(fx.defaultVisible).toBe(true);
    });

    it('每层都有中文标签', () => {
        for (const layer of PET_LAYERS) {
            expect(layer.label.length, layer.id).toBeGreaterThan(0);
        }
    });

    it('图层 id 唯一', () => {
        const ids = PET_LAYERS.map(layer => layer.id as PetLayerId);
        expect(new Set(ids).size).toBe(ids.length);
    });
});

describe('poseFrameFor 雪碧图帧换算（催更姬排布）', () => {
    it('idle 在左上（0%,0%）', () => {
        expect(poseFrameFor('idle', { cols: 2, rows: 2 })).toEqual({ xPercent: 0, yPercent: 0 });
    });

    it('writing 在右上（100%,0%）', () => {
        expect(poseFrameFor('writing', { cols: 2, rows: 2 })).toEqual({ xPercent: 100, yPercent: 0 });
    });

    it('sleep 与 writing 同帧（右上）', () => {
        expect(poseFrameFor('sleep', { cols: 2, rows: 2 })).toEqual(poseFrameFor('writing', { cols: 2, rows: 2 }));
    });

    it('happy 在左下（0%,100%）', () => {
        expect(poseFrameFor('happy', { cols: 2, rows: 2 })).toEqual({ xPercent: 0, yPercent: 100 });
    });

    it('thinking / error 在右下（100%,100%）', () => {
        expect(poseFrameFor('thinking', { cols: 2, rows: 2 })).toEqual({ xPercent: 100, yPercent: 100 });
        expect(poseFrameFor('error', { cols: 2, rows: 2 })).toEqual({ xPercent: 100, yPercent: 100 });
    });

    it('单格图恒为 (0,0)', () => {
        expect(poseFrameFor('happy', { cols: 1, rows: 1 })).toEqual({ xPercent: 0, yPercent: 0 });
    });

    it('网格非法值按 1 处理（不产生 NaN）', () => {
        const frame = poseFrameFor('idle', { cols: 0, rows: 0 });
        expect(Number.isFinite(frame.xPercent)).toBe(true);
        expect(Number.isFinite(frame.yPercent)).toBe(true);
    });

    it('帧映射覆盖全部 6 档状态', () => {
        for (const mood of ['idle', 'happy', 'sleep', 'writing', 'thinking', 'error'] as const) {
            expect(PET_POSE_FRAMES[mood]).toBeTruthy();
        }
    });
});
