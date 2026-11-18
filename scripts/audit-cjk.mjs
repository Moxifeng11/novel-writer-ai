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

/**
 * sink 判定用的调用名清单。
 *
 * `DISK_SINKS` = 落盘即契约：写进去的值会被下次读回或解析。
 * `MODEL_SINKS` = 喂模型即行为：文本进了 prompt 或 tool schema。
 * 两者都只匹配**直接实参**，见 `sinkKindOf()` 的注释。
 */
const DISK_SINKS = /^(writeVaultText|write|writeFile|writeFileSync|appendFile|appendFileSync|create|modify|process|adapterWrite)$/;
const MODEL_SINKS = /^(buildPrompt|composePrompt|askAI|callAI|callAIStream|chat|chatCompletion|invoke|generateText|buildMessages|serializeTool)$/;

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const asMd = args.includes('--md');
const asCheck = args.includes('--check');
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
    // ── sink 命中（DSH 复核后加的机检口径，见 §「三条判据的可执行版本」）──
    let sinkLiterals = 0;
    let sinkDisk = 0;
    let sinkModel = 0;
    let sinkRegex = 0;
    let sinkCompare = 0;
    const sinkKindsFound = new Set();
    /** tool schema 里的 description/参数说明条数（决定 tools 目录该不该判 ai-prompt） */
    let toolDescLiterals = 0;
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
    /**
     * 这条字面量是否**直接**作为某个下游消费者的实参（sink 检测）。
     *
     * 为什么只做「直接」：探针实测（2026-11-19，shared/engine/services/domains）
     * 中文字面量先赋给变量、再流向 sink 的只有 2 处，190 处中文变量声明里
     * 188 处是经对象字段/返回值/模板串层层传递——**做同作用域数据流没有判别力**。
     * 与其写一个看起来严谨但漏判 99% 的流分析，不如只抓能确定的直接实参，
     * 再把「不能确定」的部分交给 closed-set 白名单强制声明（见 --check）。
     *
     * 返回 'disk' | 'model' | 'regex' | 'compare' | ''。
     */
    const sinkKindOf = node => {
        const parent = node.parent;
        if (!parent) return '';
        // ① RegExp 实参
        if (ts.isCallExpression(parent)) {
            const name = ts.isIdentifier(parent.expression) ? parent.expression.text
                : ts.isPropertyAccessExpression(parent.expression) && ts.isIdentifier(parent.expression.name) ? parent.expression.name.text
                : '';
            if (name === 'RegExp') { sinkKindsFound.add('regex'); return 'regex'; }
            if (DISK_SINKS.test(name)) { sinkKindsFound.add('disk'); return 'disk'; }
            if (MODEL_SINKS.test(name)) { sinkKindsFound.add('model'); return 'model'; }
        }
        // ② 状态比较：`x === '中文'` / `x !== '中文'`（i18n 跨层数据⑤ 就是栽在这里）
        if (ts.isBinaryExpression(parent)) {
            const op = parent.operatorToken.kind;
            if (op === ts.SyntaxKind.EqualsEqualsEqualsToken || op === ts.SyntaxKind.ExclamationEqualsEqualsToken
                || op === ts.SyntaxKind.EqualsEqualsToken || op === ts.SyntaxKind.ExclamationEqualsToken
                || op === ts.SyntaxKind.InKeyword) {
                sinkKindsFound.add('compare');
                return 'compare';
            }
        }
        // ③ switch/case 的 case 值
        if (ts.isCaseClause(parent)) { sinkKindsFound.add('compare'); return 'compare'; }
        return '';
    };
    const visit = node => {
        const hit = (text, callName, propName, sinkKind) => {
            if (!CJK.test(text)) return;
            literals += 1;
            const chars = countChars(text);
            literalChars += chars;
            if (text.length > longest) longest = text.length;
            // 提示词形态：超长且带「按以下格式」「严格」「不要」这类指令骨架
            if (text.length >= 150 && /(按以下|请严格|不要|输出格式|必须|禁止|要求|规则如下|【)/.test(text)) promptLiterals += 1;
            // 枚举值形态：极短（≤6 字）、无标点、无空格 —— 典型是分类/字段名/标签值
            if (text.length <= 6 && !/[，。！？；：、（）「」《》“”…\s]/.test(text)) enumLiterals += 1;
            // sink 命中：这条字面量直接作为某个下游消费者的实参
            if (sinkKind === 'disk') { sinkLiterals += 1; sinkDisk += 1; }
            else if (sinkKind === 'model') { sinkLiterals += 1; sinkModel += 1; }
            else if (sinkKind === 'regex') { sinkLiterals += 1; sinkRegex += 1; }
            else if (sinkKind === 'compare') { sinkLiterals += 1; sinkCompare += 1; }
            // 日志：log.info('中文') / console.warn('中文')
            if (/^(log|logger|warn|error|info|debug|trace|console)$/.test(callName)) logLiterals += 1;
            // 通知/进度：showNotice/new Notice/setStatus 等具名调用
            else if (/^(showNotice|showWarningNotice|showErrorNotice|showSuccessNotice|Notice|setStatus|setStatusText|setProgress|setProgressText|reportProgress|toast)$/.test(callName)) noticeLiterals += 1;
            // 展示字段：`{ message: '中文' }` / `{ label: '中文' }`
            else if (propName) noticeLiterals += 1;
            // tool schema 字段：tools 目录下的 description / parameters 说明
            if (propName === 'description' || propName === 'desc') toolDescLiterals += 1;
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
        const sinkKind = sinkKindOf(node);
        if (ts.isRegularExpressionLiteral(node)) {
            // 正则字面量（/中文…/ ：解析用，属数据）
            if (CJK.test(node.text)) {
                literals += 1;
                literalChars += countChars(node.text);
                regexLiterals += 1;
                sinkLiterals += 1;
                sinkRegex += 1;
                if (samples.length < 6) samples.push(node.text.length > 60 ? node.text.slice(0, 60) + '…' : node.text);
            }
        } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
            hit(node.text, callName, propName, sinkKind);
        } else if (ts.isTemplateExpression(node)) {
            hit(node.head.text, callName, propName, sinkKind);
            for (const span of node.templateSpans) hit(span.literal.text, callName, propName, sinkKind);
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return {
        literals, literalChars, totalChars, outsideLiterals: totalChars - literalChars, longest,
        logLiterals, pathLiterals, noticeLiterals, regexLiterals, promptLiterals, enumLiterals,
        sinkLiterals, sinkDisk, sinkModel, sinkRegex, sinkCompare,
        toolDescLiterals, sinks: [...sinkKindsFound], samples,
    };
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
    // 注：本表只写「保留」结论。待迁条目（ui-copy-in-engine）由
    // scripts/cjk-keep-allowlist.json 的 triage 段驱动——那里是 closed set，
    // 未声明的一律算待迁，不允许用 MANUAL 口头豁免。
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
    // agent 工具注册表：`description` 会被序列化进 LLM 的 tool schema，属提示词不属界面文案
    if (/\/tools?[-.]/.test(lower) || /-tools\.ts$/.test(lower) || /tools\.ts$/.test(lower)) {
        if (m.toolDescLiterals > 0) {
            return {
                category: 'ai-prompt',
                conclusion: `保留：agent 工具描述/参数说明（${m.toolDescLiterals} 条进 tool schema），喂模型不迁`,
            };
        }
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
    // sink 契约：字面量直接参与落盘/模型调用/状态比较 —— 三条判据的可机检版本
    if (m.literals > 0 && m.sinkLiterals / m.literals >= 0.25) {
        const kinds = [];
        if (m.sinkDisk) kinds.push('落盘');
        if (m.sinkModel) kinds.push('模型输入');
        if (m.sinkCompare) kinds.push('状态比较');
        if (m.sinkRegex) kinds.push('正则');
        return {
            category: 'sink-contract',
            conclusion: `保留：字面量直接流向${kinds.join('/')}（机检命中 ${m.sinkLiterals}/${m.literals} 条）`,
        };
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
// 保留白名单（closed set）
//
// 为什么需要它：`ui-copy-in-engine` 是「该迁但还没迁」的桶。没有 closed set 的话，
// 谁都可以在自己文件里写中文，然后在报告里口头说「这是数据」——审计无法拦截。
// 现在规则是：**只有 allowlist.keep 里声明过的文件才能被判为「保留」**，
// 其余一律算待迁，`--check` 会对未声明数量超基线的情况非零退出。
// 想豁免就得改 JSON，改了就进 diff、review 时看得见。
// ---------------------------------------------------------------------------
const ALLOWLIST_FILE = join(ROOT, 'scripts', 'cjk-keep-allowlist.json');
const allowlist = existsSync(ALLOWLIST_FILE)
    ? JSON.parse(readFileSync(ALLOWLIST_FILE, 'utf8'))
    : { keep: [], triage: [], baseline: {} };
const keepByPath = new Map((allowlist.keep ?? []).map(e => [e.path, e]));
const triageByPath = new Map((allowlist.triage ?? []).map(e => [e.path, e]));

const files = AUDIT_DIRS.flatMap(dir => collectTs(join(ROOT, dir)));
const rows = [];
for (const file of files) {
    const m = measure(file);
    if (!m) continue;
    const key = rel(file);
    const classified = classify(key, m);
    let { category, conclusion } = classified;
    const wasEngineCopy = category === 'ui-copy-in-engine';
    // 白名单接管 ui-copy-in-engine：声明过的降级为声明类别，未声明的保持 ui-copy-in-engine 并由 --check 拦
    if (wasEngineCopy) {
        const kept = keepByPath.get(key);
        const triaged = triageByPath.get(key);
        if (kept) {
            category = kept.reclassifiedAs || 'declared-keep';
            conclusion = `保留（已声明）：${kept.reason}`;
        } else if (triaged) {
            conclusion = `待迁（已登记）：${triaged.reason}`;
        } else {
            conclusion = '待迁（未声明）：不在 cjk-keep-allowlist.json，必须迁或补声明';
        }
    }
    rows.push({ file: key, ...m, category, conclusion, wasEngineCopy, declared: keepByPath.has(key) || triageByPath.has(key) });
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

// ---------------------------------------------------------------------------
// --check：门禁模式（可接 CI）
//
// 只关心「**没被机检归为数据、也没被 allowlist 声明**的中文有没有变多」。
// 这类是「既没迁走、也没说清为什么留」的灰区，每多一处，双语承诺就少一分。
//
// 注意范围是 `ui-copy-in-engine` **和** `cross-layer` 两者：
// `cross-layer` 才是最大的灰桶（225 文件 / 3.5 万字），只盯前者等于放水。
// 基线在 allowlist.baseline，只允许下降；要放宽必须改 JSON（进 diff、可 review）。
// ---------------------------------------------------------------------------
const GREY_CATEGORIES = new Set(['ui-copy-in-engine', 'cross-layer']);
const isGrey = r => GREY_CATEGORIES.has(r.category) && !r.declared;

if (asCheck) {
    const unclaimed = rows.filter(r => r.wasEngineCopy && !r.declared);
    const grey = rows.filter(isGrey);
    const declared = rows.filter(r => r.declared && keepByPath.has(r.file));
    const triaged = rows.filter(r => r.declared && triageByPath.has(r.file));
    const base = allowlist.baseline ?? {};
    const stats = {
        unclaimedFiles: unclaimed.length,
        unclaimedLiterals: unclaimed.reduce((n, r) => n + r.literals, 0),
        unclaimedChars: unclaimed.reduce((n, r) => n + r.literalChars, 0),
    };
    const greyChars = grey.reduce((n, r) => n + r.literalChars, 0);
    console.log('=== CJK 保留声明检查（closed set） ===');
    console.log(`已声明保留 ${declared.length} 个文件 / 已登记待迁 ${triaged.length} 个文件`);
    console.log(`未声明待迁：${stats.unclaimedFiles} 个文件 / ${stats.unclaimedLiterals} 条 / ${stats.unclaimedChars} 字`);
    console.log(`灰区（cross-layer + 未声明 ui-copy-in-engine）：${grey.length} 个文件 / ${greyChars} 字`);
    let failed = false;
    if (stats.unclaimedFiles > (base.unclaimedFiles ?? 0)) {
        console.error(`❌ 未声明的引擎层界面文案增加：${base.unclaimedFiles ?? 0} → ${stats.unclaimedFiles} 个文件`);
        console.error('   请二选一：① 迁走（返回 {code, params} 由界面求值）；② 在 scripts/cjk-keep-allowlist.json 的 keep 段声明并写 reason。');
        for (const r of unclaimed.slice(0, 10)) console.error(`   - ${r.file}（${r.literals} 条 / ${r.literalChars} 字）`);
        failed = true;
    }
    const baseGrey = base.greyChars ?? 0;
    if (greyChars > baseGrey) {
        console.error(`❌ 灰区中文字数增加：${baseGrey} → ${greyChars}（+${greyChars - baseGrey}）`);
        console.error('   灰区 = 没被机检判为数据、也没在 allowlist 声明保留的中文。新增中文请走 t()，或补分类规则/声明。');
        const grown = grey.filter(r => r.literalChars >= 100).slice(0, 10);
        for (const r of grown) console.error(`   - ${r.file}（${r.literals} 条 / ${r.literalChars} 字）`);
        failed = true;
    }
    // 已登记待迁的文件同样设上限：否则「已登记」就变成无限加中文的免死金牌
    const triageChars = triaged.reduce((n, r) => n + r.literalChars, 0);
    const baseTriage = base.triageChars ?? 0;
    if (triageChars > baseTriage) {
        console.error(`❌ 已登记待迁的文件中文字数增加：${baseTriage} → ${triageChars}（+${triageChars - baseTriage}）`);
        console.error('   「已登记待迁」只豁免「还没迁完」，不豁免「继续往上堆」。新写的文案请直接走 t()。');
        failed = true;
    }
    // 声明了文件却已不存在（防僵尸声明）
    for (const [p] of keepByPath) {
        if (rows.length && !rows.some(r => r.file === p)) {
            console.warn(`⚠️  声明了不存在的文件：${p}（请从 allowlist 移除）`);
        }
    }
    console.log(`已登记待迁合计 ${triageChars} 字（由 ZC-20261120-11/12 消化）`);
    if (failed) process.exit(1);
    console.log('✅ 保留声明检查通过（无新增未声明/灰区项）');
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
