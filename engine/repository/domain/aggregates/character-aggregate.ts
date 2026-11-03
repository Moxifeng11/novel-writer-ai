/**
 * domain/aggregates/character-aggregate.ts — 人物聚合根
 *
 * 人物聚合根，复用 shared/entity-models.ts 中的字段，
 * 增强为完整的 DDD 聚合根实现。
 */

import { BaseEntity, type BaseEntityProps } from './base-entity';
import { EntityStatus, Frontmatter } from '@/engine/repository/domain/value-objects';
import type { EntityCategory } from './base-entity';
import type {
    CharacterSoulData,
    PersonalityLayers,
    CharacterArc,
    CharacterRelation,
} from '@/shared/entity-models';

/**
 * 人物特定属性
 */
export interface CharacterProps extends BaseEntityProps {
    age?: string;
    identity?: string;
    gender?: string;
    firstAppearance?: string;
    coreMotivation?: string;
    coreWeakness?: string;
    habit?: string;
    currentStatus?: string;
    currentEmotion?: string;
    currentLocation?: string;
    personalityTags?: string;
    specialAbility?: string;
    skillTree?: string;
    cultivationLevel?: string;
    faction?: string;
    background?: string;
    appearance?: string;
    currentGoal?: string;
    soul: CharacterSoulData | null;
    personality: PersonalityLayers | null;
    arc: CharacterArc | null;
    relations: CharacterRelation[];
}

/**
 * 人物聚合根
 */
export class Character extends BaseEntity {
    private readonly _characterProps: Omit<CharacterProps, keyof BaseEntityProps>;

    private constructor(props: CharacterProps) {
        super(props);
        const { id, name, filePath, tags, entityStatus, createdAt, lastChangedAt, lastChangedReason, frontmatter, body, content, ...rest } = props;
        this._characterProps = {
            ...rest,
            relations: [...rest.relations],
        };
    }

    get category(): EntityCategory {
        return 'character';
    }

    get age(): string | undefined { return this._characterProps.age; }
    get identity(): string | undefined { return this._characterProps.identity; }
    get gender(): string | undefined { return this._characterProps.gender; }
    get firstAppearance(): string | undefined { return this._characterProps.firstAppearance; }
    get coreMotivation(): string | undefined { return this._characterProps.coreMotivation; }
    get coreWeakness(): string | undefined { return this._characterProps.coreWeakness; }
    get habit(): string | undefined { return this._characterProps.habit; }
    get currentStatus(): string | undefined { return this._characterProps.currentStatus; }
    get currentEmotion(): string | undefined { return this._characterProps.currentEmotion; }
    get currentLocation(): string | undefined { return this._characterProps.currentLocation; }
    get personalityTags(): string | undefined { return this._characterProps.personalityTags; }
    get specialAbility(): string | undefined { return this._characterProps.specialAbility; }
    get skillTree(): string | undefined { return this._characterProps.skillTree; }
    get cultivationLevel(): string | undefined { return this._characterProps.cultivationLevel; }
    get faction(): string | undefined { return this._characterProps.faction; }
    get background(): string | undefined { return this._characterProps.background; }
    get appearance(): string | undefined { return this._characterProps.appearance; }
    get currentGoal(): string | undefined { return this._characterProps.currentGoal; }
    get soul(): CharacterSoulData | null { return this._characterProps.soul; }
    get personality(): PersonalityLayers | null { return this._characterProps.personality; }
    get arc(): CharacterArc | null { return this._characterProps.arc; }
    get relations(): CharacterRelation[] { return [...this._characterProps.relations]; }

    /**
     * 创建新的 Character 实例
     * @param id - 标识
     * @param name - 名称
     * @param filePath - 文件路径
      * @returns Character 实例
     */
    static create(id: string, name: string, filePath: string): Character {
        return new Character({
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
            soul: null,
            personality: null,
            arc: null,
            relations: [],
        });
    }

    /**
     * 从完整属性创建 Character
     * @param props - 属性表
      * @returns Character 实例
     */
    static from(props: CharacterProps): Character {
        return new Character(props);
    }

    /**
     * 带状态。
     * @param status - 状态
      * @returns Character 实例
     */
    withStatus(status: EntityStatus): Character {
        return new Character({
            ...this._props,
            ...this._characterProps,
            entityStatus: status,
        } as CharacterProps);
    }

    /**
     * 带名称。
     * @param name - 名称
      * @returns Character 实例
     */
    withName(name: string): Character {
        return new Character({
            ...this._props,
            ...this._characterProps,
            name,
        } as CharacterProps);
    }

    /**
     * 更新人物灵魂数据
     * @param soul - 灵魂
      * @returns Character 实例
     */
    withSoul(soul: CharacterSoulData | null): Character {
        return new Character({
            ...this._props,
            ...this._characterProps,
            soul: soul ? { ...soul } : null,
            lastChangedAt: new Date().toISOString(),
        } as CharacterProps);
    }

    /**
     * 添加关系
     * @param relation - 关系
      * @returns Character 实例
     */
    addRelation(relation: CharacterRelation): Character {
        return new Character({
            ...this._props,
            ...this._characterProps,
            relations: [...this._characterProps.relations, relation],
            lastChangedAt: new Date().toISOString(),
        } as CharacterProps);
    }

    /**
     * 移除关系
     * @param toName - 目标名称
      * @returns Character 实例
     */
    removeRelation(toName: string): Character {
        return new Character({
            ...this._props,
            ...this._characterProps,
            relations: this._characterProps.relations.filter(r => r.toName !== toName),
            lastChangedAt: new Date().toISOString(),
        } as CharacterProps);
    }

    /**
     * 转换为JSON。
     * @returns 映射结果
     */
    toJSON(): Record<string, any> {
        return {
            ...super.toJSON(),
            ...this._characterProps,
            relations: [...this._characterProps.relations],
            soul: this._characterProps.soul ? { ...this._characterProps.soul } : null,
            personality: this._characterProps.personality ? { ...this._characterProps.personality } : null,
            arc: this._characterProps.arc ? { ...this._characterProps.arc } : null,
        };
    }
}
