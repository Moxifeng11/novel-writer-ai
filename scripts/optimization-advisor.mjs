#!/usr/bin/env node
/**
 * optimization-advisor.mjs — 自动化优化方向判断 CLI
 *
 * 采集 git / canonical 台账 / 门禁 / 信箱 / 文档事实，调用
 * shared/optimization-advisor.ts 的纯函数规则，输出结构化建议。
 *
 * 用法：
 *   npm run automation:advise                 # 人类可读摘要
 *   npm run automation:advise -- --json       # 结构化 JSON
 *   npm run automation:advise -- --write      # 落盘 .trae/automation/optimization-advice.json
 *   npm run automation:advise -- --check      # 校验功能可用与建议新鲜度
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VAULT_ROOT = path.resolve(ROOT, '..', '..', '..');
const STATE_PATH = path.join(ROOT, '.trae/automation/trae-loop-state.json');
const ADVICE_PATH = path.join(ROOT, '.trae/automation/optimization-advice.json');
const args = process.argv.slice(2);
const asJson = args.includes('--json');
const write = args.includes('--write');
const check = args.includes('--check');
const warnings = [];
const core = await import('../shared/optimization-advisor.ts');

function readJson(file, fallback) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        return fallback;
    }
}

function statSize(file) {
    try {
        return fs.statSync(file).size;
    } catch {
        return undefined;
    }
}

function git(...gitArgs) {
    try {
        // 只裁尾部：`git status --porcelain` 首行以空格开头（" M path"），整体 trim() 会吃掉状态列
        return execFileSync('git', gitArgs, { cwd: ROOT, encoding: 'utf8' }).trimEnd();
    } catch {
        return '';
    }
}

function localNow() {
    const date = new Date();
    const pad = value => String(value).padStart(2, '0');
    const offset = -date.getTimezoneOffset();
    const sign = offset >= 0 ? '+' : '-';
    const absolute = Math.abs(offset);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
        + `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
        + `${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
}

function collectWorktree(state) {
    const status = git('status', '--porcelain');
    if (!status) return { modified: 0, untracked: 0, unrecorded: 0, unrecordedPaths: [] };
    const lines = status.split('\n').filter(Boolean);
    const paths = lines.map(line => line.slice(3).trim());
    const backlog = state?.constraints?.backlog ?? {};
    const recorded = new Set([
        ...(Array.isArray(state?.lastRound?.result?.changedFiles) ? state.lastRound.result.changedFiles : []),
        ...(Array.isArray(backlog.untracked) ? backlog.untracked : []),
        ...(Array.isArray(backlog.inFlightPaths) ? backlog.inFlightPaths : []),
    ]);
    const unrecordedPaths = paths.filter(item => !recorded.has(item));
    return {
        modified: lines.filter(line => !line.startsWith('??')).length,
        untracked: lines.filter(line => line.startsWith('??')).length,
        unrecorded: unrecordedPaths.length,
        unrecordedPaths,
    };
}

function collectHandoff() {
    const rulesPath = path.join(VAULT_ROOT, 'PROJECT-RULES.md');
    let text = '';
    try {
        text = fs.readFileSync(rulesPath, 'utf8');
    } catch {
        warnings.push('未找到 PROJECT-RULES.md，交接快照判断降级');
        return { version: '', updatedAt: '', stale: false };
    }
    const block = text.match(/<!-- HANDOFF:START -->([\s\S]*?)<!-- HANDOFF:END -->/);
    if (!block) {
        warnings.push('PROJECT-RULES.md 缺少 HANDOFF 块');
        return { version: '', updatedAt: '', stale: false };
    }
    const versionLine = block[1].match(/^- 版本 \/ 提交：v?([0-9.]+)/m);
    const updatedLine = block[1].match(/^- 更新时间：([^\n]+)/m);
    const version = versionLine ? versionLine[1] : '';
    const updatedAt = updatedLine ? updatedLine[1].trim() : '';
    let stale = false;
    if (updatedAt) {
        const parsed = Date.parse(updatedAt);
        stale = Number.isNaN(parsed) ? false : Date.now() - parsed > 24 * 60 * 60 * 1000;
    }
    return { version, updatedAt, stale };
}

function inferHintType(subject) {
    if (/any|类型收口/i.test(subject)) return 'gate-fix';
    if (/测试|用例|覆盖/i.test(subject)) return 'test-hardening';
    if (/文档|手册|指南|一致性/i.test(subject)) return 'docs-correction';
    if (/体积|性能|bundle|启动|hotpath/i.test(subject)) return 'perf';
    if (/审计|盘点|只读/i.test(subject)) return 'audit-only';
    if (/阶段|面板|导出|出版|工作台|创作/i.test(subject)) return 'v5-product';
    return undefined;
}

function collectDispatch(currentRound, lastDispatchId) {
    const mailboxPath = path.join(VAULT_ROOT, '.trae/mailbox/messages.jsonl');
    if (!fs.existsSync(mailboxPath)) return undefined;
    let lines = [];
    try {
        lines = fs.readFileSync(mailboxPath, 'utf8').trim().split('\n').filter(Boolean).slice(-40);
    } catch {
        return undefined;
    }
    const incoming = [];
    for (const line of lines) {
        try {
            const message = JSON.parse(line);
            if (message.from === 'zcode' && message.to === 'trae') incoming.push(message);
        } catch {
            // 单行损坏不阻断判断
        }
    }
    for (let index = incoming.length - 1; index >= 0; index -= 1) {
        const message = incoming[index];
        const subject = message.subject || '';
        if (!/派工|候选|请执行|请确认|批准/.test(subject)) continue;
        if (/已收单/.test(subject) && !/派工/.test(subject)) continue;
        if (!core.isFreshDispatch(subject, currentRound, message.ts || '', Date.now(), {
            messageId: message.id,
            lastDispatchId,
        })) continue;
        return {
            subject,
            hintType: inferHintType(subject),
            sourceId: message.id,
        };
    }
    return undefined;
}

function collectAnyBuckets(anyBaseline) {
    const files = anyBaseline?.files;
    if (!files || typeof files !== 'object') return undefined;
    const buckets = { redline: 0, design: 0, movable: 0 };
    for (const [file, count] of Object.entries(files)) {
        const amount = Number(count) || 0;
        if (file.startsWith('engine/') || file.startsWith('ui/views/')) buckets.redline += amount;
        else if (file === 'shared/types.ts') buckets.design += amount;
        else buckets.movable += amount;
    }
    return buckets;
}

function collectFacts(params, rounds) {
    const state = readJson(STATE_PATH, null);
    const bundle = readJson(path.join(ROOT, '.bundle-baseline.json'), { files: {} });
    const program = readJson(path.join(ROOT, 'docs/progress/program-status.json'), { baseline: {} });
    const pkg = readJson(path.join(ROOT, 'package.json'), { version: '' });
    const handoff = collectHandoff();
    const gateMargins = state?.constraints?.gateMargins ?? {};
    const preflightText = String(gateMargins.preflight ?? '');
    const preflightOk = preflightText ? preflightText.includes('EXIT=0') : true;
    if (!preflightText) warnings.push('台账缺少 preflight 结果，按通过处理');
    const anyBaseline = readJson(path.join(ROOT, '.any-baseline.json'), null);
    const anyText = String(gateMargins.any ?? '');
    const anyMatch = anyText.match(/存量\s*(\d+)/) ?? anyText.match(/余量\s*(\d+)/);
    const anyRemaining = core.resolveMetricWithFallback(
        typeof anyBaseline?.total === 'number' ? anyBaseline.total : undefined,
        anyMatch ? Number(anyMatch[1]) : 0,
    );
    const anyBuckets = collectAnyBuckets(anyBaseline);
    const bundleBytes = core.resolveMetricWithFallback(
        statSize(path.join(ROOT, 'main.js')),
        bundle?.files?.['main.js'] ?? 0,
    );
    const startupBaselineBytes = state?.params?.startupEvalBaselineBytes ?? 0;
    const tests = program?.baseline?.tests ?? { files: 0, cases: 0 };
    return {
        round: state?.round ?? 0,
        params,
        recentRounds: rounds,
        worktree: collectWorktree(state),
        gates: { preflightOk, anyRemaining, anyBuckets, bundleBytes, startupBaselineBytes },
        docs: {
            versionMismatch: handoff.version !== '' && pkg.version !== '' && handoff.version !== pkg.version,
            handoffStale: handoff.stale,
        },
        tests: { files: tests.files ?? 0, cases: tests.cases ?? 0 },
        dispatch: collectDispatch(state?.round ?? 0, state?.lastDispatchId),
    };
}

async function main() {
    const state = readJson(STATE_PATH, null);
    const suppliedParams = state?.params ?? {};
    const params = {
        ...core.DEFAULT_ADVISOR_PARAMS,
        ...suppliedParams,
        typeWeights: { ...core.DEFAULT_ADVISOR_PARAMS.typeWeights, ...(suppliedParams.typeWeights ?? {}) },
        failurePenalty: { ...core.DEFAULT_ADVISOR_PARAMS.failurePenalty, ...(suppliedParams.failurePenalty ?? {}) },
    };
    const rounds = Array.isArray(state?.rounds)
        ? state.rounds.slice(-6).map(item => ({
            round: item.round,
            type: String(item.type ?? ''),
            reverted: Boolean(item.result?.reverted),
            testsAdded: Number(item.result?.testsAdded ?? 0),
        }))
        : [];
    if (!state) warnings.push('缺少 canonical 台账，使用默认参数与空历史');
    const facts = collectFacts(params, rounds);
    const decision = core.decideOptimizationAdvice(facts);
    const head = git('rev-parse', '--short', 'HEAD') || '?';
    const ahead = git('rev-list', '--count', 'origin/master..HEAD') || '?';
    const payload = {
        schemaVersion: 1,
        generatedAt: localNow(),
        round: facts.round,
        head,
        ahead,
        worktree: facts.worktree,
        tier: decision.tier,
        tierLabel: decision.tierLabel,
        recommended: decision.recommended,
        alternatives: decision.alternatives,
        warnings: [...warnings, ...decision.warnings],
        inputs: {
            preflightOk: facts.gates.preflightOk,
            anyRemaining: facts.gates.anyRemaining,
            anyBuckets: facts.gates.anyBuckets ?? null,
            bundleBytes: facts.gates.bundleBytes,
            startupBaselineBytes: facts.gates.startupBaselineBytes,
            tests: facts.tests,
            dispatchSource: facts.dispatch?.sourceId ?? '',
        },
    };

    if (write) {
        fs.mkdirSync(path.dirname(ADVICE_PATH), { recursive: true });
        fs.writeFileSync(ADVICE_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    }

    if (check) {
        const failures = [];
        if (facts.round < 1) failures.push('台账 round 缺失或非法');
        if (decision.recommended.length < 1 || decision.recommended.length > 2) {
            failures.push(`推荐数量应为 1–2，实际 ${decision.recommended.length}`);
        }
        for (const candidate of decision.recommended) {
            if (!candidate.evidence || !candidate.reason) failures.push(`候选 ${candidate.id} 缺少证据或理由`);
        }
        if (fs.existsSync(ADVICE_PATH)) {
            const saved = readJson(ADVICE_PATH, null);
            if (!saved) failures.push('已落盘建议不是合法 JSON');
            else {
                if (saved.schemaVersion !== 1) failures.push('已落盘建议 schemaVersion 应为 1');
                if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})$/.test(saved.generatedAt || '')) {
                    failures.push('已落盘建议 generatedAt 缺少时区');
                }
                if (Number.isInteger(saved.round) && Math.abs(saved.round - facts.round) > 1) {
                    failures.push(`已落盘建议 round ${saved.round} 落后当前 ${facts.round} 超过 1 轮`);
                }
                if (!['dispatch', 'backlog', 'gate', 'score', 'idle'].includes(saved.tier)) {
                    failures.push(`已落盘建议 tier 非法：${saved.tier}`);
                }
                if (!Array.isArray(saved.recommended) || saved.recommended.length < 1 || saved.recommended.length > 2) {
                    failures.push('已落盘建议 recommended 应为 1–2 条');
                }
            }
        }
        if (failures.length > 0) {
            for (const failure of failures) console.error(`[advise][error] ${failure}`);
            process.exit(1);
        }
        console.log('[advise] 自检通过');
        return;
    }

    if (asJson) {
        console.log(JSON.stringify(payload, null, 2));
        return;
    }

    console.log(`[advise] round ${facts.round} / HEAD ${head} / ahead ${ahead} / 工作树 ${facts.worktree.modified}M+${facts.worktree.untracked}??`);
    console.log(`[advise] 层级：${decision.tierLabel}`);
    decision.recommended.forEach((candidate, index) => {
        console.log(`[advise] 推荐 ${index + 1}：${candidate.title}（${candidate.type}，score ${candidate.score}）`);
        console.log(`         依据：${candidate.reason}`);
        console.log(`         证据：${candidate.evidence}`);
    });
    if (decision.alternatives.length > 0) {
        console.log(`[advise] 备选：${decision.alternatives.map(candidate => `${candidate.title}（${candidate.score}）`).join('；')}`);
    }
    for (const warning of payload.warnings) console.log(`[advise][warn] ${warning}`);
    if (!write && !asJson) console.log('[advise] 结构化输出：npm run automation:advise -- --json；落盘：--write');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch(error => {
        console.error(`[advise][error] ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    });
}
