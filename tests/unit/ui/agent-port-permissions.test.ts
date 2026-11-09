import { describe, expect, it, vi } from 'vitest';

vi.mock('@/main', () => ({ default: class NovelWriterPlugin {} }));
import { TFolder } from '../../__mocks__/obsidian';
import { createAgentPort } from '../../../ui/services/agent-port';
import { spillFolderFor } from '../../../ui/services/agent-spill-store';

/**
 * Agent 文件端口权限收口（安全审计 SEC-8/9/10）。
 * 只测端口边界，不拉起 main.js。
 */

function makePort(options: {
    indexed?: unknown;
    adapterExists?: boolean;
} = {}) {
    const remove = vi.fn(async () => undefined);
    const rename = vi.fn(async () => undefined);
    const app = {
        vault: {
            adapter: {
                exists: vi.fn(async () => options.adapterExists === true),
                remove,
                rename,
                mkdir: vi.fn(async () => undefined),
            },
            getAbstractFileByPath: vi.fn(() => options.indexed ?? null),
            getFiles: vi.fn(() => []),
            getAllFolders: vi.fn(() => []),
            getMarkdownFiles: vi.fn(() => []),
            getRoot: vi.fn(() => ({ children: [] })),
        },
        fileManager: { renameFile: vi.fn(async () => undefined) },
    };
    const plugin = {
        getActiveProject: () => '长篇小说/书A',
    };
    return { port: createAgentPort(app as never, plugin as never), remove, rename };
}

describe('Agent 文件端口权限', () => {
    it('非索引文件默认不永久删除；permanent=true 才走 adapter.remove', async () => {
        const { port, remove } = makePort({ adapterExists: true });

        await expect(port.deleteFile?.('导出文件/旧稿.txt')).rejects.toThrow('无法移入回收站');
        expect(remove).not.toHaveBeenCalled();

        await expect(port.deleteFile?.('导出文件/旧稿.txt', { permanent: true })).resolves.toMatchObject({
            deleted: true,
            trashed: false,
        });
        expect(remove).toHaveBeenCalledWith('导出文件/旧稿.txt');
    });

    it('move_file 拒绝目录，避免整体搬走章节目录/项目目录', async () => {
        const folder = new TFolder();
        folder.path = '长篇小说/书A';
        const { port, rename } = makePort({ indexed: folder });

        await expect(port.moveFile?.('长篇小说/书A', '长篇小说/书B')).rejects.toThrow('只支持文件');
        expect(rename).not.toHaveBeenCalled();
    });

    it('delete_project 拒绝更深层目录，只允许「库/项目」两段', async () => {
        const { port } = makePort();

        const deep = await port.deleteProject?.('长篇小说/书A/03-大纲与章节');
        expect(deep?.deleted).toBe(false);
        expect(deep?.reason).toContain('不是可识别的项目目录');
    });

    it('.sessions 只允许当前项目 spill；会话存档 JSONL 不可读', async () => {
        const { port } = makePort({ adapterExists: false });
        const allowed = `${spillFolderFor('长篇小说/书A')}/spill-1.md`;

        await expect(port.readFile?.(allowed)).resolves.toBeNull();
        await expect(port.readFile?.('.sessions/agent/书A.jsonl')).rejects.toThrow();
        await expect(port.readFile?.('.sessions/spill/agent/别的项目/x.md')).rejects.toThrow();
    });
});
