#!/usr/bin/env node
/**
 * sample-human-corpus.mjs — 从本地指纹资料库抽取真人样文 + 统计基线
 *
 * 背景：插件里所有「人味」提示词都是禁令清单，没有一段真人样文；10 套文风预设的
 * 「零、参考样本」也全是空占位。这里从用户本机的 `指纹资料库/*.txt` 抽 3 段/本
 * （战斗 / 日常 / 心理），落到插件 data 目录，供 few-shot 注入与「像不像人写」基线使用。
 *
 * **只写本地 data 目录，不进仓库、不进安装包**（材料是已出版网文，仅有本机使用权）。
 *
 * 用法：
 *   node scripts/sample-human-corpus.mjs                 # 默认读 vault/指纹资料库
 *   node scripts/sample-human-corpus.mjs --dir <path>    # 指定资料目录
 *   node scripts/sample-human-corpus.mjs --per-book 4    # 每本抽几段（默认 3）
 *
 * 输出：
 *   <plugin>/data/human-samples/<书名>.json   { book, encoding, samples: [{kind, text, chars}] }
 *   <plugin>/data/human-samples/baseline.json { version, books, sampleCount, distribution }
 *
 * 统计口径与 `shared/human-similarity.ts` 完全一致（那边有同口径对拍测试）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(__dirname, '..');
const VAULT_ROOT = path.resolve(PLUGIN_ROOT, '..', '..', '..');
const OUT_DIR = path.join(PLUGIN_ROOT, 'data', 'human-samples');

const args = process.argv.slice(2);
const readArg = (name, fallback) => {
    const index = args.indexOf(name);
    return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const SOURCE_DIR = readArg('--dir', path.join(VAULT_ROOT, '指纹资料库'));
const PER_BOOK = Math.max(1, Math.min(10, parseInt(readArg('--per-book', '3'), 10) || 3));

const SCENE_KINDS = [
    { kind: '战斗/冲突', keywords: ['刀', '剑', '血', '杀', '拳', '冲', '撞', '劈', '斩', '吼'] },
    { kind: '日常/对话', keywords: ['说', '问', '答', '笑', '坐', '吃', '喝', '走', '道：', '：“'] },
    { kind: '情绪/心理', keywords: ['心', '怕', '怒', '恨', '痛', '悔', '颤', '沉默', '眼眶', '喉咙'] },
];

/** 编码探测：UTF-8 可解则用 UTF-8，否则按 GB18030（覆盖 GBK/GB2312） */
function decodeBuffer(buffer) {
    const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
    const replacementRatio = (utf8.match(/\uFFFD/g) || []).length / Math.max(1, utf8.length);
    if (replacementRatio < 0.001) return { text: utf8.replace(/^\uFEFF/, ''), encoding: 'utf-8' };
    const gb = new TextDecoder('gb18030', { fatal: false }).decode(buffer);
    return { text: gb.replace(/^\uFEFF/, ''), encoding: 'gb18030' };
}

/** 与 services/knowledge-original-chunker.ts 同参数的切分：按空行成段、拼到 ~400 字 */
function chunkText(text, { chunkSize = 400, minChunkSize = 200, maxChunks = 400 } = {}) {
    let normalized = String(text || '').replace(/\r\n/g, '\n');
    // 有些 txt 是「一行一段」没有空行（如《完美世界》），先按空行切；
    // 块数过少时补一个空行再切，否则整本只能切出 1-2 块、抽样退化成"整本书的开头"。
    const blankLineBlocks = normalized.split(/\n{2,}/).filter((p) => p.trim().length >= 20).length;
    if (blankLineBlocks < 50) normalized = normalized.replace(/\n(?!\n)/g, '\n\n');
    const paragraphs = normalized
        .split(/\n{2,}/)
        .map((p) => p.replace(/[ \t]+/g, ' ').trim())
        .filter((p) => p.length >= 20 && !/^第[0-9一二三四五六七八九十百千]+章/.test(p));
    // 超长段（有些 txt 整本只有几个巨型段落）先按句末标点硬切成 ~chunkSize 的片段，
    // 否则整本只能切出 1-2 块，抽样退化成"整本书的开头"。
    const flat = [];
    for (const paragraph of paragraphs) {
        if (paragraph.length <= chunkSize) {
            flat.push(paragraph);
            continue;
        }
        let piece = '';
        for (const sentence of paragraph.split(/(?<=[。！？!?…])/)) {
            if (piece.length + sentence.length > chunkSize && piece.length > 0) {
                flat.push(piece);
                piece = '';
            }
            piece += sentence;
        }
        if (piece.length > 0) flat.push(piece);
    }

    const chunks = [];
    let buffer = '';
    for (const paragraph of flat) {
        if (buffer.length + paragraph.length + 1 > chunkSize && buffer.length >= minChunkSize) {
            chunks.push(buffer.trim());
            buffer = '';
            if (chunks.length >= maxChunks) break;
        }
        buffer = buffer ? `${buffer}\n${paragraph}` : paragraph;
    }
    if (buffer.trim().length >= minChunkSize && chunks.length < maxChunks) chunks.push(buffer.trim());
    return chunks;
}

