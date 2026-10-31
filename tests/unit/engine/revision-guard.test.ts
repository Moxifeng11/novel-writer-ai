import { describe, expect, it } from 'vitest';
import {
    collectLockedNames,
    evaluateRevision,
    extractCharacterNames,
} from '../../../engine/revision/revision-guard';

const original = [
    '# 第3章 测脉',
    '',
    '沈砚把灰布袋往案上一搁，袋口滚出两颗霄晶。',
    '“够不够。”',
    '“三年攒的，够。”沈铁山没回头，手指把袋口攥紧。',
    '录事抬眼皮，看了霄晶，又看沈铁山。',
    '“站直了。”',
].join('\n');

const revised = [
    '# 第3章 测脉',
    '',
    '沈砚把灰布袋往案上一搁，袋口滚出两颗霄晶，打了个转。',
    '“那袋子够不够。”',
    '“三年攒的，够。”沈铁山没回头，攥紧袋口。',
    '录事抬眼皮，看了霄晶，又看沈铁山。',
    '“站直了。”',
].join('\n');

describe('revision-guard — 修订闭环的接受闸门', () => {
    describe('人物名', () => {
        it('从 allChars 块里抽名字，跳过通用词', () => {
            const names = extractCharacterNames('- 沈砚：主角｜砂民少年\n- 沈铁山：配角\n- 主角：\n- 录事: 天阙');
            expect(names).toEqual(['沈砚', '沈铁山', '录事']);
        });

        it('只锁定原稿里出现过的名字', () => {
            expect(collectLockedNames(original, ['沈砚', '沈铁山', '录事', '苏晚', '天阙']))
                .toEqual(['沈砚', '沈铁山', '录事']);
        });
    });

    describe('接受条件', () => {
        const lockedNames = ['沈砚', '沈铁山', '录事'];

        it('长度相当、人物齐全、对话不塌 → 接受', () => {
            const gate = evaluateRevision(original, revised, { lockedNames });
            expect(gate.reasons).toEqual([]);
            expect(gate.accept).toBe(true);
        });

        it('删戏（字数减少超过 10%）→ 拒绝', () => {
            const short = '沈砚把灰布袋往案上一搁。“够不够。”';
            const gate = evaluateRevision(original, short, { lockedNames });
            expect(gate.accept).toBe(false);
            expect(gate.reasons.join()).toContain('字数减少');
        });

        it('扩写超过 10% → 拒绝', () => {
            const long = `${revised}\n\n${revised}`;
            const gate = evaluateRevision(original, long, { lockedNames });
            expect(gate.accept).toBe(false);
            expect(gate.reasons.join()).toContain('字数增加');
        });

        it('丢人物 → 拒绝并列出名字', () => {
            const without = revised.replace(/沈铁山/g, '他爹');
            const gate = evaluateRevision(original, without, { lockedNames });
            expect(gate.accept).toBe(false);
            expect(gate.metrics.missingNames).toContain('沈铁山');
        });

        it('把对话改成叙述 → 拒绝', () => {
            const narrationOnly = original.replace(/“[^”]*”/g, '他低声说了句话。');
            const gate = evaluateRevision(original, narrationOnly, { lockedNames });
            expect(gate.accept).toBe(false);
            expect(gate.reasons.join()).toContain('对话占比下降');
        });

        it('原样返回 / JSON / 空 → 拒绝', () => {
            expect(evaluateRevision(original, original, { lockedNames }).reasons.join()).toContain('完全相同');
            expect(evaluateRevision(original, '{"body":"x"}', { lockedNames }).reasons.join()).toContain('JSON');
            expect(evaluateRevision(original, '   ', { lockedNames }).reasons.join()).toContain('为空');
        });
    });
});
