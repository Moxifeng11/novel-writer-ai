/**
 * humanness-combo.mjs —— 规则版本 × 正文模板 × 人味块 × 注入段 的组合实验
 *
 * 与 humanness-ablation.mjs 的区别：本脚本**不手抄提示词**。它用 esbuild 把
 * `scripts/fixtures/prompt-exports.ts` 打包成 ESM 再 import，所以实验里的正文模板、
 * 规则文本、人味块、工艺块与插件运行时是同一份源文件（含本轮新增的 V3/V4）。
 *
 * 用法：
 *   node scripts/humanness-combo.mjs                 # 跑全部组合
 *   node scripts/humanness-combo.mjs --groups C3,C5  # 只跑指定组
 *   node scripts/humanness-combo.mjs --chapter 2
 *
 * 输出：data/experiments/combo/<group>.{md,json} + summary.json（按 rubric 总分排序）
 * 注意：不能放 test-results/——Playwright 每轮会把整个目录清空。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN = path.resolve(__dirname, '..');
const VAULT = path.resolve(PLUGIN, '..', '..', '..');
const PROJECT = path.join(VAULT, '长篇小说', '九霄逆脉行');
const OUT_DIR = path.join(PLUGIN, 'data', 'experiments', 'combo');
const EXP_DIR = path.join(PLUGIN, 'data', 'experiments');
const FIXTURE_OUT = path.join(PLUGIN, '.tmp-rollup', 'prompt-fixture.mjs');

const args = process.argv.slice(2);
const readArg = (name, fallback) => {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const CHAPTER = parseInt(readArg('--chapter', '1'), 10) || 1;
const DRY = args.includes('--dry');
/** 重复采样次数：provider 不保证 seed 生效，同一提示词两次可差 40 分，组间比较必须取均值 */
const TAG = String(readArg('--tag', '')).trim();

// ---------- 组合定义 ----------
// rules: base360 | legacy | anchor370 | scene380 | voiceprint390
// template: v1 | v2 | v3 | v4
// voice: quota | exemplar
// craft: 是否注入 craftConstraints + negativeList（V3/V4 模板本身不含这两个占位）
const GROUPS = {
    C0: { rules: 'base360', template: 'v2', voice: 'quota', craft: true, desc: '现状基线：V2 + 3.6.0 + 配额人味 + 禁用清单/工艺块' },
    C1: { rules: 'base360', template: 'v2', voice: 'exemplar', craft: true, desc: '只换人味（对照）' },
    C2: { rules: 'anchor370', template: 'v2', voice: 'exemplar', craft: true, desc: '只换规则：正向锚点（V2 不变）' },
    C3: { rules: 'anchor370', template: 'v3', voice: 'exemplar', craft: false, desc: '锚点规则 + V3 节拍先行' },
    C4: { rules: 'scene380', template: 'v3', voice: 'exemplar', craft: false, desc: '场景节拍规则 + V3 节拍先行' },
    C5: { rules: 'scene380', template: 'v4', voice: 'exemplar', craft: false, desc: '场景节拍规则 + V4 对话主干' },
    C6: { rules: 'voiceprint390', template: 'v4', voice: 'exemplar', craft: false, desc: '真人特征规则 + V4 对话主干' },
    C7: { rules: 'base360', template: 'v2', voice: 'exemplar', craft: false, desc: '段消融：去掉禁用清单/工艺块（其余同 C1）' },
    // C8–C10：在 system 末尾追加「可数硬指标」。用来验证一个假设：
    // 对话/口语/时间锚点这三项是真能被提示词推动，还是模型根本不按比例指令执行。
    C8: { rules: 'anchor370', template: 'v3', voice: 'exemplar', craft: false, append: 'countable', desc: 'C3 + 可数硬指标（时间锚点/口语/对话段数）' },
    C9: { rules: 'voiceprint390', template: 'v4', voice: 'exemplar', craft: false, append: 'countable', desc: 'C6 + 可数硬指标' },
    C10: { rules: 'scene380', template: 'v2', voice: 'exemplar', craft: false, append: 'countable', desc: '场景节拍 + V2 + 可数硬指标（隔离模板变量）' },
};

const WANTED = readArg('--groups', Object.keys(GROUPS).join(','))
    .split(',').map((g) => g.trim()).filter((g) => GROUPS[g]);

// ---------- 打包真实提示词 ----------
async function loadFixture() {
    fs.mkdirSync(path.dirname(FIXTURE_OUT), { recursive: true });
    await build({
        entryPoints: [path.join(__dirname, 'fixtures', 'prompt-exports.ts')],
        bundle: true,
        platform: 'node',
        format: 'esm',
        target: 'node18',
        outfile: FIXTURE_OUT,
        logLevel: 'silent',
    });
    return import(`${pathToFileURL(FIXTURE_OUT).href}?t=${Date.now()}`);
}

