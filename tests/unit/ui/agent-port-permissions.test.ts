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
                read: vi.fn(async () => ''),
                write: vi.fn(async () => undefined),
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
        folder.path = '长篇小说/书A/素材';
        const { port, rename } = makePort({ indexed: folder });

        // 同项目内的目录移动：先过项目范围检查，再被「只支持文件」拒绝
        await expect(port.moveFile?.('长篇小说/书A/素材', '长篇小说/书A/素材2')).rejects.toThrow('只支持文件');
        expect(rename).not.toHaveBeenCalled();
    });

    // S3-17（安全 r3）：源与目标必须在同一项目作用域
    it('move_file 拒绝跨项目移动（防项目身份文件被搬走导致项目消失）', async () => {
        const { port, rename } = makePort({ adapterExists: true });

        await expect(port.moveFile?.('长篇小说/书A/作品信息.md', '长篇小说/书B/作品信息.md'))
            .rejects.toThrow('不允许跨项目移动');
        expect(rename).not.toHaveBeenCalled();
    });

    it('move_file 允许同项目内移动', async () => {
        const { port, rename } = makePort({ adapterExists: true });

        await expect(port.moveFile?.('长篇小说/书A/素材/旧.md', '长篇小说/书A/素材/新.md'))
            .resolves.toMatchObject({ from: '长篇小说/书A/素材/旧.md', to: '长篇小说/书A/素材/新.md' });
        expect(rename).toHaveBeenCalledWith('长篇小说/书A/素材/旧.md', '长篇小说/书A/素材/新.md');
    });

    it('delete_project 拒绝更深层目录，只允许「库/项目」两段', async () => {
        const { port } = makePort();

        const deep = await port.deleteProject?.('长篇小说/书A/03-大纲与章节');
        expect(deep?.deleted).toBe(false);
        expect(deep?.reason).toContain('不是可识别的项目目录');
    });

    it('delete_project 的 ghost 分支要求项目身份标志（D3-19 安全 r3）', async () => {
        const { port } = makePort({ adapterExists: false });

        const ghost = await port.deleteProject?.('长篇小说/素材');
        expect(ghost?.deleted).toBe(false);
        expect(ghost?.reason).toContain('身份标志');
    });

    it('新文件只能写入当前项目或本会话 spill（S2-8）', async () => {
        const { port } = makePort({ adapterExists: false });

        await expect(port.writeFile?.('别人的项目/x.md', 'x'))
            .rejects.toThrow('新文件只能写入当前项目目录');
        await expect(port.writeFile?.('长篇小说/书A/设定.md', 'x'))
            .resolves.toMatchObject({ created: true });
    });

    it('.sessions 只允许当前项目 spill；会话存档 JSONL 不可读', async () => {
        const { port } = makePort({ adapterExists: false });
        const allowed = `${spillFolderFor('长篇小说/书A')}/spill-1.md`;

        await expect(port.readFile?.(allowed)).resolves.toBeNull();
        await expect(port.readFile?.('.sessions/agent/书A.jsonl')).rejects.toThrow();
        await expect(port.readFile?.('.sessions/spill/agent/别的项目/x.md')).rejects.toThrow();
    });
});

// S3-18（安全 r3）：spill 目录必须由 scope 唯一决定
describe('spill 目录唯一性', () => {
    it('不同项目即使 slug 后同名也落不同目录', () => {
        // slug 会把 `/` 与 `-` 归一到同一个字符：这两者净化后都是「长篇小说-书A」
        expect(spillFolderFor('长篇小说/书A')).not.toBe(spillFolderFor('长篇小说-书A'));
    });

    it('同一 scope 稳定得到同一目录（会话内多次 spill 不漂移）', () => {
        expect(spillFolderFor('长篇小说/书A')).toBe(spillFolderFor('长篇小说/书A'));
    });

    it('空 scope 回落 default 且仍带哈希', () => {
        const path = spillFolderFor('');
        expect(path).toContain('/default-');
    });

    it('目录路径始终在 SPILL_ROOT 下', () => {
        for (const scope of ['长篇小说/书A', '长篇小说-书A', '书B', '']) {
            expect(spillFolderFor(scope).startsWith('.sessions/spill/agent/')).toBe(true);
        }
    });
});
