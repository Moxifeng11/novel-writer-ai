/**
 * domain/value-objects/chapter-status.ts — 章节状态值对象
 *
 * 封装章节状态的枚举值和转换逻辑。
 */

import type { BodyStatus } from '../../../../shared/types';

/** 章节状态枚举 */
export type ChapterStatusValue = 'pending' | 'written' | 'settled';

/**
 * 章节状态值对象
 * 不可变，封装状态转换和判断逻辑
 */
export class ChapterStatus {
    readonly value: ChapterStatusValue;

    private constructor(value: ChapterStatusValue) {
        this.value = value;
    }

    /** 待写状态 */
    static PENDING = new ChapterStatus('pending');
    /** 已写状态 */
    static WRITTEN = new ChapterStatus('written');
    /** 已结算状态 */
    static SETTLED = new ChapterStatus('settled');

    /**
     * 从字符串创建 ChapterStatus
     * 非法值默认返回 pending
     * @param value - 值
      * @returns ChapterStatus 实例
     */
    static from(value: string | undefined | null): ChapterStatus {
        if (value === 'written') return ChapterStatus.WRITTEN;
        if (value === 'settled') return ChapterStatus.SETTLED;
        return ChapterStatus.PENDING;
    }

    /**
     * 从旧的 BodyStatus 类型转换
     * @param status - 状态
      * @returns ChapterStatus 实例
     */
    static fromBodyStatus(status: BodyStatus | undefined): ChapterStatus {
        return ChapterStatus.from(status);
    }

    /**
     * 转换为 BodyStatus 类型（向后兼容）
     *
      * @returns BodyStatus 实例
     */
    toBodyStatus(): BodyStatus {
        return this.value;
    }

    /**
     * 是否为待写状态
     *
     * @returns 是否成功
     */
    isPending(): boolean {
        return this.value === 'pending';
    }

    /**
     * 是否已写状态
     *
     * @returns 是否成功
     */
    isWritten(): boolean {
        return this.value === 'written';
    }

    /**
     * 是否已结算状态
     *
     * @returns 是否成功
     */
    isSettled(): boolean {
        return this.value === 'settled';
    }

    /**
     * 转换到下一个状态
     * pending → written → settled
      * @returns ChapterStatus 实例
     */
    next(): ChapterStatus {
        switch (this.value) {
            case 'pending':
                return ChapterStatus.WRITTEN;
            case 'written':
                return ChapterStatus.SETTLED;
            case 'settled':
                return ChapterStatus.SETTLED;
        }
    }

    /**
     * 回退到上一个状态
     * settled → written → pending
      * @returns ChapterStatus 实例
     */
    previous(): ChapterStatus {
        switch (this.value) {
            case 'settled':
                return ChapterStatus.WRITTEN;
            case 'written':
                return ChapterStatus.PENDING;
            case 'pending':
                return ChapterStatus.PENDING;
        }
    }

    /**
     * 获取状态显示文本
     * @returns 文本结果
     */
    getLabel(): string {
        switch (this.value) {
            case 'pending':
                return '待写';
            case 'written':
                return '已写';
            case 'settled':
                return '已结算';
        }
    }

    /**
     * 值对象相等性比较
     *
     * @param other - 另一侧值
     * @returns 是否成功
     */
    equals(other: ChapterStatus): boolean {
        return this.value === other.value;
    }

    toString(): string {
        return this.value;
    }

    toJSON(): ChapterStatusValue {
        return this.value;
    }
}
