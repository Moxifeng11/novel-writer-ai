/**
 * project-index-model 单测：类别推断 / 构建 / 统计 / 匹配 / 过期判定
 */

import { describe, expect, it } from 'vitest';
import {
    buildProjectIndex,
    entriesOfKind,
    indexCounts,
    inferIndexKind,
    isIndexStale,
    matchIndexEntries,
    PROJECT_INDEX_VERSION,
} from '@/shared/project-index-model';

const file = (path: string, size = 100, mtime = 1) => ({
    path,
    name: path.split('/').pop()!.replace(/\.md$/, ''),
    size,
    mtime,
});

describe('inferIndexKind 类别推断', () => {
    const cases: Array<[string, string]> = [
        ['长篇小说/书A/03-大纲与章节/正文/第1卷/第1章_开篇_正文.md', 'chapter'],
        ['长篇小说/书A/03-大纲与章节/步骤结果/第1卷/第1章/第1章_信息规划.md', 'artifact'],
        ['长篇小说/书A/01-世界架构/人物/林玄.md', 'character'],
        ['长篇小说/书A/01-世界架构/地点/青云宗.md', 'location'],
        ['长篇小说/书A/01-世界架构/势力/外门.md', 'faction'],
        ['长篇小说/书A/01-世界架构/物品/玄铁令.md', 'item'],
        ['长篇小说/书A/02-时间线与伏笔/时间线.md', 'timeline'],
        ['长篇小说/书A/04-项目总控/一致性审核/事实库.json', 'fact'],
        ['长篇小说/书A/01-世界架构/世界观总览.md', 'setting'],
        ['长篇小说/书A/03-大纲与章节/分卷大纲/第1卷.md', 'outline'],
        ['长篇小说/书A/随便一个文件.md', 'other'],
    ];

    for (const [path, expected] of cases) {
        it(`${path.split('/').pop()} → ${expected}`, () => {
            expect(inferIndexKind(path)).toBe(expected);
        });
    }

    it('Windows 反斜杠路径同样可识别', () => {
        expect(inferIndexKind('长篇小说\\书A\\01-世界架构\\人物\\林玄.md')).toBe('character');
    });
});

describe('buildProjectIndex 构建', () => {
    it('生成带版本与时间戳的索引，条目按路径排序', () => {
        const index = buildProjectIndex('长篇小说/书A', [file('长篇小说/书A/b.md'), file('长篇小说/书A/a.md')], 1234);
        expect(index.version).toBe(PROJECT_INDEX_VERSION);
        expect(index.updatedAt).toBe(1234);
        expect(index.entries.map(entry => entry.name)).toEqual(['a', 'b']);
    });

    it('只放摘要，不含正文（条目字段固定）', () => {
        const index = buildProjectIndex('p', [file('p/01-世界架构/人物/林玄.md', 42, 99)]);
        expect(index.entries[0]).toEqual({
            path: 'p/01-世界架构/人物/林玄.md',
            name: '林玄',
            kind: 'character',
            size: 42,
            mtime: 99,
        });
    });
});

describe('indexCounts / entriesOfKind', () => {
    const index = buildProjectIndex('p', [
        file('p/01-世界架构/人物/林玄.md'),
        file('p/01-世界架构/人物/苏婉.md'),
        file('p/01-世界架构/地点/青云宗.md'),
        file('p/03-大纲与章节/正文/第1章_开篇_正文.md'),
    ]);

    it('按类别统计', () => {
        expect(indexCounts(index)).toEqual({ character: 2, location: 1, chapter: 1 });
    });

    it('按类别筛选', () => {
        expect(entriesOfKind(index, 'character').map(entry => entry.name)).toEqual(['林玄', '苏婉']);
    });
});

describe('matchIndexEntries 关键字匹配', () => {
    const index = buildProjectIndex('p', [
        file('p/01-世界架构/人物/林玄.md'),
        file('p/01-世界架构/人物/苏婉.md'),
        file('p/01-世界架构/地点/青云宗.md'),
    ]);

    it('空关键字返回全部（受 limit 限制）', () => {
        expect(matchIndexEntries(index, '', 2)).toHaveLength(2);
    });

    it('按名称子串匹配', () => {
        expect(matchIndexEntries(index, '林').map(entry => entry.name)).toEqual(['林玄']);
    });

    it('按路径匹配（可搜目录）', () => {
        expect(matchIndexEntries(index, '地点').map(entry => entry.name)).toEqual(['青云宗']);
    });

    it('大小写不敏感', () => {
        const en = buildProjectIndex('p', [file('p/01-世界架构/人物/LinXuan.md')]);
        expect(matchIndexEntries(en, 'linxuan')).toHaveLength(1);
    });
});

describe('isIndexStale 过期判定', () => {
    const files = [file('p/a.md', 10, 100), file('p/b.md', 20, 200)];
    const index = buildProjectIndex('p', files);

    it('完全一致 → 不过期', () => {
        expect(isIndexStale(index, files)).toBe(false);
    });

    it('新增文件 → 过期', () => {
        expect(isIndexStale(index, [...files, file('p/c.md')])).toBe(true);
    });

    it('删除文件 → 过期', () => {
        expect(isIndexStale(index, [files[0]])).toBe(true);
    });

    it('mtime 变化 → 过期', () => {
        expect(isIndexStale(index, [files[0], file('p/b.md', 20, 201)])).toBe(true);
    });

    it('size 变化 → 过期', () => {
        expect(isIndexStale(index, [files[0], file('p/b.md', 21, 200)])).toBe(true);
    });

    it('路径替换（改名）→ 过期', () => {
        expect(isIndexStale(index, [files[0], file('p/b2.md', 20, 200)])).toBe(true);
    });

    it('版本不符 → 过期', () => {
        expect(isIndexStale({ ...index, version: 0 as never }, files)).toBe(true);
    });
});
