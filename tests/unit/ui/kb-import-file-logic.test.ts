/**
 * kb-import-file-logic.test.ts — 书籍导入文件侧逻辑回归（阶段 D2 / DSH-20261112-11）
 *
 * 文件搜索过滤、SEC-7 读前硬限、扩展名剥除此前内联在 Modal 里零覆盖。
 * 重点锁：过滤大小写不敏感、限值「严格大于」边界、扩展名大小写都能剥。
 */
import { describe, expect, it } from 'vitest';
import {
    filterBookFiles,
    formatSourceFileSizeMb,
    isBlankBookName,
    isSourceFileTooLarge,
    resolveBookNameFromFile,
} from '../../../ui/views/kb-import-file-logic';

describe('filterBookFiles', () => {
    const files = [{ name: '诡秘之主.txt' }, { name: '将夜.MD' }, { name: '紫川.txt' }];

    it('大小写不敏感的包含匹配', () => {
        expect(filterBookFiles(files, '诡秘')).toHaveLength(1);
        expect(filterBookFiles(files, '.md')).toHaveLength(1);
        expect(filterBookFiles(files, 'MD')).toHaveLength(1);
    });

    it('空查询返回全部且不修改原数组', () => {
        const snapshot = [...files];
        expect(filterBookFiles(files, '')).toHaveLength(3);
        expect(filterBookFiles(files, '   ')).toHaveLength(0); // 空白查询按字面匹配
        expect(files).toEqual(snapshot);
    });

    it('无命中返回空数组', () => {
        expect(filterBookFiles(files, '雪中悍刀行')).toEqual([]);
    });
});

describe('isSourceFileTooLarge（SEC-7 读前硬限）', () => {
    const MAX = 10 * 1024 * 1024;
    it('严格大于上限才拒绝（恰好等于允许）', () => {
        expect(isSourceFileTooLarge(MAX + 1, MAX)).toBe(true);
        expect(isSourceFileTooLarge(MAX, MAX)).toBe(false);
        expect(isSourceFileTooLarge(0, MAX)).toBe(false);
    });

    it('MB 文案按 Math.round 进位（与超限提示一致）', () => {
        expect(formatSourceFileSizeMb(11 * 1024 * 1024)).toBe('11');
        expect(formatSourceFileSizeMb(10 * 1024 * 1024 + 512 * 1024)).toBe('11'); // 10.5 → 四舍五入 11
        expect(formatSourceFileSizeMb(10 * 1024 * 1024 + 100 * 1024)).toBe('10'); // 10.1 → 10
    });
});

describe('resolveBookNameFromFile', () => {
    it('剥掉 .txt / .md（大小写不敏感），其余原样', () => {
        expect(resolveBookNameFromFile('诡秘之主.txt')).toBe('诡秘之主');
        expect(resolveBookNameFromFile('将夜.MD')).toBe('将夜');
        expect(resolveBookNameFromFile('将夜.Markdown')).toBe('将夜.Markdown'); // 非 txt/md 不剥
        expect(resolveBookNameFromFile('无扩展名')).toBe('无扩展名');
        expect(resolveBookNameFromFile('a.b.txt')).toBe('a.b'); // 只剥最后一个扩展名
    });
});

describe('isBlankBookName', () => {
    it('空串/纯空白/undefined 都算空', () => {
        expect(isBlankBookName('')).toBe(true);
        expect(isBlankBookName('   ')).toBe(true);
        expect(isBlankBookName(undefined)).toBe(true);
        expect(isBlankBookName(null)).toBe(true);
        expect(isBlankBookName('诡秘之主')).toBe(false);
    });
});