// ---------- 真实章节上下文 ----------
const read = (rel) => {
    const p = path.isAbsolute(rel) ? rel : path.join(PROJECT, rel);
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
};
const readVault = (rel) => {
    const p = path.join(VAULT, rel);
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
};
const stripFm = (t) => String(t || '').replace(/^---[\s\S]*?---\s*/, '').trim();
const VOL = '第1卷';
const stepFile = (name) => stripFm(read(`03-大纲与章节/步骤结果/${VOL}/第${CHAPTER}章/第${CHAPTER}章_${name}.md`));

/** 章名可变（`第N章_章名_正文.md`），按前缀找文件，避免改名后读不到 */
function readBody(num) {
    const dir = path.join(PROJECT, '03-大纲与章节', '正文', VOL);
    if (!fs.existsSync(dir)) return '';
    const file = fs.readdirSync(dir).find((f) => f.startsWith(`第${num}章`) && f.endsWith('_正文.md'));
    return file ? stripFm(fs.readFileSync(path.join(dir, file), 'utf8')) : '';
}

/** 台词骨架：优先读人工/历史骨架；没有就从该章现有正文里抽对话行（保持顺序与重复） */
function loadSkeleton() {
    const saved = path.join(EXP_DIR, `ch${CHAPTER}-skeleton.txt`);
    if (fs.existsSync(saved)) return fs.readFileSync(saved, 'utf8').trim();
    const body = readBody(CHAPTER);
    const lines = [...body.matchAll(/[“「]([^”」]{1,200})[”」]/g)]
        .map((m) => (m[1] || '').trim())
        .filter((line) => line.length >= 1);
    if (lines.length === 0) return '';
    const numbered = lines.slice(0, 48).map((line, i) => `${i + 1}. ${line}`).join('\n');
    fs.mkdirSync(EXP_DIR, { recursive: true });
    fs.writeFileSync(saved, `${numbered}\n`, 'utf8');
    return numbered;
}

