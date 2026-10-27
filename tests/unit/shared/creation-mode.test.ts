import { describe, expect, it } from 'vitest';
import {
    CREATION_MODE_SPECS,
    SCRIPT_GENRES,
    SCRIPT_SPEC,
    SHORT_STORY_CATEGORIES,
    SHORT_STORY_SPEC,
    buildCreationModeGuide,
    buildCreationModeMetaSection,
    getCreationModePromptBlock,
    getCreationUnitLabel,
    parseCreationMode,
    parseCreationModeMeta,
} from '../../../shared/creation-mode';

describe('creation-mode — 三模式领域层', () => {
    it('短篇/剧本目标字数为 5–10 万', () => {
        expect(CREATION_MODE_SPECS.short.targetWords.min).toBe(50000);
        expect(CREATION_MODE_SPECS.short.targetWords.max).toBe(100000);
        expect(CREATION_MODE_SPECS.script.targetWords.min).toBe(50000);
        expect(CREATION_MODE_SPECS.script.targetWords.max).toBe(100000);
        expect(SHORT_STORY_SPEC.wordRange).toEqual({ min: 50000, max: 100000 });
        expect(SCRIPT_SPEC.wordRange).toEqual({ min: 50000, max: 100000 });
    });

    it('番茄短篇分类完整覆盖 24 类与性别频道', () => {
        expect(SHORT_STORY_CATEGORIES).toHaveLength(24);
        expect(new Set(SHORT_STORY_CATEGORIES.map(c => c.name)).size).toBe(24);
        expect(SHORT_STORY_CATEGORIES.find(c => c.name === '婚姻家庭')?.gender).toBe('女频');
        expect(SHORT_STORY_CATEGORIES.find(c => c.name === '都市日常')?.gender).toBe('男频');
        expect(SHORT_STORY_CATEGORIES.find(c => c.name === '年代')?.gender).toBe('通用');
        expect(SHORT_STORY_CATEGORIES.find(c => c.name === '纯爱')?.gender).toBe('女频');
    });

    it('红果短剧类型包含核心钩子/冲突/兑现', () => {
        expect(SCRIPT_GENRES.length).toBeGreaterThanOrEqual(10);
        for (const genre of SCRIPT_GENRES) {
            expect(genre.coreHook).toBeTruthy();
            expect(genre.coreConflict).toBeTruthy();
            expect(genre.payoff).toBeTruthy();
        }
    });

    it('解析 .project 模式元数据', () => {
        const meta = parseCreationModeMeta(`# 书\n\n## 创作模式\nshort\n\n## 短篇分类\n婚姻家庭\n\n## 目标字数\n60000\n`);
        expect(meta.mode).toBe('short');
        expect(meta.shortCategory).toBe('婚姻家庭');
        expect(meta.targetWords).toBe(60000);
        expect(getCreationUnitLabel('short')).toBe('节');
        expect(parseCreationMode('剧本')).toBe('script');
        expect(parseCreationMode('')).toBe('long');
    });

    it('模式元数据可写回 .project', () => {
        const section = buildCreationModeMetaSection({
            mode: 'script', shortCategory: '', scriptGenre: '都市逆袭', targetWords: 80000, targetUnits: 80,
        });
        expect(section).toContain('## 创作模式\nscript');
        expect(section).toContain('## 剧本类型\n都市逆袭');
        expect(section).toContain('## 目标集数\n80');
    });

    it('短篇/剧本 prompt block 有硬约束，长篇为空', () => {
        const shortBlock = getCreationModePromptBlock('short', { shortCategory: '婚姻家庭' });
        expect(shortBlock).toContain('番茄短篇小说');
        expect(shortBlock).toContain('5–10 万字');
        const scriptBlock = getCreationModePromptBlock('script', { scriptGenre: '都市逆袭' });
        expect(scriptBlock).toContain('红果短剧');
        expect(scriptBlock).toContain('VO/字幕');
        expect(getCreationModePromptBlock('long')).toBe('');
    });

    it('项目指南写入对应平台规则', () => {
        const shortGuide = buildCreationModeGuide({
            mode: 'short', shortCategory: '青春虐恋', scriptGenre: '', targetWords: 80000, targetUnits: 20,
        });
        expect(shortGuide).toContain('番茄短篇小说创作规则');
        expect(shortGuide).toContain('青春虐恋');
        expect(shortGuide).toContain('5–10 万字');
        const scriptGuide = buildCreationModeGuide({
            mode: 'script', shortCategory: '', scriptGenre: '甜宠', targetWords: 80000, targetUnits: 80,
        });
        expect(scriptGuide).toContain('红果短剧快车道创作规则');
        expect(scriptGuide).toContain('目标集数: 80');
    });
});
