/**
 * 审核视图纯逻辑单测（S4）
 *
 * Modal 只组装 DOM，判定/格式化逻辑都在这里，因此可完整单测。
 * 重点：**能不能跳转**必须由「有偏移 + 有章节」共同决定——
 * 没有章节 key 的证据（人物档案/事实索引）不该给用户一个点了没反应的按钮。
 */

import { describe, expect, it } from 'vitest';
import {
    buildEmptyStateHint,
    canJumpToEvidence,
    formatConfidence,
    formatDecisionSource,
    formatEvidenceChapter,
    formatEvidenceTitle,
    formatKindBadge,
    formatMetaLine,
    offsetToLine,
} from '../../../ui/consistency-audit-format';

describe('offsetToLine · 字符偏移转行号', () => {
    it('开头偏移是第 1 行（0 基 0）', () => {
        expect(offsetToLine('abc\ndef', 0)).toBe(0);
    });

    it('第一行内偏移仍是第 0 行', () => {
        expect(offsetToLine('abc\ndef', 2)).toBe(0);
    });

    it('跨过一个换行后是第 1 行', () => {
        expect(offsetToLine('abc\ndef', 4)).toBe(1);
    });

    it('多个换行累计', () => {
        expect(offsetToLine('a\nb\nc\nd', 6)).toBe(3);
    });

    it('偏移越界被夹到末尾', () => {
        expect(offsetToLine('a\nb', 999)).toBe(1);
    });

    it('负偏移当 0 处理', () => {
        expect(offsetToLine('a\nb', -5)).toBe(0);
    });

    it('空内容返回 0', () => {
        expect(offsetToLine('', 0)).toBe(0);
        expect(offsetToLine('', 10)).toBe(0);
    });
});

describe('文案格式化', () => {
    it('置信度转百分比', () => {
        expect(formatConfidence(0.92)).toBe('置信度 92%');
        expect(formatConfidence(1)).toBe('置信度 100%');
    });

    it('置信度越界被夹住', () => {
        expect(formatConfidence(5)).toBe('置信度 100%');
        expect(formatConfidence(-1)).toBe('置信度 0%');
    });

    it('非有限值按 0 处理（不显示 NaN，也不假装高置信）', () => {
        expect(formatConfidence(Number.NaN)).toBe('置信度 0%');
        // Infinity 不是合法置信度：宁可显示 0% 也不能给用户「100% 确定」的错觉
        expect(formatConfidence(Number.POSITIVE_INFINITY)).toBe('置信度 0%');
    });

    it('判定来源', () => {
        expect(formatDecisionSource('rule')).toBe('规则判定');
        expect(formatDecisionSource('llm')).toBe('模型复核');
    });

    it('元信息行组合', () => {
        expect(formatMetaLine({ confidence: 0.8, decidedBy: 'llm' })).toBe('置信度 80% ｜ 模型复核');
    });
});

describe('类型徽章', () => {
    it('数量不符是 high', () => {
        expect(formatKindBadge('quantitative')).toEqual({ label: '数量不符', severity: 'high' });
    });

    it('外貌不符是 medium', () => {
        expect(formatKindBadge('appearance')).toEqual({ label: '外貌不符', severity: 'medium' });
    });

    it('时长矛盾是 high', () => {
        expect(formatKindBadge('duration').label).toBe('时长矛盾');
    });
});

describe('证据展示与可跳转判定', () => {
    it('有章节时显示章节，没有时说明来源', () => {
        expect(formatEvidenceChapter({ chapterKey: '第3章' })).toBe('第3章');
        expect(formatEvidenceChapter({ chapterKey: '' })).toBe('（人物档案/事实索引）');
    });

    it('有偏移时提示偏移，无偏移时说明未定位', () => {
        expect(formatEvidenceTitle({ offset: 42 })).toContain('42');
        expect(formatEvidenceTitle({ offset: undefined })).toContain('未定位');
    });

    it('**有偏移且有章节才可跳转**', () => {
        expect(canJumpToEvidence({ offset: 10, chapterKey: '第1章' })).toBe(true);
        expect(canJumpToEvidence({ offset: undefined, chapterKey: '第1章' })).toBe(false);
        expect(canJumpToEvidence({ offset: 10, chapterKey: '' })).toBe(false);
    });
});

describe('空态说明', () => {
    it('说明检查依据与局限性', () => {
        const hint = buildEmptyStateHint();
        expect(hint).toContain('章节摘要');
        expect(hint).toContain('人物档案');
        expect(hint).toContain('时间线/伏笔台账');
        expect(hint).toContain('偏少');
    });
});
