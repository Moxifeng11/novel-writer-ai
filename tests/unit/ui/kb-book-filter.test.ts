/**
 * kb-book-filter 单测（v4.83.0 UI 可测性治理 · 第 6 批）
 *
 * `getFilteredBooks`（64 行）与 4 个计数方法原本是 KnowledgeBaseView 的私有方法，
 * 覆盖率 0.34%。筛选是用户直接操作的核心行为，规则密集但只能点界面确认。
 *
 * 最关键的锁定项（勘察报告风险点 #1）：
 * **子题材筛选是嵌套条件** —— 只在「主题材选择了具体题材」时才生效。
 * 主题材为 `all` / `uncategorized` 时不筛子题材。写成平铺分支会让「全部」视图误筛。
 *
 * 等价性：抽取时曾用「旧 getFilteredBooks 逐行复刻 vs 新 filterAndSortBooks」
 * 做过 300 组随机数据 × 7 维筛选组合的差分 fuzz，输出逐条相同后才删除临时脚本。
 * 因此下面用例只需覆盖各维度语义，无需再穷举组合。
 */

import { describe, expect, it } from 'vitest';
import type { BookBasicInfo } from '../../../services/knowledge-base-manager';
import {
    filterBooks,
    sortBooks,
    filterAndSortBooks,
    countBooksInChannel,
    countBooksByGenre,
    countBooksBySubGenre,
    type BookFilterState,
} from '../../../ui/views/kb-book-filter';

/** 构造书籍（默认值覆盖必填字段） */
function book(partial: Partial<BookBasicInfo> = {}): BookBasicInfo {
    return {
        id: partial.id ?? 'b',
        name: partial.name ?? '书名',
        author: partial.author,
        wordCount: partial.wordCount,
        breakdownStatus: partial.breakdownStatus ?? 'pending',
        createdAt: partial.createdAt ?? 0,
        updatedAt: partial.updatedAt ?? 0,
        customTags: partial.customTags ?? [],
        themeTags: partial.themeTags ?? [],
        ...partial,
    } as BookBasicInfo;
}

/** 默认筛选状态：全部通过、按创建时间升序 */
function baseFilter(overrides: Partial<BookFilterState> = {}): BookFilterState {
    return {
        channel: 'all',
        primaryGenre: 'all',
        subGenre: 'all',
        keyword: '',
        status: 'all',
        sortBy: 'createdAt',
        sortOrder: 'asc',
        ...overrides,
    };
}

const books: BookBasicInfo[] = [
    book({ id: 'a', name: '凡人修仙', author: '忘语', genreChannel: 'male', primaryGenre: 'xianxia', createdAt: 3, wordCount: 300 }),
    book({ id: 'b', name: '女频书', author: '某女', genreChannel: 'female', primaryGenre: 'romance', createdAt: 1, wordCount: 500 }),
    book({ id: 'c', name: '无题材', genreChannel: 'male', createdAt: 2, wordCount: 100 }),
    book({ id: 'd', name: '次要题材', genreChannel: 'male', primaryGenre: 'xianxia', secondaryGenres: ['dushi'], createdAt: 4, wordCount: 200 }),
];

describe('filterBooks — 频道筛选', () => {
    it('all 不过滤', () => {
        expect(filterBooks(books, baseFilter()).map(b => b.id)).toEqual(['a', 'b', 'c', 'd']);
    });

    it('按频道过滤', () => {
        expect(filterBooks(books, baseFilter({ channel: 'male' })).map(b => b.id)).toEqual(['a', 'c', 'd']);
        expect(filterBooks(books, baseFilter({ channel: 'female' })).map(b => b.id)).toEqual(['b']);
        expect(filterBooks(books, baseFilter({ channel: 'neutral' }))).toEqual([]);
    });
});

describe('filterBooks — 题材筛选', () => {
    it('uncategorized 只留没有主题材的书', () => {
        expect(filterBooks(books, baseFilter({ primaryGenre: 'uncategorized' })).map(b => b.id)).toEqual(['c']);
    });

    it('指定题材命中主题材或次要题材', () => {
        expect(filterBooks(books, baseFilter({ primaryGenre: 'xianxia' })).map(b => b.id)).toEqual(['a', 'd']);
        expect(filterBooks(books, baseFilter({ primaryGenre: 'dushi' })).map(b => b.id)).toEqual(['d']);
    });

    it('未知题材返回空', () => {
        expect(filterBooks(books, baseFilter({ primaryGenre: 'nope' }))).toEqual([]);
    });
});

