/**
 * repository/project-repository.ts — 项目仓储
 *
 * 负责项目元数据的持久化和查询，继承 BaseMarkdownRepository。
 * 项目元数据存储在各项目目录下的 .project 文件中。
 */

import type { FileSystemPort } from '../../shared/file-system-port';
import { pjProjectMeta } from '../../shared/paths';
import { BaseMarkdownRepository } from './base-markdown-repository';
import type { BaseMarkdownRepositoryOptions } from './base-markdown-repository';
import { Project } from './domain/aggregates';
import type { ProjectMeta } from './domain/aggregates';
import { EntityFactory } from './domain/serializers';

/**
 * 项目仓储
 * 非项目范围（vault 全局），负责管理所有项目
 */
export class ProjectRepository extends BaseMarkdownRepository<Project, string> {
    constructor(
        fs: FileSystemPort,
        options: BaseMarkdownRepositoryOptions = {},
    ) {
        super(fs, options);
    }

    protected idFromEntity(entity: Project): string {
        return entity.id;
    }

    protected filePathFromId(id: string): string {
        return pjProjectMeta(id);
    }

    protected deserialize(content: string, filePath: string): Project {
        return EntityFactory.projectFromMarkdown(content, filePath);
    }

    protected serialize(entity: Project): string {
        return EntityFactory.projectToMarkdown(entity);
    }

    protected getBasePath(): string {
        return '';
    }

    protected sampleId(): string {
        return 'sample-project';
    }

    protected idFromFilePath(filePath: string): string {
        const match = filePath.match(/^(.+)\/\.project$/);
        if (match) {
            return match[1].split('/').pop() || match[1];
        }
        const fileName = filePath.split('/').pop() || '';
        return fileName.replace(/\.md$/, '');
    }

    // ============================================================
    // 重写 findAll：扫描所有项目的 .project 文件
    // ============================================================

    /**
     * 查找所有项目
     * 通过扫描根目录下包含 .project 文件的子目录来发现项目
     * @returns 结果数组
     */
    async findAll(): Promise<Project[]> {
        const allFiles = await this.fs.listFiles('');
        const projectFiles = allFiles.filter(f => f.path.endsWith('/.project'));

        const results: Project[] = [];
        for (const file of projectFiles) {
            const id = this.idFromFilePath(file.path);
            const entity = await this.findById(id);
            if (entity) {
                results.push(entity);
            }
        }

        return results;
    }

    // ============================================================
    // 实体特定查询方法
    // ============================================================

    /**
     * 获取项目元数据
     * @param projectId - 项目ID
      * @returns ProjectMeta 或 null
     */
    async getMeta(projectId: string): Promise<ProjectMeta | null> {
        const project = await this.findById(projectId);
        if (!project) return null;
        return project.projectMeta;
    }

    /**
     * 更新项目元数据
     * @param projectId - 项目ID
     * @param meta - 元数据
      * @returns Project 或 null
     */
    async updateMeta(projectId: string, meta: Partial<ProjectMeta>): Promise<Project | null> {
        const project = await this.findById(projectId);
        if (!project) return null;

        const updated = project.withMeta(meta);
        return this.save(updated);
    }

    /**
     * 按题材查找项目
     * @param genre - 题材
     * @returns 结果数组
     */
    async findByGenre(genre: string): Promise<Project[]> {
        const all = await this.findAll();
        return all.filter(p => p.genre === genre);
    }

    /**
     * 按类型查找项目
     * @param type - 类型
     * @returns 结果数组
     */
    async findByType(type: string): Promise<Project[]> {
        const all = await this.findAll();
        return all.filter(p => p.type === type);
    }

    /**
     * 按作者查找项目
     * @param author - 作者
     * @returns 结果数组
     */
    async findByAuthor(author: string): Promise<Project[]> {
        const all = await this.findAll();
        return all.filter(p => p.author === author);
    }
}
