/**
 * ghost-trigger.test.ts — 自动联想（幽灵建议）的最小请求间隔
 *
 * 1.5s 防抖后尾部种子只要多一个字就会重新请求；慢速打字时等于每次停顿都打一次 AI。
 * 这里只验证「距上次请求是否已过最小间隔」这一纯判断。
 */
import { describe, it, expect } from 'vitest';
import { GHOST_ASSOCIATION_MIN_INTERVAL_MS } from '../../../shared/thresholds';
import { shouldRequestGhostAssociationByInterval } from '../../../shared/ghost-trigger';

const T0 = 1_700_000_000_000;

describe('shouldRequestGhostAssociationByInterval', () => {
    it('尚未请求过时立即放行', () => {
        expect(shouldRequestGhostAssociationByInterval(T0, 0, GHOST_ASSOCIATION_MIN_INTERVAL_MS)).toBe(true);
    });

    it('刚好达到最小间隔时放行', () => {
        expect(
            shouldRequestGhostAssociationByInterval(
                T0 + GHOST_ASSOCIATION_MIN_INTERVAL_MS,
                T0,
                GHOST_ASSOCIATION_MIN_INTERVAL_MS,
            ),
        ).toBe(true);
    });

    it('差 1ms 未达间隔时跳过', () => {
        expect(
            shouldRequestGhostAssociationByInterval(
                T0 + GHOST_ASSOCIATION_MIN_INTERVAL_MS - 1,
                T0,
                GHOST_ASSOCIATION_MIN_INTERVAL_MS,
            ),
        ).toBe(false);
    });

    it('上一秒内刚请求过时跳过（慢速打字的典型场景）', () => {
        expect(shouldRequestGhostAssociationByInterval(T0 + 1200, T0, GHOST_ASSOCIATION_MIN_INTERVAL_MS)).toBe(false);
    });

    it('间隔配置为 0 或负数时关闭限频', () => {
        expect(shouldRequestGhostAssociationByInterval(T0 + 1, T0, 0)).toBe(true);
        expect(shouldRequestGhostAssociationByInterval(T0 + 1, T0, -1)).toBe(true);
    });

    it('lastRequestAt 非法时按「未请求过」处理', () => {
        expect(shouldRequestGhostAssociationByInterval(T0, Number.NaN, GHOST_ASSOCIATION_MIN_INTERVAL_MS)).toBe(true);
    });
});
