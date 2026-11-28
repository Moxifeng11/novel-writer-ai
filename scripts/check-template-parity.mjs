#!/usr/bin/env node
/**
 * check-template-parity.mjs — PromptManager 默认步骤模板 ↔ 引擎 canonical 同源门禁
 *
 * 背景（2026-11-28 实测）：PromptManager 默认模板与流水线实际生效的模板
 * （template-utils.getStepTemplate → engine/prompts/* 常量）是**两份文本**。
 * 6 个步骤默认模板全部漂移后已修复为单一来源：常量本体在 shared/prompts/，
 * prompt-templates-default 直接引用常量。本门禁防止两份再次漂移——
 * 任何人在 PromptManager 默认值里手改正文（而不是改 canonical）都会被拦。
 *
 * 比对映射：
 * - infoPlan/plotDistill/outline/emotionPlan/sceneExpand → getStepTemplate(stepKey)
 * - bodyGeneration → BODY_GENERATION_*_V2 常量（auto 变体默认生效版）
 *
 * 用法：node scripts/check-template-parity.mjs（exit 0 同源 / 1 漂移）
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const esbuild = require(path.join(ROOT, 'node_modules', 'esbuild'));
const os = await import('node:os');

function bundle(entry, outfile) {
    esbuild.buildSync({
        entryPoints: [path.join(ROOT, entry)],
        bundle: true,
        platform: 'node',
        format: 'cjs',
        outfile,
        logLevel: 'silent',
        external: ['obsidian'],
    });
    delete require.cache[outfile];
    return require(outfile);
}

const tmp = os.tmpdir();
const tu = bundle('engine/prompts/template-utils.ts', path.join(tmp, 'nw-parity-tu.cjs'));
const pmMod = bundle('services/prompt-templates-default.ts', path.join(tmp, 'nw-parity-pm.cjs'));
const bodyV2 = bundle('shared/prompts/body-v2-prompts.ts', path.join(tmp, 'nw-parity-body.cjs'));

const defaults = pmMod.DEFAULT_PROMPT_TEMPLATES;
if (!Array.isArray(defaults) || defaults.length === 0) {
    console.error('[template-parity] ❌ DEFAULT_PROMPT_TEMPLATES 为空——prompt-templates-default 结构变化，请同步本门禁');
    process.exit(2);
}

const MAPPINGS = [
    { stepKey: 'infoPlan', tplId: 'info-plan' },
    { stepKey: 'plotDistill', tplId: 'plot-distill' },
    { stepKey: 'outline', tplId: 'outline-generation' },
    { stepKey: 'emotionPlan', tplId: 'emotion-plan' },
    { stepKey: 'sceneExpand', tplId: 'scene-expand' },
    {
        stepKey: 'bodyGeneration',
        tplId: 'body-generation-v2',
        canonical: {
            systemPrompt: bodyV2.BODY_GENERATION_SYSTEM_PROMPT_V2,
            userPrompt: bodyV2.BODY_GENERATION_USER_TEMPLATE_V2,
        },
        note: '（auto 变体默认生效版为 V2）',
    },
];

const norm = (t) => String(t ?? '').replace(/\r\n/g, '\n').trim();
const placeholders = (t) => [...new Set([...String(t ?? '').matchAll(/\$\{([a-zA-Z_]+)\}/g)].map(m => m[1]))];

let failed = 0;
for (const { stepKey, tplId, canonical, note } of MAPPINGS) {
    const reg = canonical ?? tu.getStepTemplate(stepKey);
    if (!reg || !reg.systemPrompt) {
        console.error(`[template-parity] ❌ ${stepKey}: canonical 缺失（getStepTemplate 无返回）`);
        failed++;
        continue;
    }
    const pm = defaults.find(t => t.id === tplId);
    if (!pm || !pm.versions || !pm.versions[0]) {
        console.error(`[template-parity] ❌ ${tplId}: PromptManager 默认值缺失`);
        failed++;
        continue;
    }
    const pmV = pm.versions[0];
    const sysSame = norm(reg.systemPrompt) === norm(pmV.systemPrompt);
    const usrSame = norm(reg.userPrompt) === norm(pmV.userPrompt);
    if (sysSame && usrSame) {
        console.log(`[template-parity] ✅ ${stepKey} → ${tplId}${note ?? ''}`);
        continue;
    }
    failed++;
    console.error(`[template-parity] ❌ ${stepKey} → ${tplId} 漂移${note ?? ''}`);
    console.error(`   system: canonical ${reg.systemPrompt.length} 字 vs 默认 ${pmV.systemPrompt.length} 字${sysSame ? '（同）' : '（不同）'}`);
    console.error(`   user:   canonical ${reg.userPrompt.length} 字 vs 默认 ${pmV.userPrompt.length} 字${usrSame ? '（同）' : '（不同）'}`);
    if (!usrSame) {
        const r = new Set(placeholders(reg.userPrompt));
        const p = new Set(placeholders(pmV.userPrompt));
        const onlyR = [...r].filter(x => !p.has(x));
        const onlyP = [...p].filter(x => !r.has(x));
        if (onlyR.length) console.error(`   仅 canonical 有的变量: ${onlyR.join(', ')}`);
        if (onlyP.length) console.error(`   仅默认值有的变量: ${onlyP.join(', ')}`);
        console.error('   修法：services/prompt-templates-default.ts 该条目的 system/user 改回引用 canonical 常量（勿手改文本）。');
    }
}

if (failed > 0) {
    console.error(`[template-parity] ❌ ${failed} 个步骤模板漂移`);
    process.exit(1);
}
console.log('[template-parity] ✅ 全部同源（6 个映射）');
