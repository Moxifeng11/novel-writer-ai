/**
 * previous-chapter-window.test.ts — 前文章节窗口
 *
 * 协同实时监控此前只读同卷上一章：卷首章读不到前文，且只有 1 章可用。
 * 这里验证跨卷选取最近 N 章、剥离 frontmatter、按预算裁剪。
 */

import { describe, it, expect } from 'vitest';
import {
    buildPreviousChapterWindow,
    selectPreviousChapterFiles,
    stripFrontmatterBlock,
} from '../../../shared/previous-chapter-window';

function bodyFile(volume: number, chapterNum: number) {
    return {
        path: `书/03-大纲与章节/正文/第${volume}卷/第${chapterNum}章_正文.md`,
        name: `第${chapterNum}章_正文.md`,
    };
}

describe('stripFrontmatterBlock — 剥离 frontmatter', () => {
    it('去掉 YAML frontmatter，只留正文', () => {
        const content = '---\ntags:\n  - 正文\n---\n\n　　正文第一段。';
        expect(stripFrontmatterBlock(content)).toBe('\n　　正文第一段。');
    });

    it('无 frontmatter 时原样返回', () => {
        expect(stripFrontmatterBlock('　　正文。')).toBe('　　正文。');
    });

    it('空内容返回空字符串', () => {
        expect(stripFrontmatterBlock('')).toBe('');
    });

    it('支持 CRLF 换行', () => {
        const content = '---\r\ntags: 正文\r\n---\r\n　　正文。';
        expect(stripFrontmatterBlock(content)).toBe('　　正文。');
    });
});

describe('selectPreviousChapterFiles — 选出最近的前文章节', () => {
    it('跨卷选出最近 3 章，按章号降序', () => {
        const files = [
            bodyFile(1, 17),
            bodyFile(1, 18),
            bodyFile(1, 19),
            bodyFile(2, 20),
            bodyFile(2, 21),
        ];
        expect(selectPreviousChapterFiles(files, 21)).toEqual([
            { chapterNum: 20, path: files[3].path },
            { chapterNum: 19, path: files[2].path },
            { chapterNum: 18, path: files[1].path },
        ]);
    });

    it('卷首章也能取到上一卷的前文', () => {
        const files = [bodyFile(2, 290), bodyFile(3, 291)];
        expect(selectPreviousChapterFiles(files, 291)).toEqual([
            { chapterNum: 290, path: files[0].path },
        ]);
    });

    it('当前章或更晚的章节不进入前文', () => {
        const files = [bodyFile(1, 4), bodyFile(1, 5), bodyFile(1, 6)];
        expect(selectPreviousChapterFiles(files, 5).map(f => f.chapterNum)).toEqual([4]);
    });

    it('第 1 章没有前文', () => {
        expect(selectPreviousChapterFiles([bodyFile(1, 1)], 1)).toEqual([]);
    });

    it('忽略非正文文件，同章多份时保留较短路径', () => {
        const files = [
            { path: '书/03-大纲与章节/正文/第1卷/第3章_大纲摘要.md', name: '第3章_大纲摘要.md' },
            bodyFile(1, 3),
            { path: '书/03-大纲与章节/正文/第1卷/第2章_正文_修订稿.md', name: '第2章_正文_修订稿.md' },
            bodyFile(1, 2),
        ];
        expect(selectPreviousChapterFiles(files, 4)).toEqual([
            { chapterNum: 3, path: files[1].path },
            { chapterNum: 2, path: files[3].path },
        ]);
    });
});

describe('buildPreviousChapterWindow — 按预算裁剪', () => {
    it('剥离 frontmatter 并按章号降序输出', () => {
        const result = buildPreviousChapterWindow([
            { chapterNum: 3, raw: '---\ntags: 正文\n---\n正文三' },
            { chapterNum: 5, raw: '正文五' },
        ]);
        expect(result.map(item => item.chapterNum)).toEqual([5, 3]);
        expect(result[1].text).toBe('正文三');
    });

    it('空正文整章跳过', () => {
        const result = buildPreviousChapterWindow([
            { chapterNum: 2, raw: '---\ntags: 正文\n---\n' },
            { chapterNum: 1, raw: '正文一' },
        ]);
        expect(result).toEqual([{ chapterNum: 1, text: '正文一' }]);
    });

    it('单章超限时截断', () => {
        const result = buildPreviousChapterWindow(
            [{ chapterNum: 1, raw: '一二三四五' }],
            { perChapterLimit: 3 },
        );
        expect(result[0].text).toBe('一二三');
    });

    it('总量用尽后不再收录更早章节，最后一章按剩余预算截断', () => {
        const result = buildPreviousChapterWindow(
            [
                { chapterNum: 2, raw: '二二二二' },
                { chapterNum: 1, raw: '一一一一' },
            ],
            { totalLimit: 6 },
        );
        expect(result.map(item => item.text)).toEqual(['二二二二', '一一']);
    });

    it('预算非正数时返回空', () => {
        expect(buildPreviousChapterWindow([{ chapterNum: 1, raw: '正文' }], { totalLimit: 0 })).toEqual([]);
    });
});
