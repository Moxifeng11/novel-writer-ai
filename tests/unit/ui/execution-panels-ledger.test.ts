/**
 * execution-panels-ledger.test.ts — 注入溯源账本 0 字符行可见化（DSH-20261114-03）
 *
 * audit §三-1：renderLedgerDetails 此前 `chars > 0` 过滤——「检索失败归零」的
 * 知识注入行被吞掉，界面一切正常（假绿）。修复后 failed/empty 行保留，
 * 字符列区分「0（检索失败）」与「0（未启用/无参考书）」两种语义。
 */
import { describe, expect, it } from 'vitest';
import { ExecutionRunStore } from '../../../ui/full-writer/execution-run-store';
import { ExecutionTimelinePanel } from '../../../ui/full-writer/execution-panels';
import { FakeEl, stubCreateDiv, stubDocument, asFake } from './support/fake-dom';

function seedLedgerEvent(store: ExecutionRunStore, entries: Array<Record<string, unknown>>): void {
    store.addEvent({
        type: 'prompt-ledger',
        level: 'warning',
        message: '本步提示词构成',
        stepKey: 'bodyGeneration',
        stepLabel: '正文生成',
        debug: {
            totalChars: 0,
            totalEstTokens: 0,
            ledgerEntries: JSON.stringify(entries),
        },
    } as never);
}

describe('ExecutionTimelinePanel 注入溯源 · 0 字符行可见化（DSH-20261114-03）', () => {
    it('failed 行不被吞：字符列显示「0（检索失败）」并带 ⚠', () => {
        stubCreateDiv();
        stubDocument();
        const store = new ExecutionRunStore();
        seedLedgerEvent(store, [
            { key: 'knowledgeTail', label: '知识注入（风格/节奏/技巧/伏笔）', influence: '风格指引', chars: 0, estTokens: 0, source: 'KnowledgeInjector', failed: true },
        ]);
        const container = new FakeEl('div');
        const panel = new ExecutionTimelinePanel(store, { onRetry: () => {}, onOpenLog: () => {} });
        panel.mount(container as unknown as HTMLElement);

        const text = asFake(container).allText();
        expect(text).toContain('注入溯源 · 1 段');
        expect(text).toContain('0（检索失败）');
        expect(text).toContain('⚠');
    });

    it('empty 行不被吞：字符列显示「0（未启用/无参考书）」，不带失败语义', () => {
        stubCreateDiv();
        stubDocument();
        const store = new ExecutionRunStore();
        seedLedgerEvent(store, [
            { key: 'knowledgeTail', label: '知识注入（风格/节奏/技巧/伏笔）', influence: '风格指引', chars: 0, estTokens: 0, source: 'KnowledgeInjector', empty: true },
        ]);
        const container = new FakeEl('div');
        const panel = new ExecutionTimelinePanel(store, { onRetry: () => {}, onOpenLog: () => {} });
        panel.mount(container as unknown as HTMLElement);

        const text = asFake(container).allText();
        expect(text).toContain('0（未启用/无参考书）');
        expect(text).not.toContain('0（检索失败）');
    });

    it('纯 0 字符且无 failed/empty 标记的行仍被过滤（不给噪音留口子）', () => {
        stubCreateDiv();
        stubDocument();
        const store = new ExecutionRunStore();
        seedLedgerEvent(store, [
            { key: 'sceneCard', label: '场景卡（硬约束）', influence: '工艺约束', chars: 0, estTokens: 0, source: 'scene' },
        ]);
        const container = new FakeEl('div');
        const panel = new ExecutionTimelinePanel(store, { onRetry: () => {}, onOpenLog: () => {} });
        panel.mount(container as unknown as HTMLElement);

        expect(asFake(container).allText()).not.toContain('注入溯源 ·');
        expect(asFake(container).allText()).not.toContain('场景卡（硬约束）');
    });
});
