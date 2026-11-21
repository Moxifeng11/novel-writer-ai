import { describe, expect, it, vi } from 'vitest';
import { TFile } from 'obsidian';
import { hardDeleteVaultPath, trashVaultEntry } from '../../../shared/file-removal';

function makeFile(path = '项目/元文件/模板.md'): TFile {
    return Object.assign(Object.create(TFile.prototype), { path, name: '模板.md' }) as TFile;
}

describe('shared/file-removal', () => {
    it('trashVaultEntry 走 FileManager.trashFile（尊重用户删除偏好）', async () => {
        const trashFile = vi.fn(async () => undefined);
        const entry = makeFile();
        await trashVaultEntry({ fileManager: { trashFile } as never }, entry);
        expect(trashFile).toHaveBeenCalledTimes(1);
        expect(trashFile).toHaveBeenCalledWith(entry);
    });

    it('trashVaultEntry 不碰 vault.delete / vault.trash', async () => {
        const del = vi.fn();
        const trash = vi.fn();
        const app = { fileManager: { trashFile: vi.fn(async () => undefined) }, vault: { delete: del, trash } };
        await trashVaultEntry(app as never, makeFile());
        expect(del).not.toHaveBeenCalled();
        expect(trash).not.toHaveBeenCalled();
    });

    it('hardDeleteVaultPath 直接经 adapter 删除，不进回收站', async () => {
        const remove = vi.fn(async () => undefined);
        await hardDeleteVaultPath({ vault: { adapter: { remove } } as never }, '项目/.tx/1.json');
        expect(remove).toHaveBeenCalledWith('项目/.tx/1.json');
    });

    it('hardDeleteVaultPath 的失败会冒泡给调用方决定是否吞掉', async () => {
        const remove = vi.fn(async () => { throw new Error('boom'); });
        await expect(hardDeleteVaultPath({ vault: { adapter: { remove } } as never }, 'x.json')).rejects.toThrow('boom');
    });
});
