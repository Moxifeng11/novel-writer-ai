/**
 * check-css.js — styles.css 语法 + 体积/命名预算检查（棘轮）
 *
 * 与 stats-css.js（只输出统计）不同：本脚本在违规或指标超过基线时以 exit(1) 失败。
 * 基线在 .css-baseline.json；只能在指标下降后用 --update-baseline 收紧。
 *
 * 用法：
 *   node scripts/check-css.js
 *   node scripts/check-css.js --update-baseline
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const cssPath = path.join(root, 'styles.css');
const baselinePath = path.join(root, '.css-baseline.json');
// 统一按 LF 计费：Windows checkout 是 CRLF，若按工作树字节记基线，
// Linux/Release 会少 ~1 byte/行，棘轮在不同平台上口径不一致。
const css = fs.readFileSync(cssPath, 'utf8').replace(/\r\n/g, '\n');

function stripComments(text) {
    return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

function countMatches(text, re) {
    const matches = text.match(re);
    return matches ? matches.length : 0;
}

const stripped = stripComments(css);

// ── 括号匹配 ────────────────────────────────────────────────
let braceDepth = 0;
const issues = [];
for (const ch of stripped) {
    if (ch === '{') braceDepth += 1;
    if (ch === '}') {
        braceDepth -= 1;
        if (braceDepth < 0) {
            issues.push('多余的 }：括号深度为负');
            braceDepth = 0;
        }
    }
}
if (braceDepth !== 0) issues.push(`括号不匹配，最终深度为 ${braceDepth}`);

// ── 指标 ────────────────────────────────────────────────────
const uniqueClasses = new Set();
for (const m of stripped.matchAll(/\.([A-Za-z_][\w-]*)/g)) uniqueClasses.add(m[1]);
const otherClasses = [...uniqueClasses].filter(
    (c) => !c.startsWith('nw-') && !c.startsWith('novel-writer-'),
);

let maxSelectorDepth = 0;
for (const m of stripped.matchAll(/([^{}]+)\{/g)) {
    const selector = m[1].trim().replace(/\s+/g, ' ');
    if (!selector || selector.startsWith('@') || selector.includes('%')) continue;
    for (const part of selector.split(',')) {
        const chain = part.trim().split(/\s*[>+~]\s*|\s+/).filter(Boolean);
        if (chain.length > maxSelectorDepth) maxSelectorDepth = chain.length;
    }
}

const metrics = {
    bytes: Buffer.byteLength(css, 'utf8'),
    lines: css.split('\n').length,
    important: countMatches(stripped, /!important/g),
    hardcodedHex: countMatches(
        stripped,
        /(?::|,|\s)#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g,
    ),
    rgbHsl: countMatches(stripped, /\b(?:rgb|rgba|hsl|hsla)\(/g),
    uniqueClasses: uniqueClasses.size,
    otherClasses: otherClasses.length,
    maxSelectorDepth,
};

const updateBaseline = process.argv.includes('--update-baseline');

console.log('=== CSS 检查 ===');
console.log(`文件: styles.css`);
console.log(`体积: ${metrics.bytes} bytes / ${metrics.lines} 行`);
console.log(`!important: ${metrics.important}`);
console.log(`硬编码 hex: ${metrics.hardcodedHex}；rgb/hsl: ${metrics.rgbHsl}`);
console.log(`唯一类: ${metrics.uniqueClasses}；非 nw-/novel-writer- 前缀: ${metrics.otherClasses}`);
console.log(`最大选择器深度: ${metrics.maxSelectorDepth}`);

if (issues.length > 0) {
    console.error('\n❌ CSS 语法问题:');
    issues.forEach((issue) => console.error(`  - ${issue}`));
}

if (updateBaseline) {
    const baseline = {
        generatedAt: new Date().toISOString(),
        note: '棘轮基线：指标只能下降；新增 UI 类后显式更新并说明原因',
        bytes: metrics.bytes,
        important: metrics.important,
        hardcodedHex: metrics.hardcodedHex,
        rgbHsl: metrics.rgbHsl,
        uniqueClasses: metrics.uniqueClasses,
        otherClasses: metrics.otherClasses,
        maxSelectorDepth: metrics.maxSelectorDepth,
    };
    fs.writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
    console.log(`\n✅ 已写入基线: ${path.basename(baselinePath)}`);
    process.exit(issues.length > 0 ? 1 : 0);
}

if (!fs.existsSync(baselinePath)) {
    console.error(`\n❌ 缺少基线文件 ${path.basename(baselinePath)}，先运行: npm run css:baseline`);
    process.exit(1);
}

const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
const budgetKeys = [
    'bytes',
    'important',
    'hardcodedHex',
    'rgbHsl',
    'uniqueClasses',
    'otherClasses',
    'maxSelectorDepth',
];
const violations = budgetKeys
    .filter((key) => typeof baseline[key] === 'number' && metrics[key] > baseline[key])
    .map((key) => `${key}: ${metrics[key]} > 基线 ${baseline[key]} (+${metrics[key] - baseline[key]})`);

if (violations.length > 0) {
    console.error('\n❌ CSS 预算超基线（只允许下降）:');
    violations.forEach((v) => console.error(`  - ${v}`));
}

if (issues.length > 0 || violations.length > 0) {
    console.error('\n=== 检查失败 ===');
    process.exit(1);
}

console.log('\n✅ CSS 语法与预算检查通过');
