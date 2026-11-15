/**
 * 项目索引 v2 测试：frontmatter 字段提取、精准查询、名称解析
 */

import { describe, expect, it } from 'vitest';
import {
    buildProjectIndex,
    extractIndexFields,
    ENTITY_TYPE_LABELS,
    normalizeLookup,
    queryEntries,
    resolveEntity,
    typeFromDeclared,
    typeFromPath,
} from '@/shared/project-index-model';

const files = [
    {
        path: '长篇小说/书A/01-世界架构/人物/CHR-0001_林玄.md', name: 'CHR-0001_林玄', size: 10, mtime: 1,
        fields: { type: 'character' as const, id: 'CHR-0001', tags: ['nw/人物', 'nw/人物/主角'], aliases: ['林玄', '小玄'], summary: '主角', status: 'active', storyTime: '开篇' },
    },
    {
        path: '长篇小说/书A/01-世界架构/人物/CHR-0002_苏婉.md', name: 'CHR-0002_苏婉', size: 10, mtime: 1,
        fields: { type: 'character' as const, id: 'CHR-0002', tags: ['nw/人物'], aliases: ['苏婉'], summary: '女主' },
    },
    {
        path: '长篇小说/书A/01-世界架构/关系/REL-0001_CHR-0001_CHR-0002.md', name: 'REL-0001_CHR-0001_CHR-0002', size: 10, mtime: 1,
        fields: { type: 'relation' as const, id: 'REL-0001', tags: ['nw/实体/关系'], aliases: [] },
    },
    {
        path: '长篇小说/书A/02-时间线与伏笔/伏笔/FSH-0001_断剑.md', name: 'FSH-0001_断剑', size: 10, mtime: 1,
        fields: { type: 'foreshadow' as const, id: 'FSH-0001', tags: ['nw/实体/伏笔', 'nw/伏笔/未回收'], aliases: [], status: 'planted', storyTime: '第3章' },
    },
];

const index = buildProjectIndex('长篇小说/书A', files, 1000);

describe('extractIndexFields', () => {
    it('读 type/id/tags/aliases/summary/status/storyTime', () => {
        const fields = extractIndexFields({
            type: 'character', id: 'CHR-0009', tags: ['nw/人物', '#nw/主角'],
            aliases: ['甲', '乙'], 简介: '简介文本', status: 'active', 首次出场: '第1章',
        }, 'a/b.md');
        expect(fields.type).toBe('character');
        expect(fields.id).toBe('CHR-0009');
        expect(fields.tags).toEqual(['nw/人物', 'nw/主角']);
        expect(fields.aliases).toEqual(['甲', '乙']);
        expect(fields.summary).toBe('简介文本');
        expect(fields.status).toBe('active');
        expect(fields.storyTime).toBe('第1章');
    });

    it('中文键别名（别称/别名/曾用名）都收集', () => {
        const fields = extractIndexFields({ 别称: '小玄', 别名: '阿玄', 曾用名: '玄子' }, 'a.md');
        expect(fields.aliases).toEqual(['小玄', '阿玄', '玄子']);
    });

    it('无 frontmatter 时 type 由路径兜底', () => {
        expect(extractIndexFields(undefined, '长篇小说/书A/01-世界架构/人物/林玄.md').type).toBe('character');
    });

    it('tags 字符串写法也能解析', () => {
        expect(extractIndexFields({ tags: 'nw/人物, nw/主角' }, 'a.md').tags).toEqual(['nw/人物', 'nw/主角']);
    });
});

describe('typeFromDeclared / typeFromPath', () => {
    it('声明类型中英文都识别', () => {
        expect(typeFromDeclared('人物')).toBe('character');
        expect(typeFromDeclared('Foreshadow')).toBe('foreshadow');
        expect(typeFromDeclared('unknown-type')).toBeNull();
    });

    it('按 nw/* 标签推断', () => {
        expect(typeFromPath('a.md', ['nw/实体/伏笔'])).toBe('foreshadow');
        expect(typeFromPath('a.md', ['nw/设定/世界观'])).toBe('worldview');
    });

    it('中文名表完整', () => {
        expect(ENTITY_TYPE_LABELS.character).toBe('人物');
        expect(ENTITY_TYPE_LABELS.foreshadow).toBe('伏笔');
    });
});

describe('queryEntries 精准查询', () => {
    it('按 ID 精确', () => {
        expect(queryEntries(index, { id: 'CHR-0001' }).map(entry => entry.id)).toEqual(['CHR-0001']);
    });

    it('按类型精确', () => {
        expect(queryEntries(index, { type: 'relation' }).map(entry => entry.id)).toEqual(['REL-0001']);
    });

    it('按标签精确', () => {
        expect(queryEntries(index, { tag: 'nw/伏笔/未回收' }).map(entry => entry.id)).toEqual(['FSH-0001']);
    });

    it('按别名精确（归一化后全等，不做子串）', () => {
        expect(queryEntries(index, { alias: '小玄' }).map(entry => entry.id)).toEqual(['CHR-0001']);
        expect(queryEntries(index, { alias: '小' })).toEqual([]);
    });

    it('按标题精确', () => {
        expect(queryEntries(index, { title: 'CHR-0002_苏婉' }).map(entry => entry.id)).toEqual(['CHR-0002']);
    });

    it('按路径前缀', () => {
        expect(queryEntries(index, { folder: '长篇小说/书A/01-世界架构/人物' })).toHaveLength(2);
    });

    it('text 仅模糊搜索（不用于注入）', () => {
        expect(queryEntries(index, { text: '女主' }).map(entry => entry.id)).toEqual(['CHR-0002']);
    });

    it('limit 生效', () => {
        expect(queryEntries(index, { limit: 1 })).toHaveLength(1);
    });
});

describe('resolveEntity 名称解析', () => {
    it('精确 ID 命中', () => {
        expect(resolveEntity(index, 'CHR-0001').match?.id).toBe('CHR-0001');
    });

    it('精确标题命中', () => {
        expect(resolveEntity(index, 'CHR-0002_苏婉').match?.id).toBe('CHR-0002');
    });

    it('精确别名命中', () => {
        expect(resolveEntity(index, '小玄').match?.id).toBe('CHR-0001');
    });

    it('子串不命中（禁止模糊）', () => {
        expect(resolveEntity(index, '林').found).toBe(false);
    });

    it('多义返回候选不自动选', () => {
        const dup = buildProjectIndex('p', [
            { path: 'p/a/人物/同名.md', name: '同名', size: 1, mtime: 1, fields: { type: 'character', aliases: [] } },
            { path: 'p/b/人物/同名.md', name: '同名', size: 1, mtime: 1, fields: { type: 'character', aliases: [] } },
        ]);
        const result = resolveEntity(dup, '同名');
        expect(result.match).toBeUndefined();
        expect(result.candidates).toHaveLength(2);
    });
});

describe('normalizeLookup', () => {
    it('去双链/别名竖线/空白并小写', () => {
        expect(normalizeLookup('[[林玄|小玄]]')).toBe('林玄');
        expect(normalizeLookup('  林 玄 ')).toBe('林玄');
        expect(normalizeLookup('ＡＢＣ')).toBe('abc');
    });
});
