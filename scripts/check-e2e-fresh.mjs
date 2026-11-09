#!/usr/bin/env node
/**
 * check-e2e-fresh.mjs — E2E 产物新鲜度门禁（C-9）
 *
 * E2E（tests/e2e）从插件根复制 main.js/styles.css 到临时 vault（obsidian-app.ts:75-81），
 * 此前只校验「存在」不校验「新鲜」——源码改了但忘记 npm run build 时，E2E 会静默
 * 跑在旧产物上，测的已经不是当前代码。本脚本比较产物 mtime 与源码最新 mtime，
 * 旧则 exit 1 并提示 npm run build。
 *
 * 接入：playwright.config.ts 的 globalSetup（覆盖 test:e2e / :ui / :headed 全部入口，
 * `--list` 不执行 globalSetup，CI verify 的 `playwright test --list` 零回归）。
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 产物 → 参与编译的源集合（tests/ 不是编译输入，不参与比较） */
const CHECKS = [
    { product: 'main.js', sources: ['main.ts'], dirs: ['engine', 'core', 'ui', 'services', 'domains', 'shared', 'utils', 'styles-src'] },
    { product: 'styles.css', sources: [], dirs: ['styles-src'] },
];

const SKIP_DIRS = new Set(['node_modules', '.git', 'coverage', 'tmp', '.obsidian', '.trae', '.zcode']);

function walk(dir, out = []) {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (!SKIP_DIRS.has(entry.name)) out.push(...walk(full));
        } else if (/\.(ts|tsx|css|mjs|js)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
            out.push(full);
        }
    }
    return out;
}

function newestMtime(files) {
    let newest = 0;
    let newestPath = '';
    for (const file of files) {
        if (!fs.existsSync(file)) continue;
        const mtime = fs.statSync(file).mtimeMs;
        if (mtime > newest) {
            newest = mtime;
            newestPath = file;
        }
    }
    return { newest, newestPath };
}

let stale = 0;
for (const check of CHECKS) {
    const productPath = path.join(ROOT, check.product);
    if (!fs.existsSync(productPath)) {
        console.error(`❌ 缺少构建产物 ${check.product}：请先执行 npm run build`);
        stale += 1;
        continue;
    }
    const sources = [
        ...check.sources.map((file) => path.join(ROOT, file)),
        ...check.dirs.flatMap((dir) => walk(path.join(ROOT, dir))),
    ];
    const { newest, newestPath } = newestMtime(sources);
    const productMtime = fs.statSync(productPath).mtimeMs;
    if (newest > productMtime) {
        const rel = path.relative(ROOT, newestPath).split(path.sep).join('/');
        console.error(`❌ ${check.product} 落后于源码：最新源 ${rel} 晚于产物。E2E 将跑在旧产物上，请先执行 npm run build`);
        stale += 1;
    }
}

if (stale > 0) {
    process.exit(1);
}
console.log('[check-e2e-fresh] ✅ 构建产物新鲜，E2E 将测当前代码');
