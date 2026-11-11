#!/usr/bin/env node
/**
 * check-view-tests.mjs — 视图层测试下限（棘轮）
 *
 * 背景（v4.83.0 审计主线 A3）：`ui/` 占源码约 37%，但覆盖率长期在 10% 附近。
 * 绝大部分视图改动只能靠人工点击发现回归。本轮治理的做法是"把能抽的纯逻辑抽出来"，
 * 但那只解决存量；本门禁解决**增量**：超阈值的视图文件必须至少被一个测试 import，
 * 否则新代码会继续无测试地长出来。
 *
 * 判定口径：源文件被任一 `tests/**\/*.test.ts` 通过 import 引用即视为"有测试"。
 * 这个口径偏宽松（只 import 类型也算），是刻意的——本门禁要拦住"完全没人碰过"，
 * 精确到断言级的度量交给覆盖率。
 *
 * 棘轮：未达标的文件登记在 `.view-tests-baseline.json`，清单**只允许变短**。
 * 新增超阈值文件必须自带测试，或（慎用）`--update-baseline` 登记并说明。
 *
 * 用法：
 *   node scripts/check-view-tests.mjs                 # 校验（preflight 用）
 *   node scripts/check-view-tests.mjs --update-baseline --note "原因"
 *   node scripts/check-view-tests.mjs --list           # 打印当前未达标清单
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectImportedSpecifiers } from './lib/view-tests-lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

/** 超过此行数的视图文件必须有测试 */
const LINE_THRESHOLD = 200;

/** UI 层扫描根 */
const UI_DIR = path.join(root, 'ui');
/** 测试扫描根 */
const TEST_DIR = path.join(root, 'tests');
/** 基线文件 */
const BASELINE_PATH = path.join(root, '.view-tests-baseline.json');

/**
 * 纯类型 / 生成物不适用「必须有测试」。
 * - `.d.ts` 与 `*-types.ts`：编译期擦除，没有运行时代码
 * - `*.generated.ts`：生成物，改测试没有意义（应测生成器）
 */
const EXCLUDE_PATTERNS = [
    /\.d\.ts$/,
    /-types\.ts$/,
    /\.generated\.ts$/,
];

const argv = process.argv.slice(2);
const UPDATE_BASELINE = argv.includes('--update-baseline');
const LIST_ONLY = argv.includes('--list');
const noteIndex = argv.indexOf('--note');
const NOTE = noteIndex >= 0 ? String(argv[noteIndex + 1] || '').trim() : '';

/** 递归收集指定扩展名的文件 */
function walk(dir, ext, out = []) {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, ext, out);
        else if (entry.isFile() && full.endsWith(ext)) out.push(full);
    }
    return out;
}

/** 项目相对路径（正斜杠） */
function relOf(file) {
    return path.relative(root, file).replace(/\\/g, '/');
}

/**
 * 把一个 import 说明符解析成项目内真实文件（若存在）。
 *
 * 支持两种形态：`@/x`（别名到仓库根）与相对路径；补 .ts 之后再看目录 index.ts。
 */
function resolveSpecifier(spec, fromFile) {
    let base = null;
    if (spec.startsWith('@/')) base = path.join(root, spec.slice(2));
    else if (spec.startsWith('.')) base = path.resolve(path.dirname(fromFile), spec);
    if (!base) return null;

    for (const candidate of [`${base}.ts`, `${base}.tsx`, base]) {
        try {
            if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
        } catch {
            // 非法路径直接跳过
        }
    }
    const indexFile = path.join(base, 'index.ts');
    if (fs.existsSync(indexFile)) return indexFile;
    return null;
}

// ---- 1. 收集被测试 import 的源文件 ----

const testFiles = walk(TEST_DIR, '.test.ts');
const covered = new Set();

for (const testFile of testFiles) {
    const text = fs.readFileSync(testFile, 'utf8');
    // 只认行首 import/export 语句（原全文正则会把断言字符串里的 import 文案当真 import，
    // 导致零测试文件被判为「有测试」——见 scripts/lib/view-tests-lib.mjs 注释）
    for (const spec of collectImportedSpecifiers(text)) {
        const resolved = resolveSpecifier(spec, testFile);
        if (resolved) covered.add(relOf(resolved));
    }
}