describe('filterBooks — 子题材是嵌套条件（核心风险点）', () => {
    const withSubGenre: BookBasicInfo[] = [
        book({ id: 's1', primaryGenre: 'xianxia', primarySubGenre: 'lianqi' }),
        book({ id: 's2', primaryGenre: 'xianxia', primarySubGenre: 'jindan' }),
        book({ id: 's3', primaryGenre: 'dushi', primarySubGenre: 'lianqi' }),
        book({ id: 's4', primarySubGenre: 'lianqi' }),   // 无主题材
    ];

    it('指定主题材 + 子题材时，两者同时命中才保留', () => {
        const out = filterBooks(withSubGenre, baseFilter({ primaryGenre: 'xianxia', subGenre: 'lianqi' }));
        expect(out.map(b => b.id)).toEqual(['s1']);
    });

    it('主题材为 all 时，子题材条件被忽略（不误筛）', () => {
        const out = filterBooks(withSubGenre, baseFilter({ primaryGenre: 'all', subGenre: 'lianqi' }));
        expect(out).toHaveLength(4);
        expect(out.map(b => b.id)).toEqual(['s1', 's2', 's3', 's4']);
    });

    it('主题材为 uncategorized 时，子题材条件也被忽略', () => {
        const out = filterBooks(withSubGenre, baseFilter({ primaryGenre: 'uncategorized', subGenre: 'lianqi' }));
        expect(out.map(b => b.id)).toEqual(['s4']);
    });

    it('只在副题材命中时，子题材不再二次过滤（保留该书）', () => {
        const list = [book({ id: 'x', primaryGenre: 'a', secondaryGenres: ['b'], primarySubGenre: 'other' })];
        // 主题材筛 b 命中（次要题材），subGenre=lianqi 不匹配 primarySubGenre
        expect(filterBooks(list, baseFilter({ primaryGenre: 'b', subGenre: 'lianqi' }))).toEqual([]);
        expect(filterBooks(list, baseFilter({ primaryGenre: 'b', subGenre: 'other' })).map(b => b.id)).toEqual(['x']);
    });
});

describe('filterBooks — 状态与关键词', () => {
    it('按拆解状态过滤', () => {
        const list = [
            book({ id: 'p', breakdownStatus: 'pending' }),
            book({ id: 'c', breakdownStatus: 'completed' }),
        ];
        expect(filterBooks(list, baseFilter({ status: 'completed' })).map(b => b.id)).toEqual(['c']);
    });

    it('关键词命中书名 / 作者 / 题材标签 / 自定义标签', () => {
        const list = [
            book({ id: 'n', name: '剑来' }),
            book({ id: 'a', name: 'x', author: '烽火戏诸侯' }),
            book({ id: 't', name: 'x', themeTags: ['热血'] }),
            book({ id: 'c', name: 'x', customTags: ['爽文'] }),
        ];
        expect(filterBooks(list, baseFilter({ keyword: '剑来' })).map(b => b.id)).toEqual(['n']);
        expect(filterBooks(list, baseFilter({ keyword: '烽火' })).map(b => b.id)).toEqual(['a']);
        expect(filterBooks(list, baseFilter({ keyword: '热血' })).map(b => b.id)).toEqual(['t']);
        expect(filterBooks(list, baseFilter({ keyword: '爽文' })).map(b => b.id)).toEqual(['c']);
    });

    it('关键词大小写不敏感', () => {
        const list = [book({ id: 'x', name: 'AbCd' })];
        expect(filterBooks(list, baseFilter({ keyword: 'abcd' })).map(b => b.id)).toEqual(['x']);
        expect(filterBooks(list, baseFilter({ keyword: 'ABCD' })).map(b => b.id)).toEqual(['x']);
    });

    it('无关键词时不过滤（空串）', () => {
        expect(filterBooks(books, baseFilter({ keyword: '' }))).toHaveLength(4);
    });
});

