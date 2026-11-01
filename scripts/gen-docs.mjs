#!/usr/bin/env node
/**
 * gen-docs.mjs — 生成 docs/generated/*（代码索引、门禁表、注释覆盖）
 *
 * 生成物禁止手改；CI/`preflight` 用 `--check` 对比，漂移即失败。
 *
 * 用法：
 *   node scripts/gen-docs.mjs            # 写入
 *   node scripts/gen-docs.mjs --check    # 只校验
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'docs/generated');
const CHECK = process.argv.includes('--check');

const SOURCE_DIRS = ['engine', 'services', 'shared', 'core', 'domains', 'ui'];
const SKIP_FILES = new Set([
    'shared/template-scaffold-assets.generated.ts',
]);
const SKIP_DIRS = new Set(['node_modules', '.git', 'coverage', 'tests', 'scripts']);

const SCRIPT_DESCRIPTIONS = {
    'version:sync': '同步 package.json 版本到 manifest.json 与 versions.json',
    'gen:templates': '把 assets/template-scaffold 嵌入 shared/template-scaffold-assets.generated.ts',
    'check:templates': '校验模板生成物与 assets 一致',
    'check:release': '发布资产/版本/tag/worker/模板嵌入一致性校验',
    'build': '版本同步 + 模板生成 + CSS 拼接 + esbuild 打包',
    'build:release': '本地发布构建（preflight:release）',
    'preflight': '本地总门禁',
    'preflight:release': '发布前门禁：preflight + 覆盖率',
    'dev': 'watch 构建',
    'build:styles': '拼接 styles-src → styles.css',
    'check:styles': '校验 styles.css 与 styles-src 一致',
    'typecheck': 'tsc --noEmit',
    'test': 'Vitest 全量（单元 + 集成）',
    'test:cov': 'Vitest + 覆盖率门禁',
    'test:e2e': 'Playwright（含 Electron 真实链路）',
    'test:e2e:ui': 'Playwright UI 模式',
    'test:e2e:headed': 'Playwright 有头模式',
    'test:e2e:report': '查看 Playwright 报告',
    'check-engines': 'EngineRegistry 实例白名单/超限检查',
    'check:deps': '分层依赖与循环依赖（棘轮）',
    'check:css': 'CSS 预算与命名棘轮',
    'check:inline-styles': '内联样式基线棘轮',
    'css:baseline': '更新 CSS 基线',
    'inline:baseline': '更新内联样式基线',
    'eval:fingerprint': '指纹检索评估',
    'eval:rag': 'RAG 检索评估',
    'sample:human': '真人样文抽样',
    'eval:humanness': '人味基准评估',
    'css:cleanup': 'CSS 清理审计',
    'css:stats': 'CSS 统计',
    'audit:deps': '生产依赖安全审计',
    'lint': 'ESLint（obsidianmd 推荐规则）',
    'eval:quality': '质量基准评估',
    'eval:cowrite-local': '本地协同评估',
    'program:render': '渲染专项进度报告',
    'check:program': '校验进度报告与台账一致',
    'check:relationship-authority': '关系数据权威源契约检查',
    'check:silent-failures': '用户操作型静默失败检查',
    'check:hotpaths': '热路径全库扫描检查',
    'check:linked-scenarios': '联动场景文档锚点检查',
    'check:dsh-isolation': 'dsh 后端隔离检查',
    'check:jsdoc': '注释覆盖率（棘轮）',
    'check:docs': '文档索引/链接/版本/编码检查',
    'gen:docs': '生成 docs/generated/*',
    'bench:hotpath': 'getFiles 热路径基准',
};

function walk(dir, out = []) {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        const rel = path.relative(ROOT, full).split(path.sep).join('/');
        if (entry.isDirectory()) {
            if (SKIP_DIRS.has(entry.name)) continue;
            walk(full, out);
        } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
            if (SKIP_FILES.has(rel)) continue;
            out.push(rel);
        }
    }
    return out;
}

const EXPORT_RE = /^export\s+(?:default\s+)?(?:async\s+)?(?:class|interface|type|function|const|let|var|enum)\s+/;

function countExports(source) {
    let total = 0;
    let documented = 0;
    const lines = source.split('\n');
    for (let i = 0; i < lines.length; i++) {
        if (!EXPORT_RE.test(lines[i])) continue;
        total++;
        if (hasJsDocAbove(lines, i)) documented++;
    }
    return { total, documented };
}

function hasJsDocAbove(lines, index) {
    let seen = 0;
    for (let i = index - 1; i >= 0 && seen < 40; i--) {
        const line = lines[i].trim();
        if (!line) continue;
        seen++;
        if (line.startsWith('*/')) {
            for (let j = i; j >= 0 && i - j < 60; j--) {
                if (lines[j].trim().startsWith('/**')) return true;
            }
            return false;
        }
        if (line.startsWith('//') || line.startsWith('@')) continue;
        if (line.startsWith('/*')) return false;
        return false;
    }
    return false;
}

