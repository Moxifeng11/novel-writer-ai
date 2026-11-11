#!/usr/bin/env node
/**
 * program-status.mjs — 全系统优化专项 · 进度台账渲染/校验
 *
 * 单一数据源：docs/progress/program-status.json
 * 渲染产物：docs/progress/PROGRAM-STATUS.md（不要手改，改 JSON 后重跑）
 *
 * 用法：
 *   node scripts/program-status.mjs            # 渲染并写回 MD
 *   node scripts/program-status.mjs --check    # 只校验 MD 与 JSON 是否同步（CI 用）
 *   node scripts/program-status.mjs --root <dir>  # 指定仓库根（门禁自测用）
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_ARG_INDEX = process.argv.indexOf('--root');
if (ROOT_ARG_INDEX !== -1 && !process.argv[ROOT_ARG_INDEX + 1]) {
    console.error('[program-status] ❌ --root 缺少目录参数');
    process.exit(2);
}
const root = ROOT_ARG_INDEX !== -1
    ? path.resolve(process.argv[ROOT_ARG_INDEX + 1])
    : path.resolve(__dirname, '..');
const jsonPath = path.join(root, 'docs/progress/program-status.json');
const mdPath = path.join(root, 'docs/progress/PROGRAM-STATUS.md');

/** baseline.tests.files 与实测数量的允许偏差（测试数每批都在变，精确匹配会天天红）。 */
const TEST_DEVIATION_LIMIT = 10;

const STATUS_ICON = {
    done: '✅',
    in_progress: '🟡',
    blocked: '⛔',
    todo: '⬜',
    dropped: '➖',
};

const STATUS_LABEL = {
    done: '已完成',
    in_progress: '进行中',
    blocked: '受阻',
    todo: '待开始',
    dropped: '已取消',
};

function readProgram() {
    const raw = fs.readFileSync(jsonPath, 'utf8');
    return JSON.parse(raw);
}

/**
 * 组状态：由任务推导，避免「全做完还显示进行中」。
 * blocked / dropped 允许在 JSON 里显式覆盖（例如被外部依赖卡住）。
 */
function deriveGroupStatus(group) {
    const explicit = group.status;
    if (explicit === 'blocked' || explicit === 'dropped') return explicit;
    const tasks = Array.isArray(group.tasks) ? group.tasks : [];
    if (tasks.length === 0) return 'todo';
    if (tasks.every(task => task.status === 'done' || task.status === 'dropped')) return 'done';
    if (tasks.some(task => task.status === 'in_progress' || task.status === 'done')) return 'in_progress';
    return 'todo';
}

function pct(done, total) {
    if (total <= 0) return 0;
    return Math.round((done / total) * 100);
}

