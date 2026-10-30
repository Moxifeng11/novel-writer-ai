import { describe, expect, it, beforeEach } from 'vitest';
import {
    ExecutionLedger,
    formatRunRecord,
    getExecutionLedger,
    resetExecutionLedger,
    runDurationMs,
    summarizeSettlement,
} from '../../../services/execution-ledger';

describe('execution-ledger — 长流程执行登记表', () => {
    let ledger: ExecutionLedger;

    beforeEach(() => {
        ledger = new ExecutionLedger();
    });

    describe('begin / finish', () => {
        it('开始后是 running，结束后带状态与耗时', () => {
            const id = ledger.begin({ commandId: 'novel-writer-write-chapter', project: '长篇小说/测试', source: 'ui' });
            expect(ledger.getRunning()).toHaveLength(1);
            expect(ledger.getRecent()[0].status).toBe('running');

            ledger.finish(id, { status: 'done', detail: '已生成并结算', at: Date.now() + 5000 });
            const record = ledger.getRecent()[0];
            expect(record.status).toBe('done');
            expect(record.detail).toBe('已生成并结算');
            expect(runDurationMs(record)).toBeGreaterThanOrEqual(5000);
            expect(ledger.getRunning()).toHaveLength(0);
        });

        it('finish 带 failure 时自动判失败', () => {
            const id = ledger.begin({ commandId: 'x', project: 'p', source: 'agent' });
            ledger.finish(id, { failure: 'API 超时' });
            expect(ledger.getRecent()[0].status).toBe('failed');
            expect(ledger.getRecent()[0].failure).toBe('API 超时');
        });

        it('对不存在的 id finish 返回 false', () => {
            expect(ledger.finish('run_404', { status: 'done' })).toBe(false);
        });

        it('recordCompleted / recordFailed 一步到底', () => {
            ledger.recordCompleted({ commandId: 'export', project: 'p', source: 'ui', detail: '3 章 / 9000 字' });
            ledger.recordFailed({ commandId: 'batch', project: 'p', source: 'agent', failure: '未注册' });
            const [latest, older] = ledger.getRecent();
            expect(latest.status).toBe('failed');
            expect(older.status).toBe('done');
            expect(older.detail).toBe('3 章 / 9000 字');
        });
    });

    describe('容量与顺序', () => {
        it('新的在前，最多保留 20 条', () => {
            for (let i = 0; i < 25; i++) {
                ledger.recordCompleted({ commandId: `cmd-${i}`, project: 'p', source: 'ui' });
            }
            const recent = ledger.getRecent();
            expect(recent).toHaveLength(20);
            expect(recent[0].commandId).toBe('cmd-24');
            expect(recent[19].commandId).toBe('cmd-5');
        });

        it('getRecent(limit) 截断；非法 limit 不报错', () => {
            for (let i = 0; i < 5; i++) ledger.recordCompleted({ commandId: `c${i}`, project: 'p', source: 'ui' });
            expect(ledger.getRecent(2)).toHaveLength(2);
            expect(ledger.getRecent(0)).toHaveLength(0);
            expect(ledger.getRecent(-1)).toHaveLength(0);
        });

        it('返回的是副本，外部改动不污染登记表', () => {
            ledger.recordCompleted({ commandId: 'c', project: 'p', source: 'ui' });
            const record = ledger.getRecent()[0];
            record.detail = '被改了';
            expect(ledger.getRecent()[0].detail).toBeUndefined();
        });

        it('clear 清空并复位序号', () => {
            ledger.recordCompleted({ commandId: 'c', project: 'p', source: 'ui' });
            ledger.clear();
            expect(ledger.isEmpty).toBe(true);
            expect(ledger.begin({ commandId: 'c', project: 'p' })).toBe('run_1');
        });
    });

    describe('结算摘要', () => {
        it('投影 SettlementResult 的关键计数', () => {
            const summary = summarizeSettlement({
                updated: 12,
                created: 4,
                updatedChars: 3,
                updatedForeshadows: 2,
                rejectedFields: [{ a: 1 }, { a: 2 }],
                missingEntities: [{ b: 1 }],
                linkFieldWrites: 5,
                recordedBehaviors: 6,
                foreshadowLoop: { pass: false, summary: '缺一次回收' },
            });
            expect(summary).toEqual({
                updated: 12,
                created: 4,
                updatedChars: 3,
                updatedForeshadows: 2,
                rejected: 2,
                missingEntities: 1,
                linkFieldWrites: 5,
                recordedBehaviors: 6,
                foreshadowLoop: { pass: false, summary: '缺一次回收' },
            });
        });

        it('null/空对象安全；伏笔闭环缺 summary 时给默认文案', () => {
            const empty = summarizeSettlement(null);
            expect(empty.updated).toBe(0);
            expect(empty.foreshadowLoop).toBeUndefined();
            const withLoop = summarizeSettlement({ foreshadowLoop: { pass: true } });
            expect(withLoop.foreshadowLoop).toEqual({ pass: true, summary: '伏笔闭环通过' });
        });

        it('attachSettlement 缺 id 时挂到该项目最近的结算记录', () => {
            ledger.recordCompleted({ commandId: 'novel-writer-export-manuscript', project: '长篇小说/测试' });
            ledger.begin({ commandId: 'novel-writer-chapter-settlement', project: '长篇小说/测试' });
            expect(ledger.attachSettlement('长篇小说/测试', summarizeSettlement({ updated: 3 }))).toBe(true);
            const settlementRecord = ledger.getRecent().find(record => record.commandId.includes('settlement'));
            expect(settlementRecord?.settlement?.updated).toBe(3);
        });
    });

    describe('formatRunRecord', () => {
        it('包含状态/命令/项目/耗时/结算计数字段', () => {
            ledger.recordCompleted({
                commandId: 'novel-writer-chapter-settlement',
                project: '长篇小说/测试',
                detail: '第3章 结算表已写入',
                settlement: summarizeSettlement({
                    updated: 9, created: 2, updatedForeshadows: 1,
                    missingEntities: [{}, {}], rejectedFields: [{}], linkFieldWrites: 4,
                    recordedBehaviors: 3,
                    foreshadowLoop: { pass: true, summary: '通过' },
                }),
                at: 1000,
            });
            const record = ledger.getRecent()[0];
            record.finishedAt = 4000;
            const text = formatRunRecord(record);
            expect(text).toContain('完成');
            expect(text).toContain('novel-writer-chapter-settlement');
            expect(text).toContain('长篇小说/测试');
            expect(text).toContain('耗时 3s');
            expect(text).toContain('更新 9');
            expect(text).toContain('搁置 2');
            expect(text).toContain('拒绝字段 1');
            expect(text).toContain('链接化 4');
            expect(text).toContain('出场记录 3');
            expect(text).toContain('伏笔闭环 通过');
        });

        it('失败记录带原因；无结算时不渲染结算段', () => {
            ledger.recordFailed({ commandId: 'batch', project: 'p', failure: '配额不足' });
            const text = formatRunRecord(ledger.getRecent()[0]);
            expect(text).toContain('失败');
            expect(text).toContain('配额不足');
            expect(text).not.toContain('结算：');
        });
    });

    describe('单例', () => {
        it('getExecutionLedger 复用一个实例，reset 后重建', () => {
            resetExecutionLedger();
            const first = getExecutionLedger();
            first.recordCompleted({ commandId: 'a', project: 'p', source: 'ui' });
            expect(getExecutionLedger()).toBe(first);
            expect(getExecutionLedger().getRecent()).toHaveLength(1);
            resetExecutionLedger();
            expect(getExecutionLedger()).not.toBe(first);
            expect(getExecutionLedger().isEmpty).toBe(true);
        });
    });
});