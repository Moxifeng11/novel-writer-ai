#!/usr/bin/env node
/**
 * check-test-standard.mjs — 测试标准中可机械校验部分的门禁
 *
 * 详见 docs/handbook/05-testing.md「测试标准」。四条硬规则：
 * 1. 不得提交 `.only(`（其余用例静默不跑）
 * 2. `.skip(` 必须带 `skip-reason:`
 * 3. 不得写空断言（`expect(true).toBe(true)` 之类）
 * 4. 测试替身必须保留「点文件不在 vault 索引内」的忠实性守卫
 *
 * 规则 4 来自真实事故：mock 的 getAbstractFileByPath 对点文件也返回 TFile，
 * 导致「用 vault 索引 API 读 .project」的缺陷在生产里全线失效、在测试里却全绿。
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
    checkMockFidelity,
    scanTestFile,
    summarizeViolations,
} from './lib/test-standard-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TESTS_DIR = path.join(ROOT, 'tests');
const MOCK_FILE = path.join(TESTS_DIR, '__mocks__', 'obsidian.ts');
const SKIP_DIRS = new Set(['node_modules', '.git', 'coverage', 'tmp', 'dist']);

/**
 * 规则自身的测试文件：它必须把被禁模式当作**字符串字面量**写进用例，
 * 否则无法验证规则是否生效。这是唯一的豁免场景，不要往里加别的文件。
 */
const RULE_TEST_ALLOWLIST = new Set(['tests/unit/scripts/test-standard-lib.test.ts']);

function walk(dir, out = []) {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (!SKIP_DIRS.has(entry.name)) walk(full, out);
        } else if (entry.isFile() && (entry.name.endsWith('.test.ts') || entry.name.endsWith('.spec.ts'))) {
            out.push(full);
        }
    }
    return out;
}

const relOf = (file) => path.relative(ROOT, file).split(path.sep).join('/');

// ── 扫描范围健全性（不允许「扫到 0 个文件」静默通过） ──────────────
const files = walk(TESTS_DIR);
if (files.length === 0) {
    console.error('[check:test-standard] ❌ tests/ 下扫描到 0 个测试文件：扫描根可能改名/缺失，门禁会空转');
    process.exit(1);
}

const violations = [];
for (const file of files) {
    const rel = relOf(file);
    if (RULE_TEST_ALLOWLIST.has(rel)) continue;
    violations.push(...scanTestFile({ rel, text: fs.readFileSync(file, 'utf8') }));
}

// ── 测试替身忠实性 ────────────────────────────────────────────────
if (fs.existsSync(MOCK_FILE)) {
    violations.push(...checkMockFidelity({ rel: relOf(MOCK_FILE), text: fs.readFileSync(MOCK_FILE, 'utf8') }));
} else {
    console.error(`[check:test-standard] ❌ 缺少测试替身：${relOf(MOCK_FILE)}（全部单元/集成测试依赖它）`);
    process.exit(1);
}

if (violations.length > 0) {
    const { byRule } = summarizeViolations(violations);
    console.error(`[check:test-standard] ❌ 违反测试标准（${violations.length} 处）：`);
    for (const item of violations) {
        console.error(`  - ${item.rel}:${item.line} [${item.rule}] ${item.detail}`);
    }
    console.error('');
    console.error('规则分布：');
    for (const [rule, count] of Object.entries(byRule)) console.error(`  ${rule}: ${count}`);
    console.error('');
    console.error('标准见 docs/handbook/05-testing.md；修复后再提交。');
    process.exit(1);
}

console.log(`[check:test-standard] ✅ 测试标准通过（${files.length} 个测试文件 + 替身忠实性守卫）`);
