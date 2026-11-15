/**
 * 结算崩溃恢复：engine.recoverInterruptedSettlement 端到端
 *
 * 背景：`settlement-journal` / `settlement-journal-store` 只测了日志语义与落盘，
 * `recoverInterruptedSettlement`（把残留日志真正回滚到文件/frontmatter）此前
 * **没有任何引擎级测试**——这是「结算崩了别丢数据」的最后一道保险，回归了
 * 用户只会看到「实体改了、正文没结算」的半套状态。
 *
 * 覆盖：dryRun 预览不改数据；三类条目（整份文件 / frontmatter 字段 / 追加标记）
 * 真实回滚；单条失败时日志保留可重试；损坏日志跳过不炸。
 */

import { describe, expect, it } from 'vitest';
import { App, TFile, TFolder, Vault } from 'obsidian';
import { SettlementEngine } from '@/engine/settlement-engine';
import type { JournalEntry } from '@/engine/settlement/settlement-journal';
import type { FileSystemPort, FrontmatterPort, VaultMetaPort } from '@/shared/file-system-port';

const PROJECT = '长篇小说/崩溃测试';
const TX_DIR = `${PROJECT}/04-项目总控/事务`;
const CHAR_PATH = `${PROJECT}/02-人物/甲.md`;
const FM_PATH = `${PROJECT}/02-人物/乙.md`;
const LEDGER_PATH = `${PROJECT}/04-项目总控/伏笔库.md`;

interface MockVault extends Vault {
    _seedFile(path: string, content: string): void;
    readByPath(path: string): Promise<string>;
    write(path: string, content: string): Promise<void>;
    exists(path: string): boolean;
}

