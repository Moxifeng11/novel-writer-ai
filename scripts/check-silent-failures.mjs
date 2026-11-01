#!/usr/bin/env node
/**
 * check-silent-failures.mjs — 用户操作型入口的「静默失败」契约
 *
 * 规则（G5-4）：在同一行/紧邻 4 行内出现「保存 / 导出 / 删除 / 写入」且带 catch 的分支，
 * 必须调用 Notice / showError 之类的用户可见出口；纯后台缓存或只读加载请在 catch 行加
 * `// silent-ok: 原因` 显式豁免。
 *
 * 只扫 ui/：engine/services 的降级由日志与结算汇总负责，不在本门禁范围。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const uiDir = path.join(root, 'ui');

const USER_ACTION = /(保存|导出|删除|写入|落盘|覆盖)/;
const VISIBLE = /(Notice|showError|notify|renderError|setAiStatus|updateControlState|setText\(.*失败|throw )/;
const EXEMPT = /silent-ok/;

function walk(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else if (entry.isFile() && entry.name.endsWith('.ts')) out.push(full);
    }
    return out;
}

const violations = [];
for (const file of walk(uiDir)) {
    const rel = path.relative(root, file).replace(/\\/g, '/');
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line.includes('catch')) continue;
        if (EXEMPT.test(line)) continue;
        const windowText = lines.slice(i, Math.min(lines.length, i + 12)).join('\n');
        if (VISIBLE.test(windowText)) continue;
        // 只看 catch 前 6 行：避免把同文件里别的保存逻辑也算进来
        const context = lines.slice(Math.max(0, i - 6), i + 1).join('\n');
        if (!USER_ACTION.test(context)) continue;
        violations.push(`${rel}:${i + 1}`);
    }
}

if (violations.length > 0) {
    console.error('[check:silent-failures] ❌ 以下 catch 属于用户操作型入口，但没有用户可见提示：');
    for (const item of violations) console.error(`  - ${item}`);
    console.error('修复：在 catch 里 new Notice(...)（带原因）或改用 showError；');
    console.error('确实只影响后台缓存/只读加载时，在该 catch 行加注释 `// silent-ok: 原因`。');
    process.exit(1);
}

console.log('[check:silent-failures] ✅ 用户操作型 catch 均有可见提示');
