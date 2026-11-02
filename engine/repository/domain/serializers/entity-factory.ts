/**
 * domain/serializers/entity-factory.ts — 实体工厂
 *
 * 提供 fromMarkdown / toMarkdown 工厂方法，负责实体与 Markdown 之间的双向转换。
 * 复用并封装现有 shared/entity-models.ts 的转换逻辑。
 */

import { parseMarkdownContent } from '../../../../shared/frontmatter';
import {
    characterFromMarkdown,
    factionFromMarkdown,
    locationFromMarkdown,
    itemFromMarkdown,
    characterToFrontmatter,
    factionToFrontmatter,
    locationToFrontmatter,
    itemToFrontmatter,
} from '../../../../shared/entity-models';
import type {
    CharacterDomainModel,
    FactionDomainModel,
    LocationDomainModel,
    ItemDomainModel,
} from '../../../../shared/entity-models';

import { Character, Faction, Location, Item, Chapter, Project } from '../aggregates';
import type {
    CharacterProps,
    FactionProps,
    LocationProps,
    ItemProps,
    ChapterProps,
    ProjectProps,
} from '../aggregates';
import { FrontmatterSerializer } from './frontmatter-serializer';
import { EntityStatus, Frontmatter, ChapterStatus, WordCount } from '../value-objects';
import type { WritingMode } from '../../../../shared/types';
import { parseFrontmatter } from '../../../../shared/frontmatter';

/**
 * 实体工厂
 * 提供各聚合根的 fromMarkdown / toMarkdown 方法
 */
export class EntityFactory {
    // ============================================================
    // Character
    // ============================================================

    /**
     * 角色 Markdown→实体。
     *
     * @param content - 内容
     * @param filePath - 文件路径
     * @returns 角色
     */
    static characterFromMarkdown(content: string, filePath: string = ''): Character {
        const domainModel = characterFromMarkdown(content, filePath);
        return EntityFactory.characterFromDomainModel(domainModel);
    }

    /**
     * 角色实体→Markdown。
     *
     * @param character - 角色
     * @returns Markdown
     */
    static characterToMarkdown(character: Character): string {
        const domainModel = EntityFactory.characterToDomainModel(character);
        const fm = characterToFrontmatter(domainModel);
        const fmStr = FrontmatterSerializer.serialize(Frontmatter.from(fm));
        const body = character.body || `# ${character.name}\n`;
        return `${fmStr}\n${body}`;
    }

    private static characterFromDomainModel(model: CharacterDomainModel): Character {
        const props: CharacterProps = {
            id: model.id,
            name: model.name,
            filePath: model.filePath,
            tags: model.tags,
            entityStatus: model.entityStatus ? EntityStatus.from(model.entityStatus) : null,
            createdAt: model.createdAt ?? null,
            lastChangedAt: model.lastChangedAt ?? null,
            lastChangedReason: model.lastChangedReason ?? null,
            frontmatter: Frontmatter.from(model.frontmatter),
            body: model.body,
            content: model.content,
            age: model.age,
            identity: model.identity,
            gender: model.gender,
            firstAppearance: model.firstAppearance,
            coreMotivation: model.coreMotivation,
            coreWeakness: model.coreWeakness,
            habit: model.habit,
            currentStatus: model.currentStatus,
            currentEmotion: model.currentEmotion,
            currentLocation: model.currentLocation,
            personalityTags: model.personalityTags,
            specialAbility: model.specialAbility,
            skillTree: model.skillTree,
            cultivationLevel: model.cultivationLevel,
            faction: model.faction,
            background: model.background,
            appearance: model.appearance,
            currentGoal: model.currentGoal,
            soul: model.soul,
            personality: model.personality,
            arc: model.arc,
            relations: model.relations,
        };
        return Character.from(props);
    }

    private static characterToDomainModel(character: Character): CharacterDomainModel {
        const fm = character.frontmatter.toObject();
        return {
            id: character.id,
            name: character.name,
            filePath: character.filePath,
            category: 'character',
            tags: character.tags,
            entityStatus: character.entityStatus?.toLegacyType(),
            createdAt: character.createdAt ?? undefined,
            lastChangedAt: character.lastChangedAt ?? undefined,
            lastChangedReason: character.lastChangedReason ?? undefined,
            frontmatter: fm,
            body: character.body,
            content: character.content,
            age: (character as any).age,
            identity: (character as any).identity,
            gender: (character as any).gender,
            firstAppearance: (character as any).firstAppearance,
            coreMotivation: (character as any).coreMotivation,
            coreWeakness: (character as any).coreWeakness,
            habit: (character as any).habit,
            currentStatus: (character as any).currentStatus,
            currentEmotion: (character as any).currentEmotion,
            currentLocation: (character as any).currentLocation,
            personalityTags: (character as any).personalityTags,
            specialAbility: (character as any).specialAbility,
            skillTree: (character as any).skillTree,
            cultivationLevel: (character as any).cultivationLevel,
            faction: (character as any).faction,
            background: (character as any).background,
            appearance: (character as any).appearance,
            currentGoal: (character as any).currentGoal,
            soul: (character as any).soul,
            personality: (character as any).personality,
            arc: (character as any).arc,
            relations: (character as any).relations,
        };
    }

