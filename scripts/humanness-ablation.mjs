/**
 * humanness-ablation.mjs — 规则/人味消融实验（6 组）
 *
 * 固定同一章上下文、同一份台词骨架、同模型同温度、关闭 thinking、不做后处理，
 * 只改「写作规则」与「人味块」两个变量：
 *
 *   G0 旧规则（vault 现状）+ 旧配额人味        —— 复现当前真实状态
 *   G1 新规则（仓库版）+ 旧配额人味            —— 只换规则
 *   G2 新规则 + 样文弱约束                     —— 只换人味
 *   G3 无规则 + 样文弱约束                     —— 规则总权重上限
 *   G4 仅格式段 + 样文弱约束                   —— 规则里哪部分有用
 *   G5 新规则去冲突版 + 样文弱约束             —— 冲突裁剪的收益
 *
 * 用法：node scripts/humanness-ablation.mjs [--chapter 1] [--groups G0,G1,...]
 * 输出：test-results/ablation/<group>.json + body.md + summary.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN = path.resolve(__dirname, '..');
const VAULT = path.resolve(PLUGIN, '..', '..', '..');
const PROJECT = path.join(VAULT, '长篇小说', '九霄逆脉行');
const OUT_DIR = path.join(PLUGIN, 'test-results', 'ablation');
const SKELETON_DIR = path.join(PLUGIN, 'test-results', 'humanness-rewrite');

const args = process.argv.slice(2);
const readArg = (name, fallback) => {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const CHAPTER = parseInt(readArg('--chapter', '1'), 10) || 1;
const GROUPS = readArg('--groups', 'G0,G1,G2,G3,G4,G5').split(',').map((g) => g.trim()).filter(Boolean);

const config = JSON.parse(fs.readFileSync(path.join(PLUGIN, 'data.json'), 'utf8'));
const endpoint = String(config.apiEndpoint).replace(/\/+$/, '');
const model = String(config.defaultModel || config.flashModel);
const key = config.providerKeys?.deepseek || config.apiKey;

const read = (rel) => {
    const p = path.isAbsolute(rel) ? rel : path.join(PROJECT, rel);
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
};
const stripFm = (t) => String(t || '').replace(/^---[\s\S]*?---\s*/, '').trim();

function hash(text) {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
}

// ---------- 三份规则文本 ----------
// 注意：元文件在 vault 根，不在项目目录内（read() 是项目相对路径）
const readVault = (rel) => {
    const p = path.join(VAULT, rel);
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
};
const OLD_RULES = stripFm(readVault('元文件/00-系统模板/写作规则.md'));
const NEW_RULES = stripFm(fs.readFileSync(path.join(PLUGIN, 'assets', 'template-scaffold', '00-系统模板', '写作规则.md'), 'utf8'));

/** 仅格式段：从新规则里抽 标点/段落/对话/字数 四节 */
function formatOnlyRules(text) {
    const lines = text.split('\n');
    const start = lines.findIndex((l) => /^##\s*格式参考/.test(l));
    if (start < 0) return '';
    const end = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
    return (end < 0 ? lines.slice(start) : lines.slice(start, end)).join('\n').trim();
}

/** 去冲突版：删掉与人味正面对冲的条款行 */
const CONFLICT_PATTERNS = [
    /一句一段/, /一段一个句号/, /对话单独成段/, /对话独立成段/,
    /不讲精确数字/, /门牌号/, /说["“]冷["”]/, /压缩包原则/,
    /很多年后/, /两个画面直接跳/,
];
function dedupeConflictRules(text) {
    return text.split('\n').filter((line) => !CONFLICT_PATTERNS.some((re) => re.test(line))).join('\n').trim();
}

const RULES = {
    old: OLD_RULES,
    new: NEW_RULES,
    none: '',
    format: formatOnlyRules(NEW_RULES),
    dedupe: dedupeConflictRules(NEW_RULES),
};

// ---------- 两套人味块 ----------
const QUOTA_VOICE = `【人味与可读性（最高优先级）】
1. 自然段 2–6 句、80–220 字；不要一句一段。
2. 句长平均 20–30 字；35 字以上占 10%–20%；10 字以下不超过 25%。
3. 不用分号；省略号全文最多 2 处；破折号全文最多 2 处。
4. 「不是A而是B」全篇最多 1 处；禁止排比式感慨；禁止末段升华。
5. 心理描写一次不超过 3 行；纯景物描写一次不超过 3 行；描写合计不超过两成。
6. 对话占 25%–45%。
7. 允许重复用词、口语；词汇过于「正确」本身就是 AI 特征。
8. 结尾落在动作、对话或悬念上。`;

const WEAK_VOICE = `【人味要求（照着上面的样文写语感，不要拿清单凑指标）】
1. 信息由人物说出来：每个场景至少 6–10 次对话来回，对话争取占到全文三分之一；不要用叙述者转述本该由角色说的话。
2. 叙述句长短混用：短句用来跑节奏，但每隔几句要有一个能连着读下去的长句；不要整篇都是碎句。
3. 让人物说人话：口语、口头禅、抢话、打断、答非所问都可以。
4. 用具体时间与序数定节拍：第几波、第几分钟、第几手、第几次。
5. 不写总结段、不写升华段；结尾落在动作、对话，或一句没说完的话上。
6. 如果给了【上一章结尾】，本章第一句从它的情境里接着写。`;

function exemplarBlock(limit = 3) {
    const dir = path.join(PLUGIN, 'data', 'human-samples');
    if (!fs.existsSync(dir)) return '';
    const all = [];
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'baseline.json')) {
        try {
            const parsed = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
            for (const s of parsed.samples || []) if (s.text && s.text.length >= 200) all.push(s);
        } catch { /* skip */ }
    }
    const order = ['战斗/冲突', '日常/对话', '情绪/心理'];
    const picked = [];
    for (const kind of order) {
        const hit = all.find((s) => s.kind === kind && !picked.includes(s));
        if (hit) picked.push(hit);
        if (picked.length >= limit) break;
    }
    while (picked.length < limit && all.length > picked.length) picked.push(all[picked.length]);
    if (picked.length === 0) return '';
    const lines = ['【真人写作样文（照这个语感写：句子长短、用词、停顿、对话方式；不要抄句子）】'];
    picked.forEach((s, i) => lines.push(`—— 样文 ${i + 1}（${s.kind}）——`, s.text));
    return lines.join('\n');
}

