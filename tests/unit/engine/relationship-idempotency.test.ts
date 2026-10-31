import { describe, expect, it } from 'vitest';
import { applyRelationshipChanges } from '../../../engine/relationship-engine';

const change = {
    charA: '沈砚', charB: '沈铁山', dimension: 'trust', delta: 5,
    reason: '父子: 沈砚替父挡下差役的刁难 trust +5',
};

describe('relationship-engine — 结算幂等', () => {
    it('同一章重跑不二次累加', () => {
        const first = applyRelationshipChanges([], [{ ...change }], '第3章_测脉');
        expect(first.applied).toBe(1);
        const trustAfterFirst = first.relations[0].state.trust;

        const second = applyRelationshipChanges(first.relations, [{ ...change }], '第3章_测脉');
        expect(second.applied).toBe(0);
        expect(second.skipped).toBe(1);
        expect(second.relations[0].state.trust).toBe(trustAfterFirst);
        expect(second.relations[0].state.history.match(/第3章_测脉/g)?.length).toBe(1);
    });

    it('换一章或换原因会正常累加', () => {
        const first = applyRelationshipChanges([], [{ ...change }], '第3章_测脉');
        const second = applyRelationshipChanges(first.relations, [{ ...change }], '第4章_锁痕');
        expect(second.applied).toBe(1);
        expect(second.relations[0].state.trust).toBe(60);

        const third = applyRelationshipChanges(second.relations, [{ ...change, delta: -5, reason: '父子: 争吵 trust -5' }], '第4章_锁痕');
        expect(third.applied).toBe(1);
        expect(third.relations[0].state.trust).toBe(55);
    });
});
