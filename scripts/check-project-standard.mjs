#!/usr/bin/env node
/**
 * check-project-standard.mjs — 项目标准门禁
 *
 * 对 vault 内所有项目跑结构校验，报告缺目录/缺文件/命名不符/摘要缺失/事实库损坏/标准过期。
 *
 * 用法：node scripts/check-project-standard.mjs [--json] [--vault <path>] [--max-minor N]
 * 退出码：0 通过 / 1 有 error 级问题 / 2 量具自检失败（找不到 vault 或无项目时不报错，返回 0）
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { validateProjectStandard } from './lib/project-standard-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_VAULT = path.resolve(ROOT, '../..');
const args = process.argv.slice(2);
const JSON_OUT = args.includes('--json');
const vaultArg = args.indexOf('--vault');
const VAULT = vaultArg >= 0 ? path.resolve(args[vaultArg + 1]) : DEFAULT_VAULT;
const maxMinorArg = args.indexOf('--max-minor');
const MAX_MINOR = maxMinorArg >= 0 ? Number(args[maxMinorArg + 1]) : 20;

const SKIP_DIRS = new Set(['.obsidian', '.trash', '.git', 'node_modules']);

/** node fs 适配为标准端口 */
const nodeFs = {
    exists: async (p) => fs.existsSync(path.join(VAULT, p)),
    read: async (p) => fs.readFileSync(path.join(VAULT, p), 'utf8'),
    list: async (p) => {
        const abs = path.join(VAULT, p);
        if (!fs.existsSync(abs)) throw new Error(`missing ${p}`);
        const entries = fs.readdirSync(abs, { withFileTypes: true });
        return {
            files: entries.filter(e => e.isFile()).map(e => `${p}/${e.name}`),
            folders: entries.filter(e => e.isDirectory()).map(e => `${p}/${e.name}`),
        };
    },
};

if (!fs.existsSync(VAULT)) {
    console.error(`[check:project-standard] ❌ vault 不存在：${VAULT}`);
    process.exit(2);
}

const projects = fs.readdirSync(VAULT, { withFileTypes: true })
    .filter(e => e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.'))
    .map(e => e.name)
    .filter(name => fs.existsSync(path.join(VAULT, name, '.project')));

const reports = [];
for (const project of projects) reports.push(await validateProjectStandard(nodeFs, project));

const errors = reports.flatMap(r => r.issues.filter(i => i.severity === 'error'));
const warnings = reports.flatMap(r => r.issues.filter(i => i.severity === 'warning'));

if (JSON_OUT) {
    console.log(JSON.stringify({ vault: VAULT, projects: reports.length, errors: errors.length, warnings: warnings.length, reports }, null, 2));
} else if (projects.length === 0) {
    console.log('[check:project-standard] ⚠️ vault 内没有项目（不算失败；新库或纯素材库属正常）');
} else {
    for (const report of reports) {
        const e = report.issues.filter(i => i.severity === 'error').length;
        const w = report.issues.length - e;
        const mark = e > 0 ? '❌' : (w > 0 ? '⚠️' : '✅');
        console.log(`${mark} ${report.project}：error ${e} / warning ${w}（目录 ${report.checkedDirs} · 正文 ${report.checkedBodies}）`);
        for (const issue of report.issues.slice(0, 6)) {
            console.log(`    [${issue.severity}] ${issue.label} · ${issue.path}`);
            console.log(`        ${issue.detail}`);
        }
        if (report.issues.length > 6) console.log(`    …另有 ${report.issues.length - 6} 条`);
    }
    if (errors.length === 0 && warnings.length === 0) {
        console.log(`[check:project-standard] ✅ ${projects.length} 个项目全部符合标准`);
    }
}

if (errors.length > 0) {
    console.error(`[check:project-standard] ❌ ${errors.length} 个 error 级问题（warning ${warnings.length} 个）`);
    process.exit(1);
}
if (warnings.length > MAX_MINOR) {
    console.error(`[check:project-standard] ❌ warning ${warnings.length} 个，超过上限 ${MAX_MINOR}（先用 --max-minor 放宽或逐条修复）`);
    process.exit(1);
}
if (projects.length > 0) {
    console.log(`[check:project-standard] ✅ 通过（project ${projects.length} · error 0 · warning ${warnings.length}）`);
}
process.exit(0);
