/**
 * view-tests-lib.mjs 的类型声明（供 TS 测试 import）。
 */

/**
 * 从源码文本中提取静态 import / export-from 的模块说明符。
 *
 * @param text - 源码文本
 * @returns 模块说明符数组
 */
export function collectImportedSpecifiers(text: string | null | undefined): string[];
