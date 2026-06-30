import { describe, it, expect } from 'vitest';
import {
    parseFrontmatter,
    parseMarkdownContent,
} from '../../../shared/frontmatter';

describe('parseFrontmatter', () => {
    it('解析基本的 frontmatter', () => {
        const content = `---
title: 测试标题
tags: [小说]
---
正文内容`;
        const fm = parseFrontmatter(content);
        expect(fm.title).toBe('测试标题');
        expect(fm.tags).toBe('[小说]');
    });

    it('去除引号包裹的值', () => {
        const content = `---
name: "张三"
---`;
        const fm = parseFrontmatter(content);
        expect(fm.name).toBe('张三');
    });

    it('无 frontmatter 返回空对象', () => {
        const content = '普通文本内容';
        expect(parseFrontmatter(content)).toEqual({});
    });

    it('空 frontmatter 返回空对象', () => {
        const content = `---
---`;
        expect(parseFrontmatter(content)).toEqual({});
    });

    it('处理跨行值', () => {
        const content = `---
description:
  这是一段
  多行描述
title: 测试
---`;
        const fm = parseFrontmatter(content);
        expect(fm.title).toBe('测试');
    });
});

describe('parseMarkdownContent', () => {
    it('解析 Markdown 章节', () => {
        const content = `# 第一章
内容1
内容2
## 第一节
子内容
# 第二章
内容3`;
        const result = parseMarkdownContent(content);
        expect(result.sections.length).toBe(3);
        expect(result.sections[0].title).toBe('第一章');
        expect(result.sections[0].level).toBe(1);
        expect(result.sections[0].content.length).toBeGreaterThanOrEqual(2);
        expect(result.sections[1].title).toBe('第一节');
        expect(result.sections[1].level).toBe(2);
        expect(result.sections[2].title).toBe('第二章');
    });

    it('空内容返回空 sections', () => {
        const result = parseMarkdownContent('');
        expect(result.sections.length).toBe(0);
    });

    it('无标题内容返回空 sections', () => {
        const result = parseMarkdownContent('普通文本\n没有标题');
        expect(result.sections.length).toBe(0);
    });

    it('保留原始内容', () => {
        const raw = '# 标题\n内容';
        const result = parseMarkdownContent(raw);
        expect(result.raw).toBe(raw);
    });
});
