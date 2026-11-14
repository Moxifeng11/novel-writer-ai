/**
 * text-patch.ts — 文本局部替换（patch 语义，纯函数）
 *
 * 用于「改一段而不是整文件覆盖」：按原文唯一匹配替换；newText 为空即删除该段。
 * 找不到/多处匹配都拒绝并说明原因，避免误改。
 */

/** patch 结果 */
export interface TextPatchResult {
    /** 是否发生变化 */
    changed: boolean;
    /** 替换后的内容 */
    content: string;
    /** 失败原因 */
    error?: string;
}

/**
 * 对文本做唯一匹配替换。
 *
 * @param content - 原文
 * @param oldText - 要替换的原文（必须唯一出现）
 * @param newText - 新文本；空字符串表示删除该段
 * @returns 结果
 */
export function applyTextPatch(content: string, oldText: string, newText: string): TextPatchResult {
    const original = String(content ?? '');
    const needle = String(oldText ?? '');
    if (!needle) {
        return { changed: false, content: original, error: 'oldText 不能为空' };
    }
    const first = original.indexOf(needle);
    if (first < 0) {
        return { changed: false, content: original, error: '原文中找不到要替换的片段' };
    }
    if (original.indexOf(needle, first + needle.length) >= 0) {
        return { changed: false, content: original, error: '片段在原文中出现多次，请提供更长上下文' };
    }
    const replacement = String(newText ?? '');
    if (replacement === needle) {
        return { changed: false, content: original };
    }
    return {
        changed: true,
        content: original.slice(0, first) + replacement + original.slice(first + needle.length),
    };
}

/**
 * 校验 patch 参数形状。
 *
 * @param patch - 待校验对象
 * @returns 合法返回 null，否则返回原因
 */
export function validateTextPatch(patch: unknown): string | null {
    if (!patch || typeof patch !== 'object') return 'patch 必须是对象';
    const { oldText, newText } = patch as { oldText?: unknown; newText?: unknown };
    if (typeof oldText !== 'string' || !oldText.trim()) return 'oldText 必须是非空字符串';
    if (typeof newText !== 'string') return 'newText 必须是字符串（空字符串表示删除）';
    return null;
}
