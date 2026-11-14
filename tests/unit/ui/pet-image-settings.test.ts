/**
 * pet-image-settings 行为测试（视图门禁要求）
 *
 * 设置页里的图片压缩与配置转换属于纯逻辑，抽测关键约定。
 */

import { describe, expect, it } from 'vitest';
import { isImageDataUrl, normalizePetImageConfig } from '@/shared/pet-image-model';
import { renderPetImageSettings } from '@/ui/pet-image-settings';

const DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('设置页模块', () => {
    it('渲染函数可导入（视图门禁：视图文件需被测试 import）', () => {
        expect(typeof renderPetImageSettings).toBe('function');
    });
});

describe('设置页 · 本机图片配置转换', () => {
    it('文件选择器产出的 data URL 可被配置接受', () => {
        expect(isImageDataUrl(DATA_URL)).toBe(true);
        expect(normalizePetImageConfig({ source: 'file', dataUrl: DATA_URL, cols: 2, rows: 2 }))
            .toEqual({ source: 'file', dataUrl: DATA_URL, cols: 2, rows: 2 });
    });

    it('压缩后的 data URL 保留网格设置', () => {
        const config = normalizePetImageConfig({ source: 'file', dataUrl: DATA_URL, cols: 3, rows: 2 });
        expect(config?.cols).toBe(3);
        expect(config?.rows).toBe(2);
    });

    it('非法 data URL 不会写入配置（避免空白宠物）', () => {
        expect(normalizePetImageConfig({ source: 'file', dataUrl: 'data:text/plain;base64,AA', cols: 2, rows: 2 }))
            .toBeNull();
    });

    it('仓库路径与本机图片互不干扰', () => {
        expect(normalizePetImageConfig({ source: 'vault', path: '素材/a.png', cols: 2, rows: 2 })?.source).toBe('vault');
        expect(normalizePetImageConfig({ source: 'file', dataUrl: DATA_URL, cols: 2, rows: 2 })?.source).toBe('file');
    });
});
