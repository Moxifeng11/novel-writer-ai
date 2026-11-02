/**
 * domain/aggregates/faction-aggregate.ts — 势力聚合根
 */

import { BaseEntity, type BaseEntityProps } from './base-entity';
import { EntityStatus, Frontmatter } from '../value-objects';
import type { EntityCategory } from './base-entity';

/**
 * FactionProps 类型定义。
 */
export interface FactionProps extends BaseEntityProps {
    alias?: string;
    type?: string;
    description?: string;
    leader?: string;
    rank?: string;
}

/**
 * 势力。
 */
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

    /**
     * 创建。
     * @param id - 标识
     * @param name - 名称
     * @param filePath - 文件路径
      * @returns Faction 实例
     */
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

    /**
     * 从。
     * @param props - 属性表
      * @returns Faction 实例
     */
    static from(props: FactionProps): Faction {
        return new Faction(props);
    }

    /**
     * 带状态。
     * @param status - 状态
      * @returns Faction 实例
     */
    withStatus(status: EntityStatus): Faction {
        return new Faction({
            ...this._props,
            ...this._factionProps,
            entityStatus: status,
        } as FactionProps);
    }

    /**
     * 带名称。
     * @param name - 名称
      * @returns Faction 实例
     */
    withName(name: string): Faction {
        return new Faction({
            ...this._props,
            ...this._factionProps,
            name,
        } as FactionProps);
    }

    /**
     * 带负责人。
     * @param leader - 负责人
      * @returns Faction 实例
     */
    withLeader(leader: string): Faction {
        return new Faction({
            ...this._props,
            ...this._factionProps,
            leader,
            lastChangedAt: new Date().toISOString(),
        } as FactionProps);
    }

    /**
     * 转换为JSON。
     * @returns 映射结果
     */
    toJSON(): Record<string, any> {
        return {
            ...super.toJSON(),
            ...this._factionProps,
        };
    }
}
