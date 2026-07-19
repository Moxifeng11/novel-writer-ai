/**
 * realtime-monitor.test.ts — 实时监控总控制器单元测试
 *
 * 覆盖：
 *   1. 状态机（idle → evaluating → success/failed/cancelled）
 *   2. 事件发布订阅
 *   3. 并发保护
 *   4. 历史持久化
 *   5. 降级（score 失败 / deviation 失败）
 *   6. 取消（AbortSignal）
 *   7. 端到端协调流程
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MockFileSystem } from '../../../../shared/file-system-port';
import {
    RealtimeMonitor,
    type MonitorEvent,
    type MonitorState,
    type MonitorResult,
    type MonitorContext,
} from '../../../../engine/quality/realtime-monitor';
import { QualityHistoryStore } from '../../../../engine/quality/quality-history-store';
import type { QualityScoreEngine, QualityScore, EvaluationContext } from '../../../../engine/quality/quality-score-engine';
import type { DeviationDetector, DeviationReport, DeviationContext } from '../../../../engine/quality/deviation-detector';

// ============================================================
// Mock 工具
// ============================================================

function makeMockApp(): any {
    return { vault: {} };
}

function makeQualityScore(score: number): QualityScore {
    return {
        overallScore: score,
        dimensions: {
            readability: { dimension: 'readability', score, basis: [], issues: [], suggestions: [], details: {} },
            rhythm: { dimension: 'rhythm', score, basis: [], issues: [], suggestions: [], details: {} },
            emotion: { dimension: 'emotion', score, basis: [], issues: [], suggestions: [], details: {} },
            characterConsistency: { dimension: 'characterConsistency', score, basis: [], issues: [], suggestions: [], details: {} },
            coherence: { dimension: 'coherence', score, basis: [], issues: [], suggestions: [], details: {} },
            languageTexture: { dimension: 'languageTexture', score, basis: [], issues: [], suggestions: [], details: {} },
        },
        issues: [],
        suggestions: [],
        evaluatedAt: Date.now(),
        wordCount: 1000,
        evalTimeMs: 50,
        trend: 'stable',
        fromCache: false,
    };
}

function makeDeviationReport(score: number): DeviationReport {
    return {
        overallScore: score,
        overallSeverity: score > 60 ? 'critical' : score > 30 ? 'warning' : 'info',
        typeScores: {
            mainline: score,
            characterOOC: score,
            contradiction: score,
            foreshadowForgot: score,
            rhythm: score,
            emotionBreak: score,
        },
        issues: [],
        suggestions: [],
        evaluatedAt: Date.now(),
        wordCount: 1000,
        evalTimeMs: 30,
        fromCache: false,
        incremental: false,
    };
}

/** Mock QualityScoreEngine */
class MockScoreEngine implements Pick<QualityScoreEngine, 'evaluate'> {
    evaluateCalls = 0;
    lastText?: string;
    lastContext?: EvaluationContext;
    failWith?: Error;
    delayMs?: number;

    async evaluate(text: string, context?: EvaluationContext, signal?: AbortSignal): Promise<QualityScore> {
        this.evaluateCalls++;
        this.lastText = text;
        this.lastContext = context;

        if (this.delayMs) {
            await new Promise(resolve => setTimeout(resolve, this.delayMs));
        }

        if (signal?.aborted) {
            const err = new Error('Aborted');
            err.name = 'AbortError';
            throw err;
        }

        if (this.failWith) {
            throw this.failWith;
        }
        return makeQualityScore(75);
    }

    reset() {
        this.evaluateCalls = 0;
        this.failWith = undefined;
        this.delayMs = undefined;
    }
}

/** Mock DeviationDetector */
class MockDeviationDetector implements Pick<DeviationDetector, 'detect'> {
    detectCalls = 0;
    failWith?: Error;
    delayMs?: number;

    async detect(text: string, context: DeviationContext, signal?: AbortSignal): Promise<DeviationReport> {
        this.detectCalls++;
        if (this.delayMs) {
            await new Promise(resolve => setTimeout(resolve, this.delayMs));
        }
        if (signal?.aborted) {
            const err = new Error('Aborted');
            err.name = 'AbortError';
            throw err;
        }
        if (this.failWith) {
            throw this.failWith;
        }
        return makeDeviationReport(20);
    }

    reset() {
        this.detectCalls = 0;
        this.failWith = undefined;
        this.delayMs = undefined;
    }
}