function render(data) {
    const groups = Array.isArray(data.groups) ? data.groups : [];
    const allTasks = groups.flatMap(group => Array.isArray(group.tasks) ? group.tasks : []);
    const doneTasks = allTasks.filter(task => task.status === 'done').length;
    const activeTasks = allTasks.filter(task => task.status === 'in_progress').length;
    const blockedTasks = allTasks.filter(task => task.status === 'blocked').length;

    const lines = [];
    lines.push('# 全系统优化专项 · 进度报告');
    lines.push('');
    lines.push('> **本文件由 `scripts/program-status.mjs` 从 `docs/progress/program-status.json` 生成，请勿手改。**');
    lines.push('> 专项计划与验收口径见 [`docs/PROGRAM.md`](../PROGRAM.md)；结构路线见 [`docs/PLAN.md`](../PLAN.md)。');
    lines.push('');
    lines.push(`- 专项版本：${data.rev ?? '—'}`);
    lines.push(`- 更新时间：${data.updatedAt ?? '—'}`);
    const baseline = data.baseline ?? {};
    if (baseline.version) {
        const tests = baseline.tests ? `${baseline.tests.files} 文件 / ${baseline.tests.cases} 用例` : '—';
        lines.push(`- 当前基线：v${baseline.version}；单测 ${tests}；E2E ${baseline.e2e ?? '—'} 条`);
    }
    lines.push(`- 任务进度：${doneTasks}/${allTasks.length} 已完成（${pct(doneTasks, allTasks.length)}%），${activeTasks} 进行中，${blockedTasks} 受阻`);
    lines.push('');

    lines.push('## 一、任务组总览');
    lines.push('');
    lines.push('| 组 | 名称 | 目标版本 | 状态 | 进度 | 责任人 |');
    lines.push('|---|---|---|---|---|---|');
    for (const group of groups) {
        const tasks = Array.isArray(group.tasks) ? group.tasks : [];
        const done = tasks.filter(task => task.status === 'done').length;
        const status = deriveGroupStatus(group);
        const owner = group.owner
            ? `实现 ${group.owner.impl ?? '—'} / 验收 ${group.owner.accept ?? '—'}`
            : '—';
        lines.push(`| ${group.id} | ${group.name} | ${group.milestone ?? '—'} | ${STATUS_ICON[status] ?? ''} ${STATUS_LABEL[status] ?? status} | ${done}/${tasks.length}（${pct(done, tasks.length)}%） | ${owner} |`);
    }
    lines.push('');

    lines.push('## 二、分组明细');
    lines.push('');
    for (const group of groups) {
        const tasks = Array.isArray(group.tasks) ? group.tasks : [];
        const done = tasks.filter(task => task.status === 'done').length;
        const groupStatus = deriveGroupStatus(group);
        lines.push(`### ${group.id} ${group.name}（${STATUS_ICON[groupStatus] ?? ''} ${STATUS_LABEL[groupStatus] ?? groupStatus}）`);
        lines.push('');
        if (group.objective) lines.push(`- 目标：${group.objective}`);
        if (group.milestone) lines.push(`- 目标版本：${group.milestone}`);
        if (group.owner) lines.push(`- 责任：实现 ${group.owner.impl ?? '—'}；验收 ${group.owner.accept ?? '—'}`);
        if (Array.isArray(group.dependsOn) && group.dependsOn.length > 0) {
            lines.push(`- 依赖：${group.dependsOn.join('、')}`);
        }
        lines.push('');
        if (tasks.length === 0) {
            lines.push('（暂无任务）');
            lines.push('');
            continue;
        }
        lines.push('| 任务 | 内容 | 状态 | 验收标准 | 证据 / 备注 |');
        lines.push('|---|---|---|---|---|');
        for (const task of tasks) {
            const status = task.status ?? 'todo';
            const acceptance = (task.acceptance ?? '—').replace(/\|/g, '\\|');
            const evidence = (task.evidence ?? '—').replace(/\|/g, '\\|');
            lines.push(`| ${task.id} | ${(task.title ?? '—').replace(/\|/g, '\\|')} | ${STATUS_ICON[status] ?? ''} ${STATUS_LABEL[status] ?? status} | ${acceptance} | ${evidence} |`);
        }
        lines.push('');
        if (group.notes) {
            lines.push(`> ${group.notes}`);
            lines.push('');
        }
    }

    lines.push('## 三、同步对象');
    lines.push('');
    const sync = data.sync ?? {};
    lines.push('| 对象 | 位置 | 说明 |');
    lines.push('|---|---|---|');
    lines.push(`| 本项目结构路线 | \`${sync.plan ?? 'docs/PLAN.md'}\` | 模块边界与里程碑 |`);
    lines.push(`| 跨工具进度 | \`${sync.trae ?? 'docs/progress/program-status.json'}\` | 唯一进度数据源 |`);
    lines.push(`| 进度报告 | \`${sync.reports ?? 'docs/progress/PROGRAM-STATUS.md'}\` | 本文件（自动生成） |`);
    lines.push(`| 审计取证 | \`${sync.audits ?? 'docs/audits/'}\` | 各轮问题清单与修复证据 |`);
    lines.push('');

    if (Array.isArray(data.changelog) && data.changelog.length > 0) {
        lines.push('## 四、进度流水');
        lines.push('');
        for (const entry of data.changelog) {
            lines.push(`- ${entry.date}｜${entry.group ?? '—'}｜${entry.summary}${entry.evidence ? `（${entry.evidence}）` : ''}`);
        }
        lines.push('');
    }

    return sanitizeControlChars(lines.join('\n'));
}

