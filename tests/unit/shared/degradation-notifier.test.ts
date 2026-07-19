/**
 * degradation-notifier.test.ts — 统一降级事件系统单元测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    DegradationNotifier,
    getDegradationNotifier,
} from '../../../shared/degradation-notifier';
import type { DegradationEvent } from '../../../shared/degradation-notifier';

describe('DegradationNotifier', () => {
    let warnSpy: any;
    let errorSpy: any;
    let infoSpy: any;

    beforeEach(() => {
        warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    });

    afterEach(() => {
        warnSpy.mockRestore();
        errorSpy.mockRestore();
        infoSpy.mockRestore();
    });

    it('notify 填充 severity/recoverable/timestamp 默认值', () => {
        const notifier = new DegradationNotifier();
        const before = Date.now();
        const event = notifier.notify({
            source: 'vector',
            from: 'vector',
            to: 'statistics',
            reason: '向量服务不可用',
        });

        expect(event.severity).toBe('warning');
        expect(event.recoverable).toBe(false);
        expect(event.timestamp).toBeGreaterThanOrEqual(before);
        expect(event.source).toBe('vector');
    });

    it('notify 分发给所有已注册 sink', () => {
        const notifier = new DegradationNotifier();
        const received: DegradationEvent[] = [];
        notifier.registerSink((e) => received.push(e));
        notifier.registerSink((e) => received.push(e));

        notifier.notify({ source: 'llm', from: 'llm', to: 'template', reason: 'x' });

        expect(received).toHaveLength(2);
        expect(received[0].source).toBe('llm');
    });

    it('registerSink 返回的注销函数可停止接收事件', () => {
        const notifier = new DegradationNotifier();
        const received: DegradationEvent[] = [];
        const unregister = notifier.registerSink((e) => received.push(e));

        notifier.notify({ source: 'quality', from: 'full', to: 'basic', reason: '1' });
        unregister();
        notifier.notify({ source: 'quality', from: 'full', to: 'basic', reason: '2' });

        expect(received).toHaveLength(1);
    });

    it('单个 sink 抛错不影响其他 sink 与主流程', () => {
        const notifier = new DegradationNotifier();
        const received: DegradationEvent[] = [];
        notifier.registerSink(() => {
            throw new Error('sink 故障');
        });
        notifier.registerSink((e) => received.push(e));

        expect(() =>
            notifier.notify({ source: 'injection', from: 'full', to: 'keyword_stats', reason: 'y' })
        ).not.toThrow();
        expect(received).toHaveLength(1);
        expect(errorSpy).toHaveBeenCalled();
    });

    it('getEvents / getEventsByDimension / hasDegradation 正确收集与过滤', () => {
        const notifier = new DegradationNotifier();
        notifier.notify({ source: 'vector', dimension: 'style', from: 'vector', to: 'stat', reason: 'a' });
        notifier.notify({ source: 'vector', dimension: 'rhythm', from: 'vector', to: 'stat', reason: 'b' });

        expect(notifier.getEvents()).toHaveLength(2);
        expect(notifier.getEventsByDimension('style')).toHaveLength(1);
        expect(notifier.hasDegradation('style')).toBe(true);
        expect(notifier.hasDegradation('unknown')).toBe(false);
    });

    it('getEvents 返回副本，外部修改不影响内部状态', () => {
        const notifier = new DegradationNotifier();
        notifier.notify({ source: 'llm', from: 'llm', to: 'x', reason: 'r' });
        const events = notifier.getEvents();
        events.pop();
        expect(notifier.getEvents()).toHaveLength(1);
    });

    it('clear 清空已收集事件', () => {
        const notifier = new DegradationNotifier();
        notifier.notify({ source: 'llm', from: 'llm', to: 'x', reason: 'r' });
        notifier.clear();
        expect(notifier.getEvents()).toHaveLength(0);
    });

    it('maxEvents 上限触发时丢弃最旧事件', () => {
        const notifier = new DegradationNotifier({ maxEvents: 3 });
        for (let i = 0; i < 5; i++) {
            notifier.notify({ source: 'vector', from: 'vector', to: 'stat', reason: `#${i}` });
        }
        const events = notifier.getEvents();
        expect(events).toHaveLength(3);
        expect(events[0].reason).toBe('#2');
        expect(events[2].reason).toBe('#4');
    });

    it('不同 severity 走对应日志级别', () => {
        const notifier = new DegradationNotifier();
        notifier.notify({ source: 'vector', from: 'v', to: 's', reason: 'c', severity: 'critical' });
        notifier.notify({ source: 'vector', from: 'v', to: 's', reason: 'w', severity: 'warning' });
        notifier.notify({ source: 'vector', from: 'v', to: 's', reason: 'i', severity: 'info' });

        expect(errorSpy).toHaveBeenCalled();
        expect(warnSpy).toHaveBeenCalled();
    });

    it('getDegradationNotifier 返回稳定单例', () => {
        expect(getDegradationNotifier()).toBe(getDegradationNotifier());
    });
});
