/**
 * check-inline-styles.mjs — UI 内联样式基线检查（棘轮）
 *
 * 统计 ui 目录下所有 .ts（排除测试）中的内联样式写法：
 *   style: '…' / style: "…" / style: `…` / style="…" / setAttribute('style', …)
 * 每行含 `${` 记为动态内联，其余记为静态内联。
 *
 * 基线在 .inline-style-baseline.json；任何文件新增/回涨都会失败。
 * 只能在指标下降后用 --update-baseline 收紧。
 *
 * 用法：
 *   node scripts/check-inline-styles.mjs
 *   node scripts/check-inline-styles.mjs --update-baseline
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const uiDir = path.join(root, 'ui');
const baselinePath = path.join(root, '.inline-style-baseline.json');
const updateBaseline = process.argv.includes('--update-baseline');

const PATTERNS = [
    /style:\s*'/g,
    /style:\s*"/g,
    /style:\s*`/g,
    /style="/g,
    /setAttribute\(\s*['"]style['"]/g,
];

function walk(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            out.push(...walk(full));
        } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
            out.push(full);
        }
    }
    return out;
}

function countFile(source) {
    let total = 0;
    let dynamic = 0;
    for (const line of source.split('\n')) {
        let lineCount = 0;
        for (const pattern of PATTERNS) {
            const matches = line.match(pattern);
            if (matches) lineCount += matches.length;
        }
        if (lineCount === 0) continue;
        total += lineCount;
        if (line.includes('${')) dynamic += lineCount;
    }
    return { total, dynamic, static: total - dynamic };
}

const files = walk(uiDir)
    .map((full) => {
        const rel = path.relative(root, full).split(path.sep).join('/');
        return { rel, ...countFile(fs.readFileSync(full, 'utf8')) };
    })
    .filter((entry) => entry.total > 0)
    .sort((a, b) => b.total - a.total || a.rel.localeCompare(b.rel));

const summary = files.reduce(
    (acc, entry) => {
        acc.total += entry.total;
        acc.dynamic += entry.dynamic;
        acc.static += entry.static;
        acc.files[entry.rel] = entry.total;
        return acc;
    },
    { total: 0, dynamic: 0, static: 0, files: {} },
);

console.log('=== 内联样式检查（ui/） ===');
console.log(`总计: ${summary.total}（静态 ${summary.static} / 动态 ${summary.dynamic}）`);
console.log('Top 10:');
for (const entry of files.slice(0, 10)) {
    console.log(`  ${String(entry.total).padStart(4)}  ${entry.rel}`);
}

if (updateBaseline) {
    const baseline = {
        generatedAt: new Date().toISOString(),
        note: '棘轮基线：每文件只允许下降；新增内联样式需先说明动态原因并显式更新',
        total: summary.total,
        static: summary.static,
        dynamic: summary.dynamic,
        files: summary.files,
    };
    fs.writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
    console.log(`\n✅ 已写入基线: ${path.basename(baselinePath)}`);
    process.exit(0);
}

if (!fs.existsSync(baselinePath)) {
    console.error(`\n❌ 缺少基线文件 ${path.basename(baselinePath)}，先运行: npm run inline:baseline`);
    process.exit(1);
}

const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
const violations = [];

if (summary.total > baseline.total) {
    violations.push(`总内联样式: ${summary.total} > 基线 ${baseline.total} (+${summary.total - baseline.total})`);
}

for (const entry of files) {
    const allowed = baseline.files?.[entry.rel] ?? 0;
    if (entry.total > allowed) {
        violations.push(`${entry.rel}: ${entry.total} > 基线 ${allowed} (+${entry.total - allowed})`);
    }
}

if (violations.length > 0) {
    console.error('\n❌ 内联样式超基线（只允许下降）:');
    violations.forEach((v) => console.error(`  - ${v}`));
    console.error('\n=== 检查失败 ===');
    process.exit(1);
}

console.log('\n✅ 内联样式基线检查通过');
