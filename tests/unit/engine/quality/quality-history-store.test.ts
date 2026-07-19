import { describe, it, expect, beforeEach } from 'vitest';
import {
    QualityHistoryStore,
    type QualityHistoryRecord,
} from '../../../../engine/quality/quality-history-store';

function makeRecord(score: number, timestamp?: number): QualityHistoryRecord {
    return {
        timestamp: timestamp ?? Date.now(),
        overallScore: score,
        scoreBreakdown: {
            readability: score,
            rhythm: score - 5,
            emotion: score + 5,
        },
    };
}

describe('QualityHistoryStore', () => {
    let store: QualityHistoryStore;

    beforeEach(() => {
        store = new QualityHistoryStore();
    });

    describe('addRecord / getHistory', () => {
        it('添加记录后可以通过 getHistory 获取', () => {
            const record = makeRecord(80, 1000);
            store.addRecord('c1', record);

            const history = store.getHistory('c1');
            expect(history).toBeDefined();
            expect(history!.length).toBe(1);
            expect(history![0].overallScore).toBe(80);
        });

        it('不存在的章节返回 null', () => {
            expect(store.getHistory('nonexistent')).toBeNull();
        });

        it('多次添加按顺序追加', () => {
            store.addRecord('c1', makeRecord(70, 1000));
            store.addRecord('c1', makeRecord(75, 2000));
            store.addRecord('c1', makeRecord(80, 3000));

            const history = store.getHistory('c1');
            expect(history!.length).toBe(3);
            expect(history![0].overallScore).toBe(70);
            expect(history![2].overallScore).toBe(80);
        });

        it('章节之间相互独立', () => {
            store.addRecord('c1', makeRecord(80, 1000));
            store.addRecord('c2', makeRecord(90, 1000));

            expect(store.getHistory('c1')!.length).toBe(1);
            expect(store.getHistory('c2')!.length).toBe(1);
        });
    });

    describe('getRecentRecords', () => {
        beforeEach(() => {
            for (let i = 0; i < 10; i++) {
                store.addRecord('c1', makeRecord(70 + i, 1000 + i * 1000));
            }
        });

        it('获取最近 N 条记录', () => {
            const recent = store.getRecentRecords('c1', 3);
            expect(recent.length).toBe(3);
            expect(recent[0].overallScore).toBe(77);
            expect(recent[2].overallScore).toBe(79);
        });

        it('N 大于总数时返回全部', () => {
            const recent = store.getRecentRecords('c1', 100);
            expect(recent.length).toBe(10);
        });

        it('不存在的章节返回空数组', () => {
            const recent = store.getRecentRecords('nonexistent', 5);
            expect(recent).toEqual([]);
        });
    });

    describe('clearHistory', () => {
        it('清除指定章节的历史', () => {
            store.addRecord('c1', makeRecord(80, 1000));
            store.addRecord('c2', makeRecord(90, 1000));

            store.clearHistory('c1');

            expect(store.getHistory('c1')).toBeNull();
            expect(store.getHistory('c2')!.length).toBe(1);
        });

        it('清除不存在的章节不报错', () => {
            expect(() => store.clearHistory('nonexistent')).not.toThrow();
        });
    });

    describe('clearAll', () => {
        it('清除所有章节的历史', () => {
            store.addRecord('c1', makeRecord(80, 1000));
            store.addRecord('c2', makeRecord(90, 1000));
            store.addRecord('c3', makeRecord(85, 1000));

            store.clearAll();

            expect(store.getHistory('c1')).toBeNull();
            expect(store.getHistory('c2')).toBeNull();
            expect(store.getHistory('c3')).toBeNull();
        });
    });

    describe('构造函数选项', () => {
        it('maxSize 可配置', () => {
            const store2 = new QualityHistoryStore({ maxSize: 3 });
            store2.addRecord('c1', makeRecord(70, 1000));
            store2.addRecord('c2', makeRecord(80, 1000));
            store2.addRecord('c3', makeRecord(90, 1000));
            store2.addRecord('c4', makeRecord(95, 1000));

            expect(store2.getHistory('c4')).toBeDefined();
        });

        it('ttlMs 可配置', () => {
            const store2 = new QualityHistoryStore({ ttlMs: 60000 });
            store2.addRecord('c1', makeRecord(80, Date.now()));
            expect(store2.getHistory('c1')).toBeDefined();
        });
    });

    describe('单章最多保留 50 条', () => {
        it('超过 50 条自动截断为最近 50 条', () => {
            for (let i = 0; i < 60; i++) {
                store.addRecord('c1', makeRecord(70 + i, 1000 + i * 1000));
            }

            const history = store.getHistory('c1');
            expect(history!.length).toBe(50);
            expect(history![0].overallScore).toBe(80);
            expect(history![49].overallScore).toBe(129);
        });
    });
});
