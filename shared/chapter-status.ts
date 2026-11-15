/**
 * chapter-status.ts — 章节正文状态的单一判定（B4）
 *
 * 背景：结算幂等、导出前检查、批量续跑、协同写作入口各自写了状态正则，
 * 出现三种口径：全文匹配、前 4000 字匹配、仅 frontmatter 匹配。
 * 同一条 `status: settled` 在不同入口可能得出不同结论。
 *
 * 这里只认 frontmatter（状态本来就只写在那里），并兼容旧值；
 * 没有 frontmatter 一律视为未结算，由调用方决定是否重试。
 */

/** 骨架文件体量上限（字节）。模板骨架约 287 字节，真实章节普遍 > 2KB */
export const SKELETON_BYTE_THRESHOLD = 1500;

/** 规范状态值（C2：全仓唯一状态词汇） */
export type CanonicalChapterStatus = 'pending' | 'written' | 'settled';

/** 旧值 / 中文值 → 规范状态 */
const STATUS_ALIASES: Record<string, CanonicalChapterStatus> = {
    pending: 'pending',
    draft: 'pending',
    drafting: 'pending',
    草稿: 'pending',
    待写: 'pending',
    written: 'written',
    已写: 'written',
    已生成: 'written',
    需修改: 'written',
    settled: 'settled',
    已结算: 'settled',
    已完稿: 'settled',
    已完成: 'settled',
    done: 'settled',
};

/**
 * 把任意写盘值规范成三类状态之一（未知值按 pending 处理）。
 *
 * @param raw - 原始状态值
 * @returns 规范状态
 */
export function normalizeChapterStatus(raw: string | undefined | null): CanonicalChapterStatus {
    const value = String(raw ?? '').trim();
    if (!value) return 'pending';
    return STATUS_ALIASES[value.toLowerCase()] ?? STATUS_ALIASES[value] ?? 'pending';
}

/**
 * 是否「已写」状态（written 或 settled）。
 *
 * @param raw - 原始状态值
 * @returns 是否已写
 */
export function isWrittenOrSettledStatus(raw: string | undefined | null): boolean {
    const status = normalizeChapterStatus(raw);
    return status === 'written' || status === 'settled';
}

/**
 * 单章是否已写（状态优先，无状态时按体量兜底）——全仓唯一判定口径。
 *
 * @param status - 原始状态
 * @param hasBody - 是否存在正文文件
 * @param size - 正文文件字节数
 * @returns 是否已写
 */
export function isChapterWrittenRecord(status: string | undefined | null, hasBody: boolean, size: number): boolean {
    if (!hasBody) return false;
    const raw = String(status ?? '').trim();
    if (raw) {
        // 有状态时一律以状态为准：未登记的自定义值按 pending（不猜、不靠体量）
        return isWrittenOrSettledStatus(raw);
    }
    // 旧文件没有 status：按体量兜底，避免把真实章节误判成骨架
    return size > SKELETON_BYTE_THRESHOLD;
}

/** 表示「已结算」的状态值：新值 settled，旧值兼容 */
export const SETTLED_STATUS_VALUES = ['settled', '已结算', '已完稿'] as const;

/**
 * 章节状态结构定义。
 */
export type ChapterStatus = 'settled' | 'written' | 'draft' | 'unknown';

/**
 * 取正文的 frontmatter 文本（不含分隔行）；没有则返回 null
 *
 * @param text - 文本内容
  * @returns 文本结果 或 null
 */
export function extractFrontmatter(text: string | undefined | null): string | null {
    const raw = String(text ?? '');
    // 容忍 BOM 与 CRLF
    const normalized = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
    if (!normalized.startsWith('---\n')) return null;
    const end = normalized.indexOf('\n---', 4);
    if (end < 0) return null;
    return normalized.slice(4, end);
}

/**
 * 读取 frontmatter 的 status 值（去引号/空白）；没有返回 null
 *
 * @param text - 文本内容
  * @returns 文本结果 或 null
 */
export function readFrontmatterStatus(text: string | undefined | null): string | null {
    const fm = extractFrontmatter(text);
    if (!fm) return null;
    const match = fm.match(/^\s*status:\s*['"]?([^'"\n]+?)['"]?\s*$/m);
    return match ? match[1].trim() : null;
}

/**
 * 正文是否已结算（只读 frontmatter，避免正文里出现同名字样造成误判）
 *
 * @param text - 文本内容
 * @returns 是否成功
 */
export function isChapterSettledText(text: string | undefined | null): boolean {
    const status = readFrontmatterStatus(text);
    return status !== null && (SETTLED_STATUS_VALUES as readonly string[]).includes(status);
}

/**
 * 归一化后的状态（用于 UI 展示/统计，不改变写盘值）
 *
 * @param text - 文本内容
  * @returns ChapterStatus 实例
 */
export function parseChapterStatus(text: string | undefined | null): ChapterStatus {
    const status = readFrontmatterStatus(text);
    if (status === null) return 'unknown';
    if ((SETTLED_STATUS_VALUES as readonly string[]).includes(status)) return 'settled';
    if (status === 'written' || status === '已写' || status === '已生成') return 'written';
    if (status === 'drafting' || status === 'draft' || status === '草稿') return 'draft';
    return 'unknown';
}
