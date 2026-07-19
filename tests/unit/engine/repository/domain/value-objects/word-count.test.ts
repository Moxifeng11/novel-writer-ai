import { describe, it, expect } from 'vitest';
import { WordCount } from '../../../../../../engine/repository/domain/value-objects/word-count';

describe('WordCount 值对象', () => {
    describe('create', () => {
        it('创建正常字数值对象', () => {
            const wc = WordCount.create(100, 150, 5);
            expect(wc.chinese).toBe(100);
            expect(wc.total).toBe(150);
            expect(wc.paragraphs).toBe(5);
        });

        it('负数自动归零', () => {
            const wc = WordCount.create(-10, -5, -1);
            expect(wc.chinese).toBe(0);
            expect(wc.total).toBe(0);
            expect(wc.paragraphs).toBe(0);
        });

        it('小数自动取整', () => {
            const wc = WordCount.create(100.7, 150.3, 5.9);
            expect(wc.chinese).toBe(100);
            expect(wc.total).toBe(150);
            expect(wc.paragraphs).toBe(5);
        });

        it('零参数创建零字数', () => {
            const wc = WordCount.create();
            expect(wc.chinese).toBe(0);
            expect(wc.total).toBe(0);
            expect(wc.paragraphs).toBe(0);
        });
    });

    describe('fromText', () => {
        it('从中文文本统计字数', () => {
            const text = '这是一段测试文本，包含一些汉字。';
            const wc = WordCount.fromText(text);
            expect(wc.chinese).toBe(14);
            expect(wc.total).toBe(text.length);
        });

        it('空字符串返回零字数', () => {
            const wc = WordCount.fromText('');
            expect(wc.isZero()).toBe(true);
        });

        it('null/undefined 返回零字数', () => {
            const wc1 = WordCount.fromText(null as any);
            const wc2 = WordCount.fromText(undefined as any);
            expect(wc1.isZero()).toBe(true);
            expect(wc2.isZero()).toBe(true);
        });

        it('正确统计段落数', () => {
            const text = '第一段。\n\n第二段。\n\n第三段。';
            const wc = WordCount.fromText(text);
            expect(wc.paragraphs).toBe(3);
        });
    });

    describe('zero', () => {
        it('返回零字数值对象', () => {
            const wc = WordCount.zero();
            expect(wc.isZero()).toBe(true);
            expect(wc.chinese).toBe(0);
            expect(wc.total).toBe(0);
            expect(wc.paragraphs).toBe(0);
        });
    });

    describe('add', () => {
        it('两个字数相加', () => {
            const a = WordCount.create(100, 150, 3);
            const b = WordCount.create(200, 250, 2);
            const sum = a.add(b);
            expect(sum.chinese).toBe(300);
            expect(sum.total).toBe(400);
            expect(sum.paragraphs).toBe(5);
        });

        it('不可变性：原对象不变', () => {
            const a = WordCount.create(100, 150, 3);
            const b = WordCount.create(200, 250, 2);
            a.add(b);
            expect(a.chinese).toBe(100);
        });
    });

    describe('subtract', () => {
        it('两个字数相减', () => {
            const a = WordCount.create(300, 400, 5);
            const b = WordCount.create(100, 150, 2);
            const diff = a.subtract(b);
            expect(diff.chinese).toBe(200);
            expect(diff.total).toBe(250);
            expect(diff.paragraphs).toBe(3);
        });

        it('结果不为负数', () => {
            const a = WordCount.create(50, 100, 1);
            const b = WordCount.create(100, 200, 3);
            const diff = a.subtract(b);
            expect(diff.chinese).toBe(0);
            expect(diff.total).toBe(0);
            expect(diff.paragraphs).toBe(0);
        });
    });

    describe('equals', () => {
        it('相同值相等', () => {
            const a = WordCount.create(100, 150, 3);
            const b = WordCount.create(100, 150, 3);
            expect(a.equals(b)).toBe(true);
        });

        it('不同值不相等', () => {
            const a = WordCount.create(100, 150, 3);
            const b = WordCount.create(100, 151, 3);
            expect(a.equals(b)).toBe(false);
        });
    });

    describe('fromJSON / toJSON', () => {
        it('往返转换一致', () => {
            const original = WordCount.create(100, 150, 3);
            const json = original.toJSON();
            const restored = WordCount.fromJSON(json);
            expect(restored.equals(original)).toBe(true);
        });

        it('fromJSON 处理 null/undefined', () => {
            expect(WordCount.fromJSON(null).isZero()).toBe(true);
            expect(WordCount.fromJSON(undefined).isZero()).toBe(true);
        });

        it('fromJSON 处理部分字段', () => {
            const wc = WordCount.fromJSON({ chinese: 100 });
            expect(wc.chinese).toBe(100);
            expect(wc.total).toBe(0);
            expect(wc.paragraphs).toBe(0);
        });
    });
});
