/**
 * domain/aggregates/item-aggregate.ts — 物品功法聚合根
 */

import { BaseEntity, type BaseEntityProps } from './base-entity';
import { EntityStatus, Frontmatter } from '../value-objects';
import type { EntityCategory } from './base-entity';

/**
 * ItemProps 类型定义。
 */
export interface ItemProps extends BaseEntityProps {
    type?: string;
    grade?: string;
    description?: string;
    effect?: string;
    owner?: string;
}

/**
 * 条目。
 */
export class Item extends BaseEntity {
    private readonly _itemProps: Omit<ItemProps, keyof BaseEntityProps>;

    private constructor(props: ItemProps) {
        super(props);
        const { id, name, filePath, tags, entityStatus, createdAt, lastChangedAt, lastChangedReason, frontmatter, body, content, ...rest } = props;
        this._itemProps = { ...rest };
    }

    get category(): EntityCategory {
        return 'item';
    }

    get type(): string | undefined { return this._itemProps.type; }
    get grade(): string | undefined { return this._itemProps.grade; }
    get description(): string | undefined { return this._itemProps.description; }
    get effect(): string | undefined { return this._itemProps.effect; }
    get owner(): string | undefined { return this._itemProps.owner; }

    /**
     * 创建。
     * @param id - 标识
     * @param name - 名称
     * @param filePath - 文件路径
      * @returns Item 实例
     */
    static create(id: string, name: string, filePath: string): Item {
        return new Item({
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
      * @returns Item 实例
     */
    static from(props: ItemProps): Item {
        return new Item(props);
    }

    /**
     * 带状态。
     * @param status - 状态
      * @returns Item 实例
     */
    withStatus(status: EntityStatus): Item {
        return new Item({
            ...this._props,
            ...this._itemProps,
            entityStatus: status,
        } as ItemProps);
    }

    /**
     * 带名称。
     * @param name - 名称
      * @returns Item 实例
     */
    withName(name: string): Item {
        return new Item({
            ...this._props,
            ...this._itemProps,
            name,
        } as ItemProps);
    }

    /**
     * 带所有者。
     * @param owner - 所有者
      * @returns Item 实例
     */
    withOwner(owner: string): Item {
        return new Item({
            ...this._props,
            ...this._itemProps,
            owner,
            lastChangedAt: new Date().toISOString(),
        } as ItemProps);
    }

    /**
     * 转换为JSON。
     * @returns 映射结果
     */
    toJSON(): Record<string, any> {
        return {
            ...super.toJSON(),
            ...this._itemProps,
        };
    }
}
