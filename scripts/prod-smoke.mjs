#!/usr/bin/env node
/**
 * prod-smoke.mjs — 生产环境冒烟测试（真实 Obsidian + 真实 AI）
 *
 * 为什么需要：2026-11-13 生产测试抓到「AI 调用全线失败」——
 * `settings.apiKey` 为空、密钥只在 `providerKeys` 里，界面守卫能过、实际请求发不出去。
 * 8130 条单元测试全绿也没抓到（mock 里 apiKey 总是有值）。
 *
 * 本脚本用 Obsidian 官方 CLI 在真实实例上验证：
 * 1. 插件已加载且运行版本 == package.json 版本（否则先 reload，避免测旧代码）
 * 2. dev:errors 为空
 * 3. 真实 AI 调用：非流式 + 流式，都必须有内容且无 error
 * 4. 再查一次 dev:errors
 *
 * 代价：每次运行消耗几十 token（两次极短调用）。因此**不进 preflight**，
 * 只在发版前 / 怀疑 AI 链路坏了时跑。
 *
 * 用法：
 *   npm run check:prod              # 完整冒烟
 *   npm run check:prod -- --no-ai   # 只查版本与错误（零 token）
 *   npm run check:prod -- --json
 *
 * 退出码：0 全通过 / 1 有失败 / 2 环境不满足（Obsidian 未运行等）
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
    SMOKE_STATUS,
    countCapturedErrors,
    splitCapturedErrors,
    evaluateAiCall,
    evaluateVersionMatch,
    parsePluginInfo,
    summarizeSmoke,
} from './lib/prod-smoke-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN_ID = 'novel-writer-ai';
const argv = process.argv.slice(2);
const NO_AI = argv.includes('--no-ai');
const AS_JSON = argv.includes('--json');

const steps = [];

function record(name, status, detail) {
    steps.push({ name, status, detail });
    if (!AS_JSON) {
        const icon = status === SMOKE_STATUS.PASS ? '✅' : status === SMOKE_STATUS.FAIL ? '❌' : '⏭️';
        console.log(`${icon} ${name}${detail ? ` — ${detail}` : ''}`);
    }
}

/** 跑 obsidian CLI */
function obsidian(args) {
    const result = spawnSync('obsidian', args, {
        cwd: ROOT,
        encoding: 'utf8',
        timeout: 120_000,
        // 不用 shell：eval 的代码里含 `&&`、`||`、引号等字符，
        // 走 shell 会被当成命令分隔符/重定向（实测报 "r.content is not recognized"）。
    });
    return {
        ok: result.status === 0,
        status: result.status,
        stdout: (result.stdout || '').trim(),
        stderr: (result.stderr || '').trim(),
        error: result.error ? String(result.error.message || result.error) : '',
    };
}

/** 跑 obsidian eval 并把返回值取出来（输出形如 `=> ...`） */
function obsidianEval(code) {
    const r = obsidian(['eval', `code=${code}`]);
    if (!r.ok) return { ok: false, raw: r.stdout || r.stderr, error: r.error };
    const line = r.stdout.split('\n').find(l => l.startsWith('=>')) || r.stdout;
    return { ok: true, raw: line.replace(/^=>\s*/, '') };
}

/**
 * 执行异步 eval 并等待结果（2026-11-28 修真实缺陷）。
 *
 * 为什么需要：`obsidian eval` **不等待 Promise**——传 `(async()=>{...})()`
 * 会立刻返回 `=> undefined` 或直接无输出，永远拿不到结果。
 * （真实实例实测：连 `await new Promise(r=>setTimeout(r,2000))` 都不返回。）
 * 这导致本脚本的 AI 冒烟两步长期「假失败」（spawnSync ETIMEDOUT）。
 *
 * 做法：eval 里只「启动并把结果写进 window[key]」，本地轮询读取。
 *
 * @param code - 返回 Promise 的表达式
 * @param options - 轮询参数（pollMs / timeoutMs）
 * @returns 与 obsidianEval 同形
 * @example
 * const r = obsidianEvalAsync("p.aiEngine.callAI('s','u').then(x=>JSON.stringify(x))");
 */
