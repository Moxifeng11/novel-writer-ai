import { describe, it, expect, vi } from 'vitest';
import { ExecutionRunStore } from '../../../ui/full-writer/execution-run-store';
import { createStepFailure } from '../../../shared/execution-events';

describe('ExecutionRunStore', () => {
    it('同一失败消息在 2 秒内只保留一条，并升级级别', () => {
        const store = new ExecutionRunStore();
        store.addEvent({ type: 'notice', level: 'warning', message: '信息规划 未达到完成标准', stepKey: 'infoPlan' });
        store.addEvent({ type: 'step-error', level: 'error', message: '信息规划 未达到完成标准', stepKey: 'infoPlan' });

        expect(store.getEvents()).toHaveLength(1);
        expect(store.getEvents()[0].level).toBe('error');
    });

    it('记录失败后可按步骤取回，并在重试时清除', () => {
        const store = new ExecutionRunStore();
        const failure = createStepFailure({
            stepKey: 'infoPlan',
            stepLabel: '信息规划',
            message: '信息规划 未达到完成标准',
            missing: ['冲突强度'],
        });
        store.recordFailure(failure);

        expect(store.getFailure('infoPlan')?.missing).toEqual(['冲突强度']);
        expect(store.getEvents().some(event => event.level === 'error')).toBe(true);
        expect(store.getLogs().some(log => log.level === 'error')).toBe(true);

        store.clearFailure('infoPlan');
        expect(store.getFailure('infoPlan')).toBeUndefined();
    });

    it('通知订阅者事件、失败、状态与重置', async () => {
        const store = new ExecutionRunStore();
        const listener = vi.fn();
        const unsubscribe = store.subscribe(listener);

        store.addEvent({ type: 'step-start', level: 'info', message: '开始执行' });
        store.recordFailure(createStepFailure({
            stepKey: 'outline',
            stepLabel: '大纲摘要',
            message: '保存失败',
        }));
        store.setStatus('执行中...', 2, 5, 1);
        await new Promise(resolve => setTimeout(resolve, 150));
        store.reset();

        expect(listener.mock.calls.map(call => call[0])).toContain('event');
        expect(listener.mock.calls.map(call => call[0])).toContain('failure');
        expect(listener.mock.calls.map(call => call[0])).toContain('status');
        expect(listener.mock.calls.map(call => call[0])).toContain('reset');

        unsubscribe();
        expect(store.getEvents()).toHaveLength(0);
        expect(store.getLogs()).toHaveLength(0);
    });

    it('状态只保留最新文案与进度', async () => {
        const store = new ExecutionRunStore();
        store.setStatus('第一步', 1, 5, 0);
        store.setStatus('第二步', 2, 5, 1);
        await new Promise(resolve => setTimeout(resolve, 150));

        expect(store.getStatus()).toEqual({ message: '第二步', current: 2, total: 5, aiCalls: 1 });
        store.clearStatus();
        expect(store.getStatus()).toBeNull();
    });

    it('导出文本包含时间线、调试详情与堆栈', () => {
        const store = new ExecutionRunStore();
        store.addEvent({ type: 'step-start', level: 'info', message: '开始执行', stepKey: 'infoPlan', stepLabel: '信息规划' });
        store.addLog({
            level: 'error',
            scope: 'step',
            message: '执行异常',
            stepKey: 'infoPlan',
            stepLabel: '信息规划',
            detail: '模型返回空内容',
            stack: 'Error: boom\n  at step-runner.ts:1',
        });

        const text = store.exportText();
        expect(text).toContain('信息规划');
        expect(text).toContain('开始执行');
        expect(text).toContain('模型返回空内容');
        expect(text).toContain('Error: boom');
    });

    it('事件与日志数量有上限，避免长时间运行吃内存', () => {
        const store = new ExecutionRunStore();
        for (let i = 0; i < 350; i++) {
            store.addEvent({ type: 'run-progress', level: 'info', message: `进度 ${i}` });
        }
        for (let i = 0; i < 900; i++) {
            store.addLog({ level: 'debug', scope: 'api', message: `日志 ${i}` });
        }

        expect(store.getEvents().length).toBeLessThanOrEqual(300);
        expect(store.getLogs().length).toBeLessThanOrEqual(800);
        expect(store.getEvents()[store.getEvents().length - 1].message).toBe('进度 349');
    });
});
