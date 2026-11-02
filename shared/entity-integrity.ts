/**
 * 实体完整性闭环：校验 → AI 补全（一次）→ 复检。
 *
 * 落盘契约：只有 valid 的结果才允许交给 saveEntities；
 * 补全失败或补全后仍不完整时，调用方必须拒绝保存并提示缺失项。
 */
import { validateEntityContent, type EntityKind } from './entity-persistence';

/**
 * EntityIntegrityResult 类型定义。
 */
export interface EntityIntegrityResult {
    /** 补全后的内容（未补全时为原内容） */
    content: string;
    /** 是否通过完整性校验 */
    valid: boolean;
    /** 仍未补齐的字段/分节 */
    missingFields: string[];
    /** 是否调用过 AI 补全 */
    repaired: boolean;
}

/**
 * EntityRepairRequest 类型定义。
 */
export interface EntityRepairRequest {
    kind: EntityKind;
    name: string;
    content: string;
    missingFields: string[];
}

/**
 * EntityRepairHandler 类型定义。
 */
export type EntityRepairHandler = (request: EntityRepairRequest) => Promise<string | null>;

/**
 * ensureEntityIntegrity 函数。
 * @param kind - 种类
 * @param name - 名称
 * @param content - 内容
 * @param repair - 修复建议
  * @returns EntityIntegrityResult 实例
 */
export async function ensureEntityIntegrity(
    kind: EntityKind,
    name: string,
    content: string,
    repair?: EntityRepairHandler
): Promise<EntityIntegrityResult> {
    const first = validateEntityContent(kind, content);
    if (first.valid) {
        return { content, valid: true, missingFields: [], repaired: false };
    }

    if (!repair) {
        return { content, valid: false, missingFields: first.missingFields, repaired: false };
    }

    const repairedContent = await repair({
        kind,
        name,
        content,
        missingFields: first.missingFields,
    });
    if (!repairedContent) {
        return { content, valid: false, missingFields: first.missingFields, repaired: false };
    }

    const second = validateEntityContent(kind, repairedContent);
    return {
        content: repairedContent,
        valid: second.valid,
        missingFields: second.missingFields,
        repaired: true,
    };
}
