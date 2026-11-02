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

const RESERVED_NAMES = new Set([
    '元文件',
    '文笔风格库',
    '写作知识库',
    '00-系统模板',
    '04-项目总控',
    '长篇小说',
    '短篇小说',
    '剧本',
    '.obsidian',
    '.trash',
    '.git',
]);

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const ALLOWED_RE = /^[\u4e00-\u9fa5a-zA-Z0-9_-]+$/;

export function normalizeProjectName(raw: string): string {
    return (raw || '')
        .normalize('NFKC')
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .trim()
        .replace(/^[.\s]+/, '')
        .replace(/[.\s]+$/, '');
}

export function sanitizeProjectName(raw: string): string {
    return normalizeProjectName(raw)
        .replace(/[\/:*?"<>|，。！？、；：“”‘’（）【】《》!?.,;:'"\s]/g, '')
        .slice(0, 20);
}

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
