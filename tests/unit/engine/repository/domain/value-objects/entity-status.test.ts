import { describe, it, expect } from 'vitest';
import { EntityStatus } from '../../../../../../engine/repository/domain/value-objects/entity-status';

describe('EntityStatus 值对象', () => {
    describe('静态实例', () => {
        it('ACTIVE 状态正确', () => {
            expect(EntityStatus.ACTIVE.value).toBe('active');
            expect(EntityStatus.ACTIVE.isActive()).toBe(true);
            expect(EntityStatus.ACTIVE.isInactive()).toBe(false);
            expect(EntityStatus.ACTIVE.isDead()).toBe(false);
            expect(EntityStatus.ACTIVE.isHidden()).toBe(false);
        });

        it('INACTIVE 状态正确', () => {
            expect(EntityStatus.INACTIVE.value).toBe('inactive');
            expect(EntityStatus.INACTIVE.isInactive()).toBe(true);
        });

        it('DEAD 状态正确', () => {
            expect(EntityStatus.DEAD.value).toBe('dead');
            expect(EntityStatus.DEAD.isDead()).toBe(true);
        });

        it('HIDDEN 状态正确', () => {
            expect(EntityStatus.HIDDEN.value).toBe('hidden');
            expect(EntityStatus.HIDDEN.isHidden()).toBe(true);
        });
    });

    describe('from', () => {
        it('从有效字符串创建', () => {
            expect(EntityStatus.from('active').value).toBe('active');
            expect(EntityStatus.from('inactive').value).toBe('inactive');
            expect(EntityStatus.from('dead').value).toBe('dead');
            expect(EntityStatus.from('hidden').value).toBe('hidden');
        });

        it('非法值默认返回 active', () => {
            expect(EntityStatus.from('invalid').value).toBe('active');
            expect(EntityStatus.from('').value).toBe('active');
            expect(EntityStatus.from(null).value).toBe('active');
            expect(EntityStatus.from(undefined).value).toBe('active');
        });
    });

    describe('getLabel', () => {
        it('返回中文标签', () => {
            expect(EntityStatus.ACTIVE.getLabel()).toBe('活跃');
            expect(EntityStatus.INACTIVE.getLabel()).toBe('非活跃');
            expect(EntityStatus.DEAD.getLabel()).toBe('死亡');
            expect(EntityStatus.HIDDEN.getLabel()).toBe('隐藏');
        });
    });

    describe('equals', () => {
        it('相同状态相等', () => {
            expect(EntityStatus.ACTIVE.equals(EntityStatus.from('active'))).toBe(true);
        });

        it('不同状态不相等', () => {
            expect(EntityStatus.ACTIVE.equals(EntityStatus.INACTIVE)).toBe(false);
        });
    });

    describe('toLegacyType', () => {
        it('转换为旧类型', () => {
            expect(EntityStatus.ACTIVE.toLegacyType()).toBe('active');
            expect(EntityStatus.DEAD.toLegacyType()).toBe('dead');
        });
    });
});
