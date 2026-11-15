/**
 * 桌宠本机图片持久化：独立文件（pet-image.png + pet-image.json）
 *
 * 背景：以前图片 base64 存在 data.json 里，任何 settings 重置/迁移丢字段都会让
 * 用户「重载后要重选图片」。现在图片本体落插件目录，settings 只存元数据。
 */

import { describe, expect, it } from 'vitest';
import {
    bytesToPngDataUrl,
    clearPetImageFromDisk,
    dataUrlToBytes,
    loadPetImageFromDisk,
    parsePetImageMeta,
    savePetImageToDisk,
} from '@/shared/pet-image-store';
import { normalizePetImageConfig } from '@/shared/pet-image-model';
import type { App } from 'obsidian';

/** 1x1 PNG */
const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

interface MockAdapter {
    store: Map<string, string>;
    binaries: Map<string, ArrayBuffer>;
    exists(path: string): Promise<boolean>;
    read(path: string): Promise<string>;
    write(path: string, data: string): Promise<void>;
    writeBinary(path: string, data: ArrayBuffer): Promise<void>;
    readBinary(path: string): Promise<ArrayBuffer>;
    remove(path: string): Promise<void>;
}

const makeApp = (withBinary = true): { app: App; adapter: MockAdapter } => {
    const store = new Map<string, string>();
    const binaries = new Map<string, ArrayBuffer>();
    const adapter: MockAdapter = {
        store,
        binaries,
        exists: async (path: string) => store.has(path) || binaries.has(path),
        read: async (path: string) => store.get(path) ?? '',
        write: async (path: string, data: string) => { store.set(path, data); },
        writeBinary: async (path: string, data: ArrayBuffer) => { binaries.set(path, data); },
        readBinary: async (path: string) => binaries.get(path) ?? new ArrayBuffer(0),
        remove: async (path: string) => { store.delete(path); binaries.delete(path); },
    };
    if (!withBinary) {
        delete (adapter as Partial<MockAdapter>).writeBinary;
        delete (adapter as Partial<MockAdapter>).readBinary;
    }
    return { app: { vault: { adapter } } as unknown as App, adapter };
};

describe('dataUrlToBytes / bytesToPngDataUrl', () => {
    it('合法 PNG data URL 可往返', () => {
        const bytes = dataUrlToBytes(PNG_DATA_URL);
        expect(bytes).not.toBeNull();
        expect(bytesToPngDataUrl(bytes as Uint8Array)).toBe(PNG_DATA_URL);
    });

    it('非图片/坏 base64 返回 null', () => {
        expect(dataUrlToBytes('https://example.com/a.png')).toBeNull();
        expect(dataUrlToBytes('data:image/png;base64,@@@')).toBeNull();
    });
});

describe('parsePetImageMeta', () => {
    it('正常解析并夹取 cols/rows', () => {
        expect(parsePetImageMeta(JSON.stringify({ version: 1, source: 'file', cols: 3, rows: 2 })))
            .toEqual({ version: 1, source: 'file', path: undefined, cols: 3, rows: 2 });
        const clamped = parsePetImageMeta(JSON.stringify({ source: 'file', cols: 99, rows: 0 }));
        expect(clamped?.cols).toBe(8);
        expect(clamped?.rows).toBe(1);
    });

    it('损坏/非法来源返回 null', () => {
        expect(parsePetImageMeta('{oops')).toBeNull();
        expect(parsePetImageMeta(JSON.stringify({ source: 'nope', cols: 2, rows: 2 }))).toBeNull();
        expect(parsePetImageMeta(JSON.stringify({ source: 'file' }))).toBeNull();
    });
});

describe('savePetImageToDisk / loadPetImageFromDisk', () => {
    it('二进制 adapter：保存后可读回同一张图与网格', async () => {
        const { app, adapter } = makeApp();
        await expect(savePetImageToDisk(app, PNG_DATA_URL, { cols: 3, rows: 2 })).resolves.toBe(true);
        expect(adapter.binaries.size).toBe(1);
        expect(adapter.store.size).toBe(1);
        const loaded = await loadPetImageFromDisk(app);
        expect(loaded?.source).toBe('file');
        expect(loaded?.cols).toBe(3);
        expect(loaded?.rows).toBe(2);
        expect(loaded?.dataUrl).toBe(PNG_DATA_URL);
    });

    it('只有文本 adapter：退回 base64 文本也能读回', async () => {
        const { app } = makeApp(false);
        await expect(savePetImageToDisk(app, PNG_DATA_URL, { cols: 1, rows: 1 })).resolves.toBe(true);
        const loaded = await loadPetImageFromDisk(app);
        expect(loaded?.dataUrl).toBe(PNG_DATA_URL);
    });

    it('没有元数据/图片时返回 null', async () => {
        const { app } = makeApp();
        expect(await loadPetImageFromDisk(app)).toBeNull();
    });

    it('非法 dataUrl 不写盘', async () => {
        const { app } = makeApp();
        await expect(savePetImageToDisk(app, 'bad', { cols: 1, rows: 1 })).resolves.toBe(false);
    });

    it('clear 后文件与元数据都消失', async () => {
        const { app, adapter } = makeApp();
        await savePetImageToDisk(app, PNG_DATA_URL, { cols: 2, rows: 2 });
        await clearPetImageFromDisk(app);
        expect(adapter.store.size).toBe(0);
        expect(adapter.binaries.size).toBe(0);
        expect(await loadPetImageFromDisk(app)).toBeNull();
    });
});

describe('settings 只存元数据时的规范化', () => {
    it('source=file 且无 dataUrl → 保留网格（运行时再补图片）', () => {
        expect(normalizePetImageConfig({ source: 'file', cols: 2, rows: 2 }))
            .toEqual({ source: 'file', cols: 2, rows: 2 });
    });

    it('有 dataUrl 时照旧校验', () => {
        expect(normalizePetImageConfig({ source: 'file', dataUrl: 'bad', cols: 2, rows: 2 })).toBeNull();
    });
});