function layerOf(rel) {
    return rel.split('/')[0];
}

function renderCodeIndex(files) {
    const rows = files.map((rel) => {
        const source = fs.readFileSync(path.join(ROOT, rel), 'utf8');
        const lines = source.split('\n').length;
        const { total, documented } = countExports(source);
        return { rel, layer: layerOf(rel), lines, total, documented };
    }).sort((a, b) => a.rel.localeCompare(b.rel, 'en'));

    const byLayer = new Map();
    for (const row of rows) {
        const entry = byLayer.get(row.layer) ?? { files: 0, lines: 0, exports: 0, documented: 0 };
        entry.files += 1;
        entry.lines += row.lines;
        entry.exports += row.total;
        entry.documented += row.documented;
        byLayer.set(row.layer, entry);
    }

    const out = [];
    out.push('# 代码索引（生成物）');
    out.push('');
    out.push('> 由 `npm run gen:docs` 生成，禁止手改。行数与导出数为静态统计，仅用于导航与趋势。');
    out.push('');
    out.push('## 分层总览');
    out.push('');
    out.push('| 层 | 文件数 | 行数 | 导出声明 | 有 JSDoc | 覆盖率 |');
    out.push('|---|---:|---:|---:|---:|---:|');
    for (const layer of SOURCE_DIRS) {
        const e = byLayer.get(layer);
        if (!e) continue;
        const pct = e.exports > 0 ? Math.round((e.documented / e.exports) * 100) : 100;
        out.push(`| \`${layer}/\` | ${e.files} | ${e.lines} | ${e.exports} | ${e.documented} | ${pct}% |`);
    }
    out.push('');
    out.push('## 文件清单');
    out.push('');
    out.push('| 文件 | 行数 | 导出 | 有 JSDoc |');
    out.push('|---|---:|---:|---:|');
    for (const row of rows) {
        out.push(`| \`${row.rel}\` | ${row.lines} | ${row.total} | ${row.documented} |`);
    }
    out.push('');
    return out.join('\n');
}

function renderGates(pkg) {
    const scripts = pkg.scripts ?? {};
    const out = [];
    out.push('# 门禁与脚本（生成物）');
    out.push('');
    out.push('> 由 `npm run gen:docs` 从 `package.json` 生成，禁止手改。');
    out.push('');
    out.push('## 脚本表');
    out.push('');
    out.push('| 命令 | 说明 |');
    out.push('|---|---|');
    for (const key of Object.keys(scripts).sort((a, b) => a.localeCompare(b, 'en'))) {
        out.push(`| \`npm run ${key}\` | ${SCRIPT_DESCRIPTIONS[key] ?? '—'} |`);
    }
    out.push('');
    out.push('## preflight 展开');
    out.push('');
    const preflight = String(scripts.preflight ?? '');
    const steps = preflight.split('&&').map((s) => s.trim()).filter(Boolean);
    out.push('```text');
    steps.forEach((step, i) => out.push(`${String(i + 1).padStart(2, '0')}. ${step}`));
    out.push('```');
    out.push('');
    out.push('## 说明');
    out.push('');
    out.push('- `npm test` 是 npm 内置脚本调用，等价于 `npm run test`。');
    out.push('- `preflight` 不含覆盖率；发布前用 `preflight:release`。');
    out.push('');
    return out.join('\n');
}

function writeOrCheck(rel, content) {
    const full = path.join(ROOT, rel);
    const prev = fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null;
    if (CHECK) {
        if (prev !== content) {
            console.error(`[gen-docs] ❌ 生成物已漂移：${rel}（运行 npm run gen:docs）`);
            process.exitCode = 1;
        }
        return;
    }
    fs.mkdirSync(path.dirname(full), { recursive: true });
    if (prev !== content) fs.writeFileSync(full, content, 'utf8');
}

function main() {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const files = SOURCE_DIRS.flatMap((dir) => walk(path.join(ROOT, dir)));
    writeOrCheck('docs/generated/code-index.md', renderCodeIndex(files));
    writeOrCheck('docs/generated/gates.md', renderGates(pkg));
    if (CHECK) {
        console.log('[gen-docs] 生成物一致性检查完成');
    } else {
        console.log(`[gen-docs] 已生成 ${path.relative(ROOT, OUT_DIR)}（${files.length} 个源码文件）`);
    }
}

main();
