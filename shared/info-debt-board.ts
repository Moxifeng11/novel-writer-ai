/**
 * info-debt-board.ts — 信息债看板的唯一写入入口（D3-17）。
 *
 * 三个写点（结算引擎 / 批量章节 / 伏笔管理器）此前各写各的：只有伏笔管理器
 * 加了锁，且还是 delete+write 两步；结算与批量的整文件覆盖会与并发刷新互相覆盖，
 * 批量入口还可能把看板写成旧快照。统一收口为「路径锁内覆盖写」。
 */
import { withWriteLock } from '@/shared/write-lock';

/**
 * 在路径锁内覆盖写信息债看板。
 *
 * 覆盖语义直接 write（不再先 delete）：写失败时旧看板仍在，不会出现「已删除但未写入」的空窗。
 *
 * @param path - 看板路径
 * @param content - 看板内容
 * @param write - 实际写盘函数（vault 索引写或 FileSystemPort 写）
 */
export async function writeInfoDebtBoard(
    path: string,
    content: string,
    write: (path: string, content: string) => Promise<void>,
): Promise<void> {
    await withWriteLock(path, () => write(path, content));
}
