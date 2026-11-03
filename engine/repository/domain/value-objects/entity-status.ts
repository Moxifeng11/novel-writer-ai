/**
 * domain/value-objects/entity-status.ts — 实体状态值对象
 *
 * 封装实体状态的枚举值和转换逻辑。
 */

import type { EntityStatus as EntityStatusType } from '@/shared/types';

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
     * @param value - 值
      * @returns EntityStatus 实例
     */
    static from(value: string | undefined | null): EntityStatus {
        if (value === 'inactive') return EntityStatus.INACTIVE;
        if (value === 'dead') return EntityStatus.DEAD;
        if (value === 'hidden') return EntityStatus.HIDDEN;
        return EntityStatus.ACTIVE;
    }

    /**
     * 是否活跃
     *
     * @returns 是否成功
     */
    isActive(): boolean {
        return this.value === 'active';
    }

    /**
     * 是否非活跃
     *
     * @returns 是否成功
     */
    isInactive(): boolean {
        return this.value === 'inactive';
    }

    /**
     * 是否死亡
     *
     * @returns 是否成功
     */
    isDead(): boolean {
        return this.value === 'dead';
    }

    /**
     * 是否隐藏
     *
     * @returns 是否成功
     */
    isHidden(): boolean {
        return this.value === 'hidden';
    }

    /**
     * 获取状态显示文本
     * @returns 文本结果
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

    /**
     * 转换为旧类型（向后兼容）
     *
      * @returns EntityStatusType 实例
     */
    toLegacyType(): EntityStatusType {
        return this.value;
    }

    /**
     * 值对象相等性比较
     *
     * @param other - 另一侧值
     * @returns 是否成功
     */
    equals(other: EntityStatus): boolean {
        return this.value === other.value;
    }

    /**
     * toString 方法。
     * @returns 文本结果
     */
    toString(): string {
        return this.value;
    }

    /**
     * 转换为JSON。
      * @returns EntityStatusValue 实例
     */
    toJSON(): EntityStatusValue {
        return this.value;
    }
}
