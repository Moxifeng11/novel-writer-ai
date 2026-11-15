/**
 * 桌宠图片配置合成：settings 只存元数据时用运行时 dataUrl 补全
 */

import { describe, expect, it } from 'vitest';
import { resolvePetImageConfig } from '@/ui/writing-pet';
import type { WritingPetDeps } from '@/ui/writing-pet';

const DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const deps = (petImage: unknown, runtime: string | null): WritingPetDeps => ({
    plugin: {
        settings: { petImage },
        getPetImageRuntimeDataUrl: () => runtime,
    },
} as unknown as WritingPetDeps);

describe('resolvePetImageConfig', () => {
    it('本机图片只有元数据（重载后 settings 形态）→ 补上运行时图片', () => {
        const config = resolvePetImageConfig(deps({ source: 'file', cols: 2, rows: 2 }, DATA_URL));
        expect(config?.source).toBe('file');
        expect(config?.cols).toBe(2);
        expect(config?.dataUrl).toBe(DATA_URL);
    });

    it('settings 自带 dataUrl（旧数据）时原样使用', () => {
        const config = resolvePetImageConfig(deps({ source: 'file', dataUrl: DATA_URL, cols: 1, rows: 1 }, null));
        expect(config?.dataUrl).toBe(DATA_URL);
    });

    it('运行时有图但 settings 元数据丢失 → 仍返回 null（由启动 hydrate 恢复元数据）', () => {
        expect(resolvePetImageConfig(deps(null, DATA_URL))).toBeNull();
    });

    it('vault 图片不受运行时字段影响', () => {
        const config = resolvePetImageConfig(deps({ source: 'vault', path: '素材/a.png', cols: 3, rows: 2 }, DATA_URL));
        expect(config?.source).toBe('vault');
        expect(config?.path).toBe('素材/a.png');
        expect(config?.dataUrl).toBeUndefined();
    });

    it('无配置返回 null', () => {
        expect(resolvePetImageConfig(deps(null, null))).toBeNull();
    });
});
