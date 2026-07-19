const fs = require('fs');
const path = require('path');

const cssPath = path.join(__dirname, '..', 'styles.css');
let css = fs.readFileSync(cssPath, 'utf-8');
const lines = css.split('\n');

// ============================================================
// 审计统计
// ============================================================
console.log('=== CSS 审计报告 ===');
console.log(`总行数: ${lines.length}`);

// 统计选择器
const selectorRegex = /^\s*\.([a-zA-Z][\w-]*)\s*[,\{]/g;
const selectors = new Set();
let ruleCount = 0;
let braceDepth = 0;
let inComment = false;

for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    
    // 处理注释
    let commentStart = line.indexOf('/*');
    let commentEnd = line.indexOf('*/');
    
    // 简单的规则计数
    for (let j = 0; j < line.length; j++) {
        if (line[j] === '{') braceDepth++;
        if (line[j] === '}') {
            braceDepth--;
            if (braceDepth === 0) ruleCount++;
        }
    }
    
    // 提取类选择器
    const classRegex = /\.([a-zA-Z][\w-]*/g;
    let match;
    while ((match = classRegex.exec(line)) !== null) {
        if (!line.trim().startsWith('/*')) {
            selectors.add(match[1]);
        }
    }
}

console.log(`规则块数量: ${ruleCount}`);
console.log(`唯一类选择器: ${selectors.size}`);

// ============================================================
// 查找重复的选择器定义
// ============================================================
const selectorOccurrences = {};
let currentSelector = '';
let inRuleBlock = false;

for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.endsWith('{') && !line.includes('}')) {
        const sel = line.slice(0, -1).trim();
        if (!selectorOccurrences[sel]) {
            selectorOccurrences[sel] = [];
        }
        selectorOccurrences[sel].push(i + 1);
    }
}

const duplicatedSelectors = Object.entries(selectorOccurrences)
    .filter(([_, lines]) => lines.length > 1)
    .sort((a, b) => b[1].length - a[1].length);

console.log(`\n重复定义的选择器数: ${duplicatedSelectors.length}`);
console.log('前15个重复最多的选择器:');
duplicatedSelectors.slice(0, 15).forEach(([sel, lines]) => {
    console.log(`  ${sel}: ${lines.length}次 (行: ${lines.slice(0, 5).join(', ')}${lines.length > 5 ? '...' : ''}`);
});

// ============================================================
// 检测空规则
// ============================================================
const emptyRules = [];
braceDepth = 0;
let ruleStartLine = -1;
let ruleHasContent = false;
let currentRuleSelector = '';

for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (let j = 0; j < line.length; j++) {
        if (line[j] === '{') {
            if (braceDepth === 0) {
                ruleStartLine = i + 1;
                ruleHasContent = false;
                // 提取选择器（简化版）
                const prevContent = lines.slice(Math.max(0, i - 3), i + 1).join(' ');
                const selMatch = prevContent.match(/([^{}]+)\s*\{\s*$/);
                currentRuleSelector = selMatch ? selMatch[1].trim() : 'unknown';
            }
            braceDepth++;
        } else if (line[j] === '}') {
            braceDepth--;
            if (braceDepth === 0 && !ruleHasContent) {
                emptyRules.push({ line: ruleStartLine, selector: currentRuleSelector });
            }
        } else if (braceDepth > 0) {
            const ch = line[j];
            if (ch !== ' ' && ch !== '\t' && ch !== '\n' && ch !== '\r') {
                ruleHasContent = true;
            }
        }
    }
}

console.log(`\n空规则数量: ${emptyRules.length}`);
emptyRules.forEach(r => {
    console.log(`  行 ${r.line}: ${r.selector}`);
});

// ============================================================
// 前缀统计
// ============================================================
const prefixStats = { 'nw-': 0, 'novel-writer-': 0, '其他': 0 };
selectors.forEach(sel => {
    if (sel.startsWith('nw-')) prefixStats['nw-']++;
    else if (sel.startsWith('novel-writer-')) prefixStats['novel-writer-']++;
    else prefixStats['其他']++;
});

console.log(`\n类名前缀分布:`);
console.log(`  nw- 前缀: ${prefixStats['nw-']} 个`);
console.log(`  novel-writer- 前缀: ${prefixStats['novel-writer-']} 个`);
console.log(`  其他前缀: ${prefixStats['其他']} 个`);

console.log('\n=== 审计完成 ===');
