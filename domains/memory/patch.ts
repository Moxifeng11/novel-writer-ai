/**
 * memory-patch.ts — 设定卡内容局部替换（patch 语义）
 *
 * 实现复用 shared/text-patch（Agent 文件工具与设定卡工具同一套语义）：
 * 唯一匹配替换；newText 为空即删除该段。
 */

import { applyTextPatch, validateTextPatch, type TextPatchResult } from '@/shared/text-patch';

/** patch 结果（与通用文本 patch 一致） */
export type MemoryPatchResult = TextPatchResult;

/**
 * 对设定卡内容做唯一匹配替换。
 *
 * @param content - 原文
 * @param oldText - 要替换的原文（必须唯一出现）
 * @param newText - 新文本；空字符串表示删除该段
 * @returns 结果
 */
export function applyMemoryPatch(content: string, oldText: string, newText: string): MemoryPatchResult {
    return applyTextPatch(content, oldText, newText);
}

/**
 * 校验 patch 参数形状。
 *
 * @param patch - 待校验对象
 * @returns 合法返回 null，否则返回原因
 */
export function validateMemoryPatch(patch: unknown): string | null {
    return validateTextPatch(patch);
}