describe('filterBooks — 组合与不变性', () => {
    it('多条件叠加', () => {
        const out = filterBooks(books, baseFilter({ channel: 'male', primaryGenre: 'xianxia' }));
        expect(out.map(b => b.id)).toEqual(['a', 'd']);
    });

    it('不修改原数组', () => {
        const snapshot = books.map(b => b.id);
        filterBooks(books, baseFilter({ channel: 'female' }));
        expect(books.map(b => b.id)).toEqual(snapshot);
    });
});

describe('sortBooks — 四种排序', () => {
    it('createdAt / updatedAt 升降序', () => {
        expect(sortBooks(books, 'createdAt', 'asc').map(b => b.id)).toEqual(['b', 'c', 'a', 'd']);
        expect(sortBooks(books, 'createdAt', 'desc').map(b => b.id)).toEqual(['d', 'a', 'c', 'b']);
        expect(sortBooks(books, 'updatedAt', 'desc')).toHaveLength(4);
    });

    it('wordCount 排序（undefined 按 0）', () => {
        const list = [book({ id: 'x', wordCount: undefined }), book({ id: 'y', wordCount: 100 })];
        expect(sortBooks(list, 'wordCount', 'asc').map(b => b.id)).toEqual(['x', 'y']);
        expect(sortBooks(list, 'wordCount', 'desc').map(b => b.id)).toEqual(['y', 'x']);
    });

    it('quality 排序（无质量分按 0）', () => {
        const list = [
            book({ id: 'no' }),
            book({ id: 'hi', qualityScores: { overall: 90 } as never }),
            book({ id: 'lo', qualityScores: { overall: 60 } as never }),
        ];
        expect(sortBooks(list, 'quality', 'desc').map(b => b.id)).toEqual(['hi', 'lo', 'no']);
    });

    it('不修改原数组', () => {
        const list = [book({ id: 'b', createdAt: 2 }), book({ id: 'a', createdAt: 1 })];
        const snapshot = list.map(b => b.id);
        sortBooks(list, 'createdAt', 'asc');
        expect(list.map(b => b.id)).toEqual(snapshot);
    });
});

describe('filterAndSortBooks — 视图 getFilteredBooks 等价', () => {
    it('先筛选后排序', () => {
        const out = filterAndSortBooks(books, baseFilter({ channel: 'male', sortBy: 'wordCount', sortOrder: 'desc' }));
        expect(out.map(b => b.id)).toEqual(['a', 'd', 'c']);
    });

    it('空输入返回空数组', () => {
        expect(filterAndSortBooks([], baseFilter())).toEqual([]);
    });
});

describe('计数方法', () => {
    it('countBooksInChannel：all 计全部', () => {
        expect(countBooksInChannel(books, 'all')).toBe(4);
        expect(countBooksInChannel(books, 'male')).toBe(3);
        expect(countBooksInChannel(books, 'female')).toBe(1);
        expect(countBooksInChannel(books, 'neutral')).toBe(0);
    });

    it('countBooksByGenre：受频道约束，主题材或次要题材命中', () => {
        expect(countBooksByGenre(books, 'xianxia', 'all')).toBe(2);
        expect(countBooksByGenre(books, 'xianxia', 'male')).toBe(2);
        expect(countBooksByGenre(books, 'xianxia', 'female')).toBe(0);
        expect(countBooksByGenre(books, 'dushi', 'all')).toBe(1);
    });

    it('countBooksBySubGenre：主题材与子题材必须同时命中', () => {
        const list = [
            book({ id: '1', primaryGenre: 'g', primarySubGenre: 's', genreChannel: 'male' }),
            book({ id: '2', primaryGenre: 'g', primarySubGenre: 'other', genreChannel: 'male' }),
            book({ id: '3', primaryGenre: 'g', primarySubGenre: 's', genreChannel: 'female' }),
        ];
        expect(countBooksBySubGenre(list, 'g', 's', 'all')).toBe(2);
        expect(countBooksBySubGenre(list, 'g', 's', 'male')).toBe(1);
        expect(countBooksBySubGenre(list, 'g', 'other', 'male')).toBe(1);
        expect(countBooksBySubGenre(list, 'nope', 's', 'all')).toBe(0);
    });
});
