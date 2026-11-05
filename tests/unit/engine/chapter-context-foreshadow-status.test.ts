import { describe, expect, it } from 'vitest';
import { filterForeshadowsByChapter } from '../../../engine/chapter-context-builder';

/**
 * 回归：`status.includes('揭示')` 曾把「未揭示 / 待揭示」误判为已揭示，
 * 导致这些伏笔在章节上下文里被整行跳过。
 */
describe('filterForeshadowsByChapter — 伏笔状态判定', () => {
    const table = [
        '| # | 伏笔名称 | 重要程度 | 埋设章节 | 计划回收 | 当前状态 |',
        '|---|---|---|---|---|---|',
        '| 1 | 断剑铭文 | 高 | 第1章 | 第2章 | 未揭示 |',
        '| 2 | 旧车票 | 中 | 第1章 | 第2章 | 待揭示 |',
        '| 3 | 失踪的兄长 | 高 | 第1章 | 第2章 | 已揭示 |',
    ].join('\n');

    it('未揭示/待揭示的伏笔进入相关列表，已揭示的跳过', () => {
        const { relevant } = filterForeshadowsByChapter(table, 2);
        expect(relevant).toContain('断剑铭文');
        expect(relevant).toContain('旧车票');
        expect(relevant).not.toContain('失踪的兄长');
    });

    it('只有已揭示伏笔时不产生遗漏提示', () => {
        const onlyRevealed = [
            '| # | 伏笔名称 | 重要程度 | 埋设章节 | 计划回收 | 当前状态 |',
            '|---|---|---|---|---|---|',
            '| 1 | 失踪的兄长 | 高 | 第1章 | 第2章 | 已揭示 |',
        ].join('\n');
        const { relevant, summary } = filterForeshadowsByChapter(onlyRevealed, 2);
        expect(relevant).toBe('');
        expect(summary).not.toContain('未揭示伏笔');
    });
});
