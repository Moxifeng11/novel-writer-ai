#!/usr/bin/env node
/**
 * zhuque-detect.mjs — 朱雀 AIGC 检测（EdgeOne Makers API，2026-11-25）
 *
 * ## 为什么有它
 *
 * 仓库历史里的人味实验（`humanness-ab.mjs` / `humanness-ablation.mjs` /
 * `humanness-combo.mjs`）都是**手工上传网页**到 `matrix.tencent.com/ai-detect/ai_gen`：
 * 每次检测要人工点、有「今日剩余 N 次」硬限额、结果只能手抄进文档。
 * 这让「多轮提示词迭代 + 大样本对照」实际做不起来。
 *
 * 2026-11-25 起 EdgeOne Makers 开放了朱雀文本检测 API，可以脚本化：
 *   POST https://ai-gateway.edgeone.link/v1/providers/zhuque-text/classify
 *   Authorization: Bearer $MAKERS_MODELS_KEY
 *   { "text": "...", "is_merge": true }
 *
 * ## 返回字段语义（决定实验怎么读）
 *
 * | 字段 | 含义 |
 * | --- | --- |
 * | `labels_ratio['0']` | **人工占比** —— 本仓「人工率」口径就用这个 |
 * | `labels_ratio['1']` | AI 占比 |
 * | `labels_ratio['2']` | 疑似 AI 占比 |
 * | `softmax_confidence` | 整体判定置信度（越高越像 AI） |
 * | `ratio_confidence` | 整体风险比例 |
 * | `segment_labels[]` | 分段结果（`is_merge:false` 时每段各自打分） |
 * | `makers_models_usage.total_tokens` | **真正扣 Makers 免费额度的数** |
 *
 * ## 用法
 *
 * ```bash
 * # 单个文件
 * node scripts/zhuque-detect.mjs --file path/to/chapter.md
 *
 * # 字符串
 * node scripts/zhuque-detect.mjs --text "要测的文本"
 *
 * # 分段（每段单独打分，用于定位 AI 味集中的段落）
 * node scripts/zhuque-detect.mjs --file ch.md --segments
 *
 * # 批量：目录下所有 .md，输出 JSON 汇总（供实验脚本消费）
 * node scripts/zhuque-detect.mjs --dir path/to/dir --json --out result.json
 * ```
 *
 * 密钥来源（按优先级）：`--key` > `MAKERS_MODELS_KEY` 环境变量 > `.env.local` 的 `MAKERS_MODELS_KEY`。
 * **不要把 key 写进仓库**：`.env.local` 已在 .gitignore；`check:secrets` 会拦明文密钥。
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENDPOINT = 'https://ai-gateway.edgeone.link/v1/providers/zhuque-text/classify';

/** 免费额度：Makers 每月 500,000 tokens（文档口径） */
export const MAKERS_MONTHLY_FREE_TOKENS = 500_000;

const args = process.argv.slice(2);
const flag = name => args.includes('--' + name);
const opt = (name, fallback = '') => {
    const i = args.findIndex(a => a === '--' + name || a.startsWith('--' + name + '='));
    if (i < 0) return fallback;
    const raw = args[i];
    if (raw.includes('=')) return raw.slice(raw.indexOf('=') + 1);
    return args[i + 1] ?? fallback;
};

/** 解析密钥：--key > env > .env.local */
function resolveKey() {
    const fromArg = opt('key');
    if (fromArg) return { key: fromArg, source: '--key' };
    if (process.env.MAKERS_MODELS_KEY) return { key: process.env.MAKERS_MODELS_KEY, source: 'env' };
    const envFile = join(ROOT, '.env.local');
    if (existsSync(envFile)) {
        const line = readFileSync(envFile, 'utf8')
            .split(/\r?\n/)
            .find(l => l.trim().startsWith('MAKERS_MODELS_KEY'));
        if (line) {
            const value = line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '');
            if (value) return { key: value, source: '.env.local' };
        }
    }
    return { key: '', source: '' };
}

/**
 * 调用朱雀检测一条文本。
 *
 * @param {string} text - 待检文本
 * @param {object} [options] - 选项
 * @param {string} [options.key] - Makers Key（缺省走 resolveKey）
 * @param {boolean} [options.isMerge=true] - 是否合并段落统一打分
 * @returns {Promise<object>} 原始响应 + 归一化字段
 */
export async function detect(text, options = {}) {
    const key = options.key || resolveKey().key;
    if (!key) throw new Error('缺少 MAKERS_MODELS_KEY（--key / 环境变量 / .env.local）');
    const body = { text, is_merge: options.isMerge !== false };
    const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok || json.status !== 'success') {
        const msg = json?.error?.message || json?.msg || `HTTP ${res.status}`;
        throw new Error(`朱雀检测失败：${msg}`);
    }
    return normalize(json, text.length);
}

/**
 * 把原始响应归一化成实验脚本好消费的形状。
 *
 * 「人工率」口径统一取 `labels_ratio['0'] * 100`（百分数），与历史文档里
 * 「XX% 人工」的说法对齐；`aiRatio` / `suspectedRatio` 一并给出便于分析。
 *
 * @param {object} raw - API 原始响应
 * @param {number} textLength - 送检文本长度（用于字数归一与成本核算）
 * @returns {object} 归一化结果
 */
