import { describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian';
import { getProjectMeta } from '../../../ui/project-utils';
import { pjProjectMeta, pjVolumeOutlineDir } from '../../../shared/paths';

/**
 * PF-5（2026-11-10 首屏审计）：项目选择页按项目数重复全库扫描。
 * `getProjectMeta` 读分卷大纲时走 `ObsidianVaultMeta.getFiles()`，
 * 旧实现每个项目各调一次；批量渲染应只取一份快照透传。
 * 这里用 getFiles 调用计数锁住两种调用方式的差异。
 */
const PROJECTS = ['项目1', '项目2', '项目3'];

function seedProject(app: App, project: string, genre: string): void {
    (app.vault as unknown as { _seedFile: (path: string, content: string) => void })._seedFile(
        pjProjectMeta(project),
        `## 题材\n${genre}\n\n## 描述\n测试项目`,
    );
    (app.vault as unknown as { _seedFile: (path: string, content: string) => void })._seedFile(
        `${pjVolumeOutlineDir(project)}/第1卷_分卷大纲.md`,
        // 真实模板格式：`- **章节范围**：第X章 - 第Y章`
        '### 第1卷\n- **卷名**：《开局》\n- **章节范围**：第1章 - 第10章\n',
    );
}

describe('getProjectMeta — 文件快照复用', () => {
    it('不传快照：每个项目各触发一次全库 getFiles', async () => {
        const app = new App();
        for (const project of PROJECTS) seedProject(app, project, '玄幻');
        const spy = vi.spyOn(app.vault, 'getFiles');

        const metas = await Promise.all(PROJECTS.map((project) => getProjectMeta(app, project)));

        expect(spy.mock.calls.length).toBe(PROJECTS.length);
        expect(metas.map((meta) => meta.genre)).toEqual(['玄幻', '玄幻', '玄幻']);
        expect(metas.every((meta) => meta.volumes.length === 1)).toBe(true);
    });

    it('传入同一快照：N 个项目合计 0 次额外全库扫描，结果不变', async () => {
        const app = new App();
        for (const project of PROJECTS) seedProject(app, project, '仙侠');
        const files = app.vault.getFiles();
        const spy = vi.spyOn(app.vault, 'getFiles');
        spy.mockClear();

        const metas = await Promise.all(PROJECTS.map((project) => getProjectMeta(app, project, files)));

        expect(spy).not.toHaveBeenCalled();
        expect(metas.map((meta) => meta.genre)).toEqual(['仙侠', '仙侠', '仙侠']);
        expect(metas.every((meta) => meta.volumes.length === 1)).toBe(true);
    });
});
