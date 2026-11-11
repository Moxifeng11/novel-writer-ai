/**
 * view-tests-lib.mjs — `check:view-tests` 的 import 提取（可测试）
 *
 * 抽出来的原因是一个**真实假阳性**：
 * 原实现用 `/(?:from\s+|import\s*)['"]([^'"]+)['"]/g` 直接扫测试文件原文，
 * 于是下面这行断言字符串被当成了真 import——
 *
 * ```ts
 * expect(view).toContain("import { AddFanficSettingModal } from '@/ui/add-fanfic-setting-modal'");
 * ```
 *
 * 后果：`ui/add-fanfic-setting-modal.ts`（720 行、实际零测试）被判为「有测试」，
 * 从零覆盖基线里消失，门禁显示 94 → 93 的**假进步**。
 *
 * 修复思路：**只认「行首的 import/export 语句」**，而不是全文任意位置的 `from '...'`。
 * 这样字符串字面量里的 import 文案不会再被误判。
 *
 * 已知限制（刻意接受）：
 * - 动态 `await import('x')` 不计（本门禁关心静态依赖图）
 * - 块注释里的 import 语句若恰好在行首仍会被计入（极罕见，且方向是「多算」= 更宽松）
 */

/**
 * 从源码文本中提取静态 import / export-from 的模块说明符。
 *
 * @param text - 源码文本
 * @returns 模块说明符数组
 */
export function collectImportedSpecifiers(text) {
    const specs = [];
    const lines = String(text || '').split(/\r?\n/);
    /** 是否处于一条跨行的 import/export 语句中 */
    let pending = null;

    for (const line of lines) {
        const trimmed = line.trim();
        if (pending === null) {
            // 只认「行首」的 import/export，避免命中字符串字面量里的文案
            if (!/^(?:import|export)\b/.test(trimmed)) continue;
            pending = line;
        } else {
            pending += '\n' + line;
        }

        // 侧效应 import：import 'x'
        const sideEffect = /^import\s*['"]([^'"]+)['"]/.exec(pending.trim());
        if (sideEffect) {
            specs.push(sideEffect[1]);
            pending = null;
            continue;
        }
        // 常规：... from 'x'
        const fromMatch = /\bfrom\s*['"]([^'"]+)['"]/.exec(pending);
        if (fromMatch) {
            specs.push(fromMatch[1]);
            pending = null;
            continue;
        }
        // 语句结束仍未找到 from → 放弃（防止跨行拼接失控）
        if (/;\s*$/.test(trimmed) || pending.length > 4000) pending = null;
    }
    return specs;
}
