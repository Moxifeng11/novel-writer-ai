/**
 * shared/validators/normalizers-entity.ts
 * 实体卡归一化器 — 安全网：对确实缺失的字段补入默认值
 *
 * 从 shared/template-validator.ts 提取（2026-06-30 P2-1 拆分）。
 * 仅在 validateXxxOutput 校验仍失败时调用，非主要修复路径。
 *
 * 4 个 normalize 函数：normalizeCharacterOutput / normalizeFactionOutput / normalizeLocationOutput / normalizeItemOutput
 */
import {
    CHARACTER_MANDATORY_FIELDS,
    CHARACTER_BODY_SECTIONS,
    ENTITY_BODY_SECTIONS,
    FACTION_FRONTMATTER_KEYS,
    LOCATION_FRONTMATTER_KEYS,
    ITEM_FRONTMATTER_KEYS,
} from '../format-constants';

// ============================================================
// normalize 函数 —— 安全网：对确实缺失的字段补入默认值
// 仅在 validate 校验仍失败时调用，非主要修复路径
// ============================================================

export interface NormalizeResult {
    normalized: string;
    filledCount: number;
    filledFields: string[];
    hasName: boolean;
    name: string;
}

/**
 * 人物卡归一化 —— 对确实缺失的 YAML 字段和正文分节补入 "待补充"
 * 注意：此函数假设 validateCharacterOutput 已用于判定缺失字段
 * @param content - 内容
 * @param missingFields - 缺失字段列表
  * @returns NormalizeResult 实例
 */
