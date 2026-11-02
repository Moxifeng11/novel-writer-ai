/**
 * repository/location-repository.ts — 地点仓储
 *
 * 负责地点实体的持久化和查询，继承 BaseMarkdownRepository。
 */

import type { FileSystemPort } from '../../shared/file-system-port';
import { entityDir } from '../../shared/entity-reader';
import { pjLocFile } from '../../shared/paths';
import { BaseMarkdownRepository } from './base-markdown-repository';
import type { BaseMarkdownRepositoryOptions } from './base-markdown-repository';
import { Location } from './domain/aggregates';
import { EntityFactory } from './domain/serializers';

/**
 * 地点仓储
 * 项目范围（project-scoped），构造函数接收 project 参数
 */
export class LocationRepository extends BaseMarkdownRepository<Location, string> {
    private readonly project: string;

    constructor(
        fs: FileSystemPort,
        project: string,
        options: BaseMarkdownRepositoryOptions = {},
    ) {
        super(fs, options);
        this.project = project;
    }

    protected idFromEntity(entity: Location): string {
        return entity.id;
    }

    protected filePathFromId(id: string): string {
        return pjLocFile(this.project, id);
    }

    protected deserialize(content: string, filePath: string): Location {
        return EntityFactory.locationFromMarkdown(content, filePath);
    }

    protected serialize(entity: Location): string {
        return EntityFactory.locationToMarkdown(entity);
    }

    protected getBasePath(): string {
        return entityDir(this.project, 'locations');
    }

    protected sampleId(): string {
        return 'sample';
    }

    // ============================================================
    // 实体特定查询方法
    // ============================================================

    /**
     * 按区域/世界查找地点
     * @param region - 区域
     * @returns 结果数组
     */
    async findByRegion(region: string): Promise<Location[]> {
        const all = await this.findAll();
        return all.filter(l => l.worldRegion === region);
    }

    /**
     * 按重要程度查找地点
     * @param importance - 重要度
     * @returns 结果数组
     */
    async findByImportance(importance: string): Promise<Location[]> {
        const all = await this.findAll();
        return all.filter(l => l.importance === importance);
    }

    /**
     * 按类型查找地点
     * @param type - 类型
     * @returns 结果数组
     */
    async findByType(type: string): Promise<Location[]> {
        const all = await this.findAll();
        return all.filter(l => l.type === type);
    }

    /**
     * 按状态查找地点
     * @param status - 状态
     * @returns 结果数组
     */
    async findByStatus(status: 'active' | 'inactive' | 'dead' | 'hidden'): Promise<Location[]> {
        const all = await this.findAll();
        return all.filter(l => l.entityStatus?.value === status);
    }

    /**
     * 按名称模糊查找
     * @param name - 名称
     * @returns 结果数组
     */
    async findByName(name: string): Promise<Location[]> {
        const all = await this.findAll();
        return all.filter(l => l.name.includes(name));
    }

    /**
     * 获取项目名称（供关联查询使用）
     * @returns 文本结果
     */
    getProjectName(): string {
        return this.project;
    }
}
