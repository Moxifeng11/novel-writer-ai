/**
 * repository/chapter-repository.ts — 章节仓储
 *
 * 负责章节正文和元数据的持久化和查询，继承 BaseMarkdownRepository。
 * 章节 ID 格式：v{volN}-c{chapN}，如 v1-c1 表示第1卷第1章
 */

import type { FileSystemPort } from '@/shared/file-system-port';
import { pjBodyFile, pjBodyDir } from '@/shared/paths';
import { BaseMarkdownRepository } from './base-markdown-repository';
import type { BaseMarkdownRepositoryOptions } from './base-markdown-repository';
import { Chapter } from './domain/aggregates';
import { EntityFactory } from './domain/serializers';
import { ChapterStatus } from './domain/value-objects';

/**
 * 解析章节 ID
 * @param chapterId 格式：v{volN}-c{chapN}
  * @returns number } 结果 或 null
 */
function parseChapterId(chapterId: string): { volN: number; chapN: number } | null {
    const match = chapterId.match(/^v(\d+)-c(\d+)$/);
    if (!match) return null;
    return {
        volN: parseInt(match[1], 10),
        chapN: parseInt(match[2], 10),
    };
}

/**
 * 构建章节 ID
 * @param volN - 卷编号
 * @param chapN - 章号
 * @returns 文本结果
 */
function buildChapterId(volN: number, chapN: number): string {
    return `v${volN}-c${chapN}`;
}

/**
 * 章节仓储
 * 项目范围（project-scoped），构造函数接收 project 参数
 */
export class ChapterRepository extends BaseMarkdownRepository<Chapter, string> {
    private readonly project: string;

    constructor(
        fs: FileSystemPort,
        project: string,
        options: BaseMarkdownRepositoryOptions = {},
    ) {
        super(fs, options);
        this.project = project;
    }

    protected idFromEntity(entity: Chapter): string {
        return buildChapterId(entity.volume, entity.chapterNum);
    }

    protected filePathFromId(id: string): string {
        const parsed = parseChapterId(id);
        if (!parsed) {
            return `${this.project}/03-大纲与章节/正文/${id}.md`;
        }
        return pjBodyFile(this.project, parsed.volN, parsed.chapN);
    }

    protected deserialize(content: string, filePath: string): Chapter {
        return EntityFactory.chapterFromMarkdown(content, filePath);
    }

    protected serialize(entity: Chapter): string {
        return EntityFactory.chapterToMarkdown(entity);
    }

    protected getBasePath(): string {
        return `${this.project}/03-大纲与章节/正文`;
    }

    protected sampleId(): string {
        return 'v1-c1';
    }

    protected idFromFilePath(filePath: string): string {
        const volMatch = filePath.match(/第(\d+)卷/);
        const chapMatch = filePath.match(/第(\d+)章_正文\.md$/);
        if (volMatch && chapMatch) {
            return buildChapterId(
                parseInt(volMatch[1], 10),
                parseInt(chapMatch[1], 10),
            );
        }
        const fileName = filePath.split('/').pop() || '';
        return fileName.replace(/\.md$/, '');
    }

    // ============================================================
    // 实体特定查询方法
    // ============================================================

    /**
     * 按卷号查找章节
     * @param volN - 卷编号
     * @returns 结果数组
     */
    async findByVolume(volN: number): Promise<Chapter[]> {
        const volDir = pjBodyDir(this.project, volN);
        const files = await this.fs.listFiles(volDir);
        const mdFiles = files.filter(f => f.path.endsWith('.md'));

        const results: Chapter[] = [];
        for (const file of mdFiles) {
            const id = this.idFromFilePath(file.path);
            const entity = await this.findById(id);
            if (entity) {
                results.push(entity);
            }
        }

        results.sort((a, b) => a.chapterNum - b.chapterNum);
        return results;
    }

    /**
     * 按状态查找章节
     * @param status 章节状态：pending | written | settled
     * @returns 结果数组
     */
    async findByStatus(status: 'pending' | 'written' | 'settled'): Promise<Chapter[]> {
        const all = await this.findAll();
        return all.filter(c => c.status.value === status);
    }

