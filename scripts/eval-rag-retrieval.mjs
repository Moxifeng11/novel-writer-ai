#!/usr/bin/env node
/**
 * eval-rag-retrieval.mjs — RAG 检索质量离线评估（hit@k / MRR / 近重复占比）
 *
 * 与 eval-fingerprint-retrieval.mjs 同口径（hit@k + MRR），额外报告近重复占比，
 * 用于校验 MMR 是否真的压住了「前三条都在说同一件事」。
 *
 * 输入 JSON（预计算的排名结果，不依赖 embedding 运行时）：
 * {
 *   "k": 5,
 *   "queries": [
 *     {
 *       "id": "q1",
 *       "relevant": ["ch3-p2"],
 *       "ranked": ["ch1-p0", "ch3-p2", "ch3-p3"],
 *       "texts": ["断刃城守将在城头……", "沈青在药铺……", "沈青在药铺收拾……"]
 *     }
 *   ]
 * }
 *
 * `texts` 可选：给了就按文本 2-gram 相似度判近重复（推荐，能反映 MMR 效果）；
 * 不给则只按 id 判重。
 *
 * 采集方法（人工，不在 CI 里跑）：
 *   1. 在一个隔离验证项目里准备知识库向量索引（≥1 本已拆解参考书）；
 *   2. 对每个待测章节，用与管线相同的查询来源构造查询（章纲 / 场景目标 / 正文尾部）；
 *   3. 调 `retrieve(store, { dimensions, topN, maxChars })`，把返回的 position 记录
 *      导出成 ranked（position → 稳定 id，如 `ch3-p2`），texts 用返回的 sample 前 80 字；
 *   4. relevant 人工标注：哪些块确实是这一章该参考的片段。
 *
 * 用法：
 *   npm run eval:rag -- --input path/to/rag-fixture.json
 *   npm run eval:rag -- --input tests/fixtures/rag-eval-sample.json --k 3
 *
 * 没有输入文件或 queries 为空时打印用法并退出 0（不阻塞 CI）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const inputIndex = process.argv.indexOf('--input');
const inputPath = inputIndex !== -1 ? process.argv[inputIndex + 1] : undefined;
const kIndex = process.argv.indexOf('--k');
const kOverride = kIndex !== -1 ? Number(process.argv[kIndex + 1]) : undefined;

if (!inputPath) {
    console.log('用法: node scripts/eval-rag-retrieval.mjs --input <fixture.json> [--k 5]');
    console.log('输入格式: { "k": 5, "queries": [{ "id": "q1", "relevant": ["ch3-p2"], "ranked": ["ch1-p0","ch3-p2"], "texts": ["...","..."] }] }');
    process.exit(0);
}

if (!fs.existsSync(inputPath)) {
    console.error(`找不到输入文件: ${inputPath}`);
    process.exit(1);
}

let data;
try {
    data = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
} catch (error) {
    console.error(`解析 JSON 失败: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
}

const queries = Array.isArray(data.queries) ? data.queries : [];
if (queries.length === 0) {
    console.log('没有查询用例，跳过评估（退出 0）');
    process.exit(0);
}

// ---- 与 shared/rag/eval-score.ts 同口径的评分（脚本零依赖，故就地实现） ----
const DUPLICATE_THRESHOLD = 0.9;

function bigrams(text) {
    const normalized = String(text || '').replace(/\s+/g, '');
    const set = new Set();
    for (let i = 0; i + 1 < normalized.length; i++) set.add(normalized.slice(i, i + 2));
    return set;
}

function similarity(a, b) {
    const setA = bigrams(a);
    const setB = bigrams(b);
    if (setA.size === 0 || setB.size === 0) return 0;
    let hit = 0;
    const [small, large] = setA.size <= setB.size ? [setA, setB] : [setB, setA];
    for (const gram of small) if (large.has(gram)) hit++;
    return hit / (setA.size + setB.size - hit);
}

// 判近重复用重叠系数（|A∩B| / min(|A|,|B|)）：重叠分块产生的重复是「一段包住另一段」，
// Jaccard 会因长度差把 0.95 的重叠压到 0.7，导致重复测不出来。
function overlapSimilarity(a, b) {
    const setA = bigrams(a);
    const setB = bigrams(b);
    if (setA.size === 0 || setB.size === 0) return 0;
    let hit = 0;
    const [small, large] = setA.size <= setB.size ? [setA, setB] : [setB, setA];
    for (const gram of small) if (large.has(gram)) hit++;
    return hit / small.size;
}

function duplicateRatio(ranked, texts) {
    if (ranked.length === 0) return 0;
    const seen = [];
    let duplicates = 0;
    ranked.forEach((id, index) => {
        const text = texts ? texts[index] : undefined;
        const isDuplicate = text !== undefined && seen.length > 0
            ? seen.some(previous => overlapSimilarity(previous, text) >= DUPLICATE_THRESHOLD)
            : seen.includes(id);
        if (isDuplicate) duplicates++;
        else seen.push(text !== undefined ? text : id);
    });
    return duplicates / ranked.length;
}

const k = Number.isInteger(kOverride) && kOverride > 0
    ? kOverride
    : (Number.isInteger(data.k) && data.k > 0 ? data.k : 5);

let hits = 0;
let reciprocalRankSum = 0;
let duplicateSum = 0;
const rows = [];

for (const query of queries) {
    const id = String(query?.id ?? `q${rows.length + 1}`);
    const ranked = Array.isArray(query?.ranked) ? query.ranked.map(String) : [];
    const relevant = new Set(Array.isArray(query?.relevant) ? query.relevant.map(String) : []);
    const texts = Array.isArray(query?.texts) ? query.texts.map(String) : undefined;
    const topK = ranked.slice(0, k);
    const hit = topK.some(item => relevant.has(item));
    const firstRank = ranked.findIndex(item => relevant.has(item));
    const ratio = duplicateRatio(ranked, texts);
    if (hit) hits += 1;
    reciprocalRankSum += firstRank >= 0 ? 1 / (firstRank + 1) : 0;
    duplicateSum += ratio;
    rows.push({ id, hit, firstRank: firstRank >= 0 ? firstRank + 1 : null, ratio });
}

for (const row of rows) {
    console.log(
        `${row.hit ? '✅' : '❌'} ${row.id}: hit@${k}=${row.hit} firstRank=${row.firstRank ?? '-'} `
        + `近重复=${(row.ratio * 100).toFixed(0)}%`,
    );
}

const hitRate = (hits / queries.length) * 100;
const mrr = reciprocalRankSum / queries.length;
const duplicateRatioAvg = duplicateSum / queries.length;
console.log(
    `\nqueries=${queries.length} hit@${k}=${hitRate.toFixed(1)}% MRR=${mrr.toFixed(3)} `
    + `近重复=${(duplicateRatioAvg * 100).toFixed(1)}%`,
);
console.log(`（阈值参考：hit@5 ≥ 80%、MRR ≥ 0.6、近重复 ≤ 20% 视为健康；fixture: ${path.relative(PROJECT_ROOT, path.resolve(inputPath))}）`);
