/**
 * chapter-progress.ts — 章节完成度判定（纯函数，可测）
 *
 * 背景（2026-10-29 bug）：`批量建章` 会为规划中的每一章创建正文骨架文件
 * （`status: pending`、`word_count: 0`、约 300 字节）。旧逻辑把「存在正文文件」
 * 直接当作 `hasBody: true`，于是 400 个骨架 = 「共 400 章」，并把数组最后一章
 * （第400章骨架）当成「最新章」，导致 Agent 让用户从第400章开始续写。
 *
 * 判定口径：
 *   - 已写：`status` 为 written / settled；无 status（旧文件）时按体量兜底；
 *   - 待写骨架：`status` 为 pending / draft，或体量低于骨架阈值；
 *   - 「最新章 / 下一章」只看已写章节，不看骨架。
 */

/** 骨架文件体量上限（字节）。模板骨架约 287 字节，真实章节普遍 > 2KB */
export const SKELETON_BYTE_THRESHOLD = 1500;

const WRITTEN_STATUSES = new Set(['written', 'settled']);
/** 显式占位状态：明确标记未写，即便文件被撑大也不算完成 */
const PLACEHOLDER_STATUSES = new Set(['pending', 'draft']);

export interface ChapterProgressInput {
    chapter: string;
    status: string;
    /** 是否存在正文文件（骨架目录没有） */
    hasBody: boolean;
    /** 正文文件字节数；无文件时 0 */
    size: number;
}

export interface ChapterProgressSummary {
    /** 章节条目总数（已写 + 骨架） */
    total: number;
    /** 已写章节数（status=written/settled，或旧文件按体量判定） */
    written: number;
    /** 待写骨架数（占位，未写正文） */
    skeletons: number;
    /** 各状态原始计数（保留给 UI/遥测） */
    byStatus: Record<string, number>;
    /** 最后一章已写章节名（如「第1章」），无已写时为 '' */
    latestWrittenChapter: string;
    /** 建议续写的章名（最新已写 + 1），全部未写时为首章 */
    nextChapterToWrite: string;
    /** 规划总章数（取条目总数与已写章号的最大值，兼容只有正文无骨架的项目） */
    plannedChapters: number;
}

/**
 * 单章是否已写（status 优先，无 status 时按体量兜底）
 *
 * @param status - 状态
 * @param hasBody - 是否含正文
 * @param size - 大小
 * @returns 是否成功
 */
export function isChapterWritten(status: string, hasBody: boolean, size: number): boolean {
    if (!hasBody) return false;
    const normalized = (status || '').trim().toLowerCase();
    if (WRITTEN_STATUSES.has(normalized)) return true;
    if (PLACEHOLDER_STATUSES.has(normalized)) return false;
    // 未登记状态（旧文件/自定义）：按体量判断，避免把真实章节误判成骨架
    return size > SKELETON_BYTE_THRESHOLD;
}

/**
 * 章名 → 单元号（支持章/节/集/回/幕；解析失败返回 0）
 *
 * @param chapter - 章节
 * @returns 数值结果
 */
export function chapterNumber(chapter: string): number {
    const matched = String(chapter || '').match(/第\s*(\d+)\s*[章节集回幕]/);
    return matched ? parseInt(matched[1], 10) : 0;
}

export interface SummarizeChapterOptions {
    /** 「建议续写」的单位名；短篇传「节」、剧本传「集」，默认「章」 */
    unitLabel?: string;
}

/**
 * 汇总章节完成度；输入顺序无关，内部按章号排序
 *
 * @param entries - 记录集合
 * @param options - 配置项
  * @returns ChapterProgressSummary 实例
 */
export function summarizeChapterProgress(
    entries: ChapterProgressInput[],
    options: SummarizeChapterOptions = {},
): ChapterProgressSummary {
    const byStatus: Record<string, number> = {};
    let written = 0;
    let skeletons = 0;
    let latestWrittenNum = 0;
    let latestWrittenChapter = '';
    let maxChapterNum = 0;

    for (const entry of entries) {
        const status = (entry.status || 'pending').trim().toLowerCase() || 'pending';
        const statusKey = status === '' ? 'pending' : status;
        byStatus[statusKey] = (byStatus[statusKey] || 0) + 1;

        const num = chapterNumber(entry.chapter);
        if (num > maxChapterNum) maxChapterNum = num;

        if (isChapterWritten(entry.status, entry.hasBody, entry.size)) {
            written++;
            if (num > latestWrittenNum) {
                latestWrittenNum = num;
                latestWrittenChapter = entry.chapter;
            }
        } else {
            skeletons++;
        }
    }

    // 规划章数：条目总数与最大章号取较大者（骨架缺失但有真实章节时不低估）
    const plannedChapters = Math.max(entries.length, maxChapterNum);
    const unitLabel = options.unitLabel || '章';
    const nextChapterToWrite = latestWrittenNum > 0
        ? `第${latestWrittenNum + 1}${unitLabel}`
        : `第1${unitLabel}`;

    return {
        total: entries.length,
        written,
        skeletons,
        byStatus,
        latestWrittenChapter,
        nextChapterToWrite,
        plannedChapters,
    };
}
