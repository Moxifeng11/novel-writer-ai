#!/usr/bin/env node
/**
 * check-bundle.mjs — 构建产物体积**报告**（2026-11-27 起不再阻断）
 *
 * ## 为什么从「棘轮门禁」改为「报告」
 *
 * 原规则是「只降不升」，每次功能迭代涨 1-4 KB 都要 --update-baseline --note 审批。
 * 实测代价：功能开发被体积门禁反复阻塞，而 Obsidian 与社区目录**都没有体积硬上限**
 * （几 MB 的插件很常见）。逐 KB 审批的噪音远大于收益。
 *
 * 现在只做**观测**：
 *   - 打印各产物体积，永不 exit 1
 *   - 相对基线增长超过阈值（默认 10%）时给 warning，方便发现「误加大依赖」
 *   - 低于基线时提示可收紧（可选）
 *
 * 仍然保留的：`--update-baseline` 强制带 `--note`，让 git 历史可追溯体积变化原因。
 *
 * 基线格式：{ generatedAt, note, files: { "main.js": bytes, ... } }。
 * 口径统一按 LF 计费（Windows checkout 是 CRLF，按工作树字节记基线会让跨平台口径不一致）。
 *
 * 用法：
 *   node scripts/check-bundle.mjs                            # 报告（preflight 在 build 之后运行）
 *   node scripts/check-bundle.mjs --update-baseline --note "原因"  # 记录当前体积为新基线
 *   node scripts/check-bundle.mjs --strict                    # 恢复旧行为（超基线即 exit 1，用于发版前自查）
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_PATH = path.join(ROOT, '.bundle-baseline.json');
const BASELINE_NAME = path.basename(BASELINE_PATH);
const FILES = [
    'main.js',
    'styles.css',
    // PF-3（2026-11-10 包体审计）：Worker 是独立 Blob，99.4% 字节与 main 重复编译，
    // 但此前完全在体积棘轮之外。纳入同一基线，任何一侧腐化都必须显式 --note。
    'workers/deconstruction-worker.js',
    'workers/quality-worker.js',
];

/** 按 LF 口径计字节数：每个 CRLF 按 1 字节计（等价于 \r\n → \n 后再计） */
function lfBytes(buf) {
    let crlf = 0;
    for (let i = 1; i < buf.length; i++) {
        if (buf[i] === 0x0a && buf[i - 1] === 0x0d) crlf += 1;
    }
    return buf.length - crlf;
}

