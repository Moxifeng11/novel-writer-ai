#!/usr/bin/env node
/**
 * check-dsh-isolation.mjs — dsh 可选后端的隔离门禁（D）
 *
 * 约束：
 *  1. `child_process` 只允许出现在 engine/agent/dsh/**；
 *  2. 该目录只能动态 import（`import('node:child_process')`），
 *     不能顶层 import —— 保证默认 native 路径与移动端完全不加载 Node 能力；
 *  3. dsh 目录不得被 engine/agent/harness/** 反向依赖（否则 native 也进了风险面）。
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DSH_DIR = path.join(ROOT, 'engine/agent/dsh');
const ALLOWED = [
    DSH_DIR,
    path.join(ROOT, 'shared/desktop-shell.ts'),
];
const CHILD_PROCESS_RE = /(?:from\s+['"](?:node:)?child_process['"]|require\(\s*['"](?:node:)?child_process['"]\s*\)|import\(\s*['"](?:node:)?child_process['"]\s*\))/;
const TOP_LEVEL_IMPORT_RE = /^import\s[^\n]*from\s+['"](?:node:)?child_process['"]/m;

function isAllowed(file) {
    return ALLOWED.some((entry) => file === entry || file.startsWith(entry + path.sep));
}

/** 注释里出现的 `require('child_process')` 是说明文字，不是真实依赖 */
function stripComments(source) {
    return String(source)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
}

function walk(dir, files = []) {
    if (!fs.existsSync(dir)) return files;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, files);
        else if (entry.name.endsWith('.ts')) files.push(full);
    }
    return files;
}

const problems = [];

// 1) child_process 只允许在显式例外目录/文件
for (const dir of ['engine', 'services', 'ui', 'core', 'shared', 'domains', 'utils']) {
    for (const file of walk(path.join(ROOT, dir))) {
        if (isAllowed(file)) continue;
        const source = stripComments(fs.readFileSync(file, 'utf8'));
        if (CHILD_PROCESS_RE.test(source)) {
            problems.push(`${path.relative(ROOT, file)} 引用了 child_process（只允许 engine/agent/dsh/** 与 shared/desktop-shell.ts）`);
        }
    }
}
// 根级入口也要扫（此前只扫目录，main.ts 是漏网区）
for (const rel of ['main.ts', 'plugin-api.ts']) {
    const file = path.join(ROOT, rel);
    if (!fs.existsSync(file)) continue;
    const source = stripComments(fs.readFileSync(file, 'utf8'));
    if (CHILD_PROCESS_RE.test(source)) {
        problems.push(`${rel} 引用了 child_process（只允许 engine/agent/dsh/** 与 shared/desktop-shell.ts）`);
    }
}

// 2) 例外文件内部必须动态 import（不允许顶层 import）
for (const dir of ['engine/agent/dsh']) {
    for (const file of walk(path.join(ROOT, dir))) {
        const source = fs.readFileSync(file, 'utf8');
        if (TOP_LEVEL_IMPORT_RE.test(source)) {
            problems.push(`${path.relative(ROOT, file)} 顶层 import 了 child_process，必须改成动态 import`);
        }
    }
}
{
    const file = path.join(ROOT, 'shared/desktop-shell.ts');
    if (fs.existsSync(file)) {
        const source = fs.readFileSync(file, 'utf8');
        if (TOP_LEVEL_IMPORT_RE.test(source)) {
            problems.push('shared/desktop-shell.ts 顶层 import 了 child_process，必须改成动态 import');
        }
    }
}

// 3) native harness 不得反向依赖 dsh
for (const file of walk(path.join(ROOT, 'engine/agent/harness'))) {
    const source = fs.readFileSync(file, 'utf8');
    if (/from ['"].*agent\/dsh|from ['"]\.\.\/dsh/.test(source)) {
        problems.push(`${path.relative(ROOT, file)} 反向依赖 dsh（native 必须零依赖）`);
    }
}

if (problems.length > 0) {
    console.error('❌ dsh 隔离检查失败：');
    for (const item of problems) console.error(`  - ${item}`);
    process.exit(1);
}

console.log('✅ dsh 隔离检查通过（child_process 仅限 engine/agent/dsh 与 shared/desktop-shell，且动态加载）');
