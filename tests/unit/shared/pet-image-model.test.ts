/**
 * pet-image-model 单测：自定义形象配置校验与切帧
 */

import { describe, expect, it } from 'vitest';
import {
    describePetImageConfig,
    detectPetGrid,
    isImageDataUrl,
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
        expect(normalizePetImageConfig({ source: 'vault' as const, path: '素材/桌宠.png', cols: 3, rows: 2 }))
            .toEqual({ source: 'vault' as const, path: '素材/桌宠.png', cols: 3, rows: 2 });
    });

    it('路径非法返回 null', () => {
        expect(normalizePetImageConfig({ source: 'vault' as const, path: 'a.txt', cols: 2, rows: 2 })).toBeNull();
        expect(normalizePetImageConfig({ cols: 2, rows: 2 })).toBeNull();
        expect(normalizePetImageConfig(null)).toBeNull();
    });

    it('网格非法回落默认 2×2', () => {
        const config = normalizePetImageConfig({ source: 'vault' as const, path: 'a.png', cols: 0, rows: 99 });
        expect(config?.cols).toBe(PET_IMAGE_DEFAULT_COLS);
        expect(config?.rows).toBe(PET_IMAGE_DEFAULT_ROWS);
    });

    it('小数网格向下取整', () => {
        expect(normalizePetImageConfig({ path: 'a.png', cols: 3.7, rows: 2.2 }))
            .toEqual({ source: 'vault' as const, path: 'a.png', cols: 3, rows: 2 });
    });
});

describe('PET_IMAGE_MOOD_ORDER 状态顺序', () => {
    it('固定 6 档且顺序稳定（用户按此准备帧）', () => {
        expect(PET_IMAGE_MOOD_ORDER).toEqual(['idle', 'writing', 'thinking', 'happy', 'sleep', 'error']);
    });
});

describe('poseFrameFor 切帧（每格 = 一个状态）', () => {
    it('2×2：按状态顺序占用格子，格子不够时共用最后一格', () => {
        const config = { source: 'vault' as const, path: 'a.png', cols: 2, rows: 2 };
        expect(poseFrameFor('idle', config)).toEqual({ xPercent: 0, yPercent: 0 });
        expect(poseFrameFor('writing', config)).toEqual({ xPercent: 100, yPercent: 0 });
        expect(poseFrameFor('thinking', config)).toEqual({ xPercent: 0, yPercent: 100 });
        expect(poseFrameFor('happy', config)).toEqual({ xPercent: 100, yPercent: 100 });
        // 6 个状态只有 4 格 → 后两个共用最后一格
        expect(poseFrameFor('sleep', config)).toEqual({ xPercent: 100, yPercent: 100 });
        expect(poseFrameFor('error', config)).toEqual({ xPercent: 100, yPercent: 100 });
    });

    it('3×2：6 个状态各占一格', () => {
        const config = { source: 'vault' as const, path: 'a.png', cols: 3, rows: 2 };
        expect(poseFrameFor('idle', config)).toEqual({ xPercent: 0, yPercent: 0 });
        expect(poseFrameFor('writing', config)).toEqual({ xPercent: 50, yPercent: 0 });
        expect(poseFrameFor('thinking', config)).toEqual({ xPercent: 100, yPercent: 0 });
        expect(poseFrameFor('happy', config)).toEqual({ xPercent: 0, yPercent: 100 });
        expect(poseFrameFor('sleep', config)).toEqual({ xPercent: 50, yPercent: 100 });
        expect(poseFrameFor('error', config)).toEqual({ xPercent: 100, yPercent: 100 });
    });

    it('单列/单行网格不越界', () => {
        expect(poseFrameFor('idle', { source: 'vault' as const, path: 'a.png', cols: 1, rows: 6 })).toEqual({ xPercent: 0, yPercent: 0 });
        expect(poseFrameFor('error', { source: 'vault' as const, path: 'a.png', cols: 1, rows: 6 })).toEqual({ xPercent: 0, yPercent: 100 });
        expect(poseFrameFor('error', { source: 'vault' as const, path: 'a.png', cols: 6, rows: 1 })).toEqual({ xPercent: 100, yPercent: 0 });
    });

    it('未知状态按第一格处理', () => {
        expect(poseFrameFor('nope', { source: 'vault' as const, path: 'a.png', cols: 3, rows: 2 })).toEqual({ xPercent: 0, yPercent: 0 });
    });
});

describe('detectPetGrid 自动识别网格', () => {
    it('6 帧单行雪碧图（1536×256）识别为 6 列 1 行', () => {
        expect(detectPetGrid(1536, 256)).toEqual({ cols: 6, rows: 1 });
    });

    it('3×2 雪碧图（1536×1024）识别为 3 列 2 行', () => {
        expect(detectPetGrid(1536, 1024)).toEqual({ cols: 3, rows: 2 });
    });

    it('正方形大图（768×768）按 2×2 处理', () => {
        expect(detectPetGrid(768, 768)).toEqual({ cols: 2, rows: 2 });
    });

    it('小图不足切分时回落 1×1', () => {
        expect(detectPetGrid(48, 48)).toEqual({ cols: 1, rows: 1 });
    });

    it('4:3 图识别出的单格接近正方形', () => {
        const grid = detectPetGrid(800, 600);
        expect(800 / grid.cols).toBe(600 / grid.rows);
    });

    it('非法尺寸安全回落', () => {
        expect(detectPetGrid(0, 0)).toEqual({ cols: 1, rows: 1 });
        expect(detectPetGrid(Number.NaN, 100)).toEqual({ cols: 1, rows: 1 });
    });
});

describe('describePetImageConfig 提示文本', () => {
    it('包含网格与状态顺序', () => {
        const text = describePetImageConfig({ source: 'vault' as const, path: 'a.png', cols: 3, rows: 2 });
        expect(text).toContain('3×2');
        expect(text).toContain('6 个状态格');
        expect(text).toContain('idle');
    });
});

describe('本机图片（data URL）支持', () => {
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

    it('合法 png/jpg/webp/gif data URL 通过', () => {
        for (const prefix of ['data:image/png;base64,', 'data:image/jpeg;base64,', 'data:image/webp;base64,', 'data:image/gif;base64,']) {
            expect(isImageDataUrl(prefix + 'AAAA'), prefix).toBe(true);
        }
    });

    it('非图片或空 data URL 被拒绝', () => {
        expect(isImageDataUrl('data:text/plain;base64,AAAA')).toBe(false);
        expect(isImageDataUrl('')).toBe(false);
        expect(isImageDataUrl('not-a-url')).toBe(false);
    });

    it('规范化本机图片配置（source=file）', () => {
        expect(normalizePetImageConfig({ source: 'file', dataUrl, cols: 2, rows: 2 }))
            .toEqual({ source: 'file', dataUrl, cols: 2, rows: 2 });
    });

    it('source=file 但 dataUrl 非法 → null', () => {
        expect(normalizePetImageConfig({ source: 'file', dataUrl: 'bad', cols: 2, rows: 2 })).toBeNull();
    });

    it('只有 dataUrl 没有 source 也能识别为本机图片', () => {
        expect(normalizePetImageConfig({ dataUrl, cols: 2, rows: 2 })?.source).toBe('file');
    });

    it('描述文本区分来源', () => {
        expect(describePetImageConfig({ source: 'file', dataUrl, cols: 2, rows: 2 })).toContain('本机图片');
        expect(describePetImageConfig({ source: 'vault', path: 'a.png', cols: 2, rows: 2 })).toContain('vault');
    });
});
