import { describe, expect, it, vi } from 'vitest';
import { BatchImportManager } from '../../../engine/batch-import-manager';

/**
 * L-3（2026-11-10 维度①审计）：批量导入在禁用/热重载时不可取消。
 * 旧 dispose 只 flush 写队列，processing 中的任务会继续 addBook/saveSourceText/
 * addTask；目标调度器已被 destroy，留下「有书无拆解」的半成品。
 * 这里用挂起的 addBook 把任务卡在 await 上，验证 dispose/cancelTask 后：
 *  - 任务终态是 cancelled（不被 catch 改回 failed / 不重排队）；
 *  - 不再写源文、不再排拆解任务；
 *  - 队列清空。
 */
class FakeFileSystem {
    files = new Map<string, string>();
    folders = new Set<string>();
    async read(path: string): Promise<string> {
        const value = this.files.get(path);
        if (value === undefined) throw new Error(`ENOENT: ${path}`);
        return value;
    }
    async write(path: string, content: string): Promise<void> {
        this.files.set(path, content);
    }
    async exists(path: string): Promise<boolean> {
        return this.files.has(path) || this.folders.has(path);
    }
    async delete(path: string): Promise<void> {
        this.files.delete(path);
        this.folders.delete(path);
    }
    async mkdir(path: string): Promise<void> {
        this.folders.add(path);
    }
    async rename(from: string, to: string): Promise<void> {
        const value = this.files.get(from);
        if (value !== undefined) {
            this.files.delete(from);
            this.files.set(to, value);
        }
    }
    async listFiles(_path: string): Promise<never[]> {
        return [];
    }
}

function makeHarness() {
    const fs = new FakeFileSystem();
    let resolveAddBook: ((book: Record<string, unknown>) => void) | null = null;
    let rejectAddBook: ((error: Error) => void) | null = null;
    const addBook = vi.fn(() => new Promise<Record<string, unknown>>((resolve, reject) => {
        resolveAddBook = resolve;
        rejectAddBook = reject;
    }));
    const books = new Map<string, Record<string, unknown>>();
    const kbManager = {
        addBook,
        getBook: vi.fn(async (id: string) => books.get(id)),
        getBaseDir: () => undefined,
    };
    const scheduler = { addTask: vi.fn(async () => 'task-1') };
    const manager = new BatchImportManager({} as never, kbManager as never, scheduler as never);
    Reflect.set(manager, 'fs', fs);
    Reflect.set(manager, 'settings', {
        ...(Reflect.get(manager, 'settings') as Record<string, unknown>),
        autoStartDeconstruction: true,
        dimensions: ['plot'],
        concurrency: 1,
    });
    manager.addPreview({ filename: '取消测试.txt', content: '正文内容', source: 'local-file' });
    manager.getSelectedPreviews().forEach((preview) => manager.updatePreview(preview.id, { selected: true }));
    return {
        manager,
        fs,
        scheduler,
        addBook,
        books,
        resolveAddBook: (book: Record<string, unknown>) => {
            books.set(String(book.id), book);
            resolveAddBook?.(book);
        },
        rejectAddBook: (error: Error) => rejectAddBook?.(error),
    };
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error('等待条件超时');
}

describe('BatchImportManager — 卸载/取消可中断', () => {
    it('dispose 取消挂起的导入：任务 cancelled，不再写源文/排拆解', async () => {
        const harness = makeHarness();
        harness.manager.startImport();
        await waitFor(() => harness.addBook.mock.calls.length > 0);

        await harness.manager.dispose();
        harness.resolveAddBook({ id: 'book-1', name: '取消测试' });
        await waitFor(() => harness.manager.getAllTasks()[0]?.status === 'cancelled');

        expect((Reflect.get(harness.manager, 'queue') as string[]).length).toBe(0);
        expect(harness.scheduler.addTask).not.toHaveBeenCalled();
        expect([...harness.fs.files.keys()].some((path) => path.endsWith('.txt'))).toBe(false);
        const task = harness.manager.getAllTasks()[0];
        expect(task.status).toBe('cancelled');
        expect(task.error).toContain('取消');
    });

    it('cancelTask(processing) 后 catch 不会把状态改回 failed 或重排队', async () => {
        const harness = makeHarness();
        harness.manager.startImport();
        await waitFor(() => harness.addBook.mock.calls.length > 0);

        const task = harness.manager.getAllTasks()[0];
        harness.manager.cancelTask(task.id);
        harness.resolveAddBook({ id: 'book-2', name: '取消测试' });
        await waitFor(() => harness.manager.getAllTasks()[0]?.status === 'cancelled');
        // 给 catch/finally 留一个事件循环，确认不会变成 failed/queued
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(harness.manager.getAllTasks()[0].status).toBe('cancelled');
        expect((Reflect.get(harness.manager, 'queue') as string[]).length).toBe(0);
        expect(harness.scheduler.addTask).not.toHaveBeenCalled();
    });
});
