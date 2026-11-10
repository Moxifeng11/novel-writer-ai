/**
 * D3-15 / D3-16（维度② r3）回归：
 * 1. append-marker 带字段：同文本追加到两个 frontmatter 字段时各记一条，
 *    回滚只删对应字段；标记在写盘前登记（写一半失败可回滚）。
 * 2. 跨卷快照不再「先删后写」，且与状态弹窗共用路径锁。
 */

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { SettlementJournal, removeMarkerOnce } from '../../../engine/settlement/settlement-journal';

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const FM = [
    '---',
    '已知信息: 铜牌（第1章）；密道（第1章）',
    '持有物品: 铜牌（第1章）',
    '---',
    '',
    '正文',
].join('\n');

function makePort(content: string) {
    let current = content;
    return {
        port: {
            read: async () => current,
            write: async (_p: string, next: string) => { current = next; },
            exists: async () => true,
        },
        frontmatter: {
            restoreField: async () => undefined,
            readField: async () => '',
        },
        get: () => current,
    };
}

describe('D3-15 append-marker 带字段', () => {
    it('同文本写入两个字段时各登记一条，回滚只删对应字段', async () => {
        const journal = new SettlementJournal();
        journal.recordAppend('char.md', '铜牌（第1章）', '已知信息');
        journal.recordAppend('char.md', '铜牌（第1章）', '持有物品');

        const { port, frontmatter, get } = makePort(FM);
        const report = await journal.rollback(port, frontmatter);

        expect(report.failed).toBe(0);
        const result = get();
        const lines = result.split('\n');
        const known = lines.find(line => line.startsWith('已知信息:'));
        const items = lines.find(line => line.startsWith('持有物品:'));
        // 已知信息还保留另一项，持有物品被清空该段
        expect(known).toBe('已知信息: 密道（第1章）');
        expect(items).toBe('持有物品:');
    });

    it('removeMarkerOnce 带字段时不影响其他字段的同名文本', () => {
        const result = removeMarkerOnce(FM, '铜牌（第1章）', '持有物品');
        expect(result).toContain('已知信息: 铜牌（第1章）；密道（第1章）');
        expect(result).toContain('持有物品:');
    });
});

describe('D3-15 标记写前登记', () => {
    it('成长与互信息追加都在 write 之前 recordAppend', () => {
        const src = read('engine/settlement-engine.ts');
        for (const anchor of ['growthEntry.trim()', 'entry.trim()']) {
            const recordIdx = src.indexOf(`ctx.journal.recordAppend(fp, ${anchor})`) >= 0
                ? src.indexOf(`ctx.journal.recordAppend(fp, ${anchor})`)
                : src.indexOf(`journal?.recordAppend(file.path, ${anchor})`);
            expect(recordIdx).toBeGreaterThan(-1);
            const writeIdx = src.indexOf('await this.getFS().write(', recordIdx);
            expect(writeIdx).toBeGreaterThan(recordIdx);
        }
    });
});

describe('D3-16 跨卷快照', () => {
    it('不再先删后写，且写入持路径锁', () => {
        const src = read('engine/cross-volume-integration.ts');
        expect(src).not.toContain('await this.getFS().delete(filePath)');
        expect(src).toContain('await withWriteLock(filePath, async () => {');
    });

    it('状态弹窗快照写入持同一路径锁', () => {
        const src = read('ui/cross-volume-state-modal.ts');
        expect(src).toContain('await withWriteLock(snapshotPath, async () => {');
    });
});
