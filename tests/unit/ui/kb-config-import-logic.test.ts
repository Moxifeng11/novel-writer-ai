import { describe, expect, it } from 'vitest';
import {
    buildGenreImportPlan,
    parseGenreImportPayload,
    renameConflictingGenres,
    splitGenreConflicts,
} from '../../../ui/views/kb-config-import-logic';
import type { GenreConfig } from '../../../shared/webnovel-knowledge-base';

/**
 * 题材导入解析与冲突处理回归（阶段 D2 / DSH-20261112-07）。
 *
 * 三种处置动作都不能静默覆盖用户题材；重命名必须只改冲突项。
 */

function genre(id: string, name = id): GenreConfig {
    return { id, name, category: 'male', techniques: [], weights: {} } as unknown as GenreConfig;
}

describe('parseGenreImportPayload', () => {
    it('顶层数组直接返回', () => {
        const list = [genre('a'), genre('b')];
        expect(parseGenreImportPayload(list)).toBe(list);
    });

    it('customGenres 包裹形态取出数组', () => {
        const list = [genre('a')];
        expect(parseGenreImportPayload({ customGenres: list })).toBe(list);
    });

    it('其它形态返回空数组（调用方给「文件格式不正确」）', () => {
        expect(parseGenreImportPayload(null)).toEqual([]);
        expect(parseGenreImportPayload({})).toEqual([]);
        expect(parseGenreImportPayload('x')).toEqual([]);
        expect(parseGenreImportPayload({ customGenres: 'x' })).toEqual([]);
    });
});

describe('splitGenreConflicts', () => {
    it('按 id 拆成冲突与新增', () => {
        const { conflicts, newGenres } = splitGenreConflicts(
            [genre('a'), genre('b'), genre('c')],
            new Set(['a', 'c']),
        );
        expect(conflicts.map(g => g.id)).toEqual(['a', 'c']);
        expect(newGenres.map(g => g.id)).toEqual(['b']);
    });

    it('空导入返回两组空数组', () => {
        expect(splitGenreConflicts([], new Set(['a']))).toEqual({ conflicts: [], newGenres: [] });
    });
});

describe('renameConflictingGenres', () => {
    it('只改冲突项：id 加时间戳、名称加后缀、标记自定义', () => {
        const renamed = renameConflictingGenres([genre('a', '玄幻')], 123);
        expect(renamed[0]).toMatchObject({ id: 'a_123', name: '玄幻 (导入)', isCustom: true });
    });

    it('不改原对象', () => {
        const original = genre('a', '玄幻');
        renameConflictingGenres([original], 1);
        expect(original.id).toBe('a');
        expect(original.name).toBe('玄幻');
    });
});

describe('buildGenreImportPlan', () => {
    const newGenres = [genre('new')];
    const conflicts = [genre('dup', '旧名')];

    it('cancel 返回空数组', () => {
        expect(buildGenreImportPlan('cancel', newGenres, conflicts)).toEqual([]);
    });

    it('skip 只导入新增，冲突保持原样不出现', () => {
        const plan = buildGenreImportPlan('skip', newGenres, conflicts);
        expect(plan.map(g => g.id)).toEqual(['new']);
    });

    it('overwrite 新增 + 冲突原样（同 id 覆盖）', () => {
        const plan = buildGenreImportPlan('overwrite', newGenres, conflicts);
        expect(plan.map(g => g.id)).toEqual(['new', 'dup']);
        expect(plan[1].name).toBe('旧名');
    });

    it('rename 新增 + 冲突重命名', () => {
        const plan = buildGenreImportPlan('rename', newGenres, conflicts, 999);
        expect(plan.map(g => g.id)).toEqual(['new', 'dup_999']);
        expect(plan[1].name).toBe('旧名 (导入)');
    });
});
