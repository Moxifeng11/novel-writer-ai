/**
 * 结算日志落盘（崩溃可恢复）
 */

import { describe, expect, it } from 'vitest';
import { App, Vault } from 'obsidian';
import { SettlementJournalStore } from '@/services/settlement-journal-store';
import { SettlementJournal } from '@/engine/settlement/settlement-journal';

const PROJECT = '长篇小说/甲';

const make = () => {
    const vault = new Vault() as Vault & { _seedFile(path: string, content: string): unknown };
    const app = new App();
    app.vault = vault;
    return { app, store: new SettlementJournalStore(app, PROJECT) };
};

describe('SettlementJournalStore', () => {
    it('保存后可读回、clear 后消失', async () => {
        const { store } = make();
        await store.save('第1章', [{ kind: 'append-marker', path: `${PROJECT}/a.md`, marker: 'x' }]);
        const loaded = await store.load('第1章');
        expect(loaded).toHaveLength(1);
        expect((await store.listPending())).toEqual(['第1章']);
        await store.clear('第1章');
        expect(await store.load('第1章')).toBeNull();
        expect(await store.listPending()).toEqual([]);
    });

    it('空条目不落盘', async () => {
        const { store } = make();
        await store.save('第2章', []);
        expect(await store.load('第2章')).toBeNull();
    });

    it('日志损坏按无残留处理', async () => {
        const { app, store } = make();
        (app.vault as unknown as { _seedFile(p: string, c: string): unknown })
            ._seedFile(`${PROJECT}/04-项目总控/事务/结算回滚-第3章.json`, '{坏');
        expect(await store.load('第3章')).toBeNull();
    });
});

describe('SettlementJournal 快照', () => {
    it('snapshot/fromSnapshot 往返保留条目', () => {
        const journal = new SettlementJournal();
        journal.recordAppend(`${PROJECT}/a.md`, '追加内容');
        journal.recordField(`${PROJECT}/b.md`, 'status', 'written');
        const restored = SettlementJournal.fromSnapshot(journal.snapshot());
        expect(restored.size).toBe(2);
        expect(restored.snapshot()).toEqual(journal.snapshot());
    });

    it('记录触发落盘回调', () => {
        const journal = new SettlementJournal();
        const seen: number[] = [];
        journal.setChangeSink(entries => seen.push(entries.length));
        journal.recordAppend(`${PROJECT}/a.md`, 'x');
        journal.recordAppend(`${PROJECT}/a.md`, 'y');
        expect(seen).toEqual([1, 2]);
    });
});
