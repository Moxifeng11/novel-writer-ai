/**
 * 阶段 C：能力等级序第二意见 + 生产接线
 *
 * 关键：能力变化天然合法（进阶），**必须按等级序比较**，
 * 不能用「值不相等 = 矛盾」。这里锁住阶梯解析与三态判定。
 */

import { describe, expect, it } from 'vitest';
import { adviseAbility, CULTIVATION_LADDER, parseLevelRank } from '../../../../engine/context/state-advice';
import type { FactMetadata } from '../../../../engine/context/knowledge-fact-nodes';

/** 造能力事实 */
function abilityFact(chapter: number, value: string, subject = '宁缺'): FactMetadata {
    return {
        type: 'ability',
        subject,
        predicate: '修为',
        value,
        validFrom: chapter,
        validTo: null,
        confidence: 0.9,
        quote: `${subject}${value}`,
        chapter,
    };
}

describe('CULTIVATION_LADDER / parseLevelRank', () => {
    it('阶梯有序（低→高）', () => {
        const ranks = CULTIVATION_LADDER.map(item => item.rank);
        expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
    });

    it('解析境界 + 层数：练气三层 → 1003', () => {
        expect(parseLevelRank('练气三层')).toBe(1003);
    });

    it('解析境界 + 层数：筑基一层 → 2001', () => {
        expect(parseLevelRank('筑基一层')).toBe(2001);
    });

    it('只有境界（无层数）→ base×100', () => {
        expect(parseLevelRank('金丹')).toBe(3000);
    });

    it('支持阿拉伯数字层数', () => {
        expect(parseLevelRank('元婴5层')).toBe(4005);
    });

    it('无法识别 → null（不猜）', () => {
        expect(parseLevelRank('很强')).toBeNull();
        expect(parseLevelRank('')).toBeNull();
    });

    it('**筑基一层 > 练气九层**（跨境界优先于层数）', () => {
        expect(parseLevelRank('筑基一层')!).toBeGreaterThan(parseLevelRank('练气九层')!);
    });
});

describe('adviseAbility · 三态判定', () => {
    const facts = [abilityFact(1, '练气三层')];

    it('**进阶 → consistent（不报）**', () => {
        const advice = adviseAbility(facts, { subject: '宁缺', chapter: 20, value: '筑基一层' });
        expect(advice.status).toBe('consistent');
        expect(advice.reason).toContain('合法进阶');
    });

    it('同级同层 → consistent', () => {
        expect(adviseAbility(facts, { subject: '宁缺', chapter: 5, value: '练气三层' }).status).toBe('consistent');
    });

    it('**倒退 → conflict（要求理由）**', () => {
        const advice = adviseAbility(facts, { subject: '宁缺', chapter: 20, value: '练气一层' });
        expect(advice.status).toBe('conflict');
        expect(advice.reason).toContain('倒退需要理由');
    });

    it('无历史记录 → unknown', () => {
        expect(adviseAbility(facts, { subject: '陌生人', chapter: 20, value: '金丹' }).status).toBe('unknown');
    });

    it('本章之后的记录不作为依据 → unknown', () => {
        expect(adviseAbility([abilityFact(30, '金丹')], { subject: '宁缺', chapter: 5, value: '筑基' }).status).toBe('unknown');
    });

    it('历史值无法解析 → unknown（不猜）', () => {
        const weird = [{ ...abilityFact(1, '不详') }];
        expect(adviseAbility(weird, { subject: '宁缺', chapter: 5, value: '筑基' }).status).toBe('unknown');
    });

    it('声称值无法解析 → unknown', () => {
        expect(adviseAbility(facts, { subject: '宁缺', chapter: 5, value: '很强' }).status).toBe('unknown');
    });

    it('取最近一条历史（多处记录）', () => {
        const multi = [abilityFact(1, '练气三层'), abilityFact(10, '筑基一层')];
        expect(adviseAbility(multi, { subject: '宁缺', chapter: 20, value: '筑基三层' }).status).toBe('consistent');
        expect(adviseAbility(multi, { subject: '宁缺', chapter: 20, value: '练气九层' }).status).toBe('conflict');
    });
});
