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
            // 忠实化 Obsidian 语义：目标已存在时抛错（否则「目标存在仍 rename」的
            // 写法在测试里永远绿、生产必炸——本项目已踩过两次）
            if (disk.has(to)) throw new Error('Destination file already exists!');
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
    it('**目标已存在时直接覆盖写**（rename 覆盖会抛 Destination file already exists）', async () => {
        const disk = new Map<string, string>([['data/writing-stats.json', LEDGER]]);
        const { service, renames } = makeService(disk);

        await service.migrateProjectPath('长篇小说/书A', '长篇小说/书B');

        // 目标已存在 → 不能再走 rename（否则抛错、统计永久丢失）
        expect(renames).toHaveLength(0);
        expect(disk.has('data/writing-stats.json')).toBe(true);
        // 没有遗留 tmp
        expect([...disk.keys()].some(k => k.includes('.tmp-'))).toBe(false);
        // 内容确实更新了
        const saved = JSON.parse(disk.get('data/writing-stats.json') as string);
        expect(saved.projects['长篇小说/书B']).toBeDefined();
    });

    it('目标不存在时仍走 tmp + rename（保留崩溃安全）', async () => {
        const disk = new Map<string, string>();
        const { service, renames } = makeService(disk);

        await service.migrateProjectPath('长篇小说/书A', '长篇小说/书B');

        // 空台账 + 无变化通常不写盘；只要写了就必须是 rename 路径且无 tmp 残留
        expect([...disk.keys()].some(k => k.includes('.tmp-'))).toBe(false);
        expect(renames.every(r => r.to === 'data/writing-stats.json')).toBe(true);
    });

    it('**连续两次落盘都成功**（回归锁：曾因 rename 覆盖导致第二次起全部丢失）', async () => {
        const disk = new Map<string, string>([['data/writing-stats.json', LEDGER]]);
        const { service } = makeService(disk);

        await service.migrateProjectPath('长篇小说/书A', '长篇小说/书B');
        const afterFirst = JSON.parse(disk.get('data/writing-stats.json') as string);

        await service.migrateProjectPath('长篇小说/书B', '长篇小说/书C');
        const afterSecond = JSON.parse(disk.get('data/writing-stats.json') as string);

        expect(afterFirst.projects['长篇小说/书B']).toBeDefined();
        expect(afterSecond.projects['长篇小说/书C']).toBeDefined();
        expect(afterSecond.projects['长篇小说/书B']).toBeUndefined();
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
