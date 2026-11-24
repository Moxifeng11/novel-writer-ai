#!/usr/bin/env node
/**
 * zhuque-ab.mjs — 纯朱雀驱动的 A/B 实验器（2026-11-25）
 *
 * ## 为什么需要它
 *
 * 之前的 A/B 用句长、段落均字、单句成段这些**代理指标**判断好坏。
 * 问题：这些指标和朱雀人工率的相关性很弱（长句 r=0.150），
 * 用它们做判据会把「指标好看但朱雀判 AI」的方案误判为成功。
 *
 * 本工具**只认朱雀返回的参数**：
 *   humanRate   = labels_ratio['0']  → 人工占比
 *   aiRate      = labels_ratio['1']  → AI 占比
 *   suspected   = labels_ratio['2']  → 疑似 AI 占比
 *   softmax     = softmax_confidence → 越高越像 AI
 *
 * ## 用法
 *
 * ```bash
 * # 单文件
 * node scripts/zhuque-ab.mjs --file a.md
 * # 目录对比（A/B 两组）
 * node scripts/zhuque-ab.mjs --dir-a dirA --dir-b dirB
 * # 只要机器可读
 * node scripts/zhuque-ab.mjs --dir-a dirA --dir-b dirB --json
 * ```
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const ENDPOINT = 'https://ai-gateway.edgeone.link/v1/providers/zhuque-text/classify';

/** 解析 --key 参数，回退 env / .env.local */
function resolveKey(explicit) {
    if (explicit) return explicit;
    if (process.env.MAKERS_MODELS_KEY) return process.env.MAKERS_MODELS_KEY.trim();
    const envPath = path.join(ROOT, '.env.local');
    if (fs.existsSync(envPath)) {
        const m = fs.readFileSync(envPath, 'utf8').match(/MAKERS_MODELS_KEY\s*=\s*(.+)/);
        if (m) return m[1].trim();
    }
    return '';
}

/**
 * 调朱雀判定一段文本。
 *
 * @param {string} text - 待判定文本
 * @param {string} key - Makers API Key
 * @returns {Promise<object>} 归一化结果
 */
export async function detect(text, key) {
    const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ text, is_merge: true }),
    });
    const body = await res.text();
    if (!res.ok) {
        throw new Error(`朱雀 ${res.status}: ${body.slice(0, 200)}`);
    }
    const j = JSON.parse(body);
    if (j.status !== 'success') {
        throw new Error(`朱雀返回失败: ${body.slice(0, 200)}`);
    }
    const ratio = j.labels_ratio || {};
    const usage = j.makers_models_usage?.total_tokens ?? j.usage?.total_tokens ?? 0;
    return {
        humanRate: Math.round(Number(ratio['0'] ?? 0) * 1000) / 10,
        aiRate: Math.round(Number(ratio['1'] ?? 0) * 1000) / 10,
        suspectedRate: Math.round(Number(ratio['2'] ?? 0) * 1000) / 10,
        softmax: Number(j.softmax_confidence ?? 0),
        ratioConfidence: Number(j.ratio_confidence ?? 0),
        billedTokens: usage,
        textLength: text.length,
        segments: (j.segment_labels || []).map(s => ({
            order: s.order, label: s.label, conf: s.conf, text: String(s.text || '').slice(0, 60),
        })),
    };
}

/** 读目录下所有 .md/.txt，返回 [{name, text}] */
function readDir(dir) {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
        .filter(f => /\.(md|txt)$/.test(f))
        .sort()
        .map(f => ({ name: f, text: fs.readFileSync(path.join(dir, f), 'utf8') }));
}

/** 均值 */
const mean = (arr, k) => arr.length ? (arr.reduce((a, b) => a + b[k], 0) / arr.length) : NaN;

/** 判定档位（纯朱雀口径） */
function grade(humanRate, softmax) {
    if (humanRate >= 80) return 'HUMAN';
    if (humanRate >= 50) return 'LIKELY-HUMAN';
    if (humanRate >= 20) return 'MIXED';
    if (humanRate > 0) return 'LIKELY-AI';
    return softmax > 0.99 ? 'AI' : 'AI(low-conf)';
}

