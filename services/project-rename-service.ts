/**
 * project-rename-service.ts — 项目目录重命名与引用迁移
 *
 * 只改目录不够：`.project`、世界观 frontmatter、写作配置、插件偏好文件
 * 都以项目名为键。这里把这些迁移收口，失败时返回 warnings，不假装全部成功。
 */
import { App, TFolder } from 'obsidian';
import {
    pjProjectMeta,
    pjWorldview,
    pluginPreferenceFile,
    pluginStylePatternsFile,
} from '../shared/paths';
import { projectDisplayName } from '../domains/kernel/project-locator';

export interface ProjectRenameResult {
    success: boolean;
    oldProject: string;
    newProject: string;
    warnings: string[];
}

export class ProjectRenameService {
    constructor(private readonly app: App) {}

    async rename(oldProject: string, newName: string): Promise<ProjectRenameResult> {
        const warnings: string[] = [];
        const parent = oldProject.includes('/')
            ? oldProject.slice(0, oldProject.lastIndexOf('/'))
            : '';
        const displayName = projectDisplayName(oldProject);
        const newProject = parent ? `${parent}/${newName}` : newName;
        const folder = this.app.vault.getAbstractFileByPath(oldProject);
        if (!(folder instanceof TFolder)) {
            throw new Error('未找到当前项目文件夹，无法重命名');
        }
        if (this.app.vault.getAbstractFileByPath(newProject)) {
            throw new Error(`文件夹「${newName}」已存在，请换一个名称`);
        }

        await this.app.fileManager.renameFile(folder, newProject);

        await this.safeStep(warnings, '更新 .project 标题', () => this.syncProjectMeta(newProject, newName));
        await this.safeStep(warnings, '更新世界观项目名称', () => this.syncWorldview(newProject, newName));
        await this.safeStep(warnings, '更新写作配置项目名', () => this.syncWritingProfile(newProject, newName));
                await this.safeStep(warnings, '迁移插件偏好文件', () => this.migratePluginData(oldProject, displayName, newProject, newName));

        return { success: true, oldProject, newProject, warnings };
    }

    private async safeStep(warnings: string[], label: string, step: () => Promise<void>): Promise<void> {
        try {
            await step();
        } catch (error) {
            warnings.push(`${label}失败：${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async syncProjectMeta(project: string, name: string): Promise<void> {
        const path = pjProjectMeta(project);
        const adapter = this.app.vault.adapter;
        if (!(await adapter.exists(path))) return;
        const content = await adapter.read(path);
        const updated = content.replace(/^#\s+.+$/m, `# ${name}`);
        if (updated !== content) await adapter.write(path, updated);
    }

    private async syncWorldview(project: string, name: string): Promise<void> {
        const path = pjWorldview(project);
        const adapter = this.app.vault.adapter;
        if (!(await adapter.exists(path))) return;
        const content = await adapter.read(path);
        const line = `项目名称: ${name}`;
        const updated = /^项目名称:\s*.*$/m.test(content)
            ? content.replace(/^项目名称:\s*.*$/m, line)
            : content.replace(/^---\s*$/m, `---\n${line}`);
        if (updated !== content) await adapter.write(path, updated);
    }

    private async syncWritingProfile(project: string, name: string): Promise<void> {
        const path = `${project}/写作配置.md`;
        const adapter = this.app.vault.adapter;
        if (!(await adapter.exists(path))) return;
        const content = await adapter.read(path);
        const updated = /^projectName:\s*.*$/m.test(content)
            ? content.replace(/^projectName:\s*.*$/m, `projectName: ${name}`)
            : content.replace(/^---\s*$/m, `---\nprojectName: ${name}`);
        if (updated !== content) await adapter.write(path, updated);
    }

    private async migratePluginData(oldProject: string, oldDisplayName: string, newProject: string, newDisplayName: string): Promise<void> {
        const adapter = this.app.vault.adapter;
        const pairs: Array<[string, string]> = [
            [pluginPreferenceFile(oldDisplayName), pluginPreferenceFile(newDisplayName)],
            [pluginStylePatternsFile(oldDisplayName), pluginStylePatternsFile(newDisplayName)],
        ];
        for (const [oldPath, newPath] of pairs) {
            if (!(await adapter.exists(oldPath))) continue;
            if (await adapter.exists(newPath)) continue;
            await adapter.write(newPath, await adapter.read(oldPath));
            await adapter.remove(oldPath);
        }
    }
}