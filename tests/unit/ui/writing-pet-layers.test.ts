/**
 * writing-pet 图层信息单测（v1.2 分层重构）
 *
 * 锁住三件事：
 *  1. 图层清单稳定（5 层，必需层齐全，顺序即 z 序）
 *  2. 状态到雪碧图帧的坐标换算正确（有美术图后切帧不出错）
 *  3. 必需层/可选层的语义约定
 */

import { describe, expect, it } from 'vitest';
import { PET_LAYERS, PET_ROLE_LABELS, PET_ROLE_SHEETS, poseFrameFor, type PetLayerId } from '@/ui/writing-pet';

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

describe('poseFrameFor 雪碧图帧换算（双角色）', () => {
    it('催更姬 2×2：idle 左上（0%,0%）', () => {
        expect(poseFrameFor('idle', 'cuigengji')).toEqual({ xPercent: 0, yPercent: 0 });
    });

    it('催更姬 2×2：writing 右上（100%,0%）', () => {
        expect(poseFrameFor('writing', 'cuigengji')).toEqual({ xPercent: 100, yPercent: 0 });
    });

    it('催更姬 2×2：happy 左下（0%,100%）', () => {
        expect(poseFrameFor('happy', 'cuigengji')).toEqual({ xPercent: 0, yPercent: 100 });
    });

    it('催更姬 2×2：thinking / error 右下（100%,100%）', () => {
        expect(poseFrameFor('thinking', 'cuigengji')).toEqual({ xPercent: 100, yPercent: 100 });
        expect(poseFrameFor('error', 'cuigengji')).toEqual({ xPercent: 100, yPercent: 100 });
    });

    it('大肥鱼 3×2：idle 左上 / thinking 中上 / writing 右上', () => {
        expect(poseFrameFor('idle', 'bigfish')).toEqual({ xPercent: 0, yPercent: 0 });
        expect(poseFrameFor('thinking', 'bigfish')).toEqual({ xPercent: 50, yPercent: 0 });
        expect(poseFrameFor('writing', 'bigfish')).toEqual({ xPercent: 100, yPercent: 0 });
    });

    it('大肥鱼 3×2：happy 左下 / sleep 中下 / error 右下', () => {
        expect(poseFrameFor('happy', 'bigfish')).toEqual({ xPercent: 0, yPercent: 100 });
        expect(poseFrameFor('sleep', 'bigfish')).toEqual({ xPercent: 50, yPercent: 100 });
        expect(poseFrameFor('error', 'bigfish')).toEqual({ xPercent: 100, yPercent: 100 });
    });

    it('默认角色为催更姬', () => {
        expect(poseFrameFor('idle')).toEqual(poseFrameFor('idle', 'cuigengji'));
    });

    it('帧映射覆盖全部 6 档状态（两角色都要）', () => {
        for (const role of ['cuigengji', 'bigfish'] as const) {
            for (const mood of ['idle', 'happy', 'sleep', 'writing', 'thinking', 'error'] as const) {
                expect(PET_ROLE_SHEETS[role].frames[mood], role + '/' + mood).toBeTruthy();
            }
        }
    });

    it('两角色都有雪碧图数据与网格', () => {
        for (const role of ['cuigengji', 'bigfish'] as const) {
            expect(PET_ROLE_SHEETS[role].dataUrl.startsWith('data:image/png;base64,')).toBe(true);
            expect(PET_ROLE_SHEETS[role].cols).toBeGreaterThan(1);
            expect(PET_ROLE_SHEETS[role].rows).toBeGreaterThan(0);
        }
    });

    it('角色显示名齐全', () => {
        expect(PET_ROLE_LABELS.cuigengji).toBeTruthy();
        expect(PET_ROLE_LABELS.bigfish).toBeTruthy();
    });
});