const ctx = {
    outline: stepFile('大纲摘要'),
    infoPlan: stepFile('信息规划'),
    distilledContent: stepFile('情节蒸馏'),
    sceneExpansion: stepFile('场景展开'),
    sceneCardDigest: stepFile('场景卡'),
    prevEnding: CHAPTER > 1 ? readBody(CHAPTER - 1).slice(-1500) : '',
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
const SKELETON = loadSkeleton();
if (!SKELETON) {
    console.error(`无法生成台词骨架：请先写 data/experiments/ch${CHAPTER}-skeleton.txt，或确认第${CHAPTER}章正文存在`);
    process.exit(1);
}

// ---------- API ----------
const config = JSON.parse(fs.readFileSync(path.join(PLUGIN, 'data.json'), 'utf8'));
const endpoint = String(config.apiEndpoint).replace(/\/+$/, '');
const model = String(config.defaultModel || config.flashModel);
const key = config.providerKeys?.deepseek || config.apiKey;

async function call(system, user) {
    const res = await fetch(`${endpoint}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
            model,
            messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
            max_tokens: 8192,
            temperature: 0.9,
            stream: false,
            thinking: { type: 'disabled' },
            seed: 20261101,
        }),
        signal: AbortSignal.timeout(240_000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    const parsed = JSON.parse(text);
    return {
        content: String(parsed?.choices?.[0]?.message?.content || '').trim(),
        usage: parsed.usage,
        finish: parsed?.choices?.[0]?.finish_reason,
    };
}

(async () => {
    const fx = await loadFixture();
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const summary = [];

    for (const group of WANTED) {
        const cfg = GROUPS[group];
        const label = TAG ? `${group}-${TAG}` : group;
        const rulesText = fx.RULES[cfg.rules] || '';
        const template = fx.BODY_TEMPLATES[cfg.template];
        const bodyFormat = fx.describeBodyFormat({ ...fx.deriveBodyFormat(rulesText), allowTitle: true });

        const vars = {
            writingRules: rulesText,
            humanVoice: fx.VOICE[cfg.voice] || '',
            craftConstraints: cfg.craft ? fx.CRAFT_BLOCK : '',
            negativeList: cfg.craft ? fx.NEGATIVE_BLOCK : '',
            bodyFormat,
            baseWords: '2400',
            protagonistName: '陈默',
            worldType: '东方玄幻',
            worldEra: '王朝末年，修行者与凡人混居',
            forbiddenElements: '现代科技、枪械、网络',
            powerSystem: '经脉灵气九重，突破需灵石与心境',
            prevChapterStateSnapshot: ctx.prevEnding.slice(0, 400),
            dialogueSkeleton: SKELETON,
            outlineContent: ctx.outline,
            infoPlan: ctx.infoPlan.slice(0, 2500),
            distilledContent: ctx.distilledContent.slice(0, 2500),
            sceneExpansion: ctx.sceneExpansion.slice(0, 3000),
            sceneCardDigest: ctx.sceneCardDigest.slice(0, 3000),
            storyContextPack: '',
            prevChapEnding: ctx.prevEnding || '（本章为开篇）',
            prevChaptersSummary: '',
            allChars: ctx.chars,
            allFactions: '',
            allLocs: '',
            allItems: '',
            worldView: ctx.worldview,
            settingLib: ctx.setting,
            timelineEvents: '',
            unrevealedForeshadow: '',
            forcedRevealHint: '',
            writingStyleContent: '',
            fanficRules: '',
            chapNum: String(CHAPTER),
            emotionPlan: '',
            protagonistSoulDetail: '',
            triggeredMemories: '',
            sceneStyleSnippet: '',
            suggestedRhythm: '',
            longTermMemory: '',
            entityRelations: '',
            chapPlan: '',
            chapterHook: '',
            creationModePrompt: '',
        };

        // 占位符兜底：模板里出现但没赋值的变量一律填空串，避免 ${x} 字面量漏进 prompt
        const placeholders = new Set();
        for (const text of [template.system, template.user]) {
            for (const m of text.matchAll(/\$\{(\w+)\}/g)) placeholders.add(m[1]);
        }
        for (const name of placeholders) if (vars[name] === undefined) vars[name] = '';

        const system = fx.fillTemplate(template.system, vars) + (cfg.append === 'countable' ? `\n\n${fx.COUNTABLE_HUMAN_HINTS}` : '');
        const user = fx.fillTemplate(template.user, vars);
        const totalChars = system.length + user.length;
        const rulesShare = +(rulesText.length / Math.max(1, totalChars)).toFixed(3);
        const craftShare = +(((cfg.craft ? fx.CRAFT_BLOCK.length + fx.NEGATIVE_BLOCK.length : 0)) / Math.max(1, totalChars)).toFixed(3);

        try {
            if (DRY) {
                fs.writeFileSync(path.join(OUT_DIR, `${label}.dry.txt`), `${system}\n\n===== USER =====\n\n${user}`, 'utf8');
                summary.push({
                    group, desc: cfg.desc, rules: cfg.rules, template: cfg.template, voice: cfg.voice, craft: cfg.craft,
                    rulesChars: rulesText.length, rulesShare, craftShare,
                    systemChars: system.length, userChars: user.length,
                    systemHash: fx.hashContent(system), userHash: fx.hashContent(user),
                    leaked: [...placeholders].filter((name) => !vars[name]),
                });
                console.log(`🧪 ${label} dry: system ${system.length} · user ${user.length} · 规则占比 ${(rulesShare * 100).toFixed(1)}% · 工艺占比 ${(craftShare * 100).toFixed(1)}%`);
                continue;
            }
            const result = await call(system, user);
            if (!result.content) throw new Error(`空返回（finish=${result.finish}）`);
            const metrics = fx.analyzeHumanFeatures(result.content);
            const rubric = fx.evaluateHumanFeatures(result.content);
            fs.writeFileSync(path.join(OUT_DIR, `${label}.md`), result.content, 'utf8');
            const record = {
                group: label,
                desc: cfg.desc,
                rules: cfg.rules,
                template: cfg.template,
                voice: cfg.voice,
                craft: cfg.craft,
                rulesChars: rulesText.length,
                craftChars: cfg.craft ? fx.CRAFT_BLOCK.length + fx.NEGATIVE_BLOCK.length : 0,
                systemChars: system.length,
                userChars: user.length,
                rulesShare,
                craftShare,
                systemHash: fx.hashContent(system),
                userHash: fx.hashContent(user),
                model,
                temperature: 0.9,
                seed: 20261101,
                finish: result.finish,
                usage: result.usage,
                chars: result.content.replace(/\s+/g, '').length,
                ...metrics,
                rubricScore: rubric.score,
                rubricPass: rubric.pass,
                rubricIssues: rubric.issues.map((i) => i.message),
            };
            fs.writeFileSync(path.join(OUT_DIR, `${label}.json`), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
            summary.push(record);
            console.log(`✅ ${label} ${cfg.desc}: ${record.chars} 字 · 对话 ${(metrics.dialogueRatio * 100).toFixed(0)}% · 短叙述 ${metrics.shortNarrationShare} · rubric ${rubric.score}`);
        } catch (error) {
            summary.push({ group: label, desc: cfg.desc, error: String(error).slice(0, 300) });
            console.error(`❌ ${label}: ${error}`);
        }
    }

    const sorted = [...summary].sort((a, b) => (b.rubricScore || 0) - (a.rubricScore || 0));
    fs.writeFileSync(path.join(OUT_DIR, 'summary.json'), `${JSON.stringify({
        chapter: CHAPTER,
        measuredAt: new Date().toISOString(),
        skeletonHash: fx.hashContent(SKELETON),
        groups: sorted,
    }, null, 2)}\n`, 'utf8');
    console.log('\n排名（rubric）：');
    for (const record of sorted) {
        if (record.error) { console.log(`  ${record.group}  失败：${record.error}`); continue; }
        console.log(`  ${record.group}  ${(record.rubricScore * 100).toFixed(0).padStart(3)}  ${record.desc}`);
    }
    console.log(`\n摘要：${path.join(OUT_DIR, 'summary.json')}`);
})();
