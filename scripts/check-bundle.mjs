#!/usr/bin/env node
/**
 * check-bundle.mjs — 主包构建产物体积预算棘轮（只降不升）
 *
 * 统计构建产物 `main.js` 与 `styles.css` 的字节数，与 `.bundle-baseline.json` 对比：
 *   - 任一文件超过基线 → exit 1（列出超量字节数）；
 *   - 低于基线 → 提示可用 --update-baseline 收紧基线；
 *   - 缺构建产物或缺基线 → 报错并给出修复命令。
 *
 * 基线格式：{ generatedAt, note, files: { "main.js": bytes, "styles.css": bytes } }。
 * 口径与 check-css.js 一致：统一按 LF 计费（Windows checkout 是 CRLF，若按工作树
 * 字节记基线，Linux/Release 会少 ~1 byte/行，棘轮在不同平台上口径不一致）。
 *
 * 用法：
 *   node scripts/check-bundle.mjs                            # 校验（preflight 在 build 之后运行）
 *   node scripts/check-bundle.mjs --update-baseline          # 用当前体积重写基线（note 保留追加）
 *   node scripts/check-bundle.mjs --update-baseline --note "原因"  # 带更新原因重写基线
 *
 * 规则：体积只允许下降；只有真正精简产物后才能收紧基线；确需上调（如新增大依赖）
 * 必须显式更新基线并在 note 里说明原因，不得为了让门禁通过而悄悄上调。
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_PATH = path.join(ROOT, '.bundle-baseline.json');
const BASELINE_NAME = path.basename(BASELINE_PATH);
const FILES = ['main.js', 'styles.css'];

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
                    `⚠️ ${file} 基线上调：${old} → ${current[file]}（+${current[file] - old}）；`
                    + '体积预算应只降不升，请确认 note 里已说明上调原因。',
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

// 基线里没有的文件按 0 计（同 check-any-budget：新增产物视为超预算）
const violations = FILES
    .filter((f) => current[f] > (baselineFiles[f] ?? 0))
    .map((f) => {
        const allowed = baselineFiles[f] ?? 0;
        return `${f}: ${current[f]} > 基线 ${allowed}（+${current[f] - allowed}，${formatMB(current[f])}）`;
    });

if (violations.length > 0) {
    console.error('\n❌ 构建产物体积超基线（只允许下降）:');
    violations.forEach((v) => console.error(`  - ${v}`));
    console.error(
        '\n请先精简产物体积；确需上调必须运行 `node scripts/check-bundle.mjs --update-baseline` '
        + '并在 note 里说明原因，不得为了过门禁悄悄上调基线。',
    );
    process.exit(1);
}

const tightened = FILES.filter((f) => current[f] < (baselineFiles[f] ?? 0));
if (tightened.length > 0) {
    console.log('\n💡 体积低于基线，可收紧（npm run check:bundle -- --update-baseline）:');
    for (const f of tightened) {
        const allowed = baselineFiles[f] ?? 0;
        console.log(`  - ${f}: ${current[f]} < 基线 ${allowed}（-${allowed - current[f]}）`);
    }
}

console.log('\n✅ 构建产物体积预算通过');
