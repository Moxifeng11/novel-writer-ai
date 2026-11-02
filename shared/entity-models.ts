/**
 * shared/entity-models.ts
 * 统一实体领域模型 + 格式转换层
 *
 * 目标：
 * - 为所有实体（人物/势力/地点/物品功法）提供统一的 DomainModel 接口
 * - 集中管理 Frontmatter ↔ DomainModel ↔ Markdown 的格式转换
 * - 保持向后兼容：旧 import 路径（shared/types.ts）仍然有效
 *
 * 用法：
 *   import { CharacterDomainModel, characterFromFrontmatter } from '../shared/entity-models';
 */

import type {
    CharacterFrontmatter,
    FactionFrontmatter,
    LocationFrontmatter,
    ItemFrontmatter,
    EntityMeta,
    EntityStatus,
} from './types';
import { parseFrontmatter, parseMarkdownContent } from './frontmatter';
import type { MarkdownContent } from './frontmatter';

// ============================================================
// 一、基础接口
// ============================================================

/** 实体分类 */
export type EntityCategory = 'character' | 'faction' | 'location' | 'item';

/** 所有实体 DomainModel 的公共基础接口 */
export interface BaseEntity {
    /** 实体唯一标识（通常为文件名，不含 .md） */
    id: string;
    /** 实体显示名称 */
    name: string;
    /** 文件路径（相对于 vault 根目录） */
    filePath: string;
    /** 标签数组（已归一化） */
    tags: string[];
    /** 实体状态 */
    entityStatus: EntityStatus | undefined;
    /** 创建时间（ISO 字符串） */
    createdAt: string | undefined;
    /** 最后变更时间 */
    lastChangedAt: string | undefined;
    /** 最后变更原因 */
    lastChangedReason: string | undefined;
    /** 原始 frontmatter（完整保留，便于回退） */
    frontmatter: Record<string, unknown>;
    /** 原始 Markdown 正文内容（不含 frontmatter） */
    body: string;
    /** 完整 Markdown 内容结构（已分节） */
    content: MarkdownContent | null;
}

// ============================================================
// 二、人物 DomainModel
// ============================================================

/** 角色灵魂层（9维度核心驱动力） */
export interface CharacterSoulData {
    desire: string;
    fear: string;
    obsession: string;
    shame: string;
    trauma: string;
    weakness: string;
    soft_spot: string;
    rage_trigger: string;
    moral_boundary: string;
}

/** 性格三层结构 */
export interface PersonalityLayers {
    surface: string;
    middle: string;
    deep: string;
}

/** 角色弧光 */
export interface CharacterArc {
    startState: string;
    growthTrigger: string;
    endState: string;
    arcType: '成长弧' | '堕落弧' | '幻灭弧' | '扁平弧';
}

/** 角色关系 */
export interface CharacterRelation {
    fromName: string;
    toName: string;
    type: string;
    tension: string;
}

/** 人物领域模型 — 聚合 frontmatter + soul + 正文分节 */
export interface CharacterDomainModel extends BaseEntity {
    category: 'character';
    age?: string;
    identity?: string;
    gender?: string;
    firstAppearance?: string;
    coreMotivation?: string;
    coreWeakness?: string;
    habit?: string;
    currentStatus?: string;
    currentEmotion?: string;
    currentLocation?: string;
    personalityTags?: string;
    specialAbility?: string;
    skillTree?: string;
    cultivationLevel?: string;
    faction?: string;
    background?: string;
    appearance?: string;
    currentGoal?: string;
    soul: CharacterSoulData | null;
    personality: PersonalityLayers | null;
    arc: CharacterArc | null;
    relations: CharacterRelation[];
}

// ============================================================
// 三、势力 DomainModel
// ============================================================

/** 势力领域模型 */
export interface FactionDomainModel extends BaseEntity {
    category: 'faction';
    alias?: string;
    type?: string;
    description?: string;
    leader?: string;
    rank?: string;
}

// ============================================================
// 四、地点 DomainModel
// ============================================================

/** 地点领域模型 */
export interface LocationDomainModel extends BaseEntity {
    category: 'location';
    alias?: string;
    type?: string;
    description?: string;
    importance?: string;
    geography?: string;
    inhabitants?: string;
    worldRegion?: string;
}

// ============================================================
// 五、物品功法 DomainModel
// ============================================================

