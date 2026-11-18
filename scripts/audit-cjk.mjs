#!/usr/bin/env node
/**
 * audit-cjk.mjs — 全仓剩余 CJK 分类盘点（i18n 跨层数据⑥，ZC-20261120-06）
 *
 * 与 `check-i18n.mjs` 的分工：
 *   - `check-i18n.mjs` 是**门禁**，只盯 `ui/**`，只问「有没有变多」。
 *   - 本脚本是**体检**，扫 `ui/ shared/ services/ domains/ engine/`，
 *     逐个文件回答「还剩多少中文、属于哪一类、该不该迁」。
 *
 * 为什么要分类：不是所有中文都该进资源。AI 提示词、落盘 Markdown 模板、
 * 解析用的匹配键、跨层稳定值（喂给 LLM 或落盘的字段值）迁了会**改行为**，
 * 必须保留并在报告里写明理由。见 `docs/modules/i18n.md` §7 的甄别口径。
 *
 * 用法：
 *   node scripts/audit-cjk.mjs                       # 人读摘要
 *   node scripts/audit-cjk.mjs --json                # 机器读（stdout 纯 JSON）
 *   node scripts/audit-cjk.mjs --json --out=x.json   # 写文件
 *   node scripts/audit-cjk.mjs --md                  # Markdown 表格（直接贴进审计文档）
 *   node scripts/audit-cjk.mjs --min=5               # 只列字面量 ≥5 的文件
 *
 * 退出码恒为 0：这是体检不是门禁，数字变多由 `check-i18n.mjs` 拦。
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, relative, sep, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/** 扫描范围：界面层 + 会被界面/引擎共用、可能夹带展示文案的层 */
const AUDIT_DIRS = ['ui', 'shared', 'services', 'domains', 'engine'];
const CJK = /[\u4e00-\u9fff]/u;
const CJK_ALL = /[\u4e00-\u9fff]/gu;

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const asMd = args.includes('--md');
const outArg = args.find(a => a.startsWith('--out='));
const minArg = args.find(a => a.startsWith('--min='));
const MIN = minArg ? Number(minArg.slice(6)) : 1;

function collectTs(dir, out = []) {
    if (!existsSync(dir)) return out;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name === '__mocks__') continue;
            collectTs(full, out);
        } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
            out.push(full);
        }
    }
    return out;
}

const rel = file => relative(ROOT, file).split(sep).join('/');
const countChars = text => (text.match(CJK_ALL) || []).length;

/**
 * 逐文件统计：中文**字符串字面量**条数、字面量内中文字符数、全文件中文字符数。
 *
 * 只看字符串字面量是因为那是「会显示给用户/会写进文件」的唯一载体；
 * 注释里的中文不影响界面语言，但保留统计以便区分「这文件其实只剩注释」。
 */
