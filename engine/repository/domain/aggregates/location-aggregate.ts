/**
 * domain/aggregates/location-aggregate.ts — 地点聚合根
 */

import { BaseEntity, type BaseEntityProps } from './base-entity';
import { EntityStatus, Frontmatter } from '../value-objects';
import type { EntityCategory } from './base-entity';

/**
 * LocationProps 类型定义。
 */
export interface LocationProps extends BaseEntityProps {
    alias?: string;
    type?: string;
    description?: string;
    importance?: string;
    geography?: string;
    inhabitants?: string;
    worldRegion?: string;
}

/**
 * 地点。
 */
export class Location extends BaseEntity {
    private readonly _locationProps: Omit<LocationProps, keyof BaseEntityProps>;

    private constructor(props: LocationProps) {
        super(props);
        const { id, name, filePath, tags, entityStatus, createdAt, lastChangedAt, lastChangedReason, frontmatter, body, content, ...rest } = props;
        this._locationProps = { ...rest };
    }

    get category(): EntityCategory {
        return 'location';
    }

    get alias(): string | undefined { return this._locationProps.alias; }
    get type(): string | undefined { return this._locationProps.type; }
    get description(): string | undefined { return this._locationProps.description; }
    get importance(): string | undefined { return this._locationProps.importance; }
    get geography(): string | undefined { return this._locationProps.geography; }
    get inhabitants(): string | undefined { return this._locationProps.inhabitants; }
    get worldRegion(): string | undefined { return this._locationProps.worldRegion; }

    /**
     * 创建。
     * @param id - 标识
     * @param name - 名称
     * @param filePath - 文件路径
      * @returns Location 实例
     */
    static create(id: string, name: string, filePath: string): Location {
        return new Location({
            id,
            name,
            filePath,
            tags: [],
            entityStatus: EntityStatus.ACTIVE,
            createdAt: new Date().toISOString(),
            lastChangedAt: new Date().toISOString(),
            lastChangedReason: null,
            frontmatter: Frontmatter.empty(),
            body: '',
            content: null,
        });
    }

    /**
     * 从。
     * @param props - 属性表
      * @returns Location 实例
     */
    static from(props: LocationProps): Location {
        return new Location(props);
    }

    /**
     * 带状态。
     * @param status - 状态
      * @returns Location 实例
     */
    withStatus(status: EntityStatus): Location {
        return new Location({
            ...this._props,
            ...this._locationProps,
            entityStatus: status,
        } as LocationProps);
    }

    /**
     * 带名称。
     * @param name - 名称
      * @returns Location 实例
     */
    withName(name: string): Location {
        return new Location({
            ...this._props,
            ...this._locationProps,
            name,
        } as LocationProps);
    }

    /**
     * 转换为JSON。
     * @returns 映射结果
     */
    toJSON(): Record<string, any> {
        return {
            ...super.toJSON(),
            ...this._locationProps,
        };
    }
}
