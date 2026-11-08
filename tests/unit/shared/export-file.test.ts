import { describe, it, expect, vi, afterEach } from 'vitest';
import { Platform, TFile } from 'obsidian';
import { exportBinaryFile, exportTextFile, EXPORT_FALLBACK_DIR } from '../../../shared/export-file';

// v4.79.0：导出判断改用官方 Platform.isMobile；这里切换 mock 的平台位（模块级，供所有 describe 使用）
function setMobile(on: boolean): void {
    Object.defineProperty(Platform, 'isMobile', { value: on, configurable: true, writable: true });
}

afterEach(() => {
    setMobile(false);
    vi.restoreAllMocks();
});

describe('exportTextFile — v6.3 跨端导出', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('桌面端（isMobile=false）走 blob 下载，不写 vault', async () => {
        vi.useFakeTimers();
        const created: string[] = [];
        const createObjectURL = vi.fn(() => 'blob:mock');
        const revokeObjectURL = vi.fn();
        const anchor = { href: '', download: '', click: vi.fn(), style: {}, remove: vi.fn() };
        const appendChild = vi.fn();
        const origBlob = (globalThis as any).Blob;
        const origURL = (globalThis as any).URL;
        const origDoc = (globalThis as any).document;
        (globalThis as any).Blob = class {
            constructor(public parts: unknown[], public opts: unknown) {}
        };
        (globalThis as any).URL = { createObjectURL, revokeObjectURL };
        // 仓库测试环境为 node（无 jsdom），按既有约定手工注入最小 document 垫片
        (globalThis as any).document = {
            createElement: () => anchor,
            body: { appendChild },
        };

        try {
            const app = {
                vault: {
                    adapter: { exists: async () => false, mkdir: async () => undefined },
                    getAbstractFileByPath: () => null,
                    create: async (p: string) => { created.push(p); },
                    modify: async () => undefined,
                },
            } as never;

            const result = await exportTextFile(app, 'log.json', '{"a":1}', { mime: 'application/json' });

            expect(result.mode).toBe('download');
            expect(createObjectURL).toHaveBeenCalledTimes(1);
            expect(revokeObjectURL).not.toHaveBeenCalled();
            expect(created).toHaveLength(0);
            // 下载锚点被正确触发且文件名已被净化
            expect(anchor.href).toBe('blob:mock');
            expect(anchor.download).toBe('log.json');
            expect(anchor.click).toHaveBeenCalledTimes(1);
            expect(appendChild).toHaveBeenCalledWith(anchor);

            // Electron 下载为异步启动：60s 后才释放 blob URL
            vi.advanceTimersByTime(60_000);
            expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock');
        } finally {
            vi.useRealTimers();
            (globalThis as any).Blob = origBlob;
            (globalThis as any).URL = origURL;
            (globalThis as any).document = origDoc;
        }
    });

    it('桌面端 preferVault=true 时强制写入 vault，避免 Electron 下载不可靠', async () => {
        const created: Array<{ path: string; content: string }> = [];
        let mkdirCalled = false;
        const app = {
            vault: {
                adapter: {
                    exists: async () => false,
                    mkdir: async () => { mkdirCalled = true; },
                },
                getAbstractFileByPath: () => null,
                create: async (path: string, content: string) => { created.push({ path, content }); },
                modify: async () => undefined,
            },
        } as never;

        const result = await exportTextFile(app, 'diag.json', '{"ok":1}', { preferVault: true });

        expect(result.mode).toBe('vault');
        expect(result.path).toBe(`${EXPORT_FALLBACK_DIR}/diag.json`);
        expect(mkdirCalled).toBe(true);
        expect(created).toEqual([{ path: `${EXPORT_FALLBACK_DIR}/diag.json`, content: '{"ok":1}' }]);
    });

    it('移动端（isMobile=true）写入 vault 的「导出文件」目录并净化文件名', async () => {
        const created: Array<{ path: string; content: string }> = [];
        let mkdirCalled = false;

        setMobile(true);
        const app = {
            vault: {
                adapter: {
                    exists: async () => false,
                    mkdir: async () => { mkdirCalled = true; },
                },
                getAbstractFileByPath: () => null,
                create: async (path: string, content: string) => { created.push({ path, content }); },
                modify: async () => undefined,
            },
        } as never;

        const result = await exportTextFile(app, 'a/b:c.json', '{"x":1}', { mime: 'application/json' });

        expect(result.mode).toBe('vault');
        expect(mkdirCalled).toBe(true);
        expect(created).toHaveLength(1);
        // 非法字符 / 与 : 被净化为 _
        expect(created[0].path).toBe(`${EXPORT_FALLBACK_DIR}/a_b_c.json`);
        expect(created[0].content).toBe('{"x":1}');
    });

    it('移动端已存在同名文件时改为覆盖（modify）', async () => {
        const modified: string[] = [];
        let createCalled = false;
        const existingFile = Object.assign(new TFile(), { path: '导出文件/same.json' });
        setMobile(true);
        const app = {
            vault: {
                adapter: { exists: async () => true, mkdir: async () => undefined },
                getAbstractFileByPath: () => existingFile,
                create: async () => { createCalled = true; },
                modify: async (_f: unknown, c: string) => { modified.push(c); },
            },
        } as never;

        const result = await exportTextFile(app, 'same.json', 'body');

        expect(result.ok).toBe(true);
        expect(result.mode).toBe('vault');
        expect(modified).toEqual(['body']);
        expect(createCalled).toBe(false);
    });

    it('二进制导出（EPUB/DOCX）：移动端走 createBinary，文件名净化', async () => {
        const created: Array<{ path: string; buffer: ArrayBuffer }> = [];
        setMobile(true);
        const app = {
            vault: {
                adapter: { exists: async () => false, mkdir: async () => undefined },
                getAbstractFileByPath: () => null,
                createBinary: async (path: string, buffer: ArrayBuffer) => { created.push({ path, buffer }); },
                modifyBinary: async () => undefined,
            },
        } as never;

        const data = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
        const result = await exportBinaryFile(app, '书:稿.epub', data, { mime: 'application/epub+zip' });

        expect(result.ok).toBe(true);
        expect(result.mode).toBe('vault');
        expect(created).toHaveLength(1);
        expect(created[0].path).toBe(`${EXPORT_FALLBACK_DIR}/书_稿.epub`);
        expect(new Uint8Array(created[0].buffer)).toEqual(data);
    });

    it('二进制导出：同名文件存在时覆盖（modifyBinary）', async () => {
        const modified: ArrayBuffer[] = [];
        const existingFile = Object.assign(new TFile(), { path: '导出文件/旧.epub' });
        setMobile(true);
        const app = {
            vault: {
                adapter: { exists: async () => true, mkdir: async () => undefined },
                getAbstractFileByPath: () => existingFile,
                createBinary: async () => { throw new Error('不应新建'); },
                modifyBinary: async (_f: unknown, buffer: ArrayBuffer) => { modified.push(buffer); },
            },
        } as never;

        const result = await exportBinaryFile(app, '旧.epub', new Uint8Array([1, 2, 3]));

        expect(result.ok).toBe(true);
        expect(modified).toHaveLength(1);
        expect(new Uint8Array(modified[0])).toEqual(new Uint8Array([1, 2, 3]));
    });
});
