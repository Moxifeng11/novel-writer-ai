/**
 * 知识库详情状态纯逻辑（G7-4d）
 *
 * 锁住上一轮修过的两个真实缺陷：
 * - 换书/重试失败时上一本书的分析数据不能残留
 * - 书籍被删除时详情区不能永远停在「加载中」
 */
import { describe, expect, it } from 'vitest';
import {
    DETAIL_DATA_KEYS,
    canRefreshBookList,
    detailErrorMessage,
    emptyDetailData,
} from '../../../ui/views/knowledge-detail-state';

describe('emptyDetailData', () => {
    it('返回全部 8 个字段且全为 null', () => {
        const empty = emptyDetailData();
        expect(Object.keys(empty).sort()).toEqual([...DETAIL_DATA_KEYS].sort());
        expect(DETAIL_DATA_KEYS).toHaveLength(8);
        for (const key of DETAIL_DATA_KEYS) {
            expect(empty[key]).toBeNull();
        }
    });

    it('每次都是新对象（互不污染）', () => {
        const first = emptyDetailData() as Record<string, unknown>;
        first.styleData = { sentenceRhythm: {} };
        expect(emptyDetailData().styleData).toBeNull();
    });

    it('重新开始加载 = 用空数据整体覆盖，上一本书的字段不会残留', () => {
        // 模拟上一本书加载成功
        const loaded = { ...emptyDetailData(), styleData: { a: 1 }, rhythmData: { b: 2 } };
        expect(loaded.styleData).not.toBeNull();

        // 模拟换书 / 重试失败时重新开始
        const reloaded = emptyDetailData();
        expect(reloaded.styleData).toBeNull();
        expect(reloaded.rhythmData).toBeNull();
    });
});

describe('detailErrorMessage', () => {
    it('书籍缺失给固定文案', () => {
        expect(detailErrorMessage({ missing: true })).toBe('书籍不存在或已被删除，请返回列表刷新');
    });

    it('读取异常优先用 Error message', () => {
        expect(detailErrorMessage({ error: new Error('permission denied') })).toBe('permission denied');
    });

    it('字符串异常直接使用；空值回落「未知错误」', () => {
        expect(detailErrorMessage({ error: 'boom' })).toBe('boom');
        expect(detailErrorMessage({ error: new Error('  ') })).toBe('未知错误');
        expect(detailErrorMessage()).toBe('未知错误');
        expect(detailErrorMessage({ error: null })).toBe('未知错误');
    });
});

describe('canRefreshBookList', () => {
    it('只有「参考书籍」页签且未打开详情时才刷新', () => {
        expect(canRefreshBookList('books', null)).toBe(true);
    });

    it('详情打开时禁止整列表重绘（否则搜索/筛选会把详情冲掉）', () => {
        expect(canRefreshBookList('books', 'book-1')).toBe(false);
    });

    it('其他页签不刷新', () => {
        expect(canRefreshBookList('tasks', null)).toBe(false);
        expect(canRefreshBookList('stats', null)).toBe(false);
    });
});
