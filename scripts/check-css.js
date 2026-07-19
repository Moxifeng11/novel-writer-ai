const fs = require('fs');
const path = require('path');

const cssPath = path.join(__dirname, '..', 'styles.css');
const css = fs.readFileSync(cssPath, 'utf-8');
const lines = css.split('\n');

// 括号匹配检查
let braceDepth = 0;
let inComment = false;
let inString = false;
let stringChar = '';
let issues = [];

for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (let j = 0; j < line.length; j++) {
        const ch = line[j];
        const nextCh = line[j + 1];
        
        // 处理字符串
        if (!inComment && (ch === '"' || ch === "'")) {
            if (inString && ch === stringChar) {
                inString = false;
            } else if (!inString) {
                inString = true;
                stringChar = ch;
            }
            continue;
        }
        if (inString) continue;
        
        // 处理注释
        if (!inComment && ch === '/' && nextCh === '*') {
            inComment = true;
            j++;
            continue;
        }
        if (inComment && ch === '*' && nextCh === '/') {
            inComment = false;
            j++;
            continue;
        }
        if (inComment) continue;
        
        // 处理括号
        if (ch === '{') braceDepth++;
        if (ch === '}') {
            braceDepth--;
            if (braceDepth < 0) {
                issues.push(`行 ${i + 1}: 多余的 '}'，括号深度为负`);
                braceDepth = 0;
            }
        }
    }
}

console.log('=== CSS 语法检查 ===');
console.log(`总行数: ${lines.length}`);
console.log(`最终括号深度: ${braceDepth}`);
if (braceDepth !== 0) {
    issues.push(`括号不匹配，最终深度为 ${braceDepth}`);
}

if (issues.length === 0) {
    console.log('✅ CSS 括号匹配正常');
} else {
    console.log('❌ 发现问题:');
    issues.forEach(issue => console.log(`  - ${issue}`));
}

// 检查文件末尾
console.log(`\n文件最后 5 行:`);
lines.slice(-5).forEach((line, i) => {
    console.log(`  ${lines.length - 4 + i}: ${line.substring(0, 80)}`);
});

console.log('\n=== 检查完成 ===');
