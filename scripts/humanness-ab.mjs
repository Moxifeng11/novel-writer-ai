/**
 * humanness-ab.mjs — 真实付费 A/B：同一章正文 + 4 套提示词 → 4 份改写
 *
 * 目的：用朱雀（外部检测）判断「哪种提示词结构真的能提升人工特征占比」。
 * 变体（只改 system prompt 的人味部分，其它完全一致）：
 *   v1-quota     旧版：23 条数值配额 + 禁用词（HUMAN_VOICE_BLOCK）
 *   v2-exemplar  只给 3 段真人样文，不给任何规则
 *   v3-weak      3 段样文 + 6 条弱约束（当前插件默认）
 *   v4-dialogue  v3 + 明确要求「对话推进、对话占比约 25%」
 *
 * 用法：node scripts/humanness-ab.mjs --input <正文.md> [--out test-results/humanness-ab]
 * 输出：<out>/<variant>.md + <out>/summary.json（含每份的字数/AI味/耗时）
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(__dirname, '..');
const VAULT_ROOT = path.resolve(PLUGIN_ROOT, '..', '..', '..');
const DATA_JSON = path.join(PLUGIN_ROOT, 'data.json');
const SAMPLE_DIR = path.join(PLUGIN_ROOT, 'data', 'human-samples');

const args = process.argv.slice(2);
const readArg = (name, fallback) => {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const INPUT = readArg('--input', '');
const OUT_DIR = readArg('--out', path.join(PLUGIN_ROOT, 'test-results', 'humanness-ab'));
if (!INPUT) {
    console.error('用法: node scripts/humanness-ab.mjs --input <正文.md> [--out <dir>]');
    process.exit(1);
}

const config = JSON.parse(fs.readFileSync(DATA_JSON, 'utf8'));
const endpoint = String(config.apiEndpoint || '').replace(/\/+$/, '');
const model = String(config.defaultModel || config.flashModel || '');
const key = config.providerKeys?.deepseek || config.apiKey;
if (!endpoint || !model || !key) {
    console.error('缺少 endpoint/model/key');
    process.exit(2);
}

/** 旧版配额块（与 engine/prompts/human-voice.ts 的 HUMAN_VOICE_BLOCK 同源，此处取要点） */
const QUOTA_BLOCK = `【人味与可读性（最高优先级）】
1. 自然段 2–6 句、80–220 字；不要一句一段，每千字单句成段不超过 3 处。
2. 句长平均 20–30 字；35 字以上长句占 10%–20%；10 字以下短句不超过 25%。
3. 连续 3 句不要用同一主语开头。
4. 不用分号；省略号全文最多 2 处；破折号全文最多 2 处。
5. 「不是A，而是B」全篇最多 1 处；禁止排比式感慨；禁止末段升华。
6. 心理描写一次不超过 3 行；纯景物描写一次不超过 3 行；描写合计不超过两成。
7. 对话占 25%–45%。
8. 允许重复用词、口语、方言、粗话；词汇过于“正确”、每段长短过于整齐本身就是 AI 特征。
9. 章末落在动作、对话或悬念上。`;

/** 6 条弱约束（与 HUMAN_VOICE_WEAK_RULES 同源） */
const WEAK_RULES = `【人味要求（照着上面的样文写语感，不要拿清单逐条凑指标）】
1. 句子长短不要一致：想短就短到三四字，想长就一路连下去；段落也一样。
2. 允许重复用词、口语、方言、粗话，允许句子不完整；不要为了“用词正确”换更书面的词。
3. 不要写总结段或升华段。结尾落在动作、对话，或一句没说完的话上。
4. 对话可以有打断、答非所问、口头禅；引号里的话要像人说出来的。
5. 具体名词优先于形容词；不要堆形容词，也不必每段都追求画面感。
6. 从上一章结尾的情境里接着写。`;

const DIALOGUE_EMPHASIS = `【对话推进（本稿最重要的一条）】
- 用对话推动信息与冲突：该说的话让人物自己说，不要由叙述者转述。
- 对话占比约 25%（每 400 字里有 100 字左右在引号里），可以有短句交锋、答非所问、沉默后的半句话。
- 叙述段控制在 2–5 句，说完一件事就切回人物说话或动作。`;

