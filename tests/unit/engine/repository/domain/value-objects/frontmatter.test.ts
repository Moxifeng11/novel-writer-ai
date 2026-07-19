import { describe, it, expect } from 'vitest';
import { Frontmatter } from '../../../../../../engine/repository/domain/value-objects/frontmatter';

describe('Frontmatter 值对象', () => {
    describe('empty / from', () => {
        it('empty 创建空对象', () => {
            const fm = Frontmatter.empty();
            expect(fm.isEmpty()).toBe(true);
            expect(fm.size()).toBe(0);
        });

        it('from 从对象创建', () => {
            const fm = Frontmatter.from({ name: 'test', value: 42 });
            expect(fm.size()).toBe(2);
            expect(fm.get('name')).toBe('test');
            expect(fm.get('value')).toBe(42);
        });

        it('from 处理 null/undefined', () => {
            expect(Frontmatter.from(null).isEmpty()).toBe(true);
            expect(Frontmatter.from(undefined).isEmpty()).toBe(true);
        });
    });

    describe('get / has', () => {
        it('get 获取已存在字段', () => {
            const fm = Frontmatter.from({ key: 'value' });
            expect(fm.get('key')).toBe('value');
        });

        it('get 获取不存在字段返回默认值', () => {
            const fm = Frontmatter.empty();
            expect(fm.get('missing', 'default')).toBe('default');
            expect(fm.get('missing')).toBeUndefined();
        });

        it('has 检查字段存在', () => {
            const fm = Frontmatter.from({ key: 'value' });
            expect(fm.has('key')).toBe(true);
            expect(fm.has('missing')).toBe(false);
        });
    });

    describe('不可变性', () => {
        it('set 返回新实例', () => {
            const fm1 = Frontmatter.from({ a: 1 });
            const fm2 = fm1.set('b', 2);
            expect(fm1.size()).toBe(1);
            expect(fm2.size()).toBe(2);
            expect(fm2.get('b')).toBe(2);
        });

        it('merge 返回新实例', () => {
            const fm1 = Frontmatter.from({ a: 1, b: 2 });
            const fm2 = fm1.merge({ b: 3, c: 4 });
            expect(fm1.get('b')).toBe(2);
            expect(fm2.get('a')).toBe(1);
            expect(fm2.get('b')).toBe(3);
            expect(fm2.get('c')).toBe(4);
        });

        it('remove 返回新实例', () => {
            const fm1 = Frontmatter.from({ a: 1, b: 2 });
            const fm2 = fm1.remove('a');
            expect(fm1.size()).toBe(2);
            expect(fm2.size()).toBe(1);
            expect(fm2.has('a')).toBe(false);
        });

        it('set undefined 删除字段', () => {
            const fm1 = Frontmatter.from({ a: 1 });
            const fm2 = fm1.set('a', undefined);
            expect(fm2.has('a')).toBe(false);
        });
    });

    describe('keys / values / entries', () => {
        it('返回正确的键值', () => {
            const fm = Frontmatter.from({ a: 1, b: 2 });
            expect(fm.keys().sort()).toEqual(['a', 'b']);
            expect(fm.values().sort((a, b) => a - b)).toEqual([1, 2]);
            expect(fm.entries().length).toBe(2);
        });
    });

    describe('getTags', () => {
        it('从数组获取 tags', () => {
            const fm = Frontmatter.from({ tags: ['tag1', 'tag2'] });
            expect(fm.getTags()).toEqual(['tag1', 'tag2']);
        });

        it('从逗号分隔字符串获取 tags', () => {
            const fm = Frontmatter.from({ tags: 'tag1, tag2, tag3' });
            expect(fm.getTags()).toEqual(['tag1', 'tag2', 'tag3']);
        });

        it('无 tags 字段返回空数组', () => {
            const fm = Frontmatter.empty();
            expect(fm.getTags()).toEqual([]);
        });
    });

    describe('equals', () => {
        it('相同内容相等', () => {
            const a = Frontmatter.from({ x: 1, y: 2 });
            const b = Frontmatter.from({ y: 2, x: 1 });
            expect(a.equals(b)).toBe(true);
        });

        it('不同内容不相等', () => {
            const a = Frontmatter.from({ x: 1 });
            const b = Frontmatter.from({ x: 2 });
            expect(a.equals(b)).toBe(false);
        });
    });

    describe('toObject / toJSON', () => {
        it('返回深拷贝', () => {
            const fm = Frontmatter.from({ a: 1 });
            const obj = fm.toObject();
            obj.a = 999;
            expect(fm.get('a')).toBe(1);
        });
    });
});
