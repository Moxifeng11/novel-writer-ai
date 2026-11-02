/**
 * domain/aggregates/chapter-aggregate.ts — 章节聚合根
 *
 * 章节聚合根，包含章节正文、frontmatter、字数统计、状态等。
 */

import { BaseEntity, type BaseEntityProps } from './base-entity';
import { ChapterStatus, EntityStatus, Frontmatter, WordCount } from '../value-objects';
import type { EntityCategory } from './base-entity';
import type { WritingMode, SceneNode } from '../../../../shared/types';

/**
 * 章节元数据
 */
export interface ChapterMeta {
    /** 卷号 */
    volume: number;
    /** 章号 */
    chapter: number;
    /** 章节标题 */
    title: string;
    /** 章节状态 */
    status: ChapterStatus;
    /** 写作模式 */
    writingMode?: WritingMode;
    /** 字数统计 */
    wordCount: WordCount;
    /** 涉及人物 */
    characters: string[];
    /** 涉及地点 */
    locations: string[];
    /** 涉及势力 */
    factions: string[];
    /** 涉及物品功法 */
    items: string[];
    /** 审查时间 */
    reviewTime?: string;
    /** 场景列表 */
    scenes: SceneNode[];
}

/**
 * Chapter 聚合根属性
 */
export interface ChapterProps extends BaseEntityProps {
    /** 章节元数据 */
    chapterMeta: ChapterMeta;
}

/**
 * 章节聚合根
 */
export class Chapter extends BaseEntity {
    private readonly _chapterMeta: ChapterMeta;

    private constructor(props: ChapterProps) {
        super(props);
        this._chapterMeta = {
            ...props.chapterMeta,
            characters: [...props.chapterMeta.characters],
            locations: [...props.chapterMeta.locations],
            factions: [...props.chapterMeta.factions],
            items: [...props.chapterMeta.items],
            scenes: [...props.chapterMeta.scenes],
        };
    }

    get category(): EntityCategory {
        return 'chapter';
    }

    /**
     * 卷号
     *
     * @returns 数值结果
     */
    get volume(): number {
        return this._chapterMeta.volume;
    }

    /**
     * 章号
     *
     * @returns 数值结果
     */
    get chapterNum(): number {
        return this._chapterMeta.chapter;
    }

    /**
     * 章节标题
     *
     * @returns 文本结果
     */
    get title(): string {
        return this._chapterMeta.title;
    }

    /**
     * 章节状态
     *
      * @returns ChapterStatus 实例
     */
    get status(): ChapterStatus {
        return this._chapterMeta.status;
    }

    /**
     * 写作模式
     *
      * @returns WritingMode 或 undefined
     */
    get writingMode(): WritingMode | undefined {
        return this._chapterMeta.writingMode;
    }

    /**
     * 字数统计
     *
      * @returns WordCount 实例
     */
    get wordCount(): WordCount {
        return this._chapterMeta.wordCount;
    }

    /**
     * 涉及人物列表
     *
     * @returns 结果数组
     */
    get characters(): string[] {
        return [...this._chapterMeta.characters];
    }

    /**
     * 涉及地点列表
     *
     * @returns 结果数组
     */
    get locations(): string[] {
        return [...this._chapterMeta.locations];
    }

    /**
     * 涉及势力列表
     *
     * @returns 结果数组
     */
    get factions(): string[] {
        return [...this._chapterMeta.factions];
    }

    /**
     * 涉及物品功法列表
     *
     * @returns 结果数组
     */
    get items(): string[] {
        return [...this._chapterMeta.items];
    }

    /**
     * 场景列表
     *
     * @returns 结果数组
     */
    get scenes(): SceneNode[] {
        return [...this._chapterMeta.scenes];
    }

    /**
     * 创建新的 Chapter 实例
     * @param id - 标识
     * @param title - 标题
     * @param volume - 卷
     * @param chapter - 章节
     * @param filePath - 文件路径
     * @param body - 正文
      * @returns Chapter 实例
     */
    static create(
        id: string,
        title: string,
        volume: number,
        chapter: number,
        filePath: string,
        body: string = '',
    ): Chapter {
        const wordCount = WordCount.fromText(body);
        return new Chapter({
            id,
            name: title,
            filePath,
            tags: [],
            entityStatus: EntityStatus.ACTIVE,
            createdAt: new Date().toISOString(),
            lastChangedAt: new Date().toISOString(),
            lastChangedReason: null,
            frontmatter: Frontmatter.empty(),
            body,
            content: null,
            chapterMeta: {
                volume,
                chapter,
                title,
                status: ChapterStatus.PENDING,
                wordCount,
                characters: [],
                locations: [],
                factions: [],
                items: [],
                scenes: [],
            },
        });
    }

