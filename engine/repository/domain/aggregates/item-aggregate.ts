/**
 * domain/aggregates/item-aggregate.ts — 物品功法聚合根
 */

import { BaseEntity, type BaseEntityProps } from './base-entity';
import { EntityStatus, Frontmatter } from '../value-objects';
import type { EntityCategory } from './base-entity';

export interface ItemProps extends BaseEntityProps {
    type?: string;
    grade?: string;
    description?: string;
    effect?: string;
    owner?: string;
}

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

    static from(props: ItemProps): Item {
        return new Item(props);
    }

    withStatus(status: EntityStatus): Item {
        return new Item({
            ...this._props,
            ...this._itemProps,
            entityStatus: status,
        } as ItemProps);
    }

    withName(name: string): Item {
        return new Item({
            ...this._props,
            ...this._itemProps,
            name,
        } as ItemProps);
    }

    withOwner(owner: string): Item {
        return new Item({
            ...this._props,
            ...this._itemProps,
            owner,
            lastChangedAt: new Date().toISOString(),
        } as ItemProps);
    }

    toJSON(): Record<string, any> {
        return {
            ...super.toJSON(),
            ...this._itemProps,
        };
    }
}