/** 物品功法领域模型 */
export interface ItemDomainModel extends BaseEntity {
    category: 'item';
    type?: string;
    grade?: string;
    description?: string;
    effect?: string;
    owner?: string;
    /** 物品当前状态（在谁手里/封印/损毁等；v4.20 结算回写） */
    currentStatus?: string;
}

// ============================================================
// 六、统一实体联合类型
// ============================================================

/**
 * 任意实体领域模型。
 */
export type AnyEntityDomainModel =
    | CharacterDomainModel
    | FactionDomainModel
    | LocationDomainModel
    | ItemDomainModel;

// ============================================================
// 七、工具函数
// ============================================================

function normalizeTags(tags: string | string[] | undefined): string[] {
    if (!tags) return [];
    if (Array.isArray(tags)) return tags;
    return tags.split(',').map(t => t.trim()).filter(Boolean);
}

function extractEntityMeta(fm: EntityMeta & Record<string, unknown>): {
    entityStatus: EntityStatus | undefined;
    createdAt: string | undefined;
    lastChangedAt: string | undefined;
    lastChangedReason: string | undefined;
} {
    return {
        entityStatus: fm.entity_status,
        createdAt: fm.entity_created_at,
        lastChangedAt: fm.entity_last_changed_at,
        lastChangedReason: fm.entity_last_changed_reason,
    };
}

function buildBaseEntity(
    fm: Record<string, unknown>,
    name: string,
    rawContent: string,
    filePath: string,
): Omit<BaseEntity, 'category'> {
    const meta = extractEntityMeta(fm);
    const content = rawContent ? parseMarkdownContent(rawContent) : null;
    const body = rawContent
        ? rawContent.replace(/^---\n[\s\S]*?\n---\n?/, '').trim()
        : '';

    return {
        id: filePath ? filePath.replace(/\.md$/, '').split(/[\\/]/).pop() || name : name,
        name,
        filePath,
        tags: normalizeTags(fm.tags as string | string[] | undefined),
        ...meta,
        frontmatter: { ...fm },
        body,
        content,
    };
}

// ============================================================
// 八、Character 转换函数
// ============================================================

/**
 * CharacterFrontmatter → CharacterDomainModel
 *
 * @param fm - frontmatter 文本
 * @param rawContent - 原始内容
 * @param filePath - 文件路径
  * @returns CharacterDomainModel 实例
 */
export function characterFromFrontmatter(
    fm: CharacterFrontmatter,
    rawContent: string = '',
    filePath: string = '',
): CharacterDomainModel {
    const name = fm.name || fm['姓名'] || '未知角色';
    const base = buildBaseEntity(fm, name, rawContent, filePath);

    let soul: CharacterSoulData | null = null;
    const core = (fm as any).character_core;
    if (core && typeof core === 'object') {
        soul = {
            desire: core.desire || '',
            fear: core.fear || '',
            obsession: core.obsession || '',
            shame: core.shame || '',
            trauma: core.trauma || '',
            weakness: core.weakness || '',
            soft_spot: core.soft_spot || '',
            rage_trigger: core.rage_trigger || '',
            moral_boundary: core.moral_boundary || '',
        };
    }

    let personality: PersonalityLayers | null = null;
    const layers = (fm as any)['性格三层'];
    if (layers && typeof layers === 'object') {
        personality = {
            surface: layers['表层_面具'] || layers.surface || '',
            middle: layers['中层_真实'] || layers.middle || '',
            deep: layers['深层_内核'] || layers.deep || '',
        };
    }

    let arc: CharacterArc | null = null;
    const arcData = (fm as any)['角色弧光'];
    if (arcData && typeof arcData === 'object') {
        arc = {
            startState: arcData['起点状态'] || '',
            growthTrigger: arcData['成长触发点'] || '',
            endState: arcData['终点状态'] || '',
            arcType: arcData['弧光类型'] || '成长弧',
        };
    }

    return {
        ...base,
        category: 'character',
        age: fm['年龄'],
        identity: fm['身份'],
        gender: fm['性别'],
        firstAppearance: fm['首次出场'],
        coreMotivation: fm['核心动机'],
        coreWeakness: fm['核心驱动力_软肋'],
        habit: fm['习惯性小动作'],
        currentStatus: fm['当前状态'],
        currentEmotion: fm['当前情绪'],
        currentLocation: fm['当前位置'],
        personalityTags: fm['性格标签'],
        specialAbility: fm['金手指/特殊能力'],
        skillTree: fm['功法/技能树'],
        cultivationLevel: fm['修为等级'],
        faction: fm['所属势力'],
        background: fm['人物背景'],
        appearance: fm['外貌特征'],
        currentGoal: fm['当前目标'],
        soul,
        personality,
        arc,
        relations: [],
    };
}

