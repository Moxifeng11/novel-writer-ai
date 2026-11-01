/**
 * repository/character-repository.ts — 人物仓储
 *
 * 负责人物实体的持久化和查询，继承 BaseMarkdownRepository。
 */

import type { FileSystemPort } from '../../shared/file-system-port';
import { entityDir } from '../../shared/entity-reader';
import { pjCharFile } from '../../shared/paths';
import { BaseMarkdownRepository } from './base-markdown-repository';
import type { BaseMarkdownRepositoryOptions } from './base-markdown-repository';
import { Character } from './domain/aggregates';
import { EntityFactory } from './domain/serializers';

/**
 * 人物仓储
 * 项目范围（project-scoped），构造函数接收 project 参数
 */
export class CharacterRepository extends BaseMarkdownRepository<Character, string> {
    private readonly project: string;

    constructor(
        fs: FileSystemPort,
        project: string,
        options: BaseMarkdownRepositoryOptions = {},
    ) {
        super(fs, options);
        this.project = project;
    }

    protected idFromEntity(entity: Character): string {
        return entity.id;
    }

    protected filePathFromId(id: string): string {
        return pjCharFile(this.project, id);
    }

    protected deserialize(content: string, filePath: string): Character {
        return EntityFactory.characterFromMarkdown(content, filePath);
    }

    protected serialize(entity: Character): string {
        return EntityFactory.characterToMarkdown(entity);
    }

    protected getBasePath(): string {
        return entityDir(this.project, 'characters');
    }

    protected sampleId(): string {
        return 'sample';
    }

    // ============================================================
    // 实体特定查询方法
    // ============================================================

    /**
     * 按所属势力查找人物
     */
    async findByFaction(factionName: string): Promise<Character[]> {
        const all = await this.findAll();
        return all.filter(c => c.faction === factionName);
    }

    /**
     * 按状态查找人物
     * @param status 实体状态：active | inactive | dead | hidden
     */
    async findByStatus(status: 'active' | 'inactive' | 'dead' | 'hidden'): Promise<Character[]> {
        const all = await this.findAll();
        return all.filter(c => c.entityStatus?.value === status);
    }

    /**
     * 按身份查找人物（主角/配角/反派/路人等）
     */
    async findByIdentity(identity: string): Promise<Character[]> {
        const all = await this.findAll();
        return all.filter(c => c.identity === identity);
    }

    /**
     * 按姓名模糊查找
     */
    async findByName(name: string): Promise<Character[]> {
        const all = await this.findAll();
        return all.filter(c => c.name.includes(name));
    }

    /**
     * 按当前位置查找人物
     */
    async findByCurrentLocation(location: string): Promise<Character[]> {
        const all = await this.findAll();
        return all.filter(c => c.currentLocation === location);
    }

    /**
     * 获取项目名称（供关联查询使用）
     */
    getProjectName(): string {
        return this.project;
    }
}
