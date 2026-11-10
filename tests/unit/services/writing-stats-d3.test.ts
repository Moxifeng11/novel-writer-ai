/**
 * D3-11（维度② r3）：字数台账的原子写、损坏留档与项目改名迁移。
 */

import { describe, expect, it } from 'vitest';
import { WritingStatsService } from '../../../services/writing-stats-service';

function makeAdapter(disk: Map<string, string>) {
    const renames: Array<{ from: string; to: string }> = [];
    const adapter = {
        exists: async (p: string) => disk.has(p),
        read: async (p: string) => {
            const value = disk.get(p);
            if (value === undefined) throw new Error(`missing ${p}`);
            return value;
        },
        write: async (p: string, data: string) => { disk.set(p, data); },
        mkdir: async () => undefined,
        rename: async (from: string, to: string) => {
            const value = disk.get(from);
            if (value === undefined) throw new Error(`missing ${from}`);
            disk.delete(from);
            disk.set(to, value);
            renames.push({ from, to });
        },
        remove: async (p: string) => { disk.delete(p); },
    };
    return { adapter, renames };
}

function makeService(disk: Map<string, string>, ledgerPath = 'data/writing-stats.json') {
    const { adapter, renames } = makeAdapter(disk);
    const app = {
        vault: { adapter },
        metadataCache: { getFileCache: () => null },
    };
    const service = new WritingStatsService({
        app: app as never,
        ledgerPath,
        isBodyPath: (p: string) => p.includes('_正文.md'),
        listBodyFiles: () => [],
        now: () => 1_700_000_000_000,
    });
    return { service, renames };
}

const LEDGER = JSON.stringify({
    version: 1,
    days: { '2026-11-10': 100 },
    projects: { '长篇小说/书A': { '2026-11-10': 100 } },
    files: {
        '长篇小说/书A/正文/第1卷/第1章_正文.md': { count: 100, mtime: 1, project: '长篇小说/书A' },
    },
    updatedAt: 1,
});

describe('WritingStatsService — 损坏留档', () => {
    it('台账损坏时先改名 .corrupt-<ts>.bak 再按空台账继续', async () => {
        const disk = new Map<string, string>([['data/writing-stats.json', '{broken']]);
        const { service, renames } = makeService(disk);

        await service.load();

        expect(service.getReport().global.total).toBe(0);
        expect(renames).toHaveLength(1);
        expect(renames[0].to).toMatch(/\.corrupt-\d+\.bak$/);
    });
});

describe('WritingStatsService — 原子写', () => {
    it('经 tmp + rename 落盘，不直接覆盖台账', async () => {
        const disk = new Map<string, string>([['data/writing-stats.json', LEDGER]]);
        const { service, renames } = makeService(disk);

        await service.migrateProjectPath('长篇小说/书A', '长篇小说/书B');

        // 至少一次 rename：tmp → 正式文件
        expect(renames.some(r => r.to === 'data/writing-stats.json')).toBe(true);
        expect(disk.has('data/writing-stats.json')).toBe(true);
        // 没有遗留 tmp
        expect([...disk.keys()].some(k => k.includes('.tmp-'))).toBe(false);
    });
});

describe('WritingStatsService — 项目改名迁移', () => {
    it('projects 键与 files 路径前缀都迁到新项目，历史日产出保留', async () => {
        const disk = new Map<string, string>([['data/writing-stats.json', LEDGER]]);
        const { service } = makeService(disk);

        const changed = await service.migrateProjectPath('长篇小说/书A', '长篇小说/书B');
        expect(changed).toBe(true);

        const saved = JSON.parse(disk.get('data/writing-stats.json') as string);
        expect(saved.projects['长篇小说/书B']).toEqual({ '2026-11-10': 100 });
        expect(saved.projects['长篇小说/书A']).toBeUndefined();
        expect(saved.files['长篇小说/书B/正文/第1卷/第1章_正文.md']).toMatchObject({
            count: 100,
            project: '长篇小说/书B',
        });
        expect(saved.files['长篇小说/书A/正文/第1卷/第1章_正文.md']).toBeUndefined();
    });

    it('无变化时不写盘', async () => {
        const disk = new Map<string, string>([['data/writing-stats.json', LEDGER]]);
        const { service, renames } = makeService(disk);

        await expect(service.migrateProjectPath('长篇小说/不存在', '长篇小说/书B')).resolves.toBe(false);
        expect(renames).toHaveLength(0);
    });
});
