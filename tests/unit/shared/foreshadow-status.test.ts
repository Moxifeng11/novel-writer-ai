import { describe, expect, it } from 'vitest';
import { isForeshadowRevealed, parseForeshadowRevealState } from '../../../shared/foreshadow-status';

describe('foreshadow-status — 伏笔揭示状态唯一判定', () => {
    it('否定语义优先：「未揭示/待揭示/未回收/埋设」都算未揭示', () => {
        for (const status of ['未揭示', '待揭示', '未回收', '未兑现', '埋设中', '铺垫中']) {
            expect(parseForeshadowRevealState(status), status).toBe('unrevealed');
            expect(isForeshadowRevealed(status), status).toBe(false);
        }
    });

    it('肯定语义：已揭示/已回收/已兑现/回收 都算已揭示', () => {
        for (const status of ['已揭示', '已回收', '已兑现', '回收', '揭示']) {
            expect(parseForeshadowRevealState(status), status).toBe('revealed');
            expect(isForeshadowRevealed(status), status).toBe(true);
        }
    });

    it('空状态按未揭示（与旧统计口径一致）', () => {
        expect(parseForeshadowRevealState('')).toBe('unrevealed');
        expect(parseForeshadowRevealState(null)).toBe('unrevealed');
        expect(parseForeshadowRevealState(undefined)).toBe('unrevealed');
    });

    it('废弃/自定义状态返回 unknown，不误判为已揭示', () => {
        expect(parseForeshadowRevealState('已废弃')).toBe('unknown');
        expect(parseForeshadowRevealState('作者备注：留给第二卷')).toBe('unknown');
        expect(isForeshadowRevealed('已废弃')).toBe(false);
    });

    it('容忍空白与全角空格', () => {
        expect(parseForeshadowRevealState('  未 揭示  ')).toBe('unrevealed');
        expect(parseForeshadowRevealState('已　揭示')).toBe('revealed');
    });
});
