import { describe, expect, it, vi } from 'vitest';
import { StyleFingerprintLibrary } from '../../../../engine/style-fingerprint-library';
import { globalFingerprintsFile } from '../../../../shared/paths';

/**
 * 指纹文件加载签名缓存：同一 mtime/size 下重复 load 不重读，
 * 外部修改（stamp 变化）或 save 后必须重读。
 */
function makeLibrary(stampEnabled = true) {
    let stamp = { mtime: 1, size: 10 };
    const read = vi.fn(async () => '[]');
    const write = vi.fn(async () => undefined);
    const mkdir = vi.fn(async () => undefined);
    const fs = {
        read,
        write,
        mkdir,
        exists: vi.fn(async () => true),
        getFileStamp: stampEnabled ? vi.fn(async () => stamp) : undefined,
        rename: vi.fn(async () => undefined),
    };
    const library = new StyleFingerprintLibrary({ vault: {} } as never);
    (library as unknown as { fs: unknown }).fs = fs;
    return {
        library,
        read,
        write,
        setStamp: (next: { mtime: number; size: number }) => { stamp = next; },
    };
}

describe('StyleFingerprintLibrary — 加载签名缓存', () => {
    it('同 stamp 连续 load 不再新增读取', async () => {
        const { library, read } = makeLibrary();
        await library.loadGlobal();
        const first = read.mock.calls.length;
        await library.loadGlobal();
        expect(read.mock.calls.length).toBe(first);
    });

    it('文件 stamp 变化会重读', async () => {
        const { library, read, setStamp } = makeLibrary();
        await library.loadGlobal();
        const first = read.mock.calls.length;
        setStamp({ mtime: 2, size: 10 });
        await library.loadGlobal();
        expect(read.mock.calls.length).toBeGreaterThan(first);
    });

    it('save 后缓存失效，下一次 load 重读', async () => {
        const { library, read, write } = makeLibrary();
        await library.loadGlobal();
        const first = read.mock.calls.length;
        await (library as unknown as { saveGlobal: () => Promise<void> }).saveGlobal();
        expect(write).toHaveBeenCalledWith(globalFingerprintsFile(), expect.any(String));
        await library.loadGlobal();
        expect(read.mock.calls.length).toBeGreaterThan(first);
    });

    it('端口不支持 getFileStamp 时退回每次读取', async () => {
        const { library, read } = makeLibrary(false);
        await library.loadGlobal();
        const first = read.mock.calls.length;
        await library.loadGlobal();
        expect(read.mock.calls.length).toBeGreaterThan(first);
    });
});
