/**
 * 实体智能上下文引擎 v1.0.0
 *
 * 功能：
 * - 智能选择当前章节/场景相关的实体
 * - 实体出场追踪（出场章节、频率、最近出场）
 * - 智能信息裁剪（按角色等级动态调整详略）
 * - 关系网上下文注入（1度关系）
 *
 * 设计原则：
 * - 性能优先：单次选择 < 50ms
 * - 向后兼容：不破坏现有实体管理功能
 * - 外科手术式：不修改现有代码，通过新增方式集成
 */

import type { CharacterDomainModel, FactionDomainModel, LocationDomainModel, ItemDomainModel, AnyEntityDomainModel } from '@/shared/entity-models';
import type { CharacterPairRelation } from './relationship-engine';
import { createLogger } from '@/shared/logger';


const log = createLogger('EntityContextEngine');
// ============================================================
// 类型定义
// ============================================================

/** 角色重要度等级 */
export type CharacterImportance = 'protagonist' | 'major_support' | 'minor_support' | 'walk_on';

/** 实体选择理由 */
export interface EntitySelectionReason {
    type: 'keyword_match' | 'scene_location' | 'scene_faction' | 'character_important' | 'plot_phase' | 'recent_appearance' | 'relation_chain' | 'manually_pinned';
    score: number;
    description: string;
}

/** 评分后的实体 */
export interface ScoredEntity {
    entity: AnyEntityDomainModel;
    totalScore: number;
    reasons: EntitySelectionReason[];
    importanceLevel: CharacterImportance | null;
    lastAppearanceChapter: number | null;
    appearanceCount: number;
}

/** 实体出场记录 */
export interface EntityAppearanceRecord {
    entityId: string;
    entityName: string;
    category: 'character' | 'faction' | 'location' | 'item';
    chapters: number[];
    lastAppearanceChapter: number | null;
    appearanceCount: number;
    firstAppearanceChapter: number | null;
}

/** 智能实体上下文选项 */
export interface SmartEntityContextOptions {
    project: string;
    currentChapter?: number;
    currentSceneText?: string;
    sceneLocation?: string;
    sceneFactions?: string[];
    sceneCharacters?: string[];
    plotPhase?: string;
    tokenBudget?: number;
    manuallyPinned?: string[];
    manuallyExcluded?: string[];
    maxEntities?: number;
}

/** 裁剪后的实体信息 */
export interface TrimmedEntityInfo {
    id: string;
    name: string;
    category: 'character' | 'faction' | 'location' | 'item';
    summary: string;
    statusLabel?: string;
    importanceLevel?: CharacterImportance;
    detailLevel: 'full' | 'core' | 'brief' | 'minimal';
    lastAppearance?: string;
}

/** 关系上下文 */
export interface RelationContext {
    from: string;
    to: string;
    type: string;
    status: string;
    tension?: string;
    lastUpdated?: string;
}

/** 智能实体上下文结果 */
export interface SmartEntityContextResult {
    characters: TrimmedEntityInfo[];
    locations: TrimmedEntityInfo[];
    factions: TrimmedEntityInfo[];
    items: TrimmedEntityInfo[];
    relations: RelationContext[];
    appearanceTracking: Map<string, EntityAppearanceRecord>;
    missingEntities: string[];
    selectionSummary: {
        totalEntities: number;
        selectedCount: number;
        estimatedTokens: number;
        byCategory: { character: number; location: number; faction: number; item: number };
    };
}

// ============================================================
// 常量配置
// ============================================================

const DEFAULT_MAX_ENTITIES = 15;
const DEFAULT_TOKEN_BUDGET = 4000;

/** 评分权重配置 */
const SCORE_WEIGHTS = {
    keywordMatch: 3.0,
    sceneLocation: 2.5,
    sceneFaction: 2.0,
    characterImportant: {
        protagonist: 5.0,
        major_support: 3.0,
        minor_support: 1.5,
        walk_on: 0.5,
    },
    plotPhase: 2.0,
    recentAppearance: 1.5,
    relationChain: 1.0,
    manuallyPinned: 10.0,
};

/** 角色重要度判定关键词 */
const IMPORTANCE_KEYWORDS = {
    protagonist: ['主角', '男主', '女主', '主人公', '核心角色', 'protagonist', 'main character'],
    major_support: ['重要配角', '主要配角', '核心配角', '关键角色', '男二', '女二', '反派主角'],
    minor_support: ['配角', '次要角色', '支线角色', 'minor'],
};

