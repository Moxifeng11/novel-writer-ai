#!/usr/bin/env node
/**
 * check-any-budget.mjs — any 类型预算棘轮（只降不升）
 *
 * 用 TypeScript AST 统计运行时代码里的 `any` 类型节点（注释和字符串不算），
 * 与 `.any-baseline.json` 对比：
 *   - 总数为 0 增量：超过基线直接失败；
 *   - 单文件不得高于基线：防止把 any 从一个文件挪到另一个文件；
 *   - 新增文件出现 any 也视为超预算（基线里没有该文件 = 0）。
 *
 * 用法：
 *   node scripts/check-any-budget.mjs            # 校验
 *   node scripts/check-any-budget.mjs --list     # 额外打印 Top 20
 *   node scripts/check-any-budget.mjs --update-baseline  # 收敛后下调基线
 *
 * 规则：只有真正消除 any 才能更新基线；不得为了过门禁上调基线。
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import {
    describeVanishedFiles,
    evaluateMeasurement,
    evaluateScanScope,
    findVanishedBaselineFiles,
} from './lib/gate-sanity-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_PATH = path.join(ROOT, '.any-baseline.json');
const SCAN_DIRS = ['engine', 'services', 'shared', 'core', 'domains', 'ui'];
const ROOT_FILES = ['main.ts', 'plugin-api.ts'];
const IGNORED_DIRS = new Set(['node_modules', '.git', 'coverage', 'tmp', 'dist']);

/** 收集运行时代码（不含测试与声明文件） */
function collectFiles() {
    const files = [];
    const walk = dir => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (!IGNORED_DIRS.has(entry.name)) walk(full);
            } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
                files.push(full);
            }
        }
    };
    for (const dir of SCAN_DIRS) {
        const full = path.join(ROOT, dir);
        if (fs.existsSync(full)) walk(full);
    }
    for (const file of ROOT_FILES) {
        const full = path.join(ROOT, file);
        if (fs.existsSync(full)) files.push(full);
    }
    return files;
}

/** 统计单个文件里的 AnyKeyword 节点 */
function countAny(file) {
    const source = fs.readFileSync(file, 'utf8');
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    let count = 0;
    const visit = node => {
        if (node.kind === ts.SyntaxKind.AnyKeyword) count += 1;
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return count;
}

function readBaseline() {
    if (!fs.existsSync(BASELINE_PATH)) {
        console.error('❌ 缺少 .any-baseline.json；先运行 `npm run check:any -- --update-baseline` 建立基线。');
        process.exit(1);
    }
    return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
}

const files = collectFiles();
const current = new Map();
let total = 0;
for (const file of files) {
    const count = countAny(file);
    if (count > 0) {
        const rel = path.relative(ROOT, file).split(path.sep).join('/');
        current.set(rel, count);
        total += count;
    }
}

const args = new Set(process.argv.slice(2));
if (args.has('--update-baseline')) {
    const sorted = Object.fromEntries([...current.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
    fs.writeFileSync(
        BASELINE_PATH,
        `${JSON.stringify({ total, generatedAt: new Date().toISOString().slice(0, 10), files: sorted }, null, 2)}\n`,
        'utf8',
    );
    console.log(`✅ 已写入 .any-baseline.json：${total} 处 any（${current.size} 个文件）`);
    process.exit(0);
}

const baseline = readBaseline();
const baselineFiles = baseline.files ?? {};
const violations = [];
let removed = 0;
let added = 0;

// ── 量具自检（Trae preflight 审计 P3 · 第 21 步） ─────────────────────
// 原实现：目录缺失 → collectFiles 跳过 → total 变小 → 「没超预算」→ 绿。
// 只检查「有没有变差」，从不检查「我要量的东西还在不在」。
const sanityErrors = [
    ...evaluateScanScope({ count: files.length, label: '[check:any] 源文件扫描' }),
    ...evaluateMeasurement({ total, baselineTotal: baseline.total, label: '[check:any] any 总数' }),
];
const { vanished, truncated } = findVanishedBaselineFiles({
    baselineFiles: Object.keys(baselineFiles),
    exists: (rel) => fs.existsSync(path.join(ROOT, rel)),
});
sanityErrors.push(...describeVanishedFiles({
    vanished,
    truncated,
    label: '[check:any]',
}));
if (sanityErrors.length > 0) {
    console.error('\n❌ any 门禁自检失败（不是「变好了」，是「没量到」）：');
    for (const item of sanityErrors) console.error(`  - ${item}`);
    console.error('\n若确属合法变更（文件搬家/目录调整），运行 `npm run check:any -- --update-baseline` 同步基线。');
    process.exit(1);
}

if (total > baseline.total) {
    violations.push(`总数超预算：${total} > ${baseline.total}（+${total - baseline.total}）`);
}

for (const [file, count] of current) {
    const allowed = baselineFiles[file] ?? 0;
    if (count > allowed) {
        const delta = count - allowed;
        added += delta;
        violations.push(`${file}: ${count} > ${allowed}（+${delta}）`);
    }
}

for (const [file, allowed] of Object.entries(baselineFiles)) {
    const count = current.get(file) ?? 0;
    if (count < allowed) removed += allowed - count;
}

if (args.has('--list') || violations.length > 0) {
    const top = [...current.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
    console.log('[check:any] 当前 any Top 20：');
    for (const [file, count] of top) console.log(`  ${String(count).padStart(4)}  ${file}`);
}

if (violations.length > 0) {
    console.error('\n❌ any 预算超限：');
    for (const item of violations) console.error(`  - ${item}`);
    console.error('\n消除 any 后运行 `npm run check:any -- --update-baseline` 下调基线；不得上调。');
    process.exit(1);
}

const removedNote = removed > 0 ? `，已消除 ${removed} 处（可下调基线）` : '';
console.log(`✅ any 预算通过：${total}/${baseline.total}（${current.size} 个文件）${removedNote}`);
