/**
 * pet-image-model 单测：自定义形象配置校验与切帧
 */

import { describe, expect, it } from 'vitest';
import {
    describePetImageConfig,
    isSupportedImagePath,
    normalizePetImageConfig,
    PET_IMAGE_DEFAULT_COLS,
    PET_IMAGE_DEFAULT_ROWS,
    PET_IMAGE_MOOD_ORDER,
    poseFrameFor,
} from '@/shared/pet-image-model';

describe('isSupportedImagePath 扩展名校验', () => {
    it('支持 png/jpg/jpeg/webp/gif', () => {
        for (const path of ['a.png', 'a.jpg', 'a.jpeg', 'a.webp', 'a.gif']) {
            expect(isSupportedImagePath(path), path).toBe(true);
        }
    });

    it('大小写不敏感', () => {
        expect(isSupportedImagePath('A.PNG')).toBe(true);
    });

    it('非图片或空路径被拒绝', () => {
        expect(isSupportedImagePath('a.txt')).toBe(false);
        expect(isSupportedImagePath('')).toBe(false);
        expect(isSupportedImagePath('   ')).toBe(false);
    });
});

describe('normalizePetImageConfig 配置规范化', () => {
    it('合法配置原样返回', () => {
        expect(normalizePetImageConfig({ path: '素材/桌宠.png', cols: 3, rows: 2 }))
            .toEqual({ path: '素材/桌宠.png', cols: 3, rows: 2 });
    });

    it('路径非法返回 null', () => {
        expect(normalizePetImageConfig({ path: 'a.txt', cols: 2, rows: 2 })).toBeNull();
        expect(normalizePetImageConfig({ cols: 2, rows: 2 })).toBeNull();
        expect(normalizePetImageConfig(null)).toBeNull();
    });

    it('网格非法回落默认 2×2', () => {
        const config = normalizePetImageConfig({ path: 'a.png', cols: 0, rows: 99 });
        expect(config?.cols).toBe(PET_IMAGE_DEFAULT_COLS);
        expect(config?.rows).toBe(PET_IMAGE_DEFAULT_ROWS);
    });

    it('小数网格向下取整', () => {
        expect(normalizePetImageConfig({ path: 'a.png', cols: 3.7, rows: 2.2 }))
            .toEqual({ path: 'a.png', cols: 3, rows: 2 });
    });
});

describe('PET_IMAGE_MOOD_ORDER 状态顺序', () => {
    it('固定 6 档且顺序稳定（用户按此准备帧）', () => {
        expect(PET_IMAGE_MOOD_ORDER).toEqual(['idle', 'writing', 'thinking', 'happy', 'sleep', 'error']);
    });
});

describe('poseFrameFor 切帧', () => {
    it('2×2：idle 左上；error（第 6 帧）回绕到第一行第二格', () => {
        const config = { path: 'a.png', cols: 2, rows: 2 };
        expect(poseFrameFor('idle', config)).toEqual({ xPercent: 0, yPercent: 0 });
        expect(poseFrameFor('error', config)).toEqual({ xPercent: 100, yPercent: 0 });
    });

    it('2×2：帧数不足时状态会共用格子（网格小于 6 档）', () => {
        const config = { path: 'a.png', cols: 2, rows: 2 };
        expect(poseFrameFor('writing', config)).toEqual(poseFrameFor('error', config));
    });

    it('3×2：按状态顺序换行', () => {
        const config = { path: 'a.png', cols: 3, rows: 2 };
        expect(poseFrameFor('thinking', config)).toEqual({ xPercent: 100, yPercent: 0 });
        expect(poseFrameFor('sleep', config)).toEqual({ xPercent: 50, yPercent: 100 });
    });

    it('未知状态按第一帧处理', () => {
        expect(poseFrameFor('nope', { path: 'a.png', cols: 2, rows: 2 })).toEqual({ xPercent: 0, yPercent: 0 });
    });
});

describe('describePetImageConfig 提示文本', () => {
    it('包含网格与状态顺序', () => {
        const text = describePetImageConfig({ path: 'a.png', cols: 2, rows: 2 });
        expect(text).toContain('2×2');
        expect(text).toContain('idle');
    });
});
