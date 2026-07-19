/**
 * domain/aggregates/base-entity.ts — 实体基类
 *
 * 所有聚合根的公共基类，提供统一的基础字段和方法。
 * 与 shared/entity-models.ts 中的 BaseEntity 接口保持兼容。
 */

import { EntityStatus, Frontmatter } from '../value-objects';
import type { MarkdownContent } from '../../../../shared/frontmatter';

/**
 * 实体分类
 */
export type EntityCategory = 'project' | 'chapter' | 'character' | 'faction' | 'location' | 'item';

/**
 * 基础实体属性
 */
export interface BaseEntityProps {
    /** 实体唯一标识 */
    id: string;
    /** 实体显示名称 */
    name: string;
    /** 文件路径（相对于 vault 根目录） */
    filePath: string;
    /** 标签数组 */
    tags: string[];
    /** 实体状态 */
    entityStatus: EntityStatus | null;
    /** 创建时间（ISO 字符串） */
    createdAt: string | null;
    /** 最后变更时间 */
    lastChangedAt: string | null;
    /** 最后变更原因 */
    lastChangedReason: string | null;
    /** 原始 frontmatter */
    frontmatter: Frontmatter;
    /** 原始 Markdown 正文内容（不含 frontmatter） */
    body: string;
    /** 完整 Markdown 内容结构（已分节） */
    content: MarkdownContent | null;
}

/**
 * 实体基类
 * 所有聚合根继承此类，提供统一的基础字段和方法
 */
export abstract class BaseEntity {
    protected readonly _props: BaseEntityProps;

    protected constructor(props: BaseEntityProps) {
        this._props = { ...props };
    }

    /** 实体唯一标识 */
    get id(): string {
        return this._props.id;
    }

    /** 实体显示名称 */
    get name(): string {
        return this._props.name;
    }

    /** 文件路径（相对于 vault 根目录） */
    get filePath(): string {
        return this._props.filePath;
    }

    /** 标签数组 */
    get tags(): string[] {
        return [...this._props.tags];
    }

    /** 实体状态 */
    get entityStatus(): EntityStatus | null {
        return this._props.entityStatus;
    }

    /** 创建时间（ISO 字符串） */
    get createdAt(): string | null {
        return this._props.createdAt;
    }

    /** 最后变更时间 */
    get lastChangedAt(): string | null {
        return this._props.lastChangedAt;
    }

    /** 最后变更原因 */
    get lastChangedReason(): string | null {
        return this._props.lastChangedReason;
    }

    /** 原始 frontmatter */
    get frontmatter(): Frontmatter {
        return this._props.frontmatter;
    }

    /** 原始 Markdown 正文内容（不含 frontmatter） */
    get body(): string {
        return this._props.body;
    }

    /** 完整 Markdown 内容结构（已分节） */
    get content(): MarkdownContent | null {
        return this._props.content;
    }

    /** 获取实体分类 */
    abstract get category(): EntityCategory;

    /**
     * 更新实体状态
     * 返回新的实体（不可变模式）—— 具体实现由子类提供
     */
    abstract withStatus(status: EntityStatus): BaseEntity;

    /**
     * 更新名称
     */
    abstract withName(name: string): BaseEntity;

    /**
     * 添加标签
     */
    addTag(tag: string): string[] {
        if (!tag || this._props.tags.includes(tag)) {
            return [...this._props.tags];
        }
        return [...this._props.tags, tag];
    }

    /**
     * 移除标签
     */
    removeTag(tag: string): string[] {
        return this._props.tags.filter(t => t !== tag);
    }

    /**
     * 检查是否有指定标签
     */
    hasTag(tag: string): boolean {
        return this._props.tags.includes(tag);
    }

    /**
     * 转换为普通对象（用于序列化）
     */
    toJSON(): Record<string, any> {
        return {
            id: this._props.id,
            name: this._props.name,
            filePath: this._props.filePath,
            tags: [...this._props.tags],
            entityStatus: this._props.entityStatus?.toJSON() ?? null,
            createdAt: this._props.createdAt,
            lastChangedAt: this._props.lastChangedAt,
            lastChangedReason: this._props.lastChangedReason,
            frontmatter: this._props.frontmatter.toJSON(),
            body: this._props.body,
            content: this._props.content,
            category: this.category,
        };
    }

    /**
     * 基于 ID 的相等性判断
     */
    equals(other: BaseEntity): boolean {
        return this.id === other.id && this.category === other.category;
    }
}
