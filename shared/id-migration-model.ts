/**
 * id-migration-model.ts — 旧项目补 ID/属性迁移计划（纯函数）
 *
 * 只做「缺什么补什么」：已有 id/type/tags/aliases 不覆盖，正文不动。
 * 产出计划供 dry-run 预览与执行共用。
 */

import type { EntityType, ProjectIndexEntry } from './project-index-model';
import { TYPE_TO_ID_PREFIX } from './id-registry-model';

/** 单个迁移动作 */
export interface MigrationAction {
    /** 文件路径 */
    path: string;
    /** 推断出的要素类型 */
    type: EntityType;
    /** 是否需要补 id */
    needId: boolean;
    /** 需要补的 frontmatter 键（type/tags/aliases） */
    fillKeys: string[];
    /** 当前已有 id（无则空） */
    existingId?: string;
}

/** 迁移计划 */
export interface MigrationPlan {
    /** 需要处理的条目 */
    actions: MigrationAction[];
    /** 可跳过的条目数（已有 id 且属性齐全） */
    skipped: number;
    /** 按类型统计 */
    byType: Partial<Record<EntityType, number>>;
}

/** 需要补属性的类型集合（只处理设定类，正文/大纲不动） */
const MIGRATABLE_TYPES = new Set<EntityType>([
    'character', 'location', 'faction', 'item', 'worldview', 'setting', 'timeline', 'foreshadow', 'relation',
]);

/**
 * 由索引条目生成迁移计划。
 *
 * @param entries - 项目索引条目
 * @returns 迁移计划
 */
export function buildMigrationPlan(entries: readonly ProjectIndexEntry[]): MigrationPlan {
    const actions: MigrationAction[] = [];
    const byType: Partial<Record<EntityType, number>> = {};
    let skipped = 0;
    for (const entry of entries) {
        const type = entry.type ?? 'other';
        if (!MIGRATABLE_TYPES.has(type)) {
            skipped += 1;
            continue;
        }
        const fillKeys: string[] = [];
        if (!entry.id) fillKeys.push('id');
        if (!entry.type) fillKeys.push('type');
        if (!entry.tags || entry.tags.length === 0) fillKeys.push('tags');
        if (!entry.aliases || entry.aliases.length === 0) fillKeys.push('aliases');
        if (fillKeys.length === 0) {
            skipped += 1;
            continue;
        }
        actions.push({ path: entry.path, type, needId: !entry.id, fillKeys, ...(entry.id ? { existingId: entry.id } : {}) });
        byType[type] = (byType[type] ?? 0) + 1;
    }
    return { actions, skipped, byType };
}

/**
 * 由类型给出建议标签（补 tags 用）。
 *
 * @param type - 要素类型
 * @returns 标签
 */
export function suggestedTags(type: EntityType): string[] {
    const map: Partial<Record<EntityType, string[]>> = {
        character: ['nw/人物'],
        location: ['nw/地点'],
        faction: ['nw/势力'],
        item: ['nw/物品'],
        worldview: ['nw/设定/世界观'],
        setting: ['nw/设定/设定库'],
        timeline: ['nw/设定/时间线'],
        foreshadow: ['nw/设定/伏笔'],
        relation: ['nw/实体/关系'],
    };
    return map[type] ?? [];
}

/**
 * 迁移计划摘要（dry-run 输出）。
 *
 * @param plan - 计划
 * @returns 文本
 */
export function describeMigrationPlan(plan: MigrationPlan): string {
    if (plan.actions.length === 0) return '没有需要迁移的条目（全部已有 ID 与属性）。';
    const parts = Object.entries(plan.byType).map(([type, count]) => `${type}:${count}`);
    return `待迁移 ${plan.actions.length} 个条目（${parts.join('，')}），跳过 ${plan.skipped} 个。`;
}

/**
 * 类型对应的 ID 前缀（用于提示）。
 *
 * @param type - 要素类型
 * @returns 前缀或 null
 */
export function idPrefixFor(type: EntityType): string | null {
    return TYPE_TO_ID_PREFIX[type] ?? null;
}
