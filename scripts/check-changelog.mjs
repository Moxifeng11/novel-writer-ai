#!/usr/bin/env node
/**
 * check-changelog.mjs — CHANGELOG 版本节点门禁
 *
 * 背景：历史 `## Unreleased` 曾堆到 49 段，没人知道当前版本从哪开始；
 * 同一版本号也出现过重复节点。规则：
 *   1. 顶部第一个 `##` 必须是 package.json 的当前版本（允许 `v` 前缀）；
 *   2. 当前版本标题只能出现一次（历史重复只告警，不改旧账）；
 *   3. 主 CHANGELOG 不再接收 `## Unreleased`，未发布内容先归档/等发版时写版本节点；
 *   4. 版本标题必须能解析出版本号（`## 4.26.2 — ...` / `## v4.26.2（...）`）。
 *
 * 历史批次已迁到 docs/changelog/archive-unreleased.md，不参与本门禁。
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHANGELOG = path.join(ROOT, 'CHANGELOG.md');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

/** 从 `## v4.26.2（...）` / `## 4.26.2 — ...` 提取版本号 */
function parseVersion(heading) {
    const match = heading.match(/^##\s+v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\b/);
    return match ? match[1] : null;
}

if (!fs.existsSync(CHANGELOG)) {
    console.error('❌ 缺少 CHANGELOG.md');
    process.exit(1);
}

const lines = fs.readFileSync(CHANGELOG, 'utf8').split('\n');
const headings = lines
    .map((line, index) => ({ line, index: index + 1 }))
    .filter(item => item.line.startsWith('## '));

const errors = [];
const warnings = [];

const first = headings[0];
if (!first) {
    errors.push('CHANGELOG 里没有任何 ## 版本节点');
} else {
    const version = parseVersion(first.line);
    if (!version) {
        errors.push(`顶部标题不是版本节点：第 ${first.index} 行「${first.line}」`);
    } else if (version !== pkg.version) {
        errors.push(`顶部版本 ${version} ≠ package.json ${pkg.version}（第 ${first.index} 行）`);
    }
}

const unmatched = headings.filter(item => !parseVersion(item.line));
for (const item of unmatched) {
    errors.push(`无法解析版本号：第 ${item.index} 行「${item.line}」`);
}

const counts = new Map();
for (const item of headings) {
    const version = parseVersion(item.line);
    if (!version) continue;
    const list = counts.get(version) ?? [];
    list.push(item.index);
    counts.set(version, list);
}

const currentLines = counts.get(pkg.version) ?? [];
if (currentLines.length > 1) {
    errors.push(`当前版本 ${pkg.version} 出现 ${currentLines.length} 次：第 ${currentLines.join('、')} 行`);
}

for (const [version, at] of counts) {
    if (version === pkg.version) continue;
    if (at.length > 1) {
        warnings.push(`历史版本 ${version} 重复 ${at.length} 次（第 ${at.join('、')} 行），保留旧账不强行改名`);
    }
}

const unreleased = headings.filter(item => /^##\s+Unreleased\b/i.test(item.line));
if (unreleased.length > 0) {
    errors.push(`主 CHANGELOG 不允许 Unreleased 节点（第 ${unreleased.map(i => i.index).join('、')} 行）；请归档到 docs/changelog/archive-unreleased.md`);
}

if (warnings.length > 0) {
    for (const warning of warnings) console.warn(`[check:changelog] ⚠️ ${warning}`);
}

if (errors.length > 0) {
    console.error('[check:changelog] ❌ 版本节点不合规：');
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
}

console.log(`[check:changelog] ✅ 顶部版本 ${pkg.version} 唯一，共 ${headings.length} 个版本节点，无 Unreleased 堆积`);