/** 信息裁剪配置 */
const DETAIL_LEVEL_CONFIG = {
    protagonist: {
        level: 'full' as const,
        maxLength: 800,
        includeFields: ['appearance', 'personality', 'specialAbility', 'background', 'currentStatus', 'currentEmotion', 'relations', 'soul'],
    },
    major_support: {
        level: 'core' as const,
        maxLength: 400,
        includeFields: ['personality', 'specialAbility', 'currentStatus', 'currentEmotion', 'faction'],
    },
    minor_support: {
        level: 'brief' as const,
        maxLength: 200,
        includeFields: ['identity', 'currentStatus', 'faction'],
    },
    walk_on: {
        level: 'minimal' as const,
        maxLength: 80,
        includeFields: ['identity'],
    },
    location: {
        full: { level: 'full' as const, maxLength: 500 },
        core: { level: 'core' as const, maxLength: 250 },
        brief: { level: 'brief' as const, maxLength: 120 },
        minimal: { level: 'minimal' as const, maxLength: 60 },
    },
    faction: {
        full: { level: 'full' as const, maxLength: 400 },
        core: { level: 'core' as const, maxLength: 200 },
        brief: { level: 'brief' as const, maxLength: 100 },
        minimal: { level: 'minimal' as const, maxLength: 50 },
    },
    item: {
        full: { level: 'full' as const, maxLength: 300 },
        core: { level: 'core' as const, maxLength: 150 },
        brief: { level: 'brief' as const, maxLength: 80 },
        minimal: { level: 'minimal' as const, maxLength: 40 },
    },
};

// ============================================================
// EntityContextEngine 主类
// ============================================================

/**
 * 实体上下文引擎。
 */
export class EntityContextEngine {
    private appearanceCache: Map<string, Map<string, EntityAppearanceRecord>> = new Map();

    constructor() {
        // 空构造函数
    }

    // ============================================================
    // 公开 API：智能选择实体
    // ============================================================