    // ============================================================
    // Faction
    // ============================================================

    /**
     * 势力 Markdown→实体。
     *
     * @param content - 内容
     * @param filePath - 文件路径
     * @returns 势力
     */
    static factionFromMarkdown(content: string, filePath: string = ''): Faction {
        const domainModel = factionFromMarkdown(content, filePath);
        return EntityFactory.factionFromDomainModel(domainModel);
    }

    /**
     * 势力实体→Markdown。
     *
     * @param faction - 势力
     * @returns Markdown
     */
    static factionToMarkdown(faction: Faction): string {
        const domainModel = EntityFactory.factionToDomainModel(faction);
        const fm = factionToFrontmatter(domainModel);
        const fmStr = FrontmatterSerializer.serialize(Frontmatter.from(fm));
        const body = faction.body || `# ${faction.name}\n`;
        return `${fmStr}\n${body}`;
    }

    private static factionFromDomainModel(model: FactionDomainModel): Faction {
        const props: FactionProps = {
            id: model.id,
            name: model.name,
            filePath: model.filePath,
            tags: model.tags,
            entityStatus: model.entityStatus ? EntityStatus.from(model.entityStatus) : null,
            createdAt: model.createdAt ?? null,
            lastChangedAt: model.lastChangedAt ?? null,
            lastChangedReason: model.lastChangedReason ?? null,
            frontmatter: Frontmatter.from(model.frontmatter),
            body: model.body,
            content: model.content,
            alias: model.alias,
            type: model.type,
            description: model.description,
            leader: model.leader,
            rank: model.rank,
        };
        return Faction.from(props);
    }

    private static factionToDomainModel(faction: Faction): FactionDomainModel {
        const fm = faction.frontmatter.toObject();
        return {
            id: faction.id,
            name: faction.name,
            filePath: faction.filePath,
            category: 'faction',
            tags: faction.tags,
            entityStatus: faction.entityStatus?.toLegacyType(),
            createdAt: faction.createdAt ?? undefined,
            lastChangedAt: faction.lastChangedAt ?? undefined,
            lastChangedReason: faction.lastChangedReason ?? undefined,
            frontmatter: fm,
            body: faction.body,
            content: faction.content,
            alias: (faction as any).alias,
            type: (faction as any).type,
            description: (faction as any).description,
            leader: (faction as any).leader,
            rank: (faction as any).rank,
        };
    }

    // ============================================================
    // Location
    // ============================================================

    /**
     * 地点 Markdown→实体。
     *
     * @param content - 内容
     * @param filePath - 文件路径
     * @returns 地点
     */
    static locationFromMarkdown(content: string, filePath: string = ''): Location {
        const domainModel = locationFromMarkdown(content, filePath);
        return EntityFactory.locationFromDomainModel(domainModel);
    }

    /**
     * 地点实体→Markdown。
     *
     * @param location - 地点
     * @returns Markdown
     */
    static locationToMarkdown(location: Location): string {
        const domainModel = EntityFactory.locationToDomainModel(location);
        const fm = locationToFrontmatter(domainModel);
        const fmStr = FrontmatterSerializer.serialize(Frontmatter.from(fm));
        const body = location.body || `# ${location.name}\n`;
        return `${fmStr}\n${body}`;
    }

    private static locationFromDomainModel(model: LocationDomainModel): Location {
        const props: LocationProps = {
            id: model.id,
            name: model.name,
            filePath: model.filePath,
            tags: model.tags,
            entityStatus: model.entityStatus ? EntityStatus.from(model.entityStatus) : null,
            createdAt: model.createdAt ?? null,
            lastChangedAt: model.lastChangedAt ?? null,
            lastChangedReason: model.lastChangedReason ?? null,
            frontmatter: Frontmatter.from(model.frontmatter),
            body: model.body,
            content: model.content,
            alias: model.alias,
            type: model.type,
            description: model.description,
            importance: model.importance,
            geography: model.geography,
            inhabitants: model.inhabitants,
            worldRegion: model.worldRegion,
        };
        return Location.from(props);
    }

