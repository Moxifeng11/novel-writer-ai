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

// 1) child_process 只允许在 dsh 目录
for (const dir of ['engine', 'services', 'ui', 'core', 'shared', 'domains']) {
    for (const file of walk(path.join(ROOT, dir))) {
        if (file.startsWith(DSH_DIR)) continue;
        const source = fs.readFileSync(file, 'utf8');
        if (/from ['"]node:child_process['"]|require\(['"]node:child_process['"]\)/.test(source)) {
            problems.push(`${path.relative(ROOT, file)} 引用了 child_process（只允许 engine/agent/dsh/**）`);
        }
    }
}

// 2) dsh 目录内部必须动态 import
for (const file of walk(DSH_DIR)) {
    const source = fs.readFileSync(file, 'utf8');
    if (/^import\s[^\n]*from ['"]node:child_process['"]/m.test(source)) {
        problems.push(`${path.relative(ROOT, file)} 顶层 import 了 child_process，必须改成动态 import`);
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

console.log('✅ dsh 隔离检查通过（child_process 仅限 engine/agent/dsh 且动态加载）');