    /**
     * 按字数范围查找章节
     * @param min - 最小
     * @param max - 最大
     * @returns 结果数组
     */
    async findByWordCountRange(min: number, max: number): Promise<Chapter[]> {
        const all = await this.findAll();
        return all.filter(c => {
            const count = c.wordCount.chinese;
            return count >= min && count <= max;
        });
    }

    /**
     * 根据卷号和章号获取章节
     * @param volN - 卷编号
     * @param chapN - 章号
      * @returns Chapter 或 null
     */
    async findByVolChap(volN: number, chapN: number): Promise<Chapter | null> {
        const id = buildChapterId(volN, chapN);
        return this.findById(id);
    }

    /**
     * 获取某卷的章节总数
     * @param volN - 卷编号
     * @returns 数值结果
     */
    async countByVolume(volN: number): Promise<number> {
        const chapters = await this.findByVolume(volN);
        return chapters.length;
    }

    /**
     * 获取所有卷号
     * @returns 结果数组
     */
    async getAllVolumes(): Promise<number[]> {
        const all = await this.findAll();
        const vols = new Set(all.map(c => c.volume));
        return Array.from(vols).sort((a, b) => a - b);
    }

    // ============================================================
    // 关联查询方法
    // ============================================================

    /**
     * 获取章节涉及的人物名称列表
     * @param chapterId - 章节ID
     * @returns 结果数组
     */
    async getRelatedCharacterNames(chapterId: string): Promise<string[]> {
        const chapter = await this.findById(chapterId);
        if (!chapter) return [];
        return chapter.characters;
    }

    /**
     * 获取章节涉及的地点名称列表
     * @param chapterId - 章节ID
     * @returns 结果数组
     */
    async getRelatedLocationNames(chapterId: string): Promise<string[]> {
        const chapter = await this.findById(chapterId);
        if (!chapter) return [];
        return chapter.locations;
    }

    /**
     * 获取章节涉及的势力名称列表
     * @param chapterId - 章节ID
     * @returns 结果数组
     */
    async getRelatedFactionNames(chapterId: string): Promise<string[]> {
        const chapter = await this.findById(chapterId);
        if (!chapter) return [];
        return chapter.factions;
    }

    /**
     * 获取章节涉及的物品功法名称列表
     * @param chapterId - 章节ID
     * @returns 结果数组
     */
    async getRelatedItemNames(chapterId: string): Promise<string[]> {
        const chapter = await this.findById(chapterId);
        if (!chapter) return [];
        return chapter.items;
    }

    /**
     * 查找某人物出现的所有章节
     * @param characterName - 角色名称
     * @returns 结果数组
     */
    async findChaptersByCharacter(characterName: string): Promise<Chapter[]> {
        const all = await this.findAll();
        return all.filter(c => c.characters.includes(characterName));
    }

    /**
     * 查找某地点出现的所有章节
     * @param locationName - 地点名称
     * @returns 结果数组
     */
    async findChaptersByLocation(locationName: string): Promise<Chapter[]> {
        const all = await this.findAll();
        return all.filter(c => c.locations.includes(locationName));
    }

    /**
     * 查找某势力出现的所有章节
     * @param factionName - 势力名称
     * @returns 结果数组
     */
    async findChaptersByFaction(factionName: string): Promise<Chapter[]> {
        const all = await this.findAll();
        return all.filter(c => c.factions.includes(factionName));
    }

    /**
     * 查找某物品出现的所有章节
     * @param itemName - 条目名称
     * @returns 结果数组
     */
    async findChaptersByItem(itemName: string): Promise<Chapter[]> {
        const all = await this.findAll();
        return all.filter(c => c.items.includes(itemName));
    }

    /**
     * 获取项目名称（供关联查询使用）
     * @returns 文本结果
     */
    getProjectName(): string {
        return this.project;
    }
}
