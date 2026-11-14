/**
 * file-tx-model 单测：事务日志模型（创建/提交/回滚计划/解析）
 */

import { describe, expect, it } from 'vitest';
import {
    createJournal,
    createTxId,
    describeJournal,
    FILE_TX_VERSION,
    markCommitted,
    needsRollback,
    parseJournalFile,
    rollbackPlan,
    type FileTxOp,
} from '@/shared/file-tx-model';

const ops: FileTxOp[] = [
    { path: 'p/a.md', content: 'A2', before: 'A1' },
    { path: 'p/b.md', content: 'B1', before: null },
];

describe('createTxId 事务 id', () => {
    it('包含时间戳且可复现', () => {
        expect(createTxId(1000, 0)).toBe('tx-1000-0000');
    });

    it('随机后缀长度为 4', () => {
        const id = createTxId(1000, 0.5);
        expect(id.split('-')[2]).toHaveLength(4);
    });
});

describe('createJournal / markCommitted', () => {
    it('新事务为 staged', () => {
        const journal = createJournal(ops, 1000, 0.1);
        expect(journal.state).toBe('staged');
        expect(journal.createdAt).toBe(1000);
        expect(journal.ops).toHaveLength(2);
    });

    it('标记提交后状态为 committed', () => {
        expect(markCommitted(createJournal(ops)).state).toBe('committed');
    });

    it('创建时复制 ops，不共享引用', () => {
        const source: FileTxOp[] = [{ path: 'p/x.md', content: 'c', before: null }];
        const journal = createJournal(source);
        source[0].content = 'changed';
        expect(journal.ops[0].content).toBe('c');
    });
});

describe('needsRollback / rollbackPlan', () => {
    it('staged 需要回滚，committed 不需要', () => {
        const staged = createJournal(ops);
        expect(needsRollback(staged)).toBe(true);
        expect(needsRollback(markCommitted(staged))).toBe(false);
    });

    it('回滚计划恢复 before；原本不存在则标记为删除（null）', () => {
        expect(rollbackPlan(createJournal(ops))).toEqual([
            { path: 'p/a.md', content: 'A1' },
            { path: 'p/b.md', content: null },
        ]);
    });
});

describe('describeJournal 摘要', () => {
    it('包含 id、状态与文件数', () => {
        const text = describeJournal(createJournal(ops, 1000, 0));
        expect(text).toContain('tx-1000-');
        expect(text).toContain('未完成');
        expect(text).toContain('2 个文件');
    });

    it('已提交显示已提交', () => {
        expect(describeJournal(markCommitted(createJournal(ops)))).toContain('已提交');
    });
});

describe('parseJournalFile 解析', () => {
    const journal = createJournal(ops, 1000, 0);
    const raw = JSON.stringify({ version: FILE_TX_VERSION, journal });

    it('正常解析', () => {
        expect(parseJournalFile(raw)?.id).toBe(journal.id);
    });

    it('版本不符返回 null', () => {
        expect(parseJournalFile(JSON.stringify({ version: 0, journal }))).toBeNull();
    });

    it('缺少 ops 返回 null', () => {
        expect(parseJournalFile(JSON.stringify({ version: FILE_TX_VERSION, journal: { id: 'x' } }))).toBeNull();
    });

    it('损坏 JSON 返回 null（不阻断启动）', () => {
        expect(parseJournalFile('{oops')).toBeNull();
    });
});