export function normalizeCharacterOutput(content: string, missingFields: string[]): NormalizeResult {
    let normalized = content;
    const filledFields: string[] = [];
    let hasName = false;
    let name = '';

    // 确保 YAML frontmatter 存在
    const yamlMatch = normalized.match(/^---\n([\s\S]*?)\n---/);
    let yamlContent = yamlMatch ? yamlMatch[1] : '';
    let bodyContent = yamlMatch ? normalized.slice(yamlMatch[0].length).trim() : normalized;

    // 补全缺失的 YAML 字段
    for (const field of CHARACTER_MANDATORY_FIELDS) {
        if (missingFields.includes(field)) {
            if (field === 'tags') {
                yamlContent += '\ntags: [人物]';
            } else {
                yamlContent += `\n${field}: 待补充`;
            }
            filledFields.push(field);
        }
    }

    // 提取姓名
    const nameMatch = yamlContent.match(/^姓名:\s*["']?(.+?)["']?\s*$/m);
    if (nameMatch && nameMatch[1].trim() && nameMatch[1].trim() !== '待补充') {
        hasName = true;
        name = nameMatch[1].trim();
    }

    // 补全缺失的正文分节
    for (const section of CHARACTER_BODY_SECTIONS) {
        const secKey = `正文分节: ${section}`;
        if (missingFields.includes(secKey)) {
            bodyContent += `\n\n## ${section}\n\n待补充\n`;
            filledFields.push(secKey);
        }
    }

    // 重建完整内容
    normalized = `---\n${yamlContent.trim()}\n---\n${bodyContent}`;

    return { normalized, filledCount: filledFields.length, filledFields, hasName, name };
}

/**
 * 势力卡归一化
 * @param content - 内容
 * @param missingFields - 缺失字段列表
  * @returns NormalizeResult 实例
 */
export function normalizeFactionOutput(content: string, missingFields: string[]): NormalizeResult {
    let normalized = content;
    const filledFields: string[] = [];
    let hasName = false;
    let name = '';

    const yamlMatch = normalized.match(/^---\n([\s\S]*?)\n---/);
    let yamlContent = yamlMatch ? yamlMatch[1] : '';
    let bodyContent = yamlMatch ? normalized.slice(yamlMatch[0].length).trim() : normalized;

    for (const field of FACTION_FRONTMATTER_KEYS as unknown as string[]) {
        if (missingFields.includes(field)) {
            if (field === 'tags') {
                yamlContent += '\ntags: [势力]';
            } else if (field === 'entity_status') {
                yamlContent += '\nentity_status: active';
            } else if (field === 'entity_created_at') {
                yamlContent += `\nentity_created_at: ${new Date().toISOString()}`;
            } else {
                yamlContent += `\n${field}: 待补充`;
            }
            filledFields.push(field);
        }
    }

    const nameMatch = yamlContent.match(/^名称:\s*["']?(.+?)["']?\s*$/m);
    if (nameMatch && nameMatch[1].trim() && nameMatch[1].trim() !== '待补充') {
        hasName = true;
        name = nameMatch[1].trim();
    }

    for (const section of ENTITY_BODY_SECTIONS) {
        const secKey = `正文分节: ${section}`;
        if (missingFields.includes(secKey)) {
            bodyContent += `\n\n## ${section}\n\n待补充\n`;
            filledFields.push(secKey);
        }
    }

    normalized = `---\n${yamlContent.trim()}\n---\n${bodyContent}`;
    return { normalized, filledCount: filledFields.length, filledFields, hasName, name };
}

/**
 * 地点卡归一化
 * @param content - 内容
 * @param missingFields - 缺失字段列表
  * @returns NormalizeResult 实例
 */
export function normalizeLocationOutput(content: string, missingFields: string[]): NormalizeResult {
    let normalized = content;
    const filledFields: string[] = [];
    let hasName = false;
    let name = '';

    const yamlMatch = normalized.match(/^---\n([\s\S]*?)\n---/);
    let yamlContent = yamlMatch ? yamlMatch[1] : '';
    let bodyContent = yamlMatch ? normalized.slice(yamlMatch[0].length).trim() : normalized;

    for (const field of LOCATION_FRONTMATTER_KEYS as unknown as string[]) {
        if (missingFields.includes(field)) {
            if (field === 'tags') {
                yamlContent += '\ntags: [地点]';
            } else if (field === 'entity_status') {
                yamlContent += '\nentity_status: active';
            } else if (field === 'entity_created_at') {
                yamlContent += `\nentity_created_at: ${new Date().toISOString()}`;
            } else {
                yamlContent += `\n${field}: 待补充`;
            }
            filledFields.push(field);
        }
    }

    const nameMatch = yamlContent.match(/^名称:\s*["']?(.+?)["']?\s*$/m);
    if (nameMatch && nameMatch[1].trim() && nameMatch[1].trim() !== '待补充') {
        hasName = true;
        name = nameMatch[1].trim();
    }

    for (const section of ENTITY_BODY_SECTIONS) {
        const secKey = `正文分节: ${section}`;
        if (missingFields.includes(secKey)) {
            bodyContent += `\n\n## ${section}\n\n待补充\n`;
            filledFields.push(secKey);
        }
    }

    normalized = `---\n${yamlContent.trim()}\n---\n${bodyContent}`;
    return { normalized, filledCount: filledFields.length, filledFields, hasName, name };
}

/**
 * 物品功法卡归一化
 * @param content - 内容
 * @param missingFields - 缺失字段列表
  * @returns NormalizeResult 实例
 */
export function normalizeItemOutput(content: string, missingFields: string[]): NormalizeResult {
    let normalized = content;
    const filledFields: string[] = [];
    let hasName = false;
    let name = '';

    const yamlMatch = normalized.match(/^---\n([\s\S]*?)\n---/);
    let yamlContent = yamlMatch ? yamlMatch[1] : '';
    let bodyContent = yamlMatch ? normalized.slice(yamlMatch[0].length).trim() : normalized;

    for (const field of ITEM_FRONTMATTER_KEYS as unknown as string[]) {
        if (missingFields.includes(field)) {
            if (field === 'tags') {
                yamlContent += '\ntags: [物品功法]';
            } else if (field === 'entity_status') {
                yamlContent += '\nentity_status: active';
            } else if (field === 'entity_created_at') {
                yamlContent += `\nentity_created_at: ${new Date().toISOString()}`;
            } else {
                yamlContent += `\n${field}: 待补充`;
            }
            filledFields.push(field);
        }
    }

    const nameMatch = yamlContent.match(/^名称:\s*["']?(.+?)["']?\s*$/m);
    if (nameMatch && nameMatch[1].trim() && nameMatch[1].trim() !== '待补充') {
        hasName = true;
        name = nameMatch[1].trim();
    }

    for (const section of ENTITY_BODY_SECTIONS) {
        const secKey = `正文分节: ${section}`;
        if (missingFields.includes(secKey)) {
            bodyContent += `\n\n## ${section}\n\n待补充\n`;
            filledFields.push(secKey);
        }
    }

    normalized = `---\n${yamlContent.trim()}\n---\n${bodyContent}`;
    return { normalized, filledCount: filledFields.length, filledFields, hasName, name };
}