const VOICE = {
    quota: QUOTA_VOICE,
    exemplar: [exemplarBlock(), WEAK_VOICE].filter(Boolean).join('\n\n'),
};

// ---------- 章节上下文（固定不变） ----------
const VOL = '第1卷';
const ctx = {
    outline: stripFm(read(`03-大纲与章节/步骤结果/${VOL}/第${CHAPTER}章/第${CHAPTER}章_大纲摘要.md`)),
    infoPlan: stripFm(read(`03-大纲与章节/步骤结果/${VOL}/第${CHAPTER}章/第${CHAPTER}章_信息规划.md`)),
    prevEnding: CHAPTER > 1 ? stripFm(read(`03-大纲与章节/正文/${VOL}/第${CHAPTER - 1}章_正文.md`)).slice(-1500) : '',
    worldview: stripFm(read('01-世界架构/世界观总览.md')).slice(0, 3000),
    setting: stripFm(read('01-世界架构/设定库.md')).slice(0, 4000),
    chars: fs.existsSync(path.join(PROJECT, '01-世界架构', '人物'))
        ? fs.readdirSync(path.join(PROJECT, '01-世界架构', '人物')).filter((f) => f.endsWith('.md')).slice(0, 8).map((f) => {
            const raw = read(`01-世界架构/人物/${f}`);
            const pick = (k) => (raw.match(new RegExp(`^${k}:\\s*(.+)$`, 'm'))?.[1] || '').replace(/^"|"$/g, '').slice(0, 200);
            return `- ${f.replace('.md', '')}｜身份:${pick('身份')}｜状态:${pick('当前状态')}｜动机:${pick('核心动机')}`;
        }).join('\n')
        : '',
};

const skeletonPath = path.join(SKELETON_DIR, `ch${CHAPTER}-skeleton.txt`);
const SKELETON = fs.existsSync(skeletonPath) ? fs.readFileSync(skeletonPath, 'utf8').trim() : '';
if (!SKELETON) {
    console.error(`缺少台词骨架：${skeletonPath}（先跑 rewrite-two-chapters.mjs 生成）`);
    process.exit(1);
}

const GROUP_CONFIG = {
    G0: { rules: 'old', voice: 'quota', desc: '旧规则 + 旧配额人味（当前真实状态）' },
    G1: { rules: 'new', voice: 'quota', desc: '新规则 + 旧配额人味（只换规则）' },
    G2: { rules: 'new', voice: 'exemplar', desc: '新规则 + 样文弱约束（只换人味）' },
    G3: { rules: 'none', voice: 'exemplar', desc: '无规则 + 样文弱约束（规则总权重上限）' },
    G4: { rules: 'format', voice: 'exemplar', desc: '仅格式段 + 样文弱约束' },
    G5: { rules: 'dedupe', voice: 'exemplar', desc: '新规则去冲突版 + 样文弱约束' },
};

