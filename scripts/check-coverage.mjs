#!/usr/bin/env node
/**
 * check-coverage.mjs — 覆盖率棘轮门禁（DSH-20261112-01）
 *
 * 数据源：`coverage/coverage-summary.json`（vitest v8 + json-summary reporter）。
 * 口径：
 * - 只约束 lines（D2 指标），其余三项附带输出/入库；
 * - 目录聚合 count-weighted（见 scripts/lib/coverage-lib.mjs）；
 * - 基线必须带 gitHead provenance；HEAD 不符 exit 2；
 * - 覆盖率下降 exit 1；上升/持平 exit 0；
 * - 写基线：--note 必填；下调需 --allow-decrease 双确认。
 *
 * 用法：
 *   node scripts/check-coverage.mjs
 *   node scripts/check-coverage.mjs --update-baseline --note "原因"
 *   node scripts/check-coverage.mjs --update-baseline --allow-decrease --note "原因"
 *   node scripts/check-coverage.mjs --json
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
    aggregateByDir,
    compareCoverage,
    evaluateProvenance,
    toBaselineDirs,
    validateBaselineUpdate,
} from './lib/coverage-lib.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..');
const SUMMARY_FILE = path.join(ROOT, 'coverage', 'coverage-summary.json');
const BASELINE_FILE = path.join(ROOT, '.coverage-baseline.json');
/** 门禁目录：长期目标 D2 指标用 ui/views，文档写 ui；两级都输出 */
const TRACKED_DIRS = ['ui', 'ui/views'];

function parseArgs(argv) {
    const args = { update: false, allowDecrease: false, note: '', json: false };
    for (let i = 0; i < argv.length; i++) {
        const item = argv[i];
        if (item === '--update-baseline') args.update = true;
        else if (item === '--allow-decrease') args.allowDecrease = true;
        else if (item === '--note') args.note = argv[++i] || '';
        else if (item === '--json') args.json = true;
    }
    return args;
}

function gitHead() {
    const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
    return result.status === 0 ? result.stdout.trim() : '';
}

/**
 * 基线 gitHead 是否为当前 HEAD 的祖先。
 *
 * @param {string} ancestor - 基线 gitHead
 * @param {string} head - 当前 HEAD
 * @returns {boolean} 是否祖先
 */
function isAncestor(ancestor, head) {
    const result = spawnSync('git', ['merge-base', '--is-ancestor', ancestor, head], { cwd: ROOT });
    return result.status === 0;
}

/**
 * 两次提交之间「被统计的源码目录」是否有变化。
 *
 * 只检查覆盖率真正度量的目录；package.json / vitest.config.ts / 门禁脚本 / 文档
 * 的变更不影响覆盖率数字，也不应让基线失效（基线随门禁提交的自引用场景）。
 *
 * @param {string} from - 基线 gitHead
 * @param {string} to - 当前 HEAD
 * @returns {boolean} 源码是否变化
 */
function sourcesChanged(from, to) {
    const result = spawnSync(
        'git',
        ['diff', '--quiet', from, to, '--', 'ui', 'engine', 'shared', 'services', 'core', 'domains'],
        { cwd: ROOT },
    );
    // 0 = 无差异；1 = 有差异；其它（如对象缺失）按「有变化」保守处理
    return result.status !== 0;
}

function readJson(file) {
    if (!fs.existsSync(file)) return null;
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        return null;
    }
}

function formatRow(entry) {
    const m = entry;
    return `${m.dir}: lines ${m.lines.pct}%（${m.lines.covered}/${m.lines.total}，${m.files} 文件）`
        + ` · statements ${m.statements.pct}% · branches ${m.branches.pct}% · functions ${m.functions.pct}%`;
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    const summary = readJson(SUMMARY_FILE);
    if (!summary) {
        console.error(`❌ 未找到 ${path.relative(ROOT, SUMMARY_FILE)}：请先运行 npm run test:cov`);
        return 1;
    }

    const current = {};
    for (const dir of TRACKED_DIRS) current[dir] = aggregateByDir(summary, dir, ROOT);

    if (args.update) {
        const oldBaseline = readJson(BASELINE_FILE);
        const check = validateBaselineUpdate({
            oldBaseline,
            current,
            note: args.note,
            allowDecrease: args.allowDecrease,
        });
        if (!check.ok) {
            for (const error of check.errors) console.error(`❌ ${error}`);
            return 1;
        }
        const payload = {
            generatedAt: new Date().toISOString(),
            gitHead: gitHead(),
            nodeVersion: process.version,
            note: args.note.trim(),
            dirs: toBaselineDirs(current),
        };
        fs.writeFileSync(BASELINE_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
        console.log(`✅ 已写入覆盖率基线：${path.relative(ROOT, BASELINE_FILE)}（gitHead=${payload.gitHead.slice(0, 12)}）`);
        for (const dir of TRACKED_DIRS) console.log(`   ${formatRow(current[dir])}`);
        if (check.decreased.length > 0) {
            console.log(`   ⚠ 本次为显式下调（--allow-decrease）：${check.decreased.join('、')}`);
        }
        return 0;
    }

    const baseline = readJson(BASELINE_FILE);
    if (!baseline) {
        console.error('❌ 未找到 .coverage-baseline.json：首次使用请运行 npm run check:coverage -- --update-baseline --note "首期基线"');
        return 1;
    }

    const head = gitHead();
    const baseHead = String(baseline.gitHead || '');
    const provenance = evaluateProvenance({
        baselineHead: baseHead,
        head,
        isAncestor: Boolean(baseHead && head && baseHead !== head && isAncestor(baseHead, head)),
        sourcesChanged: Boolean(baseHead && head && baseHead !== head && sourcesChanged(baseHead, head)),
    });
    if (!provenance.ok) {
        console.error(`❌ ${provenance.reason}`);
        return provenance.code;
    }
    if (provenance.note) console.log(`ℹ ${provenance.note}`);

    const result = compareCoverage(baseline, current);
    if (args.json) {
        console.log(JSON.stringify({ ok: result.ok, decreased: result.decreased, current }, null, 2));
    } else {
        for (const dir of TRACKED_DIRS) console.log(`ℹ ${formatRow(current[dir])}`);
        // 基线里存在但本轮 TRACKED_DIRS 未覆盖的目录也一并提示，避免静默丢口径
        for (const dir of Object.keys(baseline.dirs || {})) {
            if (!current[dir]) console.warn(`⚠ 基线包含 ${dir}，但当前未统计（口径变化需 --update-baseline 说明）`);
        }
    }

    if (!result.ok) {
        for (const item of result.decreased) {
            console.error(`❌ ${item.dir}: lines 基线 ${item.baseline} vs 实际 ${item.actual}（覆盖率下降）`);
        }
        console.error('覆盖率棘轮只升不降；确需下调请运行 --update-baseline --allow-decrease --note "原因"');
        return 1;
    }

    console.log('✅ 覆盖率棘轮通过（无下降）');
    return 0;
}

process.exitCode = main();