export function normalize(raw, textLength) {
    const ratio = raw.labels_ratio || {};
    const human = Number(ratio['0'] ?? 0);
    const ai = Number(ratio['1'] ?? 0);
    const suspected = Number(ratio['2'] ?? 0);
    return {
        status: raw.status,
        /** 人工占比（0–100）—— 本仓「人工率」 */
        humanRate: Math.round(human * 1000) / 10,
        /** AI 占比（0–100） */
        aiRate: Math.round(ai * 1000) / 10,
        /** 疑似 AI 占比（0–100） */
        suspectedRate: Math.round(suspected * 1000) / 10,
        /** 整体判定置信度（越高越像 AI） */
        softmax: raw.softmax_confidence,
        /** 整体风险比例 */
        ratioConfidence: raw.ratio_confidence,
        /** 扣费 token（Makers 免费额度口径） */
        billedTokens: raw.makers_models_usage?.total_tokens ?? 0,
        /** 朱雀自身用量（与免费额度无关） */
        usageTokens: raw.usage?.total_tokens ?? 0,
        textLength,
        segments: readSegments(raw),
    };
}

/** 分段结果（只在 is_merge:false 时有意义） */
function readSegments(raw) {
    return Array.isArray(raw.segment_labels)
        ? raw.segment_labels.map(s => ({
            order: s.order,
            label: s.label,
            conf: s.conf,
            position: s.position,
            text: (s.text || '').slice(0, 80),
        }))
        : [];
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const isMain = process.argv[1] && process.argv[1].endsWith('zhuque-detect.mjs');
if (isMain) {
    const { key, source } = resolveKey();
    if (!key) {
        console.error('❌ 缺少 MAKERS_MODELS_KEY');
        console.error('   三种给法：--key sk-xxx / 环境变量 MAKERS_MODELS_KEY / 仓库根 .env.local 里写 MAKERS_MODELS_KEY=sk-xxx');
        process.exit(1);
    }

    const segments = flag('segments');
    const asJson = flag('json');
    const outFile = opt('out');
    const tmp = opt('text');
    const file = opt('file');
    const dir = opt('dir');

    const targets = [];
    if (tmp) targets.push({ name: '(inline text)', text: tmp });
    if (file) targets.push({ name: basename(file), text: readFileSync(file, 'utf8') });
    if (dir) {
        for (const name of readdirSync(dir)) {
            if (!name.endsWith('.md')) continue;
            const full = join(dir, name);
            if (!statSync(full).isFile()) continue;
            targets.push({ name, text: readFileSync(full, 'utf8') });
        }
    }
    if (targets.length === 0) {
        console.error('用法：node scripts/zhuque-detect.mjs --text "..." | --file a.md | --dir dir [--segments] [--json] [--out r.json]');
        process.exit(1);
    }

    if (!asJson) console.log(`[zhuque] key 来源：${source} · 送检 ${targets.length} 份`);
    const results = [];
    let billed = 0;
    for (const t of targets) {
        const text = t.text.replace(/\r\n/g, '\n').trim();
        if (!text) { console.warn(`  跳过空文件：${t.name}`); continue; }
        try {
            const r = await detect(text, { key, isMerge: !segments });
            billed += r.billedTokens;
            results.push({ name: t.name, ...r });
            if (!asJson) {
                console.log(`  ${t.name}`);
                console.log(`    人工 ${r.humanRate}% · AI ${r.aiRate}% · 疑似 ${r.suspectedRate}% · softmax ${r.softmax} · ${r.textLength} 字`);
                if (segments && r.segments.length) {
                    for (const s of r.segments) {
                        const label = s.label === 0 ? '人工' : s.label === 1 ? 'AI' : '疑似AI';
                        console.log(`      #${s.order} [${label} ${s.conf.toFixed(3)}] ${s.text.replace(/\s+/g, ' ')}`);
                    }
                }
            }
        } catch (e) {
            console.error(`  ❌ ${t.name}: ${e instanceof Error ? e.message : String(e)}`);
            results.push({ name: t.name, error: String(e) });
        }
    }

    const summary = {
        generatedAt: new Date().toISOString(),
        endpoint: ENDPOINT,
        count: results.length,
        billedTokens: billed,
        quotaUsedPct: Math.round((billed / MAKERS_MONTHLY_FREE_TOKENS) * 10000) / 100,
        avgHumanRate: results.filter(r => !r.error).length
            ? Math.round(results.filter(r => !r.error).reduce((n, r) => n + r.humanRate, 0) / results.filter(r => !r.error).length * 10) / 10
            : null,
        results,
    };

    if (asJson) {
        const payload = JSON.stringify(summary, null, 2);
        if (outFile) { writeFileSync(outFile, payload + '\n', 'utf8'); console.error(`✅ 已写入 ${outFile}`); }
        else console.log(payload);
    } else {
        console.log(`\n合计 ${summary.count} 份 · 人工率均值 ${summary.avgHumanRate}% · 扣 ${billed} tokens（免费额度 ${summary.quotaUsedPct}%）`);
        if (outFile) { writeFileSync(outFile, JSON.stringify(summary, null, 2) + '\n', 'utf8'); console.log(`✅ 已写入 ${outFile}`); }
    }
}
