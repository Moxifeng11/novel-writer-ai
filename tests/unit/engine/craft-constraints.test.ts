import { describe, expect, it } from 'vitest';
import {
    CRAFT_CONSTRAINT_MAX_CHARS,
    NEGATIVE_LIST_MAX_CHARS,
    buildCraftConstraintBlock,
    buildCraftSystemBlock,
    buildNegativeConstraintBlock,
} from '../../../engine/craft-constraints';

describe('craft-constraints — 生成期工艺约束', () => {
    it('工艺约束包含具体性、情绪行为化、转折和 POV 纪律', () => {
        const text = buildCraftConstraintBlock();
        expect(text).toContain('具体性配额');
        expect(text).toContain('不得直接命名情绪');
        expect(text).toContain('场景转折');
        expect(text).toContain('POV 纪律');
        expect(text.length).toBeLessThanOrEqual(CRAFT_CONSTRAINT_MAX_CHARS);
    });

    it('负面清单稳定、限长，并包含内置 AI 高频词', () => {
        const a = buildNegativeConstraintBlock();
        const b = buildNegativeConstraintBlock();
        expect(a).toBe(b);
        expect(a).toContain('眼中闪过一丝');
        expect(a).toContain('不由得');
        expect(a.length).toBeLessThanOrEqual(NEGATIVE_LIST_MAX_CHARS);
    });

    it('合并块不超过两段预算之和', () => {
        const text = buildCraftSystemBlock();
        expect(text).toContain('生成期工艺硬约束');
        expect(text).toContain('生成期禁用清单');
        expect(text.length).toBeLessThanOrEqual(CRAFT_CONSTRAINT_MAX_CHARS + NEGATIVE_LIST_MAX_CHARS);
    });
});
