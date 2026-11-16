#!/usr/bin/env node
/**
 * check-utility-classes.mjs — nw-u- 工具类体系门禁（2026-11-16）
 *
 * 背景：2026-11 前的内联样式批量清理脚本用「可读名 + 重名加 -2」的方式生成
 * 工具类，结果：
 *   1. 同一套定义被复制成两遍（-2 后缀），142 条规则纯重复；
 *   2. 真正撞名的不同声明被强行加 -2，名字与含义不符
 *      （如 nw-u-op-0-2 其实是 opacity:0.2，nw-u-margintop-4px-2 其实是负值）；
 *   3. 生成过程还留下若干「引用了但没定义」的死类。
 * 本轮已合并为单套（432 条）并修正死类，本脚本负责不让它再长回去。
 *
 * 检查项：
 *   A. 不允许出现 -2/-3 后缀的工具类（重名复制）
 *   B. TS 里引用的 nw-u-* 必须有对应定义（防死类）
 *   C. 工具类定义数与使用量不得超过基线（只允许下降）
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CSS_FILE = join(ROOT, 'styles-src', '10-entity-and-utilities.css');
const BASELINE_FILE = join(ROOT, '.utility-classes-baseline.json');
const SCAN_DIRS = ['ui', 'tests', 'engine', 'services', 'shared', 'core', 'domains', 'utils'];

/** 递归收集 .ts 文件 */
function collectTs(dir, out = []) {
    if (!existsSync(dir)) return out;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) collectTs(full, out);
        else if (entry.name.endsWith('.ts')) out.push(full);
    }
    return out;
}

const css = readFileSync(CSS_FILE, 'utf8');
const definitions = [...css.matchAll(/^\.(nw-u-[a-zA-Z0-9-]+)\s*\{/gm)].map(m => m[1]);
const defined = new Set(definitions);

// A. 重名后缀
// 重名复制的判定：name 以 -N 结尾，且去掉后缀后存在同名同声明的类
const declOf = new Map();
for (const line of css.split('\n')) {
    const match = line.match(/^\.(nw-u-[a-zA-Z0-9-]+)\s*\{([^}]*)\}/);
    if (match) declOf.set(match[1], match[2].trim());
}
const suffixed = definitions.filter(name => {
    const suffixMatch = name.match(/-([2-9])$/);
    if (!suffixMatch) return false;
    const base = name.slice(0, -2);
    return declOf.has(base) && declOf.get(base) === declOf.get(name);
});
// B. 引用未定义
const files = SCAN_DIRS.flatMap(dir => collectTs(join(ROOT, dir)));
const rootMain = join(ROOT, 'main.ts');
if (existsSync(rootMain)) files.push(rootMain);
const references = new Map();
for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/cls:\s*['"`]([^'"`]+)['"`]/g)) {
        for (const token of match[1].split(/\s+/)) {
            if (!token.startsWith('nw-u-')) continue;
            references.set(token, (references.get(token) ?? 0) + 1);
        }
    }
}
const undefinedRefs = [...references.keys()].filter(name => !defined.has(name));
const totalUsage = [...references.values()].reduce((sum, n) => sum + n, 0);

const baseline = existsSync(BASELINE_FILE)
    ? JSON.parse(readFileSync(BASELINE_FILE, 'utf8'))
    : { definitions: definitions.length, usage: totalUsage, note: '初始基线' };

/** 写入基线 */
function updateBaseline() {
    writeFileSync(BASELINE_FILE, JSON.stringify({
        definitions: definitions.length,
        usage: totalUsage,
        updatedAt: new Date().toISOString().slice(0, 10),
        note: process.argv.find(arg => arg.startsWith('--note='))?.slice(7) ?? '',
    }, null, 2) + '\n', 'utf8');
    console.log(`✅ 已写入基线: .utility-classes-baseline.json（定义 ${definitions.length}，使用 ${totalUsage}）`);
}

console.log('=== 工具类检查 ===');
console.log(`定义: ${definitions.length}；TS 引用: ${references.size} 个类 / ${totalUsage} 次`);

let failed = false;
if (suffixed.length > 0) {
    console.error(`❌ 出现重名后缀工具类（不允许）: ${suffixed.slice(0, 10).join(', ')}`);
    failed = true;
}
if (undefinedRefs.length > 0) {
    console.error(`❌ 引用了未定义的工具类: ${undefinedRefs.slice(0, 10).join(', ')}`);
    failed = true;
}
if (process.argv.includes('--update-baseline')) {
    updateBaseline();
} else {
    if (definitions.length > baseline.definitions) {
        console.error(`❌ 工具类定义增长: ${definitions.length} > 基线 ${baseline.definitions}（只允许下降）`);
        failed = true;
    }
    if (totalUsage > baseline.usage) {
        console.error(`❌ 工具类使用量增长: ${totalUsage} > 基线 ${baseline.usage}（只允许下降）`);
        failed = true;
    }
    if (definitions.length < baseline.definitions || totalUsage < baseline.usage) {
        console.log(`ℹ️ 低于基线（定义 ${definitions.length}/${baseline.definitions}，使用 ${totalUsage}/${baseline.usage}），建议 --update-baseline 收紧`);
    }
}

if (failed) {
    console.error('\n=== 检查失败 ===');
    process.exit(1);
}
console.log('✅ 工具类体系检查通过');
