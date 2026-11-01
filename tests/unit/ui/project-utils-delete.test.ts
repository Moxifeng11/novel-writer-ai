import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({
    Notice: class { constructor(_msg?: string, _duration?: number) {} },
    App: class {},
    TFile: class {},
    TFolder: class {},
    Modal: class {},
    Setting: class {},
}));

import { deleteProject } from '../../../ui/project-utils';

function makeApp(files: string[] = []) {
    const removed: string[] = [];
    const rmdirs: string[] = [];
    const remaining = new Set(files);
    const adapter = {
        list: async (dir: string) => ({
            files: [...remaining].filter(p => p.startsWith(`${dir}/`) && !p.slice(dir.length + 1).includes('/')),
            folders: [],
        }),
        remove: async (p: string) => { removed.push(p); remaining.delete(p); },
        rmdir: async (p: string) => { rmdirs.push(p); },
        exists: async (p: string) => remaining.has(p) || remaining.size > 0 && [...remaining].some(f => f.startsWith(`${p}/`)),
    };
    return { app: { vault: { adapter } } as never, removed, rmdirs };
}

describe('deleteProject — 路径防线', () => {
    it('空串直接拒绝，绝不触碰 vault 根', async () => {
        const { app, rmdirs } = makeApp();
        await expect(deleteProject(app, '')).rejects.toThrow('拒绝删除非法项目路径');
        await expect(deleteProject(app, '   ')).rejects.toThrow('拒绝删除非法项目路径');
        expect(rmdirs).toEqual([]);
    });

    it('包含 .. 的路径被拒绝', async () => {
        const { app } = makeApp();
        await expect(deleteProject(app, '长篇小说/../..')).rejects.toThrow('拒绝删除非法项目路径');
        await expect(deleteProject(app, '.')).rejects.toThrow('拒绝删除非法项目路径');
    });

    it('正常项目路径逐文件删除后删目录', async () => {
        const { app, removed, rmdirs } = makeApp([
            '长篇小说/书A/作品信息.md',
            '长篇小说/书A/.project',
        ]);
        await deleteProject(app, '长篇小说/书A');
        expect(removed).toEqual(['长篇小说/书A/作品信息.md', '长篇小说/书A/.project']);
        expect(rmdirs).toEqual(['长篇小说/书A']);
    });

    it('首尾斜杠会被规范化后再删除', async () => {
        const { app, rmdirs } = makeApp(['长篇小说/书A/a.md']);
        await deleteProject(app, '/长篇小说/书A/');
        expect(rmdirs).toEqual(['长篇小说/书A']);
    });
});
