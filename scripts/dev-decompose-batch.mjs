/**
 * 批量拆解《将夜》前 N 章（C 臂第二阶段）
 *
 * 用法：node --experimental-strip-types scripts/dev-decompose-batch.mjs [N]
 * 产出：knowledge-batch.json（条目）、终端统计（成功率/条目分布/token/成本）
 */
import fs from 'node:fs';
import path from 'node:path';
import { buildDecomposePrompt, parseDecomposeResponse } from '../engine/consistency/knowledge-decompose.ts';

const N = Number(process.argv[2] ?? 30);
const pluginDir = 'D:/小说工坊/小说工坊/.obsidian/plugins/novel-writer-ai';
const settings = JSON.parse(fs.readFileSync(path.join(pluginDir, 'data.json'), 'utf8'));
const KEY = settings?.providerKeys?.deepseek || settings?.apiKey;
if (!KEY) {
    console.error('未找到 DeepSeek key');
    process.exit(1);
}

const src = 'D:/小说工坊/小说工坊/小说原著下载/将夜.txt';
const raw = new TextDecoder('gbk').decode(fs.readFileSync(src));
const lines = raw.split(/\r?\n/);
const marks = [];
for (let i = 0; i < lines.length; i++) if (/^\s*第[零〇一二三四五六七八九十百千0-9]+章/.test(lines[i])) marks.push(i);

const chapters = [];
for (let k = 0; k < Math.min(N, marks.length - 1); k++) {
    const body = lines.slice(marks[k], marks[k + 1]).join('\n');
    chapters.push({ num: k + 1, body });
}

const out = { chapters: chapters.length, ok: 0, failed: 0, totalEntries: 0, rejected: 0, tokens: { in: 0, out: 0 }, byType: {}, entries: [] };
const t0 = Date.now();

for (const ch of chapters) {
    const prompt = buildDecomposePrompt(ch.num, ch.body.slice(0, 4000));
    try {
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
            out.failed += 1;
            console.log(`第${ch.num}章 请求失败: ${json?.error?.message ?? resp.status}`);
            continue;
        }
        out.tokens.in += json?.usage?.prompt_tokens ?? 0;
        out.tokens.out += json?.usage?.completion_tokens ?? 0;
        const content = json?.choices?.[0]?.message?.content ?? '';
        const parsed = parseDecomposeResponse(content, ch.body);
        if (!parsed) {
            out.failed += 1;
            console.log(`第${ch.num}章 解析失败`);
            continue;
        }
        out.ok += 1;
        out.totalEntries += parsed.entries.length;
        out.rejected += parsed.rejected;
        for (const e of parsed.entries) {
            out.byType[e.type] = (out.byType[e.type] ?? 0) + 1;
            out.entries.push({ chapter: ch.num, ...e });
        }
        console.log(`第${ch.num}章 ✓ ${parsed.entries.length} 条（拒绝 ${parsed.rejected}）`);
    } catch (e) {
        out.failed += 1;
        console.log(`第${ch.num}章 异常: ${e.message}`);
    }
}

const sec = Math.round((Date.now() - t0) / 1000);
const costPerM = { in: 0.5, out: 8 };
const cost = (out.tokens.in / 1e6) * costPerM.in + (out.tokens.out / 1e6) * costPerM.out;
console.log('\n===== 汇总 =====');
console.log(`章节 ${out.chapters}：成功 ${out.ok} / 失败 ${out.failed}（成功率 ${((out.ok / out.chapters) * 100).toFixed(1)}%）`);
console.log(`条目 ${out.totalEntries} 条，平均 ${(out.totalEntries / Math.max(1, out.ok)).toFixed(1)} 条/章，拒绝 ${out.rejected}`);
console.log(`类型分布: ${JSON.stringify(out.byType)}`);
console.log(`token: in=${out.tokens.in} out=${out.tokens.out} · 耗时 ${sec}s`);
console.log(`预估成本: ¥${cost.toFixed(3)}（按 DeepSeek 定价）`);
console.log(`折算 200 章: ¥${((cost / out.chapters) * 200).toFixed(2)}`);

const outFile = path.join(pluginDir, 'docs/analysis/knowledge-batch.json');
fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
console.log(`已写入 ${outFile}`);
