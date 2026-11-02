/**
 * engine/context/context-diff-detector.ts — 上下文变更检测器
 *
 * 职责：
 * - 比较两个 GatheredContext，识别变更类型与受影响分区
 * - 根据文件路径推断变更类型（用于增量更新流程）
 * - 计算变更范围占比，用于决定增量 vs 全量策略
 *
 * 变更类型：
 * - character-changed: 人物信息变更（属性修改、新增/删除）
 * - chapter-changed: 章节内容变更（正文修改、状态变更）
 * - entity-changed: 势力/地点/物品变更
 * - worldview-changed: 世界观变更（含设定库、文笔风格、写作规则）
 * - timeline-changed: 时间线变更（含伏笔）
 *
 * 设计原则：
 * - 纯数据比较，零外部依赖
 * - 不修改任何现有类型，纯新增
 */

import type { GatheredContext, ContextData } from './context-types';
import {
    SUBDIR_CHARS,
    SUBDIR_LOCS,
    SUBDIR_FACTIONS,
    SUBDIR_ITEMS,
    SUBDIR_WORLDVIEW_FILE,
    SUBDIR_SETTING_LIB_FILE,
    SUBDIR_WRITING_STYLE_FILE,
    SUBDIR_BODY_ROOT,
    SUBDIR_STEP_ROOT,
    SUBDIR_TIMELINE,
} from '../../shared/paths';
import { pjForeshadowDB, pjTimelineBoard, pjWritingRules } from '../../shared/paths';

// ============================================================
// 一、类型定义
// ============================================================

export type ChangeType =
    | 'character-changed'
    | 'chapter-changed'
    | 'entity-changed'
    | 'worldview-changed'
    | 'timeline-changed';

export interface ContextChange {
    /** 变更类型 */
    type: ChangeType;
    /** 变更的实体标识列表（人物名、章节号等） */
    affectedIds: string[];
    /** 变更的文件路径列表 */
    affectedPaths: string[];
    /** 变更时间戳 */
    timestamp: number;
}

export interface ContextChangeSet {
    /** 变更条目列表 */
    changes: ContextChange[];
    /** 受影响的上下文分区名（对应 ContextData 的 key） */
    affectedSections: string[];
    /** 变更范围占比 0-1，超过阈值应回退全量 */
    changeScope: number;
    /** 变更检测时间 */
    detectedAt: number;
}

/** 分区名 → 变更类型映射 */
const SECTION_CHANGE_TYPE_MAP: Record<string, ChangeType> = {
    // 人物相关
    character_state: 'character-changed',
    character_cores: 'character-changed',
    triggered_memories: 'character-changed',
    // 章节相关
    previous_chapter: 'chapter-changed',
    outline: 'chapter-changed',
    emotion_plan: 'chapter-changed',
    scene_expansion: 'chapter-changed',
    // 实体相关
    locations: 'entity-changed',
    factions: 'entity-changed',
    items: 'entity-changed',
    // 世界观相关
    world_view: 'worldview-changed',
    setting_lib: 'worldview-changed',
    writing_style: 'worldview-changed',
    writing_rules: 'worldview-changed',
    // 时间线相关
    timeline: 'timeline-changed',
    foreshadows: 'timeline-changed',
    timeline_eras: 'timeline-changed',
    timeline_inconsistencies: 'timeline-changed',
};

/** 全部受跟踪的分区名列表 */
const ALL_TRACKED_SECTIONS = Object.keys(SECTION_CHANGE_TYPE_MAP);

/** 增量更新回退阈值：变更范围超过此比例则回退全量 */
export const INCREMENTAL_FALLBACK_THRESHOLD = 0.5;

// ============================================================
// 二、ContextDiffDetector 类
// ============================================================

