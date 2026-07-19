import { describe, it, expect } from 'vitest';
import { FrontmatterSerializer } from '../../../../../../engine/repository/domain/serializers/frontmatter-serializer';
import { Frontmatter } from '../../../../../../engine/repository/domain/value-objects/frontmatter';

describe('FrontmatterSerializer', () => {
    describe('parse', () => {
        it('解析简单 frontmatter', () => {
            const content = `---
name: 测试
age: 25
---

正文内容`;
            const { frontmatter, body } = FrontmatterSerializer.parse(content);
            expect(frontmatter.get('name')).toBe('测试');
            expect(frontmatter.get('age')).toBe(25);
            expect(body.trim()).toBe('正文内容');
        });

        it('无 frontmatter 返回空对象和完整内容', () => {
            const content = '只有正文';
            const { frontmatter, body } = FrontmatterSerializer.parse(content);
            expect(frontmatter.isEmpty()).toBe(true);
            expect(body).toBe('只有正文');
        });

        it('解析带引号的字符串', () => {
            const content = `---
title: "Hello: World"
---
`;
            const { frontmatter } = FrontmatterSerializer.parse(content);
            expect(frontmatter.get('title')).toBe('Hello: World');
        });

        it('解析数组（内联格式）', () => {
            const content = `---
tags: [a, b, c]
---
`;
            const { frontmatter } = FrontmatterSerializer.parse(content);
            expect(frontmatter.get('tags')).toEqual(['a', 'b', 'c']);
        });

        it('解析布尔值', () => {
            const content = `---
enabled: true
disabled: false
---
`;
            const { frontmatter } = FrontmatterSerializer.parse(content);
            expect(frontmatter.get('enabled')).toBe(true);
            expect(frontmatter.get('disabled')).toBe(false);
        });
    });

    describe('serialize', () => {
        it('序列化简单 frontmatter', () => {
            const fm = Frontmatter.from({ name: 'test', value: 42 });
            const result = FrontmatterSerializer.serialize(fm);
            expect(result.startsWith('---')).toBe(true);
            expect(result.endsWith('---')).toBe(true);
            expect(result).toContain('name: test');
            expect(result).toContain('value: 42');
        });

        it('空 frontmatter 只包含分隔符', () => {
            const fm = Frontmatter.empty();
            const result = FrontmatterSerializer.serialize(fm);
            expect(result).toBe('---\n---');
        });

        it('跳过 undefined/null 值', () => {
            const fm = Frontmatter.from({ a: 1, b: undefined, c: null });
            const result = FrontmatterSerializer.serialize(fm);
            expect(result).toContain('a: 1');
            expect(result).not.toContain('b:');
            expect(result).not.toContain('c:');
        });
    });

    describe('toMarkdown', () => {
        it('组合 frontmatter 和 body', () => {
            const fm = Frontmatter.from({ title: 'Test' });
            const md = FrontmatterSerializer.toMarkdown(fm, '# Hello\n\nWorld');
            expect(md.startsWith('---')).toBe(true);
            expect(md).toContain('# Hello');
            expect(md).toContain('World');
        });

        it('空 frontmatter 只返回 body', () => {
            const md = FrontmatterSerializer.toMarkdown(Frontmatter.empty(), 'body');
            expect(md).toBe('body');
        });
    });

    describe('往返一致性', () => {
        it('parse → serialize → parse 结果一致', () => {
            const original = `---
name: 测试
age: 25
tags: [tag1, tag2]
---

正文内容`;
            const { frontmatter, body } = FrontmatterSerializer.parse(original);
            const serialized = FrontmatterSerializer.serialize(frontmatter);
            const reparsed = FrontmatterSerializer.parse(serialized + '\n' + body);

            expect(reparsed.frontmatter.get('name')).toBe(frontmatter.get('name'));
            expect(reparsed.frontmatter.get('age')).toBe(frontmatter.get('age'));
            expect(reparsed.body.trim()).toBe(body.trim());
        });
    });
});
