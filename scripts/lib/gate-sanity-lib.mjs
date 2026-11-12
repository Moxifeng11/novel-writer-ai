/**
 * gate-sanity-lib.mjs — 门禁「量具自检」通用判定（可测试）
 *
 * 背景（Trae preflight 审计 P3 · 第 20/21 步）：
 * `check:any` 与 `check:jsdoc` 都有同一个盲区——**只检查「有没有变差」，从不检查
 * 「我要量的东西还在不在」**。扫描根改名、AST 访问器坏掉、文件搬家，都会让
 * 统计结果变成 0，而 0 永远不超基线，于是门禁绿。
 *
 * Trae 的建议是「校验 6 个目录都存在且文件数 > 0」。评估后认为这个修法偏弱：
 * - 只能挡住**整体**目录改名，挡不住「扫描逻辑坏掉 → 全 0」
 * - 需要维护一份硬编码目录清单，目录合法拆分时反而误伤
 *
 * 更准的修法是**对称补一条检查**：现有检查是「当前不得劣于基线」，
 * 缺的那条是「**基线里登记的对象必须仍被观察到**」。三条通用判定：
 *
 * 1. `evaluateScanScope`：扫描范围为空 → 失败（目录改名/缺失）
 * 2. `evaluateMeasurement`：总数掉到 0 但基线非 0 → 失败（量具失效，不是「全都修好了」）
 * 3. `findVanishedBaselineFiles`：基线登记的文件在磁盘上已不存在 → 失败（搬家必须同步基线）
 *
 * 这三条不依赖任何硬编码目录清单，且能同时挡住「目录改名」与「量具失效」。
 */

/**
 * 扫描范围健全性：扫到 0 个对象说明扫描根本身失效。
 *
 * @param input - 输入
 * @param input.count - 扫描到的文件数
 * @param input.label - 扫描范围描述（用于报错文案）
 * @returns 错误列表（空表示健康）
 */
export function evaluateScanScope({ count, label }) {
    if (!Number.isInteger(count) || count <= 0) {
        return [`${label}：扫描到 ${count} 个文件，扫描根可能改名/缺失，门禁会空转`];
    }
    return [];
}

/**
 * 量具有效性：总数归零但基线非零，说明是「没量到」而不是「都修好了」。
 *
 * 注意区分两种 0：
 * - 基线也是 0（本来就没有可统计对象）→ 正常
 * - 基线 > 0 而当前 0 → 量具失效（AST 访问器坏、正则改错、文件被过滤光）
 *
 * @param input - 输入
 * @param input.total - 当前统计总数
 * @param input.baselineTotal - 基线总数
 * @param input.label - 指标描述
 * @returns 错误列表（空表示健康）
 */
export function evaluateMeasurement({ total, baselineTotal, label }) {
    const errors = [];
    if (!Number.isFinite(total) || total < 0) {
        errors.push(`${label}：统计结果非法（${total}）`);
        return errors;
    }
    if (total === 0 && Number.isFinite(baselineTotal) && baselineTotal > 0) {
        errors.push(
            `${label}：当前统计为 0，但基线为 ${baselineTotal}。`
            + '这不是「全都修好了」，而是量具可能失效（AST/正则/过滤条件）；'
            + '若确已清零，请运行 --update-baseline 并说明',
        );
    }
    return errors;
}

/**
 * 基线对象是否仍存在：基线里登记的文件，磁盘上必须还在。
 *
 * 捕获「文件搬家/改名/删除但没同步基线」——这类变更会让该文件从扫描结果里消失，
 * 旧实现只遍历**当前**文件，于是它悄悄退出统计，门禁永远绿。
 *
 * @param input - 输入
 * @param input.baselineFiles - 基线登记的文件列表
 * @param input.exists - (rel: string) => boolean，判断文件是否仍在磁盘
 * @param input.limit - 最多报告条数（默认 10，避免刷屏）
 * @returns 消失的文件列表
 */
export function findVanishedBaselineFiles({ baselineFiles, exists, limit = 10 }) {
    const vanished = [];
    for (const file of baselineFiles || []) {
        if (!exists(file)) vanished.push(String(file));
    }
    return { vanished, truncated: vanished.length > limit, limit };
}

/**
 * 把消失文件列表渲染成失败文案。
 *
 * @param input - 输入
 * @param input.vanished - 消失的文件
 * @param input.truncated - 是否被截断
 * @param input.limit - 展示上限
 * @param input.label - 指标描述
 * @returns 错误列表
 */
export function describeVanishedFiles({ vanished, truncated, limit = 10, label }) {
    if (!vanished || vanished.length === 0) return [];
    const shown = vanished.slice(0, limit);
    const lines = [
        `${label}：${vanished.length} 个基线登记的文件在磁盘上已不存在（搬家/改名/删除必须同步基线）`,
        ...shown.map((file) => `  - ${file}`),
    ];
    if (truncated) lines.push(`  …其余 ${vanished.length - limit} 个略`);
    return [lines.join('\n')];
}
