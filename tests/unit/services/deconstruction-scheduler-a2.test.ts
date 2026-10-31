import { describe, it, expect, vi } from 'vitest';
import { DeconstructionScheduler } from '../../../engine/deconstruction-scheduler';

function createKnowledgeBaseManager(book: { id: string; name: string } | null = { id: 'book-1', name: '测试书籍' }) {
    return {
        getBook: async (bookId: string) => (book && book.id === bookId ? book : null),
        setBreakdownStatus: async () => {},
        getSourceText: async () => '第一章\n' + '正文内容'.repeat(500),
    } as any;
}

function settingsGetter() {
    return {
        deconstructionEngine: {
            defaultQualityLevel: 'fast' as const,
            enableAutoUpgrade: true,
            enabledDimensions: ['style'] as any[],
            includeCommercial: false,
            includeReadability: false,
            vectorEnabled: false,
            vectorModel: 'bge-m3',
            vectorCacheSize: 5000,
            vectorBatchSize: 32,
            llmEnabled: false,
            llmModel: 'deepseek-r1:7b',
            maxConcurrency: 1,
            textSampleLimit: 10,
            dimensionConcurrency: 3,
        },
    };
}

function createScheduler(kb: any, vectorStore?: any) {
    return new DeconstructionScheduler(
        {} as any,
        kb,
        undefined,
        vectorStore,
        undefined,
        settingsGetter
    );
}

describe('DeconstructionScheduler — A2 同书并发治理', () => {
    it('同一本书已有在途任务时 addTask 返回同一 taskId，不新建', async () => {
        const scheduler = createScheduler(createKnowledgeBaseManager());
        try {
            const first = await scheduler.addTask('book-1', '正文', ['style']);
            await scheduler.pauseTask(first);

            const second = await scheduler.addTask('book-1', '正文', ['style']);

            expect(second).toBe(first);
            expect(scheduler.getAllTasks()).toHaveLength(1);
        } finally {
            scheduler.destroy();
        }
    });

    it('不同书可以各自建任务', async () => {
        const kb = createKnowledgeBaseManager({ id: 'book-1', name: '测试书籍' });
        kb.getBook = async (bookId: string) => ({ id: bookId, name: `书-${bookId}` });
        const scheduler = createScheduler(kb);
        try {
            const first = await scheduler.addTask('book-1', '正文', ['style']);
            await scheduler.pauseTask(first);
            const other = await scheduler.addTask('book-2', '正文', ['style']);

            expect(other).not.toBe(first);
        } finally {
            scheduler.destroy();
        }
    });

    it('cancelByBook 取消该书所有在途任务，不影响其他书', async () => {
        const kb = createKnowledgeBaseManager({ id: 'book-1', name: '测试书籍' });
        kb.getBook = async (bookId: string) => ({ id: bookId, name: `书-${bookId}` });
        const scheduler = createScheduler(kb);
        try {
            const target = await scheduler.addTask('book-1', '正文', ['style']);
            await scheduler.pauseTask(target);
            const other = await scheduler.addTask('book-2', '正文', ['style']);
            await scheduler.pauseTask(other);

            await scheduler.cancelByBook('book-1');

            expect(scheduler.getTask(target)?.status).toBe('cancelled');
            expect(scheduler.getTask(other)?.status).toBe('paused');
        } finally {
            scheduler.destroy();
        }
    });

    it('书已删除时 revectorizeBook 不写向量', async () => {
        const replaceBookSamples = vi.fn(async () => undefined);
        const addBookSamples = vi.fn(async () => undefined);
        const scheduler = createScheduler(
            createKnowledgeBaseManager(null),
            { replaceBookSamples, addBookSamples }
        );
        try {
            await scheduler.revectorizeBook('book-deleted', '已删除的书');
            expect(replaceBookSamples).not.toHaveBeenCalled();
            expect(addBookSamples).not.toHaveBeenCalled();
        } finally {
            scheduler.destroy();
        }
    });
});
