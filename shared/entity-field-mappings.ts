import type { EntityCategory } from './entity-models';

/**
 * 字段映射。
 */
export interface FieldMapping {
    frontmatterKey: string;
    modelKey: string;
    label: string;
    type: 'string' | 'number' | 'boolean' | 'array' | 'object';
    defaultValue?: string | number | boolean | unknown[] | object;
    required?: boolean;
}

/**
 * 分类映射。
 */
export interface CategoryMapping {
    category: EntityCategory;
    nameField: string;
    fields: FieldMapping[];
    frontmatterPrefix?: string;
}

/**
 * 实体字段映射表。
 */
export const ENTITY_FIELD_MAPPINGS: Record<EntityCategory, CategoryMapping> = {
    character: {
        category: 'character',
        nameField: 'name',
        fields: [
            { frontmatterKey: '姓名', modelKey: 'name', label: '姓名', type: 'string', required: true },
            { frontmatterKey: '年龄', modelKey: 'age', label: '年龄', type: 'string' },
            { frontmatterKey: '性别', modelKey: 'gender', label: '性别', type: 'string' },
            { frontmatterKey: '身份', modelKey: 'identity', label: '身份', type: 'string' },
            { frontmatterKey: '首次出场', modelKey: 'firstAppearance', label: '首次出场', type: 'string' },
            { frontmatterKey: '核心动机', modelKey: 'coreMotivation', label: '核心动机', type: 'string' },
            { frontmatterKey: '核心驱动力_软肋', modelKey: 'coreWeakness', label: '核心驱动力/软肋', type: 'string' },
            { frontmatterKey: '习惯性小动作', modelKey: 'habit', label: '习惯性小动作', type: 'string' },
            { frontmatterKey: '当前状态', modelKey: 'currentStatus', label: '当前状态', type: 'string' },
            { frontmatterKey: '当前情绪', modelKey: 'currentEmotion', label: '当前情绪', type: 'string' },
            { frontmatterKey: '当前位置', modelKey: 'currentLocation', label: '当前位置', type: 'string' },
            { frontmatterKey: '性格标签', modelKey: 'personalityTags', label: '性格标签', type: 'string' },
            { frontmatterKey: '金手指/特殊能力', modelKey: 'specialAbility', label: '金手指/特殊能力', type: 'string' },
            { frontmatterKey: '功法/技能树', modelKey: 'skillTree', label: '功法/技能树', type: 'string' },
            { frontmatterKey: '修为等级', modelKey: 'cultivationLevel', label: '修为等级', type: 'string' },
            { frontmatterKey: '所属势力', modelKey: 'faction', label: '所属势力', type: 'string' },
            { frontmatterKey: '人物背景', modelKey: 'background', label: '人物背景', type: 'string' },
            { frontmatterKey: '外貌特征', modelKey: 'appearance', label: '外貌特征', type: 'string' },
            { frontmatterKey: '当前目标', modelKey: 'currentGoal', label: '当前目标', type: 'string' },
            { frontmatterKey: 'entity_status', modelKey: 'entityStatus', label: '实体状态', type: 'string' },
            { frontmatterKey: 'entity_created_at', modelKey: 'createdAt', label: '创建时间', type: 'string' },
            { frontmatterKey: 'entity_last_changed_at', modelKey: 'lastChangedAt', label: '最后变更时间', type: 'string' },
            { frontmatterKey: 'entity_last_changed_reason', modelKey: 'lastChangedReason', label: '最后变更原因', type: 'string' },
        ],
    },
    faction: {
        category: 'faction',
        nameField: '名称',
        fields: [
            { frontmatterKey: '名称', modelKey: 'name', label: '名称', type: 'string', required: true },
            { frontmatterKey: '别称', modelKey: 'alias', label: '别称', type: 'string' },
            { frontmatterKey: '类型', modelKey: 'type', label: '类型', type: 'string' },
            { frontmatterKey: '描述', modelKey: 'description', label: '描述', type: 'string' },
            { frontmatterKey: '领袖', modelKey: 'leader', label: '领袖', type: 'string' },
            { frontmatterKey: '地位/排名', modelKey: 'rank', label: '地位/排名', type: 'string' },
            { frontmatterKey: 'entity_status', modelKey: 'entityStatus', label: '实体状态', type: 'string' },
            { frontmatterKey: 'entity_created_at', modelKey: 'createdAt', label: '创建时间', type: 'string' },
            { frontmatterKey: 'entity_last_changed_at', modelKey: 'lastChangedAt', label: '最后变更时间', type: 'string' },
            { frontmatterKey: 'entity_last_changed_reason', modelKey: 'lastChangedReason', label: '最后变更原因', type: 'string' },
        ],
    },
    location: {
        category: 'location',
        nameField: '名称',
        fields: [
            { frontmatterKey: '名称', modelKey: 'name', label: '名称', type: 'string', required: true },
            { frontmatterKey: '别称', modelKey: 'alias', label: '别称', type: 'string' },
            { frontmatterKey: '类型', modelKey: 'type', label: '类型', type: 'string' },
            { frontmatterKey: '描述', modelKey: 'description', label: '描述', type: 'string' },
            { frontmatterKey: '重要程度', modelKey: 'importance', label: '重要程度', type: 'string' },
            { frontmatterKey: '地理特征', modelKey: 'geography', label: '地理特征', type: 'string' },
            { frontmatterKey: '主要居民/势力', modelKey: 'inhabitants', label: '主要居民/势力', type: 'string' },
            { frontmatterKey: '所在世界/区域', modelKey: 'worldRegion', label: '所在世界/区域', type: 'string' },
            { frontmatterKey: 'entity_status', modelKey: 'entityStatus', label: '实体状态', type: 'string' },
            { frontmatterKey: 'entity_created_at', modelKey: 'createdAt', label: '创建时间', type: 'string' },
            { frontmatterKey: 'entity_last_changed_at', modelKey: 'lastChangedAt', label: '最后变更时间', type: 'string' },
            { frontmatterKey: 'entity_last_changed_reason', modelKey: 'lastChangedReason', label: '最后变更原因', type: 'string' },
        ],
    },
    item: {
        category: 'item',
        nameField: '名称',
        fields: [
            { frontmatterKey: '名称', modelKey: 'name', label: '名称', type: 'string', required: true },
            { frontmatterKey: '类型', modelKey: 'type', label: '类型', type: 'string' },
            { frontmatterKey: '品阶/等级', modelKey: 'grade', label: '品阶/等级', type: 'string' },
            { frontmatterKey: '描述', modelKey: 'description', label: '描述', type: 'string' },
            { frontmatterKey: '效果', modelKey: 'effect', label: '效果', type: 'string' },
            { frontmatterKey: '所属/归属', modelKey: 'owner', label: '所属/归属', type: 'string' },
            { frontmatterKey: '当前状态', modelKey: 'currentStatus', label: '当前状态', type: 'string' },
            { frontmatterKey: 'entity_status', modelKey: 'entityStatus', label: '实体状态', type: 'string' },
            { frontmatterKey: 'entity_created_at', modelKey: 'createdAt', label: '创建时间', type: 'string' },
            { frontmatterKey: 'entity_last_changed_at', modelKey: 'lastChangedAt', label: '最后变更时间', type: 'string' },
            { frontmatterKey: 'entity_last_changed_reason', modelKey: 'lastChangedReason', label: '最后变更原因', type: 'string' },
        ],
    },
};

