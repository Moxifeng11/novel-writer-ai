/**
 * 断言抽取单测（S1）
 *
 * 重点锁两件事：
 *  1. **宁少不脏**——没有明确主语的自由文本**不得**产出断言（否则后面全是误报）；
 *  2. 只抽「合法会变」字段之外的结构化事实（修为/势力/功法故意不抽）。
 */

import { describe, expect, it } from 'vitest';
import { extractAssertions, mergeAssertions } from '../../../../engine/consistency/assertion-extract';
import type { FactAssertion } from '../../../../engine/consistency/assertion-model';

const NOW = 1_700_000_000_000;

/** 便捷：按 kind 过滤 */
function byKind(list: FactAssertion[], kind: string): FactAssertion[] {
    return list.filter(a => a.kind === kind);
}

describe('断言抽取 · 人物档案（可信度最高）', () => {
    it('年龄：中文写法归一为数值', () => {
        const out = extractAssertions({
            chapterKey: '第1章',
            chapterNum: 1,
            now: NOW,
            character: { name: '张三', frontmatter: { 年龄: '十八岁' } },
        });
        const age = byKind(out, 'quantitative')[0];
        expect(age).toBeDefined();
        expect(age.subject).toBe('张三');
        expect(age.numericValue).toBe(18);
        expect(age.unit).toBe('岁');
        expect(age.source).toBe('frontmatter');
    });

    it('年龄：纯数字写法', () => {
        const out = extractAssertions({
            chapterKey: '第1章',
            chapterNum: 1,
            now: NOW,
            character: { name: '张三', frontmatter: { 年龄: 20 } },
        });
        expect(byKind(out, 'quantitative')[0].numericValue).toBe(20);
    });

    it('当前位置 → 同时性断言', () => {
        const out = extractAssertions({
            chapterKey: '第2章',
            chapterNum: 2,
            now: NOW,
            character: { name: '张三', frontmatter: { 当前位置: '青云城' } },
        });
        expect(byKind(out, 'simultaneity')[0].value).toBe('青云城');
    });

    it('外貌特征 → 外貌断言', () => {
        const out = extractAssertions({
            chapterKey: '第2章',
            chapterNum: 2,
            now: NOW,
            character: { name: '张三', frontmatter: { 外貌特征: '左眉有疤' } },
        });
        expect(byKind(out, 'appearance')[0].value).toBe('左眉有疤');
    });

    it('故意不抽「修为等级/所属势力/功法」——它们合法会变，抽了只会误报', () => {
        const out = extractAssertions({
            chapterKey: '第3章',
            chapterNum: 3,
            now: NOW,
            character: {
                name: '张三',
                frontmatter: { 修为等级: '筑基三层', 所属势力: '青云宗', '功法/技能树': '御剑术' },
            },
        });
        expect(out).toHaveLength(0);
    });

    it('空值字段不产出断言', () => {
        const out = extractAssertions({
            chapterKey: '第1章',
            chapterNum: 1,
            now: NOW,
            character: { name: '张三', frontmatter: { 年龄: '', 当前位置: '  ' } },
        });
        expect(out).toHaveLength(0);
    });
});

describe('断言抽取 · 章节摘要 facts[]', () => {
    it('「人名 + 今年 + 数字 + 岁」抽出年龄断言', () => {
        const out = extractAssertions({
            chapterKey: '第10章',
            chapterNum: 10,
            now: NOW,
            digest: { facts: ['张三今年十八岁，刚入外门'] },
        });
        const age = byKind(out, 'quantitative')[0];
        expect(age.subject).toBe('张三');
        expect(age.numericValue).toBe(18);
        expect(age.quote).toContain('张三今年十八岁');
    });

    it('「人名 + 来到 + 地点」抽出位置断言', () => {
        const out = extractAssertions({
            chapterKey: '第10章',
            chapterNum: 10,
            now: NOW,
            digest: { facts: ['李四来到青云城'] },
        });
        expect(byKind(out, 'simultaneity')[0].value).toBe('青云城');
    });

    it('「本名/化名」抽出命名断言', () => {
        const out = extractAssertions({
            chapterKey: '第11章',
            chapterNum: 11,
            now: NOW,
            digest: { facts: ['张三本名张小三'] },
        });
        expect(byKind(out, 'nomenclature')[0].value).toBe('张小三');
    });

    it('**没有明确主语的数字不抽**（宁少不脏）', () => {
        const out = extractAssertions({
            chapterKey: '第10章',
            chapterNum: 10,
            now: NOW,
            digest: { facts: ['十八岁那年他离开了家乡', '三百里的路程'] },
        });
        expect(byKind(out, 'quantitative')).toHaveLength(0);
    });

    it('外貌断言只在有 involved 时才产出（需要主语）', () => {
        const withoutInvolved = extractAssertions({
            chapterKey: '第10章',
            chapterNum: 10,
            now: NOW,
            digest: { facts: ['容貌清秀'] },
        });
        expect(byKind(withoutInvolved, 'appearance')).toHaveLength(0);

        const withInvolved = extractAssertions({
            chapterKey: '第10章',
            chapterNum: 10,
            now: NOW,
            digest: { facts: ['容貌清秀'], involved: ['张三'] },
        });
        expect(byKind(withInvolved, 'appearance')[0].subject).toBe('张三');
    });
});

