/**
 * C 臂阶段三评测：归一化压降 + LLM 语义判定
 *
 * 用法：node --experimental-strip-types scripts/dev-decompose-judge.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import {
    buildJudgePrompt,
    filterEquivalentCandidates,
    parseJudgeVerdicts,
    valuesLookEquivalent,
} from '../engine/consistency/candidate-judge.ts';

const pluginDir = 'D:/小说工坊/小说工坊/.obsidian/plugins/novel-writer-ai';
const settings = JSON.parse(fs.readFileSync(path.join(pluginDir, 'data.json'), 'utf8'));
const KEY = settings?.providerKeys?.deepseek || settings?.apiKey;
const data = JSON.parse(fs.readFileSync(path.join(pluginDir, 'docs/analysis/knowledge-batch.json'), 'utf8'));

function conflict(a, b) {
    if (a.value === b.value) return false;
    const aEnd = a.validTo;
    const bEnd = b.validTo;
    if (aEnd === null && bEnd === null) return true;
    if (aEnd !== null && aEnd <= b.validFrom) return false;
    if (bEnd !== null && bEnd <= a.validFrom) return false;
    return true;
}

// 1) 生成候选
const groups = new Map();
for (const e of data.entries) {
    const key = `${e.subject}|${e.predicate}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
}
let candidates = [];
for (const [key, list] of groups) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((x, y) => x.validFrom - y.validFrom);
    for (let i = 0; i < sorted.length - 1; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
            if (!conflict(sorted[i], sorted[j])) continue;
            const [subject, predicate] = key.split('|');
            candidates.push({
                subject, predicate, type: sorted[i].type,
                valueA: sorted[i].value, chapterA: sorted[i].chapter, quoteA: sorted[i].quote,
                valueB: sorted[j].value, chapterB: sorted[j].chapter, quoteB: sorted[j].quote,
            });
        }
    }
}
console.log(`① 原始候选: ${candidates.length} 处`);

// 2) 归一化压降
const remaining = filterEquivalentCandidates(candidates);
console.log(`② 归一化后: ${remaining.length} 处（压掉 ${candidates.length - remaining.length}，${((1 - remaining.length / candidates.length) * 100).toFixed(1)}%）`);

// 3) 抽样展示压掉了什么
const removed = candidates.filter(c => valuesLookEquivalent(c.valueA, c.valueB)).slice(0, 5);
console.log('   压掉的例子:');
for (const c of removed) console.log(`     ${c.subject}|${c.predicate}: 「${c.valueA}」 ≡ 「${c.valueB}」`);

if (remaining.length === 0) process.exit(0);

// 4) LLM 逐批判定
const BATCH = 12;
let confirmed = 0;
let judged = 0;
const tokenUse = { in: 0, out: 0 };
const confirmedList = [];
for (let i = 0; i < remaining.length; i += BATCH) {
    const batch = remaining.slice(i, i + BATCH);
    const prompt = buildJudgePrompt(batch);
    const resp = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
        body: JSON.stringify({
            model: 'deepseek-chat',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.1,
            max_tokens: 2000,
            response_format: { type: 'json_object' },
        }),
    });
    const json = await resp.json();
    if (!resp.ok) {
        console.log(`批次 ${i} 失败: ${json?.error?.message ?? resp.status}`);
        continue;
    }
    tokenUse.in += json?.usage?.prompt_tokens ?? 0;
    tokenUse.out += json?.usage?.completion_tokens ?? 0;
    const verdicts = parseJudgeVerdicts(json?.choices?.[0]?.message?.content ?? '', batch.length);
    if (!verdicts) {
        console.log(`批次 ${i} 解析失败`);
        continue;
    }
    judged += verdicts.length;
    for (const v of verdicts) {
        if (v.real) {
            confirmed += 1;
            const c = batch[v.index];
            confirmedList.push({ ...c, reason: v.reason, confidence: v.confidence });
        }
    }
}

const cost = (tokenUse.in / 1e6) * 0.5 + (tokenUse.out / 1e6) * 8;
console.log('\n===== 汇总 =====');
console.log(`原始候选 ${candidates.length} → 归一化后 ${remaining.length} → 判定 ${judged} 条 → **确认矛盾 ${confirmed} 处**`);
console.log(`判定层 token: in=${tokenUse.in} out=${tokenUse.out} · 成本 ¥${cost.toFixed(3)}（30 章）`);
console.log(`折算 200 章: ¥${((cost / 30) * 200).toFixed(2)}`);
console.log('\n确认的矛盾:');
for (const c of confirmedList) {
    console.log(`  [${c.type}] ${c.subject}|${c.predicate}`);
    console.log(`    第${c.chapterA}章「${c.quoteA.slice(0, 40)}」`);
    console.log(`    第${c.chapterB}章「${c.quoteB.slice(0, 40)}」`);
    console.log(`    理由: ${c.reason}`);
}
fs.writeFileSync(path.join(pluginDir, 'docs/analysis/c-arm-phase3-result.json'), JSON.stringify({
    rawCandidates: candidates.length,
    afterNormalize: remaining.length,
    judged,
    confirmed,
    tokens: tokenUse,
    cost30: Number(cost.toFixed(3)),
    confirmedList,
}, null, 1));
