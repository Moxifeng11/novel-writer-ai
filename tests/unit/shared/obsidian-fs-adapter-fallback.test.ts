import { describe, it, expect, vi } from 'vitest';
import { TFile, TFolder } from 'obsidian';
import { ObsidianFileSystem, ObsidianVaultMeta, writeVaultText } from '../../../shared/file-system-port';

/**
 * 插件数据目录（.obsidian/plugins/<id>/data）不在 vault 索引里：
 * app.vault.getAbstractFileByPath() 恒为 null。
 * ObsidianFileSystem 必须在索引命中失败时回退到 vault.adapter，
 * 否则知识库 / 指纹库 / 版本目录的读写会全部静默失效。
 */
const CONFIG_DIR = '.obsidian';
const DATA_DIR = '.obsidian/plugins/novel-writer-ai/data/knowledge-vectors';

interface Harness {
    fs: ObsidianFileSystem;
    vault: any;
    adapter: any;
    disk: Map<string, string>;
    dirs: Set<string>;
    indexed: Map<string, any>;
}

function makeHarness(): Harness {
    const disk = new Map<string, string>();
    const dirs = new Set<string>();
    const indexed = new Map<string, any>();

    const adapter = {
        exists: vi.fn(async (p: string) => disk.has(p) || dirs.has(p)),
        read: vi.fn(async (p: string) => {
            if (!disk.has(p)) throw new Error(`not found: ${p}`);
            return disk.get(p) as string;
        }),
        write: vi.fn(async (p: string, c: string) => {
            disk.set(p, c);
        }),
        list: vi.fn(async (p: string) => {
            const prefix = p.endsWith('/') ? p : `${p}/`;
            const files = [...disk.keys()].filter(k => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'));
            const folders = [...dirs].filter(d => d.startsWith(prefix) && !d.slice(prefix.length).includes('/'));
            return { files, folders };
        }),
        stat: vi.fn(async (p: string) => {
            if (disk.has(p)) {
                const content = disk.get(p) as string;
                return { type: 'file', mtime: 123, ctime: 100, size: content.length };
            }
            if (dirs.has(p)) return { type: 'folder', mtime: 0, ctime: 0, size: 0 };
            return null;
        }),
        mkdir: vi.fn(async (p: string) => {
            dirs.add(p);
        }),
        remove: vi.fn(async (p: string) => {
            disk.delete(p);
        }),
        rmdir: vi.fn(async (p: string) => {
            dirs.delete(p);
        }),
    };

    const vault = {
        configDir: CONFIG_DIR,
        adapter,
        getAbstractFileByPath: vi.fn((p: string) => indexed.get(p) ?? null),
        getFiles: vi.fn(() => [...indexed.values()].filter(v => v instanceof TFile)),
        getAllFolders: vi.fn(() => []),
        read: vi.fn(async (f: any) => disk.get(f.path) ?? ''),
        modify: vi.fn(async (f: any, c: string) => {
            disk.set(f.path, c);
        }),
        create: vi.fn(async (p: string, c: string) => {
            const f = Object.assign(new TFile(), { path: p, name: p.split('/').pop() });
            indexed.set(p, f);
            disk.set(p, c);
            return f;
        }),
        createFolder: vi.fn(async (p: string) => {
            const f = { path: p, name: p.split('/').pop() };
            indexed.set(p, f);
            return f;
        }),
        delete: vi.fn(async (f: any) => {
            indexed.delete(f.path);
            disk.delete(f.path);
        }),
    };

    const app = { vault } as any;
    return { fs: new ObsidianFileSystem(app), vault, adapter, disk, dirs, indexed };
}

describe('ObsidianFileSystem · 插件数据目录（索引外路径）', () => {
    it('exists：vault 索引未命中时回退 adapter.exists', async () => {
        const h = makeHarness();
        h.disk.set(`${DATA_DIR}/index.json`, '{"books":[]}');

        expect(h.vault.getAbstractFileByPath(`${DATA_DIR}/index.json`)).toBeNull();
        expect(await h.fs.exists(`${DATA_DIR}/index.json`)).toBe(true);
        expect(await h.fs.exists(`${DATA_DIR}/missing.json`)).toBe(false);
    });

    it('read：vault 索引未命中时回退 adapter.read', async () => {
        const h = makeHarness();
        h.disk.set(`${DATA_DIR}/book.json`, '{"bookId":"kb_1"}');

        await expect(h.fs.read(`${DATA_DIR}/book.json`)).resolves.toBe('{"bookId":"kb_1"}');
        await expect(h.fs.read(`${DATA_DIR}/missing.json`)).rejects.toThrow();
    });

    it('write：配置目录内写文件走 adapter，不调用 vault.create', async () => {
        const h = makeHarness();

        await h.fs.write(`${DATA_DIR}/new.json`, '{}');

        expect(h.adapter.write).toHaveBeenCalledWith(`${DATA_DIR}/new.json`, '{}');
        expect(h.vault.create).not.toHaveBeenCalled();
        expect(await h.fs.exists(`${DATA_DIR}/new.json`)).toBe(true);
    });

    it('write：vault 内新文件仍走 vault.create（保留索引与事件语义）', async () => {
        const h = makeHarness();

        await h.fs.write('正文/第1章.md', 'hello');

        expect(h.vault.create).toHaveBeenCalledWith('正文/第1章.md', 'hello');
        expect(h.adapter.write).not.toHaveBeenCalled();
    });

    it('listFiles：索引外目录递归列出文件并带 stat/name', async () => {
        const h = makeHarness();
        h.disk.set(`${DATA_DIR}/a.json`, 'aaa');
        h.dirs.add(`${DATA_DIR}/nested`);
        h.disk.set(`${DATA_DIR}/nested/b.json`, 'bb');

        const files = await h.fs.listFiles(DATA_DIR);
        const byName = new Map(files.map(f => [f.name, f]));

        expect(files).toHaveLength(2);
        expect(byName.get('a.json')?.path).toBe(`${DATA_DIR}/a.json`);
        expect(byName.get('a.json')?.stat.size).toBe(3);
        expect(byName.get('b.json')?.path).toBe(`${DATA_DIR}/nested/b.json`);
    });

    it('mkdir：配置目录下用 adapter.mkdir 建目录', async () => {
        const h = makeHarness();

        await h.fs.mkdir(DATA_DIR);

        expect(h.adapter.mkdir).toHaveBeenCalledWith(CONFIG_DIR);
        expect(h.adapter.mkdir).toHaveBeenCalledWith(DATA_DIR);
        expect(h.vault.createFolder).not.toHaveBeenCalled();
    });

    it('delete：索引外文件走 adapter.remove', async () => {
        const h = makeHarness();
        h.disk.set(`${DATA_DIR}/old.json`, '{}');

        await h.fs.delete(`${DATA_DIR}/old.json`);

        expect(h.adapter.remove).toHaveBeenCalledWith(`${DATA_DIR}/old.json`);
        expect(await h.adapter.exists(`${DATA_DIR}/old.json`)).toBe(false);
    });
});

describe('ObsidianFileSystem · 索引外/索引内分支加固', () => {
    it('getFileStamp：索引内文件缺 stat 时回落 0', async () => {
        const h = makeHarness();
        h.indexed.set('indexed.md', Object.assign(new TFile(), { path: 'indexed.md', stat: undefined }));

        expect(await h.fs.getFileStamp('indexed.md')).toEqual({ mtime: 0, size: 0 });
    });

    it('getFileStamp：索引外走 adapter.stat，缺字段回落 0，stat 为空返回 null', async () => {
        const h = makeHarness();
        h.adapter.stat.mockImplementationOnce(async () => ({ type: 'file' }));

        expect(await h.fs.getFileStamp('ext.md')).toEqual({ mtime: 0, size: 0 });
        expect(await h.fs.getFileStamp('missing.md')).toBeNull();
    });

    it('getFileStamp：adapter.stat 抛错时返回 null', async () => {
        const h = makeHarness();
        h.adapter.stat.mockRejectedValueOnce(new Error('stat failed'));

        expect(await h.fs.getFileStamp('broken.md')).toBeNull();
    });

    it('delete：索引内文件夹递归删除，索引外文件夹走 rmdir', async () => {
        const h = makeHarness();
        const folder = Object.assign(new TFolder(), { path: '正文' });
        h.indexed.set('正文', folder);

        await h.fs.delete('正文');
        expect(h.vault.delete).toHaveBeenCalledWith(folder, true);

        h.dirs.add(`${DATA_DIR}/old`);
        await h.fs.delete(`${DATA_DIR}/old`);
        expect(h.adapter.rmdir).toHaveBeenCalledWith(`${DATA_DIR}/old`, true);
    });

    it('delete：索引外路径不存在时静默返回，不调用 remove/rmdir', async () => {
        const h = makeHarness();

        await h.fs.delete(`${DATA_DIR}/ghost.json`);

        expect(h.adapter.remove).not.toHaveBeenCalled();
        expect(h.adapter.rmdir).not.toHaveBeenCalled();
    });

    it('write：目标是文件夹时抛错，不落到 create', async () => {
        const h = makeHarness();
        h.indexed.set('dir', Object.assign(new TFolder(), { path: 'dir' }));

        await expect(h.fs.write('dir', 'x')).rejects.toThrow(/folder/);
        expect(h.vault.create).not.toHaveBeenCalled();
    });

    it('mkdir：createFolder 报“已存在”时跳过，其他错误原样抛出', async () => {
        const h = makeHarness();
        h.vault.createFolder.mockRejectedValueOnce(new Error('Folder already exists'));

        await expect(h.fs.mkdir('a/b')).resolves.toBeUndefined();
        expect(h.vault.createFolder).toHaveBeenCalledTimes(2);

        h.vault.createFolder.mockRejectedValueOnce(new Error('EACCES'));
        await expect(h.fs.mkdir('c/d')).rejects.toThrow('EACCES');
    });

    it('mkdir：配置目录已存在时不再调用 adapter.mkdir', async () => {
        const h = makeHarness();
        h.dirs.add(CONFIG_DIR);

        await h.fs.mkdir(DATA_DIR);

        expect(h.adapter.mkdir).toHaveBeenCalledTimes(4);
        expect(h.adapter.mkdir).toHaveBeenCalledWith(DATA_DIR);
        expect(h.adapter.mkdir).not.toHaveBeenCalledWith(CONFIG_DIR);
    });

    it('listFolders：索引外目录走 adapter 递归，adapter.list 失败返回空数组', async () => {
        const h = makeHarness();
        h.dirs.add('ext');
        h.dirs.add('ext/sub');

        expect((await h.fs.listFolders('ext')).map(f => f.path)).toEqual(['ext/sub']);

        h.adapter.list.mockRejectedValueOnce(new Error('list failed'));
        expect(await h.fs.listFolders('ext2')).toEqual([]);
    });

    it('listFiles：索引外文件无扩展名、stat 缺失时仍构造出可用形状', async () => {
        const h = makeHarness();
        h.adapter.list.mockImplementationOnce(async () => ({ files: ['cfg/README'], folders: [] }));

        const files = await h.fs.listFiles('cfg');

        expect(files).toHaveLength(1);
        expect(files[0].name).toBe('README');
        expect(files[0].basename).toBe('README');
        expect(files[0].extension).toBe('');
        expect(files[0].stat).toEqual({ ctime: 0, mtime: 0, size: 0 });
    });

    it('ObsidianVaultMeta.getFolders 忽略非文件夹子项', () => {
        const child = Object.assign(new TFolder(), { path: 'a', children: [] });
        const root = Object.assign(new TFolder(), { path: '', children: [child, new TFile()] });
        const meta = new ObsidianVaultMeta({ vault: { getRoot: () => root } } as never);

        expect(meta.getFolders().map(f => f.path)).toEqual(['a']);
    });

    it('writeVaultText：无 adapter 抛错；最小 adapter 回退写；完整 App 走索引', async () => {
        await expect(writeVaultText({} as never, 'a.md', 'x')).rejects.toThrow(/adapter/);

        const disk = new Map<string, string>();
        const mkdir = vi.fn(async () => undefined);
        const adapter = {
            mkdir,
            write: vi.fn(async (p: string, c: string) => {
                disk.set(p, c);
            }),
        };
        const minimal = { vault: { adapter } } as never;

        await writeVaultText(minimal, 'a.md', 'hi');
        expect(mkdir).not.toHaveBeenCalled();
        expect(adapter.write).toHaveBeenCalledWith('a.md', 'hi');

        await writeVaultText(minimal, 'dir/b.md', 'hi');
        expect(mkdir).toHaveBeenCalledWith('dir');

        const h = makeHarness();
        await writeVaultText({ vault: h.vault } as never, '正文/第1章.md', 'hi');
        expect(h.vault.createFolder).toHaveBeenCalledWith('正文');
        expect(h.vault.create).toHaveBeenCalledWith('正文/第1章.md', 'hi');
        expect(h.adapter.write).not.toHaveBeenCalled();
    });
});