    private static locationToDomainModel(location: Location): LocationDomainModel {
        const fm = location.frontmatter.toObject();
        return {
            id: location.id,
            name: location.name,
            filePath: location.filePath,
            category: 'location',
            tags: location.tags,
            entityStatus: location.entityStatus?.toLegacyType(),
            createdAt: location.createdAt ?? undefined,
            lastChangedAt: location.lastChangedAt ?? undefined,
            lastChangedReason: location.lastChangedReason ?? undefined,
            frontmatter: fm,
            body: location.body,
            content: location.content,
            alias: (location as any).alias,
            type: (location as any).type,
            description: (location as any).description,
            importance: (location as any).importance,
            geography: (location as any).geography,
            inhabitants: (location as any).inhabitants,
            worldRegion: (location as any).worldRegion,
        };
    }

    // ============================================================
    // Item
    // ============================================================

    /**
     * 物品 Markdown→实体。
     *
     * @param content - 内容
     * @param filePath - 文件路径
     * @returns 物品
     */
    static itemFromMarkdown(content: string, filePath: string = ''): Item {
        const domainModel = itemFromMarkdown(content, filePath);
        return EntityFactory.itemFromDomainModel(domainModel);
    }

    /**
     * 物品实体→Markdown。
     *
     * @param item - 条目
     * @returns Markdown
     */
    static itemToMarkdown(item: Item): string {
        const domainModel = EntityFactory.itemToDomainModel(item);
        const fm = itemToFrontmatter(domainModel);
        const fmStr = FrontmatterSerializer.serialize(Frontmatter.from(fm));
        const body = item.body || `# ${item.name}\n`;
        return `${fmStr}\n${body}`;
    }

    private static itemFromDomainModel(model: ItemDomainModel): Item {
        const props: ItemProps = {
            id: model.id,
            name: model.name,
            filePath: model.filePath,
            tags: model.tags,
            entityStatus: model.entityStatus ? EntityStatus.from(model.entityStatus) : null,
            createdAt: model.createdAt ?? null,
            lastChangedAt: model.lastChangedAt ?? null,
            lastChangedReason: model.lastChangedReason ?? null,
            frontmatter: Frontmatter.from(model.frontmatter),
            body: model.body,
            content: model.content,
            type: model.type,
            grade: model.grade,
            description: model.description,
            effect: model.effect,
            owner: model.owner,
        };
        return Item.from(props);
    }

    private static itemToDomainModel(item: Item): ItemDomainModel {
        const fm = item.frontmatter.toObject();
        return {
            id: item.id,
            name: item.name,
            filePath: item.filePath,
            category: 'item',
            tags: item.tags,
            entityStatus: item.entityStatus?.toLegacyType(),
            createdAt: item.createdAt ?? undefined,
            lastChangedAt: item.lastChangedAt ?? undefined,
            lastChangedReason: item.lastChangedReason ?? undefined,
            frontmatter: fm,
            body: item.body,
            content: item.content,
            type: (item as any).type,
            grade: (item as any).grade,
            description: (item as any).description,
            effect: (item as any).effect,
            owner: (item as any).owner,
        };
    }

    // ============================================================
    // Chapter
    // ============================================================

    /**
     * 章节 Markdown→实体。
     *
     * @param content - 内容
     * @param filePath - 文件路径
     * @returns 章节
     */
    static chapterFromMarkdown(content: string, filePath: string = ''): Chapter {
        const { frontmatter, body } = FrontmatterSerializer.parse(content);
        const fm = frontmatter.toObject();
        const parsedContent = parseMarkdownContent(body);

        const volume = parseInt(String(fm['卷'] || fm['volume'] || '0'), 10);
        const chapter = parseInt(String(fm['章'] || fm['chapter'] || '0'), 10);
        const title = fm['标题'] || fm['title'] || '';
        const status = ChapterStatus.from(fm['status'] || fm['状态']);
        const writingMode = (fm['writing_mode'] || fm['写作模式']) as WritingMode | undefined;
        const wordCount = WordCount.create(
            parseInt(String(fm['word_count'] || fm['字数'] || '0'), 10),
            parseInt(String(fm['total_words'] || '0'), 10),
            0,
        );

        const charsRaw = fm['涉及人物'] || fm['characters'];
        const locsRaw = fm['涉及地点'] || fm['locations'];
        const factionsRaw = fm['涉及势力'] || fm['factions'];
        const itemsRaw = fm['涉及物品功法'] || fm['items'];

        const toArray = (v: any): string[] => {
            if (!v) return [];
            if (Array.isArray(v)) return v.filter(Boolean);
            if (typeof v === 'string') return v.split(',').map(s => s.trim()).filter(Boolean);
            return [];
        };

        const id = filePath ? filePath.replace(/\.md$/, '').split(/[\\/]/).pop() || title : title;

        const props: ChapterProps = {
            id,
            name: title,
            filePath,
            tags: frontmatter.getTags(),
            entityStatus: EntityStatus.ACTIVE,
            createdAt: fm['created_at'] || null,
            lastChangedAt: fm['updated_at'] || null,
            lastChangedReason: null,
            frontmatter,
            body,
            content: parsedContent,
            chapterMeta: {
                volume,
                chapter,
                title,
                status,
                writingMode,
                wordCount: WordCount.fromText(body),
                characters: toArray(charsRaw),
                locations: toArray(locsRaw),
                factions: toArray(factionsRaw),
                items: toArray(itemsRaw),
                reviewTime: fm['审查时间'] || fm['review_time'],
                scenes: fm['scenes'] || [],
            },
        };

        return Chapter.from(props);
    }

