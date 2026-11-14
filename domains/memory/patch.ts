/**
 * memory-patch.ts — 设定卡内容局部替换（patch 语义，纯函数）
 *
 * 借鉴催更姬 domain/memory/edit.ts：改设定不做「整卡重写」，而是
 * `patch: { oldText, newText }` —— 按原文唯一匹配替换；newText 为空即删除该段。
 *
 * 这样：Agent/用户的修改意图明确、可审计，且不会覆盖作者并行编辑的其它段落。
 */

/** patch 结果 */
export interface MemoryPatchResult {
    /** 是否发生变化 */
    changed: boolean;
    /** 替换后的内容 */
    content: string;
    /** 失败原因（changed=false 且 error 存在时） */
    error?: string;
}

/**
 * 对内容做唯一匹配替换。
 *
 * @param content - 原文
 * @param oldText - 要替换的原文（必须唯一出现）
 * @param newText - 新文本；空字符串表示删除该段
 * @returns 结果
 */
export function applyMemoryPatch(content: string, oldText: string, newText: string): MemoryPatchResult {
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
    const next = original.slice(0, first) + replacement + original.slice(first + needle.length);
    return { changed: true, content: next };
}

/**
 * 校验 patch 参数形状（供工具/服务入口使用）。
 *
 * @param patch - 待校验对象
 * @returns 合法返回 null，否则返回原因
 */
export function validateMemoryPatch(patch: unknown): string | null {
    if (!patch || typeof patch !== 'object') return 'patch 必须是对象';
    const { oldText, newText } = patch as { oldText?: unknown; newText?: unknown };
    if (typeof oldText !== 'string' || !oldText.trim()) return 'patch.oldText 必须是非空字符串';
    if (typeof newText !== 'string') return 'patch.newText 必须是字符串（空字符串表示删除）';
    return null;
}