    /**
     * 智能选择与当前场景相关的实体
     * @param entities - 实体列表
     * @param options - 配置项
     * @param relations - 关系
     * @returns 结果数组
     */
    selectRelevantEntities(
        entities: AnyEntityDomainModel[],
        options: SmartEntityContextOptions,
        relations?: CharacterPairRelation[],
    ): ScoredEntity[] {
        const startTime = Date.now();

        const {
            currentChapter = 0,
            currentSceneText = '',
            sceneLocation = '',
            sceneFactions = [],
            sceneCharacters = [],
            plotPhase = '',
            manuallyPinned = [],
            manuallyExcluded = [],
            maxEntities = DEFAULT_MAX_ENTITIES,
        } = options;

        const excludedSet = new Set(manuallyExcluded);

        const scored: ScoredEntity[] = [];

        for (const entity of entities) {
            if (excludedSet.has(entity.id) || excludedSet.has(entity.name)) {
                continue;
            }

            const reasons: EntitySelectionReason[] = [];
            let totalScore = 0;

            // 1. 手动固定的实体
            if (manuallyPinned.includes(entity.id) || manuallyPinned.includes(entity.name)) {
                reasons.push({
                    type: 'manually_pinned',
                    score: SCORE_WEIGHTS.manuallyPinned,
                    description: '用户手动固定',
                });
                totalScore += SCORE_WEIGHTS.manuallyPinned;
            }

            // 2. 关键词匹配
            if (currentSceneText) {
                const keywordScore = this.calculateKeywordMatchScore(entity, currentSceneText);
                if (keywordScore > 0) {
                    reasons.push({
                        type: 'keyword_match',
                        score: keywordScore * SCORE_WEIGHTS.keywordMatch,
                        description: `关键词匹配得分 ${keywordScore.toFixed(1)}`,
                    });
                    totalScore += keywordScore * SCORE_WEIGHTS.keywordMatch;
                }
            }

            // 3. 场景地点相关
            if (sceneLocation && entity.category === 'location') {
                const locEntity = entity as LocationDomainModel;
                if (locEntity.name === sceneLocation ||
                    locEntity.alias?.includes(sceneLocation) ||
                    sceneLocation.includes(locEntity.name)) {
                    reasons.push({
                        type: 'scene_location',
                        score: SCORE_WEIGHTS.sceneLocation,
                        description: '当前场景地点',
                    });
                    totalScore += SCORE_WEIGHTS.sceneLocation;
                }
            }

            // 4. 场景势力相关
            if (sceneFactions.length > 0 && entity.category === 'faction') {
                const facEntity = entity as FactionDomainModel;
                if (sceneFactions.some(f =>
                    f === facEntity.name ||
                    facEntity.alias?.includes(f) ||
                    facEntity.name.includes(f))) {
                    reasons.push({
                        type: 'scene_faction',
                        score: SCORE_WEIGHTS.sceneFaction,
                        description: '场景相关势力',
                    });
                    totalScore += SCORE_WEIGHTS.sceneFaction;
                }
            }

            // 5. 角色重要度（仅人物）
            let importanceLevel: CharacterImportance | null = null;
            if (entity.category === 'character') {
                importanceLevel = this.determineCharacterImportance(entity as CharacterDomainModel, sceneCharacters);
                const importanceWeight = SCORE_WEIGHTS.characterImportant[importanceLevel];
                if (importanceWeight > 0) {
                    reasons.push({
                        type: 'character_important',
                        score: importanceWeight,
                        description: `角色重要度：${this.getImportanceLabel(importanceLevel)}`,
                    });
                    totalScore += importanceWeight;
                }
            }

            // 6. 剧情阶段相关（基于标签）
            if (plotPhase && entity.tags.length > 0) {
                const phaseScore = this.calculatePlotPhaseScore(entity, plotPhase);
                if (phaseScore > 0) {
                    reasons.push({
                        type: 'plot_phase',
                        score: phaseScore * SCORE_WEIGHTS.plotPhase,
                        description: `剧情阶段相关度 ${phaseScore.toFixed(1)}`,
                    });
                    totalScore += phaseScore * SCORE_WEIGHTS.plotPhase;
                }
            }

            // 7. 最近出场（基于出场记录）
            const appearanceRecord = this.getAppearanceRecord(options.project, entity.id);
            if (appearanceRecord && currentChapter > 0) {
                const recencyScore = this.calculateRecencyScore(appearanceRecord, currentChapter);
                if (recencyScore > 0) {
                    reasons.push({
                        type: 'recent_appearance',
                        score: recencyScore * SCORE_WEIGHTS.recentAppearance,
                        description: `最近出场于第${appearanceRecord.lastAppearanceChapter}章`,
                    });
                    totalScore += recencyScore * SCORE_WEIGHTS.recentAppearance;
                }
            }

            // 8. 关系链传播（仅人物，基于关系表）
            if (entity.category === 'character' && relations && relations.length > 0 && sceneCharacters.length > 0) {
                const relationScore = this.calculateRelationChainScore(
                    entity as CharacterDomainModel,
                    sceneCharacters,
                    relations,
                );
                if (relationScore > 0) {
                    reasons.push({
                        type: 'relation_chain',
                        score: relationScore * SCORE_WEIGHTS.relationChain,
                        description: `与出场人物关系关联度 ${relationScore.toFixed(1)}`,
                    });
                    totalScore += relationScore * SCORE_WEIGHTS.relationChain;
                }
            }

            // 场景人物直接出场加分
            if (entity.category === 'character' &&
                (sceneCharacters.includes(entity.name) ||
                 sceneCharacters.some(c => entity.name.includes(c) || c.includes(entity.name)))) {
                const boostScore = 4.0;
                reasons.push({
                    type: 'keyword_match',
                    score: boostScore,
                    description: '场景出场人物',
                });
                totalScore += boostScore;
            }

            scored.push({
                entity,
                totalScore,
                reasons,
                importanceLevel,
                lastAppearanceChapter: appearanceRecord?.lastAppearanceChapter || null,
                appearanceCount: appearanceRecord?.appearanceCount || 0,
            });
        }

        scored.sort((a, b) => b.totalScore - a.totalScore);

        const result = scored.slice(0, maxEntities);

        const elapsed = Date.now() - startTime;
        if (elapsed > 50) {
            log.warn(`[EntityContextEngine] 实体选择耗时 ${elapsed}ms，超过 50ms 目标`);
        }

        return result;
    }

    // ============================================================
    // 公开 API：智能裁剪实体信息
    // ============================================================

