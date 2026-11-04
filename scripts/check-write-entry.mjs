#!/usr/bin/env node
/**
 * check-write-entry.mjs — 用户可见 Markdown 的写入入口门禁
 *
 * 背景：`app.vault.adapter.write()` 不触发 Obsidian 的 modify 事件，
 * metadataCache/文件浏览器/双链都不会及时更新；移动端没有外部文件监听，
 * 新建章节可能长时间不可见（v4.27 已修过一批）。
 *
 * 规则：
 * 1. 运行时代码里的 `adapter.write/append` 只允许出现在 `shared/file-system-port.ts`
 *    这个索引写入网关里；
 * 2. 其它调用要么路径明显是索引外文件（.json/.jsonl/.yml/.project/.bak/.canvas/.base/.css/.txt），
 *    要么在同一行/前 3 行写 `// write-entry-allow: <原因>` 显式豁免；
 * 3. 新增用户可见 .md 写入 → 必须改用 `writeVaultText(app, path, content)`。
 *
 * 注释行（`*` / `//`）不参与检测，避免把说明文字当成调用。
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_DIRS = ['engine', 'services', 'shared', 'core', 'domains', 'ui'];
const ROOT_FILES = ['main.ts', 'plugin-api.ts'];
const IGNORED_DIRS = new Set(['node_modules', '.git', 'coverage', 'tmp', 'dist', 'tests', 'scripts']);
const GATEWAY = 'shared/file-system-port.ts';
const CALL = /(?:^|[^\w$])adapter\.(write|append)\s*\(/;
const EXEMPT_PATH = /\.(json|jsonl|ya?ml|project|bak|canvas|base|css|txt)\b/;
const MARKER = /write-entry-allow\s*:/;

function walk(dir, out) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (!IGNORED_DIRS.has(entry.name)) walk(full, out);
        } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
            out.push(full);
        }
    }
    return out;
}

const files = [];
for (const dir of SCAN_DIRS) {
    const full = path.join(ROOT, dir);
    if (fs.existsSync(full)) walk(full, files);
}
for (const rel of ROOT_FILES) {
    const full = path.join(ROOT, rel);
    if (fs.existsSync(full)) files.push(full);
}

const violations = [];
let allowed = 0;
for (const file of files) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    if (rel === GATEWAY) continue;
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
        if (!CALL.test(line)) continue;
        const windowText = lines.slice(Math.max(0, i - 3), i + 1).join('\n');
        if (MARKER.test(windowText) || EXEMPT_PATH.test(line)) {
            allowed += 1;
            continue;
        }
        violations.push(`${rel}:${i + 1}`);
    }
}

if (violations.length > 0) {
    console.error('[check:write-entry] ❌ 用户可见 Markdown 出现裸 adapter 写入：');
    for (const item of violations) console.error(`  - ${item}`);
    console.error('');
    console.error('修复：改用 `writeVaultText(app, path, content)`（shared/file-system-port）。');
    console.error('索引外文件（配置/JSON/点目录）请在同一行加 `// write-entry-allow: 原因`。');
    process.exit(1);
}

console.log(`[check:write-entry] ✅ 裸 adapter 写入均限定在索引外文件（${allowed} 处豁免，网关 ${GATEWAY}）`);
