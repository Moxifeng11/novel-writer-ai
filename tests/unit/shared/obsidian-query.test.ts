import { describe, expect, it } from 'vitest';
import type { App } from 'obsidian';
import { findNotesWithProperty, queryProjectNotes } from '../../../shared/obsidian-query';

const PROJECT = '长篇小说/测试书';

interface FakeFile {
    path: string;
    name: string;
    basename: string;
    extension: string;
}

function file(relative: string): FakeFile {
    const full = `${PROJECT}/${relative}`;
    const name = full.split('/').pop()!;
    return { path: full, name, basename: name.replace(/\.md$/, ''), extension: 'md' };
}

const body = file('03-大纲与章节/正文/第1章.md');
const timeline = file('02-时间线与伏笔/时间线看板.md');
const relationship = file('01-世界架构/关系状态.md');
const other = file('05-其他/随笔.md');

const app = {
    vault: {
        getMarkdownFiles: () => [body, timeline, relationship, other],
    },
    metadataCache: {
        getFileCache: (target: FakeFile) => {
            const map: Record<string, Record<string, unknown>> = {
                [body.path]: { tags: ['正文'], status: 'written', word_count: 1200 },
                [timeline.path]: { tags: ['时间线'], 事件总数: 12 },
                [relationship.path]: { tags: ['关系状态'], 关系对数: 3 },
                [other.path]: { tags: ['随笔'], 情绪: '平静' },
            };
            return { frontmatter: map[target.path] ?? {} };
        },
    },
} as unknown as App;

describe('obsidian-query — 项目内查询', () => {
    it('按类型筛选（含无标签的台账路径兜底）', () => {
        expect(queryProjectNotes(app, PROJECT, { kind: 'body' })).toEqual([body]);
        expect(queryProjectNotes(app, PROJECT, { kind: 'timeline' })).toEqual([timeline]);
        expect(queryProjectNotes(app, PROJECT, { kind: 'relationship' })).toEqual([relationship]);
    });

    it('按标签与自定义条件筛选', () => {
        expect(queryProjectNotes(app, PROJECT, { tag: '关系状态' })).toEqual([relationship]);
        expect(queryProjectNotes(app, PROJECT, {
            where: (frontmatter) => Number(frontmatter['word_count'] ?? 0) > 1000,
        })).toEqual([body]);
    });

    it('按属性存在性筛选', () => {
        expect(findNotesWithProperty(app, PROJECT, '事件总数')).toEqual([timeline]);
        expect(findNotesWithProperty(app, PROJECT, '情绪', (value) => value === '平静')).toEqual([other]);
    });

    it('排除目录生效', () => {
        expect(queryProjectNotes(app, PROJECT, {
            excludeFolders: ['02-时间线与伏笔'],
        })).toEqual([relationship, body, other]);
    });

    it('项目外文件不返回', () => {
        expect(queryProjectNotes(app, PROJECT, { kind: 'body' })).toEqual([body]);
        expect(queryProjectNotes(app, '另一本书', { kind: 'body' })).toEqual([]);
    });
});
