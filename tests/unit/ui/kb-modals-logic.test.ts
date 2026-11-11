/**
 * 阶段 D1：知识库弹窗纯逻辑
 *
 * 从 `ui/views/knowledge-base-modals.ts` 抽出。字段比较看似简单，
 * 但 `undefined` / `''` / `null` 的等价性很容易写错——
 * 写错的后果是「用户改了分类但系统没记录偏好」，属于静默失效。
 */

import { describe, expect, it } from 'vitest';
import { detectGenreChanges, isValidBookName } from '../../../ui/views/kb-modals-logic';

describe('D1-7：分类变更检测', () => {
    it('完全没改时 anyChanged 为 false', () => {
        const result = detectGenreChanges(
            { genreChannel: 'male', primaryGenre: '玄幻', primarySubGenre: '东方玄幻' },
            { genreChannel: 'male', primaryGenre: '玄幻', primarySubGenre: '东方玄幻' },
        );
        expect(result.anyChanged).toBe(false);
    });

    it('只改频道', () => {
        const result = detectGenreChanges(
            { genreChannel: 'male' },
            { genreChannel: 'female' },
        );
        expect(result.channelChanged).toBe(true);
        expect(result.anyChanged).toBe(true);
    });

    it('只改主题材', () => {
        const result = detectGenreChanges({ primaryGenre: '玄幻' }, { primaryGenre: '仙侠' });
        expect(result.genreChanged).toBe(true);
        expect(result.channelChanged).toBe(false);
    });

    it('只改子题材', () => {
        const result = detectGenreChanges({ primarySubGenre: '东方玄幻' }, { primarySubGenre: '西方奇幻' });
        expect(result.subGenreChanged).toBe(true);
    });

    it('undefined 与空串视为等价（不算改动）', () => {
        const result = detectGenreChanges({ genreChannel: undefined }, { genreChannel: '' });
        expect(result.channelChanged).toBe(false);
        expect(result.anyChanged).toBe(false);
    });

    it('null 与空串视为等价', () => {
        const result = detectGenreChanges(
            { primaryGenre: null as unknown as undefined },
            { primaryGenre: '' },
        );
        expect(result.genreChanged).toBe(false);
    });

    it('前后空白不产生假变更', () => {
        const result = detectGenreChanges({ primaryGenre: '玄幻' }, { primaryGenre: '  玄幻  ' });
        expect(result.genreChanged).toBe(false);
    });

    it('从有值改成空（清空分类）算改动', () => {
        const result = detectGenreChanges({ primaryGenre: '玄幻' }, { primaryGenre: '' });
        expect(result.genreChanged).toBe(true);
        expect(result.anyChanged).toBe(true);
    });

    it('三个字段同时改时全部标记', () => {
        const result = detectGenreChanges(
            { genreChannel: 'male', primaryGenre: '玄幻', primarySubGenre: '东方玄幻' },
            { genreChannel: 'female', primaryGenre: '言情', primarySubGenre: '古代言情' },
        );
        expect(result.channelChanged).toBe(true);
        expect(result.genreChanged).toBe(true);
        expect(result.subGenreChanged).toBe(true);
    });
});

describe('D1-8：书名校验', () => {
    it('正常书名通过', () => {
        expect(isValidBookName('遮天')).toBe(true);
    });

    it('空串/空白/undefined/null 不通过', () => {
        expect(isValidBookName('')).toBe(false);
        expect(isValidBookName('   ')).toBe(false);
        expect(isValidBookName(undefined)).toBe(false);
        expect(isValidBookName(null)).toBe(false);
    });

    it('首尾空白不算内容', () => {
        expect(isValidBookName('  遮天  ')).toBe(true);
    });
});
