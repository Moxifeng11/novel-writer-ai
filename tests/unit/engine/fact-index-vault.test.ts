/**
 * Task 11 数据层接线 — FactIndexManager 的 vault 落盘 + 写库测试
 * 对应 spec: story-quality-closed-loop-optimization TR-11.4（落盘重启恢复）。
 */
import { describe, it, expect } from 'vitest';
import { MockFileSystem } from '../../../shared/file-system-port';
import { VaultFactStorage, VaultFactWriter } from '../../../engine/fact-index-vault';
import { FactIndexManager } from '../../../engine/fact-index-manager';
import type { PendingFact } from '../../../engine/fact-index-manager';

const PROJECT = '测试项目';
const INDEX_PATH = `${PROJECT}/04-项目总控/事实索引.json`;

function makeFact(overrides: Partial<PendingFact> = {}): PendingFact {
    return {
        id: 'character:林晚',
        category: 'character',
        name: '林晚',
        content: '左臂受伤',
        source: 'co-writer',
        createdAt: Date.now(),
        status: 'pending',
        ...overrides,
    };
}

describe('VaultFactStorage — JSON 落盘', () => {
    it('save 后 load 可恢复（重启恢复）', async () => {
        const fs = new MockFileSystem();
        const storage = new VaultFactStorage(fs, INDEX_PATH);
        await storage.save({ version: 1, pending: [], confirmed: [], updatedAt: Date.now() });

        const loaded = await storage.load();
        expect(loaded?.version).toBe(1);
    });

    it('文件不存在时 load 返回 null', async () => {
        const fs = new MockFileSystem();
        const storage = new VaultFactStorage(fs, INDEX_PATH);
        expect(await storage.load()).toBeNull();
    });

    it('文件损坏（非法 JSON）时 load 返回 null 不崩溃', async () => {
        const fs = new MockFileSystem();
        fs.setFile(INDEX_PATH, 'not-a-json');
        const storage = new VaultFactStorage(fs, INDEX_PATH);
        expect(await storage.load()).toBeNull();
    });
});

describe('VaultFactWriter — 写正式库', () => {
    it('character 事实写入人物 .md', async () => {
        const fs = new MockFileSystem();
        const writer = new VaultFactWriter(fs, PROJECT);
        await writer.writeFact(makeFact());

        const content = await fs.read(`${PROJECT}/01-世界架构/人物/林晚.md`);
        expect(content).toContain('已确认事实：林晚');
        expect(content).toContain('左臂受伤');
    });

    it('world 事实写入世界观总览.md，plot 写入叙事总览.md', async () => {
        const fs = new MockFileSystem();
        const writer = new VaultFactWriter(fs, PROJECT);
        await writer.writeFact(makeFact({ id: 'world:皇城东市', category: 'world', name: '皇城东市', content: '三教九流之地' }));
        await writer.writeFact(makeFact({ id: 'plot:密信之谜', category: 'plot', name: '密信之谜', content: '半张纸条' }));

        expect(await fs.read(`${PROJECT}/01-世界架构/世界观总览.md`)).toContain('皇城东市');
        expect(await fs.read(`${PROJECT}/04-项目总控/叙事总览.md`)).toContain('密信之谜');
    });
});

describe('FactIndexManager 端到端（vault 接线）', () => {
    it('confirm 后写正式库 + 落盘，重启后 confirmed 恢复', async () => {
        const fs = new MockFileSystem();
        const mgr = new FactIndexManager(
            new VaultFactStorage(fs, INDEX_PATH),
            new VaultFactWriter(fs, PROJECT),
        );

        const facts = mgr.extractNewFacts('[[林晚]]踏入《皇城东市》。');
        await mgr.enqueue(facts);
        await mgr.confirm(facts[0].id);

        // 正式库已写入（facts[0] 为 character 林晚）
        expect(await fs.read(`${PROJECT}/01-世界架构/人物/林晚.md`)).toContain('已确认事实');

        // 模拟重启：新实例 load
        const mgr2 = new FactIndexManager(
            new VaultFactStorage(fs, INDEX_PATH),
            new VaultFactWriter(fs, PROJECT),
        );
        await mgr2.load();
        expect(mgr2.listConfirmed().length).toBe(1);
        expect(mgr2.listPending().length).toBe(1); // 剩余 world 事实仍 pending
    });
});
