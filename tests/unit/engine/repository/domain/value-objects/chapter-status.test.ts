import { describe, it, expect } from 'vitest';
import { ChapterStatus } from '../../../../../../engine/repository/domain/value-objects/chapter-status';

describe('ChapterStatus 值对象', () => {
    describe('静态实例', () => {
        it('PENDING 状态正确', () => {
            expect(ChapterStatus.PENDING.value).toBe('pending');
            expect(ChapterStatus.PENDING.isPending()).toBe(true);
            expect(ChapterStatus.PENDING.isWritten()).toBe(false);
            expect(ChapterStatus.PENDING.isSettled()).toBe(false);
        });

        it('WRITTEN 状态正确', () => {
            expect(ChapterStatus.WRITTEN.value).toBe('written');
            expect(ChapterStatus.WRITTEN.isPending()).toBe(false);
            expect(ChapterStatus.WRITTEN.isWritten()).toBe(true);
            expect(ChapterStatus.WRITTEN.isSettled()).toBe(false);
        });

        it('SETTLED 状态正确', () => {
            expect(ChapterStatus.SETTLED.value).toBe('settled');
            expect(ChapterStatus.SETTLED.isPending()).toBe(false);
            expect(ChapterStatus.SETTLED.isWritten()).toBe(false);
            expect(ChapterStatus.SETTLED.isSettled()).toBe(true);
        });
    });

    describe('from', () => {
        it('从有效字符串创建', () => {
            expect(ChapterStatus.from('pending').value).toBe('pending');
            expect(ChapterStatus.from('written').value).toBe('written');
            expect(ChapterStatus.from('settled').value).toBe('settled');
        });

        it('非法值默认返回 pending', () => {
            expect(ChapterStatus.from('invalid').value).toBe('pending');
            expect(ChapterStatus.from('').value).toBe('pending');
            expect(ChapterStatus.from(null).value).toBe('pending');
            expect(ChapterStatus.from(undefined).value).toBe('pending');
        });
    });

    describe('状态转换', () => {
        it('next: pending → written → settled', () => {
            const s1 = ChapterStatus.PENDING;
            const s2 = s1.next();
            expect(s2.value).toBe('written');
            const s3 = s2.next();
            expect(s3.value).toBe('settled');
            const s4 = s3.next();
            expect(s4.value).toBe('settled');
        });

        it('previous: settled → written → pending', () => {
            const s1 = ChapterStatus.SETTLED;
            const s2 = s1.previous();
            expect(s2.value).toBe('written');
            const s3 = s2.previous();
            expect(s3.value).toBe('pending');
            const s4 = s3.previous();
            expect(s4.value).toBe('pending');
        });
    });

    describe('getLabel', () => {
        it('返回中文标签', () => {
            expect(ChapterStatus.PENDING.getLabel()).toBe('待写');
            expect(ChapterStatus.WRITTEN.getLabel()).toBe('已写');
            expect(ChapterStatus.SETTLED.getLabel()).toBe('已结算');
        });
    });

    describe('equals', () => {
        it('相同状态相等', () => {
            expect(ChapterStatus.PENDING.equals(ChapterStatus.from('pending'))).toBe(true);
        });

        it('不同状态不相等', () => {
            expect(ChapterStatus.PENDING.equals(ChapterStatus.WRITTEN)).toBe(false);
        });
    });

    describe('toBodyStatus / fromBodyStatus', () => {
        it('与 BodyStatus 类型双向转换', () => {
            const status = ChapterStatus.WRITTEN;
            const bodyStatus = status.toBodyStatus();
            expect(bodyStatus).toBe('written');
            const restored = ChapterStatus.fromBodyStatus(bodyStatus);
            expect(restored.equals(status)).toBe(true);
        });
    });
});
