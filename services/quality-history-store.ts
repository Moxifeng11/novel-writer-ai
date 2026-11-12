/**
 * quality-history-store.ts — 质量历史的磁盘持久化
 *
 * 落盘到 `项目/04-项目总控/质量历史.json`，与 data.json 解耦：
 * 历史是持续增长的数据，混进插件设置会导致设置文件不断膨胀。
 */
import { App, TFile } from 'obsidian';
import { pjControlDir } from '@/shared/paths';
import {
    aggregateQualityHistoryByChapter,
    computeChapterTrend,
    mergeQualityHistory,
    parseQualityHistoryFileDetailed,
    serializeQualityHistoryFile,
    type QualityHistoryRecord,
} from '@/shared/quality-history';
import { QUALITY_HISTORY_MAX_RECORDS } from '@/shared/thresholds';
import { createLogger } from '@/shared/logger';

const log = createLogger('QualityHistory');

/**
 * 质量历史路径。
 * @param project - 项目（路径或对象）
 * @returns 文本结果
 */
export function qualityHistoryPath(project: string): string {
    return `${pjControlDir(project)}/质量历史.json`;
}

/**
 * 读取项目质量历史（带失败状态）。
 *
 * 原实现把「读失败」与「文件不存在」都返回 `[]`，而唯一写入口
 * `appendQualityHistory` 会拿这个空数组合并后**整份覆盖写**——
 * 一次同步冲突/占用就能把最多 200 条历史洗成 1 条，且损坏原文被覆盖、无法抢救。
 *
 * @param app - Obsidian 应用实例
 * @param project - 项目（路径或对象）
 * @returns 记录与失败状态
 */
export async function loadQualityHistoryDetailed(
    app: App,
    project: string,
): Promise<{ records: QualityHistoryRecord[]; readFailed: boolean; parseFailed: boolean }> {
    if (!project) return { records: [], readFailed: false, parseFailed: false };
    const file = app.vault.getAbstractFileByPath(qualityHistoryPath(project));
    if (!(file instanceof TFile)) return { records: [], readFailed: false, parseFailed: false };
    let raw: string;
    try {
        raw = await app.vault.read(file);
    } catch {
        return { records: [], readFailed: true, parseFailed: false };
    }
    const { records, parseFailed } = parseQualityHistoryFileDetailed(raw);
    return { records, readFailed: false, parseFailed };
}

/**
 * 读取项目质量历史；文件缺失或损坏时返回空数组
 *
 * @param app - Obsidian 应用实例
 * @param project - 项目（路径或对象）
 * @returns 结果数组
 */
export async function loadQualityHistory(app: App, project: string): Promise<QualityHistoryRecord[]> {
    return (await loadQualityHistoryDetailed(app, project)).records;
}

/**
 * 同一项目的追加串行化。
 *
 * 追加是「读文件 → 合并 → 覆盖写」，两条写入口（协同实时落盘、面板 B 节流落盘）
 * 并发时会各自读到同一份旧文件，后写者覆盖先写者，丢掉一条记录。
 * 按项目排队，不同项目互不阻塞。
 */
const appendQueues = new Map<string, Promise<unknown>>();

/**
 * 追加一条记录并回写；返回合并后的完整历史
 *
 * @param app - Obsidian 应用实例
 * @param project - 项目（路径或对象）
 * @param record - 记录
 * @param max - 最大
 * @returns 结果数组
 */
export async function appendQualityHistory(
    app: App,
    project: string,
    record: QualityHistoryRecord,
    max: number = QUALITY_HISTORY_MAX_RECORDS,
): Promise<QualityHistoryRecord[]> {
    const previous = appendQueues.get(project) ?? Promise.resolve();
    const task = previous
        .catch(() => undefined)
        .then(async () => {
            const loaded = await loadQualityHistoryDetailed(app, project);
            // 读到坏数据时先留档再重建：否则「合并空数组 + 覆盖写」等于把用户
            // 最多 200 条历史永久抹掉（趋势曲线与基线随之失效），且无法人工抢救。
            if (loaded.readFailed || loaded.parseFailed) {
                await archiveCorruptQualityHistory(app, project);
            }
            const existing = loaded.records;
            // 趋势统一在唯一写入口按「章」重算：调用方（协同实时落盘、面板 B 节流落盘）
            // 各自的引擎只有「最近 N 次评估」，直接落盘会写出章内打字波动。
            const withTrend: QualityHistoryRecord = {
                ...record,
                trend: computeChapterTrend(record, existing),
            };
            const merged = mergeQualityHistory(existing, [withTrend], max);
            // 磁盘只保留「章级样本」：基线 / 章级趋势的统计单位是章，同一章多次评估
            // 只需最后一条。面板 B 每 30s 落盘一次，若按条累积，写一小时同一章就能
            // 灌满 200 条配额，把前面所有章的样本裁掉，基线在长时间写作中反而失效。
            const chapterLevel = aggregateQualityHistoryByChapter(merged);
            await writeQualityHistory(app, project, chapterLevel);
            return chapterLevel;
        });

    appendQueues.set(project, task);
    try {
        return await task;
    } finally {
        // 只清理自己排的那一格，避免误删后续追加建立的队列
        if (appendQueues.get(project) === task) appendQueues.delete(project);
    }
}

/**
 * 覆盖写入（裁剪后）
 *
 * @param app - Obsidian 应用实例
 * @param project - 项目（路径或对象）
 * @param entries - 记录集合
 */
export async function writeQualityHistory(
    app: App,
    project: string,
    entries: QualityHistoryRecord[],
): Promise<void> {
    const path = qualityHistoryPath(project);
    const content = serializeQualityHistoryFile(entries);
    const file = app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
        await app.vault.modify(file, content);
        return;
    }
    await ensureControlDir(app, project);
    await app.vault.create(path, content);
}

async function ensureControlDir(app: App, project: string): Promise<void> {
    const dir = pjControlDir(project);
    if (await app.vault.adapter.exists(dir)) return;
    if (!(await app.vault.adapter.exists(project))) return;
    await app.vault.adapter.mkdir(dir);
}

/**
 * 把损坏/读不出的质量历史改名留档（`.corrupt-<时间戳>.json`），避免被覆盖写抹掉。
 *
 * 与 `writing-stats-service` 的 D3-11 口径一致：坏数据先留档再重建，
 * 用户/后续版本仍可从留档里人工抢救。
 *
 * @param app - Obsidian 应用实例
 * @param project - 项目（路径或对象）
 * @returns 是否成功留档（失败不阻断主流程，但会在控制台留痕）
 */
async function archiveCorruptQualityHistory(app: App, project: string): Promise<void> {
    const path = qualityHistoryPath(project);
    const backup = path.replace(/\.json$/i, `.corrupt-${Date.now()}.json`);
    try {
        if (!(await app.vault.adapter.exists(path))) return;
        const raw = await app.vault.adapter.read(path);
        // write-entry-allow: 备份是 .corrupt-<ts>.json 索引外文件，只能走 adapter
        await app.vault.adapter.write(backup, raw);
        log.warn('[QualityHistory] 质量历史读取/解析失败，已留档:', backup);
    } catch (e) {
        log.warn('[QualityHistory] 质量历史留档失败（继续重建，但原文件可能被覆盖）:', e);
    }
}