function loadExemplars(limit = 3) {
    if (!fs.existsSync(SAMPLE_DIR)) return [];
    const files = fs.readdirSync(SAMPLE_DIR).filter((f) => f.endsWith('.json') && f !== 'baseline.json');
    const all = [];
    for (const file of files) {
        try {
            const parsed = JSON.parse(fs.readFileSync(path.join(SAMPLE_DIR, file), 'utf8'));
            for (const s of parsed.samples || []) {
                if (s.text && s.text.length >= 120) all.push({ book: parsed.book, kind: s.kind || '补充', text: s.text });
            }
        } catch { /* 跳过坏文件 */ }
    }
    const order = ['战斗/冲突', '日常/对话', '情绪/心理'];
    const picked = [];
    const used = new Set();
    for (const kind of order) {
        const idx = all.findIndex((s, i) => !used.has(i) && s.kind === kind);
        if (idx >= 0) { used.add(idx); picked.push(all[idx]); }
        if (picked.length >= limit) break;
    }
    for (let i = 0; i < all.length && picked.length < limit; i++) {
        if (!used.has(i)) { used.add(i); picked.push(all[i]); }
    }
    return picked;
}

function exemplarBlock(samples) {
    if (samples.length === 0) return '';
    const lines = ['【真人写作样文（照这个语感写：句子长短、用词、停顿、对话方式；不要抄句子，也不要抄情节）】'];
    samples.forEach((s, i) => {
        lines.push(`—— 样文 ${i + 1}（${s.kind}）——`);
        lines.push(s.text);
    });
    return lines.join('\n');
}

const samples = loadExemplars(3);
const variants = [
    { id: 'v1-quota', voice: QUOTA_BLOCK },
    { id: 'v2-exemplar', voice: exemplarBlock(samples) || WEAK_RULES },
    { id: 'v3-weak', voice: [exemplarBlock(samples), WEAK_RULES].filter(Boolean).join('\n\n') },
    { id: 'v4-dialogue', voice: [exemplarBlock(samples), WEAK_RULES, DIALOGUE_EMPHASIS].filter(Boolean).join('\n\n') },
];

function systemFor(variant) {
    return `你是一位小说编辑，负责把一篇有 AI 腔的稿子改回人写的语感。

要求（按顺序做）：
1. 先找出最多 3 处最像 AI 的地方（总结式升华、排比感慨、情绪直述、每段长短整齐、对话像念台词）。只列具体句子。
2. 对照下面的真人样文重写全文：句子长短、段落疏密、用词轻重都向样文靠。
3. 情节、人物、章节结构不变；字数 ±10%。
4. 输出**仅正文**，不要解释，不要 JSON，不要标题。

${variant.voice}`;
}

async function rewrite(variant, body) {
    const startedAt = Date.now();
    const response = await fetch(`${endpoint}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
            model,
            messages: [
                { role: 'system', content: systemFor(variant) },
                { role: 'user', content: `【原文（需要改回人味）】\n${body}` },
            ],
            max_tokens: 8192,
            temperature: 0.75,
            stream: false,
        }),
        signal: AbortSignal.timeout(180_000),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
    const parsed = JSON.parse(text);
    const content = String(parsed?.choices?.[0]?.message?.content || '').trim();
    return {
        content,
        usage: parsed?.usage || {},
        durationMs: Date.now() - startedAt,
    };
}

(async () => {
    const body = fs.readFileSync(INPUT, 'utf8').replace(/^---[\s\S]*?---\s*/, '').trim();
    if (body.length < 500) {
        console.error('输入正文太短，至少 500 字');
        process.exit(1);
    }
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const summary = [];
    for (const variant of variants) {
        try {
            const result = await rewrite(variant, body);
            const outPath = path.join(OUT_DIR, `${variant.id}.md`);
            fs.writeFileSync(outPath, result.content, 'utf8');
            summary.push({
                id: variant.id,
                ok: true,
                chars: result.content.replace(/\s+/g, '').length,
                output: path.relative(PLUGIN_ROOT, outPath),
                durationMs: result.durationMs,
                usage: result.usage,
            });
            console.log(`✅ ${variant.id}: ${result.content.length} 字（${result.durationMs}ms）→ ${outPath}`);
        } catch (error) {
            summary.push({ id: variant.id, ok: false, error: String(error).slice(0, 200) });
            console.error(`❌ ${variant.id}: ${error}`);
        }
    }
    fs.writeFileSync(path.join(OUT_DIR, 'summary.json'), `${JSON.stringify({
        input: INPUT,
        model,
        exemplarCount: samples.length,
        variants: summary,
        createdAt: new Date().toISOString(),
    }, null, 2)}\n`, 'utf8');
    console.log(`\n摘要：${path.join(OUT_DIR, 'summary.json')}`);
})();