function buildPrompts(group) {
    const cfg = GROUP_CONFIG[group];
    const rulesText = RULES[cfg.rules];
    const voiceText = VOICE[cfg.voice];
    const system = [
        '你是小说作家，写中文长篇小说的章节正文。',
        rulesText ? `【写作规则】\n${rulesText}` : '',
        voiceText,
        '硬要求：\n- 必须把【台词清单】里的每一条都用上（可微调字词，不许删条、不许改成转述）。\n- 只写【本章大纲】与【信息规划】已确定的事件。\n- 字数 2000–2400 字。只输出正文，不要标题、不要解释。',
    ].filter(Boolean).join('\n\n');
    const user = [
        `【本章大纲】\n${ctx.outline}`,
        `【信息规划】\n${ctx.infoPlan.slice(0, 2500)}`,
        ctx.prevEnding ? `【上一章结尾】\n${ctx.prevEnding}` : '',
        `【世界观】\n${ctx.worldview}`,
        `【设定库】\n${ctx.setting}`,
        `【出场人物】\n${ctx.chars}`,
        `【台词清单（必须逐条用上）】\n${SKELETON}`,
    ].filter(Boolean).join('\n\n');
    return { system, user, rulesText, voiceText, cfg };
}

async function call(system, user) {
    const res = await fetch(`${endpoint}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
            model,
            messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
            max_tokens: 8192, temperature: 0.9, stream: false,
            thinking: { type: 'disabled' },
            seed: 20261031,
        }),
        signal: AbortSignal.timeout(240_000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    const parsed = JSON.parse(text);
    return { content: String(parsed?.choices?.[0]?.message?.content || '').trim(), usage: parsed.usage, finish: parsed?.choices?.[0]?.finish_reason };
}

/** 本地指标（与 shared/human-feature-rubric 同口径的精简版） */
function metrics(text) {
    const t = stripFm(text);
    const chars = Math.max(1, t.replace(/\s+/g, '').length);
    const blocks = [...t.matchAll(/[“"「]([^”"」]{0,500})[”"」]/g)].map((m) => m[1] || '');
    const dialogueChars = blocks.reduce((a, b) => a + b.replace(/\s+/g, '').length, 0);
    const narration = t.replace(/[“"「][^”"」]{0,500}[”"」]/g, '');
    const nSent = narration.split(/[。！？!?…]+/).map((s) => s.replace(/\s+/g, '')).filter(Boolean);
    const paragraphs = t.split(/\n+/).filter((p) => p.trim());
    const colloquial = (t.match(/好家伙|晓得|啥|咋|呗|嘛|啊|哦|哎|唉|得了吧|行吧|算了|顶不住|扛不住/g) || []).length;
    const anchors = (t.match(/第[一二三四五六七八九十百\d]+(?:波|分钟|秒|局|次|手|轮|天|年)/g) || []).length;
    return {
        chars,
        paragraphs: paragraphs.length,
        dialogueRatio: +(dialogueChars / chars).toFixed(3),
        dialogueBlocksPerKilo: +((blocks.length / chars) * 1000).toFixed(1),
        shortNarrationShare: +(nSent.filter((s) => s.length <= 25).length / Math.max(1, nSent.length)).toFixed(2),
        colloquialPerKilo: +((colloquial / chars) * 1000).toFixed(1),
        timeAnchors: anchors,
    };
}

(async () => {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const summary = [];
    for (const group of GROUPS) {
        const cfg = GROUP_CONFIG[group];
        if (!cfg) continue;
        const { system, user, rulesText, voiceText } = buildPrompts(group);
        const totalChars = system.length + user.length;
        const rulesShare = +(rulesText.length / Math.max(1, totalChars)).toFixed(3);
        try {
            const result = await call(system, user);
            const m = metrics(result.content);
            fs.writeFileSync(path.join(OUT_DIR, `${group}.body.md`), result.content, 'utf8');
            const record = {
                group,
                desc: cfg.desc,
                rulesKey: cfg.rules,
                voice: cfg.voice,
                rulesChars: rulesText.length,
                voiceChars: voiceText.length,
                systemChars: system.length,
                userChars: user.length,
                rulesShare,
                systemHash: hash(system),
                userHash: hash(user),
                model,
                temperature: 0.9,
                finish: result.finish,
                usage: result.usage,
                ...m,
            };
            fs.writeFileSync(path.join(OUT_DIR, `${group}.json`), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
            summary.push(record);
            console.log(`✅ ${group} ${cfg.desc}: ${m.chars} 字 · 对话 ${(m.dialogueRatio * 100).toFixed(0)}% · 规则占比 ${(rulesShare * 100).toFixed(0)}%`);
        } catch (error) {
            summary.push({ group, desc: cfg.desc, error: String(error).slice(0, 200) });
            console.error(`❌ ${group}: ${error}`);
        }
    }
    fs.writeFileSync(path.join(OUT_DIR, 'summary.json'), `${JSON.stringify({
        chapter: CHAPTER,
        measuredAt: new Date().toISOString(),
        skeletonHash: hash(SKELETON),
        groups: summary,
    }, null, 2)}\n`, 'utf8');
    console.log(`\n摘要：${path.join(OUT_DIR, 'summary.json')}`);
})();
