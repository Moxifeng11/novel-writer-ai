/**
 * project-name.ts — 项目名净化与校验（创建/重命名/脑洞转换共用）
 *
 * 不允许把空名、纯标点、Windows 保留名或系统目录当成项目名；
 * 发现冲突时返回错误，不静默覆盖或追加后缀。
 */

export interface ProjectNameValidation {
    valid: boolean;
    normalized: string;
    error?: string;
}

import { MODE_LIBRARY_ROOT_LIST } from './creation-mode';

const RESERVED_NAMES = new Set([
    '元文件',
    '文笔风格库',
    '写作知识库',
    '00-系统模板',
    '04-项目总控',
    ...MODE_LIBRARY_ROOT_LIST,
    '.obsidian',
    '.trash',
    '.git',
]);

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const ALLOWED_RE = /^[\u4e00-\u9fa5a-zA-Z0-9_-]+$/;

/**
 * 规范化项目名称。
 * @param raw - 原始
 * @returns 文本结果
 */
export function normalizeProjectName(raw: string): string {
    return (raw || '')
        .normalize('NFKC')
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .trim()
        .replace(/^[.\s]+/, '')
        .replace(/[.\s]+$/, '');
}

/**
 * sanitizeProjectName 函数。
 * @param raw - 原始
 * @returns 文本结果
 */
export function sanitizeProjectName(raw: string): string {
    return normalizeProjectName(raw)
        .replace(/[\/:*?"<>|，。！？、；：“”‘’（）【】《》!?.,;:'"\s]/g, '')
        .slice(0, 20);
}

/**
 * 校验项目名称。
 * @param raw - 原始
 * @param existing - 已有
  * @returns ProjectNameValidation 实例
 */
export function validateProjectName(raw: string, existing: string[] = []): ProjectNameValidation {
    const normalized = normalizeProjectName(raw);
    if (!normalized) return { valid: false, normalized, error: '项目名不能为空' };
    if (normalized.length < 2) return { valid: false, normalized, error: '项目名至少 2 个字符' };
    if (normalized.length > 20) return { valid: false, normalized, error: '项目名最多 20 个字符' };
    if (!ALLOWED_RE.test(normalized)) {
        return { valid: false, normalized, error: '项目名只能包含中文、字母、数字、下划线、连字符' };
    }
    if (RESERVED_NAMES.has(normalized)) {
        return { valid: false, normalized, error: `「${normalized}」是系统保留目录，不能作为项目名` };
    }
    if (WINDOWS_RESERVED.test(normalized)) {
        return { valid: false, normalized, error: `「${normalized}」是 Windows 保留名，不能作为项目名` };
    }
    if (existing.some(name => name === normalized)) {
        return { valid: false, normalized, error: `项目「${normalized}」已存在，请换一个名称` };
    }
    return { valid: true, normalized };
}

/**
 * 判断一个名称能否安全地作为「项目文件夹名」用于 rename。
 *
 * 与 validateProjectName 的区别：这里不做「至少 2 字/只允许中文」等产品约束，
 * 只回答安全边界——拒绝路径分隔、穿越段、控制字符、隐藏目录与系统保留名。
 * 用于 AI/外部 frontmatter 提供的名称在进入 `fileManager.renameFile` 前的最后一道闸门。
 *
 * @param raw - 原始名称
 * @returns 是否安全
 *
 * @example
 * isSafeProjectFolderName('长夜行-2') // true
 * isSafeProjectFolderName('../../evil') // false
 */
export function isSafeProjectFolderName(raw: string): boolean {
    const value = String(raw || '').normalize('NFKC').trim();
    if (!value || value.length > 40) return false;
    if (/[\u0000-\u001f\u007f]/.test(value)) return false;
    if (/[\\/:*?"<>|]/.test(value)) return false;
    if (value.startsWith('.')) return false;
    if (/^[A-Za-z]:/.test(value)) return false;
    if (RESERVED_NAMES.has(value)) return false;
    if (WINDOWS_RESERVED.test(value)) return false;
    return true;
}

/**
 * AI 构思结果可能带书名号/标点；先净化，再交给用户确认。
 *
 * @param raw - 原始
 * @returns 文本结果
 */
export function suggestProjectName(raw: string): string {
    const cleaned = sanitizeProjectName(raw);
    if (cleaned.length >= 2) return cleaned;
    return '';
}
