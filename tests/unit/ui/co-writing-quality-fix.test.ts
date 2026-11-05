import { describe, it, expect } from 'vitest';
import {
    buildQualityFixPrompt,
    lineTopForIndex,
    locateQualityTarget,
    resolveQualityFixApplication,
} from '../../../ui/co-writing/quality-fix';
import type { QualityIssue } from '../../../ui/co-writing/quality-report';

/**
 * AI 修复的三段纯逻辑：定位、Prompt、替换决策。
 * 替换决策直接决定会不会覆盖用户正文，必须锁住「原文已变 → 放弃」这条路径。
 */
function makeIssue(partial: Partial<QualityIssue> = {}): QualityIssue {
    return {
        id: 'qc_1',
        priority: 'high',
        category: '情节',
        problem: '第3段节奏拖沓',
        suggestion: '压缩打斗铺垫',
        locationText: '丙丁',
        severity: '❌',
        ...partial,
    };
}

describe('co-writing quality-fix 定位', () => {
    it('定位命中时给出起止、前后文与原文', () => {
        const target = locateQualityTarget('甲乙丙丁戊己', '丙丁');
        expect(target).toEqual({
            start: 2,
            end: 4,
            contextBefore: '甲乙',
            targetText: '丙丁',
            contextAfter: '戊己',
        });
    });

    it('定位文本不足 2 字或未命中返回 null', () => {
        expect(locateQualityTarget('甲乙', '甲')).toBeNull();
        expect(locateQualityTarget('甲乙', '')).toBeNull();
        expect(locateQualityTarget('甲乙', '丙丁')).toBeNull();
    });

    it('目标在开头时前文为空', () => {
        const target = locateQualityTarget('丙丁戊己', '丙丁');
        expect(target?.contextBefore).toBe('');
    });

    it('前后文各截 200 字', () => {
        const before = '甲'.repeat(300);
        const after = '乙'.repeat(300);
        const text = `${before}目标${after}`;
        const target = locateQualityTarget(text, '目标');
        expect(target?.contextBefore).toHaveLength(200);
        expect(target?.contextAfter).toHaveLength(200);
    });
});

describe('co-writing quality-fix Prompt', () => {
    it('包含问题与建议，并在定位时包含前后文与目标原文', () => {
        const issue = makeIssue();
        const prompt = buildQualityFixPrompt(issue, locateQualityTarget('甲乙丙丁戊己', '丙丁'));
        expect(prompt).toContain('【问题】\n第3段节奏拖沓');
        expect(prompt).toContain('【修改建议】\n压缩打斗铺垫');
        expect(prompt).toContain('【前文】');
        expect(prompt).toContain('【需修改的文本】\n丙丁');
        expect(prompt).toContain('【后文】');
        expect(prompt).toContain('只输出正文，不加解释');
    });

    it('未定位时给出固定占位并省略目标小节标题', () => {
        const prompt = buildQualityFixPrompt(makeIssue({ locationText: '' }), null);
        expect(prompt).toContain('（未定位到具体文本，将基于上下文判断）');
        expect(prompt).not.toContain('【需修改的文本】');
        expect(prompt).not.toContain('【前文】');
        expect(prompt).not.toContain('【后文】');
    });
});

describe('co-writing quality-fix 替换决策', () => {
    const target = locateQualityTarget('甲乙丙丁', '丙丁');

    it('原文区间未变时替换并返回新光标', () => {
        expect(resolveQualityFixApplication('甲乙丙丁', target, '戊己')).toEqual({
            kind: 'replace',
            newText: '甲乙戊己',
            selection: 4,
        });
    });

    it('原文区间已变时放弃，不覆盖用户输入', () => {
        expect(resolveQualityFixApplication('甲乙丙X', target, '戊己')).toEqual({ kind: 'stale' });
    });

    it('未定位时只在末尾追加建议', () => {
        const result = resolveQualityFixApplication('原文', null, '建议');
        expect(result.kind).toBe('append');
        if (result.kind === 'append') {
            expect(result.newText).toBe('原文\n\n【AI修复建议】\n建议');
            expect(result.selection).toBe(result.newText.length);
        }
    });

    it('AI 无输出时不操作', () => {
        expect(resolveQualityFixApplication('甲乙丙丁', target, '')).toEqual({ kind: 'noop' });
    });
});

describe('co-writing quality-fix 行高估算', () => {
    it('按换行数累加行高', () => {
        const text = 'a\nb\nc';
        expect(lineTopForIndex(text, 0)).toBe(20);
        expect(lineTopForIndex(text, 2)).toBe(40);
        expect(lineTopForIndex(text, 4)).toBe(60);
        expect(lineTopForIndex(text, 4, 24)).toBe(72);
    });
});