/**
 * 剔除 Markdown 里不可见的控制字符。
 * 台账 JSON 中一旦出现 `\u0000` 之类的转义，渲染物会变成含裸 NUL 的文件，
 * grep/ripgrep 会把整篇当二进制跳过（2026-11 实测）。
 */
function sanitizeControlChars(text) {
    return String(text).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}

/**
 * 递归统计 tests 目录下的 *.test.ts 数量（与 vitest include 口径一致）。
 */
function countTestFiles(dir) {
    if (!fs.existsSync(dir)) return 0;
    let count = 0;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) count += countTestFiles(full);
        else if (entry.isFile() && entry.name.endsWith('.test.ts')) count += 1;
    }
    return count;
}

/**
 * 校验台账基线是否与仓库真实状态一致。
 *
 * 只证明「MD 等于 JSON」不够：JSON 自身漂移时，渲染链会稳定地复制错误数字。
 * 因此这里直接对照 package.json 版本与实测测试文件数。
 */
function validateBaseline(data) {
    const baseline = data.baseline ?? {};
    const failures = [];
    const packageJsonPath = path.join(root, 'package.json');

    let packageVersion = null;
    if (!fs.existsSync(packageJsonPath)) {
        failures.push(`缺少 ${path.relative(root, packageJsonPath)}，无法校验 baseline.version`);
    } else {
        try {
            packageVersion = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')).version ?? null;
        } catch (error) {
            failures.push(`package.json 解析失败：${error.message}`);
        }
    }

    if (packageVersion && baseline.version !== packageVersion) {
        failures.push(
            `baseline.version (${baseline.version ?? '缺失'}) 与 package.json version (${packageVersion}) 不一致，请改 JSON 后重跑 program:render`
        );
    }

    const actualFiles = countTestFiles(path.join(root, 'tests'));
    if (actualFiles === 0) {
        failures.push('实测 tests/**/*.test.ts 为 0，无法校验 baseline.tests');
    } else {
        const baselineFiles = Number(baseline.tests?.files);
        if (!Number.isFinite(baselineFiles)) {
            failures.push('baseline.tests.files 缺失或非数字');
        } else {
            const deviation = (Math.abs(baselineFiles - actualFiles) / actualFiles) * 100;
            if (deviation > TEST_DEVIATION_LIMIT) {
                failures.push(
                    `baseline.tests.files (${baselineFiles}) 与实测测试文件数 (${actualFiles}) 偏差 ${deviation.toFixed(1)}%，超过允许的 ±${TEST_DEVIATION_LIMIT}%`
                );
            }
        }
    }

    if (failures.length > 0) {
        for (const failure of failures) console.error(`[program-status] ❌ ${failure}`);
        process.exit(1);
    }
}

function main() {
    if (!fs.existsSync(jsonPath)) {
        console.error(`[program-status] 缺少台账文件：${path.relative(root, jsonPath)}`);
        process.exit(1);
    }
    const data = readProgram();
    validateBaseline(data);
    const rendered = render(data);
    const checkOnly = process.argv.includes('--check');

    if (checkOnly) {
        const current = fs.existsSync(mdPath) ? fs.readFileSync(mdPath, 'utf8') : '';
        if (current !== rendered) {
            console.error('[program-status] ❌ 进度报告与台账不同步，请运行：npm run program:render');
            process.exit(1);
        }
        console.log('[program-status] ✅ 进度报告与台账一致');
        return;
    }

    fs.mkdirSync(path.dirname(mdPath), { recursive: true });
    fs.writeFileSync(mdPath, rendered, 'utf8');
    const groups = Array.isArray(data.groups) ? data.groups : [];
    const tasks = groups.flatMap(group => group.tasks ?? []);
    const done = tasks.filter(task => task.status === 'done').length;
    console.log(`[program-status] 已渲染 ${path.relative(root, mdPath)}（${groups.length} 组 / ${done}/${tasks.length} 任务完成）`);
}

main();
