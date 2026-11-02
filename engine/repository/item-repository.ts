/**
 * repository/item-repository.ts — 物品功法仓储
 *
 * 负责物品功法实体的持久化和查询，继承 BaseMarkdownRepository。
 */

import type { FileSystemPort } from '../../shared/file-system-port';
import { entityDir } from '../../shared/entity-reader';
import { pjItemFile } from '../../shared/paths';
import { BaseMarkdownRepository } from './base-markdown-repository';
import type { BaseMarkdownRepositoryOptions } from './base-markdown-repository';
import { Item } from './domain/aggregates';
import { EntityFactory } from './domain/serializers';

/**
 * 物品功法仓储
 * 项目范围（project-scoped），构造函数接收 project 参数
 */
export class ItemRepository extends BaseMarkdownRepository<Item, string> {
    private readonly project: string;

    constructor(
        fs: FileSystemPort,
        project: string,
        options: BaseMarkdownRepositoryOptions = {},
    ) {
        super(fs, options);
        this.project = project;
    }

    protected idFromEntity(entity: Item): string {
        return entity.id;
    }

    protected filePathFromId(id: string): string {
        return pjItemFile(this.project, id);
    }

    protected deserialize(content: string, filePath: string): Item {
        return EntityFactory.itemFromMarkdown(content, filePath);
    }

    protected serialize(entity: Item): string {
        return EntityFactory.itemToMarkdown(entity);
    }

    protected getBasePath(): string {
        return entityDir(this.project, 'items');
    }

    protected sampleId(): string {
        return 'sample';
    }

    // ============================================================
    // 实体特定查询方法
    // ============================================================

    /**
     * 按所有者查找物品
     * @param ownerName - 所有者名称
     * @returns 结果数组
     */
    async findByOwner(ownerName: string): Promise<Item[]> {
        const all = await this.findAll();
        return all.filter(i => i.owner === ownerName);
    }

    /**
     * 按品阶/等级查找物品
     * @param grade - 等级
     * @returns 结果数组
     */
    async findByGrade(grade: string): Promise<Item[]> {
        const all = await this.findAll();
        return all.filter(i => i.grade === grade);
    }

    /**
     * 按类型查找物品
     * @param type - 类型
     * @returns 结果数组
     */
    async findByType(type: string): Promise<Item[]> {
        const all = await this.findAll();
        return all.filter(i => i.type === type);
    }

    /**
     * 按状态查找物品
     * @param status - 状态
     * @returns 结果数组
     */
    async findByStatus(status: 'active' | 'inactive' | 'dead' | 'hidden'): Promise<Item[]> {
        const all = await this.findAll();
        return all.filter(i => i.entityStatus?.value === status);
    }

    /**
     * 按名称模糊查找
     * @param name - 名称
     * @returns 结果数组
     */
    async findByName(name: string): Promise<Item[]> {
        const all = await this.findAll();
        return all.filter(i => i.name.includes(name));
    }

    /**
     * 获取项目名称（供关联查询使用）
     * @returns 文本结果
     */
    getProjectName(): string {
        return this.project;
    }
}