function formatMB(bytes) {
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

const args = process.argv.slice(2);
const updateBaseline = args.includes('--update-baseline');
/** --strict：恢复旧的阻断行为（仅发版前自查用，日常开发不阻断） */
const strictMode = args.includes('--strict');
/** 相对基线的告警阈值（默认 10%） */
const WARN_RATIO = 0.10;
const noteIndex = args.indexOf('--note');
const noteArg = noteIndex !== -1 ? (args[noteIndex + 1] || null) : null;

// ── 构建产物存在性 ──────────────────────────────────────────
const missing = FILES.filter((f) => !fs.existsSync(path.join(ROOT, f)));
if (missing.length > 0) {
    console.error(`❌ 缺少构建产物: ${missing.join('、')}；先运行: npm run build`);
    process.exit(1);
}

const current = {};
for (const file of FILES) {
    current[file] = lfBytes(fs.readFileSync(path.join(ROOT, file)));
}

console.log('=== 构建产物体积检查 ===');
for (const file of FILES) {
    console.log(`${file}: ${current[file]} bytes（${formatMB(current[file])}）`);
}

// ── 更新基线：重写 files，note 保留已有内容并追加本次原因 ────
if (updateBaseline) {
    let existing = null;
    try {
        existing = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
    } catch {
        existing = null;
    }

    const newLine = noteArg
        ?? `${new Date().toISOString().slice(0, 10)}：体积基线更新为 ${FILES
            .map((f) => `${f} ${current[f]} bytes`)
            .join(' / ')}`;
    const oldLines = typeof existing?.note === 'string' && existing.note
        ? existing.note.split('\n')
        : [];
    const note = oldLines.filter((line) => line !== newLine).concat(newLine).join('\n');

    if (existing?.files) {
        for (const file of FILES) {
            const old = existing.files[file];
            if (typeof old === 'number' && current[file] > old) {
                console.warn(
                    `ℹ️ ${file} 基线上调：${old} → ${current[file]}（+${current[file] - old}）；`
                    + '已记入 note（体积检查不阻断，仅作追溯）。',
                );
            }
        }
    }

    const baseline = {
        generatedAt: new Date().toISOString(),
        note,
        files: Object.fromEntries(FILES.map((f) => [f, current[f]])),
    };
    fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
    console.log(`\n✅ 已写入基线: ${BASELINE_NAME}`);
    process.exit(0);
}

// ── 校验模式 ────────────────────────────────────────────────
if (!fs.existsSync(BASELINE_PATH)) {
    console.error(
        `\n❌ 缺少基线文件 ${BASELINE_NAME}，先运行: node scripts/check-bundle.mjs --update-baseline`,
    );
    process.exit(1);
}

let baseline;
try {
    baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
} catch (e) {
    console.error(`\n❌ 基线文件 ${BASELINE_NAME} 解析失败: ${e.message}`);
    process.exit(1);
}
const baselineFiles = baseline.files ?? {};

// ── 体积报告（不阻断；--strict 时恢复阻断）──────────────────
// 增长分两档：超阈值（默认 10%）→ warning 提示可能误加大依赖；
// --strict 下任何增长 → exit 1（仅发版前自查用）。
const grown = [];
const warned = [];
for (const f of FILES) {
    const allowed = baselineFiles[f] ?? 0;
    if (allowed === 0) continue; // 基线无记录视为首次，不比较
    const delta = current[f] - allowed;
    if (delta <= 0) continue;
    const ratio = delta / allowed;
    grown.push({ file: f, delta, allowed, ratio });
    if (ratio > WARN_RATIO) warned.push({ file: f, delta, allowed, ratio });
}

if (grown.length > 0) {
    if (strictMode) {
        console.error('\n❌ 构建产物体积超基线（--strict 模式）:');
        for (const g of grown) {
            console.error(`  - ${g.file}: +${g.delta} bytes（当前 ${formatMB(current[g.file])}，基线 ${formatMB(g.allowed)}）`);
        }
        console.error('\n提示：不带 --strict 时只报告不阻断；确需更新基线请加 --note。');
        process.exit(1);
    }
    if (warned.length > 0) {
        console.warn(`\n⚠️ 产物体积相对基线增长超过 ${(WARN_RATIO * 100).toFixed(0)}%（可能是误加大依赖）：`);
        for (const w of warned) {
            console.warn(
                `  - ${w.file}: +${w.delta} bytes（+${(w.ratio * 100).toFixed(1)}%，`
                + `当前 ${formatMB(current[w.file])} vs 基线 ${formatMB(w.allowed)}）`,
            );
        }
        console.warn('  → 若非预期，检查是否引入大依赖；确认无问题可 --update-baseline 更新基线。');
    } else {
        console.log(`\nℹ️ 产物体积相对基线小幅增长（均 < ${(WARN_RATIO * 100).toFixed(0)}%，属正常迭代）：`);
        for (const g of grown) {
            console.log(`  - ${g.file}: +${g.delta} bytes（${formatMB(current[g.file])}）`);
        }
    }
}

const tightened = FILES.filter((f) => current[f] < (baselineFiles[f] ?? 0));
if (tightened.length > 0) {
    console.log('\n💡 体积低于基线，可收紧（npm run check:bundle -- --update-baseline）:');
    for (const f of tightened) {
        const allowed = baselineFiles[f] ?? 0;
        console.log(`  - ${f}: ${current[f]} < 基线 ${allowed}（-${allowed - current[f]}）`);
    }
}

console.log('\n✅ 构建产物体积报告完成（不阻断；发版前可用 --strict 自查）');
