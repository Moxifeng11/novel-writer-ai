/**
 * kb-config-import-logic.ts — 题材配置导入的解析与冲突处理（纯逻辑，阶段 D2）
 *
 * 从 `ui/views/knowledge-base-view.ts#processImportGenres` 抽出。导入文件可能是
 * 数组或 `{ customGenres: [...] }`；同 id 冲突有 skip/overwrite/rename 三种处置。
 * 这些分支此前内联在视图里零覆盖，错一个分支就会静默覆盖用户题材。
 *
 * 约定：不 import obsidian、不碰 DOM；id 生成时间由调用方注入，便于测试。
 */

import type { GenreConfig } from '@/shared/webnovel-knowledge-base';

/** 冲突处置动作 */
export type ImportConflictAction = 'skip' | 'overwrite' | 'rename' | 'cancel';

/**
 * 从导入文件内容解析题材数组。
 *
 * 支持两种形态：顶层数组、`{ customGenres: [...] }`；其它形态返回空数组
 * （调用方提示「文件格式不正确」）。
 *
 * @param data - JSON.parse 后的内容
 * @returns 题材数组（可能为空）
 */
export function parseGenreImportPayload(data: unknown): GenreConfig[] {
    if (Array.isArray(data)) return data as GenreConfig[];
    if (data && typeof data === 'object') {
        const custom = (data as { customGenres?: unknown }).customGenres;
        if (Array.isArray(custom)) return custom as GenreConfig[];
    }
    return [];
}

/**
 * 按现有 id 拆分「冲突」与「新增」。
 *
 * @param importGenres - 待导入题材
 * @param existingIds - 已存在的自定义题材 id 集合
 * @returns 冲突与新增两组
 */
export function splitGenreConflicts(
    importGenres: readonly GenreConfig[],
    existingIds: ReadonlySet<string>,
): { conflicts: GenreConfig[]; newGenres: GenreConfig[] } {
    const conflicts: GenreConfig[] = [];
    const newGenres: GenreConfig[] = [];
    for (const genre of importGenres) {
        if (existingIds.has(genre.id)) conflicts.push(genre);
        else newGenres.push(genre);
    }
    return { conflicts, newGenres };
}

/**
 * 给冲突题材生成新 id/名称（重命名导入）。
 *
 * @param conflicts - 冲突题材
 * @param stamp - 时间戳后缀（默认 Date.now()）
 * @returns 重命名后的题材（不改原对象）
 */
export function renameConflictingGenres(
    conflicts: readonly GenreConfig[],
    stamp: number = Date.now(),
): GenreConfig[] {
    return conflicts.map(genre => ({
        ...genre,
        id: `${genre.id}_${stamp}`,
        name: `${genre.name} (导入)`,
        isCustom: true,
    }));
}

/**
 * 按用户选择的冲突处置动作，算出最终要导入的题材列表。
 *
 * - skip：只导入新增
 * - overwrite：新增 + 冲突（同 id 覆盖）
 * - rename：新增 + 冲突重命名
 * - cancel：空数组（调用方直接返回）
 *
 * @param action - 冲突处置动作
 * @param newGenres - 无冲突题材
 * @param conflicts - 冲突题材
 * @param stamp - 重命名时间戳
 * @returns 要导入的题材列表
 */
export function buildGenreImportPlan(
    action: ImportConflictAction,
    newGenres: readonly GenreConfig[],
    conflicts: readonly GenreConfig[],
    stamp: number = Date.now(),
): GenreConfig[] {
    if (action === 'cancel') return [];
    if (action === 'skip') return [...newGenres];
    if (action === 'overwrite') return [...newGenres, ...conflicts];
    return [...newGenres, ...renameConflictingGenres(conflicts, stamp)];
}
