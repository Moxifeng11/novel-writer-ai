/**
 * command-handlers-lib.mjs — 命令执行体完整性判定（纯逻辑）
 *
 * 背景（2026-11-13 实踩）：`core/command-registry.ts` 里 `exec(id)` 只是
 * `registry.execute(id)`；若该 id **既没有** `r.register(...)` 直连执行体、
 * 也没有 `ui/command-ui-executor.ts` 的 `case` 分支，命令会「显示已执行但什么也没发生」
 * ——静默失效，且没有任何报错。当天一致性审核命令就因此完全没反应。
 *
 * 本模块把判定抽成纯函数，脚本只负责读文件与报错。
 */

/**
 * 从注册表源码中抽取「被 exec()/execGuarded() 使用」的命令 id。
 *
 * @param source - core/command-registry.ts 源码
 * @returns 命令 id 列表（去重、保持出现顺序）
 */
export function collectExecUsedIds(source) {
    const text = String(source ?? '');
    const ids = [];
    const seen = new Set();
    // exec(CommandIds.X)  /  execGuarded(CommandIds.X, ...)
    const pattern = /exec(?:Guarded)?\(\s*CommandIds\.([A-Z0-9_]+)/g;
    for (const match of text.matchAll(pattern)) {
        const name = match[1];
        if (seen.has(name)) continue;
        seen.add(name);
        ids.push(name);
    }
    return ids;
}

/**
 * 从注册表源码中抽取「直连注册了执行体」的命令 id。
 *
 * 同时返回通过 UI 批量列表注册的 id（这些由 `r.register(id, () => ui.executeCommand(id))`
 * 覆盖，因此还要求 UI 执行器里有对应分支）。
 *
 * @param source - core/command-registry.ts 源码
 * @returns {{ direct: Set<string>, uiListed: Set<string> }}
 */
export function collectRegisteredIds(source) {
    const text = String(source ?? '');
    const uiListed = new Set();

    // 形式 1：for (const id of [ CommandIds.A, ... ]) { r.register(id, ...) }
    // 形式 2：for (const id of uiCommandIds) { r.register(id, ...) } + const uiCommandIds = [ ... ]
    const loopPattern = /for \(const id of (\[[\s\S]*?\]|\w+)\)\s*\{\s*\n?\s*r\.register\(id/g;
    for (const match of text.matchAll(loopPattern)) {
        const target = match[1];
        if (target.startsWith('[')) {
            for (const idMatch of target.matchAll(/CommandIds\.([A-Z0-9_]+)/g)) uiListed.add(idMatch[1]);
            continue;
        }
        // 变量名 → 找对应数组声明
        const declared = new RegExp(`const ${target}\\s*(?::[^=]+)?=\\s*\\[([\\s\\S]*?)\\]\\s*;`).exec(text);
        if (!declared) continue;
        for (const idMatch of declared[1].matchAll(/CommandIds\.([A-Z0-9_]+)/g)) uiListed.add(idMatch[1]);
    }

    const direct = new Set();
    for (const match of text.matchAll(/register\(\s*CommandIds\.([A-Z0-9_]+)/g)) {
        direct.add(match[1]);
    }
    // direct 里剔除「循环内 register(id)」误捕：上面的正则需要 CommandIds.X 字面量，不会误捕
    return { direct, uiListed };
}

/**
 * 从 UI 执行器源码中抽取 `case CommandIds.X:` 分支。
 *
 * @param source - ui/command-ui-executor.ts 源码
 * @returns 命令 id 集合
 */
export function collectExecutorCases(source) {
    const text = String(source ?? '');
    const set = new Set();
    for (const match of text.matchAll(/case\s+CommandIds\.([A-Z0-9_]+)\s*:/g)) {
        set.add(match[1]);
    }
    return set;
}

/**
 * 找出「被 exec 使用但没有执行体」的命令（就是会静默失效的那些）。
 *
 * 判定规则（2026-11-13 修正）：
 *  1. 每条 `exec(id)` 都必须有 `r.register(id, ...)`（直连或 UI 批量列表）——
 *     **只有 UI 执行器的 case 分支不算**，因为没有人调用 `ui.executeCommand(id)`；
 *  2. 通过 UI 批量列表注册的命令，还必须在执行器里有 `case` 分支，
 *     否则 `ui.executeCommand` 会落到 default 返回 false（同样静默）。
 *
 * @param input - 输入
 * @param input.execUsed - 被 exec 使用的 id
 * @param input.registered - { direct, uiListed }
 * @param input.executorCases - UI 执行器分支 id
 * @returns 缺失的 id 列表（含原因前缀）
 */
export function findMissingHandlers({ execUsed, registered, executorCases }) {
    const direct = registered?.direct ?? new Set();
    const uiListed = registered?.uiListed ?? new Set();
    const cases = executorCases ?? new Set();
    const missing = [];
    for (const id of execUsed ?? []) {
        const hasRegistration = direct.has(id) || uiListed.has(id);
        if (!hasRegistration) {
            missing.push(`${id}（无 r.register，命令不会执行）`);
            continue;
        }
        if (uiListed.has(id) && !cases.has(id)) {
            missing.push(`${id}（走 UI 端口但执行器无 case 分支）`);
        }
    }
    return missing;
}

/**
 * 汇总判定结果。
 *
 * @param input - 输入（同上）
 * @returns 判定结果；ok=false 时 missing 给出具体 id 与原因
 */
export function evaluateCommandHandlers(input) {
    const execUsed = input.execUsed ?? [];
    if (execUsed.length === 0) {
        return { ok: false, reason: '未从注册表解析出任何 exec(...) 命令——解析规则可能失效', missing: [] };
    }
    const missing = findMissingHandlers(input);
    return {
        ok: missing.length === 0,
        reason: missing.length === 0 ? '' : `以下命令会静默失效：${missing.join('；')}`,
        missing,
    };
}
