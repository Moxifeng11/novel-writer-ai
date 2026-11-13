/**
 * 拆解 → 事实库落盘验证（P0-4 第一步）
 *
 * 用《将夜》前 5 章真实调用 DeepSeek 拆解，写入事实库 JSON，并打印数据形态。
 * 目的：**在接审核之前**先确认落盘结构正确、可人工阅读与修正。
 */
import fs from 'node:fs';
import path from 'node:path';
import { buildDecomposePrompt, parseDecomposeResponse } from '../engine/consistency/knowledge-decompose.ts';
import { createFactStore, mergeFactStore, serializeFactStore } from '../engine/consistency/fact-store.ts';

const N = Number(process.argv[2] ?? 5);
const pluginDir = 'D:/小说工坊/小说工坊/.obsidian/plugins/novel-writer-ai';
const settings = JSON.parse(fs.readFileSync(path.join(pluginDir, 'data.json'), 'utf8'));
const KEY = settings?.providerKeys?.deepseek || settings?.apiKey;
if (!KEY) {
    console.error('未找到 DeepSeek key');
    process.exit(1);
}

const raw = new TextDecoder('gbk').decode(fs.readFileSync('D:/小说工坊/小说工坊/小说原著下载/将夜.txt'));
const lines = raw.split(/\r?\n/);
const marks = [];
for (let i = 0; i < lines.length; i++) if (/^\s*第[零〇一二三四五六七八九十百千0-9]+章/.test(lines[i])) marks.push(i);

const store = createFactStore();
let ok = 0;
for (let k = 0; k < Math.min(N, marks.length - 1); k++) {
    const body = lines.slice(marks[k], marks[k + 1]).join('\n').slice(0, 4000);
    const prompt = buildDecomposePrompt(k + 1, body);
    const resp = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
        body: JSON.stringify({
            model: 'deepseek-chat',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.1,
            max_tokens: 3000,
            response_format: { type: 'json_object' },
        }),
    });
    const json = await resp.json();
    if (!resp.ok) {
        console.log(`第${k + 1}章 失败: ${json?.error?.message ?? resp.status}`);
        continue;
    }
    const parsed = parseDecomposeResponse(json?.choices?.[0]?.message?.content ?? '', body);
    if (!parsed) {
        console.log(`第${k + 1}章 解析失败`);
        continue;
    }
    const merged = mergeFactStore(store, k + 1, parsed.entries);
    ok += 1;
    console.log(`第${k + 1}章 ✓ ${parsed.entries.length} 条（新增 ${merged.added} / 更新 ${merged.updated} / 拒绝 ${parsed.rejected}）`);
}

const outFile = path.join(pluginDir, 'docs/analysis/fact-store-sample.json');
fs.writeFileSync(outFile, serializeFactStore(store));
console.log(`\n事实库：${store.facts.length} 条 · 章节 ${ok} 章 · 已写入 ${outFile}`);
console.log('\n--- 前 8 条（数据形态）---');
for (const f of store.facts.slice(0, 8)) {
    console.log(`  第${f.chapter}章 [${f.type}] ${f.subject}·${f.predicate}=${f.value}（有效 ${f.validFrom}→${f.validTo ?? '今'}）`);
    console.log(`        「${f.quote.slice(0, 40)}」`);
}
const byType = {};
for (const f of store.facts) byType[f.type] = (byType[f.type] ?? 0) + 1;
console.log('\n类型分布:', JSON.stringify(byType));
