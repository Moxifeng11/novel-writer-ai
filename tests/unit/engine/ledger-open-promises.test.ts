import { describe, expect, it } from 'vitest';
import { openPromises } from '../../../engine/ledger/ledger-index';
import type { PromiseRecord } from '../../../engine/ledger/ledger-model';

/**
 * F-3 二轮复核（2026-11-10）回归：openPromises 旧实现按 `expected >= chapter`
 * 过滤，把「已逾期仍 open」的承诺剔除——恰是最该提醒的条目。修复后仅按状态
 * 过滤，逾期项排序置前。
 */

function promise(name: string, expectedChapter: string, status = 'open'): PromiseRecord {
    return {
        id: `PR-${name}`,
        name,
        type: '角色承诺',
        raisedChapter: '第1章',
        raisedBy: '林玄',
        expectedChapter,
        status,
        lastAdvancedChapter: '',
        note: '',
    };
}

describe('openPromises — 逾期承诺不再被剔除（F-3 二轮）', () => {
    const ledger = {
        events: [],
        foreshadows: [],
        links: [],
        issues: [],
        promises: [
            promise('未到期', '第9章'),
            promise('已逾期', '第2章'),
            promise('无预期', '待定'),
            promise('已兑现', '第3章', 'resolved'),
        ],
    } as never as Parameters<typeof openPromises>[0];

    it('逾期仍 open 的承诺保留，按预期章升序排列', () => {
        const result = openPromises(ledger, 5);
        expect(result.map((record) => record.name)).toEqual(['已逾期', '未到期', '无预期']);
    });

    it('resolved/dropped 仍被过滤', () => {
        expect(openPromises(ledger, 5).some((record) => record.name === '已兑现')).toBe(false);
    });

    it('安全盲审：否定表述（未兑现/未放弃/未解决）不被子串误判为已关闭', () => {
        const negationLedger = {
            events: [], foreshadows: [], links: [], issues: [],
            promises: [
                promise('未兑现之诺', '第5章'),
                promise('未放弃的执念', '第6章'),
                promise('未解决的谜', '第7章'),
            ],
        } as never as Parameters<typeof openPromises>[0];
        const result = openPromises(negationLedger, 3);
        expect(result.map((record) => record.name)).toEqual(['未兑现之诺', '未放弃的执念', '未解决的谜']);
    });

    it('chapter=null 时仅按状态过滤', () => {
        expect(openPromises(ledger, null).map((record) => record.name)).toEqual(['未到期', '已逾期', '无预期']);
    });
});
