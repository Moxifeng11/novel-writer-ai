import { describe, expect, it } from 'vitest';
import type { App } from 'obsidian';
import { EntityIndex, entityIdOf, normalizeEntityName } from '../../../shared/entity-index';

const PROJECT = '长篇小说/测试书';

interface FakeFile {
    path: string;
    name: string;
    basename: string;
    extension: string;
    stat: { mtime: number };
}

function file(relative: string, mtime = 1): FakeFile {
    const full = `${PROJECT}/${relative}`;
    const name = full.split('/').pop()!;
    return {
        path: full,
        name,
        basename: name.replace(/\.md$/, ''),
        extension: 'md',
        stat: { mtime },
    };
}

function makeApp(files: FakeFile[], frontmatter: Record<string, Record<string, unknown>>): App {
    const folders = new Map<string, unknown>();
    const put = (dir: string, children: FakeFile[]): void => {
        folders.set(dir, { path: dir, name: dir.split('/').pop(), children });
    };
    put(`${PROJECT}/01-世界架构/人物`, files.filter((f) => f.path.includes('/人物/')));
    put(`${PROJECT}/01-世界架构/势力`, files.filter((f) => f.path.includes('/势力/')));
    put(`${PROJECT}/01-世界架构/地点`, files.filter((f) => f.path.includes('/地点/')));
    put(`${PROJECT}/01-世界架构/物品功法`, files.filter((f) => f.path.includes('/物品功法/')));

    return {
        vault: {
            getAbstractFileByPath: (path: string) => folders.get(path.replace(/\/+$/, '')) ?? null,
        },
        metadataCache: {
            getFileCache: (target: FakeFile) => ({ frontmatter: frontmatter[target.path] ?? {} }),
        },
    } as unknown as App;
}

describe('entity-index — 构建与解析', () => {
    const lin = file('01-世界架构/人物/林惊鸿.md');
    const linAlias = file('01-世界架构/人物/林砚.md');
    const loc = file('01-世界架构/地点/青云宗.md');
    const app = makeApp([lin, linAlias, loc], {
        [lin.path]: { 姓名: '林惊鸿', 别称: '惊鸿剑', tags: ['人物', 'nw/实体/人物'] },
        [linAlias.path]: { 姓名: '林砚', tags: ['人物'] },
        [loc.path]: { 名称: '青云宗', tags: ['地点'] },
    });

    it('按类型生成稳定 ID', () => {
        const index = EntityIndex.build(app, PROJECT);
        expect(index.size).toBe(3);
        const record = index.resolve('林惊鸿').matches[0];
        expect(record.kind).toBe('character');
        expect(record.id).toBe(entityIdOf('character', '林惊鸿'));
        expect(record.id).toMatch(/^ENT-[0-9a-f]{8}$/);
    });

    it('姓名、别称、文件名都可解析', () => {
        const index = EntityIndex.build(app, PROJECT);
        expect(index.resolve('林惊鸿').matches).toHaveLength(1);
        expect(index.resolve('惊鸿剑').matches[0].name).toBe('林惊鸿');
        expect(index.resolve('林砚').matches[0].name).toBe('林砚');
    });

    it('规范化去除书名号/双链/空白', () => {
        expect(normalizeEntityName('[[林 惊鸿]]')).toBe('林惊鸿');
        expect(normalizeEntityName('《青云宗》')).toBe('青云宗');
    });

    it('可按类型收窄，未命中返回 unresolved', () => {
        const index = EntityIndex.build(app, PROJECT);
        expect(index.resolve('青云宗', 'location').matches).toHaveLength(1);
        expect(index.resolve('青云宗', 'character').unresolved).toBe(true);
        expect(index.resolve('不存在').unresolved).toBe(true);
    });

    it('同名多实体标记 ambiguous', () => {
        const a = file('01-世界架构/人物/甲.md', 1);
        const b = file('01-世界架构/地点/甲.md', 2);
        const dupApp = makeApp([a, b], {
            [a.path]: { 姓名: '甲' },
            [b.path]: { 名称: '甲' },
        });
        const index = EntityIndex.build(dupApp, PROJECT);
        const resolution = index.resolve('甲');
        expect(resolution.ambiguous).toBe(true);
        expect(resolution.matches).toHaveLength(2);
        expect(index.problems.some((issue) => issue.type === 'duplicate-name')).toBe(true);
    });
});
