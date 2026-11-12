/**
 * check-automation.mjs — Trae/ZCode 自动化配置一致性检查
 *
 * 目的：确保两套自动化只有一份活跃状态台账，且交接快照、信箱、版本号
 * 与状态文件结构一致，避免「双份状态互相覆盖」与陈旧交接。
 *
 * 本地（Vault 工作区）严格校验；独立插件仓/CI 缺少 Vault 资产时降级为提示。
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    DEFAULT_MAX_AGE_HOURS,
    DEFAULT_WARN_AGE_HOURS,
    evaluateLedgerFreshness,
} from './lib/automation-lib.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const vaultRoot = resolve(repoRoot, '../../..');
const isVaultWorkspace = existsSync(resolve(vaultRoot, 'PROJECT-RULES.md'));

/** CLI 参数：`--max-age-hours 72` / `--warn-age-hours 24`（测试与临时放宽用） */
const argv = process.argv.slice(2);
function numberArg(name, fallback) {
    const index = argv.indexOf(name);
    if (index < 0) return fallback;
    const value = Number(argv[index + 1]);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
}
const maxAgeHours = numberArg('--max-age-hours', DEFAULT_MAX_AGE_HOURS);
const warnAgeHours = numberArg('--warn-age-hours', DEFAULT_WARN_AGE_HOURS);

const failures = [];
const warnings = [];
const infos = [];

function fail(message) {
    failures.push(message);
}

function warn(message) {
    warnings.push(message);
}

function info(message) {
    infos.push(message);
}

function readJson(path) {
    try {
        return JSON.parse(readFileSync(path, 'utf8'));
    } catch (e) {
        fail(`无法解析 JSON：${path}（${e.message}）`);
        return null;
    }
}

function readText(path) {
    try {
        return readFileSync(path, 'utf8');
    } catch (e) {
        fail(`无法读取文件：${path}（${e.message}）`);
        return '';
    }
}

// ── 1. 活跃状态台账（唯一真相源） ─────────────────────────────
const canonicalPath = resolve(repoRoot, '.trae/automation/trae-loop-state.json');
let canonicalState = null;
if (!existsSync(canonicalPath)) {
    if (isVaultWorkspace) fail('缺少活跃状态台账：.trae/automation/trae-loop-state.json');
    else warn('缺少 .trae/automation/trae-loop-state.json（独立插件仓/CI 允许缺失）');
} else {
    const state = readJson(canonicalPath);
    canonicalState = state;
    if (state) {
        if (state.schemaVersion !== 1) fail(`状态台账 schemaVersion 应为 1，实际 ${state.schemaVersion}`);
        if (!Number.isInteger(state.round) || state.round < 1) fail('状态台账 round 必须是正整数');
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})$/.test(state.updatedAt || '')) {
            fail('状态台账 updatedAt 必须带时区（如 2026-11-06T17:41+08:00）');
        }
        const weights = state.params?.typeWeights ?? {};
        for (const key of ['slice', 'notice', 'test-hardening', 'docs-correction', 'gate-fix', 'perf', 'audit-only', 'v5-product']) {
            if (typeof weights[key] !== 'number') fail(`状态台账缺少类型权重：${key}`);
        }
        const redLines = state.constraints?.redLines ?? [];
        const requiredRedLines = [
            'no commit/push/tag/Release',
            'ui/views/writing-fingerprint-view.ts',
            'ui/views/fingerprint-v2-detail.ts',
            'engine/**',
        ];
        for (const line of requiredRedLines) {
            if (!redLines.some(rule => rule.includes(line))) fail(`状态台账红线缺失：${line}`);
        }
        if (Array.isArray(state.rounds) && state.rounds.length > 1) {
            const roundNumbers = state.rounds.map(item => item.round).filter(Number.isInteger);
            for (let index = 1; index < roundNumbers.length; index++) {
                if (roundNumbers[index] <= roundNumbers[index - 1]) {
                    fail(`状态台账 rounds 非单调递增：${roundNumbers[index - 1]} → ${roundNumbers[index]}`);
                    break;
                }
            }
        }
        // 轮次三处一致：顶层 round、最近一轮 lastRound、history 末条，避免「round 前进但历史未追加」的漂移
        if (Number.isInteger(state.lastRound?.round) && state.lastRound.round !== state.round) {
            fail(`状态台账 lastRound.round(${state.lastRound.round}) 与 round(${state.round}) 不一致`);
        }
        const lastHistory = Array.isArray(state.rounds) ? state.rounds[state.rounds.length - 1] : null;
        if (Number.isInteger(lastHistory?.round) && lastHistory.round !== state.round) {
            fail(`状态台账 rounds 末条 round(${lastHistory.round}) 与 round(${state.round}) 不一致`);
        }
        // 时效校验（Trae preflight 审计 P1）：原实现只验格式，台账停摆 3 天仍绿。
        // 退役台账（轮询已被任务板取代）跳过时效，但仍校验上面的格式，防止退役台账被写坏。
        const freshness = evaluateLedgerFreshness({
            updatedAt: state.updatedAt,
            retired: state.retired === true,
            retiredReason: state.retiredReason,
            now: Date.now(),
            maxAgeHours,
            warnAgeHours,
        });
        if (freshness.status === 'stale' || freshness.status === 'invalid') {
            fail(freshness.message);
        } else if (freshness.status === 'warn') {
            warn(freshness.message);
        } else {
            info(freshness.message);
        }
        info(`活跃状态台账：round ${state.round}，${state.updatedAt}`);
    }
}

