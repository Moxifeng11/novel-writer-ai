/**
 * domain/aggregates/location-aggregate.ts — 地点聚合根
 */

import { BaseEntity, type BaseEntityProps } from './base-entity';
import { EntityStatus, Frontmatter } from '../value-objects';
import type { EntityCategory } from './base-entity';

export interface LocationProps extends BaseEntityProps {
    alias?: string;
    type?: string;
    description?: string;
    importance?: string;
    geography?: string;
    inhabitants?: string;
    worldRegion?: string;
}

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

    static from(props: LocationProps): Location {
        return new Location(props);
    }

    withStatus(status: EntityStatus): Location {
        return new Location({
            ...this._props,
            ...this._locationProps,
            entityStatus: status,
        } as LocationProps);
    }

    withName(name: string): Location {
        return new Location({
            ...this._props,
            ...this._locationProps,
            name,
        } as LocationProps);
    }

    toJSON(): Record<string, any> {
        return {
            ...super.toJSON(),
            ...this._locationProps,
        };
    }
}
