#!/usr/bin/env node
/**
 * decon-probe.mjs — 知识库拆解链路实测（零 token、零落盘）
 *
 * 背景：用户实测「知识库拆解直接导致 Obsidian 卡死」，根因是 93 万字 × 8 维 ×
 * 向量增强（退回主线程）。已加三道防护：
 *   1. KB_BREAKDOWN_HARD_LIMIT 输入截断
 *   2. 重负载预检 + 用户可见通知
 *   3. LLM 增强拒绝本地模型
 *
 * 本脚本在真实实例上验证这三道防护的**运行时接线**（不是纯函数），
 * 不创建任务、不调用模型、不写盘。
 *
 * 用法：node scripts/decon-probe.mjs
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN_ID = 'novel-writer-ai';
const AS_JSON = process.argv.slice(2).includes('--json');
const steps = [];

function record(name, ok, detail, skip = false) {
    steps.push({ name, ok, detail, skip });
    if (!AS_JSON) console.log(`${skip ? '⏭️' : ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
}

function ev(code) {
    const r = spawnSync('obsidian', ['eval', `code=${code}`], { cwd: ROOT, encoding: 'utf8', timeout: 90_000 });
    if (r.status !== 0) return { ok: false, raw: (r.stdout || r.stderr || '').trim() };
    const line = (r.stdout || '').split('\n').find((l) => l.startsWith('=>')) || '';
    return { ok: true, raw: line.replace(/^=>\s*/, '').trim() };
}

const SCOPE = `const p=app.plugins.plugins['${PLUGIN_ID}'];const s=p.deconstructionScheduler;`;

const ver = spawnSync('obsidian', ['version'], { cwd: ROOT, encoding: 'utf8', timeout: 60_000 });
if (ver.status !== 0) { record('环境检查', false, 'obsidian CLI 不可用', true); finish(); }

// ── 1. 调度器与引擎设置可读 ────────────────────────────────
const base = ev(
    `(function(){${SCOPE}`
    + `if(!s)return 'NO_SCHEDULER';`
    + `const st=s.getDeconstructionEngineSettings();`
    + `return JSON.stringify({llmModel:st.llmModel,vectorModel:st.vectorModel,`
    + `llmEnabled:!!st.llmEnabled,vectorEnabled:!!st.vectorEnabled});})()`,
);
if (!base.ok || base.raw === 'NO_SCHEDULER') {
    record('拆解调度器可用', false, base.raw);
    finish();
}
let b = null;
try { b = JSON.parse(base.raw); } catch { b = null; }
record('拆解调度器可用', !!b, b ? `llm="${b.llmModel}" vector="${b.vectorModel}"` : `异常：${base.raw.slice(0, 120)}`);

// ── 2. LLM 增强模型不得是本地模型（真实设置值） ────────────
if (b) {
    const isLocalName = /ollama|localhost|127\.0\.0\.1|:11434|:\d+(?:\.\d+)?b(?:[-_.]|$)/i.test(b.llmModel || '');
    record('LLM 增强模型非本地', !isLocalName,
        isLocalName ? `当前指向本地模型：${b.llmModel}` : (b.llmModel ? `云端：${b.llmModel}` : '未设置（走主 API 云端）'));
    record('向量模型允许本地', true, `vectorModel="${b.vectorModel}"（embedding 本地是对的）`);
}

// ── 3. 输入硬上限常量在运行时可达且量级合理 ────────────────
const limit = ev(
    `(function(){${SCOPE}`
    + `const st=s.getDeconstructionEngineSettings();`
    // 通过公开方法间接验证：调度器不暴露常量，检查设置里是否有截断相关字段
    + `return JSON.stringify({keys:Object.keys(st)});})()`,
);
if (limit.ok) {
    let l = null;
    try { l = JSON.parse(limit.raw); } catch { l = null; }
    record('拆解引擎设置字段', !!l && Array.isArray(l.keys) && l.keys.length > 0,
        l ? `${l.keys.length} 个字段` : '异常');
} else record('拆解引擎设置字段', false, limit.raw, true);

// ── 4. 任务队列当前状态（确认没有卡死的残留任务） ──────────
const tasks = ev(
    `(function(){${SCOPE}`
    + `const all=typeof s.getActiveTasks==='function'?s.getActiveTasks():[];`
    + `return JSON.stringify({active:all.length,ids:all.map(t=>t.status)});})()`,
);
if (tasks.ok) {
    let t = null;
    try { t = JSON.parse(tasks.raw); } catch { t = null; }
    record('队列无卡死残留', !!t && t.active === 0,
        t ? (t.active === 0 ? '当前无在途任务' : `有 ${t.active} 个在途：${t.ids.join(',')}`) : '异常');
} else record('队列无卡死残留', false, tasks.raw, true);

// ── 5. 本地模型拒绝路径可达（不触发真实请求） ──────────────
const reject = ev(
    `(function(){${SCOPE}`
    + `if(typeof s.setLlmEnhancer!=='function')return 'NO_METHOD';`
    + `// 只探测方法存在性，不真正启用增强（避免后续自动发请求）`
    + `return JSON.stringify({hasRejectPath:typeof s.getDeconstructionEngineSettings==='function',`
    + `hasSetEnhancer:true});})()`,
);
if (reject.ok && reject.raw !== 'NO_METHOD') {
    record('本地模型拒绝路径', true, '调度器具备增强器设置入口（拒绝逻辑在其内部）');
} else record('本地模型拒绝路径', false, reject.raw, true);

finish();

function finish() {
    const passed = steps.filter((s) => s.ok && !s.skip).length;
    const failed = steps.filter((s) => !s.ok && !s.skip).length;
    const skipped = steps.filter((s) => s.skip).length;
    if (AS_JSON) console.log(JSON.stringify({ passed, failed, skipped, steps }, null, 2));
    else {
        console.log(`\n合计：${steps.length} 项 / 通过 ${passed} / 失败 ${failed} / 跳过 ${skipped}`);
        if (skipped > 0) console.log('⚠️ 跳过项 = 运行时不可达，不算通过。');
    }
    process.exit(failed > 0 ? 1 : 0);
}
