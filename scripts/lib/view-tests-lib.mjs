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

/**
 * 扫描健全性校验（Trae preflight 审计 P2 · 第 22 步）。
 *
 * 原实现：`walk()` 在目录不存在时返回空数组，于是「ui/ 改名或缺失」→ 0 个文件 →
 * 0 个未达标 → 无新增 → 门禁绿。扫描范围整个消失而门禁照过，是典型空转。
 *
 * @param input - 输入
 * @param input.uiFiles - 扫到的 ui 源文件数
 * @param input.testFiles - 扫到的测试文件数
 * @returns 错误列表（空表示健康）
 */
export function evaluateScanSanity({ uiFiles, testFiles }) {
    const errors = [];
    if (!Number.isInteger(uiFiles) || uiFiles <= 0) {
        errors.push('ui/ 下扫描到 0 个源文件：目录改名/缺失会导致本门禁空转，请确认扫描根');
    }
    if (!Number.isInteger(testFiles) || testFiles <= 0) {
        errors.push('tests/ 下扫描到 0 个测试文件：无法判定「有测试」，请确认扫描根');
    }
    return errors;
}

/**
 * 视图测试基线棘轮判定。
 *
 * 原实现：`fixed`（基线里有、当前已补测试的文件）只打印「可运行 --update-baseline 收紧」，
 * 属**可选提示**——基线永远不会自动收紧，登记簿退化成永久名单。
 *
 * 修正后：基线必须跟着现实**立即**收紧（`--update-baseline --note`），
 * 否则 `fixed` 非空即失败。这样「补了测试」必须落成基线变短，棘轮才真的只降不升。
 *
 * @param input - 输入
 * @param input.baseline - 基线登记的文件列表
 * @param input.current - 当前仍未达标的文件列表
 * @returns 判定结果
 */
export function evaluateViewTestsRatchet({ baseline, current }) {
    const baseSet = new Set((baseline || []).map(String));
    const curSet = new Set((current || []).map(String));
    const added = [...curSet].filter((file) => !baseSet.has(file)).sort();
    const fixed = [...baseSet].filter((file) => !curSet.has(file)).sort();
    return {
        added,
        fixed,
        /** 需要失败：新增未达标文件（放宽）或已有测试却未收紧基线 */
        needsWiden: added.length > 0,
        needsTighten: fixed.length > 0,
        ok: added.length === 0 && fixed.length === 0,
    };
}