// ── 2. Vault 根旧副本必须是 tombstone（或已删除） ─────────────
const stalePath = resolve(vaultRoot, '.trae/automation/trae-loop-state.json');
if (existsSync(stalePath)) {
    const stale = readJson(stalePath);
    if (stale) {
        const superseded = typeof stale.supersededBy === 'string' ? stale.supersededBy : '';
        if (stale.stale !== true || !superseded.includes('.obsidian/plugins/novel-writer-ai/.trae/automation/trae-loop-state.json')) {
            fail('Vault 根存在第二份活跃状态台账：请删除，或标记 stale + supersededBy 指向插件仓文件');
        } else {
            info('Vault 根副本已标记 stale（tombstone）');
        }
    }
}

// ── 3. 交接快照（Vault 工作区） ───────────────────────────────
if (isVaultWorkspace) {
    const handoffText = readText(resolve(vaultRoot, 'PROJECT-RULES.md'));
    const block = handoffText.match(/<!-- HANDOFF:START -->([\s\S]*?)<!-- HANDOFF:END -->/);
    if (!block) {
        fail('PROJECT-RULES.md 缺少 HANDOFF 快照块');
    } else {
        const lines = block[1].split('\n').filter(line => line.trim().startsWith('-'));
        if (lines.length > 10) fail(`HANDOFF 快照超过 10 行（实际 ${lines.length} 行）`);
        for (const key of ['当前阶段', '最近交付', '正在进行', '下一步（ZCode）', '下一步（Trae）', '待确认']) {
            if (!lines.some(line => line.includes(key))) fail(`HANDOFF 快照缺少字段：${key}`);
        }
        info(`HANDOFF 快照：${lines.length} 行`);
    }
}

// ── 4. 版本号四文件一致 ──────────────────────────────────────
const pkg = readJson(resolve(repoRoot, 'package.json'));
const manifest = readJson(resolve(repoRoot, 'manifest.json'));
const versions = readJson(resolve(repoRoot, 'versions.json'));
const lock = readJson(resolve(repoRoot, 'package-lock.json'));
if (pkg && manifest && versions && lock) {
    const lockVersion = lock.version || lock.packages?.['']?.version;
    if (pkg.version !== manifest.version) fail(`package.json(${pkg.version}) 与 manifest.json(${manifest.version}) 版本不一致`);
    if (lockVersion !== pkg.version) fail(`package-lock.json(${lockVersion}) 与 package.json(${pkg.version}) 版本不一致`);
    if (!versions || typeof versions !== 'object' || !Object.prototype.hasOwnProperty.call(versions, manifest.version)) {
        fail(`versions.json 未包含当前版本 ${manifest.version}`);
    }
    info(`版本一致：${pkg.version}`);
}

// ── 5. 信箱可读性（仅提示，不作为门禁失败） ───────────────────
const mailboxPath = resolve(vaultRoot, '.trae/mailbox/messages.jsonl');
if (existsSync(mailboxPath)) {
    const raw = readFileSync(mailboxPath, 'utf8').trim();
    if (raw) {
        const lastLine = raw.split('\n').pop() || '';
        try {
            JSON.parse(lastLine);
            info('信箱最近消息可解析');
        } catch {
            warn('信箱最近一行不是合法 JSON，请检查 novel-mailbox 写入');
        }
    } else {
        warn('信箱文件为空');
    }
} else {
    warn('未找到 .trae/mailbox/messages.jsonl（尚未使用信箱时正常）');
}

// ── 6. 优化方向建议台账（存在时校验，防止陈旧或非法建议） ─────
const advicePath = resolve(repoRoot, '.trae/automation/optimization-advice.json');
if (existsSync(advicePath)) {
    const advice = readJson(advicePath);
    if (advice) {
        if (advice.schemaVersion !== 1) fail(`建议台账 schemaVersion 应为 1，实际 ${advice.schemaVersion}`);
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})$/.test(advice.generatedAt || '')) {
            fail('建议台账 generatedAt 必须带时区（如 2026-11-07T22:30+08:00）');
        }
        if (!['dispatch', 'backlog', 'gate', 'score', 'idle'].includes(advice.tier)) {
            fail(`建议台账 tier 非法：${advice.tier}`);
        }
        if (!Array.isArray(advice.recommended) || advice.recommended.length < 1 || advice.recommended.length > 2) {
            fail('建议台账 recommended 应为 1–2 条');
        }
        if (!Array.isArray(advice.alternatives)) fail('建议台账 alternatives 必须是数组');
        if (Number.isInteger(canonicalState?.round) && Number.isInteger(advice.round)
            && Math.abs(advice.round - canonicalState.round) > 1) {
            fail(`建议台账 round(${advice.round}) 落后当前台账 round(${canonicalState.round}) 超过 1 轮；运行 npm run automation:advise -- --write 刷新`);
        }
        for (const candidate of Array.isArray(advice.recommended) ? advice.recommended : []) {
            if (!candidate.id || !candidate.type || !candidate.reason || !candidate.evidence) {
                fail('建议台账推荐项缺少 id/type/reason/evidence');
            }
        }
        info(`优化方向建议：tier=${advice.tier}，推荐 ${advice.recommended?.length ?? 0} 条，round ${advice.round}`);
    }
} else {
    info('未生成优化方向建议（可运行 npm run automation:advise -- --write）');
}

// ── 输出 ───────────────────────────────────────────────────
for (const line of infos) console.log(`[automation] ${line}`);
for (const line of warnings) console.warn(`[automation][warn] ${line}`);
for (const line of failures) console.error(`[automation][error] ${line}`);

if (failures.length > 0) {
    console.error(`[automation] 检查失败：${failures.length} 项`);
    process.exit(1);
}
console.log('[automation] 检查通过');
