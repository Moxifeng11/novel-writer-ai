/**
 * build-styles.mjs — 把 `styles-src/*.css` 按文件名顺序拼接为根目录 `styles.css`
 *
 * 背景：styles.css 是 Obsidian 只认的单一样式入口，无法拆成多文件直接加载。
 * 因此源码按「历史层 + 功能域」拆分到 styles-src/，本脚本负责拼回单一产物。
 *
 * 用法：
 *   node scripts/build-styles.mjs            # 生成 / 覆盖 styles.css
 *   node scripts/build-styles.mjs --check    # 只校验产物与源是否一致（不一致 exit 1）
 *
 * 约束：拼接是**纯文本顺序拼接**，不做压缩、不做选择器合并，
 * 以保证 CSS 层叠顺序与拆分前完全一致（后置覆盖层依然生效）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, 'styles-src');
const outPath = path.join(root, 'styles.css');
const isCheck = process.argv.includes('--check');

function listSources() {
    if (!fs.existsSync(srcDir)) {
        console.error(`❌ 缺少源目录 ${srcDir}`);
        process.exit(1);
    }
    const files = fs
        .readdirSync(srcDir)
        .filter((f) => f.endsWith('.css'))
        .sort((a, b) => a.localeCompare(b, 'en'));
    if (files.length === 0) {
        console.error('❌ styles-src/ 下没有 .css 文件');
        process.exit(1);
    }
    return files;
}

function renderHeader(files) {
    const list = files.map((f) => ` *   - styles-src/${f}`).join('\n');
    return `/* ==========================================================================
 * styles.css — 自动生成，请勿直接编辑本文件
 * ==========================================================================
 * 由 scripts/build-styles.mjs 按文件名顺序拼接以下源文件而成：
${list}
 *
 * 修改样式请编辑 styles-src/ 下对应源文件，然后运行 npm run build:styles
 * （npm run build 与 preflight 均已包含该步骤 / 一致性校验）。
 * 顺序即层叠顺序：后置文件的同名规则覆盖前置文件，与拆分前保持一致。
 * ==========================================================================
 */
`;
}

function buildText() {
    const files = listSources();
    const parts = files.map((f) => fs.readFileSync(path.join(srcDir, f), 'utf8'));
    return { files, text: renderHeader(files) + parts.join('') };
}

function lineCount(text) {
    return text.split('\n').length - 1;
}

const { files, text } = buildText();

if (isCheck) {
    if (!fs.existsSync(outPath)) {
        console.error('❌ styles.css 不存在，先运行: npm run build:styles');
        process.exit(1);
    }
    const current = fs.readFileSync(outPath, 'utf8');
    if (current !== text) {
        const curLines = lineCount(current);
        const expLines = lineCount(text);
        console.error(
            `❌ styles.css 与 styles-src/ 拼接结果不一致（产物 ${curLines} 行 / 期望 ${expLines} 行）。\n` +
                '   请运行 npm run build:styles 重新生成，或确认是否有人直接编辑了 styles.css。'
        );
        process.exit(1);
    }
    console.log(`✅ styles.css 与 ${files.length} 个源文件一致（${lineCount(text)} 行）`);
} else {
    fs.writeFileSync(outPath, text, 'utf8');
    console.log(`[styles] 拼接 ${files.length} 个源文件 → styles.css（${lineCount(text)} 行）`);
}
