import { describe, expect, it } from 'vitest';
import { buildPlatformPackage, scanPlatformSensitive } from '../../../shared/platform-export';
import { createDefaultPreResearch, type ShortPreResearch, type ScriptPreResearch } from '../../../shared/pre-research';

function shortResearch(): ShortPreResearch {
    return {
        ...createDefaultPreResearch('short') as ShortPreResearch,
        mode: 'short',
        primaryCategory: '都市',
        premise: '替人收拾残局的女人，最后一次交易遇到三年前不告而别的人。',
        coreConflict: '她想拿钱走人，他想让她留下。',
        plotTags: '反转、旧情、悬念',
        targetSections: 3,
    };
}

function scriptResearch(): ScriptPreResearch {
    return {
        ...createDefaultPreResearch('script') as ScriptPreResearch,
        mode: 'script',
        genre: '都市情感',
        logline: '一纸合同把两个旧情人重新绑在一起。',
        hook3s: '她把合同拍在桌上，说签字或者我走。',
        audience: '女频、都市',
        targetEpisodes: 3,
    };
}

describe('platform-export — 平台投稿包', () => {
    it('短篇：番茄平台、简介/标签/字数/单元数齐全', () => {
        const pkg = buildPlatformPackage({
            mode: 'short',
            project: '短篇小说/雨夜合同',
            preResearch: shortResearch(),
            chapters: [{ content: '正文'.repeat(500) }, { content: '正文'.repeat(500) }],
            wordCount: 2000,
        });
        expect(pkg.platform.name).toBe('番茄小说短篇');
        expect(pkg.title).toBe('雨夜合同');
        expect(pkg.synopsis).toContain('替人收拾残局');
        expect(pkg.tags).toContain('都市');
        expect(pkg.header).toContain('平台：番茄小说短篇');
        expect(pkg.header).toContain('字数：2000 字');
        expect(pkg.unitCount).toBe(2);
    });

    it('剧本：红果平台与类型/受众标签', () => {
        const pkg = buildPlatformPackage({
            mode: 'script',
            project: '剧本/旧合同',
            preResearch: scriptResearch(),
            chapters: [{ content: '第1场 日 内 咖啡馆' }],
            wordCount: 900,
        });
        expect(pkg.platform.name).toBe('红果短剧');
        expect(pkg.synopsis).toContain('一纸合同');
        expect(pkg.tags).toEqual(expect.arrayContaining(['都市情感', '女频', '都市']));
        expect(pkg.platform.unitLabel).toBe('集');
    });

    it('敏感词命中计数并去重', () => {
        const hits = scanPlatformSensitive('赌博，赌博，暴力冲突');
        expect(hits.find(hit => hit.term === '赌博')?.count).toBe(2);
        expect(hits.find(hit => hit.term === '暴力')?.count).toBe(1);
    });
});
