/**
 * A5 — 向量化失败必须可见，不能继续提示「拆解完成」。
 *
 * 历史实现：拆解主体先写 `completed`，向量化失败只 `log.warn`，
 * 完成 Notice 无条件提示成功；用户去写作时参考内容恒为空，也没有重试入口。
 */

import { describe, it, expect } from 'vitest';
import {
    DeconstructionScheduler,
    buildBreakdownFinishNotice,
    type BreakdownTask,
} from '../../../engine/deconstruction-scheduler';

function makeManager() {
    const vectorCalls: Array<{ bookId: string; status: string; error?: string }> = [];
    const manager = {
        vectorCalls,
        getBook: async (bookId: string) => ({ id: bookId, name: '测试书' }),
        setBreakdownStatus: async () => {},
        getSourceText: async () => '',
        setVectorStatus: async (bookId: string, status: string, error?: string) => {
            vectorCalls.push({ bookId, status, error });
        },
    };
    return manager;
}

function makeScheduler(manager: ReturnType<typeof makeManager>, vectorStore?: ConstructorParameters<typeof DeconstructionScheduler>[3]): DeconstructionScheduler {
    return new DeconstructionScheduler(
        {} as any,
        manager as any,
        undefined,
        vectorStore,
        undefined,
        () => ({}) as any,
    );
}

function makeTask(): BreakdownTask {
    return {
        id: 'task-1',
        bookId: 'book-1',
        bookName: '测试书',
        sourceText: '正文',
        dimensions: ['style'],
        status: 'completed',
        progress: 100,
        createdAt: Date.now(),
    };
}

describe('A5 — 拆解完成提示区分向量化结果', () => {
    it('向量化成功时提示保持原样', () => {
        const message = buildBreakdownFinishNotice('测试书', { status: 'done' });
        expect(message).toContain('拆解完成');
        expect(message).not.toContain('向量化失败');
    });

    it('向量化失败时说明原因并指路重试', () => {
        const message = buildBreakdownFinishNotice('测试书', { status: 'failed', error: '端点不可用' });
        expect(message).toContain('拆解完成，但向量化失败');
        expect(message).toContain('端点不可用');
        expect(message).toContain('重试向量化');
    });
});

describe('A5 — 向量化结果写回任务与书籍状态', () => {
    it('成功时任务与书籍都记为 done', async () => {
        const manager = makeManager();
        const scheduler = makeScheduler(manager);
        const task = makeTask();

        await (scheduler as any).recordVectorOutcome(task);

        expect(task.vectorStatus).toBe('done');
        expect(task.vectorError).toBeUndefined();
        expect(manager.vectorCalls).toEqual([{ bookId: 'book-1', status: 'done', error: undefined }]);
        scheduler.destroy();
    });

    it('失败时任务记 failed + 原因，并落盘到书籍信息', async () => {
        const manager = makeManager();
        const scheduler = makeScheduler(manager);
        const task = makeTask();

        await (scheduler as any).recordVectorOutcome(task, new Error('端点不可用'));

        expect(task.vectorStatus).toBe('failed');
        expect(task.vectorError).toBe('端点不可用');
        expect(manager.vectorCalls).toEqual([{ bookId: 'book-1', status: 'failed', error: '端点不可用' }]);
        scheduler.destroy();
    });
});

describe('A5 — 重试向量化入口', () => {
    it('未配置向量存储时如实报错，不伪装成功', async () => {
        const manager = makeManager();
        const scheduler = makeScheduler(manager);

        await expect(scheduler.revectorizeBook('book-1', '测试书')).rejects.toThrow('未配置向量存储');
        expect(manager.vectorCalls).toEqual([]);
        scheduler.destroy();
    });

    it('重试成功写回 done', async () => {
        const manager = makeManager();
        const scheduler = makeScheduler(manager, { addBookSamples: async () => {} });
        (scheduler as any).vectorizeBook = async () => {};

        await scheduler.revectorizeBook('book-1', '测试书');

        expect(manager.vectorCalls).toEqual([{ bookId: 'book-1', status: 'done', error: undefined }]);
        scheduler.destroy();
    });

    it('重试失败写回 failed 并继续抛错给调用方', async () => {
        const manager = makeManager();
        const scheduler = makeScheduler(manager, { addBookSamples: async () => {} });
        (scheduler as any).vectorizeBook = async () => {
            throw new Error('embedding 超时');
        };

        await expect(scheduler.revectorizeBook('book-1', '测试书')).rejects.toThrow('embedding 超时');
        expect(manager.vectorCalls).toEqual([{ bookId: 'book-1', status: 'failed', error: 'embedding 超时' }]);
        scheduler.destroy();
    });
});