const parseFields = (raw: string): Record<string, string> => {
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) return {};
    const fields: Record<string, string> = {};
    for (const line of match[1].split(/\r?\n/)) {
        const idx = line.indexOf(':');
        if (idx > 0) fields[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
    return fields;
};

const serializeFields = (raw: string, fields: Record<string, unknown>): string => {
    let next = raw;
    for (const [key, value] of Object.entries(fields)) {
        const line = `${key}: ${value == null ? '' : String(value)}`;
        if (new RegExp(`^${key}:`, 'm').test(next)) next = next.replace(new RegExp(`^${key}:.*$`, 'm'), line);
        else next = next.replace(/^---\n/, `---\n${line}\n`);
    }
    return next;
};

const makeHarness = (seed: Record<string, string>) => {
    const vault = new Vault() as MockVault;
    for (const [path, content] of Object.entries(seed)) vault._seedFile(path, content);
    const app = new App();
    app.vault = vault;
    const state = { failWrites: null as RegExp | null };

    const fs: FileSystemPort = {
        read: async (path: string) => vault.readByPath(path),
        write: async (path: string, content: string) => {
            if (state.failWrites?.test(path)) throw new Error(`模拟写入失败: ${path}`);
            await vault.write(path, content);
        },
        exists: async (path: string) => vault.exists(path),
        getFile: async () => null,
        getFolder: async () => null,
        listFiles: async () => [],
        listFolders: async () => [],
        mkdir: async () => undefined,
        delete: async (path: string) => { await vault.adapter.remove(path); },
        listAll: async () => [],
        rename: async (from: string, to: string) => {
            await vault.write(to, await vault.readByPath(from));
            await vault.adapter.remove(from);
        },
    };

    const frontmatter: FrontmatterPort = {
        processFrontmatter: async (file: TFile, updater: (fm: Record<string, unknown>) => void) => {
            const raw = await vault.readByPath(file.path);
            const fields: Record<string, unknown> = { ...parseFields(raw) };
            updater(fields);
            await vault.write(file.path, serializeFields(raw, fields));
        },
    };

    const vaultMeta: VaultMetaPort = {
        getFiles: () => [],
        getFolders: () => [],
        getAbstractFileByPath: (path: string) => vault.getAbstractFileByPath(path) as TFile | TFolder | null,
    };

    const engine = new SettlementEngine(app as never, {
        fs,
        frontmatter,
        vaultMeta,
        notifier: { showNotice: () => undefined } as never,
    });

    return { engine, vault, state };
};

const seedJournal = (vault: MockVault, chapterName: string, entries: JournalEntry[]): string => {
    const path = `${TX_DIR}/结算回滚-${chapterName}.json`;
    vault._seedFile(path, JSON.stringify({ version: 1, chapterName, startedAt: 1_700_000_000_000, entries }, null, 2));
    return path;
};

const seedBase = (): Record<string, string> => ({
    [CHAR_PATH]: '# 甲\n\n状态：健康\n',
    [FM_PATH]: '---\n当前状态: 健康\n---\n# 乙\n',
    [LEDGER_PATH]: '# 伏笔库\n\n- 旧线索\n第3章：新增线索\n',
});

const journalEntries = (): JournalEntry[] => [
    { kind: 'whole-file-before', path: CHAR_PATH, before: '# 甲\n\n状态：走火入魔\n' },
    { kind: 'frontmatter-field', path: FM_PATH, field: '当前状态', before: '走火入魔' },
    { kind: 'append-marker', path: LEDGER_PATH, marker: '第3章：新增线索' },
];

describe('recoverInterruptedSettlement · 结算崩溃恢复', () => {
    it('dryRun：只报告条目数，不改文件、不删日志', async () => {
        const h = makeHarness(seedBase());
        const journalPath = seedJournal(h.vault, '第1章', journalEntries());

        const result = await h.engine.recoverInterruptedSettlement(PROJECT, undefined, true);
        expect(result.chapters).toEqual([{ chapterName: '第1章', entries: 3, reverted: 0, failed: 0, cleared: false }]);
        expect(await h.vault.readByPath(CHAR_PATH)).toContain('健康');
        expect(await h.vault.readByPath(FM_PATH)).toContain('当前状态: 健康');
        expect(await h.vault.readByPath(LEDGER_PATH)).toContain('新增线索');
        expect(h.vault.exists(journalPath)).toBe(true);
    });

    it('真实恢复：整份文件 / frontmatter 字段 / 追加标记 都回滚，日志清理', async () => {
        const h = makeHarness(seedBase());
        const journalPath = seedJournal(h.vault, '第1章', journalEntries());

        const result = await h.engine.recoverInterruptedSettlement(PROJECT);
        expect(result.chapters).toEqual([{ chapterName: '第1章', entries: 3, reverted: 3, failed: 0, cleared: true }]);
        expect(await h.vault.readByPath(CHAR_PATH)).toBe('# 甲\n\n状态：走火入魔\n');
        expect(await h.vault.readByPath(FM_PATH)).toContain('当前状态: 走火入魔');
        expect(await h.vault.readByPath(LEDGER_PATH)).toBe('# 伏笔库\n\n- 旧线索\n');
        expect(h.vault.exists(journalPath)).toBe(false);
    });

    it('单条回滚失败：计入 failed、日志保留（可重试），其余条目照常恢复', async () => {
        const h = makeHarness(seedBase());
        h.state.failWrites = /甲\.md$/;
        const journalPath = seedJournal(h.vault, '第1章', journalEntries());

        const result = await h.engine.recoverInterruptedSettlement(PROJECT);
        expect(result.chapters[0].failed).toBe(1);
        expect(result.chapters[0].cleared).toBe(false);
        expect(h.vault.exists(journalPath)).toBe(true);
        expect(await h.vault.readByPath(FM_PATH)).toContain('当前状态: 走火入魔');

        // 故障修复后重试成功
        h.state.failWrites = null;
        const retry = await h.engine.recoverInterruptedSettlement(PROJECT);
        expect(retry.chapters[0].cleared).toBe(true);
        expect(await h.vault.readByPath(CHAR_PATH)).toBe('# 甲\n\n状态：走火入魔\n');
        expect(h.vault.exists(journalPath)).toBe(false);
    });

    it('损坏日志跳过：不抛错，其它章节照常恢复', async () => {
        const h = makeHarness(seedBase());
        h.vault._seedFile(`${TX_DIR}/结算回滚-损坏章.json`, '{ 这不是 JSON');
        const journalPath = seedJournal(h.vault, '第1章', journalEntries());

        const result = await h.engine.recoverInterruptedSettlement(PROJECT);
        expect(result.chapters.map(item => item.chapterName)).toEqual(['第1章']);
        expect(result.chapters[0].reverted).toBe(3);
        expect(h.vault.exists(journalPath)).toBe(false);
    });
});