function scoreChunk(chunk, keywords) {
    let score = 0;
    for (const keyword of keywords) {
        const hits = chunk.split(keyword).length - 1;
        score += Math.min(hits, 4);
    }
    // 长度偏好 300–500 字
    const len = chunk.length;
    if (len >= 300 && len <= 500) score += 3;
    else if (len > 500 && len <= 700) score += 1;
    else if (len < 240) score -= 2;
    return score;
}

function pickSamples(chunks, perBook) {
    const picked = [];
    const used = new Set();
    for (const scene of SCENE_KINDS) {
        let best = null;
        let bestScore = -Infinity;
        chunks.forEach((chunk, index) => {
            if (used.has(index)) return;
            const score = scoreChunk(chunk, scene.keywords);
            if (score > bestScore) {
                bestScore = score;
                best = { index, chunk };
            }
        });
        if (best && bestScore > 0) {
            used.add(best.index);
            picked.push({ kind: scene.kind, text: best.chunk, chars: best.chunk.length });
        }
        if (picked.length >= perBook) break;
    }
    // 不足则按顺序补足（保证每本都有可用样文）
    for (let i = 0; i < chunks.length && picked.length < perBook; i++) {
        if (used.has(i)) continue;
        used.add(i);
        picked.push({ kind: '补充', text: chunks[i], chars: chunks[i].length });
    }
    return picked;
}

// ---------- 统计（与 shared/human-similarity.ts 同口径） ----------
const BUCKETS = 20;

function toHistogram(values, bucketSize) {
    const buckets = new Array(BUCKETS).fill(0);
    for (const value of values) {
        buckets[Math.min(BUCKETS - 1, Math.max(0, Math.floor(value / bucketSize)))] += 1;
    }
    const total = buckets.reduce((sum, n) => sum + n, 0);
    return total > 0 ? buckets.map((n) => n / total) : buckets;
}

