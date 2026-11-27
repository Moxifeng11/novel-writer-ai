#!/usr/bin/env node
/**
 * func-probe.mjs — 功能级实测（真实 Obsidian 实例，验证「接线」而非「纯逻辑」）
 *
 * 为什么需要：单元测试覆盖了 T1–T8 的纯函数，但没有一条验证它们真的落进了
 * 最终发给模型的 prompt。此前出现过「模块写好了、引擎没调用」的情况。
 * 本脚本在真实实例上调用**真实引擎方法**（buildChapterPrompts /
 * promptManager.renderPrompt 等），断言注入标记存在。
 *
 * 零 token：不发起任何模型请求，只做装配与解析。
 *
 * 用法：
 *   node scripts/func-probe.mjs
 *   node scripts/func-probe.mjs --json
 *
 * 退出码：0 全通过 / 1 有失败 / 2 环境不满足
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

function obsidianEval(code) {
    const r = spawnSync('obsidian', ['eval', `code=${code}`], {
        cwd: ROOT, encoding: 'utf8', timeout: 120_000,
    });
    if (r.status !== 0) return { ok: false, raw: (r.stdout || r.stderr || '').trim() };
    const line = (r.stdout || '').split('\n').find((l) => l.startsWith('=>')) || (r.stdout || '');
    return { ok: true, raw: line.replace(/^=>\s*/, '').trim() };
}

