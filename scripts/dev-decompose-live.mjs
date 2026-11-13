/**
 * 单章拆解验证（真实 DeepSeek 调用）
 *
 * 用法：node scripts/dev-decompose-live.mjs
 * 输出：条目数、拒绝数、耗时、token、首条样例
 */
import fs from 'node:fs';
import path from 'node:path';
import { buildDecomposePrompt, parseDecomposeResponse } from '../engine/consistency/knowledge-decompose.ts';

const KEY = fs.readFileSync(path.join(process.env.TEMP, 'nwkey.txt'), 'utf8').trim();

// 取《将夜》第 1 章正文（GBK）
const src = 'D:/小说工坊/小说工坊/小说原著下载/将夜.txt';
const buf = fs.readFileSync(src);
const raw = new TextDecoder('gbk').decode(buf);
const lines = raw.split(/\r?\n/);
const marks = [];
for (let i = 0; i < lines.length; i++) if (/^\s*第[零〇一二三四五六七八九十百千0-9]+章/.test(lines[i])) marks.push(i);
const body = lines.slice(marks[0], marks[1]).join('\n').slice(0, 4000);
console.log(`章节字数: ${body.length}`);

const prompt = buildDecomposePrompt(1, body);
const t0 = Date.now();
const resp = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 3000,
    }),
});
const ms = Date.now() - t0;
const json = await resp.json();
const content = json?.choices?.[0]?.message?.content ?? '';
const usage = json?.usage ?? {};
console.log(`耗时 ${ms}ms · usage in=${usage.prompt_tokens} out=${usage.completion_tokens}`);

const parsed = parseDecomposeResponse(content, body);
if (!parsed) {
    console.error('解析失败，原始输出前 400 字：\n' + content.slice(0, 400));
    process.exit(1);
}
console.log(`条目 ${parsed.entries.length} 条，拒绝 ${parsed.rejected} 条`);
const byType = {};
for (const e of parsed.entries) byType[e.type] = (byType[e.type] ?? 0) + 1;
console.log('类型分布:', JSON.stringify(byType));
console.log('样例:');
for (const e of parsed.entries.slice(0, 6)) {
    console.log(`  [${e.type}] ${e.subject}·${e.predicate}=${e.value} conf=${e.confidence} quote=「${e.quote.slice(0, 24)}」`);
}