/**
 * CharacterDomainModel → CharacterFrontmatter（仅核心字段，无损回退用 frontmatter 属性）
 *
 * @param model - 模型标识
  * @returns CharacterFrontmatter 实例
 */
export function characterToFrontmatter(model: CharacterDomainModel): CharacterFrontmatter {
    const fm: CharacterFrontmatter = {
        ...model.frontmatter,
        tags: model.tags.length ? model.tags : undefined,
        name: model.name,
        姓名: model.name,
        年龄: model.age,
        身份: model.identity,
        性别: model.gender,
        首次出场: model.firstAppearance,
        核心动机: model.coreMotivation,
        核心驱动力_软肋: model.coreWeakness,
        习惯性小动作: model.habit,
        当前状态: model.currentStatus,
        当前情绪: model.currentEmotion,
        当前位置: model.currentLocation,
        性格标签: model.personalityTags,
        '金手指/特殊能力': model.specialAbility,
        '功法/技能树': model.skillTree,
        修为等级: model.cultivationLevel,
        所属势力: model.faction,
        人物背景: model.background,
        外貌特征: model.appearance,
        当前目标: model.currentGoal,
        entity_status: model.entityStatus,
        entity_created_at: model.createdAt,
        entity_last_changed_at: model.lastChangedAt,
        entity_last_changed_reason: model.lastChangedReason,
        filePath: model.filePath,
    };
    return fm;
}

/**
 * 从 Markdown 文本构建 CharacterDomainModel
 *
 * @param content - 内容
 * @param filePath - 文件路径
  * @returns CharacterDomainModel 实例
 */
export function characterFromMarkdown(content: string, filePath: string = ''): CharacterDomainModel {
    const fmRaw = parseFrontmatter(content);
    const fm = fmRaw as unknown as CharacterFrontmatter;
    return characterFromFrontmatter(fm, content, filePath);
}

/**
 * 旧函数名别名 — 保持与 shared/types.ts 中 toDomainModel 的向后兼容
 *
 * @param fm - frontmatter 文本
 * @param rawContent - 原始内容
 * @param filePath - 文件路径
  * @returns CharacterDomainModel 实例
 */
export function toDomainModel(
    fm: CharacterFrontmatter,
    rawContent: string = '',
    filePath: string = '',
): CharacterDomainModel {
    return characterFromFrontmatter(fm, rawContent, filePath);
}

// ============================================================
// 九、Faction 转换函数
// ============================================================

/**
 * FactionFrontmatter → FactionDomainModel
 *
 * @param fm - frontmatter 文本
 * @param rawContent - 原始内容
 * @param filePath - 文件路径
  * @returns FactionDomainModel 实例
 */
export function factionFromFrontmatter(
    fm: FactionFrontmatter,
    rawContent: string = '',
    filePath: string = '',
): FactionDomainModel {
    const name = fm['名称'] || fm.name || '未知势力';
    const base = buildBaseEntity(fm, name, rawContent, filePath);

    return {
        ...base,
        category: 'faction',
        alias: fm['别称'],
        type: fm['类型'],
        description: fm['描述'],
        leader: fm['领袖'],
        rank: fm['地位/排名'],
    };
}

/**
 * FactionDomainModel → FactionFrontmatter
 *
 * @param model - 模型标识
  * @returns FactionFrontmatter 实例
 */
export function factionToFrontmatter(model: FactionDomainModel): FactionFrontmatter {
    const fm: FactionFrontmatter = {
        ...model.frontmatter,
        tags: model.tags.length ? model.tags : undefined,
        名称: model.name,
        别称: model.alias,
        类型: model.type,
        描述: model.description,
        领袖: model.leader,
        '地位/排名': model.rank,
        entity_status: model.entityStatus,
        entity_created_at: model.createdAt,
        entity_last_changed_at: model.lastChangedAt,
        entity_last_changed_reason: model.lastChangedReason,
    };
    return fm;
}

/**
 * 从 Markdown 文本构建 FactionDomainModel
 *
 * @param content - 内容
 * @param filePath - 文件路径
  * @returns FactionDomainModel 实例
 */
export function factionFromMarkdown(content: string, filePath: string = ''): FactionDomainModel {
    const fmRaw = parseFrontmatter(content);
    const fm = fmRaw as unknown as FactionFrontmatter;
    return factionFromFrontmatter(fm, content, filePath);
}