describe('断言抽取 · 章节时间跨度', () => {
    it('timeSpan 折算为分钟', () => {
        const out = extractAssertions({
            chapterKey: '第12章',
            chapterNum: 12,
            now: NOW,
            digest: { timeSpan: '三个月' },
        });
        const duration = byKind(out, 'duration')[0];
        expect(duration.value).toBe('三个月');
        expect(duration.numericValue).toBe(3 * 30 * 24 * 60);
    });

    it('无法解析的 timeSpan 仍然保留（无 numericValue）', () => {
        const out = extractAssertions({
            chapterKey: '第12章',
            chapterNum: 12,
            now: NOW,
            digest: { timeSpan: '很久以后' },
        });
        const duration = byKind(out, 'duration')[0];
        expect(duration.value).toBe('很久以后');
        expect(duration.numericValue).toBeUndefined();
    });
});

describe('断言抽取 · 结构化台账事件', () => {
    it('事件时间 → 绝对时间断言，并保留章节', () => {
        const out = extractAssertions({
            chapterKey: '第20章',
            chapterNum: 20,
            now: NOW,
            events: [{ name: '青云试炼', time: '三日', location: '青云山', chapterKey: '第20章', chapterNum: 20, raw: '青云试炼 | 三日 | 青云山' }],
        });
        const time = byKind(out, 'absolute-time')[0];
        expect(time.subject).toBe('青云试炼');
        expect(time.value).toBe('三日');
        expect(time.numericValue).toBe(3 * 24 * 60);
        expect(time.quote).toContain('青云试炼');
    });

    it('事件地点 → 同时性断言', () => {
        const out = extractAssertions({
            chapterKey: '第20章',
            chapterNum: 20,
            now: NOW,
            events: [{ name: '青云试炼', location: '青云山' }],
        });
        expect(byKind(out, 'simultaneity')[0].value).toBe('青云山');
    });

    it('空事件名跳过', () => {
        const out = extractAssertions({
            chapterKey: '第20章',
            chapterNum: 20,
            now: NOW,
            events: [{ name: '   ', time: '三日' }],
        });
        expect(out).toHaveLength(0);
    });
});

describe('断言抽取 · 已确认事实索引（命名基准）', () => {
    it('confirmedFacts 生成权威名称断言', () => {
        const out = extractAssertions({
            chapterKey: '第1章',
            chapterNum: 1,
            now: NOW,
            confirmedFacts: [{ name: '张三', category: 'character' }, { name: '青云宗', category: 'world' }],
        });
        const names = byKind(out, 'nomenclature');
        expect(names).toHaveLength(2);
        expect(names.map(n => n.subject)).toEqual(['张三', '青云宗']);
    });
});

describe('断言抽取 · 去重与合并', () => {
    it('同章同类同主语同谓语只保留一条', () => {
        const out = extractAssertions({
            chapterKey: '第1章',
            chapterNum: 1,
            now: NOW,
            digest: { facts: ['张三今年十八岁', '张三今年十八岁'] },
        });
        expect(byKind(out, 'quantitative')).toHaveLength(1);
    });

    it('mergeAssertions 按 id 去重且保留先出现者', () => {
        const a = extractAssertions({
            chapterKey: '第1章', chapterNum: 1, now: NOW,
            digest: { facts: ['张三今年十八岁'] },
        });
        const b = extractAssertions({
            chapterKey: '第1章', chapterNum: 1, now: NOW + 1,
            digest: { facts: ['张三今年十八岁'] },
        });
        const merged = mergeAssertions(a, b);
        expect(merged).toHaveLength(1);
        expect(merged[0].extractedAt).toBe(NOW);
    });

    it('不同章节的同类断言不会被合并', () => {
        const a = extractAssertions({
            chapterKey: '第1章', chapterNum: 1, now: NOW,
            digest: { facts: ['张三今年十八岁'] },
        });
        const b = extractAssertions({
            chapterKey: '第40章', chapterNum: 40, now: NOW,
            digest: { facts: ['张三今年二十岁'] },
        });
        const merged = mergeAssertions(a, b);
        expect(merged).toHaveLength(2);
        expect(merged.map((m: FactAssertion) => m.numericValue).sort()).toEqual([18, 20]);
    });
});
