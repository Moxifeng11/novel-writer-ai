/**
 * 文件级写入锁 — write-lock.ts
 * 
 * 用途：防止 entity-state-manager 与 settlement-engine
 * 跨模块并发写入同一实体文件（人物/地点/势力/物品 frontmatter）
 * 
 * 设计：
 * - 每个文件路径一个 Promise 链式队列
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
