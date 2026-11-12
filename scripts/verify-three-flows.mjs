#!/usr/bin/env node
/**
 * verify-three-flows.mjs — 三条创作链路的「运行层」真实状态验证（DSH-20261112-08）
 *
 * 与 UI 上的能力横幅不同，这里读的是**磁盘上的真实数据**：知识库索引、向量库
 * 索引文件、三层指纹库与强度配置、项目同人设定与考据缓存、以及（可选）本机
 * 嵌入模型服务的探测结果。目的是回答「用户以为生效的链路，实际通到哪一环」。
 *
 * 判定口径镜像 `shared/link-status-compute.ts`（computeKnowledgeFlowStatus /
 * computeStyleFlowStatus / computeConstraintFlowStatus 与 summarizeLink）——
 * 该文件是 TypeScript，`.mjs` 无法直接 import，故按行镜像；**语义变更必须两边同步**
 * （各函数上方标注 `@mirror` 行号锚点）。
 *
 * 用法：
 *   node scripts/verify-three-flows.mjs                  # 人类可读输出
 *   node scripts/verify-three-flows.mjs --json           # 机器可读（供报告引用）
 *   node scripts/verify-three-flows.mjs --vault <path>   # 指定 vault（默认按脚本位置推导）
 *   node scripts/verify-three-flows.mjs --project <id>   # 指定项目（默认取最新 .project）
 *   node scripts/verify-three-flows.mjs --probe-embedding # 探测本机嵌入服务（只读 HTTP）
 *
 * 退出码（任务约定）：
 *   0 = 三条链路全部验证通过
 *   1 = 存在断点或降级（非全通）
 *   2 = 无断点，但至少一条链路**无法判定**（缺数据 / 缺模型 / 索引不一致）
 *
 * 安全：不打印、不落盘任何凭据；设置里只读取「是否已配置」的布尔结论。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    summarizeLink,
    computeKnowledgeFlowStatus,
    computeStyleFlowStatus,
    computeConstraintFlowStatus,
    mirrorSanitizeName,
} from './lib/verify-flows-lib.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const PLUGIN_ID = 'novel-writer-ai';
const KB_INDEX = '写作知识库/知识库索引.md';
const PJ_CONTROL_DIR = '元文件/04-项目总控';
const FANFIC_TEMPLATE_DIR = '元文件/05-同人设定库';

// ---------------------------------------------------------------------------
// 参数与环境
// ---------------------------------------------------------------------------

function parseArgs(argv) {
    const args = { json: false, probeEmbedding: true, vault: '', project: '' };
    for (let i = 0; i < argv.length; i++) {
        const key = argv[i];
        if (key === '--json') args.json = true;
        else if (key === '--probe-embedding') args.probeEmbedding = true;
        else if (key === '--no-probe') args.probeEmbedding = false;
        else if (key === '--vault') args.vault = argv[++i] ?? '';
        else if (key === '--project') args.project = argv[++i] ?? '';
    }
    return args;
}

/** 默认 vault 根：<vault>/.obsidian/plugins/<id> → 上三级 */
function resolveVaultRoot(arg) {
    if (arg) return path.resolve(arg);
    return path.resolve(REPO_ROOT, '..', '..', '..');
}

const readJson = (p) => {
    try {
        return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {
        return null;
    }
};

const readText = (p) => {
    try {
        return fs.readFileSync(p, 'utf8');
    } catch {
        return null;
    }
};

const exists = (p) => fs.existsSync(p);

const posix = (p) => p.split(path.sep).join('/');

// ---------------------------------------------------------------------------
// 真实数据采集（全部只读；任何一项失败按「未知/为空」计入，绝不抛错）
// ---------------------------------------------------------------------------

/** 读插件设置（只取非敏感字段；凭据只输出布尔「是否已配置」） */
function readSettings(vaultRoot) {
    const p = path.join(vaultRoot, '.obsidian', 'plugins', PLUGIN_ID, 'data.json');
    const raw = readJson(p);
    if (!raw) return null;
    return {
        vectorProviderType: raw.vectorProviderType || 'ollama',
        vectorMode: raw.vectorMode || '',
        vectorOllamaBaseUrl: raw.vectorOllamaBaseUrl || '',
        vectorOllamaModel: raw.vectorOllamaModel || '',
        embeddingModel: raw.embeddingModel || '',
        defaultModel: raw.defaultModel || '',
        apiConfigured: typeof raw.apiKey === 'string' && raw.apiKey.length > 0,
        embeddingKeyConfigured: Boolean(
            raw.vectorOpenaiApiKey || raw.vectorDoubaoApiKey || raw.vectorQwenApiKey,
        ),
    };
}

/** 解析 md 的 frontmatter JSON 块（知识库索引就是 `---\n{json}\n---`） */
function parseFrontmatterJson(content) {
    if (!content) return null;
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) return null;
    try {
        return JSON.parse(match[1]);
    } catch {
        return null;
    }
}

