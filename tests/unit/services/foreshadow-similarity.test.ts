import { describe, it, expect } from 'vitest';
import { ForeshadowManager } from '../../../engine/foreshadow-manager';

/** 直接调用私有方法（与 ai-api-client.test.ts 的 isDisconnectionError 同款模式） */
function sim(a: string, b: string): number {
    return (ForeshadowManager.prototype as unknown as { textSimilarity: (x: string, y: string) => number })
        .textSimilarity.call({}, a, b);
}

describe('ForeshadowManager.textSimilarity — v6.3 bigram Dice + 长度归一化', () => {
    it('完全相同 → 1', () => {
        expect(sim('神秘的黑色钥匙', '神秘的黑色钥匙')).toBeCloseTo(1, 6);
    });

    it('空值 / 纯空白 → 0', () => {
        expect(sim('', 'x')).toBe(0);
        expect(sim('x', '')).toBe(0);
        expect(sim('   ', 'x')).toBe(0);
    });

    it('近重复（仅个别字之差）仍高于 0.7 去重阈值', () => {
        expect(
            sim('他怀里的黑色钥匙将在结局揭示来历', '他手中的黑色钥匙将在结局揭示来历')
        ).toBeGreaterThan(0.7);
    });

    it('字符集合相同但语序不同 → 不再被误判为重复', () => {
        // 旧实现（单字符集合 Jaccard）会算出 1.0，必然 > 0.7 而误合并
        expect(sim('他走过去', '过他去走')).toBeLessThan(0.4);
    });

    it('长度悬殊但共享内容 → 被长度归一化压低', () => {
        expect(sim('神秘', '这是一个非常神秘且意义重大的物件')).toBeLessThan(0.3);
    });

    it('语义无关的短句 → 低相似度', () => {
        expect(sim('少年在雨中奔跑', '古老城堡埋藏着诅咒')).toBeLessThan(0.2);
    });
});