    /**
     * 根据 token 预算和角色重要度智能裁剪实体信息
     * @param scoredEntities - 打分后的实体
     * @param options - 配置项
     * @param relations - 关系
      * @returns SmartEntityContextResult 实例
     */
    buildSmartContext(
        scoredEntities: ScoredEntity[],
        options: SmartEntityContextOptions,
        relations?: CharacterPairRelation[],
    ): SmartEntityContextResult {
        const tokenBudget = options.tokenBudget || DEFAULT_TOKEN_BUDGET;
        const currentChapter = options.currentChapter || 0;

        const result: SmartEntityContextResult = {
            characters: [],
            locations: [],
            factions: [],
            items: [],
            relations: [],
            appearanceTracking: new Map(),
            missingEntities: [],
            selectionSummary: {
                totalEntities: scoredEntities.length,
                selectedCount: 0,
                estimatedTokens: 0,
                byCategory: { character: 0, location: 0, faction: 0, item: 0 },
            },
        };

        let estimatedTokens = 0;
        const characterNames: string[] = [];

        for (const scored of scoredEntities) {
            const entity = scored.entity;
            const trimmed = this.trimEntityInfo(scored, currentChapter);

            if (estimatedTokens + this.estimateTokens(trimmed.summary) > tokenBudget) {
                continue;
            }

            estimatedTokens += this.estimateTokens(trimmed.summary);
            result.selectionSummary.selectedCount++;

            switch (entity.category) {
                case 'character':
                    result.characters.push(trimmed);
                    result.selectionSummary.byCategory.character++;
                    characterNames.push(entity.name);
                    break;
                case 'location':
                    result.locations.push(trimmed);
                    result.selectionSummary.byCategory.location++;
                    break;
                case 'faction':
                    result.factions.push(trimmed);
                    result.selectionSummary.byCategory.faction++;
                    break;
                case 'item':
                    result.items.push(trimmed);
                    result.selectionSummary.byCategory.item++;
                    break;
            }
        }

        if (relations && relations.length > 0) {
            result.relations = this.filterRelations(characterNames, relations);
        }

        if (options.sceneCharacters) {
            result.missingEntities = options.sceneCharacters.filter(
                name => !result.characters.some(c => c.name === name || name.includes(c.name) || c.name.includes(name))
            );
        }

        result.selectionSummary.estimatedTokens = estimatedTokens;

        return result;
    }

    // ============================================================
    // 公开 API：实体出场追踪
    // ============================================================

    /**
     * 记录实体出场
     * @param project - 项目（路径或对象）
     * @param entityId - 实体ID
     * @param entityName - 实体名称
     * @param category - 分类
     * @param chapterNum - 章号
     */
    recordAppearance(
        project: string,
        entityId: string,
        entityName: string,
        category: 'character' | 'faction' | 'location' | 'item',
        chapterNum: number,
    ): void {
        const projectCache = this.getProjectAppearanceCache(project);
        let record = projectCache.get(entityId);

        if (!record) {
            record = {
                entityId,
                entityName,
                category,
                chapters: [],
                lastAppearanceChapter: null,
                appearanceCount: 0,
                firstAppearanceChapter: null,
            };
            projectCache.set(entityId, record);
        }

        if (!record.chapters.includes(chapterNum)) {
            record.chapters.push(chapterNum);
            record.chapters.sort((a, b) => a - b);
            record.appearanceCount = record.chapters.length;
            record.lastAppearanceChapter = chapterNum;
            if (record.firstAppearanceChapter === null || chapterNum < record.firstAppearanceChapter) {
                record.firstAppearanceChapter = chapterNum;
            }
        }
    }

    /**
     * 从章节正文中批量提取实体出场
     * @param project - 项目（路径或对象）
     * @param chapterNum - 章号
     * @param chapterContent - 章节内容
     * @param entities - 实体列表
     */
    extractAppearancesFromChapter(
        project: string,
        chapterNum: number,
        chapterContent: string,
        entities: AnyEntityDomainModel[],
    ): void {
        for (const entity of entities) {
            const names = this.getEntityAliases(entity);
            const mentioned = names.some(name => {
                const pattern = new RegExp(this.escapeRegex(name), 'g');
                return pattern.test(chapterContent);
            });
            if (mentioned) {
                this.recordAppearance(project, entity.id, entity.name, entity.category, chapterNum);
            }
        }
    }

    /**
     * 获取实体出场记录
     * @param project - 项目（路径或对象）
     * @param entityId - 实体ID
      * @returns EntityAppearanceRecord 或 undefined
     */
    getAppearanceRecord(project: string, entityId: string): EntityAppearanceRecord | undefined {
        return this.getProjectAppearanceCache(project).get(entityId);
    }

