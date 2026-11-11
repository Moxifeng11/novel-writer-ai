/**
 * kb-modals-logic.ts — 知识库弹窗的纯逻辑（阶段 D1）
 *
 * 从 `ui/views/knowledge-base-modals.ts` 抽出。弹窗里的字段比较看似简单，
 * 但 `undefined` 与 `''` 的等价性、`|| ''` 兜底这些细节很容易写错——
 * 写错的后果是「用户改了分类但系统没记录偏好」，属于静默失效。
 */

/** 书籍分类快照（弹窗里可编辑的三个分类字段） */
export interface BookGenreSnapshot {
    genreChannel?: string;
    primaryGenre?: string;
    primarySubGenre?: string;
}

/** 分类变更检测结果 */
export interface GenreChangeResult {
    channelChanged: boolean;
    genreChanged: boolean;
    subGenreChanged: boolean;
    /** 三者任一变化（决定是否需要记录分类纠正偏好） */
    anyChanged: boolean;
}

/**
 * 把 `undefined` / `null` / `''` 统一成空串。
 *
 * 三者都表示「未设置」，比较时不能区分，否则 `undefined → ''` 会被误判为「改过」。
 *
 * @param value - 原始值
 * @returns 规范化后的字符串
 */
function normalize(value: string | undefined | null): string {
    return (value ?? '').trim();
}

/**
 * 检测分类字段是否发生变化。
 *
 * @param before - 保存前的快照
 * @param after - 保存后的快照
 * @returns 各字段变更标记
 */
export function detectGenreChanges(
    before: BookGenreSnapshot,
    after: BookGenreSnapshot,
): GenreChangeResult {
    const channelChanged = normalize(after.genreChannel) !== normalize(before.genreChannel);
    const genreChanged = normalize(after.primaryGenre) !== normalize(before.primaryGenre);
    const subGenreChanged = normalize(after.primarySubGenre) !== normalize(before.primarySubGenre);
    return {
        channelChanged,
        genreChanged,
        subGenreChanged,
        anyChanged: channelChanged || genreChanged || subGenreChanged,
    };
}

/**
 * 校验书籍名称是否可以保存。
 *
 * @param name - 输入的书名
 * @returns 是否通过（空白名不允许保存）
 */
export function isValidBookName(name: string | undefined | null): boolean {
    return normalize(name).length > 0;
}
