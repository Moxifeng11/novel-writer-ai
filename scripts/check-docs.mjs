#!/usr/bin/env node
/**
 * check-docs.mjs — 文档门禁
 *
 * 校验：
 *  1. 版本戳与 package.json 一致（指定的活跃文档）
 *  2. 文档索引完整（handbook / adr / glossary / 发布模板）
 *  3. 相对链接可达（限定活跃文档，历史快照不查）
 *  4. 文档中出现的 `npm run <script>` 必须存在
 *  5. NUL / U+FFFD / 典型乱码
 *  6. docs/generated/* 与生成结果一致
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const VERSION = pkg.version;
const scripts = pkg.scripts ?? {};
const problems = [];

const VERSION_FILES = {
    'README.md': /\*\*当前版本\*\*：v?(\d+\.\d+\.\d+)/,
    'docs/README.md': /版本：v(\d+\.\d+\.\d+)/,
    'docs/ARCHITECTURE.md': /\*\*版本\*\*:\s*v?(\d+\.\d+\.\d+)/,
    'docs/DEVELOPMENT.md': /\*\*版本\*\*:\s*v?(\d+\.\d+\.\d+)/,
    'docs/API.md': /\*\*版本\*\*:\s*v?(\d+\.\d+\.\d+)/,
    'docs/PLAN.md': /版本：v(\d+\.\d+\.\d+)/,
    'docs/CODE-INDEX.md': /版本：v(\d+\.\d+\.\d+)/,
};

const LINK_SCOPE = [
    'README.md',
    'CONTRIBUTING.md',
    'docs/README.md',
    'docs/glossary.md',
    'docs/adr/README.md',
    ...listFiles(path.join(ROOT, 'docs/handbook'), '.md').map((p) => path.relative(ROOT, p).split(path.sep).join('/')),
];

function listFiles(dir, ext) {
    if (!fs.existsSync(dir)) return [];
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...listFiles(full, ext));
        else if (entry.name.endsWith(ext)) out.push(full);
    }
    return out;
}

function read(rel) {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

// 1) 版本戳
for (const [rel, pattern] of Object.entries(VERSION_FILES)) {
    if (!fs.existsSync(path.join(ROOT, rel))) {
        problems.push(`缺少活跃文档：${rel}`);
        continue;
    }
    const match = read(rel).match(pattern);
    if (!match) problems.push(`${rel} 未找到版本戳（期望格式匹配 ${pattern}）`);
    else if (match[1] !== VERSION) problems.push(`${rel} 版本戳 v${match[1]} ≠ package.json ${VERSION}`);
}

// 2) 索引完整
const docsIndex = read('docs/README.md');
for (const full of listFiles(path.join(ROOT, 'docs/handbook'), '.md')) {
    const rel = path.relative(path.join(ROOT, 'docs'), full).split(path.sep).join('/');
    if (!docsIndex.includes(rel)) problems.push(`docs/README.md 未登记手册：docs/${rel}`);
}
for (const full of listFiles(path.join(ROOT, 'docs/adr'), '.md')) {
    const name = path.basename(full);
    if (name === 'README.md') continue;
    if (!read('docs/adr/README.md').includes(name)) problems.push(`docs/adr/README.md 未登记：${name}`);
}
if (!docsIndex.includes('glossary.md')) problems.push('docs/README.md 未登记 glossary.md');
if (!docsIndex.includes('releases/TEMPLATE.md')) problems.push('docs/README.md 未登记 releases/TEMPLATE.md');

// 3) 链接可达
const LINK_RE = /\[[^\]]*\]\(([^)]+)\)/g;
for (const rel of LINK_SCOPE) {
    if (!fs.existsSync(path.join(ROOT, rel))) continue;
    const content = read(rel);
    let match;
    while ((match = LINK_RE.exec(content)) !== null) {
        const raw = match[1].trim();
        if (!raw || raw.startsWith('#') || /^(https?:|mailto:)/i.test(raw)) continue;
        const target = raw.split('#')[0].trim();
        if (!target) continue;
        const resolved = path.resolve(path.dirname(path.join(ROOT, rel)), target);
        if (!fs.existsSync(resolved)) problems.push(`${rel} 链接失效：${raw}`);
    }
}

// 4) npm run 命令存在
const CMD_RE = /npm run ([\w:.-]+)/g;
for (const rel of [...LINK_SCOPE, 'docs/handbook/06-gates-and-release.md']) {
    if (!fs.existsSync(path.join(ROOT, rel))) continue;
    const content = read(rel);
    let match;
    while ((match = CMD_RE.exec(content)) !== null) {
        const key = match[1];
        if (key.endsWith(':') && Object.keys(scripts).some((name) => name.startsWith(key))) continue;
        if (!(key in scripts)) problems.push(`${rel} 引用了不存在的脚本：npm run ${key}`);
    }
}

// 5) 编码
const MOJIBAKE = ['鏈枃', '鎻掍欢', '鎬ц兘', '浼樺寲', '鏂囨。'];
// 只查活跃文档；audits/_archive/analysis/design 是历史快照，编码问题不追溯
const ENCODING_SCOPE = [
    'README.md',
    'CONTRIBUTING.md',
    'tests/README.md',
    'tests/e2e/README.md',
    'docs/README.md',
    'docs/PLAN.md',
    'docs/PROGRAM.md',
    'docs/BASELINE.md',
    'docs/ARCHITECTURE.md',
    'docs/DEVELOPMENT.md',
    'docs/API.md',
    'docs/CODE-INDEX.md',
    'docs/PERFORMANCE.md',
    'docs/glossary.md',
    'docs/progress/PROGRAM-STATUS.md',
    'docs/releases/TEMPLATE.md',
    ...listFiles(path.join(ROOT, 'docs/handbook'), '.md'),
    ...listFiles(path.join(ROOT, 'docs/adr'), '.md'),
    ...listFiles(path.join(ROOT, 'docs/generated'), '.md'),
    ...listFiles(path.join(ROOT, 'docs/research'), '.md'),
];
for (const full of ENCODING_SCOPE) {
    const rel = path.relative(ROOT, full).split(path.sep).join('/');
    const content = fs.readFileSync(full, 'utf8');
    if (content.includes('\u0000')) problems.push(`${rel} 含 NUL 字节`);
    if (content.includes('\uFFFD')) problems.push(`${rel} 含 U+FFFD 替换字符`);
    for (const marker of MOJIBAKE) {
        if (content.includes(marker)) {
            problems.push(`${rel} 疑似编码损坏（命中「${marker}」）`);
            break;
        }
    }
}

// 6) 生成物漂移
try {
    execFileSync(process.execPath, [path.join(ROOT, 'scripts/gen-docs.mjs'), '--check'], {
        cwd: ROOT,
        stdio: 'pipe',
    });
} catch (error) {
    const out = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim();
    problems.push(`docs/generated/* 漂移，请运行 npm run gen:docs${out ? `（${out.split('\n')[0]}）` : ''}`);
}

if (problems.length > 0) {
    console.error('❌ 文档检查失败：');
    for (const item of problems) console.error(`  - ${item}`);
    process.exit(1);
}
console.log(`✅ 文档检查通过（版本 ${VERSION}，${LINK_SCOPE.length} 个活跃文档）`);