    /**
     * 获取长时间未出场的实体
     * @param project - 项目（路径或对象）
     * @param currentChapter - 当前章节
     * @param thresholdChapters - 阈值章数
     * @param entities - 实体列表
      * @returns number }> 结果
     */
    getLongAbsentEntities(
        project: string,
        currentChapter: number,
        thresholdChapters: number = 10,
        entities: AnyEntityDomainModel[],
    ): Array<{ entity: AnyEntityDomainModel; absentChapters: number }> {
        const result: Array<{ entity: AnyEntityDomainModel; absentChapters: number }> = [];

        for (const entity of entities) {
            const record = this.getAppearanceRecord(project, entity.id);
            if (!record || record.lastAppearanceChapter === null) continue;

            const absent = currentChapter - record.lastAppearanceChapter;
            if (absent >= thresholdChapters) {
                result.push({ entity, absentChapters: absent });
            }
        }

        return result.sort((a, b) => b.absentChapters - a.absentChapters);
    }

    /**
     * 清除项目出场缓存
     * @param project - 项目（路径或对象）
     */
    clearAppearanceCache(project: string): void {
        this.appearanceCache.delete(project);
    }

    // ============================================================
    // 内部方法：评分计算
    // ============================================================

    private calculateKeywordMatchScore(entity: AnyEntityDomainModel, text: string): number {
        let score = 0;
        const textLower = text.toLowerCase();

        const names = this.getEntityAliases(entity);
        for (const name of names) {
            if (!name) continue;
            const pattern = new RegExp(this.escapeRegex(name), 'gi');
            const matches = textLower.match(pattern);
            if (matches) {
                score += matches.length * 2;
            }
        }

        if (entity.category === 'character') {
            const charEntity = entity as CharacterDomainModel;
            if (charEntity.identity && textLower.includes(charEntity.identity.toLowerCase())) {
                score += 0.5;
            }
            if (charEntity.faction && textLower.includes(charEntity.faction.toLowerCase())) {
                score += 0.3;
            }
        }

        return Math.min(score, 10);
    }

    private determineCharacterImportance(
        character: CharacterDomainModel,
        sceneCharacters: string[],
    ): CharacterImportance {
        const identity = (character.identity || '').toLowerCase();
        const tags = character.tags.map(t => t.toLowerCase());
        const allText = identity + ' ' + tags.join(' ');

        for (const kw of IMPORTANCE_KEYWORDS.protagonist) {
            if (allText.includes(kw.toLowerCase())) {
                return 'protagonist';
            }
        }

        for (const kw of IMPORTANCE_KEYWORDS.major_support) {
            if (allText.includes(kw.toLowerCase())) {
                return 'major_support';
            }
        }

        for (const kw of IMPORTANCE_KEYWORDS.minor_support) {
            if (allText.includes(kw.toLowerCase())) {
                return 'minor_support';
            }
        }

        if (sceneCharacters.length > 0 && sceneCharacters.some(c => c === character.name || character.name.includes(c))) {
            return 'minor_support';
        }

        return 'walk_on';
    }

    private getImportanceLabel(level: CharacterImportance): string {
        const labels: Record<CharacterImportance, string> = {
            protagonist: '主角',
            major_support: '重要配角',
            minor_support: '次要角色',
            walk_on: '路人',
        };
        return labels[level];
    }

    private calculatePlotPhaseScore(entity: AnyEntityDomainModel, plotPhase: string): number {
        let score = 0;
        const phaseLower = plotPhase.toLowerCase();

        for (const tag of entity.tags) {
            if (phaseLower.includes(tag.toLowerCase()) || tag.toLowerCase().includes(phaseLower)) {
                score += 1.0;
            }
        }

        if (entity.body) {
            const bodyLower = entity.body.toLowerCase();
            if (bodyLower.includes(phaseLower)) {
                score += 0.5;
            }
        }

        return Math.min(score, 3);
    }

    private calculateRecencyScore(record: EntityAppearanceRecord, currentChapter: number): number {
        if (record.lastAppearanceChapter === null) return 0;

        const chaptersAgo = currentChapter - record.lastAppearanceChapter;
        if (chaptersAgo <= 0) return 1.0;
        if (chaptersAgo <= 3) return 0.8;
        if (chaptersAgo <= 5) return 0.5;
        if (chaptersAgo <= 10) return 0.3;
        if (chaptersAgo <= 20) return 0.1;
        return 0;
    }

