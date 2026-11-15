/**
 * mcp-file-browse：目录项过滤 / 根目录候选 / 程序判定
 */

import { describe, expect, it } from 'vitest';
import { filterProgramEntries, listRootCandidates, isLikelyMcpProgramFile, type FsEntry } from '@/shared/mcp-file-browse';

const entry = (name: string, isDirectory: boolean, size = 10): FsEntry => ({
    name,
    path: `/x/${name}`,
    isDirectory,
    size,
});

describe('filterProgramEntries', () => {
    it('目录在前、文件只保留允许的扩展名', () => {
        const result = filterProgramEntries(
            [entry('b.js', false), entry('a.py', false), entry('note.txt', false), entry('src', true)],
            ['.js', '.mjs', '.py'],
        );
        expect(result.map(item => item.name)).toEqual(['src', 'a.py', 'b.js']);
    });

    it('大小写不敏感', () => {
        expect(filterProgramEntries([entry('X.CJS', false)], ['.cjs']).map(i => i.name)).toEqual(['X.CJS']);
    });

    it('没有匹配时返回空数组', () => {
        expect(filterProgramEntries([entry('readme.md', false)], ['.js'])).toEqual([]);
    });
});

describe('listRootCandidates', () => {
    it('Windows 只列出存在的盘符', () => {
        const existed = new Set(['C:/', 'D:/']);
        const roots = listRootCandidates('win32', p => existed.has(p), 'C:/Users/me');
        expect(roots).toEqual(['C:/Users/me', 'C:/', 'D:/']);
    });

    it('POSIX 给出 / 等候选', () => {
        const roots = listRootCandidates('darwin', p => p === '/', '/Users/me');
        expect(roots).toEqual(['/Users/me', '/']);
    });
});

describe('isLikelyMcpProgramFile', () => {
    it('支持脚本与可执行文件', () => {
        for (const path of ['a.mjs', 'a.py', 'a.exe', 'a.sh', 'a.ps1']) {
            expect(isLikelyMcpProgramFile(path), path).toBe(true);
        }
        expect(isLikelyMcpProgramFile('a.txt')).toBe(false);
    });
});