    /**
     * 章节实体→Markdown。
     *
     * @param chapter - 章节
     * @returns Markdown
     */
    static chapterToMarkdown(chapter: Chapter): string {
        const fm: Record<string, any> = {
            '卷': chapter.volume,
            '章': chapter.chapterNum,
            '标题': chapter.title,
            'status': chapter.status.toString(),
            'word_count': chapter.wordCount.chinese,
            '涉及人物': chapter.characters.length ? chapter.characters : undefined,
            '涉及地点': chapter.locations.length ? chapter.locations : undefined,
            '涉及势力': chapter.factions.length ? chapter.factions : undefined,
            '涉及物品功法': chapter.items.length ? chapter.items : undefined,
            tags: chapter.tags.length ? chapter.tags : undefined,
        };

        if (chapter.writingMode) {
            fm['writing_mode'] = chapter.writingMode;
        }

        const frontmatter = Frontmatter.from(fm);
        const fmStr = FrontmatterSerializer.serialize(frontmatter);
        const body = chapter.body || '';
        return `${fmStr}\n${body}`;
    }

    // ============================================================
    // Project
    // ============================================================

    /**
     * 项目 Markdown→实体。
     *
     * @param content - 内容
     * @param filePath - 文件路径
     * @returns 项目
     */
    static projectFromMarkdown(content: string, filePath: string = ''): Project {
        const fm = parseFrontmatter(content);
        const body = content.replace(/^---\n[\s\S]*?\n---\n?/, '').trim();

        const name = fm['name'] || fm['项目名'] || '未命名项目';
        const id = filePath ? filePath.replace(/\/\.project$/, '').split(/[\\/]/).pop() || name : name;

        const projectMeta = {
            name,
            genre: fm['genre'] || fm['题材'],
            type: fm['type'] || fm['类型'],
            description: fm['description'] || fm['简介'],
            author: fm['author'] || fm['作者'],
            targetWordCount: fm['target_word_count'] ? parseInt(String(fm['target_word_count']), 10) : undefined,
            currentVolume: fm['current_volume'] ? parseInt(String(fm['current_volume']), 10) : undefined,
            currentChapter: fm['current_chapter'] ? parseInt(String(fm['current_chapter']), 10) : undefined,
            writingMode: fm['writing_mode'] || fm['写作模式'],
            createdAt: fm['created_at'] || fm['创建时间'],
            updatedAt: fm['updated_at'] || fm['更新时间'],
        };

        return Project.create(id, name, filePath, projectMeta);
    }

    /**
     * 项目实体→Markdown。
     *
     * @param project - 项目（路径或对象）
     * @returns Markdown
     */
    static projectToMarkdown(project: Project): string {
        const meta = project.projectMeta;
        const lines: string[] = ['---'];

        if (meta.name) lines.push(`name: ${meta.name}`);
        if (meta.genre) lines.push(`genre: ${meta.genre}`);
        if (meta.type) lines.push(`type: ${meta.type}`);
        if (meta.author) lines.push(`author: ${meta.author}`);
        if (meta.targetWordCount) lines.push(`target_word_count: ${meta.targetWordCount}`);
        if (meta.currentVolume !== undefined) lines.push(`current_volume: ${meta.currentVolume}`);
        if (meta.currentChapter !== undefined) lines.push(`current_chapter: ${meta.currentChapter}`);
        if (meta.writingMode) lines.push(`writing_mode: ${meta.writingMode}`);
        if (meta.createdAt) lines.push(`created_at: ${meta.createdAt}`);
        if (meta.updatedAt) lines.push(`updated_at: ${meta.updatedAt}`);

        lines.push('---');
        lines.push('');
        if (meta.description) {
            lines.push(`# ${meta.name}`);
            lines.push('');
            lines.push(meta.description);
        }

        return lines.join('\n');
    }
}
