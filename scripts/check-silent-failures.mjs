#!/usr/bin/env node
/**
 * check-silent-failures.mjs — 「读失败当没有 / 写失败当成功」模式门禁
 *
 * 规则（DSH-20261113-26）：扫描 engine/ services/ shared/ 与 ui/ 下的 catch 块，
 * 命中两类「静默失败」即失败：
 *   A. 读失败当没有：catch 返回 null / [] / {} / undefined，且处于写上下文
 *      （邻近行含 save/write/delete/保存/写入/覆盖…）——典型的「读空 → 合并空 → 覆盖写」。
 *   B. 写失败当成功：catch 只 log（或空 catch），不抛、不给失败标志，且处于写上下文。
 *
 * 合法降级用 `// silent-ok: 理由`（同行或上一行）显式豁免；理由不能为空。
 * 存量用 `.silent-failures-baseline.json` 登记，棘轮只降不升。
 *
 * 量具自检（gate-sanity-lib）：扫描到 0 个文件 → 失败（防止扫描根改名后空转）。
 *
 * 检测逻辑在 scripts/lib/silent-failures-lib.mjs（纯函数，可单测）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateSilentFailures } from './lib/silent-failures-lib.mjs';
import { evaluateScanScope, evaluateMeasurement, findVanishedBaselineFiles } from './lib/gate-sanity-lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const SCAN_DIRS = ['engine', 'services', 'shared', 'ui'];
const BASELINE_PATH = path.join(root, '.silent-failures-baseline.json');

const argv = process.argv.slice(2);
const updateBaseline = argv.includes('--update-baseline');
const noteIndex = argv.indexOf('--note');
const note = noteIndex >= 0 ? String(argv[noteIndex + 1] ?? '') : '';
const json = argv.includes('--json');

/**
 * 递归收集 .ts 文件。
 *
 * @param {string} dir - 目录
 * @param {string[]} out - 输出
 * @returns {string[]} 文件列表
 */
function walk(dir, out = []) {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) out.push(full);
    }
    return out;
}

/** 读取基线 */
function loadBaseline() {
    if (!fs.existsSync(BASELINE_PATH)) return { total: 0, files: {} };
    try {
        return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
    } catch {
        return { total: 0, files: {} };
    }
}

const files = [];
for (const dir of SCAN_DIRS) files.push(...walk(path.join(root, dir)));
const relFiles = files.map((f) => path.relative(root, f).replace(/\\/g, '/'));

// 量具自检：扫描范围不得为空
const scopeProblems = evaluateScanScope({ count: files.length, label: 'silent-failures 扫描范围' });
if (scopeProblems.length > 0) {
    console.error('[check:silent-failures] ❌ 量具自检失败：');
    for (const p of scopeProblems) console.error(`  - ${p}`);
    process.exit(2);
}

const contents = {};
let catchTotal = 0;
for (let i = 0; i < files.length; i++) {
    const text = fs.readFileSync(files[i], 'utf8');
    contents[relFiles[i]] = text;
    catchTotal += (text.match(/\bcatch\b/g) ?? []).length;
}

const measurementProblems = evaluateMeasurement({
    total: catchTotal,
    baselineTotal: 0,
    label: 'catch 块总数',
});
if (measurementProblems.length > 0) {
    console.error('[check:silent-failures] ❌ 量具自检失败：');
    for (const p of measurementProblems) console.error(`  - ${p}`);
    process.exit(2);
}

const baseline = loadBaseline();
const vanishedResult = findVanishedBaselineFiles({
    baselineFiles: Object.keys(baseline.files ?? {}),
    exists: (p) => fs.existsSync(path.join(root, p)),
});
if (vanishedResult.vanished.length > 0) {
    console.error('[check:silent-failures] ❌ 基线登记的文件已不存在（搬家必须同步基线）：');
    for (const p of vanishedResult.vanished) console.error(`  - ${p}`);
    process.exit(2);
}

const result = evaluateSilentFailures({ files: contents, baseline });
const byFile = new Map();
for (const v of result.violations) byFile.set(v.path, (byFile.get(v.path) ?? 0) + 1);

if (updateBaseline) {
    if (!note.trim()) {
        console.error('[check:silent-failures] ❌ --update-baseline 必须带 --note "原因"');
        process.exit(1);
    }
    const nextBaseline = {
        total: result.total,
        generatedAt: new Date().toISOString().slice(0, 10),
        note,
        files: Object.fromEntries([...byFile.entries()].sort((a, b) => b[1] - a[1])),
    };
    fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(nextBaseline, null, 2)}\n`);
    console.log(`[check:silent-failures] ✅ 已写入基线：total=${result.total}（${byFile.size} 个文件；豁免 ${result.exempted} 处）`);
    process.exit(0);
}

if (json) {
    process.stdout.write(`${JSON.stringify({ total: result.total, exempted: result.exempted, files: Object.fromEntries(byFile), violations: result.violations }, null, 2)}\n`);
}

if (result.added.length > 0) {
    console.error('[check:silent-failures] ❌ 新增「静默失败」模式（读失败当没有 / 写失败当成功）：');
    for (const v of result.added) console.error(`  - ${v.path}:${v.line} [${v.kind}]`);
    console.error('修复：catch 里抛错、返回失败标志或进 missingEntities；合法降级在该 catch 行加 `// silent-ok: 理由`。');
    process.exit(1);
}

const baselineTotal = Number(baseline.total ?? 0);
if (result.total > baselineTotal) {
    console.error(`[check:silent-failures] ❌ 静默失败总数超过基线：${result.total} > ${baselineTotal}（棘轮只降不升）`);
    process.exit(1);
}

console.log(`[check:silent-failures] ✅ 静默失败 ${result.total} 处（基线 ${baselineTotal}；豁免 ${result.exempted} 处；扫描 ${files.length} 文件 / ${catchTotal} 个 catch）`);
if (result.fixed.length > 0) {
    console.log(`  💡 有 ${result.fixed.length} 个文件已清零，可运行 --update-baseline --note 收紧基线`);
}
