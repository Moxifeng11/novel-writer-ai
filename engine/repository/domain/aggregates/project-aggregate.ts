/**
 * domain/aggregates/project-aggregate.ts — 项目聚合根
 *
 * 项目聚合根，管理项目元数据。
 * 项目元数据存储在 .project 文件中。
 */

import { BaseEntity, type BaseEntityProps } from './base-entity';
import { Frontmatter, EntityStatus } from '@/engine/repository/domain/value-objects';
import type { EntityCategory } from './base-entity';

/**
 * 项目元数据字段
 */
export interface ProjectMeta {
    /** 项目名称 */
    name: string;
    /** 题材 */
    genre?: string;
    /** 类型 */
    type?: string;
    /** 简介 */
    description?: string;
    /** 作者 */
    author?: string;
    /** 总字数目标 */
    targetWordCount?: number;
    /** 当前卷数 */
    currentVolume?: number;
    /** 当前章数 */
    currentChapter?: number;
    /** 写作模式 */
    writingMode?: string;
    /** 创建时间 */
    createdAt?: string;
    /** 最后更新时间 */
    updatedAt?: string;
    /** 自定义字段 */
    customFields?: Record<string, string>;
}

/**
 * Project 聚合根属性
 */
export interface ProjectProps extends BaseEntityProps {
    /** 项目元数据 */
    projectMeta: ProjectMeta;
}

/**
 * 项目聚合根
 */
export class Project extends BaseEntity {
    private readonly _projectMeta: ProjectMeta;

    private constructor(props: ProjectProps) {
        super(props);
        this._projectMeta = { ...props.projectMeta };
    }

    get category(): EntityCategory {
        return 'project';
    }

    /**
     * 项目元数据
     *
      * @returns ProjectMeta 实例
     */
    get projectMeta(): ProjectMeta {
        return { ...this._projectMeta };
    }

    /**
     * 题材
     *
      * @returns 文本结果 或 undefined
     */
    get genre(): string | undefined {
        return this._projectMeta.genre;
    }

    /**
     * 类型
     *
      * @returns 文本结果 或 undefined
     */
    get type(): string | undefined {
        return this._projectMeta.type;
    }

    /**
     * 简介
     *
      * @returns 文本结果 或 undefined
     */
    get description(): string | undefined {
        return this._projectMeta.description;
    }

    /**
     * 作者
     *
      * @returns 文本结果 或 undefined
     */
    get author(): string | undefined {
        return this._projectMeta.author;
    }

    /**
     * 目标字数
     *
      * @returns 数值结果 或 undefined
     */
    get targetWordCount(): number | undefined {
        return this._projectMeta.targetWordCount;
    }

    /**
     * 创建新的 Project 实例
     * @param id - 标识
     * @param name - 名称
     * @param filePath - 文件路径
     * @param meta - 元数据
      * @returns Project 实例
     */
    static create(id: string, name: string, filePath: string, meta: Partial<ProjectMeta> = {}): Project {
        const now = new Date().toISOString();
        return new Project({
            id,
            name,
            filePath,
            tags: [],
            entityStatus: EntityStatus.ACTIVE,
            createdAt: meta.createdAt || now,
            lastChangedAt: now,
            lastChangedReason: null,
            frontmatter: Frontmatter.empty(),
            body: '',
            content: null,
            projectMeta: {
                name,
                ...meta,
            },
        });
    }

    /**
     * 从原始数据创建 Project
     * @param props - 属性表
      * @returns Project 实例
     */
    static from(props: Omit<ProjectProps, 'category'>): Project {
        return new Project(props);
    }

    /**
     * 带状态。
     * @param status - 状态
      * @returns Project 实例
     */
    withStatus(status: EntityStatus): Project {
        return new Project({
            ...this._props,
            entityStatus: status,
            projectMeta: this._projectMeta,
        });
    }

    /**
     * 带名称。
     * @param name - 名称
      * @returns Project 实例
     */
    withName(name: string): Project {
        return new Project({
            ...this._props,
            name,
            projectMeta: {
                ...this._projectMeta,
                name,
            },
        });
    }

    /**
     * 更新项目元数据
     * @param meta - 元数据
      * @returns Project 实例
     */
    withMeta(meta: Partial<ProjectMeta>): Project {
        return new Project({
            ...this._props,
            lastChangedAt: new Date().toISOString(),
            projectMeta: {
                ...this._projectMeta,
                ...meta,
            },
        });
    }

    /**
     * 转换为JSON。
     * @returns 映射结果
     */
    toJSON(): Record<string, any> {
        return {
            ...super.toJSON(),
            projectMeta: { ...this._projectMeta },
        };
    }
}
