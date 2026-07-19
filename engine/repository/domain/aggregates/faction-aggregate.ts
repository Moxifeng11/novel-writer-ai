/**
 * domain/aggregates/faction-aggregate.ts — 势力聚合根
 */

import { BaseEntity, type BaseEntityProps } from './base-entity';
import { EntityStatus, Frontmatter } from '../value-objects';
import type { EntityCategory } from './base-entity';

export interface FactionProps extends BaseEntityProps {
    alias?: string;
    type?: string;
    description?: string;
    leader?: string;
    rank?: string;
}

export class Faction extends BaseEntity {
    private readonly _factionProps: Omit<FactionProps, keyof BaseEntityProps>;

    private constructor(props: FactionProps) {
        super(props);
        const { id, name, filePath, tags, entityStatus, createdAt, lastChangedAt, lastChangedReason, frontmatter, body, content, ...rest } = props;
        this._factionProps = { ...rest };
    }

    get category(): EntityCategory {
        return 'faction';
    }

    get alias(): string | undefined { return this._factionProps.alias; }
    get type(): string | undefined { return this._factionProps.type; }
    get description(): string | undefined { return this._factionProps.description; }
    get leader(): string | undefined { return this._factionProps.leader; }
    get rank(): string | undefined { return this._factionProps.rank; }

    static create(id: string, name: string, filePath: string): Faction {
        return new Faction({
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

    static from(props: FactionProps): Faction {
        return new Faction(props);
    }

    withStatus(status: EntityStatus): Faction {
        return new Faction({
            ...this._props,
            ...this._factionProps,
            entityStatus: status,
        } as FactionProps);
    }

    withName(name: string): Faction {
        return new Faction({
            ...this._props,
            ...this._factionProps,
            name,
        } as FactionProps);
    }

    withLeader(leader: string): Faction {
        return new Faction({
            ...this._props,
            ...this._factionProps,
            leader,
            lastChangedAt: new Date().toISOString(),
        } as FactionProps);
    }

    toJSON(): Record<string, any> {
        return {
            ...super.toJSON(),
            ...this._factionProps,
        };
    }
}
