/**
 * C3 — 增量评估的「可跳过」语义必须真正生效。
 *
 * 历史行为：`canSkipDimension` 的结果被读取后，两个分支代码完全相同
 * （都只是查 dimensionCache），增量语义等于没有实现。
 * 现在：changedRange 含人物名 → 绕过缓存重算人物一致性；不含 → 复用缓存；
 * 未提供 changedRange → 与普通评估一致（照常命中缓存）。
 */

import { describe, it, expect, vi } from 'vitest';
import {
    QualityScoreEngine,
    type ICharacterChecker,
} from '../../../../engine/quality/quality-score-engine';

const TEXT = '林默推开门，雨声灌了进来。他抬头看向屋檐下的人，苏晚正低头擦着剑上的水。'
    .repeat(6);

const NAME = '林默';
const NAME_RANGE = { start: TEXT.indexOf(NAME), end: TEXT.indexOf(NAME) + NAME.length };
const TAIL_RANGE = { start: TEXT.length - 6, end: TEXT.length - 1 };

function createCountingChecker(): { checker: ICharacterChecker; calls: () => number } {
    const check = vi.fn(async () => ({
        overallScore: 80,
        characterResults: {},
        summary: '',
    }));
    return { checker: { check } as ICharacterChecker, calls: () => check.mock.calls.length };
}

describe('C3 — changedRange 驱动人物一致性的缓存复用', () => {
    it('变更范围包含人物名时必须重算，不复用旧缓存', async () => {
        const { checker, calls } = createCountingChecker();
        const engine = new QualityScoreEngine({ characterChecker: checker });
        const characterInfos = [{ name: NAME }];

        await engine.evaluate(TEXT, { characterInfos });
        expect(calls()).toBe(1);

        await engine.evaluate(TEXT, { characterInfos, changedRange: NAME_RANGE });
        expect(calls()).toBe(2);
    });

    it('变更范围不含人物名时复用缓存，不重复调用检查器', async () => {
        const { checker, calls } = createCountingChecker();
        const engine = new QualityScoreEngine({ characterChecker: checker });
        const characterInfos = [{ name: NAME }];

        await engine.evaluate(TEXT, { characterInfos });
        expect(calls()).toBe(1);

        await engine.evaluate(TEXT, { characterInfos, changedRange: TAIL_RANGE });
        expect(calls()).toBe(1);
    });

    it('未提供 changedRange 时保持普通缓存行为', async () => {
        const { checker, calls } = createCountingChecker();
        const engine = new QualityScoreEngine({ characterChecker: checker });
        const characterInfos = [{ name: NAME }];

        await engine.evaluate(TEXT, { characterInfos });
        const second = await engine.evaluate(TEXT, { characterInfos });

        expect(calls()).toBe(1);
        expect(second.fromCache).toBe(true);
    });
});
