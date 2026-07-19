/**
 * domain/value-objects/entity-status.ts — 实体状态值对象
 *
 * 封装实体状态的枚举值和转换逻辑。
 */

import type { EntityStatus as EntityStatusType } from '../../../../shared/types';

/** 实体状态枚举值 */
export type EntityStatusValue = 'active' | 'inactive' | 'dead' | 'hidden';

/**
 * 实体状态值对象
 * 不可变，封装状态判断和转换逻辑
 */
export class EntityStatus {
    readonly value: EntityStatusValue;

    private constructor(value: EntityStatusValue) {
        this.value = value;
    }

    /** 活跃状态 */
    static ACTIVE = new EntityStatus('active');
    /** 非活跃状态 */
    static INACTIVE = new EntityStatus('inactive');
    /** 死亡状态 */
    static DEAD = new EntityStatus('dead');
    /** 隐藏状态 */
    static HIDDEN = new EntityStatus('hidden');

    /**
     * 从字符串创建 EntityStatus
     * 非法值默认返回 active
     */
    static from(value: string | undefined | null): EntityStatus {
        if (value === 'inactive') return EntityStatus.INACTIVE;
        if (value === 'dead') return EntityStatus.DEAD;
        if (value === 'hidden') return EntityStatus.HIDDEN;
        return EntityStatus.ACTIVE;
    }

    /** 是否活跃 */
    isActive(): boolean {
        return this.value === 'active';
    }

    /** 是否非活跃 */
    isInactive(): boolean {
        return this.value === 'inactive';
    }

    /** 是否死亡 */
    isDead(): boolean {
        return this.value === 'dead';
    }

    /** 是否隐藏 */
    isHidden(): boolean {
        return this.value === 'hidden';
    }

    /**
     * 获取状态显示文本
     */
    getLabel(): string {
        switch (this.value) {
            case 'active':
                return '活跃';
            case 'inactive':
                return '非活跃';
            case 'dead':
                return '死亡';
            case 'hidden':
                return '隐藏';
        }
    }

    /** 转换为旧类型（向后兼容） */
    toLegacyType(): EntityStatusType {
        return this.value;
    }

    /** 值对象相等性比较 */
    equals(other: EntityStatus): boolean {
        return this.value === other.value;
    }

    toString(): string {
        return this.value;
    }

    toJSON(): EntityStatusValue {
        return this.value;
    }
}
