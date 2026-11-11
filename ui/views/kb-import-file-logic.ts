/**
 * kb-import-file-logic.ts — 知识库书籍导入的文件侧纯逻辑（阶段 D2）
 *
 * 从 `ui/views/knowledge-base-modals.ts` 抽出：文件选择列表的搜索过滤、
 * SEC-7 的「读前硬限」判断、文件名 → 书名的推导。此前内联在 Modal 里零覆盖；
 * 过滤改成区分大小写、限值判断错边（> vs >=）、扩展名正则少一个转义，
 * 用户都会踩到但没人知道为什么。
 *
 * 约定：不 import obsidian、不碰 DOM；上限数值从 services 常量注入（不复制一份）。
 */

/** 带可选 name/basename/path 的最小文件形状（与 TFile 结构兼容） */
export interface BookFileLike {
    name?: string;
    basename?: string;
    path?: string;
}

/**
 * 文件选择列表按查询过滤（大小写不敏感的包含匹配，空查询返回全部）。
 *
 * @param files - 候选文件
 * @param query - 搜索框内容
 * @returns 过滤后的新数组（不改原数组）
 */
export function filterBookFiles<T extends BookFileLike>(files: readonly T[], query: string): T[] {
    const needle = (query ?? '').toLowerCase();
    return files.filter(f => (f.name ?? '').toLowerCase().includes(needle));
}

/**
 * SEC-7：读前硬限判断（`file.text()` 是全量读，兜底截断为时已晚）。
 *
 * 语义与抽取前一致：**严格大于**上限才拒绝（恰好等于上限允许）。
 *
 * @param size - 文件字节数
 * @param maxBytes - 上限（调用方传 services 的 MAX_SOURCE_FILE_SIZE，不在此复制）
 * @returns 是否超限
 */
export function isSourceFileTooLarge(size: number, maxBytes: number): boolean {
    return size > maxBytes;
}

/**
 * 超限提示里的 MB 文案（向上进位由 Math.round 决定，与抽取前一致）。
 *
 * @param size - 字节数
 * @returns 形如 `11` 的 MB 整数串
 */
export function formatSourceFileSizeMb(size: number): string {
    return String(Math.round(size / 1024 / 1024));
}

/**
 * 文件名 → 书名：剥掉 `.txt` / `.md` 扩展名（大小写不敏感），其余原样保留。
 *
 * @param fileName - 带扩展名的文件名
 * @returns 书名
 */
export function resolveBookNameFromFile(fileName: string): string {
    return fileName.replace(/\.(txt|md)$/i, '');
}

/**
 * 导入书名是否为空（空串 / 纯空白都算空，导入前拦住）。
 *
 * @param name - 待检查书名
 * @returns 是否为空
 */
export function isBlankBookName(name: string | undefined | null): boolean {
    return !name || name.trim().length === 0;
}
