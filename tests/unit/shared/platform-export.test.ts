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

    it('无前期调研时：简介回退 storyDoc 首个实质行，标签回退平台默认', () => {
        const pkg = buildPlatformPackage({
            mode: 'short',
            project: '短篇/无调研',
            preResearch: null,
            storyDoc: '# 简介\n她在殡仪馆替陌生人整理遗物，最后一单是自己的名字。',
            chapters: [{ content: '正文' }],
            wordCount: 1200,
        });
        expect(pkg.synopsis).toBe('她在殡仪馆替陌生人整理遗物，最后一单是自己的名字。');
        expect(pkg.tags).toEqual(['短篇', '现代', '反转']);
    });

    // v4.59.0 记录：平台包目前不校验简介/标签完整度（待产品接入），此处只锁现状，不改语义。
    it('无前期调研且无 storyDoc 时：简介为空，头部给出补填占位', () => {
        const pkg = buildPlatformPackage({
            mode: 'short',
            project: '短篇/空简介',
            preResearch: null,
            chapters: [{ content: '正文' }],
            wordCount: 800,
        });
        expect(pkg.synopsis).toBe('');
        expect(pkg.header).toContain('（未填写前期调研，建议补一句故事简介）');
    });

    it('调研字段为空时：标签回退平台默认而非空数组', () => {
        const pkg = buildPlatformPackage({
            mode: 'short',
            project: '短篇/空标签',
            preResearch: { ...shortResearch(), primaryCategory: '', plotTags: '' },
            chapters: [{ content: '正文' }],
            wordCount: 1500,
        });
        expect(pkg.tags).toEqual(['短篇', '现代', '反转']);
        expect(pkg.header).toContain('标签：短篇、现代、反转');
    });

    it('项目名为空或尾斜杠时：标题回退到未命名/末段目录名', () => {
        const empty = buildPlatformPackage({
            mode: 'short',
            project: '',
            preResearch: shortResearch(),
            chapters: [{ content: '正文' }],
            wordCount: 1000,
        });
        expect(empty.title).toBe('未命名');
        const trailing = buildPlatformPackage({
            mode: 'short',
            project: '短篇/第1卷/',
            preResearch: shortResearch(),
            chapters: [{ content: '正文' }],
            wordCount: 1000,
        });
        expect(trailing.title).toBe('第1卷');
    });

    it('字数只做透传：平台包不做下限阻断（下限由 publication-profile 三档判定）', () => {
        const pkg = buildPlatformPackage({
            mode: 'short',
            project: '短篇/字数边界',
            preResearch: shortResearch(),
            chapters: [{ content: '正文'.repeat(20) }],
            wordCount: 1000,
        });
        expect(pkg.wordCount).toBe(1000);
        expect(pkg.header).toContain('字数：1000 字');
    });

    it('敏感词覆盖简介与正文，并按命中次数降序', () => {
        const pkg = buildPlatformPackage({
            mode: 'script',
            project: '剧本/敏感词',
            preResearch: { ...scriptResearch(), logline: '赌博让她背上债务。' },
            chapters: [{ content: '赌博，赌博，暴力' }],
            wordCount: 800,
        });
        expect(pkg.hits[0]).toMatchObject({ term: '赌博', count: 3 });
        expect(pkg.hits[1]).toMatchObject({ term: '暴力', count: 1 });
        expect(pkg.header).toContain('风险提示：赌博×3（涉赌）');
    });
});