    /**
     * 从原始数据创建 Chapter
     * @param props - 属性表
      * @returns Chapter 实例
     */
    static from(props: Omit<ChapterProps, 'category'>): Chapter {
        return new Chapter(props);
    }

    withStatus(status: EntityStatus): Chapter {
        return new Chapter({
            ...this._props,
            entityStatus: status,
            chapterMeta: this._chapterMeta,
        });
    }

    withName(name: string): Chapter {
        return new Chapter({
            ...this._props,
            name,
            chapterMeta: {
                ...this._chapterMeta,
                title: name,
            },
        });
    }

    /**
     * 更新章节状态
     * @param status - 状态
      * @returns Chapter 实例
     */
    withChapterStatus(status: ChapterStatus): Chapter {
        return new Chapter({
            ...this._props,
            lastChangedAt: new Date().toISOString(),
            chapterMeta: {
                ...this._chapterMeta,
                status,
            },
        });
    }

    /**
     * 更新正文内容（自动重新统计字数）
     * @param body - 正文
      * @returns Chapter 实例
     */
    withBody(body: string): Chapter {
        const wordCount = WordCount.fromText(body);
        return new Chapter({
            ...this._props,
            body,
            lastChangedAt: new Date().toISOString(),
            chapterMeta: {
                ...this._chapterMeta,
                wordCount,
            },
        });
    }

    /**
     * 添加涉及人物
     * @param name - 名称
      * @returns Chapter 实例
     */
    addCharacter(name: string): Chapter {
        if (!name || this._chapterMeta.characters.includes(name)) {
            return this;
        }
        return new Chapter({
            ...this._props,
            chapterMeta: {
                ...this._chapterMeta,
                characters: [...this._chapterMeta.characters, name],
            },
        });
    }

    /**
     * 移除涉及人物
     * @param name - 名称
      * @returns Chapter 实例
     */
    removeCharacter(name: string): Chapter {
        return new Chapter({
            ...this._props,
            chapterMeta: {
                ...this._chapterMeta,
                characters: this._chapterMeta.characters.filter(c => c !== name),
            },
        });
    }

    /**
     * 添加场景
     * @param scene - 场景
      * @returns Chapter 实例
     */
    addScene(scene: SceneNode): Chapter {
        const existingScene = this._chapterMeta.scenes.find(s => s.id === scene.id);
        if (existingScene) {
            return this.updateScene(scene);
        }
        return new Chapter({
            ...this._props,
            lastChangedAt: new Date().toISOString(),
            chapterMeta: {
                ...this._chapterMeta,
                scenes: [...this._chapterMeta.scenes, scene],
            },
        });
    }

    /**
     * 更新场景
     * @param scene - 场景
      * @returns Chapter 实例
     */
    updateScene(scene: SceneNode): Chapter {
        return new Chapter({
            ...this._props,
            lastChangedAt: new Date().toISOString(),
            chapterMeta: {
                ...this._chapterMeta,
                scenes: this._chapterMeta.scenes.map(s => s.id === scene.id ? scene : s),
            },
        });
    }

    /**
     * 移除场景
     * @param sceneId - 场景ID
      * @returns Chapter 实例
     */
    removeScene(sceneId: string): Chapter {
        return new Chapter({
            ...this._props,
            lastChangedAt: new Date().toISOString(),
            chapterMeta: {
                ...this._chapterMeta,
                scenes: this._chapterMeta.scenes.filter(s => s.id !== sceneId),
            },
        });
    }

    /**
     * 重新排序场景
     * @param sceneIds - 场景 ID 列表
      * @returns Chapter 实例
     */
    reorderScenes(sceneIds: string[]): Chapter {
        const scenesMap = new Map(this._chapterMeta.scenes.map(s => [s.id, s]));
        const reordered = sceneIds.map(id => scenesMap.get(id)).filter(Boolean) as SceneNode[];
        const remaining = this._chapterMeta.scenes.filter(s => !sceneIds.includes(s.id));
        return new Chapter({
            ...this._props,
            lastChangedAt: new Date().toISOString(),
            chapterMeta: {
                ...this._chapterMeta,
                scenes: [...reordered, ...remaining].map((s, i) => ({ ...s, order: i + 1 })),
            },
        });
    }

    toJSON(): Record<string, any> {
        return {
            ...super.toJSON(),
            chapterMeta: {
                ...this._chapterMeta,
                characters: [...this._chapterMeta.characters],
                locations: [...this._chapterMeta.locations],
                factions: [...this._chapterMeta.factions],
                items: [...this._chapterMeta.items],
                scenes: [...this._chapterMeta.scenes],
                wordCount: this._chapterMeta.wordCount.toJSON(),
                status: this._chapterMeta.status.toJSON(),
            },
        };
    }
}
