/**
 * write-lock.ts — 跨层文件/资源写入锁
 *
 * 用途：防止多个写入者并发写同一文件或同一份共享状态。
 * 放在 shared：engine 与 services 都需要使用，而分层守卫不允许两侧互相依赖。
 *
 * 设计：
 * - 每个锁 key 一条 Promise 链式队列
 * - 后续写入必须等待前一个完成
 * - 写失败自动释放锁（finally 保证不泄漏）
 *
 * 用法：
 *   import { withWriteLock } from './write-lock';
 *   const result = await withWriteLock(filePath, async () => {
 *       const content = await vault.read(file);
 *       // ... modify ...
 *       await vault.modify(file, newContent);
 *   });
 */

type LockQueue = Promise<void>;

const queues = new Map<string, LockQueue>();

/**
 * 知识向量状态锁。
 * KnowledgeVectorStore 的「加载 / 拆解写入 / 重向量化」与
 * KnowledgeBaseManager 的「改名同步 bookName」共用这一把锁：
 * 后完成者若不与前者串行，会用旧书名覆盖改名结果或留下半写索引。
 */
export const KNOWLEDGE_VECTOR_STATE_LOCK = 'knowledge-vectors:state';

export async function withWriteLock<T>(
    filePath: string,
    fn: () => Promise<T>,
): Promise<T> {
    const prev = queues.get(filePath) || Promise.resolve();

    let resolveNext!: () => void;
    const nextSlot = new Promise<void>(r => { resolveNext = r; });

    const task: Promise<T> = prev.then(async () => {
        try {
            return await fn();
        } finally {
            resolveNext();
        }
    });

    // v3.4.9: 任务完成后若队列无后续等待者，自动清理条目防内存泄漏
    const drainSlot = nextSlot.then(() => {
        // 此时 prev 链已完成；若 Map 中仍为此条目 => 无新任务注册 => 可安全删除
        if (queues.get(filePath) === drainSlot) {
            queues.delete(filePath);
        }
    });
    queues.set(filePath, drainSlot);

    return task;
}