    private calculateRelationChainScore(
        character: CharacterDomainModel,
        sceneCharacters: string[],
        relations: CharacterPairRelation[],
    ): number {
        let maxScore = 0;

        for (const sceneChar of sceneCharacters) {
            const relation = relations.find(r =>
                (r.charA === character.name && r.charB === sceneChar) ||
                (r.charA === sceneChar && r.charB === character.name)
            );

            if (relation) {
                const intensity = Math.max(
                    relation.state.trust,
                    relation.state.attraction,
                    relation.state.fear,
                    relation.state.resentment,
                    relation.state.dependence,
                ) / 100;
                const score = 0.5 + intensity * 0.5;
                maxScore = Math.max(maxScore, score);
            }
        }

        return maxScore;
    }

    // ============================================================
    // 内部方法：信息裁剪
    // ============================================================

    private trimEntityInfo(
        scored: ScoredEntity,
        currentChapter: number,
    ): TrimmedEntityInfo {
        const { entity, importanceLevel, lastAppearanceChapter } = scored;

        let statusLabel: string | undefined;
        if (entity.entityStatus) {
            statusLabel = this.getStatusLabel(entity.entityStatus);
        } else if (entity.category === 'character') {
            statusLabel = (entity as CharacterDomainModel).currentStatus;
        }

        let detailLevel: 'full' | 'core' | 'brief' | 'minimal' = 'brief';
        let maxLength = 200;

        if (entity.category === 'character' && importanceLevel) {
            const config = DETAIL_LEVEL_CONFIG[importanceLevel];
            detailLevel = config.level;
            maxLength = config.maxLength;
        } else {
            const score = scored.totalScore;
            const catKey = entity.category as 'location' | 'faction' | 'item';
            const catConfig = DETAIL_LEVEL_CONFIG[catKey];
            if (score >= 8) {
                detailLevel = catConfig.full.level;
                maxLength = catConfig.full.maxLength;
            } else if (score >= 5) {
                detailLevel = catConfig.core.level;
                maxLength = catConfig.core.maxLength;
            } else if (score >= 2) {
                detailLevel = catConfig.brief.level;
                maxLength = catConfig.brief.maxLength;
            } else {
                detailLevel = catConfig.minimal.level;
                maxLength = catConfig.minimal.maxLength;
            }
        }

        const summary = this.buildEntitySummary(entity, detailLevel, maxLength);
        const lastAppearance = lastAppearanceChapter
            ? `第${lastAppearanceChapter}章（${currentChapter > 0 ? currentChapter - lastAppearanceChapter : 0}章前）`
            : undefined;

        return {
            id: entity.id,
            name: entity.name,
            category: entity.category,
            summary,
            statusLabel,
            importanceLevel: importanceLevel || undefined,
            detailLevel,
            lastAppearance,
        };
    }

    private buildEntitySummary(
        entity: AnyEntityDomainModel,
        detailLevel: 'full' | 'core' | 'brief' | 'minimal',
        maxLength: number,
    ): string {
        let summary = '';

        switch (entity.category) {
            case 'character':
                summary = this.buildCharacterSummary(entity as CharacterDomainModel, detailLevel);
                break;
            case 'location':
                summary = this.buildLocationSummary(entity as LocationDomainModel, detailLevel);
                break;
            case 'faction':
                summary = this.buildFactionSummary(entity as FactionDomainModel, detailLevel);
                break;
            case 'item':
                summary = this.buildItemSummary(entity as ItemDomainModel, detailLevel);
                break;
        }

        if (summary.length > maxLength) {
            summary = summary.slice(0, maxLength - 3) + '...';
        }

        return summary;
    }

