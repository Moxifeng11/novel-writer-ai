#!/usr/bin/env node
/**
 * eval-fingerprint-retrieval.mjs — 指纹/知识检索离线评估（hit@k / MRR）
 *
 * 输入 JSON（预计算的排名结果，不依赖 embedding 运行时）：
 * {
 *   "k": 5,
 *   "queries": [
 *     { "id": "q1", "relevant": ["fp1"], "ranked": ["fp2", "fp1", "fp3"] }
 *   ]
 * }
 *
 * 用法：
 *   npm run eval:fingerprint -- --input path/to/fixture.json
 *
 * 没有输入文件或 queries 为空时打印用法并退出 0（不阻塞 CI）。
 */

import fs from 'node:fs';

const inputIndex = process.argv.indexOf('--input');
const inputPath = inputIndex !== -1 ? process.argv[inputIndex + 1] : undefined;

if (!inputPath) {
    console.log('用法: node scripts/eval-fingerprint-retrieval.mjs --input <fixture.json>');
    console.log('输入格式: { "k": 5, "queries": [{ "id": "q1", "relevant": ["fp1"], "ranked": ["fp2","fp1"] }] }');
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

const k = Number.isInteger(data.k) && data.k > 0 ? data.k : 5;
const queries = Array.isArray(data.queries) ? data.queries : [];

if (queries.length === 0) {
    console.log('没有查询用例，跳过评估（退出 0）');
    process.exit(0);
}

let hits = 0;
let reciprocalRankSum = 0;
const rows = [];

for (const query of queries) {
    const id = String(query?.id ?? `q${rows.length + 1}`);
    const ranked = Array.isArray(query?.ranked) ? query.ranked.map(String) : [];
    const relevant = new Set(Array.isArray(query?.relevant) ? query.relevant.map(String) : []);
    const topK = ranked.slice(0, k);
    const hit = topK.some((fingerprintId) => relevant.has(fingerprintId));
    const firstRank = ranked.findIndex((fingerprintId) => relevant.has(fingerprintId));
    if (hit) hits += 1;
    reciprocalRankSum += firstRank >= 0 ? 1 / (firstRank + 1) : 0;
    rows.push({ id, hit, firstRank: firstRank >= 0 ? firstRank + 1 : null });
}

for (const row of rows) {
    console.log(`${row.hit ? '✅' : '❌'} ${row.id}: hit@${k}=${row.hit} firstRank=${row.firstRank ?? '-'}`);
}

const hitRate = (hits / queries.length) * 100;
const mrr = reciprocalRankSum / queries.length;
console.log(`\nqueries=${queries.length} hit@${k}=${hitRate.toFixed(1)}% MRR=${mrr.toFixed(3)}`);
