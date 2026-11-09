import { describe, expect, it } from 'vitest';
import { App } from 'obsidian';
import {
    buildChapterDigest,
    formatChapterDigest,
    loadRecentChapterDigests,
    parseChapterDigest,
    renderChapterDigestBlock,
    writeChapterDigest,
} from '../../../engine/memory/chapter-digest';
import { ObsidianFileSystem } from '../../../shared/file-system-port';

const PROJECT = '长篇小说/测试书';

function digest(chapter: number, events: string[]) {
    return buildChapterDigest({
        chapterKey: `第${chapter}章`,
        bodyText: `正文结尾：第${chapter}章留下悬念。`,
        events,
        involved: ['林惊鸿', '苏雪', '林惊鸿'],
        unresolved: ['断裂的玉佩'],
        promises: ['三年之约'],
        generatedAt: '2026-11-09T00:00:00.000Z',
    });
}

describe('chapter-digest — 构建与往返', () => {
    it('确定性构建并去重', () => {
        const first = digest(3, ['入门', '试炼']);
        const second = digest(3, ['入门', '试炼']);
        expect(first).toEqual(second);
        expect(first.involved).toEqual(['林惊鸿', '苏雪']);
        expect(first.endingHook).toContain('悬念');
    });

    it('format/parse 往返保留关键字段', () => {
        const original = digest(3, ['入门', '试炼']);
        const parsed = parseChapterDigest(formatChapterDigest(original));
        expect(parsed).not.toBeNull();
        expect(parsed!.chapterKey).toBe('第3章');
        expect(parsed!.events).toEqual(['入门', '试炼']);
        expect(parsed!.involved).toEqual(['林惊鸿', '苏雪']);
        expect(parsed!.promises).toEqual(['三年之约']);
        expect(parsed!.endingHook).toContain('悬念');
    });

    it('prompt 段包含事件与未回收线索', () => {
        const block = renderChapterDigestBlock([digest(3, ['入门'])]);
        expect(block).toContain('第3章');
        expect(block).toContain('入门');
        expect(block).toContain('未回收');
    });
});

describe('chapter-digest — 文件与 3 章窗口', () => {
    it('写入后可读取，且只返回当前章之前的最近 N 章', async () => {
        const app = new App();
        const fs = new ObsidianFileSystem(app);
        for (let chapter = 1; chapter <= 3; chapter++) {
            await writeChapterDigest(app, fs, PROJECT, digest(chapter, [`事件${chapter}`]));
        }

        const all = await loadRecentChapterDigests(app, fs, PROJECT, 4, 3);
        expect(all.map((item) => item.chapterKey)).toEqual(['第1章', '第2章', '第3章']);

        const before2 = await loadRecentChapterDigests(app, fs, PROJECT, 2, 3);
        expect(before2.map((item) => item.chapterKey)).toEqual(['第1章']);

        const limited = await loadRecentChapterDigests(app, fs, PROJECT, 4, 2);
        expect(limited.map((item) => item.chapterKey)).toEqual(['第2章', '第3章']);
    });
});
