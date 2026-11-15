/**
 * 质量闭环面板：纯展示逻辑 + 界面模块可导入（视图门禁）
 */

import { describe, expect, it } from 'vitest';
import {
    describeQualitySummary,
    describeRecordResult,
    describeRevisionOutcome,
    describeSeverityCounts,
    formatCheckedAt,
    pickQualityChapter,
    toChapterOptions,
} from '@/shared/quality-loop-model';
import type { QualityPanelSummary, QualityRecord } from '@/shared/quality-panel-model';
import { QualityLoopModal } from '@/ui/quality-loop-modal';
import { SettlementRecoveryModal } from '@/ui/settlement-recovery-modal';

const emptySummary: QualityPanelSummary = {
    total: 0,
    passed: 0,
    passRate: 0,
    pendingHuman: 0,
    kindRanking: [],
    avgRevisionRounds: 0,
    recent: [],
};

const record = (overrides: Partial<QualityRecord> = {}): QualityRecord => ({
    chapterName: '第一章',
    checkedAt: 1_700_000_000_000,
    passed: true,
    counts: { error: 0, warn: 0, info: 0 },
    kinds: {},
    revisionRounds: 0,
    ...overrides,
});

describe('pickQualityChapter', () => {
    it('优先命中工作台章节', () => {
        expect(pickQualityChapter(['第一章', '第二章'], '第二章')).toBe('第二章');
    });

    it('工作台章节不在列表时按包含关系匹配', () => {
        expect(pickQualityChapter(['第一章_初入山门', '第二章'], '第一章')).toBe('第一章_初入山门');
    });

    it('无匹配取第一章；空列表返回空串', () => {
        expect(pickQualityChapter(['第一章'], '第九章')).toBe('第一章');
        expect(pickQualityChapter([], '第一章')).toBe('');
        expect(pickQualityChapter(['第一章'], null)).toBe('第一章');
    });
});

describe('describeQualitySummary', () => {
    it('空面板给引导语', () => {
        expect(describeQualitySummary(emptySummary)).toEqual(['还没有校验记录：先点「运行校验」跑一次。']);
    });

    it('有记录时给通过率、轮次、问题类型', () => {
        const lines = describeQualitySummary({
            total: 4,
            passed: 3,
            passRate: 75,
            pendingHuman: 1,
            kindRanking: [{ kind: 'coverage', count: 3 }, { kind: 'foreshadow', count: 1 }],
            avgRevisionRounds: 1.5,
            recent: [],
        });
        expect(lines[0]).toContain('累计 4 次');
        expect(lines[0]).toContain('75%');
        expect(lines[1]).toContain('平均修订轮次 1.5');
        expect(lines[1]).toContain('待人工 1');
        expect(lines[2]).toContain('实体覆盖 3');
    });
});

describe('describeRecordResult', () => {
    it('按优先级给出中止/待人工/通过/未通过', () => {
        expect(describeRecordResult(record({ abortedReason: '模型调用失败' }))).toContain('中止');
        expect(describeRecordResult(record({ pendingHuman: true }))).toContain('待人工');
        expect(describeRecordResult(record({ passed: true }))).toContain('通过');
        expect(describeRecordResult(record({ passed: false }))).toContain('未通过');
    });
});

describe('describeSeverityCounts', () => {
    it('只列出非零项；全零显示无问题', () => {
        expect(describeSeverityCounts({ error: 1, warn: 2, info: 0 })).toBe('❌ 1 · ⚠️ 2');
        expect(describeSeverityCounts({ error: 0, warn: 0, info: 0 })).toBe('无问题');
    });
});

describe('describeRevisionOutcome', () => {
    it('中止优先', () => {
        expect(describeRevisionOutcome({ passed: false, attempts: 0, wrote: false, rounds: [], pending: [], abortedReason: '正文为空' }))
            .toContain('中止');
    });

    it('通过时说明轮次与落盘', () => {
        const text = describeRevisionOutcome({ passed: true, attempts: 1, wrote: true, rounds: [3], pending: [] });
        expect(text).toContain('修订通过');
        expect(text).toContain('1 轮');
        expect(text).toContain('已落盘');
    });

    it('未通过时给出未解决数量并标记待人工', () => {
        const text = describeRevisionOutcome({ passed: false, attempts: 2, wrote: false, rounds: [4, 2], pending: [1, 2] });
        expect(text).toContain('仍有 2 条');
        expect(text).toContain('待人工');
    });
});

describe('formatCheckedAt', () => {
    it('非法值显示占位符', () => {
        expect(formatCheckedAt(0)).toBe('—');
        expect(formatCheckedAt(Number.NaN)).toBe('—');
    });

    it('正常时间戳输出 月-日 时:分', () => {
        expect(formatCheckedAt(1_700_000_000_000)).toMatch(/^\d{2}-\d{2} \d{2}:\d{2}$/);
    });
});

describe('toChapterOptions', () => {
    it('映射为下拉选项', () => {
        expect(toChapterOptions(['第一章'])).toEqual([{ name: '第一章', label: '第一章' }]);
    });
});

describe('界面模块可导入（视图门禁）', () => {
    it('质量闭环与结算恢复面板都是构造函数', () => {
        expect(typeof QualityLoopModal).toBe('function');
        expect(typeof SettlementRecoveryModal).toBe('function');
    });
});
