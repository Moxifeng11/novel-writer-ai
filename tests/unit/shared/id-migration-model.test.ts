/**
 * M3：迁移计划模型测试
 */

import { describe, expect, it } from 'vitest';
import { buildMigrationPlan, describeMigrationPlan, idPrefixFor, suggestedTags } from '@/shared/id-migration-model';
import type { ProjectIndexEntry } from '@/shared/project-index-model';

const entry = (over: Partial<ProjectIndexEntry>): ProjectIndexEntry => ({
    path: 'p/a.md', name: 'a', kind: 'other', size: 1, mtime: 1, ...over,
});

describe('buildMigrationPlan', () => {
    it('缺 id/type/tags/aliases 的设定类条目进计划', () => {
        const plan = buildMigrationPlan([entry({ path: 'p/人物/林玄.md', type: 'character' })]);
        expect(plan.actions).toHaveLength(1);
        expect(plan.actions[0].fillKeys).toEqual(['id', 'tags', 'aliases']);
        expect(plan.actions[0].needId).toBe(true);
    });

    it('已有 id 与属性则跳过', () => {
        const plan = buildMigrationPlan([entry({
            type: 'character', id: 'CHR-0001', tags: ['nw/人物'], aliases: ['林玄'],
        })]);
        expect(plan.actions).toHaveLength(0);
        expect(plan.skipped).toBe(1);
    });

    it('已有 id 但缺 tags 时只补 tags', () => {
        const plan = buildMigrationPlan([entry({ type: 'character', id: 'CHR-0001', tags: [], aliases: ['x'] })]);
        expect(plan.actions[0].fillKeys).toEqual(['tags']);
        expect(plan.actions[0].needId).toBe(false);
    });

    it('正文/大纲不迁移', () => {
        const plan = buildMigrationPlan([
            entry({ path: 'p/正文/第1章.md', type: 'chapter' }),
            entry({ path: 'p/大纲/大纲.md', type: 'outline' }),
        ]);
        expect(plan.actions).toHaveLength(0);
        expect(plan.skipped).toBe(2);
    });

    it('按类型统计', () => {
        const plan = buildMigrationPlan([
            entry({ path: 'a.md', type: 'character' }),
            entry({ path: 'b.md', type: 'character' }),
            entry({ path: 'c.md', type: 'foreshadow' }),
        ]);
        expect(plan.byType).toEqual({ character: 2, foreshadow: 1 });
    });
});

describe('辅助函数', () => {
    it('建议标签按类型', () => {
        expect(suggestedTags('character')).toEqual(['nw/人物']);
        expect(suggestedTags('foreshadow')).toEqual(['nw/设定/伏笔']);
    });

    it('ID 前缀映射', () => {
        expect(idPrefixFor('character')).toBe('CHR');
        expect(idPrefixFor('other')).toBeNull();
    });

    it('摘要文本', () => {
        const plan = buildMigrationPlan([entry({ type: 'character' })]);
        expect(describeMigrationPlan(plan)).toContain('待迁移 1');
        expect(describeMigrationPlan(buildMigrationPlan([]))).toContain('没有需要迁移');
    });
});
