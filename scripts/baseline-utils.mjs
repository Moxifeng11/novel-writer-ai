/**
 * baseline-utils.mjs — 架构守卫基线工具
 *
 * 用途：让 check:deps / check-engines 从「长期红灯」变成「棘轮」：
 * - 首次运行 `--baseline <file>` 时把当前违规写入基线（此后视为已知债务）；
 * - 之后只有「新增」才失败；
 * - `--update-baseline` 允许在「没有新增」的前提下把已消除的条目从基线移除（基线只减不增）。
 *
 * 基线文件由两个脚本共用，各自只改写自己的 section，避免互相覆盖。
 */

import fs from 'node:fs';
import path from 'node:path';

export function parseBaselineArgs(argv = process.argv.slice(2)) {
    let baselinePath = null;
    let updateBaseline = false;

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--update-baseline') {
            updateBaseline = true;
            continue;
        }
        if (arg === '--baseline') {
            baselinePath = argv[i + 1] || null;
            i++;
            continue;
        }
        if (arg.startsWith('--baseline=')) {
            baselinePath = arg.slice('--baseline='.length);
        }
    }

    return {
        baselinePath: baselinePath ? path.resolve(process.cwd(), baselinePath) : null,
        updateBaseline,
    };
}

export function readBaseline(baselinePath) {
    if (!baselinePath || !fs.existsSync(baselinePath)) return null;
    try {
        return JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
    } catch (e) {
        console.error(`[基线] 解析失败，按无基线处理: ${e.message}`);
        return null;
    }
}

/** 只替换指定 section，保留另一个守卫脚本写入的内容 */
export function writeBaseline(baselinePath, section, value) {
    const existing = readBaseline(baselinePath) || {};
    const next = {
        version: 1,
        updatedAt: new Date().toISOString(),
        ...existing,
        [section]: value,
    };
    fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
    fs.writeFileSync(baselinePath, JSON.stringify(next, null, 2) + '\n', 'utf8');
}

/** 集合差异：返回新增（当前有、基线无）与消除（基线有、当前无） */
export function diffSet(baselineList = [], currentList = []) {
    const base = new Set(baselineList);
    const current = new Set(currentList);
    return {
        added: currentList.filter(item => !base.has(item)),
        removed: baselineList.filter(item => !current.has(item)),
    };
}

/**
 * 计数字典差异。
 * added：基线没有的 key；increased：同一 key 计数变大；decreased/removed：可收紧基线。
 */
export function diffCounts(baselineMap = {}, currentMap = {}) {
    const added = [];
    const increased = [];
    const decreased = [];
    const removed = [];

    for (const [key, count] of Object.entries(currentMap)) {
        if (!(key in baselineMap)) {
            added.push({ key, count });
        } else if (count > baselineMap[key]) {
            increased.push({ key, count, base: baselineMap[key] });
        } else if (count < baselineMap[key]) {
            decreased.push({ key, count, base: baselineMap[key] });
        }
    }
    for (const key of Object.keys(baselineMap)) {
        if (!(key in currentMap)) removed.push({ key, base: baselineMap[key] });
    }

    return { added, increased, decreased, removed };
}

/**
 * 应用数组型基线。返回是否应失败。
 * 无基线文件时写入并返回 false（首次基线化）。
 */
export function applySetBaseline({ section, items, label }) {
    const { baselinePath, updateBaseline } = parseBaselineArgs();
    if (!baselinePath) return { failed: items.length > 0, firstRun: false, tightened: 0 };

    const baseline = readBaseline(baselinePath);
    // 基线文件可能由另一个守卫先创建：只有本 section 不存在时才算首次基线化
    if (!baseline || !Array.isArray(baseline[section])) {
        writeBaseline(baselinePath, section, items);
        console.log(`[基线] 首次写入 ${label} 基线：${items.length} 条 → ${baselinePath}`);
        return { failed: false, firstRun: true, tightened: 0 };
    }

    const baseItems = baseline[section];
    const { added, removed } = diffSet(baseItems, items);

    if (added.length > 0) {
        console.log(`\n❌ [基线] ${label} 新增 ${added.length} 条（基线只允许减少）：`);
        for (const item of added) console.log(`  + ${item}`);
        if (removed.length > 0) {
            console.log(`\n[基线] 同时有 ${removed.length} 条已消除，但必须先修复新增项才能收紧基线。`);
        }
        return { failed: true, firstRun: false, tightened: 0 };
    }

    if (updateBaseline && removed.length > 0) {
        writeBaseline(baselinePath, section, items);
        console.log(`\n[基线] 已收紧 ${label} 基线：移除 ${removed.length} 条，当前 ${items.length} 条。`);
        return { failed: false, firstRun: false, tightened: removed.length };
    }

    if (removed.length > 0) {
        console.log(`\n[基线] ${label} 已有 ${removed.length} 条被消除；运行 \`npm run check:deps -- --baseline .arch-baseline.json --update-baseline\` 可收紧基线。`);
    }

    return { failed: false, firstRun: false, tightened: 0 };
}