function analyzeDistribution(raw) {
    const text = String(raw || '')
        .replace(/^---[\s\S]*?---\s*/, '')
        .split('\n')
        .filter((line) => !/^\s*#/.test(line) && !/^\s*>/.test(line) && !/^\s*\|/.test(line))
        .join('\n');
    const paragraphs = text.split(/\n+/).map((p) => p.trim()).filter((p) => p.length > 0);
    const sentences = text.split(/[。！？!?…]+/).map((s) => s.replace(/\s+/g, '')).filter((s) => s.length > 0);
    const chars = Math.max(1, text.replace(/\s+/g, '').length);
    const count = (re) => (text.match(re) || []).length;
    const dialogueChars = [...text.matchAll(/[“"「]([^”"」]{0,400})[”"」]/g)]
        .reduce((sum, m) => sum + (m[1] ? m[1].replace(/\s+/g, '').length : 0), 0);
    return {
        chars,
        sentenceCount: sentences.length,
        paragraphCount: paragraphs.length,
        sentence: toHistogram(sentences.map((s) => s.length), 10),
        paragraph: toHistogram(paragraphs.map((p) => p.length), 40),
        punctuation: {
            period: count(/。/g) / chars,
            comma: (count(/，/g) + count(/,/g)) / chars,
            semicolon: (count(/；/g) + count(/;/g)) / chars,
            ellipsis: (count(/…/g) + count(/\.\.\./g)) / chars,
            dash: (count(/——/g) + count(/—/g)) / chars,
            exclamation: (count(/！/g) + count(/!/g)) / chars,
            question: (count(/？/g) + count(/\?/g)) / chars,
        },
        dialogueRatio: dialogueChars / chars,
    };
}

/** 多段文本按字符加权平均，得到语料级基线 */
function mergeDistributions(distributions) {
    const totalChars = distributions.reduce((sum, d) => sum + d.chars, 0) || 1;
    const mergeHist = (key) => {
        const merged = new Array(BUCKETS).fill(0);
        for (const d of distributions) {
            const weight = d.chars / totalChars;
            d[key].forEach((value, i) => { merged[i] += value * weight; });
        }
        const total = merged.reduce((sum, n) => sum + n, 0) || 1;
        return merged.map((n) => n / total);
    };
    const mergeScalar = (picker) =>
        distributions.reduce((sum, d) => sum + picker(d) * (d.chars / totalChars), 0);
    const punctKeys = ['period', 'comma', 'semicolon', 'ellipsis', 'dash', 'exclamation', 'question'];
    return {
        sentence: mergeHist('sentence'),
        paragraph: mergeHist('paragraph'),
        punctuation: Object.fromEntries(punctKeys.map((key) => [key, mergeScalar((d) => d.punctuation[key])])),
        dialogueRatio: mergeScalar((d) => d.dialogueRatio),
    };
}

function main() {
    if (!fs.existsSync(SOURCE_DIR)) {
        console.error(`找不到资料目录：${SOURCE_DIR}`);
        console.error('用 --dir <path> 指定《指纹资料库》所在目录。');
        process.exit(1);
    }
    const files = fs.readdirSync(SOURCE_DIR).filter((name) => name.toLowerCase().endsWith('.txt'));
    if (files.length === 0) {
        console.error(`目录里没有 .txt：${SOURCE_DIR}`);
        process.exit(1);
    }
    fs.mkdirSync(OUT_DIR, { recursive: true });

    const distributions = [];
    const books = [];
    for (const file of files) {
        const full = path.join(SOURCE_DIR, file);
        const buffer = fs.readFileSync(full);
        const { text, encoding } = decodeBuffer(buffer);
        const chunks = chunkText(text);
        if (chunks.length === 0) {
            console.warn(`跳过（切不出样文）：${file}`);
            continue;
        }
        const book = file.replace(/\.txt$/i, '');
        const samples = pickSamples(chunks, PER_BOOK);
        fs.writeFileSync(
            path.join(OUT_DIR, `${book}.json`),
            `${JSON.stringify({ book, encoding, source: 'local', sampledAt: new Date().toISOString(), samples }, null, 2)}\n`,
            'utf8',
        );
        // 每本书用全部块统计（不是抽样块），基线更稳
        distributions.push(analyzeDistribution(chunks.join('\n\n')));
        books.push({ book, encoding, chunks: chunks.length, samples: samples.length });
        console.log(`✅ ${book}（${encoding}）：${chunks.length} 块 → 抽 ${samples.length} 段`);
    }

    if (distributions.length === 0) {
        console.error('没有任何书产出样文，未写基线。');
        process.exit(1);
    }
    const baseline = {
        version: 1,
        generatedAt: new Date().toISOString(),
        books,
        sampleCount: books.reduce((sum, b) => sum + b.samples, 0),
        distribution: mergeDistributions(distributions),
    };
    fs.writeFileSync(path.join(OUT_DIR, 'baseline.json'), `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
    console.log(`\n基线已写入：${path.relative(PLUGIN_ROOT, path.join(OUT_DIR, 'baseline.json'))}`);
    console.log(`共 ${books.length} 本 / ${baseline.sampleCount} 段样文（仅本机，未进仓库）`);
}

main();
