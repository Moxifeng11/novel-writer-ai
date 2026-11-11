/**
 * kb-book-filter.ts — 知识库书籍列表的筛选、排序与计数（无 DOM、无实例状态）
 *
 * 背景（v4.83.0 UI 可测性治理 · 第 6 批）：`knowledge-base-view.ts` 的 `getFilteredBooks`
 * （64 行）与 4 个计数方法原本嵌在 ItemView 里，覆盖率 0.34%。筛选是用户直接操作的核心行为，
 * 规则密集但只能靠点界面确认。
 *
 * 口径提醒（见 docs/audits/knowledge-base-view-structure-survey.md 风险点 #1）：
 * **子题材筛选是嵌套条件** —— 只在「主题材选择了具体题材」时才生效；
 * 主题材为 `all` 或 `uncategorized` 时不筛子题材。写成平铺分支会让「全部」视图误筛。
 */

import type { BookBasicInfo, BreakdownStatus } from '@/services/knowledge-base-manager';

/** 频道筛选值 */
export type BookChannelFilter = 'male' | 'female' | 'neutral' | 'all';

/** 主题材筛选值：具体题材 id / 全部 / 未分类 */
export type BookGenreFilter = string | 'all' | 'uncategorized';

/** 排序字段 */
export type BookSortBy = 'createdAt' | 'updatedAt' | 'wordCount' | 'quality';

/** 排序方向 */
export type BookSortOrder = 'asc' | 'desc';

/**
 * 书籍列表筛选状态（与视图中的 FilterState 同构）。
 */
export interface BookFilterState {
    channel: BookChannelFilter;
    primaryGenre: BookGenreFilter;
    subGenre: string | 'all';
    keyword: string;
    status: BreakdownStatus | 'all';
    sortBy: BookSortBy;
    sortOrder: BookSortOrder;
}

/**
 * 关键词是否命中书籍。
 *
 * 命中范围与视图一致：书名、作者、题材标签、自定义标签（均转小写子串匹配）。
 *
 * @param book - 书籍
 * @param keyword - 已转小写的关键词
 * @returns 是否命中
 */
function matchesKeyword(book: BookBasicInfo, keyword: string): boolean {
    return book.name.toLowerCase().includes(keyword)
        || Boolean(book.author?.toLowerCase().includes(keyword))
        || book.themeTags.some(tag => tag.toLowerCase().includes(keyword))
        || book.customTags.some(tag => tag.toLowerCase().includes(keyword));
}

/**
 * 按筛选状态过滤书籍（不含排序）。
 *
 * 过滤顺序：频道 → 主题材 → 子题材（嵌套） → 状态 → 关键词。
 *
 * @param books - 全部书籍
 * @param filter - 筛选状态
 * @returns 过滤后的新数组（不改原数组）
 *
 * @example
 * filterBooks(books, { ...filter, channel: 'female' }) // => 仅女频
 */
export function filterBooks(books: BookBasicInfo[], filter: BookFilterState): BookBasicInfo[] {
    let result = [...books];

    if (filter.channel !== 'all') {
        result = result.filter(book => book.genreChannel === filter.channel);
    }

    if (filter.primaryGenre === 'uncategorized') {
        result = result.filter(book => !book.primaryGenre);
    } else if (filter.primaryGenre !== 'all') {
        result = result.filter(book =>
            book.primaryGenre === filter.primaryGenre
            || Boolean(book.secondaryGenres?.includes(filter.primaryGenre as string)),
        );
        // 子题材只在「已选定具体题材」时有意义（原实现的嵌套语义，勿外提）
        if (filter.subGenre !== 'all') {
            result = result.filter(book => book.primarySubGenre === filter.subGenre);
        }
    }

    if (filter.status !== 'all') {
        result = result.filter(book => book.breakdownStatus === filter.status);
    }

    if (filter.keyword) {
        const keyword = filter.keyword.toLowerCase();
        result = result.filter(book => matchesKeyword(book, keyword));
    }

    return result;
}

/**
 * 按指定字段排序（返回新数组，不改原数组）。
 *
 * 未知 `sortBy` 保持原有顺序（`cmp` 恒为 0）。
 *
 * @param books - 待排序书籍
 * @param sortBy - 排序字段
 * @param sortOrder - 升降序
 * @returns 排序后的新数组
 */
export function sortBooks(books: BookBasicInfo[], sortBy: BookSortBy, sortOrder: BookSortOrder): BookBasicInfo[] {
    return [...books].sort((a, b) => {
        let cmp = 0;
        switch (sortBy) {
            case 'createdAt':
                cmp = a.createdAt - b.createdAt;
                break;
            case 'updatedAt':
                cmp = a.updatedAt - b.updatedAt;
                break;
            case 'wordCount':
                cmp = (a.wordCount ?? 0) - (b.wordCount ?? 0);
                break;
            case 'quality':
                cmp = (a.qualityScores?.overall ?? 0) - (b.qualityScores?.overall ?? 0);
                break;
        }
        return sortOrder === 'asc' ? cmp : -cmp;
    });
}

/**
 * 先筛选再排序（视图 `getFilteredBooks` 的完整等价实现）。
 *
 * @param books - 全部书籍
 * @param filter - 筛选状态
 * @returns 过滤并按 `sortBy`/`sortOrder` 排序的新数组
 */
export function filterAndSortBooks(books: BookBasicInfo[], filter: BookFilterState): BookBasicInfo[] {
    return sortBooks(filterBooks(books, filter), filter.sortBy, filter.sortOrder);
}

/**
 * 统计某频道下的书籍数量（`all` 表示全部）。
 *
 * @param books - 全部书籍
 * @param channel - 频道筛选值
 * @returns 数量
 */
export function countBooksInChannel(books: BookBasicInfo[], channel: BookChannelFilter): number {
    return books.filter(book => channel === 'all' || book.genreChannel === channel).length;
}

/**
 * 统计某题材下的书籍数量（主题材命中，或次要题材包含）。
 *
 * 注意：与列表筛选不同，这里的题材计数**也**受频道约束（与原实现一致）。
 *
 * @param books - 全部书籍
 * @param genreId - 题材 id
 * @param channel - 频道筛选值
 * @returns 数量
 */
export function countBooksByGenre(books: BookBasicInfo[], genreId: string, channel: BookChannelFilter): number {
    return books.filter(book => {
        if (channel !== 'all' && book.genreChannel !== channel) return false;
        return book.primaryGenre === genreId || Boolean(book.secondaryGenres?.includes(genreId));
    }).length;
}

/**
 * 统计某题材下某个细分题材的书籍数量（要求主题材与子题材同时命中）。
 *
 * @param books - 全部书籍
 * @param genreId - 题材 id
 * @param subGenreId - 细分题材 id
 * @param channel - 频道筛选值
 * @returns 数量
 */
export function countBooksBySubGenre(
    books: BookBasicInfo[],
    genreId: string,
    subGenreId: string,
    channel: BookChannelFilter,
): number {
    return books.filter(book => {
        if (channel !== 'all' && book.genreChannel !== channel) return false;
        return book.primaryGenre === genreId && book.primarySubGenre === subGenreId;
    }).length;
}
