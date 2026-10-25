import { describe, it, expect, vi, afterEach } from 'vitest';
import { TFile } from 'obsidian';
import { exportTextFile, EXPORT_FALLBACK_DIR } from '../../../shared/export-file';

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
                isMobile: false,
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
            isMobile: false,
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

        const app = {
            isMobile: true,
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
        const app = {
            isMobile: true,
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
});