export class ContextDiffDetector {
    /**
     * 检测两个 GatheredContext 之间的差异
     * 逐分区比较，识别变更类型与受影响分区
     * @param oldContext - 旧上下文
     * @param newContext - 新上下文
      * @returns ContextChangeSet 实例
     */
    detectChanges(
        oldContext: GatheredContext,
        newContext: GatheredContext,
    ): ContextChangeSet {
        const changes: ContextChange[] = [];
        const affectedSections: string[] = [];
        const now = Date.now();

        for (const section of ALL_TRACKED_SECTIONS) {
            const oldValue = oldContext.data[section as keyof ContextData];
            const newValue = newContext.data[section as keyof ContextData];

            if (!this.isSectionEqual(oldValue, newValue)) {
                const changeType = SECTION_CHANGE_TYPE_MAP[section];
                const affectedIds = this.extractAffectedIds(section, oldValue, newValue);

                changes.push({
                    type: changeType,
                    affectedIds,
                    affectedPaths: [],
                    timestamp: now,
                });
                affectedSections.push(section);
            }
        }

        const changeScope = affectedSections.length / ALL_TRACKED_SECTIONS.length;

        return {
            changes,
            affectedSections,
            changeScope,
            detectedAt: now,
        };
    }

    /**
     * 根据变更集返回需要重新计算的上下文分区
     * @param changeSet - 变更集
     * @returns 结果数组
     */
    getAffectedSections(changeSet: ContextChangeSet): string[] {
        return [...changeSet.affectedSections];
    }

    /**
     * 根据文件路径列表创建变更集
     * 用于增量更新流程：文件修改事件 → 变更集
     * @param filePaths - 文件路径列表
     * @param project - 项目（路径或对象）
      * @returns ContextChangeSet 实例
     */
    createChangeSetFromPaths(
        filePaths: string[],
        project: string,
    ): ContextChangeSet {
        const changes: ContextChange[] = [];
        const affectedSectionsSet = new Set<string>();
        const now = Date.now();

        for (const filePath of filePaths) {
            const mapping = this.mapFileToChange(filePath, project);
            if (!mapping) continue;

            // 合并同类型变更
            let existing = changes.find(c => c.type === mapping.type);
            if (!existing) {
                existing = {
                    type: mapping.type,
                    affectedIds: [],
                    affectedPaths: [],
                    timestamp: now,
                };
                changes.push(existing);
            }

            if (!existing.affectedPaths.includes(filePath)) {
                existing.affectedPaths.push(filePath);
            }

            if (mapping.entityId && !existing.affectedIds.includes(mapping.entityId)) {
                existing.affectedIds.push(mapping.entityId);
            }

            for (const section of mapping.sections) {
                affectedSectionsSet.add(section);
            }
        }

        const affectedSections = Array.from(affectedSectionsSet);
        const changeScope = affectedSections.length / ALL_TRACKED_SECTIONS.length;

        return {
            changes,
            affectedSections,
            changeScope,
            detectedAt: now,
        };
    }

    // ── 内部方法 ──────────────────────────────────────────────

    /**
     * 比较两个分区数据是否相等
     * 支持数组、对象、字符串、null 的比较
     */
    private isSectionEqual(a: unknown, b: unknown): boolean {
        if (a === b) return true;
        if (a == null && b == null) return true;
        if (a == null || b == null) return false;

        if (Array.isArray(a) && Array.isArray(b)) {
            if (a.length !== b.length) return false;
            return a.every((item, i) => this.isSectionEqual(item, b[i]));
        }

        if (typeof a === 'object' && typeof b === 'object') {
            const aObj = a as Record<string, unknown>;
            const bObj = b as Record<string, unknown>;
            const aKeys = Object.keys(aObj);
            const bKeys = Object.keys(bObj);
            if (aKeys.length !== bKeys.length) return false;
            return aKeys.every(key => this.isSectionEqual(aObj[key], bObj[key]));
        }

        return false;
    }