// ============================================================
// 十、Location 转换函数
// ============================================================

/**
 * LocationFrontmatter → LocationDomainModel
 *
 * @param fm - frontmatter 文本
 * @param rawContent - 原始内容
 * @param filePath - 文件路径
  * @returns LocationDomainModel 实例
 */
export function locationFromFrontmatter(
    fm: LocationFrontmatter,
    rawContent: string = '',
    filePath: string = '',
): LocationDomainModel {
    const name = fm['名称'] || fm.name || '未知地点';
    const base = buildBaseEntity(fm, name, rawContent, filePath);

    return {
        ...base,
        category: 'location',
        alias: fm['别称'],
        type: fm['类型'],
        description: fm['描述'],
        importance: fm['重要程度'],
        geography: fm['地理特征'],
        inhabitants: fm['主要居民/势力'],
        worldRegion: fm['所在世界/区域'],
    };
}

/**
 * LocationDomainModel → LocationFrontmatter
 *
 * @param model - 模型标识
  * @returns LocationFrontmatter 实例
 */
export function locationToFrontmatter(model: LocationDomainModel): LocationFrontmatter {
    const fm: LocationFrontmatter = {
        ...model.frontmatter,
        tags: model.tags.length ? model.tags : undefined,
        名称: model.name,
        别称: model.alias,
        类型: model.type,
        描述: model.description,
        重要程度: model.importance,
        地理特征: model.geography,
        '主要居民/势力': model.inhabitants,
        '所在世界/区域': model.worldRegion,
        entity_status: model.entityStatus,
        entity_created_at: model.createdAt,
        entity_last_changed_at: model.lastChangedAt,
        entity_last_changed_reason: model.lastChangedReason,
    };
    return fm;
}

/**
 * 从 Markdown 文本构建 LocationDomainModel
 *
 * @param content - 内容
 * @param filePath - 文件路径
  * @returns LocationDomainModel 实例
 */
export function locationFromMarkdown(content: string, filePath: string = ''): LocationDomainModel {
    const fmRaw = parseFrontmatter(content);
    const fm = fmRaw as unknown as LocationFrontmatter;
    return locationFromFrontmatter(fm, content, filePath);
}

// ============================================================
// 十一、Item 转换函数
// ============================================================

/**
 * ItemFrontmatter → ItemDomainModel
 *
 * @param fm - frontmatter 文本
 * @param rawContent - 原始内容
 * @param filePath - 文件路径
  * @returns ItemDomainModel 实例
 */
export function itemFromFrontmatter(
    fm: ItemFrontmatter,
    rawContent: string = '',
    filePath: string = '',
): ItemDomainModel {
    const name = fm['名称'] || fm.name || '未知物品';
    const base = buildBaseEntity(fm, name, rawContent, filePath);

    return {
        ...base,
        category: 'item',
        type: fm['类型'],
        grade: fm['品阶/等级'],
        description: fm['描述'],
        effect: fm['效果'],
        owner: fm['所属/归属'],
        currentStatus: fm['当前状态'],
    };
}

/**
 * ItemDomainModel → ItemFrontmatter
 *
 * @param model - 模型标识
  * @returns ItemFrontmatter 实例
 */
export function itemToFrontmatter(model: ItemDomainModel): ItemFrontmatter {
    const fm: ItemFrontmatter = {
        ...model.frontmatter,
        tags: model.tags.length ? model.tags : undefined,
        名称: model.name,
        类型: model.type,
        '品阶/等级': model.grade,
        描述: model.description,
        效果: model.effect,
        '所属/归属': model.owner,
        当前状态: model.currentStatus,
        entity_status: model.entityStatus,
        entity_created_at: model.createdAt,
        entity_last_changed_at: model.lastChangedAt,
        entity_last_changed_reason: model.lastChangedReason,
    };
    return fm;
}

/**
 * 从 Markdown 文本构建 ItemDomainModel
 *
 * @param content - 内容
 * @param filePath - 文件路径
  * @returns ItemDomainModel 实例
 */
export function itemFromMarkdown(content: string, filePath: string = ''): ItemDomainModel {
    const fmRaw = parseFrontmatter(content);
    const fm = fmRaw as unknown as ItemFrontmatter;
    return itemFromFrontmatter(fm, content, filePath);
}

// ============================================================
// 十二、统一分发函数
// ============================================================

