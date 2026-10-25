/**
 * manuscript-compiler.test.ts — 成稿编译（P0-1）
 */
import { describe, it, expect } from 'vitest';
import {
    compileManuscript,
    normalizeChapterBody,
    sortManuscriptChapters,
    stripFrontmatter,
    type ManuscriptChapter,
} from '../../../engine/export/manuscript-compiler';

function chapter(
    volume: string,
    chapterNum: number,
    body: string,
    title = '',
): ManuscriptChapter {
    return {
        volume,
        chapter: `第${chapterNum}章`,
        chapterNum,
        title,
        path: `项目/03-大纲与章节/正文/${volume}/第${chapterNum}章_正文.md`,
        content: `---\ntags: [正文]\nstatus: written\n---\n\n# 第${chapterNum}章\n\n${body}`,
    };
}

describe('manuscript-compiler（P0-1 成稿编译）', () => {
    it('stripFrontmatter 只剥离文件头部的 YAML', () => {
        const input = '---\ntags: [正文]\n---\n\n正文\n\n---\n\n分隔线后的正文';
        const output = stripFrontmatter(input);
        expect(output.startsWith('\n正文')).toBe(true);
        expect(output).toContain('分隔线后的正文');
    });

    it('normalizeChapterBody 去掉 frontmatter 与重复 H1', () => {
        const body = normalizeChapterBody(chapter('第1卷', 3, '第一段\n\n第二段').content);
        expect(body).toBe('第一段\n\n第二段');
    });

    it('按卷号、章号排序且不改动入参', () => {
        const input = [chapter('第2卷', 1, 'B'), chapter('第1卷', 10, 'A'), chapter('第1卷', 2, 'C')];
        const sorted = sortManuscriptChapters(input);
        expect(sorted.map((c) => `${c.volume}-${c.chapterNum}`)).toEqual(['第1卷-2', '第1卷-10', '第2卷-1']);
        expect(input.map((c) => c.chapterNum)).toEqual([1, 10, 2]);
    });

    it('Markdown 输出包含卷/章标题且按顺序合并', () => {
        const result = compileManuscript(
            [chapter('第1卷', 2, '第二章正文', '觉醒'), chapter('第1卷', 1, '第一章正文')],
            { format: 'markdown', includeVolumeHeadings: true, includeChapterTitles: true, bookTitle: '测试书' },
        );
        expect(result.chapterCount).toBe(2);
        expect(result.volumeCount).toBe(1);
        expect(result.content).toContain('# 测试书');
        expect(result.content).toContain('# 第1卷');
        expect(result.content).toContain('## 第1章');
        expect(result.content).toContain('## 第2章 觉醒');
        expect(result.content.indexOf('第一章正文')).toBeLessThan(result.content.indexOf('第二章正文'));
        expect(result.content).not.toContain('tags: [正文]');
    });

    it('Text 输出不包含 Markdown 标记', () => {
        const result = compileManuscript([chapter('第1卷', 1, '正文内容')], {
            format: 'text',
            includeVolumeHeadings: true,
            includeChapterTitles: true,
        });
        expect(result.content).toContain('第1卷');
        expect(result.content).toContain('第1章');
        expect(result.content).not.toContain('# 第1卷');
        expect(result.content).not.toContain('## 第1章');
    });

    it('HTML 输出转义特殊字符并包含打印样式', () => {
        const result = compileManuscript([chapter('第1卷', 1, '<script>alert("x")</script> & 正文')], {
            format: 'html',
            includeVolumeHeadings: true,
            includeChapterTitles: true,
        });
        expect(result.content).toContain('&lt;script&gt;');
        expect(result.content).not.toContain('<script>alert');
        expect(result.content).toContain('@media print');
        expect(result.content).toContain('page-break-before');
    });

    it('空章节计数与字数统计不受 frontmatter 影响', () => {
        const empty = { ...chapter('第1卷', 2, ''), content: '---\nstatus: pending\n---\n' };
        const result = compileManuscript([chapter('第1卷', 1, '一二三'), empty], {
            format: 'markdown',
            includeVolumeHeadings: true,
            includeChapterTitles: true,
        });
        expect(result.emptyChapters).toBe(1);
        expect(result.wordCount).toBe(3);
    });

    it('空项目返回空稿而不抛异常', () => {
        const result = compileManuscript([], {
            format: 'markdown',
            includeVolumeHeadings: true,
            includeChapterTitles: true,
        });
        expect(result.chapterCount).toBe(0);
        expect(result.wordCount).toBe(0);
        expect(result.content).toBe('\n');
    });

    it('标题与章名相同时不重复输出', () => {
        const result = compileManuscript([chapter('第1卷', 5, '正文', '第5章')], {
            format: 'markdown',
            includeVolumeHeadings: false,
            includeChapterTitles: true,
        });
        expect(result.content).toContain('## 第5章');
        expect(result.content).not.toContain('## 第5章 第5章');
    });

    it('章节号不连续（缺失章节）时按实际章号输出，不补造内容', () => {
        const result = compileManuscript(
            [chapter('第1卷', 5, '第五章正文'), chapter('第1卷', 1, '第一章正文')],
            { format: 'markdown', includeVolumeHeadings: true, includeChapterTitles: true },
        );
        expect(result.chapterCount).toBe(2);
        expect(result.content.indexOf('第一章正文')).toBeLessThan(result.content.indexOf('第五章正文'));
        expect(result.content).not.toContain('第2章');
        expect(result.content).not.toContain('第3章');
    });

    it('超长章节完整保留，不做截断', () => {
        const longBody = '长'.repeat(20000);
        const result = compileManuscript([chapter('第1卷', 1, longBody)], {
            format: 'text',
            includeVolumeHeadings: false,
            includeChapterTitles: false,
        });
        expect(result.content).toContain(longBody);
        expect(result.wordCount).toBe(20000);
    });
});