    /**
     * 从分区数据中提取受影响的实体 ID
     */
    private extractAffectedIds(section: string, oldValue: unknown, newValue: unknown): string[] {
        // 对于数组类型（character_state, locations 等），提取 name 字段差异
        if (Array.isArray(oldValue) && Array.isArray(newValue)) {
            const oldNames = new Set(
                oldValue.map((item: any) => item?.name || item?.姓名 || item?.名称 || '').filter(Boolean),
            );
            const newNames = new Set(
                newValue.map((item: any) => item?.name || item?.姓名 || item?.名称 || '').filter(Boolean),
            );

            const added = Array.from(newNames).filter(n => !oldNames.has(n));
            const removed = Array.from(oldNames).filter(n => !newNames.has(n));
            return [...added, ...removed];
        }

        // 对于章节类分区，无特定 ID
        if (section === 'previous_chapter' || section === 'outline' ||
            section === 'emotion_plan' || section === 'scene_expansion') {
            return [];
        }

        return [];
    }

    /**
     * 将文件路径映射到变更类型与受影响分区
     */
    private mapFileToChange(
        filePath: string,
        project: string,
    ): { type: ChangeType; sections: string[]; entityId?: string } | null {
        const charDir = `${project}/${SUBDIR_CHARS}/`;
        const locDir = `${project}/${SUBDIR_LOCS}/`;
        const factionDir = `${project}/${SUBDIR_FACTIONS}/`;
        const itemDir = `${project}/${SUBDIR_ITEMS}/`;
        const bodyDir = `${project}/${SUBDIR_BODY_ROOT}/`;
        const stepDir = `${project}/${SUBDIR_STEP_ROOT}/`;
        const timelineDir = `${project}/${SUBDIR_TIMELINE}/`;

        // 人物文件
        if (filePath.startsWith(charDir)) {
            const entityId = filePath.split('/').pop()?.replace(/\.md$/, '') || '';
            return {
                type: 'character-changed',
                sections: ['character_state', 'character_cores', 'triggered_memories'],
                entityId,
            };
        }

        // 地点文件
        if (filePath.startsWith(locDir)) {
            const entityId = filePath.split('/').pop()?.replace(/\.md$/, '') || '';
            return {
                type: 'entity-changed',
                sections: ['locations'],
                entityId,
            };
        }

        // 势力文件
        if (filePath.startsWith(factionDir)) {
            const entityId = filePath.split('/').pop()?.replace(/\.md$/, '') || '';
            return {
                type: 'entity-changed',
                sections: ['factions'],
                entityId,
            };
        }

        // 物品文件
        if (filePath.startsWith(itemDir)) {
            const entityId = filePath.split('/').pop()?.replace(/\.md$/, '') || '';
            return {
                type: 'entity-changed',
                sections: ['items'],
                entityId,
            };
        }

        // 章节正文/步骤结果
        if (filePath.startsWith(bodyDir) || filePath.startsWith(stepDir)) {
            return {
                type: 'chapter-changed',
                sections: ['previous_chapter', 'outline', 'emotion_plan', 'scene_expansion'],
            };
        }

        // 世界观总览
        if (filePath === `${project}/${SUBDIR_WORLDVIEW_FILE}`) {
            return {
                type: 'worldview-changed',
                sections: ['world_view'],
            };
        }

        // 设定库
        if (filePath === `${project}/${SUBDIR_SETTING_LIB_FILE}`) {
            return {
                type: 'worldview-changed',
                sections: ['setting_lib'],
            };
        }

        // 文笔风格
        if (filePath === `${project}/${SUBDIR_WRITING_STYLE_FILE}`) {
            return {
                type: 'worldview-changed',
                sections: ['writing_style'],
            };
        }

        // 写作规则
        if (filePath === pjWritingRules(project)) {
            return {
                type: 'worldview-changed',
                sections: ['writing_rules'],
            };
        }

        // 时间线看板
        if (filePath === pjTimelineBoard(project)) {
            return {
                type: 'timeline-changed',
                sections: ['timeline', 'timeline_eras', 'timeline_inconsistencies'],
            };
        }

        // 伏笔库
        if (filePath === pjForeshadowDB(project)) {
            return {
                type: 'timeline-changed',
                sections: ['foreshadows'],
            };
        }

        // 时间线目录下其他文件
        if (filePath.startsWith(timelineDir)) {
            return {
                type: 'timeline-changed',
                sections: ['timeline', 'foreshadows'],
            };
        }

        return null;
    }
}
