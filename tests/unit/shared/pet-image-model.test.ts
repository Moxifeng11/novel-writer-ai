/**
 * pet-image-model 单测：自定义形象配置校验与切帧
 */

import { describe, expect, it } from 'vitest';
import {
    describePetImageConfig,
    detectPetGrid,
    petAnimationIntervalMs,
    petFramePosition,
    petMoodRow,
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

describe('poseFrameFor 切帧（行=状态，列=动画帧）', () => {
    it('2×2：idle 在第 0 行第 0 帧；error 行数不足时共用最后一行', () => {
        const config = { source: 'vault' as const, path: 'a.png', cols: 2, rows: 2 };
        expect(poseFrameFor('idle', config)).toEqual({ xPercent: 0, yPercent: 0 });
        expect(poseFrameFor('error', config)).toEqual({ xPercent: 0, yPercent: 100 });
    });

    it('2×2：writing 与 error 共用最后一行', () => {
        const config = { source: 'vault' as const, path: 'a.png', cols: 2, rows: 2 };
        expect(poseFrameFor('writing', config)).toEqual(poseFrameFor('error', config));
    });

    it('3×2：状态按行排列（thinking 行数回绕到最后一行）', () => {
        const config = { source: 'vault' as const, path: 'a.png', cols: 3, rows: 2 };
        expect(poseFrameFor('idle', config)).toEqual({ xPercent: 0, yPercent: 0 });
        expect(poseFrameFor('writing', config)).toEqual({ xPercent: 0, yPercent: 100 });
        expect(poseFrameFor('thinking', config)).toEqual({ xPercent: 0, yPercent: 100 });
    });

    it('未知状态按第一帧处理', () => {
        expect(poseFrameFor('nope', { source: 'vault' as const, path: 'a.png', cols: 2, rows: 2 })).toEqual({ xPercent: 0, yPercent: 0 });
    });

    it('petFramePosition：列方向按动画帧推进，行方向按状态', () => {
        const config = { source: 'vault' as const, path: 'a.png', cols: 3, rows: 3 };
        expect(petFramePosition('idle', 0, config)).toEqual({ xPercent: 0, yPercent: 0 });
        expect(petFramePosition('idle', 1, config)).toEqual({ xPercent: 50, yPercent: 0 });
        expect(petFramePosition('idle', 2, config)).toEqual({ xPercent: 100, yPercent: 0 });
        // 帧号回绕
        expect(petFramePosition('idle', 3, config)).toEqual(petFramePosition('idle', 0, config));
        // sleep 是第 5 档 → 第 3 行（y=100）
        expect(petFramePosition('sleep', 1, config).yPercent).toBe(100);
    });

    it('单列不打乱行映射（cols=1 时 x 恒为 0）', () => {
        const config = { source: 'vault' as const, path: 'a.png', cols: 1, rows: 6 };
        expect(petFramePosition('writing', 0, config)).toEqual({ xPercent: 0, yPercent: 20 });
    });
});

describe('petMoodRow / petAnimationIntervalMs', () => {
    it('行数不足时钳到最后一行', () => {
        expect(petMoodRow('idle', 6)).toBe(0);
        expect(petMoodRow('error', 6)).toBe(5);
        expect(petMoodRow('error', 2)).toBe(1);
    });

    it('动起来的帧间隔：写作/开心更快，睡觉更慢', () => {
        expect(petAnimationIntervalMs('writing')).toBeLessThan(petAnimationIntervalMs('idle'));
        expect(petAnimationIntervalMs('happy')).toBeLessThan(petAnimationIntervalMs('idle'));
        expect(petAnimationIntervalMs('sleep')).toBeGreaterThan(petAnimationIntervalMs('idle'));
    });
});

describe('detectPetGrid 自动识别网格', () => {
    it('3×2 雪碧图（1536×1024）识别为 3 列 2 行', () => {
        expect(detectPetGrid(1536, 1024)).toEqual({ cols: 3, rows: 2 });
    });

    it('正方形大图（768×768）按 2×2 处理', () => {
        expect(detectPetGrid(768, 768)).toEqual({ cols: 2, rows: 2 });
    });

    it('小图不足切分时回落 1×1', () => {
        expect(detectPetGrid(48, 48)).toEqual({ cols: 1, rows: 1 });
    });

    it('4:3 图识别出的单帧接近正方形', () => {
        const grid = detectPetGrid(800, 600);
        expect(800 / grid.cols).toBe(600 / grid.rows);
    });

    it('非法尺寸安全回落', () => {
        expect(detectPetGrid(0, 0)).toEqual({ cols: 1, rows: 1 });
        expect(detectPetGrid(Number.NaN, 100)).toEqual({ cols: 1, rows: 1 });
    });
});

describe('describePetImageConfig 提示文本', () => {
    it('包含帧数/状态数与状态顺序', () => {
        const text = describePetImageConfig({ source: 'vault' as const, path: 'a.png', cols: 3, rows: 2 });
        expect(text).toContain('3 帧');
        expect(text).toContain('2 状态');
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
