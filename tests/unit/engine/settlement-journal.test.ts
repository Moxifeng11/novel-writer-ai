/**
 * SettlementJournal — 三类回滚条目
 *
 * 决策：docs/design/g1-authority-decisions.md §2.2
 * - frontmatter-field / whole-file-before / append-marker
 * - 追加标记只删自己写的那段，不误伤结算期间其它合法写入
 */
import { describe, expect, it } from 'vitest';
import {
    SettlementJournal,
    removeMarkerOnce,
    type JournalFilePort,
    type JournalFrontmatterPort,
} from '../../../engine/settlement/settlement-journal';

function makeDisk(initial: Record<string, string> = {}) {
    const files = new Map(Object.entries(initial));
    const fs: JournalFilePort = {
        read: async (path) => files.get(path) ?? '',
        write: async (path, content) => { files.set(path, content); },
        exists: async (path) => files.has(path),
    };
    const fields = new Map<string, string>();
    const fm: JournalFrontmatterPort = {
        readField: async (path, field) => fields.get(`${path}#${field}`) ?? '',
        restoreField: async (path, field, value) => { fields.set(`${path}#${field}`, value); },
    };
    return { files, fields, fs, fm };
}

describe('SettlementJournal — 追加标记', () => {
    it('只移除本次追加的那一行，结算期间他处写入保留', async () => {
        const disk = makeDisk({
            'char.md': '# 甲\n\n## 变更记录\n- 第1章 | 境界 | 筑基 | 突破\n- 手工补充：性格变化\n',
        });
        const journal = new SettlementJournal();
        journal.recordAppend('char.md', '- 第1章 | 境界 | 筑基 | 突破');

        // 模拟结算期间另一个入口又写了一行
        disk.files.set('char.md', `${disk.files.get('char.md')}- 第2章 | 情绪 | 愤怒 | 争执\n`);

        const report = await journal.rollback(disk.fs, disk.fm);
        expect(report.failed).toBe(0);
        const content = disk.files.get('char.md')!;
        expect(content).not.toContain('第1章 | 境界');
        expect(content).toContain('手工补充：性格变化');
        expect(content).toContain('第2章 | 情绪');
    });

    it('文件已不存在时不算失败', async () => {
        const disk = makeDisk();
        const journal = new SettlementJournal();
        journal.recordAppend('gone.md', '- 某行');
        const report = await journal.rollback(disk.fs, disk.fm);
        expect(report.failed).toBe(0);
        expect(report.reverted).toBe(1);
    });

    it('同一 marker 只记录一次', () => {
        const journal = new SettlementJournal();
        journal.recordAppend('a.md', '- 行');
        journal.recordAppend('a.md', '- 行');
        expect(journal.size).toBe(1);
    });
});

describe('SettlementJournal — 整文件前值', () => {
    it('只记第一次写入前的内容，回滚恢复到该内容', async () => {
        const disk = makeDisk({ 'rel.md': '原始关系表' });
        const journal = new SettlementJournal();
        journal.recordWholeFile('rel.md', disk.files.get('rel.md')!);
        disk.files.set('rel.md', '结算后关系表');
        journal.recordWholeFile('rel.md', '不该覆盖的第二次前值');

        await journal.rollback(disk.fs, disk.fm);
        expect(disk.files.get('rel.md')).toBe('原始关系表');
    });
});

describe('SettlementJournal — frontmatter 字段', () => {
    it('恢复字段原值；同字段重复记录以第一次为准', async () => {
        const disk = makeDisk();
        const journal = new SettlementJournal();
        journal.recordField('char.md', '当前状态', '健康');
        journal.recordField('char.md', '当前状态', '受伤');
        await journal.rollback(disk.fs, disk.fm);
        expect(disk.fields.get('char.md#当前状态')).toBe('健康');
    });
});

describe('SettlementJournal — 回滚失败可见性', () => {
    it('单条失败不影响其它条目，并计入 failed', async () => {
        const journal = new SettlementJournal();
        journal.recordWholeFile('bad.md', 'before');
        journal.recordWholeFile('good.md', 'before');
        const fs: JournalFilePort = {
            read: async () => '',
            exists: async () => true,
            write: async (path) => {
                if (path === 'bad.md') throw new Error('disk full');
            },
        };
        const fm: JournalFrontmatterPort = {
            readField: async () => '',
            restoreField: async () => undefined,
        };

        const report = await journal.rollback(fs, fm);
        expect(report.failed).toBe(1);
        expect(report.reverted).toBe(1);
        expect(report.failures[0].error).toContain('disk full');
    });
});

describe('removeMarkerOnce — 行内片段', () => {
    it('移除连续性账本片段并清理分隔符', () => {
        const content = '已知信息: 玉佩（第1章）；身世（第2章）；师门（第3章）';
        const next = removeMarkerOnce(content, '身世（第2章）');
        expect(next).toBe('已知信息: 玉佩（第1章）；师门（第3章）');
    });

    it('移除末段时不留尾部分号', () => {
        const content = '伤势: 左臂（第1章）；内伤（第2章）';
        expect(removeMarkerOnce(content, '内伤（第2章）')).toBe('伤势: 左臂（第1章）');
    });

    it('marker 不存在时原样返回', () => {
        expect(removeMarkerOnce('abc', 'zzz')).toBe('abc');
    });
});