    private buildCharacterSummary(char: CharacterDomainModel, level: string): string {
        const parts: string[] = [];
        const nameLine = `【${char.name}】`;
        parts.push(nameLine);

        if (level === 'full') {
            if (char.identity) parts.push(`身份：${char.identity}`);
            if (char.appearance) parts.push(`外貌：${char.appearance}`);
            if (char.personalityTags) parts.push(`性格：${char.personalityTags}`);
            if (char.specialAbility) parts.push(`能力：${char.specialAbility}`);
            if (char.background) parts.push(`背景：${char.background}`);
            if (char.currentStatus) parts.push(`当前状态：${char.currentStatus}`);
            if (char.currentEmotion) parts.push(`当前情绪：${char.currentEmotion}`);
            if (char.currentLocation) parts.push(`当前位置：${char.currentLocation}`);
            if (char.faction) parts.push(`所属势力：${char.faction}`);
            if (char.currentGoal) parts.push(`当前目标：${char.currentGoal}`);
            if (char.relations && char.relations.length > 0) {
                const relStr = char.relations.slice(0, 5)
                    .map(r => `${r.toName}(${r.type})`)
                    .join('、');
                parts.push(`关系：${relStr}`);
            }
        } else if (level === 'core') {
            if (char.identity) parts.push(`身份：${char.identity}`);
            if (char.personalityTags) parts.push(`性格：${char.personalityTags}`);
            if (char.specialAbility) parts.push(`能力：${char.specialAbility}`);
            if (char.currentStatus) parts.push(`当前状态：${char.currentStatus}`);
            if (char.currentEmotion) parts.push(`当前情绪：${char.currentEmotion}`);
            if (char.faction) parts.push(`所属势力：${char.faction}`);
        } else if (level === 'brief') {
            const briefParts: string[] = [];
            if (char.identity) briefParts.push(char.identity);
            if (char.currentStatus) briefParts.push(`状态：${char.currentStatus}`);
            if (char.faction) briefParts.push(char.faction);
            if (briefParts.length > 0) {
                parts.push(briefParts.join(' | '));
            }
        } else {
            if (char.identity) {
                parts.push(char.identity);
            }
        }

        return parts.join('\n');
    }

    private buildLocationSummary(loc: LocationDomainModel, level: string): string {
        const parts: string[] = [];
        parts.push(`【${loc.name}】`);

        if (level === 'full') {
            if (loc.type) parts.push(`类型：${loc.type}`);
            if (loc.description) parts.push(`描述：${loc.description}`);
            if (loc.importance) parts.push(`重要程度：${loc.importance}`);
            if (loc.geography) parts.push(`地理：${loc.geography}`);
            if (loc.inhabitants) parts.push(`居民/势力：${loc.inhabitants}`);
            if (loc.worldRegion) parts.push(`所在区域：${loc.worldRegion}`);
        } else if (level === 'core') {
            if (loc.type) parts.push(`类型：${loc.type}`);
            if (loc.description) parts.push(`描述：${loc.description}`);
            if (loc.importance) parts.push(`重要程度：${loc.importance}`);
        } else if (level === 'brief') {
            if (loc.type) parts.push(loc.type);
            if (loc.importance) parts.push(`重要度：${loc.importance}`);
        } else {
            if (loc.type) parts.push(loc.type);
        }

        return parts.join('\n');
    }

    private buildFactionSummary(fac: FactionDomainModel, level: string): string {
        const parts: string[] = [];
        parts.push(`【${fac.name}】`);

        if (level === 'full') {
            if (fac.type) parts.push(`类型：${fac.type}`);
            if (fac.description) parts.push(`描述：${fac.description}`);
            if (fac.leader) parts.push(`领袖：${fac.leader}`);
            if (fac.rank) parts.push(`地位/排名：${fac.rank}`);
        } else if (level === 'core') {
            if (fac.type) parts.push(`类型：${fac.type}`);
            if (fac.description) parts.push(`描述：${fac.description}`);
            if (fac.leader) parts.push(`领袖：${fac.leader}`);
        } else if (level === 'brief') {
            if (fac.type) parts.push(fac.type);
            if (fac.leader) parts.push(`领袖：${fac.leader}`);
        } else {
            if (fac.type) parts.push(fac.type);
        }

        return parts.join('\n');
    }

    private buildItemSummary(item: ItemDomainModel, level: string): string {
        const parts: string[] = [];
        parts.push(`【${item.name}】`);

        if (level === 'full') {
            if (item.type) parts.push(`类型：${item.type}`);
            if (item.grade) parts.push(`品阶：${item.grade}`);
            if (item.description) parts.push(`描述：${item.description}`);
            if (item.effect) parts.push(`效果：${item.effect}`);
            if (item.owner) parts.push(`所属：${item.owner}`);
        } else if (level === 'core') {
            if (item.type) parts.push(`类型：${item.type}`);
            if (item.grade) parts.push(`品阶：${item.grade}`);
            if (item.effect) parts.push(`效果：${item.effect}`);
        } else if (level === 'brief') {
            if (item.type) parts.push(item.type);
            if (item.grade) parts.push(`品阶：${item.grade}`);
        } else {
            if (item.type) parts.push(item.type);
        }

        return parts.join('\n');
    }

