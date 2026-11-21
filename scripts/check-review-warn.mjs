#!/usr/bin/env node
/**
 * 社区审核扫描器 warn 预算门禁。
 *
 * 扫描器的 warn 不阻断上架，但存量必须只降不升：本脚本跑一次非 --quiet 的
 * eslint（配置同 check:obsidian-review），按规则统计 warn 数，与
 * .review-warn-baseline.json 对比，任何一条规则上涨即失败。
 *
 * 用法：
 *   node scripts/check-review-warn.mjs                  # 校验
 *   node scripts/check-review-warn.mjs --update-baseline --note "说明"
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = path.join(root, '.review-warn-baseline.json');
const args = process.argv.slice(2);
const update = args.includes('--update-baseline');
const noteIndex = args.indexOf('--note');
const note = noteIndex >= 0 ? args[noteIndex + 1] : '';

const outFile = path.join(os.tmpdir(), `review-warnings-${process.pid}.json`);
try {
    execFileSync(
        process.execPath,
        [path.join(root, 'node_modules', 'eslint', 'bin', 'eslint.js'), '--config', 'eslint.obsidian-review.mjs', '.', '-f', 'json', '-o', outFile],
        { cwd: root, stdio: 'inherit' },
    );
} catch (error) {
    console.error(`[review-warn] eslint 执行失败（退出码 ${error.status}）`);
    process.exit(error.status || 1);
}

const results = JSON.parse(fs.readFileSync(outFile, 'utf8'));
fs.rmSync(outFile, { force: true });

const byRule = {};
let total = 0;
let errors = 0;
for (const file of results) {
    for (const message of file.messages) {
        if (message.severity === 2) {
            errors += 1;
            continue;
        }
        const rule = message.ruleId || '(unclassified)';
        byRule[rule] = (byRule[rule] || 0) + 1;
        total += 1;
    }
}

if (update) {
    const data = {
        updatedAt: new Date().toISOString().slice(0, 10),
        note,
        total,
        byRule: Object.fromEntries(Object.entries(byRule).sort((a, b) => b[1] - a[1])),
    };
    fs.writeFileSync(baselinePath, JSON.stringify(data, null, 2) + '\n');
    console.log(`✅ 已写入 warn 预算基线: ${path.basename(baselinePath)}（${total} 条 / ${Object.keys(byRule).length} 类规则）`);
    process.exit(0);
}

if (!fs.existsSync(baselinePath)) {
    console.error('❌ 缺少 .review-warn-baseline.json，先运行: node scripts/check-review-warn.mjs --update-baseline --note "说明"');
    process.exit(1);
}

const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
const regressions = [];
for (const [rule, count] of Object.entries(byRule)) {
    const allowed = baseline.byRule?.[rule] ?? 0;
    if (count > allowed) regressions.push(`${rule}: ${count} > 基线 ${allowed}（+${count - allowed}）`);
}

console.log(`[review-warn] 当前 ${total} 条 warn（基线 ${baseline.total}），规则 ${Object.keys(byRule).length} 类`);
if (errors > 0) console.log(`[review-warn] 另有 ${errors} 条 error（由 check:obsidian-review 负责拦截）`);
if (regressions.length > 0) {
    console.error('❌ 扫描器 warn 上涨（只允许下降）:');
    for (const line of regressions) console.error(`  - ${line}`);
    console.error('确需增加请运行 --update-baseline 并在 note 说明原因。');
    process.exit(1);
}

const decreased = Object.entries(byRule).filter(([rule, count]) => count < (baseline.byRule?.[rule] ?? 0)).length;
const gone = Object.keys(baseline.byRule || {}).filter((rule) => !byRule[rule]).length;
console.log(`✅ warn 预算检查通过（${decreased} 类下降、${gone} 类清零，可 --update-baseline 收紧）`);
