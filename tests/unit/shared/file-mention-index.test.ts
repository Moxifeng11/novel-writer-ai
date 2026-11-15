/**
 * M2：@ 候选按索引排序（别名/标题精确优先）
 */

import { describe, expect, it } from 'vitest';
import { rankIndexCandidates } from '@/shared/file-mention';

const entries = [
    { path: 'p/01-世界架构/人物/CHR-0001_林玄.md', name: 'CHR-0001_林玄', id: 'CHR-0001', aliases: ['林玄', '小玄'], tags: ['nw/人物'] },
    { path: 'p/01-世界架构/人物/CHR-0002_苏婉.md', name: 'CHR-0002_苏婉', id: 'CHR-0002', aliases: ['苏婉'], tags: ['nw/人物'] },
    { path: 'p/02-时间线与伏笔/伏笔/FSH-0001_断剑.md', name: 'FSH-0001_断剑', id: 'FSH-0001', aliases: [], tags: ['nw/实体/伏笔'] },
];

describe('rankIndexCandidates', () => {
    it('别名精确前缀优先', () => {
        const result = rankIndexCandidates(entries, '小玄');
        expect(result[0]).toContain('CHR-0001');
    });

    it('ID 前缀命中', () => {
        const result = rankIndexCandidates(entries, 'FSH-0001');
        expect(result[0]).toContain('FSH-0001');
    });

    it('标签命中排在路径子串之前', () => {
        const result = rankIndexCandidates(entries, '伏笔');
        expect(result[0]).toContain('FSH-0001');
    });

    it('空查询返回全部（受 limit 限制）', () => {
        expect(rankIndexCandidates(entries, '', 2)).toHaveLength(2);
    });

    it('无命中返回空', () => {
        expect(rankIndexCandidates(entries, '不存在的东西')).toEqual([]);
    });

    it('结果去重', () => {
        const dup = [...entries, { ...entries[0] }];
        expect(new Set(rankIndexCandidates(dup, '林玄')).size).toBe(rankIndexCandidates(dup, '林玄').length);
    });
});