function readKnowledgeBase(vaultRoot) {
    const content = readText(path.join(vaultRoot, KB_INDEX));
    const fm = parseFrontmatterJson(content);
    const books = Array.isArray(fm?.books) ? fm.books : [];
    return {
        indexPath: KB_INDEX,
        indexExists: content !== null,
        indexReadable: Boolean(fm),
        books,
    };
}

function readVectorIndex(vaultRoot) {
    const p = path.join(vaultRoot, '.obsidian', 'plugins', PLUGIN_ID, 'data', 'knowledge-vectors', 'index.json');
    const raw = readJson(p);
    const books = Array.isArray(raw?.books) ? raw.books : [];
    return { indexPath: posix(path.relative(vaultRoot, p)), exists: raw !== null, books };
}

/** 读一层指纹文件（数组或 `{ fingerprints: [] }` 两种历史形态） */
function readFingerprintFile(vaultRoot, relPath) {
    const raw = readJson(path.join(vaultRoot, relPath));
    if (!raw) return { relPath, exists: exists(path.join(vaultRoot, relPath)), items: [] };
    const items = Array.isArray(raw) ? raw : Array.isArray(raw.fingerprints) ? raw.fingerprints : [];
    return { relPath, exists: true, items };
}

/** 枚举 vault 内带 .project 的项目目录（深度 ≤ 6，跳过依赖/备份目录） */
function listProjects(vaultRoot) {
    const skip = new Set(['node_modules', '.git', '.trash', '.rollback-backup', '.zcode', '.trae', 'apps', 'deepseek-harness', '.obsidian']);
    const hits = [];
    const walk = (dir, depth) => {
        if (depth > 6) return;
        let entries = [];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            if (!entry.isDirectory() || skip.has(entry.name)) continue;
            const abs = path.join(dir, entry.name);
            const meta = path.join(abs, '.project');
            if (exists(meta)) {
                hits.push({
                    id: posix(path.relative(vaultRoot, abs)),
                    abs,
                    mtime: fs.statSync(meta).mtimeMs,
                });
            }
            walk(abs, depth + 1);
        }
    };
    walk(vaultRoot, 0);
    return hits.sort((a, b) => b.mtime - a.mtime);
}

