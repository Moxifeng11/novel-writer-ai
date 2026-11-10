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
    pjVersionsDir,
    pluginPreferenceFile,
    pluginStylePatternsFile,
} from '@/shared/paths';
import { projectDisplayName } from '@/domains/kernel/project-locator';
import { writeVaultText } from '@/shared/file-system-port';
import { withWriteLock } from '@/shared/write-lock';

/**
 * ProjectRenameResult 类型定义。
 */
export interface ProjectRenameResult {
    success: boolean;
    oldProject: string;
    newProject: string;
    warnings: string[];
}

/**
 * ProjectRenameService 类。
 */
export class ProjectRenameService {
    constructor(private readonly app: App) {}

    /**
     * rename 方法。
     * @param oldProject - 旧项目
     * @param newName - 新名称
      * @returns ProjectRenameResult 实例
     */
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
        await this.safeStep(warnings, '迁移版本索引路径', () => this.migrateVersionIndexes(oldProject, newProject));
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
        // D3-14：读—替换—写与结构切换/世界观生成共用同一路径锁
        await withWriteLock(path, async () => {
            const content = await adapter.read(path);
            // 用函数替换，避免书名里的 $&/$' 被当成替换模式
            const updated = content.replace(/^#\s+.+$/m, () => `# ${name}`);
            // P1-5（v4.27）：项目内 .md 走 vault 索引写入，adapter.write 不触发 modify 事件，
            // metadataCache 仍是旧 frontmatter，后续 processFrontmatter 会用旧值覆盖改名结果。
            if (updated !== content) await writeVaultText(this.app, path, updated);
        });
    }

    private async syncWorldview(project: string, name: string): Promise<void> {
        const path = pjWorldview(project);
        const adapter = this.app.vault.adapter;
        if (!(await adapter.exists(path))) return;
        await withWriteLock(path, async () => {
            const content = await adapter.read(path);
            const line = `项目名称: ${name}`;
            const updated = /^项目名称:\s*.*$/m.test(content)
                ? content.replace(/^项目名称:\s*.*$/m, line)
                : content.replace(/^---\s*$/m, `---\n${line}`);
            if (updated !== content) await writeVaultText(this.app, path, updated);
        });
    }

    private async syncWritingProfile(project: string, name: string): Promise<void> {
        const path = `${project}/写作配置.md`;
        const adapter = this.app.vault.adapter;
        if (!(await adapter.exists(path))) return;
        await withWriteLock(path, async () => {
            const content = await adapter.read(path);
            const updated = /^projectName:\s*.*$/m.test(content)
                ? content.replace(/^projectName:\s*.*$/m, `projectName: ${name}`)
                : content.replace(/^---\s*$/m, `---\nprojectName: ${name}`);
            if (updated !== content) await writeVaultText(this.app, path, updated);
        });
    }

    /**
     * 迁移项目内全部版本索引里的项目/路径字段（D3-6）。
     *
     * 目录 rename 后 `versions.json` 跟着移动，但条目里的 `project`/`sourcePath`/
     * `versionPath` 仍是旧项目路径；读取侧会按新项目过滤掉这些条目，历史看起来「消失」，
     * 回滚还会写回旧路径生成重复正文。这里逐个索引重写路径前缀。
     *
     * @param oldProject - 旧项目路径
     * @param newProject - 新项目路径
     */
    private async migrateVersionIndexes(oldProject: string, newProject: string): Promise<void> {
        const adapter = this.app.vault.adapter;
        const root = pjVersionsDir(newProject);
        if (!(await adapter.exists(root))) return;

        const indexFiles: string[] = [];
        const walk = async (dir: string): Promise<void> => {
            const listing = await adapter.list(dir);
            for (const file of listing.files) {
                if (file.endsWith('/versions.json')) indexFiles.push(file);
            }
            for (const sub of listing.folders) await walk(sub);
        };
        await walk(root);

        for (const path of indexFiles) {
            try {
                const raw = await adapter.read(path);
                const parsed = JSON.parse(raw) as { project?: string; versions?: Array<Record<string, unknown>> };
                if (!Array.isArray(parsed.versions)) continue;

                let changed = false;
                if (typeof parsed.project === 'string' && parsed.project !== newProject) {
                    parsed.project = newProject;
                    changed = true;
                }
                for (const entry of parsed.versions) {
                    if (typeof entry.project === 'string' && entry.project !== newProject) {
                        entry.project = newProject;
                        changed = true;
                    }
                    for (const key of ['sourcePath', 'versionPath'] as const) {
                        const value = entry[key];
                        if (typeof value === 'string' && value.startsWith(`${oldProject}/`)) {
                            entry[key] = `${newProject}/${value.slice(oldProject.length + 1)}`;
                            changed = true;
                        }
                    }
                }
                if (!changed) continue;

                await withWriteLock(path, async () => {
                    // write-entry-allow: 版本索引 JSON，位于项目 _versions 目录
                    await adapter.write(path, JSON.stringify(parsed, null, 2));
                });
            } catch {
                // 单个索引损坏跳过；读取侧会把它归档为 .corrupt-*.bak
            }
        }
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
            // write-entry-allow: 插件偏好/风格指纹是 .json，位于插件数据目录。
            await adapter.write(newPath, await adapter.read(oldPath));
            await adapter.remove(oldPath);
        }
    }
}