function measure(file) {
    const source = readFileSync(file, 'utf8');
    const totalChars = countChars(source);
    if (totalChars === 0) return null;
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    let literals = 0;
    let literalChars = 0;
    let longest = 0;
    // 形态标记：用来区分「日志串」与「界面文案」——两者都短，但消费者完全不同
    let logLiterals = 0;
    let pathLiterals = 0;
    let noticeLiterals = 0;
    let regexLiterals = 0;
    let promptLiterals = 0;
    let enumLiterals = 0;
    const samples = [];
    /** 向上找最近的调用名（决定这条字面量交给谁）：支持 `f('x')` 与 `log.info('x')` */
    const enclosingCall = node => {
        let cur = node.parent;
        for (let depth = 0; cur && depth < 6; depth += 1, cur = cur.parent) {
            if (!ts.isCallExpression(cur)) continue;
            if (ts.isIdentifier(cur.expression)) return cur.expression.text;
            if (ts.isPropertyAccessExpression(cur.expression) && ts.isIdentifier(cur.expression.name)) {
                return cur.expression.name.text;
            }
        }
        return '';
    };
    /**
     * 该字面量是否是某个对象的展示字段值（`{ message: '…' }` / `{ label: '…' }`）。
     *
     * 引擎层常用 `onProgress?.({ phase, percent, message: '指纹提取完成' })`
     * 把中文快照抛给界面——消费者是用户，属漏到下层的界面文案。
     */
    const DISPLAY_PROPS = /^(message|msg|label|text|title|desc|description|hint|placeholder|placeholderText|reason|summary|tip|tooltip|error|errorMessage|statusText|progressText)$/;
    const displayPropOf = node => {
        const parent = node.parent;
        if (parent && ts.isPropertyAssignment(parent) && parent.initializer === node) {
            const name = parent.name;
            if (ts.isIdentifier(name) && DISPLAY_PROPS.test(name.text)) return name.text;
            if (ts.isStringLiteral(name) && DISPLAY_PROPS.test(name.text)) return name.text;
        }
        return '';
    };
    const visit = node => {
        const hit = (text, callName, propName) => {
            if (!CJK.test(text)) return;
            literals += 1;
            const chars = countChars(text);
            literalChars += chars;
            if (text.length > longest) longest = text.length;
            // 提示词形态：超长且带「按以下格式」「严格」「不要」这类指令骨架
            if (text.length >= 150 && /(按以下|请严格|不要|输出格式|必须|禁止|要求|规则如下|【)/.test(text)) promptLiterals += 1;
            // 枚举值形态：极短（≤6 字）、无标点、无空格 —— 典型是分类/字段名/标签值
            if (text.length <= 6 && !/[，。！？；：、（）「」《》“”…\s]/.test(text)) enumLiterals += 1;
            // 日志：log.info('中文') / console.warn('中文')
            if (/^(log|logger|warn|error|info|debug|trace|console)$/.test(callName)) logLiterals += 1;
            // 通知/进度：showNotice/new Notice/setStatus 等具名调用
            else if (/^(showNotice|showWarningNotice|showErrorNotice|showSuccessNotice|Notice|setStatus|setStatusText|setProgress|setProgressText|reportProgress|toast)$/.test(callName)) noticeLiterals += 1;
            // 展示字段：`{ message: '中文' }` / `{ label: '中文' }`
            else if (propName) noticeLiterals += 1;
            // 正则源：new RegExp('中文…') 或 /中文…/ 字面量
            else if (callName === 'RegExp') regexLiterals += 1;
            // 路径：含 / 或 \ 且整体不长，或形如 `01-世界架构.md`
            else if (/[\/\\]/.test(text) && text.length <= 80) pathLiterals += 1;
            else if (/^\d{2}-[\u4e00-\u9fff]/.test(text)) pathLiterals += 1;
            if (samples.length < 6) {
                const oneLine = text.replace(/\s+/g, ' ').trim();
                if (oneLine) samples.push(oneLine.length > 60 ? oneLine.slice(0, 60) + '…' : oneLine);
            }
        };
        const callName = enclosingCall(node);
        const propName = displayPropOf(node);
        if (ts.isRegularExpressionLiteral(node)) {
            // 正则字面量（/中文…/ ：解析用，属数据）
            if (CJK.test(node.text)) {
                literals += 1;
                literalChars += countChars(node.text);
                regexLiterals += 1;
                if (samples.length < 6) samples.push(node.text.length > 60 ? node.text.slice(0, 60) + '…' : node.text);
            }
        } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
            hit(node.text, callName, propName);
        } else if (ts.isTemplateExpression(node)) {
            hit(node.head.text, callName, propName);
            for (const span of node.templateSpans) hit(span.literal.text, callName, propName);
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return { literals, literalChars, totalChars, outsideLiterals: totalChars - literalChars, longest, logLiterals, pathLiterals, noticeLiterals, regexLiterals, promptLiterals, enumLiterals, samples };
}

// ---------------------------------------------------------------------------
// 分类规则
//
// 判定优先级（先命中先定），依据是「这段中文的消费者是谁」：
//   1. 一个中文字符串字面量都没有              → comment-only（注释/标识符，不影响界面）
//   2. MANUAL 里有人工结论                     → 直接采用（人工看过代码，胜过任何猜测）
//   3. 文件名/路径带 prompt|instruction        → ai-prompt（喂 LLM，改语言即改行为）
//   4. 文件名/路径带 template|scaffold|sample  → on-disk-template（落盘 Markdown，解析依赖）
//   5. shard: ui/**                            → ui-copy（界面层，默认该迁）
//   6. 单条超长（≥200 字）                     → 有指令骨架则 ai-prompt，否则 long-text
//   7. 字面量 ≥200 条且均长 <12 字             → corpus（词表/语料）
//   8. 有提示词骨架但不算长                    → ai-prompt
//   9. 正则占多数                              → parse-key
//  10. 日志调用占多数                          → log-message
//  11. 盘上路径占多数                          → disk-path
//  12. 极短无标点条目占多数（≥30 条）          → enum-value
//  13. 具名展示调用/展示字段占 30%+            → ui-copy-in-engine（漏到下层的界面文案，该迁）
//  14. 其余                                    → cross-layer（需人判断，默认保留待审）
//
// 第 6 条是实测补的：`engine/dimension-keywords.ts` 有 2923 条字面量（情绪词表），
// `engine/ai-outline-generator.ts` 的长串是内嵌提示词，`shared/writing-rules-legacy.ts`
// 只有 1 条但 2678 字（整份写作规则模板）——都被路径规则误判进 cross-layer 过，
// 会让报告里最该解释的桶变成垃圾桶。
//
// 第 2 条（MANUAL）刻意放在最前：自动分类只能看形态，看不出「这个字段值会被写进
// 项目配置并被再次读回」这种语义，人工核实过的结论必须能覆盖机器判断。
// ---------------------------------------------------------------------------
const MANUAL = {
    'ui/co-write-floating-panel.ts': {
        category: 'ui-copy',
        conclusion: '待迁：113 条为浮窗控制台文案，另有 4 处状态串（编辑中/已加载/已保存/保存失败）应复用 save-state 枚举',
    },
    'ui/co-writing-view.ts': {
        category: 'ui-copy',
        conclusion: '待迁：77 条为主视图残留（章节流转、结算提示、快捷键帮助）',
    },
    'shared/creation-mode.ts': {
        category: 'cross-layer',
        conclusion: '保留：GenderChannel 的「女频/男频/通用」是落盘枚举值（项目配置里逐字存），不翻译；展示名走 mode 分区键',
    },
    'engine/knowledge-tags.ts': {
        category: 'cross-layer',
        conclusion: '保留：标签默认值（男频/玄幻…）是落盘数据，用户可见但属内容不属界面文案',
    },
    'engine/agent/harness/repair-tools.ts': {
        category: 'cross-layer',
        conclusion: '保留：agent 工具返回值（喂 LLM 的修复建议），改语言会改变模型输入分布',
    },
    'engine/harness/creative-frameworks.ts': {
        category: 'ai-prompt',
        conclusion: '保留：创作框架模板（平台范式/故事核/四维标签），作为提示词素材喂模型',
    },
    'engine/harness/creative-randomizer.ts': {
        category: 'ai-prompt',
        conclusion: '保留：随机创意种子词表（人设/开局），喂模型的选择池',
    },
    'engine/step-validator.ts': {
        category: 'parse-key',
        conclusion: '保留：步骤产物标题与章节序号的中文正则锚点，落盘文本解析依赖',
    },
    'shared/prose-metrics.ts': {
        category: 'parse-key',
        conclusion: '保留：章节标题与段落结构正则（含中文数字），解析锚点',
    },
    'engine/outline-contract.ts': {
        category: 'parse-key',
        conclusion: '保留：大纲字段名（伏笔安排/势力变动）是提取器与提示词之间的契约键，逐字依赖',
    },
    'engine/context/story-context-graph.ts': {
        category: 'cross-layer',
        conclusion: '保留：上下文图谱的节点/关系类型（世界观/势力），提示词与落盘共用',
    },
    'domains/long/tool-catalog.ts': {
        category: 'cross-layer',
        conclusion: '保留：i18n 跨层数据① 的结构性兜底值（中文），展示走 labelKey/descKey 求值',
    },
    'domains/short/tool-catalog.ts': {
        category: 'cross-layer',
        conclusion: '保留：i18n 跨层数据① 的结构性兜底值（中文），展示走 labelKey/descKey 求值',
    },
    'domains/script/tool-catalog.ts': {
        category: 'cross-layer',
        conclusion: '保留：i18n 跨层数据① 的结构性兜底值（中文），展示走 labelKey/descKey 求值',
    },
    'shared/changelog-data.ts': {
        category: 'cross-layer',
        conclusion: '保留：内置更新日志内容（历史发布记录），属文档数据；界面外壳已双语',
    },
    'engine/cross-volume-outline-validator.ts': {
        category: 'parse-key',
        conclusion: '保留：跨卷一致性校验的正则与关键词匹配源，解析依赖',
    },
    'engine/fingerprint-extractor.ts': {
        category: 'ui-copy-in-engine',
        conclusion: '待迁：进度快照里直接带中文 message，应改为 phase + 上层查键',
    },
    'engine/review-agent.ts': {
        category: 'ui-copy-in-engine',
        conclusion: '待迁：审稿进度/结果文本直接拼中文，应返回结构化结果由界面求值',
    },
};

function classify(file, m) {
    if (m.literals === 0) {
        return { category: 'comment-only', conclusion: '保留：本地中文只在注释/标识符，不进界面' };
    }
    // 人工结论优先于一切路径/形态猜测
    if (MANUAL[file]) return MANUAL[file];
    const lower = file.toLowerCase();
    const base = basename(lower);
    if (/prompt|instruction/.test(base) || /\/prompts?\//.test(lower)) {
        return { category: 'ai-prompt', conclusion: '保留：AI 提示词，改语言会改变模型行为与输出分布' };
    }
    if (/template|scaffold|sample/.test(base)) {
        return { category: 'on-disk-template', conclusion: '保留：落盘模板/样例正文，解析与回填逐字依赖' };
    }
    // ui/ 早于语料判定：界面文件里的长文本/大量短串仍是界面文案（如内嵌示例、验收话术）
    if (file.startsWith('ui/')) {
        return { category: 'ui-copy', conclusion: '待迁：界面文案，应走 t()' };
    }
    if (m.longest >= 200) {
        // 长文有两种：喂模型的提示词（不迁）与规则/模板正文（不迁）——按内容骨架分流
        if (m.promptLiterals >= 1) {
            return { category: 'ai-prompt', conclusion: '保留：内容形态是 AI 提示词（指令骨架 + 长文），改语言会改变模型行为' };
        }
        return { category: 'long-text', conclusion: '保留：单条超长中文（规则正文/模板大段），属数据不属界面文案' };
    }
    if (m.literals >= 200 && m.literalChars / m.literals < 12) {
        return { category: 'corpus', conclusion: '保留：词表/关键词/语料（条目多、单条短），属数据' };
    }
    // 提示词形态（文件名看不出来时的兜底）：长且有指令骨架 → 喂 LLM 的，不迁
    if (m.promptLiterals >= 1 && m.literalChars > 0 && m.promptLiterals / m.literals >= 0.05) {
        return { category: 'ai-prompt', conclusion: '保留：内容形态是 AI 提示词（指令骨架 + 长文），改语言会改变模型行为' };
    }
    // 正则源：解析用的中文匹配模式，属数据
    if (m.literals > 0 && m.regexLiterals > 0 && m.regexLiterals / m.literals >= 0.5) {
        return { category: 'parse-key', conclusion: '保留：正则/解析匹配键（落盘文本的结构锚点，改字即断解析）' };
    }
    // 枚举/字段值：大量极短无标点条目 —— 分类名、字段名、标签值，属数据
    if (m.literals >= 30 && m.enumLiterals / m.literals >= 0.6) {
        return { category: 'enum-value', conclusion: '保留：枚举/字段/标签值（短词表，落盘与匹配用），不翻译' };
    }
    // 日志串与盘上路径都不进界面：前者是开发者可见的调试信息，后者是落盘目录名
    if (m.literals > 0 && m.logLiterals / m.literals >= 0.6) {
        return { category: 'log-message', conclusion: '保留：日志/异常文本（开发者可见，非界面文案）' };
    }
    if (m.literals > 0 && m.pathLiterals / m.literals >= 0.5) {
        return { category: 'disk-path', conclusion: '保留：落盘目录/文件名（数据契约，解析逐字依赖）' };
    }
    // 引擎层里直接拼给用户看的状态/进度串：这类是界面文案漏到下层，应该迁
    if (m.literals > 0 && m.noticeLiterals / m.literals >= 0.3) {
        return { category: 'ui-copy-in-engine', conclusion: '待迁：引擎层直接抛给用户的提示/进度文案，应改为返回 key 或接受注入' };
    }
    return { category: 'cross-layer', conclusion: '待审：非界面层的中文字面量，需确认是展示文案还是稳定值' };
}

// ---------------------------------------------------------------------------
const files = AUDIT_DIRS.flatMap(dir => collectTs(join(ROOT, dir)));
const rows = [];
for (const file of files) {
    const m = measure(file);
    if (!m) continue;
    const key = rel(file);
    const { category, conclusion } = classify(key, m);
    rows.push({ file: key, ...m, category, conclusion });
}
rows.sort((a, b) => b.literalChars - a.literalChars || a.file.localeCompare(b.file));

const shown = rows.filter(r => r.literals >= MIN);
const byCategory = {};
for (const r of rows) {
    const bucket = (byCategory[r.category] ??= { files: 0, literals: 0, literalChars: 0 });
    bucket.files += 1;
    bucket.literals += r.literals;
    bucket.literalChars += r.literalChars;
}
const totals = {
    scanned: files.length,
    filesWithCjk: rows.length,
    filesWithCjkLiterals: rows.filter(r => r.literals > 0).length,
    literalStrings: rows.reduce((n, r) => n + r.literals, 0),
    literalChars: rows.reduce((n, r) => n + r.literalChars, 0),
    charsOutsideLiterals: rows.reduce((n, r) => n + r.outsideLiterals, 0),
};

if (asJson) {
    const payload = JSON.stringify({ generatedAt: new Date().toISOString(), roots: AUDIT_DIRS, totals, byCategory, files: shown }, null, 2);
    if (outArg) {
        writeFileSync(outArg.slice(6), payload + '\n', 'utf8');
        console.log(`✅ 已写入 ${outArg.slice(6)}（${shown.length} 个文件）`);
    } else {
        console.log(payload);
    }
    process.exit(0);
}

if (asMd) {
    console.log('| 文件 | 中文字面量 | 中文字符 | 类别 | 结论 |');
    console.log('| --- | --- | --- | --- | --- |');
    for (const r of shown) {
        console.log(`| \`${r.file}\` | ${r.literals} | ${r.literalChars} | ${r.category} | ${r.conclusion} |`);
    }
    process.exit(0);
}

// 默认：人读摘要
console.log('=== CJK 盘点（' + AUDIT_DIRS.join(' / ') + '） ===');
console.log(`扫描 ${totals.scanned} 个 .ts 文件；含中文 ${totals.filesWithCjk} 个，其中含中文字面量 ${totals.filesWithCjkLiterals} 个`);
console.log(`中文字符串字面量 ${totals.literalStrings} 条 / ${totals.literalChars} 字；注释与标识符 ${totals.charsOutsideLiterals} 字`);
console.log('');
console.log('按类别：');
for (const [cat, b] of Object.entries(byCategory).sort((a, b) => b[1].literalChars - a[1].literalChars)) {
    console.log(`  ${cat.padEnd(16)} ${String(b.files).padStart(4)} 文件 / ${String(b.literals).padStart(5)} 条 / ${String(b.literalChars).padStart(6)} 字`);
}
console.log('');
console.log(`Top ${Math.min(20, shown.length)}（按中文字符数）：`);
for (const r of shown.slice(0, 20)) {
    console.log(`  ${String(r.literalChars).padStart(6)} 字 / ${String(r.literals).padStart(4)} 条  ${r.category.padEnd(16)} ${r.file}`);
}
console.log('');
console.log('提示：--json 出机器可读，--md 出表格，--min=N 过滤小文件；类别判定口径见脚本头部注释与 docs/modules/i18n.md §7。');
