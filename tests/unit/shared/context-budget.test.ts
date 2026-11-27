/**
 * T2 上下文模块计量 + T6 快捷预设测试（2026-11-27）
 */
import { describe, it, expect } from 'vitest';
import {
    estimateTokens, auditContextBudget, comparePreset, formatBudgetLine,
    CONTEXT_PRESETS, CHARS_PER_TOKEN,
} from '../../../shared/context-budget';

describe('T2 estimateTokens', () => {
    it('按 2.2 字/token 估算', () => {
        expect(estimateTokens('字'.repeat(22))).toBe(10);
    });

    it('空串为 0', () => {
        expect(estimateTokens('')).toBe(0);
    });

    it('向上取整（不会低估）', () => {
        expect(estimateTokens('字')).toBe(1);
    });

    it('比例常量可读', () => {
        expect(CHARS_PER_TOKEN).toBe(2.2);
    });
});

describe('T2 auditContextBudget', () => {
    const vars = {
        worldView: '字'.repeat(1100),   // 500 tokens
        allChars: '字'.repeat(4400),    // 2000 tokens
        tiny: '短',                      // 被 minChars 过滤
        empty: '',
    };

    it('按 tokens 降序排列', () => {
        const r = auditContextBudget(vars);
        expect(r.entries[0].id).toBe('allChars');
        expect(r.entries[1].id).toBe('worldView');
    });

    it('过滤短变量（默认 minChars=50）', () => {
        const r = auditContextBudget(vars);
        expect(r.entries.find(e => e.id === 'tiny')).toBeUndefined();
    });

    it('minChars=0 时不过滤', () => {
        const r = auditContextBudget(vars, { minChars: 0 });
        expect(r.entries.find(e => e.id === 'tiny')).toBeDefined();
    });

    it('总计等于各项之和', () => {
        const r = auditContextBudget(vars);
        const sum = r.entries.reduce((n, e) => n + e.tokens, 0);
        expect(r.totalTokens).toBe(sum);
    });

    it('非字符串值被忽略', () => {
        const r = auditContextBudget({ ...vars, bad: 123 as unknown as string });
        expect(r.entries.find(e => e.id === 'bad')).toBeUndefined();
    });
});

describe('T6 快捷预设', () => {
    it('三个预设都已定义', () => {
        expect(Object.keys(CONTEXT_PRESETS)).toEqual(['minimal', 'characterFocus', 'worldFocus']);
    });

    it('每个预设都有名称/说明/保留清单', () => {
        for (const [key, p] of Object.entries(CONTEXT_PRESETS)) {
            expect(p.name.length, key).toBeGreaterThan(0);
            expect(p.note.length, key).toBeGreaterThan(0);
            expect(p.keepOnly.length, key).toBeGreaterThan(0);
        }
    });

    it('minimal 比 characterFocus 更精简', () => {
        expect(CONTEXT_PRESETS.minimal.keepOnly.length)
            .toBeLessThan(CONTEXT_PRESETS.characterFocus.keepOnly.length);
    });

    it('所有预设都保留衔接三件套（前章原文/后章约束）', () => {
        for (const [key, p] of Object.entries(CONTEXT_PRESETS)) {
            expect(p.keepOnly, key).toContain('prevChapEnding');
            expect(p.keepOnly, key).toContain('nextChapterHook');
        }
    });
});

describe('T6 comparePreset 计量对比', () => {
    const vars = {
        worldView: '字'.repeat(1100),
        allChars: '字'.repeat(4400),
        settingLib: '字'.repeat(3300),
        powerSystem: '字'.repeat(2200),
        sceneCardDigest: '字'.repeat(1100),
        longTermMemory: '字'.repeat(5500),
        prevChapEnding: '字'.repeat(550),
        nextChapterHook: '字'.repeat(220),
    };

    it('minimal 能省大部分 token', () => {
        const d = comparePreset(vars, 'minimal');
        expect(d.saved).toBeGreaterThan(0);
        expect(d.savedPct).toBeGreaterThan(50);
    });

    it('worldFocus 比 minimal 省得少（保留更多模块）', () => {
        const min = comparePreset(vars, 'minimal');
        const world = comparePreset(vars, 'worldFocus');
        expect(world.saved).toBeLessThan(min.saved);
    });

    it('full 等于完整计量', () => {
        const d = comparePreset(vars, 'minimal');
        expect(d.full).toBe(auditContextBudget(vars).totalTokens);
    });

    it('preset + saved 约等于 full', () => {
        const d = comparePreset(vars, 'characterFocus');
        expect(d.preset + d.saved).toBe(d.full);
    });
});

describe('格式化', () => {
    it('单行日志含总量与 TopN', () => {
        const r = auditContextBudget({ a: '字'.repeat(1100), b: '字'.repeat(550) });
        const line = formatBudgetLine(r, 2);
        expect(line).toContain('上下文');
        expect(line).toContain('tokens');
        expect(line).toContain('a(');
        expect(line).toContain('b(');
    });
});
