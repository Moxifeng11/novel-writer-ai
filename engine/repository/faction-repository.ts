/**
 * repository/faction-repository.ts — 势力仓储
 *
 * 负责势力实体的持久化和查询，继承 BaseMarkdownRepository。
 */

import type { FileSystemPort } from '../../shared/file-system-port';
import { entityDir } from '../../shared/entity-reader';
import { pjFactionFile } from '../../shared/paths';
import { BaseMarkdownRepository } from './base-markdown-repository';
import type { BaseMarkdownRepositoryOptions } from './base-markdown-repository';
import { Faction } from './domain/aggregates';
import { EntityFactory } from './domain/serializers';

/**
 * 势力仓储
 * 项目范围（project-scoped），构造函数接收 project 参数
 */
export class FactionRepository extends BaseMarkdownRepository<Faction, string> {
    private readonly project: string;

    constructor(
        fs: FileSystemPort,
        project: string,
        options: BaseMarkdownRepositoryOptions = {},
    ) {
        super(fs, options);
        this.project = project;
    }

    protected idFromEntity(entity: Faction): string {
        return entity.id;
    }

    protected filePathFromId(id: string): string {
        return pjFactionFile(this.project, id);
    }

    protected deserialize(content: string, filePath: string): Faction {
        return EntityFactory.factionFromMarkdown(content, filePath);
    }

    protected serialize(entity: Faction): string {
        return EntityFactory.factionToMarkdown(entity);
    }

    protected getBasePath(): string {
        return entityDir(this.project, 'factions');
    }

    protected sampleId(): string {
        return 'sample';
    }

    // ============================================================
    // 实体特定查询方法
    // ============================================================

    /**
     * 按领袖查找势力
     * @param leaderName - 负责人名称
     * @returns 结果数组
     */
    async findByLeader(leaderName: string): Promise<Faction[]> {
        const all = await this.findAll();
        return all.filter(f => f.leader === leaderName);
    }

    /**
     * 按类型查找势力
     * @param type - 类型
     * @returns 结果数组
     */
    async findByType(type: string): Promise<Faction[]> {
        const all = await this.findAll();
        return all.filter(f => f.type === type);
    }

    /**
     * 按状态查找势力
     * @param status - 状态
     * @returns 结果数组
     */
    async findByStatus(status: 'active' | 'inactive' | 'dead' | 'hidden'): Promise<Faction[]> {
        const all = await this.findAll();
        return all.filter(f => f.entityStatus?.value === status);
    }

    /**
     * 按名称模糊查找
     * @param name - 名称
     * @returns 结果数组
     */
    async findByName(name: string): Promise<Faction[]> {
        const all = await this.findAll();
        return all.filter(f => f.name.includes(name));
    }

    /**
     * 获取项目名称（供关联查询使用）
     * @returns 文本结果
     */
    getProjectName(): string {
        return this.project;
    }
}
