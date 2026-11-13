/**
 * 在真实 vault 上跑项目标准校验（A2 端到端验证）
 *
 * 用法：npx tsx scripts/dev-project-standard.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { validateProjectStandard } from '../services/project-standard-service.ts';

const VAULT = 'D:/小说工坊/小说工坊';
const SKIP = new Set(['.obsidian', '.trash', 'node_modules', '.git', '小说原著下载', '短篇小说', '长篇小说']);

/** node fs 适配为 StandardFs */
const nodeFs = {
    exists: async (p) => fs.existsSync(path.join(VAULT, p)),
    read: async (p) => fs.readFileSync(path.join(VAULT, p), 'utf8'),
    list: async (p) => {
        const abs = path.join(VAULT, p);
        if (!fs.existsSync(abs)) throw new Error('missing ' + p);
        const entries = fs.readdirSync(abs, { withFileTypes: true });
        return {
            files: entries.filter(e => e.isFile()).map(e => `${p}/${e.name}`),
            folders: entries.filter(e => e.isDirectory()).map(e => `${p}/${e.name}`),
        };
    },
};

const roots = fs.readdirSync(VAULT, { withFileTypes: true })
    .filter(e => e.isDirectory() && !SKIP.has(e.name) && !e.name.startsWith('.'))
    .map(e => e.name);

const projects = roots.filter(name => fs.existsSync(path.join(VAULT, name, '.project')));
console.log(`vault 顶层目录 ${roots.length} 个，其中带 .project 的项目 ${projects.length} 个`);

if (projects.length === 0) {
    console.log('\n⚠️ 当前 vault 没有项目——无法验证。');
    console.log('   这说明校验器本身工作正常（没有项目就没有输入），但需要真实项目才能看出价值。');
    process.exit(0);
}

for (const project of projects) {
    const report = await validateProjectStandard(nodeFs, project);
    console.log(`\n=== ${project} ===`);
    console.log(`标准版本 ${report.declaredVersion ?? '未声明'} / 当前 ${report.currentVersion}`
        + ` · 目录 ${report.checkedDirs} · 正文 ${report.checkedBodies} · 问题 ${report.issues.length} 条`);
    if (report.issues.length === 0) {
        console.log('  ✅ 完全符合标准');
        continue;
    }
    for (const issue of report.issues.slice(0, 12)) {
        console.log(`  [${issue.severity}] ${issue.kind} · ${issue.path}`);
        console.log(`      ${issue.label}：${issue.detail.slice(0, 90)}`);
    }
    if (report.issues.length > 12) console.log(`  …另有 ${report.issues.length - 12} 条`);
    console.log('  汇总:', JSON.stringify(report.summary));
}
