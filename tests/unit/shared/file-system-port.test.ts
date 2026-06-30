import { describe, it, expect, beforeEach } from 'vitest';
import { MockFileSystem } from '../../../shared/file-system-port';

describe('MockFileSystem', () => {
    let fs: MockFileSystem;

    beforeEach(() => {
        fs = new MockFileSystem();
    });

    describe('write / read', () => {
        it('写入文件后可以读取', async () => {
            await fs.write('test/file.md', 'hello');
            expect(await fs.read('test/file.md')).toBe('hello');
        });

        it('覆盖写入', async () => {
            await fs.write('a.md', 'v1');
            await fs.write('a.md', 'v2');
            expect(await fs.read('a.md')).toBe('v2');
        });

        it('读取不存在的文件抛出错误', async () => {
            await expect(fs.read('not-exist.md')).rejects.toThrow();
        });
    });

    describe('exists', () => {
        it('文件存在返回 true', async () => {
            await fs.write('x.md', '');
            expect(await fs.exists('x.md')).toBe(true);
        });

        it('文件不存在返回 false', async () => {
            expect(await fs.exists('x.md')).toBe(false);
        });
    });

    describe('mkdir', () => {
        it('创建目录', async () => {
            await fs.mkdir('a/b/c');
            expect(await fs.exists('a/b/c')).toBe(true);
        });

        it('重复创建不报错', async () => {
            await fs.mkdir('x');
            await expect(fs.mkdir('x')).resolves.not.toThrow();
        });
    });

    describe('delete', () => {
        it('删除文件', async () => {
            await fs.write('d.md', 'x');
            expect(await fs.exists('d.md')).toBe(true);
            await fs.delete('d.md');
            expect(await fs.exists('d.md')).toBe(false);
        });

        it('删除不存在的文件不报错', async () => {
            await expect(fs.delete('not-exist.md')).resolves.not.toThrow();
        });
    });

    describe('rename', () => {
        it('重命名文件', async () => {
            await fs.write('old.md', 'content');
            await fs.rename('old.md', 'new.md');
            expect(await fs.exists('old.md')).toBe(false);
            expect(await fs.read('new.md')).toBe('content');
        });

        it('重命名目录', async () => {
            await fs.mkdir('oldDir');
            await fs.write('oldDir/f.md', 'x');
            await fs.rename('oldDir', 'newDir');
            expect(await fs.exists('oldDir')).toBe(false);
            expect(await fs.exists('newDir')).toBe(true);
        });
    });

    describe('listFiles', () => {
        it('列出目录下的文件', async () => {
            await fs.mkdir('dir');
            await fs.write('dir/a.md', '');
            await fs.write('dir/b.md', '');
            await fs.write('dir/sub/c.md', '');
            const files = await fs.listFiles('dir');
            expect(files.length).toBeGreaterThanOrEqual(2);
        });

        it('空目录返回空数组', async () => {
            await fs.mkdir('empty');
            const files = await fs.listFiles('empty');
            expect(files).toEqual([]);
        });
    });
});
