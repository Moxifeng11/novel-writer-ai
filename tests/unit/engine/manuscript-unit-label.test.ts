import { describe, expect, it } from 'vitest';
import { compileManuscript, type ManuscriptChapter } from '../../../engine/export/manuscript-compiler';

const chapters: ManuscriptChapter[] = [{
    volume: '第1卷',
    chapter: '第1章',
    chapterNum: 1,
    title: '开端',
    content: '---\ntags: [正文]\n---\n\n# 第1章\n\n正文。',
    path: '书/03-大纲与章节/正文/第1卷/第1章_正文.md',
}];

describe('compileManuscript — 模式单元标签', () => {
    it('短篇输出「节」，剧本输出「集」', () => {
        const short = compileManuscript(chapters, {
            format: 'text', includeVolumeHeadings: false, includeChapterTitles: true, unitLabel: '节',
        });
        expect(short.content).toContain('第1节');
        const script = compileManuscript(chapters, {
            format: 'text', includeVolumeHeadings: false, includeChapterTitles: true, unitLabel: '集',
        });
        expect(script.content).toContain('第1集');
    });
});