/**
 * 按分类从 frontmatter 构建对应 DomainModel
 *
 * @param category - 分类
 * @param fm - frontmatter 文本
 * @param rawContent - 原始内容
 * @param filePath - 文件路径
  * @returns CharacterDomainModel 实例
 */
export function entityFromFrontmatter(
    category: 'character',
    fm: CharacterFrontmatter,
    rawContent?: string,
    filePath?: string,
): CharacterDomainModel;
/**
 * entityFromFrontmatter 函数。
 * @param category - 分类
 * @param fm - frontmatter 文本
 * @param rawContent - 原始内容
 * @param filePath - 文件路径
  * @returns FactionDomainModel 实例
 */
export function entityFromFrontmatter(
    category: 'faction',
    fm: FactionFrontmatter,
    rawContent?: string,
    filePath?: string,
): FactionDomainModel;
/**
 * entityFromFrontmatter 函数。
 * @param category - 分类
 * @param fm - frontmatter 文本
 * @param rawContent - 原始内容
 * @param filePath - 文件路径
  * @returns LocationDomainModel 实例
 */
export function entityFromFrontmatter(
    category: 'location',
    fm: LocationFrontmatter,
    rawContent?: string,
    filePath?: string,
): LocationDomainModel;
/**
 * entityFromFrontmatter 函数。
 * @param category - 分类
 * @param fm - frontmatter 文本
 * @param rawContent - 原始内容
 * @param filePath - 文件路径
  * @returns ItemDomainModel 实例
 */
export function entityFromFrontmatter(
    category: 'item',
    fm: ItemFrontmatter,
    rawContent?: string,
    filePath?: string,
): ItemDomainModel;
/**
 * entityFromFrontmatter 函数。
 * @param category - 分类
 * @param fm - frontmatter 文本
 * @param rawContent - 原始内容
 * @param filePath - 文件路径
  * @returns AnyEntityDomainModel 实例
 */
export function entityFromFrontmatter(
    category: EntityCategory,
    fm: Record<string, unknown>,
    rawContent: string = '',
    filePath: string = '',
): AnyEntityDomainModel {
    switch (category) {
        case 'character':
            return characterFromFrontmatter(fm as CharacterFrontmatter, rawContent, filePath);
        case 'faction':
            return factionFromFrontmatter(fm as FactionFrontmatter, rawContent, filePath);
        case 'location':
            return locationFromFrontmatter(fm as LocationFrontmatter, rawContent, filePath);
        case 'item':
            return itemFromFrontmatter(fm as ItemFrontmatter, rawContent, filePath);
    }
}

/**
 * 按分类从 Markdown 构建对应 DomainModel
 *
 * @param category - 分类
 * @param content - 内容
 * @param filePath - 文件路径
  * @returns CharacterDomainModel 实例
 */
export function entityFromMarkdown(
    category: 'character',
    content: string,
    filePath?: string,
): CharacterDomainModel;
/**
 * entityFromMarkdown 函数。
 * @param category - 分类
 * @param content - 内容
 * @param filePath - 文件路径
  * @returns FactionDomainModel 实例
 */
export function entityFromMarkdown(
    category: 'faction',
    content: string,
    filePath?: string,
): FactionDomainModel;
/**
 * entityFromMarkdown 函数。
 * @param category - 分类
 * @param content - 内容
 * @param filePath - 文件路径
  * @returns LocationDomainModel 实例
 */
export function entityFromMarkdown(
    category: 'location',
    content: string,
    filePath?: string,
): LocationDomainModel;
/**
 * entityFromMarkdown 函数。
 * @param category - 分类
 * @param content - 内容
 * @param filePath - 文件路径
  * @returns ItemDomainModel 实例
 */
export function entityFromMarkdown(
    category: 'item',
    content: string,
    filePath?: string,
): ItemDomainModel;
/**
 * entityFromMarkdown 函数。
 * @param category - 分类
 * @param content - 内容
 * @param filePath - 文件路径
  * @returns AnyEntityDomainModel 实例
 */
export function entityFromMarkdown(
    category: EntityCategory,
    content: string,
    filePath: string = '',
): AnyEntityDomainModel {
    switch (category) {
        case 'character':
            return characterFromMarkdown(content, filePath);
        case 'faction':
            return factionFromMarkdown(content, filePath);
        case 'location':
            return locationFromMarkdown(content, filePath);
        case 'item':
            return itemFromMarkdown(content, filePath);
    }
}