function obsidianEvalAsync(code, options = {}) {
    const key = `__nwSmoke_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const pollMs = options.pollMs ?? 1000;
    const timeoutMs = options.timeoutMs ?? 150_000;

    const starter = obsidianEval(
        `(function(){window['${key}']={state:'pending'};`
        + `Promise.resolve(${code}).then(v=>{window['${key}']={state:'done',value:v};})`
        + `.catch(e=>{window['${key}']={state:'error',error:String((e&&e.message)||e)};});`
        + `return 'started';})()`,
    );
    if (!starter.ok) return starter;

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const probe = obsidianEval(`JSON.stringify(window['${key}']||{state:'missing'})`);
        if (probe.ok) {
            let parsed = null;
            try {
                parsed = JSON.parse(probe.raw);
            } catch {
                parsed = null;
            }
            if (parsed?.state === 'done') {
                const v = parsed.value;
                return { ok: true, raw: typeof v === 'string' ? v : JSON.stringify(v) };
            }
            if (parsed?.state === 'error') {
                return { ok: false, raw: String(parsed.error || 'async eval error'), error: 'async' };
            }
        }
        // 同步 sleep（本脚本是同步 CLI，不能 await）
        spawnSync(process.execPath, ['-e', `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,${pollMs})`]);
    }
    return { ok: false, raw: `async eval 超时（${timeoutMs}ms）`, error: 'timeout' };
}

// ── 0. 环境检查：Obsidian CLI 可用吗 ─────────────────────────────
const version = obsidian(['version']);
if (!version.ok || !/\d+\.\d+/.test(version.stdout)) {
    record('环境检查', SMOKE_STATUS.SKIP, 'obsidian CLI 不可用（Obsidian 未运行或未安装 CLI）');
    finish();
}

// ── 1. 插件信息与版本一致性 ─────────────────────────────────────
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const info = obsidian(['plugin', `id=${PLUGIN_ID}`]);
const parsed = info.ok ? parsePluginInfo(info.stdout) : null;
if (!parsed) {
    record('插件加载', SMOKE_STATUS.FAIL, `无法读取插件信息：${info.stdout || info.stderr || '无输出'}`);
    finish();
}
record('插件加载', SMOKE_STATUS.PASS, `version=${parsed.version || '?'} enabled=${parsed.enabled || '?'}`);

let runningVersion = parsed.version || '';
let versionCheck = evaluateVersionMatch({ runningVersion, expectedVersion: pkg.version });
if (!versionCheck.ok) {
    // 版本不一致 → 自动 reload 一次（发版后必做），reload 后复查
    if (!AS_JSON) console.log(`   ↻ 版本不一致，自动 plugin:reload …`);
    obsidian(['plugin:reload', `id=${PLUGIN_ID}`]);
    const info2 = obsidian(['plugin', `id=${PLUGIN_ID}`]);
    const parsed2 = info2.ok ? parsePluginInfo(info2.stdout) : null;
    runningVersion = parsed2?.version || '';
    versionCheck = evaluateVersionMatch({ runningVersion, expectedVersion: pkg.version });
}
record(
    '版本一致性',
    versionCheck.ok ? SMOKE_STATUS.PASS : SMOKE_STATUS.FAIL,
    versionCheck.ok ? `运行中 ${runningVersion} == package.json ${pkg.version}` : versionCheck.reason,
);

// ── 2. dev:errors 基线 ─────────────────────────────────────────
const errorsBefore = countCapturedErrors(obsidian(['dev:errors']).stdout);
record(
    '加载期无错误',
    errorsBefore === 0 ? SMOKE_STATUS.PASS : SMOKE_STATUS.FAIL,
    errorsBefore === 0 ? 'No errors captured' : `捕获到 ${errorsBefore ?? '未知数量'} 条错误`,
);

// ── 3. 真实 AI 调用（非流式 + 流式）────────────────────────────
if (NO_AI) {
    record('AI 冒烟', SMOKE_STATUS.SKIP, '--no-ai：跳过真实 AI 调用（零 token 模式）');
} else {
    // 非流式
    // 2026-11-28：改用 obsidianEvalAsync（obsidian eval 不等待 Promise）。
    // maxTokens 从 32 提到 300：reasoning 模型会把 32 全用在 reasoning_content 上，content 恒空。
    const nonStream = obsidianEvalAsync(
        "(function(){const p=app.plugins.plugins['novel-writer-ai'];"
        + "return p.aiEngine.callAI('你是测试助手。','请只回复两个字母：OK',undefined,undefined,300,{bypassCache:true})"
        + ".then(r=>JSON.stringify({content:r?r.content:null,error:r?r.error:null,finishReason:r?r.finishReason:null}));})()",
    );
    let nonStreamResult = null;
    try {
        nonStreamResult = nonStream.ok ? JSON.parse(nonStream.raw) : null;
    } catch {
        nonStreamResult = null;
    }
    if (!nonStream.ok || !nonStreamResult) {
        record('AI 非流式调用', SMOKE_STATUS.FAIL, `eval 失败：${nonStream.raw || nonStream.error || '无输出'}`);
    } else {
        const check = evaluateAiCall({ label: '非流式', result: nonStreamResult });
        record(
            'AI 非流式调用',
            check.ok ? SMOKE_STATUS.PASS : SMOKE_STATUS.FAIL,
            check.ok ? `content=${check.contentLength} 字符 / finishReason=${check.finishReason}` : check.reason,
        );
    }

    // 流式（写章/共写主路径）
    const stream = obsidianEvalAsync(
        "(function(){const p=app.plugins.plugins['novel-writer-ai'];"
        + "return p.aiEngine.callAIStream('你是测试助手。','请只回复：流式成功',undefined,undefined,300)"
        + ".then(r=>JSON.stringify({content:r?r.content:null,error:r?r.error:null,finishReason:r?r.finishReason:null}));})()",
    );
    let streamResult = null;
    try {
        streamResult = stream.ok ? JSON.parse(stream.raw) : null;
    } catch {
        streamResult = null;
    }
    if (!stream.ok || !streamResult) {
        record('AI 流式调用', SMOKE_STATUS.FAIL, `eval 失败：${stream.raw || stream.error || '无输出'}`);
    } else {
        const check = evaluateAiCall({ label: '流式', result: streamResult });
        record(
            'AI 流式调用',
            check.ok ? SMOKE_STATUS.PASS : SMOKE_STATUS.FAIL,
            check.ok ? `content=${check.contentLength} 字符 / finishReason=${check.finishReason}` : check.reason,
        );
    }
}

// ── 4. 调用后再查错误 ──────────────────────────────────────────
// 2026-11-28：只把「插件相关」条目计为失败；Obsidian 自身的网络类报错
// （如系统代理失效时的 getUserInfo）是环境问题，单独计数并在 detail 里注明。
const errorsAfterRaw = obsidian(['dev:errors']).stdout;
const errorsAfter = splitCapturedErrors(errorsAfterRaw);
record(
    '运行期无新增错误',
    !errorsAfter || errorsAfter.pluginCount === 0 ? SMOKE_STATUS.PASS : SMOKE_STATUS.FAIL,
    !errorsAfter
        ? '无法读取 dev:errors'
        : errorsAfter.pluginCount === 0
            ? (errorsAfter.environmentalCount > 0
                ? `无插件错误（另有 ${errorsAfter.environmentalCount} 条 Obsidian 自身报错，多为网络/代理环境问题）`
                : 'No errors captured')
            : `捕获到 ${errorsAfter.pluginCount} 条插件相关错误`,
);

finish();

function finish() {
    const summary = summarizeSmoke(steps);
    if (AS_JSON) {
        console.log(JSON.stringify({ summary, steps }, null, 2));
    } else {
        console.log('');
        console.log(`合计：${summary.total} 步 / 通过 ${summary.passed} / 失败 ${summary.failed} / 跳过 ${summary.skipped}`);
    }
    if (summary.hasFailure) {
        if (!AS_JSON) console.error('\n❌ 生产冒烟失败——先修再发版。');
        process.exit(1);
    }
    if (summary.hasSkip) {
        if (!AS_JSON) {
            console.error('\n⚠️ 有步骤被跳过（环境不满足）。**skip 不算通过**：'
                + '请在真实 Obsidian 上跑完整冒烟后再下结论。');
        }
        process.exit(2);
    }
    if (!AS_JSON) console.log('\n✅ 生产冒烟全部通过。');
    process.exit(0);
}
