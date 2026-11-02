/**
 * domain/validators/domain-validator.ts — 领域验证器
 *
 * 提供领域模型的验证逻辑，确保数据完整性和业务规则一致性。
 */

import { BaseEntity, Project, Chapter, Character, Faction, Location, Item } from '../aggregates';
import type { EntityCategory } from '../aggregates';

/**
 * 验证结果
 */
export interface ValidationResult {
    /** 是否通过验证 */
    isValid: boolean;
    /** 错误列表 */
    errors: ValidationError[];
    /** 警告列表 */
    warnings: ValidationWarning[];
}

/**
 * 验证错误
 */
export interface ValidationError {
    /** 字段名 */
    field: string;
    /** 错误信息 */
    message: string;
    /** 错误代码 */
    code?: string;
}

/**
 * 验证警告
 */
export interface ValidationWarning {
    /** 字段名 */
    field: string;
    /** 警告信息 */
    message: string;
}

/**
 * 创建空的验证结果
  * @returns ValidationResult 实例
 */
function createEmptyResult(): ValidationResult {
    return { isValid: true, errors: [], warnings: [] };
}

/**
 * 添加错误
 * @param result - 结果
 * @param field - 字段
 * @param message - 消息
 * @param code - 代码
 */
function addError(result: ValidationResult, field: string, message: string, code?: string): void {
    result.isValid = false;
    result.errors.push({ field, message, code });
}

/**
 * 添加警告
 * @param result - 结果
 * @param field - 字段
 * @param message - 消息
 */
function addWarning(result: ValidationResult, field: string, message: string): void {
    result.warnings.push({ field, message });
}

/**
 * 领域验证器
 */
export class DomainValidator {
    /**
     * 验证基础实体
     * @param entity - 实体
      * @returns ValidationResult 实例
     */
    static validateBaseEntity(entity: BaseEntity): ValidationResult {
        const result = createEmptyResult();

        if (!entity.id || entity.id.trim() === '') {
            addError(result, 'id', '实体 ID 不能为空', 'ID_EMPTY');
        } else if (entity.id.length > 200) {
            addError(result, 'id', '实体 ID 长度不能超过 200 字符', 'ID_TOO_LONG');
        }

        if (!entity.name || entity.name.trim() === '') {
            addError(result, 'name', '实体名称不能为空', 'NAME_EMPTY');
        } else if (entity.name.length > 100) {
            addWarning(result, 'name', '实体名称建议不超过 100 字符');
        }

        if (!entity.filePath) {
            addWarning(result, 'filePath', '文件路径未设置');
        }

        if (entity.createdAt && !this.isValidIsoDate(entity.createdAt)) {
            addWarning(result, 'createdAt', '创建时间格式不是有效的 ISO 日期');
        }

        if (entity.lastChangedAt && !this.isValidIsoDate(entity.lastChangedAt)) {
            addWarning(result, 'lastChangedAt', '最后变更时间格式不是有效的 ISO 日期');
        }

        return result;
    }

    /**
     * 验证 Project
     * @param project - 项目（路径或对象）
      * @returns ValidationResult 实例
     */
    static validateProject(project: Project): ValidationResult {
        const result = this.validateBaseEntity(project);

        const meta = project.projectMeta;
        if (meta.targetWordCount !== undefined && meta.targetWordCount < 0) {
            addError(result, 'targetWordCount', '目标字数不能为负数', 'NEGATIVE_VALUE');
        }

        if (meta.currentVolume !== undefined) {
            if (meta.currentVolume < 0) {
                addError(result, 'currentVolume', '当前卷数不能为负数', 'NEGATIVE_VALUE');
            }
            if (!Number.isInteger(meta.currentVolume)) {
                addError(result, 'currentVolume', '当前卷数必须是整数', 'NOT_INTEGER');
            }
        }

        if (meta.currentChapter !== undefined) {
            if (meta.currentChapter < 0) {
                addError(result, 'currentChapter', '当前章数不能为负数', 'NEGATIVE_VALUE');
            }
            if (!Number.isInteger(meta.currentChapter)) {
                addError(result, 'currentChapter', '当前章数必须是整数', 'NOT_INTEGER');
            }
        }

        return result;
    }