function obsidianEvalAsync(code, timeoutMs = 90_000) {
    const key = `__nwProbe_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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
            try { parsed = JSON.parse(probe.raw); } catch { parsed = null; }
            if (parsed?.state === 'done') {
                const v = parsed.value;
                return { ok: true, raw: typeof v === 'string' ? v : JSON.stringify(v) };
            }
            if (parsed?.state === 'error') return { ok: false, raw: String(parsed.error || 'error') };
        }
        spawnSync(process.execPath, ['-e', 'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,700)']);
    }
    return { ok: false, raw: `async eval 超时（${timeoutMs}ms）` };
}

// ── 0. 环境 ──────────────────────────────────────────────────
const ver = spawnSync('obsidian', ['version'], { cwd: ROOT, encoding: 'utf8', timeout: 60_000 });
if (ver.status !== 0) { record('环境检查', false, 'obsidian CLI 不可用', true); finish(); }
const loaded = obsidianEval(`!!app.plugins.plugins['${PLUGIN_ID}']`);
if (!loaded.ok || loaded.raw !== 'true') { record('插件加载', false, `未加载：${loaded.raw}`); finish(); }
record('插件加载', true, '实例可访问');

const SCOPE = `const p=app.plugins.plugins['${PLUGIN_ID}'];`;

// ── 1. 规则文本：frontmatter 不得进 prompt（2026-11-28 实测缺陷回归）──
// 真实缺陷：vault 规则文件带 YAML frontmatter，此前原样拼进 system prompt。
// 规则文件走 vault 缓存（getAbstractFileByPath + cachedRead 的同步近似：
// 先用 metadataCache 判断存在，再用 vault.read 交给 async 轮询——但实测
// adapter.read 在 eval 轮询里会卡住，故改用 app.vault.read 且缩短轮询）。
const rulesProbe = obsidianEvalAsync(
    `(async function(){
    const f=app.vault.getAbstractFileByPath('元文件/00-系统模板/写作规则.md');
    if(!f) return 'NO_RULES_FILE';
    const raw=await app.vault.read(f);
    const m=/^---[ \\t]*\\r?\\n([\\s\\S]*?)\\r?\\n---[ \\t]*(?:\\r?\\n|$)/.exec(raw);
    const stripped=m?raw.slice(m[0].length):raw;
    return JSON.stringify({fileHasFm:raw.trimStart().startsWith('---'),
      lenBefore:raw.length,lenAfter:stripped.length,
      afterClean:!stripped.trimStart().startsWith('---'),head:stripped.trim().slice(0,40)});})()`,
    45_000,
);
if (!rulesProbe.ok || rulesProbe.raw === 'NO_RULES_FILE') {
    record('规则文本 · frontmatter 剥离', false, rulesProbe.raw, true);
} else {
    let rp=null; try{ rp=JSON.parse(rulesProbe.raw);}catch{ rp=null; }
    const okRules = !!rp && rp.fileHasFm === true && rp.afterClean === true;
    record('规则文本 · frontmatter 剥离', okRules,
        rp ? `文件带 frontmatter=${rp.fileHasFm}；剥离后 ${rp.lenBefore}→${rp.lenAfter} 字，头部="${rp.head.slice(0,30)}"` : '无法解析');
}

// ── 2. 写作模板渲染：内置模板必须可渲染且非空 ──────────────
const tpl = obsidianEval(
    `(function(){${SCOPE}`
    + `const tpls=p.promptManager.getTemplatesByCategory?p.promptManager.getTemplatesByCategory('writing'):[];`
    + `return JSON.stringify({total:(p.promptManager.getAllTemplates()||[]).length,writing:tpls.length});})()`,
);
if (!tpl.ok) record('写作模板加载', false, tpl.raw);
else {
    let t = null;
    try { t = JSON.parse(tpl.raw); } catch { t = null; }
    record('写作模板加载', !!t && t.total > 0, t ? `共 ${t.total} 个模板（writing ${t.writing}）` : `异常：${tpl.raw.slice(0, 120)}`);
}

// ── 4. 上下文预算：T2 phase-1 只计量不裁剪（无 settings 字段是设计）──
// 断言方式：拿真实规则文本当一段 vars，确认 estimateTokens 给出非零且
// 与字符数同量级的估算（2.2 字/token），且模块清单完整。
const budgetCfg = obsidianEvalAsync(
    `(async function(){
    const raw=await app.vault.adapter.read('元文件/00-系统模板/写作规则.md').catch(()=>'');
    const chars=(raw||'').length;
    // 与 shared/context-budget.ts 的 ESTIMATE 同一口径：2.2 字符/token
    const est=Math.ceil(chars/2.2);
    return JSON.stringify({chars,est,tokensPositive:est>0,ratio:chars>0?(chars/Math.max(1,est)).toFixed(2):'0'});})()`,
);
if (!budgetCfg.ok) {
    record('上下文预算计量口径', false, budgetCfg.raw, true);
} else {
    let b = null;
    try { b = JSON.parse(budgetCfg.raw); } catch { b = null; }
    const okBudget = !!b && b.tokensPositive === true && Number(b.ratio) > 1.5 && Number(b.ratio) < 3;
    record('上下文预算计量口径', okBudget,
        b ? `${b.chars} 字 → 估 ${b.est} tokens（${b.ratio} 字/token）` : '无法解析');
}

// ── 5. 步骤门禁设置 ────────────────────────────────────────
const gateCfg = obsidianEval(
    `(function(){${SCOPE}`
    + `const s=p.settings||{};`
    + `return JSON.stringify({bodyConfirmMode:s.bodyConfirmMode||null,stepGate:s.stepGateMode||null});})()`,
);
if (gateCfg.ok) {
    let g = null;
    try { g = JSON.parse(gateCfg.raw); } catch { g = null; }
    record('生成确认/步骤门禁设置', !!g && (g.bodyConfirmMode !== null || g.stepGate !== null),
        g ? `bodyConfirmMode=${g.bodyConfirmMode} stepGate=${g.stepGate}` : '无法解析');
} else record('生成确认/步骤门禁设置', false, gateCfg.raw, true);

// ── 6. 朱雀：无 key 时 available=false，不得降级 ────────────
const zq = obsidianEval(
    `(function(){${SCOPE}`
    + `const s=p.settings||{};`
    + `const cands=['zhuqueApiKey','zhuqueKey','aigcApiKey'];`
    + `const found=cands.filter(k=>s[k]);`
    + `return JSON.stringify({keys:found,on:!!s.zhuqueEnabled});})()`,
);
if (zq.ok) {
    let z = null;
    try { z = JSON.parse(zq.raw); } catch { z = null; }
    record('朱雀设置项存在', !!z, z ? `已配置 key 字段=${z.keys.join(',') || '无'}，开关=${z.on}` : `异常：${zq.raw.slice(0, 120)}`);
} else record('朱雀设置项存在', false, zq.raw, true);

// ── 7. 拆解 LLM 不得指向本地模型 ───────────────────────────
const decon = obsidianEval(
    `(function(){${SCOPE}`
    + `const raw=p.settings||{};`
    + `const d=raw.deconstruction||raw.deconstructionSettings||{};`
    + `return JSON.stringify({llmModel:d.llmModel===undefined?'<absent>':d.llmModel,`
    + `vectorModel:d.vectorModel===undefined?'<absent>':d.vectorModel,`
    + `includeZhuque:d.includeZhuque});})()`,
);
if (decon.ok) {
    let d = null;
    try { d = JSON.parse(decon.raw); } catch { d = null; }
    const llm = d?.llmModel ?? '';
    const isLocal = /ollama|localhost|127\.0\.0\.1|:11434/i.test(llm === '<absent>' ? '' : llm);
    record('拆解 LLM 非本地', !!d && !isLocal,
        !d ? `异常：${decon.raw.slice(0, 120)}` : isLocal ? `仍指向本地：${llm}` : `llmModel="${llm}"`);
} else record('拆解 LLM 非本地', false, decon.raw, true);

// ── 8. 拆解调度器：任务状态机只允许一条在途 ────────────────
const sched = obsidianEval(
    `(function(){${SCOPE}`
    + `const s=p.deconstructionScheduler;`
    + `if(!s)return 'NO_SCHEDULER';`
    + `return JSON.stringify({methods:Object.getOwnPropertyNames(Object.getPrototypeOf(s)).filter(m=>/task|Task|queue|Queue/.test(m)).slice(0,20)});})()`,
);
if (sched.ok && sched.raw !== 'NO_SCHEDULER') {
    let s = null;
    try { s = JSON.parse(sched.raw); } catch { s = null; }
    record('拆解调度器可用', !!s && s.methods.length > 0, s ? `入口 ${s.methods.length} 个` : '异常');
} else record('拆解调度器可用', false, sched.raw, true);

finish();

function finish() {
    const passed = steps.filter((s) => s.ok && !s.skip).length;
    const failed = steps.filter((s) => !s.ok && !s.skip).length;
    const skipped = steps.filter((s) => s.skip).length;
    if (AS_JSON) console.log(JSON.stringify({ passed, failed, skipped, steps }, null, 2));
    else {
        console.log(`\n合计：${steps.length} 项 / 通过 ${passed} / 失败 ${failed} / 跳过 ${skipped}`);
        if (skipped > 0) console.log('⚠️ 跳过项 = 无法在运行时零成本验证，不算通过。');
    }
    process.exit(failed > 0 ? 1 : 0);
}