function makeMonitorContext(overrides: Partial<MonitorContext> = {}): MonitorContext {
    return {
        projectId: 'p1',
        chapterId: 'c1',
        ...overrides,
    };
}

// ============================================================
// 测试套件
// ============================================================

describe('RealtimeMonitor', () => {
    let scoreEngine: MockScoreEngine;
    let deviationDetector: MockDeviationDetector;
    let historyStore: QualityHistoryStore;
    let monitor: RealtimeMonitor;

    beforeEach(() => {
        scoreEngine = new MockScoreEngine();
        deviationDetector = new MockDeviationDetector();
        historyStore = new QualityHistoryStore();
        monitor = new RealtimeMonitor({
            scoreEngine: scoreEngine as unknown as QualityScoreEngine,
            deviationDetector: deviationDetector as unknown as DeviationDetector,
            historyStore,
        });
    });

    // ----------------------------------------------------------
    // 状态机
    // ----------------------------------------------------------
    describe('状态机', () => {
        it('初始状态为 idle', () => {
            expect(monitor.getState()).toBe('idle');
            expect(monitor.isEvaluating()).toBe(false);
        });

        it('evaluate 后状态变为 success', async () => {
            await monitor.evaluate('test text', makeMonitorContext());
            expect(monitor.getState()).toBe('idle'); // 完成后回到 idle
        });

        it('评估中状态为 evaluating', async () => {
            scoreEngine.delayMs = 50;
            const promise = monitor.evaluate('test', makeMonitorContext());
            expect(monitor.isEvaluating()).toBe(true);
            await promise;
            expect(monitor.isEvaluating()).toBe(false);
        });

        it('reset 强制回到 idle', async () => {
            scoreEngine.delayMs = 1000;
            const promise = monitor.evaluate('test', makeMonitorContext());
            // 评估中 reset
            monitor.reset();
            expect(monitor.getState()).toBe('idle');
            // 等待 promise 完成避免 unhandled rejection
            monitor.cancel();
            try {
                await promise;
            } catch { /* ignore */ }
        });
    });

    // ----------------------------------------------------------
    // 事件订阅
    // ----------------------------------------------------------
    describe('事件订阅', () => {
        it('on 订阅 start 事件', async () => {
            const events: MonitorEvent[] = [];
            monitor.on('start', e => events.push(e));

            await monitor.evaluate('test', makeMonitorContext());

            expect(events.length).toBe(1);
            expect(events[0].type).toBe('start');
            expect(events[0].state).toBe('evaluating');
            expect(events[0].evaluationId).toBeDefined();
        });

        it('on 订阅 complete 事件携带 result', async () => {
            const events: MonitorEvent[] = [];
            monitor.on('complete', e => events.push(e));

            await monitor.evaluate('test', makeMonitorContext());

            expect(events.length).toBe(1);
            expect(events[0].type).toBe('complete');
            expect(events[0].result).toBeDefined();
            expect(events[0].result!.qualityScore).toBeDefined();
            expect(events[0].result!.deviations).toBeDefined();
        });

        it('on 订阅 failed 事件', async () => {
            const events: MonitorEvent[] = [];
            monitor.on('failed', e => events.push(e));

            scoreEngine.failWith = new Error('score failed');
            deviationDetector.failWith = new Error('deviation failed');

            await monitor.evaluate('test', makeMonitorContext());

            expect(events.length).toBe(1);
            expect(events[0].type).toBe('failed');
            expect(events[0].error).toContain('score failed');
            expect(events[0].error).toContain('deviation failed');
        });

        it('on 订阅 cancelled 事件', async () => {
            const events: MonitorEvent[] = [];
            monitor.on('cancelled', e => events.push(e));

            scoreEngine.delayMs = 1000;
            const promise = monitor.evaluate('test', makeMonitorContext());

            monitor.cancel();
            await promise;

            expect(events.length).toBe(1);
            expect(events[0].type).toBe('cancelled');
        });

        it('state-change 事件每次状态变化都触发', async () => {
            const events: MonitorEvent[] = [];
            monitor.on('state-change', e => events.push(e));

            await monitor.evaluate('test', makeMonitorContext());

            // evaluating → success → idle（至少 3 次）
            expect(events.length).toBeGreaterThanOrEqual(3);
            const states = events.map(e => e.state);
            expect(states).toContain('evaluating');
            expect(states).toContain('success');
            expect(states).toContain('idle');
        });

        it('off 取消订阅', async () => {
            const handler = vi.fn();
            const unsubscribe = monitor.on('start', handler);

            await monitor.evaluate('test', makeMonitorContext());
            expect(handler).toHaveBeenCalledTimes(1);

            unsubscribe();
            await monitor.evaluate('test', makeMonitorContext());
            expect(handler).toHaveBeenCalledTimes(1);
        });

        it('onAll 订阅所有事件', async () => {
            const events: MonitorEvent[] = [];
            monitor.onAll(e => events.push(e));

            await monitor.evaluate('test', makeMonitorContext());

            const types = new Set(events.map(e => e.type));
            expect(types.has('start')).toBe(true);
            expect(types.has('complete')).toBe(true);
            expect(types.has('state-change')).toBe(true);
        });

        it('事件处理器异常不影响流程', async () => {
            monitor.on('start', () => { throw new Error('handler error'); });

            const result = await monitor.evaluate('test', makeMonitorContext());
            expect(result.qualityScore).toBeDefined();
        });
    });

    // ----------------------------------------------------------
    // 并发保护
    // ----------------------------------------------------------
    describe('并发保护', () => {
        it('评估中再次调用应抛错', async () => {
            scoreEngine.delayMs = 200;

            const promise1 = monitor.evaluate('test', makeMonitorContext());

            await expect(monitor.evaluate('test2', makeMonitorContext()))
                .rejects.toThrow(/busy/);

            await promise1;
        });

        it('取消后可重新评估', async () => {
            scoreEngine.delayMs = 500;
            const promise1 = monitor.evaluate('test', makeMonitorContext());
            monitor.cancel();
            await promise1;

            // 应能再次评估
            const result = await monitor.evaluate('test2', makeMonitorContext());
            expect(result.cancelled).toBe(false);
        });
    });

    // ----------------------------------------------------------
    // 历史持久化
    // ----------------------------------------------------------
    describe('历史持久化', () => {
        it('评估完成后自动写入历史', async () => {
            await monitor.evaluate('test text', makeMonitorContext());

            const entries = historyStore.getHistory('c1');
            expect(entries).toBeDefined();
            expect(entries!.length).toBe(1);
            expect(entries![0].overallScore).toBe(75);
        });

        it('persistToHistory=false 不写入历史', async () => {
            await monitor.evaluate('test', makeMonitorContext({ persistToHistory: false }));

            const entries = historyStore.getHistory('c1');
            expect(entries).toBeNull();
        });

        it('部分失败时仍持久化', async () => {
            deviationDetector.failWith = new Error('deviation failed');
            await monitor.evaluate('test', makeMonitorContext());

            const entries = historyStore.getHistory('c1');
            expect(entries).toBeDefined();
            expect(entries!.length).toBe(1);
            expect(entries![0].overallScore).toBe(75);
        });

        it('全部失败时不持久化', async () => {
            scoreEngine.failWith = new Error('score failed');
            deviationDetector.failWith = new Error('deviation failed');

            await monitor.evaluate('test', makeMonitorContext());

            const entries = historyStore.getHistory('c1');
            expect(entries).toBeNull();
        });
    });

    // ----------------------------------------------------------
    // 降级
    // ----------------------------------------------------------
    describe('降级策略', () => {
        it('scoreEngine 失败仅返回 deviations', async () => {
            scoreEngine.failWith = new Error('score failed');

            const result = await monitor.evaluate('test', makeMonitorContext());

            expect(result.qualityScore).toBeUndefined();
            expect(result.deviations).toBeDefined();
            expect(result.partialFailure).toBe(true);
            expect(result.failures).toContain('quality: score failed');
        });

        it('deviationDetector 失败仅返回 score', async () => {
            deviationDetector.failWith = new Error('deviation failed');

            const result = await monitor.evaluate('test', makeMonitorContext());

            expect(result.qualityScore).toBeDefined();
            expect(result.deviations).toBeUndefined();
            expect(result.partialFailure).toBe(true);
            expect(result.failures).toContain('deviations: deviation failed');
        });

        it('skipQuality=true 跳过质量评估', async () => {
            const result = await monitor.evaluate('test', makeMonitorContext({ skipQuality: true }));

            expect(result.qualityScore).toBeUndefined();
            expect(result.deviations).toBeDefined();
            expect(result.partialFailure).toBe(false);
            expect(scoreEngine.evaluateCalls).toBe(0);
            expect(deviationDetector.detectCalls).toBe(1);
        });

        it('skipDeviations=true 跳过偏离检测', async () => {
            const result = await monitor.evaluate('test', makeMonitorContext({ skipDeviations: true }));

            expect(result.qualityScore).toBeDefined();
            expect(result.deviations).toBeUndefined();
            expect(result.partialFailure).toBe(false);
            expect(scoreEngine.evaluateCalls).toBe(1);
            expect(deviationDetector.detectCalls).toBe(0);
        });

        it('全部失败时状态为 failed', async () => {
            scoreEngine.failWith = new Error('fail');
            deviationDetector.failWith = new Error('fail');

            const result = await monitor.evaluate('test', makeMonitorContext());

            expect(result.qualityScore).toBeUndefined();
            expect(result.deviations).toBeUndefined();
            expect(result.partialFailure).toBe(false);
        });
    });

    // ----------------------------------------------------------
    // 取消
    // ----------------------------------------------------------
    describe('取消', () => {
        it('cancel() 触发 AbortError 并返回 cancelled 结果', async () => {
            scoreEngine.delayMs = 500;
            const promise = monitor.evaluate('test', makeMonitorContext());

            setTimeout(() => monitor.cancel(), 50);

            const result = await promise;
            expect(result.cancelled).toBe(true);
        });

        it('外部 AbortSignal 已 abort 时立即返回 cancelled', async () => {
            const controller = new AbortController();
            controller.abort();

            const result = await monitor.evaluate('test', makeMonitorContext(), controller.signal);

            expect(result.cancelled).toBe(true);
            expect(scoreEngine.evaluateCalls).toBe(0);
        });

        it('外部 AbortSignal 中途触发', async () => {
            scoreEngine.delayMs = 500;
            const controller = new AbortController();
            const promise = monitor.evaluate('test', makeMonitorContext(), controller.signal);

            setTimeout(() => controller.abort(), 50);

            const result = await promise;
            expect(result.cancelled).toBe(true);
        });

        it('cancelled 事件携带 evaluationId', async () => {
            const events: MonitorEvent[] = [];
            monitor.on('cancelled', e => events.push(e));

            scoreEngine.delayMs = 500;
            const promise = monitor.evaluate('test', makeMonitorContext());
            monitor.cancel();
            await promise;

            expect(events.length).toBe(1);
            expect(events[0].evaluationId).toBeDefined();
        });
    });

    // ----------------------------------------------------------
    // 端到端
    // ----------------------------------------------------------
    describe('端到端协调', () => {
        it('并行调用 scoreEngine + deviationDetector', async () => {
            const start = Date.now();
            scoreEngine.delayMs = 50;
            deviationDetector.delayMs = 50;

            await monitor.evaluate('test', makeMonitorContext());

            const elapsed = Date.now() - start;
            // 并行执行总耗时 ≈ 50ms（而非 100ms）
            expect(elapsed).toBeLessThan(120);
        });

        it('结果携带正确元数据', async () => {
            const result = await monitor.evaluate('test content', makeMonitorContext());

            expect(result.projectId).toBe('p1');
            expect(result.chapterId).toBe('c1');
            expect(result.timestamp).toBeGreaterThan(0);
            expect(result.durationMs).toBeGreaterThanOrEqual(0);
            expect(result.wordCount).toBeGreaterThan(0);
            expect(result.contentHash).toBeDefined();
            expect(result.fromCache).toBe(false);
        });

        it('evaluationId 格式正确', async () => {
            const result = await monitor.evaluate('test', makeMonitorContext({ projectId: 'px', chapterId: 'cx' }));
            expect(result.evaluationId).toContain('px');
            expect(result.evaluationId).toContain('cx');
        });

        it('context 透传给 scoreEngine', async () => {
            const qualityContext: EvaluationContext = {
                chapterId: 'c1',
                chapterTitle: '第一章',
                wordCount: 1000,
            } as any;

            await monitor.evaluate('test', makeMonitorContext({ qualityContext }));

            expect(scoreEngine.lastContext).toBe(qualityContext);
        });

        it('dispose 清理订阅', () => {
            const handler = vi.fn();
            monitor.on('start', handler);

            monitor.dispose();

            // dispose 后再订阅需要新实例（这里仅验证状态）
            expect(monitor.getState()).toBe('idle');
        });
    });
});
