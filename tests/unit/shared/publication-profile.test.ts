/**
 * publication-profile.test.ts — 商业化出版检查
 */
import { describe, expect, it } from 'vitest';
import {
    checkPublicationReadiness,
    formatPublicationReport,
    resolvePublicationProfile,
    type PublicationFacts,
} from '../../../shared/publication-profile';

function facts(overrides: Partial<PublicationFacts> = {}): PublicationFacts {
    return {
        mode: 'long',
        title: '示例书',
        author: '作者',
        unitLabel: '章',
        unitCount: 200,
        writtenCount: 200,
        wordCount: 1200000,
        emptyUnits: [],
        duplicateTitleCount: 0,
        includeChapterTitles: true,
        format: 'epub',
        ...overrides,
    };
}

describe('resolvePublicationProfile', () => {
    it('三模式参数与 CREATION_MODE_SPECS 一致', () => {
        expect(resolvePublicationProfile('long').targetWords.min).toBe(100000);
        expect(resolvePublicationProfile('short').targetUnits.min).toBe(8);
        expect(resolvePublicationProfile('script').targetUnits.min).toBe(40);
    });
});

describe('checkPublicationReadiness', () => {
    it('完整成稿无事项', () => {
        expect(checkPublicationReadiness(facts())).toEqual([]);
    });

    it('缺书名与 EPUB 缺作者为阻断项；Markdown 不要求作者', () => {
        const missing = checkPublicationReadiness(facts({ title: '  ', author: '' }));
        expect(missing.map(issue => issue.code)).toContain('missing-title');
        expect(missing.map(issue => issue.code)).toContain('missing-author');

        const markdown = checkPublicationReadiness(facts({ author: '', format: 'markdown' }));
        expect(markdown.map(issue => issue.code)).not.toContain('missing-author');
    });

    it('空单元与无正文为阻断项', () => {
        const issues = checkPublicationReadiness(facts({ emptyUnits: ['第3章 空白'], writtenCount: 199 }));
        expect(issues.map(issue => issue.code)).toContain('empty-units');
        expect(issues[0].message).toContain('第3章 空白');

        const noBody = checkPublicationReadiness(facts({ writtenCount: 0, unitCount: 0 }));
        expect(noBody.map(issue => issue.code)).toContain('no-body');
    });

    it('字数低于一半为阻断，低于下限但过半为建议', () => {
        const tooLow = checkPublicationReadiness(facts({ wordCount: 40000 }));
        expect(tooLow.map(issue => issue.code)).toContain('word-count-too-low');

        const low = checkPublicationReadiness(facts({ wordCount: 60000 }));
        const codes = low.map(issue => issue.code);
        expect(codes).toContain('word-count-low');
        expect(codes).not.toContain('word-count-too-low');
    });

    it('单元数不足、EPUB 无标题、重复标题为建议项', () => {
        const issues = checkPublicationReadiness(facts({
            unitCount: 5,
            includeChapterTitles: false,
            duplicateTitleCount: 2,
        }));
        const codes = issues.map(issue => issue.code);
        expect(codes).toContain('unit-count-low');
        expect(codes).toContain('epub-no-titles');
        expect(codes).toContain('duplicate-titles');
    });
});

describe('formatPublicationReport', () => {
    it('无事项返回 null，有事项分阻断/建议两段', () => {
        expect(formatPublicationReport([])).toBeNull();
        const report = formatPublicationReport(checkPublicationReadiness(facts({ title: '', wordCount: 40000 })));
        expect(report).toContain('出版阻断');
        expect(report).toContain('书名不能为空');
        expect(report).toContain('低于出版下限');
    });
});
