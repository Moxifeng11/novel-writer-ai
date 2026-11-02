#!/usr/bin/env node
/**
 * check-jsdoc.mjs — 注释覆盖率门禁（棘轮）
 *
 * 统计：
 *  - 导出声明（class/interface/type/function/const/let/var/enum）是否有紧邻 JSDoc
 *  - 类的公开方法是否有 JSDoc
 *  - 已注释函数的 @param 覆盖与 @returns（非 void）
 *
 * 棘轮：
 *  - 每个文件的「已注释数」不得下降
 *  - 每个文件的「未注释数」不得上升（新导出必须带注释）
 *  - 「已注释但不完整」数不得上升
 *  - 基线缺失时失败（用 --update-baseline 初始化）
 *
 * 用法：
 *   node scripts/check-jsdoc.mjs
 *   node scripts/check-jsdoc.mjs --update-baseline
 *   node scripts/check-jsdoc.mjs            # 同时刷新 docs/generated/jsdoc-coverage.md
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_PATH = path.join(ROOT, '.jsdoc-baseline.json');
const REPORT_PATH = path.join(ROOT, 'docs/generated/jsdoc-coverage.md');
const DIRS = ['engine', 'services', 'shared', 'core', 'domains', 'ui'];
const SKIP_FILES = new Set(['shared/template-scaffold-assets.generated.ts']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'coverage', 'tests', 'scripts']);

const UPDATE = process.argv.includes('--update-baseline') || process.argv.includes('--init');
const REPORT = !process.argv.includes('--no-report');
// 诊断用：列出每个文件仍未注释的符号名，便于分批补注释（不影响门禁结果）。
const LIST_MISSING = process.argv.includes('--list-missing');

function walk(dir, out = []) {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (!SKIP_DIRS.has(entry.name)) walk(full, out);
        } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
            const rel = path.relative(ROOT, full).split(path.sep).join('/');
            if (!SKIP_FILES.has(rel)) out.push(rel);
        }
    }
    return out;
}

function hasModifier(node, kind) {
    return Boolean(node.modifiers?.some((modifier) => modifier.kind === kind));
}

function isExported(node) {
    return hasModifier(node, ts.SyntaxKind.ExportKeyword) || hasModifier(node, ts.SyntaxKind.DefaultKeyword);
}

function lastJsDoc(node) {
    const docs = node.jsDoc;
    return Array.isArray(docs) && docs.length > 0 ? docs[docs.length - 1] : null;
}

function tagCount(doc, name) {
    return (doc?.tags ?? []).filter((tag) => tag.tagName?.text === name).length;
}

function hasDescription(doc) {
    const comment = doc?.comment;
    if (typeof comment === 'string') return comment.trim().length > 0;
    if (Array.isArray(comment)) return comment.some((part) => String(part.text ?? '').trim().length > 0);
    return false;
}

function collectParams(node) {
    if (!node.parameters) return null;
    const names = [];
    for (const param of node.parameters) {
        if (!ts.isIdentifier(param.name)) return null; // 解构等复杂参数不强制
        names.push(param.name.text);
    }
    return names;
}

function isVoidReturn(node) {
    const text = node.type ? node.type.getText() : '';
    if (!text) return true; // 未标注返回类型时不强制 @returns
    return /\bvoid\b/.test(text);
}

function isIncomplete(node, doc) {
    if (!doc) return false;
    if (!hasDescription(doc)) return true;
    if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) {
        const params = collectParams(node);
        if (params && params.length > 0) {
            const documented = (doc.tags ?? [])
                .filter((tag) => tag.tagName?.text === 'param')
                .map((tag) => String(tag.name?.getText?.() ?? tag.name ?? '').replace(/^\[|\]$/g, '').split(/[=.]/)[0]);
            if (params.some((name) => !documented.includes(name))) return true;
        }
        if (!isVoidReturn(node) && tagCount(doc, 'returns') === 0) return true;
    }
    return false;
}

function inspectFile(rel) {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const source = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const stats = {
        exports: 0,
        documented: 0,
        methods: 0,
        methodsDocumented: 0,
        incomplete: 0,
        missingExports: [],
        missingMethods: [],
        incompleteNames: [],
    };

    const visit = (node) => {
        if (isExported(node) && (
            ts.isClassDeclaration(node)
            || ts.isInterfaceDeclaration(node)
            || ts.isTypeAliasDeclaration(node)
            || ts.isFunctionDeclaration(node)
            || ts.isEnumDeclaration(node)
            || ts.isVariableStatement(node)
        )) {
            stats.exports++;
            const doc = lastJsDoc(node);
            if (doc) {
                stats.documented++;
                if (isIncomplete(node, doc)) {
                    stats.incomplete++;
                    const n = ts.isVariableStatement(node)
                        ? node.declarationList.declarations[0]?.name?.getText?.() ?? ''
                        : node.name?.getText?.() ?? '';
                    if (n) stats.incompleteNames.push('E:' + n);
                }
            } else {
                const name = ts.isVariableStatement(node)
                    ? node.declarationList.declarations[0]?.name?.getText?.() ?? ''
                    : node.name?.getText?.() ?? '';
                if (name) stats.missingExports.push(name);
            }
        }

        if (ts.isClassDeclaration(node) && isExported(node)) {
            for (const member of node.members) {
                if (!ts.isMethodDeclaration(member)) continue;
                if (hasModifier(member, ts.SyntaxKind.PrivateKeyword)) continue;
                if (hasModifier(member, ts.SyntaxKind.ProtectedKeyword)) continue;
                const name = member.name?.getText?.() ?? '';
                if (!name || name.startsWith('#')) continue;
                stats.methods++;
                const doc = lastJsDoc(member);
                if (doc) {
                    stats.methodsDocumented++;
                    if (isIncomplete(member, doc)) {
                        stats.incomplete++;
                        stats.incompleteNames.push('M:' + name);
                    }
                } else {
                    stats.missingMethods.push(name);
                }
            }
        }

        ts.forEachChild(node, visit);
    };

    visit(source);
    return stats;
}

function layerOf(rel) {
    return rel.split('/')[0];
}

function loadBaseline() {
    if (!fs.existsSync(BASELINE_PATH)) return null;
    try {
        return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
    } catch (error) {
        console.error(`[jsdoc] 基线解析失败：${error instanceof Error ? error.message : String(error)}`);
        process.exit(2);
    }
}

function summarize(files) {
    const layers = {};
    for (const [rel, stats] of Object.entries(files)) {
        const layer = layerOf(rel);
        const entry = layers[layer] ?? { files: 0, exports: 0, documented: 0, methods: 0, methodsDocumented: 0, incomplete: 0 };
        entry.files++;
        entry.exports += stats.exports;
        entry.documented += stats.documented;
        entry.methods += stats.methods;
        entry.methodsDocumented += stats.methodsDocumented;
        entry.incomplete += stats.incomplete;
        layers[layer] = entry;
    }
    return layers;
}

function renderReport(layers, files) {
    const out = [];
    out.push('# JSDoc 覆盖率（生成物）');
    out.push('');
    out.push('> 由 `npm run check:jsdoc -- --report` 生成，禁止手改。');
    out.push('');
    out.push('| 层 | 文件 | 导出 | 已注释 | 导出覆盖 | 公开方法 | 已注释 | 方法覆盖 | 不完整 |');
    out.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|');
    for (const [layer, e] of Object.entries(layers).sort((a, b) => a[0].localeCompare(b[0], 'en'))) {
        const ep = e.exports ? Math.round((e.documented / e.exports) * 100) : 100;
        const mp = e.methods ? Math.round((e.methodsDocumented / e.methods) * 100) : 100;
        out.push(`| \`${layer}/\` | ${e.files} | ${e.exports} | ${e.documented} | ${ep}% | ${e.methods} | ${e.methodsDocumented} | ${mp}% | ${e.incomplete} |`);
    }
    out.push('');
    out.push('## 缺口最大的文件（按未注释导出数）');
    out.push('');
    out.push('| 文件 | 导出 | 未注释 | 公开方法 | 未注释 |');
    out.push('|---|---:|---:|---:|---:|');
    const rows = Object.entries(files)
        .map(([rel, s]) => ({ rel, missing: (s.exports - s.documented) + (s.methods - s.methodsDocumented), ...s }))
        .sort((a, b) => b.missing - a.missing)
        .slice(0, 30);
    for (const row of rows) {
        out.push(`| \`${row.rel}\` | ${row.exports} | ${row.exports - row.documented} | ${row.methods} | ${row.methods - row.methodsDocumented} |`);
    }
    out.push('');
    return out.join('\n');
}

function main() {
    const rels = DIRS.flatMap((dir) => walk(path.join(ROOT, dir)));
    const files = {};
    for (const rel of rels) {
        const stats = inspectFile(rel);
        if (stats.exports > 0 || stats.methods > 0) files[rel] = stats;
    }
    const layers = summarize(files);

    if (LIST_MISSING) {
        for (const [rel, stats] of Object.entries(files).sort((a, b) => a[0].localeCompare(b[0], 'en'))) {
            if (stats.missingExports.length === 0 && stats.missingMethods.length === 0 && stats.incompleteNames.length === 0) continue;
            console.log(`${rel}\n  E:${stats.missingExports.join(',')}\n  M:${stats.missingMethods.join(',')}\n  I:${stats.incompleteNames.join(',')}`);
        }
    }

    if (UPDATE) {
        const baselineFiles = {};
        for (const [rel, stats] of Object.entries(files)) {
            baselineFiles[rel] = {
                exports: stats.exports,
                documented: stats.documented,
                methods: stats.methods,
                methodsDocumented: stats.methodsDocumented,
                incomplete: stats.incomplete,
            };
        }
        const payload = {
            generatedAt: new Date().toISOString(),
            note: '棘轮基线：已注释数不得下降、未注释数不得上升；只在覆盖率上升后 --update-baseline。',
            layers,
            files: baselineFiles,
        };
        fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
        console.log(`[jsdoc] 已写入基线：${path.relative(ROOT, BASELINE_PATH)}（${Object.keys(files).length} 个文件）`);
    }

    if (REPORT) {
        fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
        fs.writeFileSync(REPORT_PATH, renderReport(layers, files), 'utf8');
        console.log(`[jsdoc] 已生成 ${path.relative(ROOT, REPORT_PATH)}`);
    }

    const baseline = loadBaseline();
    if (!baseline || !baseline.files) {
        console.error('[jsdoc] ❌ 缺少 .jsdoc-baseline.json；首次请运行 npm run check:jsdoc -- --update-baseline');
        process.exit(2);
    }

    const problems = [];
    for (const [rel, stats] of Object.entries(files)) {
        const base = baseline.files[rel] ?? { exports: 0, documented: 0, methods: 0, methodsDocumented: 0, incomplete: 0 };
        const undocumented = stats.exports - stats.documented;
        const baseUndocumented = base.exports - base.documented;
        const methodsMissing = stats.methods - stats.methodsDocumented;
        const baseMethodsMissing = base.methods - base.methodsDocumented;
        if (stats.documented < base.documented) {
            problems.push(`${rel}: 已注释导出从 ${base.documented} 降到 ${stats.documented}`);
        }
        if (undocumented > baseUndocumented) {
            problems.push(`${rel}: 未注释导出从 ${baseUndocumented} 增到 ${undocumented}（新导出必须补 JSDoc）`);
        }
        if (stats.methodsDocumented < base.methodsDocumented) {
            problems.push(`${rel}: 已注释公开方法从 ${base.methodsDocumented} 降到 ${stats.methodsDocumented}`);
        }
        if (methodsMissing > baseMethodsMissing) {
            problems.push(`${rel}: 未注释公开方法从 ${baseMethodsMissing} 增到 ${methodsMissing}`);
        }
        if (stats.incomplete > base.incomplete) {
            problems.push(`${rel}: 不完整 JSDoc 从 ${base.incomplete} 增到 ${stats.incomplete}（缺 @param/@returns/描述）`);
        }
    }

    const totalExports = Object.values(layers).reduce((sum, e) => sum + e.exports, 0);
    const totalDocumented = Object.values(layers).reduce((sum, e) => sum + e.documented, 0);
    const pct = totalExports ? Math.round((totalDocumented / totalExports) * 100) : 100;

    if (problems.length > 0) {
        console.error(`❌ JSDoc 门禁失败（当前导出覆盖 ${pct}%）：`);
        for (const item of problems) console.error(`  - ${item}`);
        console.error('  仅在覆盖率上升后运行：npm run check:jsdoc -- --update-baseline');
        process.exit(1);
    }

    console.log(`✅ JSDoc 门禁通过（导出覆盖 ${pct}%，${Object.keys(files).length} 个文件）`);
}

main();
