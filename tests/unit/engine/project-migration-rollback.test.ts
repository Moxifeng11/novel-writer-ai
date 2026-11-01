/**
 * ProjectMigrationService.rollback —— 迁移撤销（G3-4）
 *
 * 只回退「本次 moved 列表」，按相反顺序移回；原路径被占用时跳过并报告，不覆盖。
 */
import { describe, expect, it } from 'vitest';
import { TFolder } from '../../__mocks__/obsidian';
import {
    ProjectMigrationService,
    type MigrationCandidate,
} from '../../../engine/project-migration-service';

function makeApp(initialPaths: string[]) {
    const folders = new Map<string, TFolder>();
    for (const path of initialPaths) folders.set(path, new TFolder());
    const renames: Array<{ from: string; to: string }> = [];
    const app = {
        vault: {
            getAbstractFileByPath: (path: string) => folders.get(path) ?? null,
        },
        fileManager: {
            renameFile: async (folder: TFolder, to: string) => {
                const from = [...folders.entries()].find(([, value]) => value === folder)?.[0];
                if (!from) throw new Error('folder not found');
                folders.delete(from);
                folders.set(to, folder);
                renames.push({ from, to });
            },
        },
    };
    return { app, folders, renames };
}

const service = (app: unknown) => new ProjectMigrationService(app as never);

const candidate = (projectId: string, targetPath: string): MigrationCandidate => ({
    projectId,
    displayName: projectId.split('/').pop() || projectId,
    mode: 'long',
    targetPath,
});

describe('ProjectMigrationService.rollback', () => {
    it('按相反顺序把项目移回原路径', async () => {
        const { app, folders, renames } = makeApp(['长篇小说/书A', '长篇小说/书B']);
        const moved = [
            candidate('旧A', '长篇小说/书A'),
            candidate('旧B', '长篇小说/书B'),
        ];

        const result = await service(app).rollback(moved);

        expect(result.failed).toEqual([]);
        expect(result.restored.map(item => item.projectId)).toEqual(['旧B', '旧A']);
        expect(renames).toEqual([
            { from: '长篇小说/书B', to: '旧B' },
            { from: '长篇小说/书A', to: '旧A' },
        ]);
        expect(folders.has('旧A')).toBe(true);
        expect(folders.has('长篇小说/书A')).toBe(false);
    });

    it('目标不存在：该项失败，不影响其它项', async () => {
        const { app, folders } = makeApp(['长篇小说/书A']);
        const result = await service(app).rollback([
            candidate('旧A', '长篇小说/书A'),
            candidate('旧B', '长篇小说/书B'),
        ]);

        expect(result.restored.map(item => item.projectId)).toEqual(['旧A']);
        expect(result.failed).toEqual([{ projectId: '旧B', error: '目标不存在：长篇小说/书B' }]);
        expect(folders.has('旧A')).toBe(true);
    });

    it('原路径已被占用：跳过该项，不覆盖', async () => {
        const { app, folders } = makeApp(['长篇小说/书A', '旧A']);
        const result = await service(app).rollback([candidate('旧A', '长篇小说/书A')]);

        expect(result.restored).toEqual([]);
        expect(result.failed[0].error).toContain('原路径已被占用');
        expect(folders.has('长篇小说/书A')).toBe(true);
        expect(folders.has('旧A')).toBe(true);
    });

    it('空列表直接返回空结果', async () => {
        const { app } = makeApp([]);
        await expect(service(app).rollback([])).resolves.toEqual({ restored: [], failed: [] });
    });
});
