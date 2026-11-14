/**
 * writing-pet 图层信息单测（v1.2 分层重构）
 *
 * 锁住三件事：
 *  1. 图层清单稳定（5 层，必需层齐全，顺序即 z 序）
 *  2. 状态到雪碧图帧的坐标换算正确（有美术图后切帧不出错）
 *  3. 必需层/可选层的语义约定
 */

import { describe, expect, it } from 'vitest';
import { PET_LAYERS, type PetLayerId } from '@/ui/writing-pet';
import { poseFrameFor } from '@/shared/pet-image-model';

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

describe('poseFrameFor 自定义图片切帧', () => {
    const sheet = { path: '素材/桌宠.png', cols: 2, rows: 2 };

    it('idle 在左上（0%,0%）', () => {
        expect(poseFrameFor('idle', sheet)).toEqual({ xPercent: 0, yPercent: 0 });
    });

    it('writing 在右上（100%,0%）', () => {
        expect(poseFrameFor('writing', sheet)).toEqual({ xPercent: 100, yPercent: 0 });
    });

    it('thinking 在左下（0%,100%）', () => {
        expect(poseFrameFor('thinking', sheet)).toEqual({ xPercent: 0, yPercent: 100 });
    });

    it('happy 在右下（100%,100%）', () => {
        expect(poseFrameFor('happy', sheet)).toEqual({ xPercent: 100, yPercent: 100 });
    });

    it('3×2 图：sleep（第 5 帧）在中下（50%,100%）', () => {
        expect(poseFrameFor('sleep', { path: 'a.png', cols: 3, rows: 2 })).toEqual({ xPercent: 50, yPercent: 100 });
    });

    it('单格图恒为 (0,0)', () => {
        expect(poseFrameFor('happy', { path: 'a.png', cols: 1, rows: 1 })).toEqual({ xPercent: 0, yPercent: 0 });
    });

    it('超出网格的状态回落到第一帧（不产生 NaN）', () => {
        const frame = poseFrameFor('unknown-mood', { path: 'a.png', cols: 2, rows: 2 });
        expect(Number.isFinite(frame.xPercent)).toBe(true);
        expect(frame).toEqual({ xPercent: 0, yPercent: 0 });
    });
});
