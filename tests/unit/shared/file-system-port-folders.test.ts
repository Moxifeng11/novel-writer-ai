/**
 * ObsidianFileSystem 文件夹遍历的兼容性回归。
 *
 * 背景：Vault.getAllFolders() 晚于 Obsidian 1.5 才加入，而 manifest 声明
 * minAppVersion=1.5.0。旧实现直接调用它会让 1.5.x 用户运行时报 TypeError。
 * 这里锁住「只依赖 children 递归」的实现，防止后续又引回新 API。
 */
import { describe, expect, it, vi } from 'vitest';
import { TFolder } from 'obsidian';
import { ObsidianFileSystem, ObsidianVaultMeta } from '../../../shared/file-system-port';

function folder(path: string, children: TFolder[] = []): TFolder {
    return Object.assign(new TFolder(), { path, name: path.split('/').pop() || '', children });
}

describe('ObsidianFileSystem 文件夹遍历', () => {
    const root = folder('');
    const a = folder('a');
    const ab = folder('a/b');
    a.children.push(ab);
    root.children.push(a);

    const vault = {
        getRoot: () => root,
        getAbstractFileByPath: (path: string) => {
            if (path === '') return root;
            if (path === 'a') return a;
            if (path === 'a/b') return ab;
            return null;
        },
        getAllFolders: vi.fn(() => {
            throw new Error('不应调用 Vault.getAllFolders（晚于 minAppVersion 1.5）');
        }),
    };
    const fs = new ObsidianFileSystem({ vault } as never);
    const meta = new ObsidianVaultMeta({ vault } as never);

    it('getFolders 递归返回全部子目录，且不调用 getAllFolders', () => {
        expect(meta.getFolders().map((f) => f.path)).toEqual(['a', 'a/b']);
        expect(vault.getAllFolders).not.toHaveBeenCalled();
    });

    it('listFolders 从指定目录向下递归', async () => {
        expect((await fs.listFolders('a')).map((f) => f.path)).toEqual(['a/b']);
        expect(vault.getAllFolders).not.toHaveBeenCalled();
    });
});
