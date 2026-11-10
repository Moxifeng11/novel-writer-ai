/**
 * D3-5 / D3-6（维度② r3）回归：
 * 1. versions.json / 回滚历史损坏时先归档 `.corrupt-*.bak`，再返回空索引；
 * 2. 标签/备注/回滚历史写入与保存/删除共用同一把索引锁；
 * 3. 项目改名后重写版本索引里的 project/sourcePath/versionPath。
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../main', () => ({
    default: class NovelWriterPlugin {},
}));

import { ChapterVersionService } from '../../../services/chapter-version-service';
import { ProjectRenameService } from '../../../services/project-rename-service';
import { pjVersionIndexFile, pjContentVersionsDir, pjRollbackHistoryFile, pjVersionsDir } from '../../../shared/paths';

function makeAdapter(initial: Record<string, string> = {}) {
    const map = new Map(Object.entries(initial));
    const writes: Array<{ path: string; content: string }> = [];
    const renames: Array<{ from: string; to: string }> = [];
    const adapter = {
        exists: async (p: string) => map.has(p) || [...map.keys()].some(k => k.startsWith(`${p}/`)),
        read: async (p: string) => {
            if (!map.has(p)) throw new Error(`missing: ${p}`);
            return map.get(p) as string;
        },
        write: async (p: string, content: string) => {
            map.set(p, content);
            writes.push({ path: p, content });
        },
        rename: async (from: string, to: string) => {
            const value = map.get(from);
            if (value === undefined) throw new Error(`missing: ${from}`);
            map.delete(from);
            map.set(to, value);
            renames.push({ from, to });
        },
        mkdir: async () => undefined,
        list: async (dir: string) => {
            const prefix = `${dir}/`;
            const inside = [...map.keys()].filter(p => p.startsWith(prefix));
            const files = inside.filter(p => !p.slice(prefix.length).includes('/'));
            const folders = [...new Set(
                inside
                    .map(p => prefix + p.slice(prefix.length).split('/')[0])
                    .filter(f => !files.includes(f)),
            )];
            return { files, folders };
        },
    };
    return { adapter, map, writes, renames };
}

function makeService(adapter: ReturnType<typeof makeAdapter>['adapter']) {
    return new ChapterVersionService({ vault: { adapter, getAbstractFileByPath: () => null } } as never);
}

describe('D3-5 版本索引损坏归档', () => {
    it('versions.json 解析失败时归档为 .corrupt-*.bak 并返回空索引', async () => {
        const indexPath = pjVersionIndexFile('书A', 'chapter', '第1章');
        const { adapter, renames } = makeAdapter({ [indexPath]: '{ not json' });
        const service = makeService(adapter);

        const index = await service.getVersionIndex('书A', 'chapter', '第1章', '书A/正文.md');

        expect(index.versions).toEqual([]);
        expect(renames).toHaveLength(1);
        expect(renames[0].from).toBe(indexPath);
        expect(renames[0].to).toMatch(/\.corrupt-\d+\.bak$/);
    });

    it('回滚历史损坏时同样归档', async () => {
        const historyPath = pjRollbackHistoryFile('书A');
        const { adapter, renames } = makeAdapter({ [historyPath]: 'oops' });
        const service = makeService(adapter);

        await expect(service.getRollbackHistory('书A')).resolves.toEqual([]);
        expect(renames[0].to).toMatch(/\.corrupt-\d+\.bak$/);
    });
});

describe('D3-5 元数据写入', () => {
    it('updateVersionTags 更新标签并写回索引', async () => {
        const indexPath = pjVersionIndexFile('书A', 'chapter', '第1章');
        const entry = {
            id: 'v1', version: 1, createdAt: new Date().toISOString(), type: 'manual',
            contentType: 'chapter', wordCount: 100, wordCountDelta: 100, lineCount: 5,
            tags: [], note: '', project: '书A', contentKey: '第1章',
            sourcePath: '书A/正文.md',
            versionPath: `${pjContentVersionsDir('书A', 'chapter', '第1章')}/v1.md`,
        };
        const index = { contentType: 'chapter', project: '书A', contentKey: '第1章', sourcePath: '书A/正文.md', latestVersion: 1, versions: [entry] };
        const { adapter, writes } = makeAdapter({ [indexPath]: JSON.stringify(index) });
        const service = makeService(adapter);

        await expect(service.updateVersionTags('书A', 'chapter', '第1章', 'v1', ['定稿'])).resolves.toBe(true);
        const saved = JSON.parse(writes[0].content);
        expect(saved.versions[0].tags).toEqual(['定稿']);
    });

    it('addRollbackRecord 在锁内读改写，新记录排在最前', async () => {
        const historyPath = pjRollbackHistoryFile('书A');
        const { adapter, writes } = makeAdapter({ [historyPath]: '[]' });
        const service = makeService(adapter);

        await service.addRollbackRecord({
            id: 'r1', project: '书A', contentType: 'chapter', contentKey: '第1章',
            fromVersion: 1, toVersion: 2, createdAt: new Date().toISOString(), reason: '测试',
        } as never);

        const saved = JSON.parse(writes[0].content);
        expect(saved[0].id).toBe('r1');
    });
});

describe('D3-6 项目改名迁移版本索引', () => {
    it('重写 project/sourcePath/versionPath 到新项目路径', async () => {
        const indexFile = `${pjVersionsDir('书B')}/chapter/第1章/versions.json`;
        const oldEntry = {
            id: 'v1', version: 1, createdAt: new Date().toISOString(), type: 'manual',
            contentType: 'chapter', wordCount: 100, wordCountDelta: 100, lineCount: 5,
            tags: [], note: '', project: '书A', contentKey: '第1章',
            sourcePath: '书A/正文/第1卷/第1章_正文.md',
            versionPath: '书A/版本管理/chapter/第1章/v1.md',
        };
        const { adapter, writes } = makeAdapter({
            [indexFile]: JSON.stringify({ project: '书A', contentType: 'chapter', contentKey: '第1章', latestVersion: 1, versions: [oldEntry] }),
        });
        const service = new ProjectRenameService({ vault: { adapter, getAbstractFileByPath: () => null } } as never);

        await (service as unknown as { migrateVersionIndexes: (a: string, b: string) => Promise<void> })
            .migrateVersionIndexes('书A', '书B');

        expect(writes).toHaveLength(1);
        const saved = JSON.parse(writes[0].content);
        expect(saved.project).toBe('书B');
        expect(saved.versions[0].project).toBe('书B');
        expect(saved.versions[0].sourcePath).toBe('书B/正文/第1卷/第1章_正文.md');
        expect(saved.versions[0].versionPath).toBe('书B/版本管理/chapter/第1章/v1.md');
    });
});