    private getStatusLabel(status: string): string {
        const statusMap: Record<string, string> = {
            'active': '活跃',
            'inactive': '休眠',
            'dead': '已死亡',
            'hidden': '隐藏',
        };
        return statusMap[status] || status;
    }

    // ============================================================
    // 内部方法：关系过滤
    // ============================================================

    private filterRelations(
        characterNames: string[],
        allRelations: CharacterPairRelation[],
    ): RelationContext[] {
        const result: RelationContext[] = [];
        const nameSet = new Set(characterNames);

        for (const rel of allRelations) {
            const aInScene = nameSet.has(rel.charA);
            const bInScene = nameSet.has(rel.charB);

            if (aInScene || bInScene) {
                if (aInScene && bInScene) {
                    result.push({
                        from: rel.charA,
                        to: rel.charB,
                        type: rel.state.status,
                        status: rel.state.status,
                        lastUpdated: rel.lastUpdatedChapter,
                    });
                } else {
                    const sceneChar = aInScene ? rel.charA : rel.charB;
                    const otherChar = aInScene ? rel.charB : rel.charA;
                    result.push({
                        from: sceneChar,
                        to: otherChar,
                        type: rel.state.status,
                        status: rel.state.status,
                        lastUpdated: rel.lastUpdatedChapter,
                    });
                }
            }
        }

        return result.slice(0, 20);
    }

    // ============================================================
    // 内部方法：工具函数
    // ============================================================

    private getProjectAppearanceCache(project: string): Map<string, EntityAppearanceRecord> {
        let cache = this.appearanceCache.get(project);
        if (!cache) {
            cache = new Map();
            this.appearanceCache.set(project, cache);
        }
        return cache;
    }

    private getEntityAliases(entity: AnyEntityDomainModel): string[] {
        const names: string[] = [entity.name];

        if (entity.category === 'character') {
            const char = entity as CharacterDomainModel;
        } else if (entity.category === 'faction') {
            const fac = entity as FactionDomainModel;
            if (fac.alias) {
                names.push(...fac.alias.split(/[,、]/).map(s => s.trim()).filter(Boolean));
            }
        } else if (entity.category === 'location') {
            const loc = entity as LocationDomainModel;
            if (loc.alias) {
                names.push(...loc.alias.split(/[,、]/).map(s => s.trim()).filter(Boolean));
            }
        }

        return names.filter(Boolean);
    }

    private escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    private estimateTokens(text: string): number {
        return Math.ceil(text.length / 2);
    }

    /**
     * 将智能实体上下文格式化为 AI 提示词可用的文本
     * @param result - 结果
     * @returns 文本结果
     */
    formatSmartContextForPrompt(result: SmartEntityContextResult): string {
        const sections: string[] = [];

        if (result.characters.length > 0) {
            const charSection = this.formatEntitySection(
                '出场人物',
                result.characters.map(c => c.summary),
            );
            sections.push(charSection);
        }

        if (result.locations.length > 0) {
            const locSection = this.formatEntitySection(
                '相关地点',
                result.locations.map(l => l.summary),
            );
            sections.push(locSection);
        }

        if (result.factions.length > 0) {
            const facSection = this.formatEntitySection(
                '相关势力',
                result.factions.map(f => f.summary),
            );
            sections.push(facSection);
        }

        if (result.items.length > 0) {
            const itemSection = this.formatEntitySection(
                '相关物品功法',
                result.items.map(i => i.summary),
            );
            sections.push(itemSection);
        }

        if (result.relations.length > 0) {
            const relLines = result.relations.map(r =>
                `- ${r.from} ↔ ${r.to}：${r.type}（${r.status}）`
            );
            sections.push('## 人物关系\n' + relLines.join('\n'));
        }

        if (result.missingEntities.length > 0) {
            sections.push(`> ⚠️ 注意：以下出场人物在设定库中未找到：${result.missingEntities.join('、')}`);
        }

        return sections.join('\n\n');
    }

    private formatEntitySection(title: string, summaries: string[]): string {
        return `## ${title}\n` + summaries.join('\n\n');
    }
}

/** 全局单例实例 */
let globalEntityContextEngine: EntityContextEngine | null = null;

/**
 * 获取全局实体上下文引擎
 *
  * @returns EntityContextEngine 实例
 */
export function getEntityContextEngine(): EntityContextEngine {
    if (!globalEntityContextEngine) {
        globalEntityContextEngine = new EntityContextEngine();
    }
    return globalEntityContextEngine;
}
