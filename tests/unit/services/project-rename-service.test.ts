import { describe, expect, it, vi } from 'vitest';
import { App, TFolder } from 'obsidian';
import { ProjectRenameService } from '../../../services/project-rename-service';
import { pluginPreferenceFile, pluginStylePatternsFile } from '../../../shared/paths';

describe('ProjectRenameService — 元数据迁移', () => {
    it('重命名后同步 .project / 世界观 / 写作配置 / 偏好文件', async () => {
        const app = new App() as any;
        await app.vault.createFolder('旧名');
        await app.vault.write('旧名/.project', '# 旧名\n\n## 类型\noriginal\n');
        await app.vault.write('旧名/01-世界架构/世界观总览.md', '---\n世界名称: 某界\n项目名称: 旧名\n---\n\n# 世界观\n');
        await app.vault.write('旧名/写作配置.md', '---\nprojectName: 旧名\n---\n');
        await app.vault.adapter.write(pluginPreferenceFile('旧名'), '{"a":1}');
        await app.vault.adapter.write(pluginStylePatternsFile('旧名'), '{"b":2}');

        const renameFile = vi.fn(async (folder: TFolder, newPath: string) => {
            for (const file of app.vault.getFiles()) {
                if (!file.path.startsWith('旧名/')) continue;
                const content = await app.vault.readByPath(file.path);
                await app.vault.write(`${newPath}/${file.path.slice('旧名/'.length)}`, content);
            }
            folder.path = newPath;
        });
        (app as unknown as { fileManager: { renameFile: typeof renameFile } }).fileManager = { renameFile };

        const result = await new ProjectRenameService(app).rename('旧名', '新名');

        expect(result.success).toBe(true);
        expect(renameFile).toHaveBeenCalled();
        expect(await app.vault.adapter.read('新名/.project')).toContain('# 新名');
        expect(await app.vault.adapter.read('新名/01-世界架构/世界观总览.md')).toContain('项目名称: 新名');
        expect(await app.vault.adapter.read('新名/写作配置.md')).toContain('projectName: 新名');
        expect(await app.vault.adapter.exists(pluginPreferenceFile('新名'))).toBe(true);
        expect(await app.vault.adapter.exists(pluginStylePatternsFile('新名'))).toBe(true);
        expect(await app.vault.adapter.exists(pluginPreferenceFile('旧名'))).toBe(false);
    });
});
