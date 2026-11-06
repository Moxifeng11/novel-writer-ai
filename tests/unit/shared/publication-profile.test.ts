/**
 * publication-profile.test.ts — 商业化出版检查
 */
import { describe, expect, it } from 'vitest';
import {
    buildPublicationFacts,
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

describe('buildPublicationFacts（导出弹窗口径）', () => {
    it('剥离 frontmatter 判空，重复标题计数，字数按原始正文', () => {
        const built = buildPublicationFacts(
            [
                { unit: '第1章', title: '开端', content: '---\nstatus: written\n---\n第一章正文' },
                { unit: '第2章', title: '开端', content: '---\nstatus: written\n---\n' },
                { unit: '第3章', title: '收束', content: '第三章正文' },
            ],
            { mode: 'long', title: '示例书', author: '作者', unitLabel: '章', includeChapterTitles: true, format: 'epub' },
        );
        expect(built.unitCount).toBe(3);
        expect(built.writtenCount).toBe(2);
        expect(built.emptyUnits).toEqual(['第2章 开端']);
        // 只有标题为「开端」的两章重复 → 1 组
        expect(built.duplicateTitleCount).toBe(1);
        // 两段正文各 5 个汉字，frontmatter 不含汉字 → 10
        expect(built.wordCount).toBe(10);
    });

    it('短篇严格口径：EPUB 缺作者与空节为阻断；Markdown 不因缺作者阻断', () => {
        const units = Array.from({ length: 8 }, (_, index) => ({
            unit: `第${index + 1}节`,
            title: `第${index + 1}节标题`,
            content: index === 7
                ? '---\nstatus: planned\n---\n'
                : `---\nstatus: written\n---\n${'字'.repeat(10000)}`,
        }));
        const epub = checkPublicationReadiness(buildPublicationFacts(units, {
            mode: 'short', title: '短篇示例', author: '', unitLabel: '节', includeChapterTitles: true, format: 'epub',
        }));
        expect(epub.filter(issue => issue.level === 'blocker').map(issue => issue.code))
            .toEqual(expect.arrayContaining(['missing-author', 'empty-units']));

        const markdown = checkPublicationReadiness(buildPublicationFacts(units, {
            mode: 'short', title: '短篇示例', author: '', unitLabel: '节', includeChapterTitles: true, format: 'markdown',
        }));
        expect(markdown.map(issue => issue.code)).not.toContain('missing-author');
        expect(markdown.map(issue => issue.code)).toContain('empty-units');
    });

    it('短篇字数：低于下限一半阻断，仅低于下限为建议', () => {
        const units = [{ unit: '第1节', title: '开端', content: '字'.repeat(30000) }];
        const warningOnly = checkPublicationReadiness(buildPublicationFacts(units, {
            mode: 'short', title: '短篇示例', author: '作者', unitLabel: '节', includeChapterTitles: true, format: 'markdown',
        }));
        expect(warningOnly.find(issue => issue.code === 'word-count-low')?.level).toBe('warning');
        expect(warningOnly.map(issue => issue.code)).not.toContain('word-count-too-low');

        const blocked = checkPublicationReadiness(buildPublicationFacts(
            [{ unit: '第1节', title: '开端', content: '字'.repeat(20000) }],
            { mode: 'short', title: '短篇示例', author: '作者', unitLabel: '节', includeChapterTitles: true, format: 'markdown' },
        ));
        expect(blocked.find(issue => issue.code === 'word-count-too-low')?.level).toBe('blocker');
    });

    it('剧本：集数不足只是建议，空集与无正文为阻断', () => {
        const units = Array.from({ length: 30 }, (_, index) => ({
            unit: `第${index + 1}集`,
            title: `第${index + 1}集标题`,
            content: '字'.repeat(2000),
        }));
        const issues = checkPublicationReadiness(buildPublicationFacts(units, {
            mode: 'script', title: '剧本示例', author: '编剧', unitLabel: '集', includeChapterTitles: true, format: 'docx',
        }));
        expect(issues.find(issue => issue.code === 'unit-count-low')?.level).toBe('warning');
        expect(issues.filter(issue => issue.level === 'blocker')).toEqual([]);

        const noBody = checkPublicationReadiness(buildPublicationFacts(units.map(unit => ({ ...unit, content: '---\nstatus: planned\n---\n' })), {
            mode: 'script', title: '剧本示例', author: '编剧', unitLabel: '集', includeChapterTitles: true, format: 'docx',
        }));
        expect(noBody.map(issue => issue.code)).toEqual(expect.arrayContaining(['no-body', 'empty-units']));
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
