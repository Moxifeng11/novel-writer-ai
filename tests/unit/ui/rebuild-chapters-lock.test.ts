/**
 * D3-3（维度② r3）：重建章节清理伏笔库/时间线必须锁内重读。
 *
 * 旧实现先读整文件、再过滤、再 modify；重建期间结算/分析追加的行会被旧快照覆盖。
 * 这里钉住：过滤只删目标章节行、无匹配不写盘、读写都走 withWriteLock。
 */

import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { TFile } from 'obsidian';

vi.mock('../../../main', () => ({
    default: class NovelWriterPlugin {},
}));

import { RebuildChaptersModal } from '../../../ui/rebuild-chapters-modal';

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const TABLE = [
    '# 伏笔库',
    '',
    '| 伏笔 | 状态 | 章节 |',
    '|------|------|------|',
    '| 铜牌 | 未揭示 | 第1章 |',
    '| 旧伤 | 已揭示 | 第2章 |',
    '| 密道 | 未揭示 | 第3章 |',
].join('\n');

function makeModal(content: string | null) {
    const writes: Array<{ path: string; content: string }> = [];
    const file = new TFile();
    file.path = '书A/02-时间线与伏笔/伏笔库.md';
    const modal = Object.create(RebuildChaptersModal.prototype) as Record<string, unknown>;
    modal.app = {
        vault: {
            getAbstractFileByPath: (p: string) => (content !== null && p === file.path ? file : null),
            read: async () => content ?? '',
            modify: async (f: TFile, next: string) => {
                writes.push({ path: f.path, content: next });
            },
        },
    };
    return {
        modal: modal as unknown as {
            removeChapterRows: (p: string, fn: (cols: string[]) => boolean) => Promise<void>;
        },
        writes,
    };
}

describe('RebuildChaptersModal.removeChapterRows', () => {
    it('只删除目标章节的数据行，表头与其他章节保留', async () => {
        const { modal, writes } = makeModal(TABLE);
        await modal.removeChapterRows(
            '书A/02-时间线与伏笔/伏笔库.md',
            (cols) => cols.length >= 4 && cols[3] === '第2章',
        );

        expect(writes).toHaveLength(1);
        const next = writes[0].content;
        expect(next).toContain('铜牌');
        expect(next).toContain('密道');
        expect(next).not.toContain('旧伤');
        expect(next).toContain('| 伏笔 | 状态 | 章节 |');
    });

    it('没有匹配行时不写盘', async () => {
        const { modal, writes } = makeModal(TABLE);
        await modal.removeChapterRows(
            '书A/02-时间线与伏笔/伏笔库.md',
            (cols) => cols.length >= 4 && cols[3] === '第99章',
        );
        expect(writes).toHaveLength(0);
    });

    it('文件不存在时安全返回', async () => {
        const { modal, writes } = makeModal(null);
        await expect(modal.removeChapterRows('不存在.md', () => true)).resolves.toBeUndefined();
        expect(writes).toHaveLength(0);
    });
});

describe('D3-3 接线契约', () => {
    it('读与写都在 withWriteLock(path) 内，且不再有裸 vault.modify 清理块', () => {
        const src = read('ui/rebuild-chapters-modal.ts');
        const lockIdx = src.indexOf('await withWriteLock(path, async () => {');
        const readIdx = src.indexOf('const current = await this.app.vault.read(file);', lockIdx);
        const modifyIdx = src.indexOf('await this.app.vault.modify(file, next);', lockIdx);

        expect(lockIdx).toBeGreaterThan(-1);
        expect(readIdx).toBeGreaterThan(lockIdx);
        expect(modifyIdx).toBeGreaterThan(readIdx);
        // 旧实现的两个裸 modify 变量名（ff/tf）不应再出现
        expect(src).not.toContain('this.app.vault.modify(ff, fc)');
        expect(src).not.toContain('this.app.vault.modify(tf, tc)');
    });
});