/** 从 .project 解析同人绑定（镜像 shared/fanfic-rules.ts#parseProjectMeta） */
function parseProjectMeta(content) {
    const typeMatch = (content || '').match(/^##\s*类型\s*\r?\n\s*(\S+)/m);
    const pathMatch = (content || '').match(/^##\s*同人设定路径\s*\r?\n\s*(\S.*)/m);
    const fanficPath = pathMatch ? pathMatch[1].trim() : '';
    const isFanfic = typeMatch ? typeMatch[1].trim() === 'fanfic' : Boolean(fanficPath);
    return { isFanfic, fanficPath };
}

/** 读同人设定的审核状态与作品名（镜像 shared/fanfic-rules.ts 的关键字段） */
function readFanficSetting(vaultRoot, relPath) {
    const content = readText(path.join(vaultRoot, relPath));
    if (content === null) return { exists: false, reviewStatus: 'none', workName: '', hasContent: false };
    const review = (content.match(/^审核状态:\s*(.+)$/m)?.[1] || '').trim();
    const mapped = ['approved', 'pending', 'rejected', 'legacy'].includes(review) ? review : 'legacy';
    const workName = (content.match(/^作品名称:\s*(.+)$/m)?.[1] || '').trim()
        || (content.match(/^#\s*(.+?)\s*同人设定\s*$/m)?.[1] || '').trim();
    const hasContent = /^-\s*\*\*(?:核心规则|必须遵守的原作规则|禁止触及的红线)\*\*/m.test(content);
    return { exists: true, reviewStatus: mapped, workName, hasContent };
}

/** 探测本机嵌入服务（仅 ollama / 只读 GET；失败区分「确实没跑」与「无法判定」） */
async function probeEmbedding(settings) {
    if (!settings) return { attempted: false, ok: false, detail: '无法读取插件设置' };
    if (settings.vectorProviderType !== 'ollama') {
        return {
            attempted: false,
            ok: false,
            detail: `提供方 ${settings.vectorProviderType} 需真实调用才能验证（本脚本不发起计费请求）`,
        };
    }
    const base = (settings.vectorOllamaBaseUrl || 'http://localhost:11434').replace(/\/+$/, '');
    const model = settings.vectorOllamaModel || settings.embeddingModel || 'bge-m3';
    try {
        const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(2500) });
        if (!res.ok) return { attempted: true, ok: false, detail: `Ollama 返回 HTTP ${res.status}` };
        const data = await res.json();
        const names = (data.models || []).map(m => String(m.name || ''));
        const hit = names.some(name => name === model || name.startsWith(`${model}:`));
        return {
            attempted: true,
            ok: hit,
            detail: hit
                ? `Ollama 可用，已安装 ${model}`
                : `Ollama 可用，但未安装模型 ${model}（已装：${names.slice(0, 5).join(', ') || '无'}）`,
        };
    } catch (e) {
        const code = e && e.cause && e.cause.code;
        if (code === 'ECONNREFUSED') {
            return { attempted: true, ok: false, detail: `Ollama 未运行（${base} 拒绝连接）` };
        }
        return { attempted: false, ok: false, detail: `探测失败，无法判定（${code || e?.name || 'unknown'}）` };
    }
}

// ---------------------------------------------------------------------------
// 结论分类：pass / degraded / broken / unverifiable
// ---------------------------------------------------------------------------

/**
 * 把链路状态与「是否有真实数据」「模型是否已验证」合成为结论。
 *
 * 关键约束（任务要求）：**未验证不得写成通过**。因此只要结论依赖某个没有真实验证
 * 的环节（数据缺失、模型未探测、索引不一致），一律降为 unverifiable。
 */
function classify(status, options) {
    // 没有可验证对象（知识库为空 / 没有项目）时，环节里的 broken 只是空数据的投影，
    // 不能当成「已确认断点」——否则报告会把「没数据」说成「链路断了」。
    if (!options.hasData) return 'unverifiable';
    if (status.overall === 'broken') return 'broken';
    if (status.overall === 'warn') return 'degraded';
    if (options.modelUnverified) return 'unverifiable';
    if (options.consistencyIssue) return 'unverifiable';
    return status.overall === 'ok' ? 'pass' : 'unverifiable';
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const vaultRoot = resolveVaultRoot(args.vault);
    const now = new Date().toISOString();

    const settings = readSettings(vaultRoot);
    const kb = readKnowledgeBase(vaultRoot);
    const vectors = readVectorIndex(vaultRoot);

    // 项目：显式指定优先，否则取最新 .project（与界面「当前项目」不同——脚本没有活动文件）
    const projects = listProjects(vaultRoot);
    const project = args.project
        ? projects.find(p => p.id === args.project) ?? { id: args.project, abs: path.join(vaultRoot, args.project), mtime: 0 }
        : projects[0] ?? null;

    // ---- 知识流 ----
    const breakdownCompleted = kb.books.filter(b => b.breakdownStatus === 'completed').length;
    const vectorDone = kb.books.filter(b => b.vectorStatus === 'done').length;
    const vectorFailed = kb.books.filter(b => b.vectorStatus === 'failed').length;
    const storeLoadedBooks = vectors.books.length;
    const indexIds = new Set(kb.books.map(b => b.id));
    const orphanVectorIds = vectors.books.map(b => b.bookId).filter(id => !indexIds.has(id));

    const embedding = args.probeEmbedding
        ? await probeEmbedding(settings)
        : { attempted: false, ok: false, detail: '未探测（--no-probe 显式跳过；默认会探测本机 Ollama）' };

    // 嵌入模型这一环只有「探测成功」才算 ok；未探测按 unknown 计入，绝不默认可用
    const knowledgeInput = {
        bookTotal: kb.books.length,
        breakdownCompleted,
        vectorDone,
        vectorFailed,
        embeddingReady: embedding.ok === true,
        embeddingDetail: embedding.detail,
        storeLoadedBooks,
        storeReady: true,
        orphanCount: orphanVectorIds.length,
    };
    const knowledgeStatus = computeKnowledgeFlowStatus(knowledgeInput);
    if (!embedding.ok) {
        const stage = knowledgeStatus.stages.find(s => s.name === '嵌入模型');
        if (stage) stage.status = 'unknown';
        // 重算整体（unknown 不拉低整体，仅在全部 unknown 时生效）
        Object.assign(knowledgeStatus, summarizeLink('知识流', knowledgeStatus.stages));
    }
    const knowledgeConsistency = orphanVectorIds.length > 0
        ? `向量库有 ${orphanVectorIds.length} 本不在知识库索引里（${orphanVectorIds.slice(0, 3).join(', ')}）`
        : '';
    const knowledgeVerdict = classify(knowledgeStatus, {
        hasData: kb.books.length > 0,
        modelUnverified: !embedding.ok && vectorDone > 0,
        consistencyIssue: Boolean(knowledgeConsistency),
    });

    // ---- 风格流 ----
    // @paths 勘误（DSH-20261112-12）：模板/项目层指纹目录是 PROJECT_FINGERPRINT_LIBRARY_DIR
    // = '写作指纹库'，只有全局层用 FINGERPRINT_LIBRARY_DIR='fingerprint-library'。
    const template = readFingerprintFile(vaultRoot, `${PJ_CONTROL_DIR}/写作指纹库/template-fingerprints.json`);
    const global = readFingerprintFile(vaultRoot, `.obsidian/plugins/${PLUGIN_ID}/data/fingerprint-library/global-fingerprints.json`);
    const projectFpRel = project
        ? `${project.id}/${PJ_CONTROL_DIR}/写作指纹库/project-fingerprints.json`
        : '';
    const projectFp = projectFpRel
        ? readFingerprintFile(vaultRoot, projectFpRel)
        : { relPath: '', exists: false, items: [] };
    const intensityRel = project
        ? `${project.id}/${PJ_CONTROL_DIR}/写作指纹库/fingerprint-intensity-config.json`
        : '';
    const intensity = intensityRel ? readJson(path.join(vaultRoot, intensityRel)) : null;

    const injectableItems = [...global.items, ...projectFp.items];
    const enabledItems = injectableItems.filter(fp => fp && fp.enabled !== false);
    const intensityDisabled = enabledItems.filter(fp => {
        const raw = intensity && typeof intensity === 'object' ? intensity[fp.id] : undefined;
        const value = typeof raw === 'object' && raw ? raw.intensity : raw;
        const num = Number(value);
        return Number.isFinite(num) && num <= 0;
    }).length;

    const styleStatus = computeStyleFlowStatus({
        templateCount: template.items.length,
        globalCount: global.items.length,
        projectCount: projectFp.items.length,
        enabledCount: enabledItems.length,
        intensityDisabledCount: intensityDisabled,
        embeddingReady: embedding.ok === true,
    });
    const styleVerdict = classify(styleStatus, {
        hasData: injectableItems.length > 0,
        modelUnverified: false, // 嵌入只影响向量筛选，特征注入可独立验证
        consistencyIssue: false,
    });

    // ---- 约束流 ----
    let constraintInput = {
        sourceCount: 0,
        settingExists: false,
        reviewStatus: 'none',
        bound: false,
        rulesHasContent: false,
    };
    let constraintProjectDetail = '没有可用项目（vault 内找不到 .project）';
    let constraintHasSubject = false;
    if (project) {
        const metaContent = readText(path.join(project.abs, '.project'));
        const meta = parseProjectMeta(metaContent);
        if (!meta.isFanfic) {
            constraintHasSubject = false;
            constraintProjectDetail = `项目 ${project.id} 不是同人项目（.project 无「类型: fanfic」/「同人设定路径」）`;
        } else if (!meta.fanficPath) {
            constraintProjectDetail = `项目 ${project.id} 标记为同人，但 .project 没写「同人设定路径」`;
        } else {
            constraintHasSubject = true;
            const rule = readFanficSetting(vaultRoot, meta.fanficPath);
            // 作品名缺失时用设定文件名兜底（_资料/<作品名>/ 与设定文件同名是生成器的既有约定）
            const workName = rule.workName || path.basename(meta.fanficPath).replace(/.md$/i, '');
            // 技术债闭合（DSH-20261112-17）：真实实现 pjFanficResearchDir 对 workName 过
            // sanitizeName（shared/paths.ts:194）——镜像同一净化链，作品名含 `/` 等
            // 字符时不再与真实路径分叉。
            const safeWorkName = mirrorSanitizeName(workName);
            const cachePath = path.join(vaultRoot, `${project.id}/05-同人设定库/_资料/${safeWorkName}/sources.json`);
            const cached = workName ? readJson(cachePath) : null;
            constraintInput = {
                sourceCount: Array.isArray(cached?.sources) ? cached.sources.length : 0,
                settingExists: rule.exists,
                reviewStatus: rule.exists ? rule.reviewStatus : 'none',
                bound: rule.exists,
                rulesHasContent: rule.hasContent,
            };
            constraintProjectDetail = `项目 ${project.id} → ${meta.fanficPath}`;
        }
    }
    const constraintStatus = computeConstraintFlowStatus(constraintInput);
    const constraintVerdict = classify(constraintStatus, {
        hasData: constraintHasSubject,
        modelUnverified: false,
        consistencyIssue: false,
    });

    const flows = [
        { key: 'knowledge', verdict: knowledgeVerdict, status: knowledgeStatus },
        { key: 'style', verdict: styleVerdict, status: styleStatus },
        { key: 'constraint', verdict: constraintVerdict, status: constraintStatus },
    ];

    const hasBroken = flows.some(f => f.verdict === 'broken' || f.verdict === 'degraded');
    const hasUnverifiable = flows.some(f => f.verdict === 'unverifiable');
    const exitCode = hasBroken ? 1 : hasUnverifiable ? 2 : 0;

    const report = {
        generatedAt: now,
        vaultRoot: posix(vaultRoot),
        script: 'scripts/verify-three-flows.mjs',
        project: project ? project.id : null,
        projectSelection: args.project ? 'explicit' : project ? 'newest-.project' : 'none',
        projectDetail: constraintProjectDetail,
        settings: settings
            ? {
                vectorProviderType: settings.vectorProviderType,
                vectorMode: settings.vectorMode,
                embeddingModel: settings.embeddingModel,
                defaultModel: settings.defaultModel,
                apiConfigured: settings.apiConfigured,
                embeddingKeyConfigured: settings.embeddingKeyConfigured,
            }
            : null,
        embeddingProbe: embedding,
        knowledge: {
            indexReadable: kb.indexReadable,
            bookTotal: kb.books.length,
            breakdownCompleted,
            vectorDone,
            vectorFailed,
            vectorIndexExists: vectors.exists,
            storeLoadedBooks,
            orphanVectorIds,
            consistencyIssue: knowledgeConsistency,
        },
        style: {
            files: [template.relPath, global.relPath, projectFp.relPath].filter(Boolean),
            templateCount: template.items.length,
            globalCount: global.items.length,
            projectCount: projectFp.items.length,
            enabledCount: enabledItems.length,
            intensityDisabledCount: intensityDisabled,
        },
        constraint: constraintInput,
        flows,
        exitCode,
    };

    if (args.json) {
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
        process.stdout.write(renderHuman(report));
    }
    process.exitCode = exitCode;
}

const ICON = { ok: '✅', broken: '❌', warn: '⚠️', unknown: '❔' };
const VERDICT_LABEL = {
    pass: '已验证通过',
    degraded: '已验证但降级',
    broken: '存在断点',
    unverifiable: '无法验证（缺数据/缺模型）',
};

function renderHuman(report) {
    const lines = [];
    lines.push(`三条链路运行层验证 · ${new Date(report.generatedAt).toLocaleString('zh-CN', { hour12: false })}（UTC: ${report.generatedAt}）`);
    lines.push(`vault: ${report.vaultRoot}`);
    lines.push(`项目: ${report.project ? report.project : '（无）'}（选择方式: ${report.projectSelection}）`);
    lines.push(`说明: ${report.projectDetail}`);
    if (report.settings) {
        lines.push(`设置: 向量提供方=${report.settings.vectorProviderType} 模型=${report.settings.embeddingModel || '-'} `
            + `主 API=${report.settings.apiConfigured ? '已配置' : '未配置'} 向量 Key=${report.settings.embeddingKeyConfigured ? '已配置' : '未配置'}`);
    }
    lines.push(`嵌入探测: ${report.embeddingProbe.detail}`);
    lines.push('');
    for (const flow of report.flows) {
        lines.push(`【${flow.status.title}】${VERDICT_LABEL[flow.verdict]}`);
        for (const stage of flow.status.stages) {
            lines.push(`  ${ICON[stage.status]} ${stage.name}：${stage.detail}`);
        }
        if (flow.verdict === 'unverifiable') {
            lines.push('  结论：环节状态由空输入推导，不能当作「已验证」或「已确认断点」');
        } else if (flow.status.breakpoint) {
            lines.push(`  结论：断在「${flow.status.breakpoint}」`);
        }
        lines.push('');
    }
    if (report.knowledge.consistencyIssue) {
        lines.push(`⚠️ 一致性问题：${report.knowledge.consistencyIssue}`);
    }
    lines.push('');
    lines.push(`退出码: ${report.exitCode}（0=三条全通 / 1=有断点或降级 / 2=无法判定）`);
    return `${lines.join('\n')}\n`;
}

main().catch((e) => {
    process.stderr.write(`脚本异常：${e && e.stack ? e.stack : String(e)}\n`);
    process.exitCode = 2;
});
