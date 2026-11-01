/**
 * 章节路径单一解析（B2）
 *
 * 三份实现合并为一个入口后，锁住这些行为：
 *  - 正文/步骤路径都能反解，带标题的正文不再漏识别
 *  - v4 两级项目不会被解析成「长篇小说」
 *  - 无法识别时返回 null，由调用方回退（而不是返回半截脏数据）
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseChapterLocation } from '../../../shared/paths';

describe('parseChapterLocation — 正文', () => {
    it('识别「第N章_正文.md」', () => {
        expect(parseChapterLocation('长篇小说/书A/03-大纲与章节/正文/第2卷/第7章_正文.md')).toEqual({
            project: '长篇小说/书A',
            volume: '第2卷',
            chapterNum: 7,
            chapterName: '第7章',
        });
    });

    it('识别带标题的正文（BodyWriter 重命名后）', () => {
        expect(parseChapterLocation('长篇小说/书A/03-大纲与章节/正文/第1卷/第3章_风起_正文.md')).toEqual({
            project: '长篇小说/书A',
            volume: '第1卷',
            chapterNum: 3,
            chapterName: '第3章',
        });
    });

    it('兼容旧版一级项目（书名/03-…）', () => {
        expect(parseChapterLocation('旧书/03-大纲与章节/正文/第1卷/第1章_正文.md')?.project).toBe('旧书');
    });

    it('兼容反斜杠路径', () => {
        expect(parseChapterLocation('长篇小说\\书A\\03-大纲与章节\\正文\\第1卷\\第1章_正文.md')?.project)
            .toBe('长篇小说/书A');
    });
});

describe('parseChapterLocation — 步骤结果', () => {
    it('识别步骤目录内的任意文件', () => {
        expect(parseChapterLocation('长篇小说/书A/03-大纲与章节/步骤结果/第2卷/第7章/第7章_大纲摘要.md')).toEqual({
            project: '长篇小说/书A',
            volume: '第2卷',
            chapterNum: 7,
            chapterName: '第7章',
        });
    });

    it('章节目录本身也能识别', () => {
        expect(parseChapterLocation('长篇小说/书A/03-大纲与章节/步骤结果/第1卷/第1章')?.chapterNum).toBe(1);
    });
});

describe('parseChapterLocation — 拒绝与回退', () => {
    it('短篇/剧本与设定文件返回 null', () => {
        expect(parseChapterLocation('短篇小说/短篇A/03-正文/第1节.md')).toBeNull();
        expect(parseChapterLocation('长篇小说/书A/02-时间线与伏笔/伏笔库.md')).toBeNull();
        expect(parseChapterLocation('')).toBeNull();
    });

    it('v4 结构不会被解析成「长篇小说」', () => {
        const parsed = parseChapterLocation('长篇小说/书A/03-大纲与章节/正文/第1卷/第1章_正文.md');
        expect(parsed?.project).not.toBe('长篇小说');
        expect(parsed?.project).toBe('长篇小说/书A');
    });
});

describe('源码约束：只保留一份实现', () => {
    const root = path.resolve(__dirname, '../../..');
    const read = (rel: string): string => fs.readFileSync(path.join(root, rel), 'utf8');

    it('core 与工作台工具函数都委托 shared 实现', () => {
        expect(read('core/command-registry.ts')).toContain('return parseChapterLocation(path);');
        expect(read('ui/full-writer/full-writer-utils.ts')).toContain('parseChapterLocation(path)');
    });

    it('main.ts 不再保留私有章节解析副本', () => {
        const main = read('main.ts');
        expect(main).not.toContain('private parseChapterFromPath');
    });

    it("解析实现里不再用 split('/')[0] 猜项目", () => {
        expect(read('ui/full-writer/full-writer-utils.ts')).not.toContain("path.split('/')[0]");
    });
});
