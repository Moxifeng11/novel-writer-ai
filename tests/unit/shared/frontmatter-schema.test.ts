import { describe, expect, it } from 'vitest';
import {
    bodyLegacyTagForMode,
    findMissingProperties,
    readTagList,
    requiredProperties,
    resolveFileKind,
} from '../../../shared/frontmatter-schema';

describe('frontmatter-schema — 文件类型判定', () => {
    it('层级标签优先', () => {
        expect(resolveFileKind({ tags: ['nw/实体/人物', '人物'] }, 'x.md')).toBe('character');
        expect(resolveFileKind({ tags: ['nw/步骤/分析报告'] }, 'x.md')).toBe('step');
        expect(resolveFileKind({ tags: ['nw/正文'] }, 'x.md')).toBe('body');
    });

    it('旧标签兜底', () => {
        expect(resolveFileKind({ tags: ['人物'] })).toBe('character');
        expect(resolveFileKind({ tags: ['物品功法'] })).toBe('item');
        expect(resolveFileKind({ tags: ['分析报告'] })).toBe('step');
        expect(resolveFileKind({ tags: ['短篇正文'] })).toBe('body');
        expect(resolveFileKind({ tags: ['剧本'] })).toBe('body');
    });

    it('无标签时按路径兜底', () => {
        expect(resolveFileKind({}, '长篇小说/甲/03-大纲与章节/正文/第1卷/第1章_正文.md')).toBe('body');
        expect(resolveFileKind({}, '长篇小说/甲/03-大纲与章节/步骤结果/第1卷/第1章/分析报告.md')).toBe('step');
        expect(resolveFileKind({}, '长篇小说/甲/01-世界架构/人物/武昭.md')).toBe('character');
        expect(resolveFileKind({}, '剧本创作/乙/03-剧本/第01集.md')).toBe('body');
    });

    it('无法判定返回 unknown', () => {
        expect(resolveFileKind({}, '随便/笔记.md')).toBe('unknown');
        expect(resolveFileKind(null)).toBe('unknown');
    });

    it('tags 兼容字符串形式', () => {
        expect(readTagList('正文, nw/正文')).toEqual(['正文', 'nw/正文']);
        expect(readTagList(['#人物'])).toEqual(['人物']);
        expect(readTagList(undefined)).toEqual([]);
    });
});

describe('frontmatter-schema — 缺失必填属性', () => {
    it('正文缺 status/word_count 时列出', () => {
        const missing = findMissingProperties('body', { 卷: '第1卷' });
        expect(missing.map((spec) => spec.key)).toEqual(['status', 'word_count']);
    });

    it('已有值不再列出；空串算缺失', () => {
        expect(findMissingProperties('body', { status: 'written', word_count: 0 })).toEqual([]);
        expect(findMissingProperties('body', { status: '  ', word_count: 0 }).map((spec) => spec.key)).toEqual(['status']);
    });

    it('人物只要求姓名', () => {
        expect(requiredProperties('character').map((spec) => spec.key)).toEqual(['姓名']);
        expect(findMissingProperties('character', { 姓名: '武昭' })).toEqual([]);
    });

    it('unknown 类型无必填项', () => {
        expect(findMissingProperties('unknown', {})).toEqual([]);
    });

    it('模式 → 正文标签', () => {
        expect(bodyLegacyTagForMode('long')).toBe('正文');
        expect(bodyLegacyTagForMode('short')).toBe('短篇正文');
        expect(bodyLegacyTagForMode('script')).toBe('剧本');
    });
});