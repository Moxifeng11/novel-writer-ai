#!/usr/bin/env node
/**
 * record-iteration.mjs — 自动迭代成果台账记录器
 *
 * 每次每半小时任务结束前调用，强制写清「本轮交付了什么」。
 * 纯阅读/纯分析不算成果：deliverable、files、commit、tests、gates、next 缺一不可。
 *
 * 用法：
 *   node scripts/record-iteration.mjs \
 *     --type code --deliverable "修复 XXX 并补回归" \
 *     --files "ui/a.ts, tests/a.test.ts" --commit 5f6ec64 \
 *     --tests "6723 passed" --gates "lint=0, preflight=0" --next "审计维度③"
 *
 * 阻塞轮：
 *   node scripts/record-iteration.mjs --type blocked --blocker "并发进程占用" ...
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const LEDGER = path.join(REPO_ROOT, 'docs', 'progress', 'auto-iterations.md');

const TYPES = new Set(['code', 'audit', 'gate', 'docs', 'blocked']);

function parseArgs(argv) {
    const args = {};
    for (let i = 0; i < argv.length; i++) {
        const key = argv[i];
        if (!key.startsWith('--')) continue;
        const name = key.slice(2);
        const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : '';
        args[name] = value;
    }
    return args;
}

function fail(message) {
    console.error(`[record-iteration] ❌ ${message}`);
    process.exit(1);
}

function requireValue(args, name) {
    const value = String(args[name] || '').trim();
    if (!value) fail(`缺少 --${name}`);
    return value;
}

function escapeCell(value) {
    return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

function nextRound(text) {
    let max = 0;
    for (const line of text.split('\n')) {
        const match = /^\|\s*(\d+)\s*\|/.exec(line);
        if (match) max = Math.max(max, Number(match[1]) || 0);
    }
    return max + 1;
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    const type = requireValue(args, 'type');
    if (!TYPES.has(type)) fail(`--type 必须是 ${[...TYPES].join('/')}`);

    const blocked = type === 'blocked';
    const deliverable = blocked
        ? requireValue(args, 'blocker')
        : requireValue(args, 'deliverable');
    if (!blocked && deliverable.length < 8) {
        fail('--deliverable 太短；请写清具体交付物（不是“调研/分析/无变更”）');
    }
    const files = blocked ? String(args.files || '—') : requireValue(args, 'files');
    const commit = blocked ? String(args.commit || '—') : requireValue(args, 'commit');
    const tests = blocked ? String(args.tests || '—') : requireValue(args, 'tests');
    const gates = blocked ? String(args.gates || '—') : requireValue(args, 'gates');
    const next = requireValue(args, 'next');

    if (!blocked && !/^[0-9a-f]{7,40}$/i.test(commit)) {
        fail('--commit 必须是本轮已提交的 7–40 位 git SHA');
    }

    const text = fs.existsSync(args.ledger ? path.resolve(args.ledger) : LEDGER)
        ? fs.readFileSync(args.ledger ? path.resolve(args.ledger) : LEDGER, 'utf8')
        : '# 自动迭代成果台账\n\n| 轮次 | 时间 | 类型 | 本轮成果 | 关键文件 | 提交 | 测试/门禁 | 下一轮 |\n|---:|---|---|---|---|---|---|---|\n';
    const round = Number(args.round) || nextRound(text);
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const row = `| ${round} | ${now} | ${type} | ${escapeCell(deliverable)} | ${escapeCell(files)} | ${escapeCell(commit)} | ${escapeCell(`${tests}；${gates}`)} | ${escapeCell(next)} |\n`;
    const target = args.ledger ? path.resolve(args.ledger) : LEDGER;
    fs.writeFileSync(target, text.endsWith('\n') ? text + row : `${text}\n${row}`, 'utf8');
    console.log(`[record-iteration] ✅ 已记录第 ${round} 轮：${deliverable}`);
}

main();
