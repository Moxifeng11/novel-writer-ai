#!/usr/bin/env node
/**
 * check-i18n.mjs — 文案体系门禁（缺口 ⑦ 第一期，2026-11-18）
 *
 * 背景：插件界面文案此前全部硬编码中文（2004 个 TS 文件含 CJK），无法出英文版。
 * 第一期只做「骨架」：`t()` + 中英两份资源 + 语言设置。本脚本负责三件事，
 * 保证骨架不会被顺手绕开：
 *
 *   A. 资源一致性：zh-CN 与 en-US 的键集合双向相等、占位符逐键相等、文案非空。
 *   B. 键可解析：源码里 `t('字面量')` / `translate('en-US','字面量')` 引用的键，
 *      必须真的在 zh-CN 资源里（拼错键不会在运行时炸，只会露出键名，所以必须静态查）。
 *   C. UI 层中文棘轮：`ui/**` 里「含中文的字符串字面量」按文件计数，只许降不许升。
 *      新增界面文案要么走 `t()`，要么在 PR 里显式 `--update-baseline` 说明原因。
 *
 * 用法：
 *   node scripts/check-i18n.mjs                    # 门禁
 *   node scripts/check-i18n.mjs --update-baseline --note="Slice X 迁移了 N 条"
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_FILE = join(ROOT, '.i18n-baseline.json');
const ZH_FILE = join(ROOT, 'i18n', 'messages', 'zh-CN.ts');
const EN_FILE = join(ROOT, 'i18n', 'messages', 'en-US.ts');
/** 棘轮只盯界面层；engine/ 与 shared/ 里有大量素材/规则语料，迁到资源里没有意义 */
const RATCHET_DIRS = ['ui'];
/** 全文扫描 t() 引用的目录（测试里会有故意拼错的键，排除） */
const KEY_SCAN_DIRS = ['ui', 'engine', 'services', 'shared', 'core', 'domains', 'utils', 'i18n'];
const CJK = /[\u4e00-\u9fff]/;

/** 递归收集 .ts（不含 .d.ts） */
function collectTs(dir, out = []) {
    if (!existsSync(dir)) return out;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name === '__mocks__') continue;
            collectTs(full, out);
        } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
            out.push(full);
        }
    }
    return out;
}

/**
 * 把资源模块转成可求值的函数。
 *
 * 资源文件是纯数据（只带 `import type`），用 TS 编译器降级成 CommonJS 后直接执行，
 * 避免 node 对 .ts 的实验性支持在不同版本上行为不一致。
 */
function loadCatalog(file) {
    const source = readFileSync(file, 'utf8');
    const { outputText } = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
        fileName: file,
    });
    const module = { exports: {} };
    // eslint-disable-next-line no-new-func -- 需要执行资源里的 JS 表达式来解析动态键，输入来自本仓资源文件
    new Function('exports', 'module', outputText)(module.exports, module);
    const exported = Object.values(module.exports);
    const tree = exported.find(value => value && typeof value === 'object');
    if (!tree) throw new Error('资源模块没有导出对象：' + file);
    return tree;
}

const rel = file => relative(ROOT, file).split(sep).join('/');

/** 拍平成「点分键 → 文案」 */
function flatten(tree, prefix = '', out = {}) {
    for (const [key, value] of Object.entries(tree)) {
        const path = prefix ? prefix + '.' + key : key;
        if (typeof value === 'string') out[path] = value;
        else flatten(value, path, out);
    }
    return out;
}

const placeholders = template => Array.from(template.matchAll(/\{(\w+)\}/g), m => m[1]).sort();

const zh = flatten(loadCatalog(ZH_FILE));
const en = flatten(loadCatalog(EN_FILE));
const zhKeys = Object.keys(zh);
const enKeys = Object.keys(en);

console.log('=== 文案检查 ===');
console.log(`资源: zh-CN ${zhKeys.length} 条 / en-US ${enKeys.length} 条`);

let failed = false;

// ---------- A. 资源一致性 ----------
const missingInEn = zhKeys.filter(key => !(key in en));
const extraInEn = enKeys.filter(key => !(key in zh));
const emptyCopy = [...zhKeys, ...enKeys].filter(key => !String((key in zh ? zh : en)[key] ?? '').trim());
const placeholderMismatch = zhKeys
    .filter(key => key in en)
    .filter(key => placeholders(zh[key]).join(',') !== placeholders(en[key]).join(','));

if (missingInEn.length) {
    console.error('❌ en-US 缺键: ' + missingInEn.slice(0, 10).join(', '));
    failed = true;
}
if (extraInEn.length) {
    console.error('❌ en-US 多出中文没有的键: ' + extraInEn.slice(0, 10).join(', '));
    failed = true;
}
if (emptyCopy.length) {
    console.error('❌ 存在空文案: ' + emptyCopy.slice(0, 10).join(', '));
    failed = true;
}
if (placeholderMismatch.length) {
    console.error('❌ 占位符不一致: ' + placeholderMismatch.slice(0, 10).join(', '));
    failed = true;
}

