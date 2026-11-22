/**
 * 人称混用统计（一致性审核与四项校验共用口径）
 */

import { describe, expect, it } from 'vitest';
import { detectPerspectiveMix } from '@/engine/consistency/extended-rules';

describe('detectPerspectiveMix', () => {
    it('纯第一人称不判混用', () => {
        const out = detectPerspectiveMix('我说过。我走了。我回头。');
        expect(out.first).toBe(3);
        expect(out.third).toBe(0);
        expect(out.mixed).toBe(false);
        expect(out.ratio).toBe(0);
    });

    it('两侧都 ≥3 且比例 ≥0.25 判混用', () => {
        const out = detectPerspectiveMix('我说好。他走了。我点头。他笑了。我也走了。他也笑了。');
        expect(out.first).toBe(3);
        expect(out.third).toBe(3);
        expect(out.mixed).toBe(true);
        expect(out.ratio).toBe(1);
    });

    it('单侧次数不足时不判混用', () => {
        const out = detectPerspectiveMix('我说好。他走了。他笑了。他点头。他回头。');
        expect(out.mixed).toBe(false);
    });

    it('对话引号内的「我/他」不计入叙事视角', () => {
        const text = '“我不同意。”\n“我也不走。”\n“我也不去。”\n“我不信。”\n“我不怕。”';
        const out = detectPerspectiveMix(text);
        expect(out.first).toBe(0);
        expect(out.third).toBe(0);
        expect(out.mixed).toBe(false);
    });

    it('剔除对话后叙述里的人称照常计数', () => {
        const text = '“走吧。”我说。他点头。我起身。他推门。我回头。他停下。';
        const out = detectPerspectiveMix(text);
        expect(out.first).toBe(3);
        expect(out.third).toBe(3);
        expect(out.mixed).toBe(true);
    });

    it('比例过低（一侧偶发）时不判混用', () => {
        const out = detectPerspectiveMix('我说好。' + '他走了。'.repeat(9));
        expect(out.mixed).toBe(false);
        expect(out.ratio).toBeCloseTo(1 / 9, 5);
    });
});
