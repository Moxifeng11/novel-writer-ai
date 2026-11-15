/**
 * FileTxService.recover 启动恢复（快乐路径）
 *
 * 背景：`file-tx-nonmd` 只覆盖「run 中途失败回滚」；如果 Obsidian 在
 * 写完日志、写完一部分文件后崩溃，下次启动靠 `recover()` 回滚。
 * 这条链路此前只有「日志损坏改名」测试，真正的 staged 回滚没有任何测试——
 * 一旦回归，用户会看到「写了一半的数据」且无人发现。
 */

import { describe, expect, it } from 'vitest';
import { App, Vault } from 'obsidian';
import { FileTxService } from '@/services/file-tx';
import { FILE_TX_VERSION, type FileTxJournal } from '@/shared/file-tx-model';
import { pjTxDir } from '@/shared/paths';

interface MockVault extends Vault {
    _seedFile(path: string, content: string): unknown;
    readByPath(path: string): Promise<string>;
}

const PROJECT = '长篇小说/恢复测试';

const makeApp = (): { app: App; vault: MockVault } => {
    const vault = new Vault() as MockVault;
    const app = new App();
    app.vault = vault;
    return { app, vault };
};

/** 落一份事务日志（模拟崩溃后残留） */
const seedJournal = (vault: MockVault, journal: FileTxJournal): string => {
    const path = `${pjTxDir(PROJECT)}/${journal.id}.json`;
    vault._seedFile(path, JSON.stringify({ version: FILE_TX_VERSION, journal }, null, 2) + '\n');
    return path;
};

const stagedJournal = (overrides: Partial<FileTxJournal> = {}): FileTxJournal => ({
    id: 'tx-20260101-0000-abcd',
    createdAt: 1_700_000_000_000,
    state: 'staged',
    ops: [],
    ...overrides,
});

describe('FileTxService.recover · 启动恢复中断事务', () => {
    it('staged：覆盖过的文件恢复旧内容，新建的文件被删除，日志清理', async () => {
        const { app, vault } = makeApp();
        vault._seedFile(`${PROJECT}/02-人物/甲.md`, '---\n状态: 走火入魔\n---\n甲');
        vault._seedFile(`${PROJECT}/04-项目总控/最新.json`, '{"new":true}');
        const journalPath = seedJournal(vault, stagedJournal({
            ops: [
                { path: `${PROJECT}/02-人物/甲.md`, content: '---\n状态: 健康\n---\n甲', before: '---\n状态: 走火入魔\n---\n甲' },
                { path: `${PROJECT}/04-项目总控/最新.json`, content: '{"new":true}', before: null },
            ],
        }));
        // 模拟崩溃前已写入的状态
        await vault.modify(vault.getAbstractFileByPath(`${PROJECT}/02-人物/甲.md`) as never, '---\n状态: 健康\n---\n甲');

        const service = new FileTxService(app);
        const recovered = await service.recover(PROJECT);
        expect(recovered).toBe(1);
        expect(await vault.readByPath(`${PROJECT}/02-人物/甲.md`)).toBe('---\n状态: 走火入魔\n---\n甲');
        expect(await vault.adapter.exists(`${PROJECT}/04-项目总控/最新.json`)).toBe(false);
        expect(await vault.adapter.exists(journalPath)).toBe(false);
    });

    it('committed：不回滚内容，只清理日志', async () => {
        const { app, vault } = makeApp();
        vault._seedFile(`${PROJECT}/笔记.md`, '新内容');
        const journalPath = seedJournal(vault, stagedJournal({
            state: 'committed',
            ops: [{ path: `${PROJECT}/笔记.md`, content: '新内容', before: '旧内容' }],
        }));

        const service = new FileTxService(app);
        const recovered = await service.recover(PROJECT);
        expect(recovered).toBe(0);
        expect(await vault.readByPath(`${PROJECT}/笔记.md`)).toBe('新内容');
        expect(await vault.adapter.exists(journalPath)).toBe(false);
    });

    it('多份日志：只回滚 staged，committed 只清理', async () => {
        const { app, vault } = makeApp();
        vault._seedFile(`${PROJECT}/a.md`, 'a2');
        vault._seedFile(`${PROJECT}/b.md`, 'b2');
        seedJournal(vault, stagedJournal({
            id: 'tx-1',
            ops: [{ path: `${PROJECT}/a.md`, content: 'a2', before: 'a1' }],
        }));
        seedJournal(vault, stagedJournal({
            id: 'tx-2',
            state: 'committed',
            ops: [{ path: `${PROJECT}/b.md`, content: 'b2', before: 'b1' }],
        }));

        const service = new FileTxService(app);
        expect(await service.recover(PROJECT)).toBe(1);
        expect(await vault.readByPath(`${PROJECT}/a.md`)).toBe('a1');
        expect(await vault.readByPath(`${PROJECT}/b.md`)).toBe('b2');
    });

    it('没有事务目录时返回 0（不抛错）', async () => {
        const { app } = makeApp();
        const service = new FileTxService(app);
        expect(await service.recover('长篇小说/空项目')).toBe(0);
    });
});