    /**
     * 验证 Chapter
     * @param chapter - 章节
      * @returns ValidationResult 实例
     */
    static validateChapter(chapter: Chapter): ValidationResult {
        const result = this.validateBaseEntity(chapter);

        if (chapter.volume < 0) {
            addError(result, 'volume', '卷号不能为负数', 'NEGATIVE_VALUE');
        }
        if (!Number.isInteger(chapter.volume)) {
            addError(result, 'volume', '卷号必须是整数', 'NOT_INTEGER');
        }

        if (chapter.chapterNum < 0) {
            addError(result, 'chapterNum', '章号不能为负数', 'NEGATIVE_VALUE');
        }
        if (!Number.isInteger(chapter.chapterNum)) {
            addError(result, 'chapterNum', '章号必须是整数', 'NOT_INTEGER');
        }

        if (!chapter.wordCount.isZero() && chapter.body.length === 0) {
            addWarning(result, 'body', '有字数统计但正文为空');
        }

        if (chapter.wordCount.chinese > 0 && chapter.wordCount.chinese > chapter.wordCount.total) {
            addWarning(result, 'wordCount', '中文字数大于总字数');
        }

        return result;
    }

    /**
     * 验证 Character
     * @param character - 角色
      * @returns ValidationResult 实例
     */
    static validateCharacter(character: Character): ValidationResult {
        const result = this.validateBaseEntity(character);

        const soul = (character as any).soul;
        if (soul) {
            const requiredFields = ['desire', 'fear', 'obsession'];
            for (const field of requiredFields) {
                if (!soul[field]) {
                    addWarning(result, `soul.${field}`, `灵魂层字段 ${field} 为空`);
                }
            }
        }

        const relations = (character as any).relations;
        if (relations && relations.length > 0) {
            for (let i = 0; i < relations.length; i++) {
                const rel = relations[i];
                if (!rel.toName) {
                    addError(result, `relations[${i}].toName`, `第 ${i + 1} 条关系缺少目标名称`, 'RELATION_MISSING_TARGET');
                }
            }
        }

        return result;
    }

    /**
     * 验证 Faction
     * @param faction - 势力
      * @returns ValidationResult 实例
     */
    static validateFaction(faction: Faction): ValidationResult {
        return this.validateBaseEntity(faction);
    }

    /**
     * 验证 Location
     * @param location - 地点
      * @returns ValidationResult 实例
     */
    static validateLocation(location: Location): ValidationResult {
        return this.validateBaseEntity(location);
    }

    /**
     * 验证 Item
     * @param item - 条目
      * @returns ValidationResult 实例
     */
    static validateItem(item: Item): ValidationResult {
        return this.validateBaseEntity(item);
    }

    /**
     * 统一验证入口
     * @param entity - 实体
      * @returns ValidationResult 实例
     */
    static validate(entity: BaseEntity): ValidationResult {
        switch (entity.category) {
            case 'project':
                return this.validateProject(entity as Project);
            case 'chapter':
                return this.validateChapter(entity as Chapter);
            case 'character':
                return this.validateCharacter(entity as Character);
            case 'faction':
                return this.validateFaction(entity as Faction);
            case 'location':
                return this.validateLocation(entity as Location);
            case 'item':
                return this.validateItem(entity as Item);
            default:
                return this.validateBaseEntity(entity);
        }
    }

    /**
     * 检查是否为有效的 ISO 日期字符串
     */
    private static isValidIsoDate(str: string): boolean {
        const date = new Date(str);
        return !isNaN(date.getTime()) && date.toISOString().slice(0, 10) === str.slice(0, 10);
    }

    /**
     * 合并多个验证结果。
     *
     * @param results - 待合并的验证结果
     * @returns ValidationResult 实例
     */
    static mergeResults(...results: ValidationResult[]): ValidationResult {
        const merged = createEmptyResult();
        for (const result of results) {
            if (!result.isValid) {
                merged.isValid = false;
            }
            merged.errors.push(...result.errors);
            merged.warnings.push(...result.warnings);
        }
        return merged;
    }
}