/** 打印一组结果 */
function printGroup(label, rows) {
    if (!rows.length) { console.log(`${label}: （无样本）`); return; }
    console.log(`\n── ${label}（n=${rows.length}）──`);
    console.log('样本'.padEnd(30) + '人工率'.padStart(8) + 'AI率'.padStart(7) + '疑似'.padStart(7) + 'softmax'.padStart(10) + '  判定');
    console.log('-'.repeat(76));
    for (const r of rows) {
        console.log(
            String(r.name).slice(0, 28).padEnd(30)
            + String(r.humanRate).padStart(8)
            + String(r.aiRate).padStart(7)
            + String(r.suspectedRate).padStart(7)
            + String(r.softmax.toFixed(4)).padStart(10)
            + '  ' + grade(r.humanRate, r.softmax),
        );
    }
    console.log('-'.repeat(76));
    console.log('均值'.padEnd(30)
        + String(mean(rows, 'humanRate').toFixed(1)).padStart(8)
        + String(mean(rows, 'aiRate').toFixed(1)).padStart(7)
        + String(mean(rows, 'suspectedRate').toFixed(1)).padStart(7)
        + String(mean(rows, 'softmax').toFixed(4)).padStart(10)
        + `  ${grade(mean(rows, 'humanRate'), mean(rows, 'softmax'))}`);
    const over50 = rows.filter(r => r.humanRate >= 50).length;
    console.log(`人工率 ≥50% 的样本：${over50}/${rows.length}`);
}

/** CLI */
async function main() {
    const args = process.argv.slice(2);
    const get = (flag) => { const i = args.indexOf(flag); return i > -1 ? args[i + 1] : undefined; };
    const json = args.includes('--json');
    const key = resolveKey(get('--key'));
    if (!key) { console.error('缺少 MAKERS_MODELS_KEY（--key / env / .env.local）'); process.exit(1); }

    const file = get('--file');
    const dirA = get('--dir-a');
    const dirB = get('--dir-b');

    const out = {};
    const run = async (label, samples) => {
        const rows = [];
        for (const s of samples) {
            try {
                const r = await detect(s.text, key);
                rows.push({ name: s.name, ...r });
                process.stderr.write('.');
            } catch (e) {
                rows.push({ name: s.name, error: String(e).slice(0, 120) });
                process.stderr.write('x');
            }
        }
        process.stderr.write('\n');
        out[label] = rows;
        return rows;
    };

    if (file) {
        await run('single', [{ name: path.basename(file), text: fs.readFileSync(file, 'utf8') }]);
    }
    if (dirA) await run('A', readDir(dirA));
    if (dirB) await run('B', readDir(dirB));

    if (json) {
        console.log(JSON.stringify(out, null, 2));
        return;
    }
    for (const [label, rows] of Object.entries(out)) {
        printGroup(label === 'single' ? rows[0]?.name || 'single' : `组 ${label}`, rows.filter(r => !r.error));
    }
    // A/B 直接对比
    if (out.A && out.B) {
        const a = out.A.filter(r => !r.error);
        const b = out.B.filter(r => !r.error);
        console.log('\n══ A/B 对比（纯朱雀口径）══');
        console.log(`A: 人工率 ${mean(a, 'humanRate').toFixed(1)}% | softmax ${mean(a, 'softmax').toFixed(4)}`);
        console.log(`B: 人工率 ${mean(b, 'humanRate').toFixed(1)}% | softmax ${mean(b, 'softmax').toFixed(4)}`);
        const diff = mean(b, 'humanRate') - mean(a, 'humanRate');
        console.log(diff > 0 ? `→ B 优于 A ${diff.toFixed(1)} 个百分点` : `→ A 优于 B ${Math.abs(diff).toFixed(1)} 个百分点`);
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
    main().catch(e => { console.error(String(e).slice(0, 400)); process.exit(1); });
}
