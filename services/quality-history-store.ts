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
    parseQualityHistoryFile,
    serializeQualityHistoryFile,
    type QualityHistoryRecord,
} from '@/shared/quality-history';
import { QUALITY_HISTORY_MAX_RECORDS } from '@/shared/thresholds';

/**
 * 质量历史路径。
 * @param project - 项目（路径或对象）
 * @returns 文本结果
 */
export function qualityHistoryPath(project: string): string {
    return `${pjControlDir(project)}/质量历史.json`;
}

/**
 * 读取项目质量历史；文件缺失或损坏时返回空数组
 *
 * @param app - Obsidian 应用实例
 * @param project - 项目（路径或对象）
 * @returns 结果数组
 */
export async function loadQualityHistory(app: App, project: string): Promise<QualityHistoryRecord[]> {
    if (!project) return [];
    const file = app.vault.getAbstractFileByPath(qualityHistoryPath(project));
    if (!(file instanceof TFile)) return [];
    try {
        return parseQualityHistoryFile(await app.vault.read(file));
    } catch {
        return [];
    }
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
            const existing = await loadQualityHistory(app, project);
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