export function getFieldMapping(category: EntityCategory, modelKey: string): FieldMapping | undefined {
    return ENTITY_FIELD_MAPPINGS[category]?.fields.find(f => f.modelKey === modelKey);
}

export function getFrontmatterKey(category: EntityCategory, modelKey: string): string | undefined {
    return getFieldMapping(category, modelKey)?.frontmatterKey;
}

export function getModelKey(category: EntityCategory, frontmatterKey: string): string | undefined {
    return ENTITY_FIELD_MAPPINGS[category]?.fields.find(f => f.frontmatterKey === frontmatterKey)?.modelKey;
}

export function getFieldLabel(category: EntityCategory, modelKey: string): string | undefined {
    return getFieldMapping(category, modelKey)?.label;
}

export function mapFrontmatterToModel<T extends Record<string, unknown>>(
    category: EntityCategory,
    frontmatter: Record<string, unknown>,
): T {
    const mapping = ENTITY_FIELD_MAPPINGS[category];
    const result: Record<string, unknown> = {};
    
    for (const field of mapping.fields) {
        const value = frontmatter[field.frontmatterKey];
        if (value !== undefined && value !== null) {
            result[field.modelKey] = value;
        } else if (field.defaultValue !== undefined) {
            result[field.modelKey] = field.defaultValue;
        }
    }
    
    return result as T;
}

export function mapModelToFrontmatter(
    category: EntityCategory,
    model: Record<string, unknown>,
): Record<string, unknown> {
    const mapping = ENTITY_FIELD_MAPPINGS[category];
    const result: Record<string, unknown> = {};
    
    for (const field of mapping.fields) {
        const value = model[field.modelKey];
        if (value !== undefined && value !== null && value !== '') {
            result[field.frontmatterKey] = value;
        }
    }
    
    return result;
}
/**
 * 结算回写用的字段白名单（v4.20）。
 * 四类实体统一从映射表派生；人物额外并入 CHARACTER_DISPLAY_KEYS（旧白名单超集），
 * 保证旧报告里合法的字段继续可用、新字段（修为等级/当前位置）不再被静默丢弃。
 */
export function getValidFrontmatterKeys(category: EntityCategory): Set<string> {
    const keys = new Set(ENTITY_FIELD_MAPPINGS[category].fields.map((f) => f.frontmatterKey));
    if (category === 'character') {
        // 与 format-constants.CHARACTER_DISPLAY_KEYS 保持超集兼容（避免循环 import，直接列出）
        for (const key of [
            '年龄', '身份', '性格标签', '核心动机', '核心驱动力_软肋',
            '习惯性小动作', '当前状态', '当前情绪', '金手指/特殊能力',
            '功法/技能树', '所属势力', '性别', '外貌特征', '当前目标',
            // v4.25 连续性账本字段（人物模板实时状态区，快照三列的数据源）
            '已知信息', '伤势', '持有物品',
        ]) {
            keys.add(key);
        }
        keys.add('存续状态'); // 站点语义对齐：人物生死/在世状态
    }
    return keys;
}