// ---------- B. t() / translate() 引用的键必须存在 ----------
const keyFiles = KEY_SCAN_DIRS.flatMap(dir => collectTs(join(ROOT, dir)));
const unknownKeys = [];
const dynamicKeys = [];
for (const file of keyFiles) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/\bt\(\s*(['"`])([^'"`$]*)\1/g)) {
        const key = match[2];
        if (!key.includes('.')) continue;
        if (!(key in zh)) unknownKeys.push(rel(file) + ' → ' + key);
    }
    for (const match of text.matchAll(/\btranslate\(\s*['"](?:zh-CN|en-US)['"]\s*,\s*(['"`])([^'"`$]*)\1/g)) {
        if (!(match[2] in zh)) unknownKeys.push(rel(file) + ' → ' + match[2]);
    }
    if (!rel(file).startsWith('i18n/') && /\bt\(\s*[^`'")\s]/.test(text)) dynamicKeys.push(rel(file));
}
console.log(`键引用: 扫描 ${keyFiles.length} 个文件，无法解析的键 ${unknownKeys.length} 个，动态键调用 ${dynamicKeys.length} 处`);

if (unknownKeys.length) {
    console.error('❌ t() 引用了资源里不存在的键:');
    for (const row of unknownKeys.slice(0, 20)) console.error('   ' + row);
    failed = true;
}
if (dynamicKeys.length) {
    // 动态键无法静态校验：只提示，不拦（`t(prefix + '.x')` 这类写法要靠两边同时改）
    console.warn('⚠️  存在非字面量键的 t() 调用（无法静态校验）: ' + dynamicKeys.slice(0, 10).join(', '));
}

// ---------- C. UI 层中文棘轮 ----------
const cjkCount = new Map();
for (const file of RATCHET_DIRS.flatMap(dir => collectTs(join(ROOT, dir)))) {
    const source = readFileSync(file, 'utf8');
    if (!CJK.test(source)) continue;
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    let count = 0;
    const visit = node => {
        if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
            if (CJK.test(node.text)) count += 1;
        } else if (ts.isTemplateExpression(node)) {
            if (CJK.test(node.head.text)) count += 1;
            for (const span of node.templateSpans) if (CJK.test(span.literal.text)) count += 1;
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    if (count > 0) cjkCount.set(rel(file), count);
}

const totalCjk = [...cjkCount.values()].reduce((sum, n) => sum + n, 0);
// 首次运行没有基线：以当前状态为基线放行（跑 --update-baseline 落盘后再收紧）
const hasBaseline = existsSync(BASELINE_FILE);
const baseline = hasBaseline
    ? JSON.parse(readFileSync(BASELINE_FILE, 'utf8'))
    : { files: Object.fromEntries(cjkCount), total: totalCjk, note: '初始基线（未落盘）' };
const baselineFiles = baseline.files ?? {};
if (!hasBaseline) {
    console.log('ℹ️  尚无 .i18n-baseline.json，本次以当前状态为基线；建议跑 --update-baseline 落盘');
}

const regressions = [];
for (const [file, count] of cjkCount) {
    const allowed = baselineFiles[file] ?? 0;
    if (count > allowed) regressions.push(`${file}: ${allowed} → ${count}`);
}
const removed = Object.keys(baselineFiles).filter(file => !cjkCount.has(file));
const shrunk = Object.keys(baselineFiles).filter(file =>
    cjkCount.has(file) && cjkCount.get(file) < baselineFiles[file]);

console.log(`UI 中文棘轮: ${cjkCount.size} 个文件 / ${totalCjk} 条字面量（基线 ${Object.keys(baselineFiles).length} 个文件 / ${baseline.total ?? '?'} 条）`);

if (regressions.length) {
    console.error(`❌ UI 层中文文案增加（改用 t() 从资源取文案）: ${regressions.length} 处`);
    for (const row of regressions.slice(0, 20)) console.error('   ' + row);
    failed = true;
}
if (shrunk.length) console.log(`📉 已下降（可 --update-baseline 收紧基线）: ${shrunk.length} 个文件`);
if (removed.length) console.log(`🗑  已无中文（基线可移除）: ${removed.length} 个文件`);

// ---------- 基线 ----------
if (process.argv.includes('--update-baseline')) {
    if (failed && !process.argv.includes('--force')) {
        console.error('❌ 基线更新前请先修掉上面的失败项（或加 --force 明确覆盖）');
        process.exit(1);
    }
    const sorted = Object.fromEntries([...cjkCount.entries()].sort((a, b) => a[0].localeCompare(b[0])));
    writeFileSync(BASELINE_FILE, JSON.stringify({
        files: sorted,
        total: totalCjk,
        updatedAt: new Date().toISOString().slice(0, 10),
        note: process.argv.find(arg => arg.startsWith('--note='))?.slice(7) ?? '',
    }, null, 2) + '\n', 'utf8');
    console.log(`✅ 已写入基线: .i18n-baseline.json（${cjkCount.size} 个文件 / ${totalCjk} 条）`);
}

if (failed) {
    console.error('❌ 文案检查未通过');
    process.exit(1);
}
console.log('✅ 文案检查通过');
