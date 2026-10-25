import { describe, it, expect } from 'vitest';
import {
    getStreamlinedPhases,
    getPhaseStatusDescriptor,
    type StreamlinedPhase,
} from '../../../ui/full-writer/streamlined-nav-presenter';

/**
 * 阶段导航完成性判定护栏（Rev 176）。
 *
 * 用户确认口径：必做步骤全部完成即算阶段完成，可选步骤不阻塞；
 * 全可选阶段（质量审查）做过任意一步即算完成。
 * 这些用例锁定该口径，防止以后退回「全员 complete 才完成」。
 */

function phaseOf(key: StreamlinedPhase['key']): StreamlinedPhase {
    const phase = getStreamlinedPhases().find((p) => p.key === key);
    if (!phase) throw new Error(`阶段不存在: ${key}`);
    return phase;
}

/** 当前步骤不在任何被断言阶段内，避免命中 active 分支 */
const OUTSIDE_STEP_INDEX = 99;

function describePhase(
    key: StreamlinedPhase['key'],
    completed: string[],
    stale: string[] = [],
    results: Record<string, string> = {},
) {
    return getPhaseStatusDescriptor(
        phaseOf(key),
        OUTSIDE_STEP_INDEX,
        new Set(completed),
        results,
        new Set(stale),
        {},
    );
}

describe('requiredSteps 派生', () => {
    it('只把 ALL_FULL_STEPS.required 的步骤视为必做', () => {
        expect(phaseOf('context').requiredSteps).toEqual(['context']);
        expect(phaseOf('planning').requiredSteps).toEqual(['infoPlan']);
        expect(phaseOf('writing').requiredSteps).toEqual(['bodyGeneration']);
        expect(phaseOf('review').requiredSteps).toEqual([]);
        expect(phaseOf('settlement').requiredSteps).toEqual(['settlement']);
    });
});

describe('getPhaseStatusDescriptor — 必做完成即可', () => {
    it('上下文阶段：context 必做完成、characterSoul 未做 → 仍算完成', () => {
        const status = describePhase('context', ['context']);

        expect(status.status).toBe('complete');
        expect(status.title).toContain('可选 0/1');
    });

    it('规划阶段：只有必做 infoPlan 完成 → 完成，可选 0/4', () => {
        const status = describePhase('planning', ['infoPlan']);

        expect(status.status).toBe('complete');
        expect(status.title).toContain('可选 0/4');
    });

    it('规划阶段：只做了可选步骤 → 进行中，并提示必做进度', () => {
        const status = describePhase('planning', ['plotDistill']);

        expect(status.status).toBe('partial');
        expect(status.title).toContain('必做 0/1');
        expect(status.title).toContain('可选 1/4');
    });

    it('质量审查全可选：做过任意一步即算完成', () => {
        const status = describePhase('review', ['qualityControl']);

        expect(status.status).toBe('complete');
        expect(status.title).toContain('可选 1/2');
    });

    it('质量审查全可选：一步未做 → 待执行', () => {
        const status = describePhase('review', []);

        expect(status.status).toBe('pending');
    });

    it('必做步骤已完成但被标记过期 → 优先提示过期', () => {
        const status = describePhase('planning', ['infoPlan'], ['infoPlan']);

        expect(status.status).toBe('stale');
    });

    it('当前步骤所在阶段始终显示为 active', () => {
        const status = getPhaseStatusDescriptor(
            phaseOf('planning'),
            4,
            new Set(),
            {},
            new Set(),
            {},
        );

        expect(status.status).toBe('active');
    });
});