// ---- 2. 找出超阈值且无测试的视图文件 ----

const uiFiles = walk(UI_DIR, '.ts').filter(file => !EXCLUDE_PATTERNS.some(pattern => pattern.test(file)));
const uncovered = [];
for (const file of uiFiles) {
    const rel = relOf(file);
    const lines = fs.readFileSync(file, 'utf8').split('\n').length;
    if (lines <= LINE_THRESHOLD) continue;
    if (covered.has(rel)) continue;
    uncovered.push({ file: rel, lines });
}
uncovered.sort((a, b) => b.lines - a.lines);

if (LIST_ONLY) {
    console.log(`[check:view-tests] 超 ${LINE_THRESHOLD} 行且无测试：${uncovered.length} 个`);
    for (const item of uncovered) console.log(`${String(item.lines).padStart(5)} 行  ${item.file}`);
    process.exit(0);
}

// ---- 3. 读基线并比对（棘轮：只允许清单变短） ----

function readBaseline() {
    if (!fs.existsSync(BASELINE_PATH)) return { files: [] };
    try {
        const data = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
        return { files: Array.isArray(data.files) ? data.files.map(String) : [] };
    } catch {
        console.error('[check:view-tests] ⚠️ 基线文件无法解析，按空基线处理');
        return { files: [] };
    }
}

const baseline = readBaseline();
const baselineSet = new Set(baseline.files);
const currentSet = new Set(uncovered.map(item => item.file));

/** 当前新增的未达标文件（基线里没有） */
const added = [...currentSet].filter(file => !baselineSet.has(file));
/** 已修复但基线还留着的（提示可收紧） */
const fixed = [...baselineSet].filter(file => !currentSet.has(file));

if (UPDATE_BASELINE) {
    // 棘轮纪律：只允许收紧。放宽必须人工改文件并在 note 里给理由。
    const widened = added.filter(file => !NOTE);
    if (added.length > 0 && !NOTE) {
        console.error('[check:view-tests] ❌ 基线只允许收紧；新增未达标文件必须写明 --note 原因：');
        for (const file of added) console.error(`  + ${file}`);
        process.exit(1);
    }
    void widened;
    const linesMap = new Map(uncovered.map(item => [item.file, item.lines]));
    const payload = {
        version: 1,
        updatedAt: new Date().toISOString(),
        threshold: LINE_THRESHOLD,
        note: NOTE,
        files: [...currentSet].sort(),
        lineCounts: Object.fromEntries([...linesMap.entries()].sort(([a], [b]) => a.localeCompare(b))),
    };
    fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    console.log(`[check:view-tests] 已写入基线：${currentSet.size} 个文件（阈值 ${LINE_THRESHOLD} 行）`);
    if (fixed.length > 0) console.log(`  收紧：${fixed.length} 个文件已有测试`);
    if (added.length > 0) console.log(`  放宽：${added.length} 个文件（note: ${NOTE}）`);
    process.exit(0);
}

if (added.length > 0) {
    console.error(`[check:view-tests] ❌ 以下视图文件超过 ${LINE_THRESHOLD} 行且没有任何测试 import：`);
    for (const file of added) console.error(`  - ${file}`);
    console.error('');
    console.error('修复（任选）：');
    console.error('  1. 把其中的判定/格式化逻辑抽成纯函数并补单测（推荐，见 kb-format.ts 等先例）');
    console.error('  2. 直接补一个行为测试并 import 该文件');
    console.error('  3. 确有纯展示无逻辑的理由，运行 --update-baseline --note "原因" 登记');
    process.exit(1);
}

const summary = `当前未达标 ${currentSet.size} 个（阈值 ${LINE_THRESHOLD} 行），基线 ${baselineSet.size} 个`;
if (fixed.length > 0) {
    console.log(`[check:view-tests] ✅ ${summary}`);
    console.log(`  💡 有 ${fixed.length} 个文件已补测试，可运行 --update-baseline 收紧基线（只降不升）`);
} else {
    console.log(`[check:view-tests] ✅ ${summary}，无新增`);
}
