const fs = require('fs');
const path = require('path');

const cssPath = path.join(__dirname, '..', 'styles.css');
const css = fs.readFileSync(cssPath, 'utf-8');
const lines = css.split('\n');

console.log('=== styles.css 最终统计 ===');
console.log(`总行数: ${lines.length}`);

// 统计注释行数
let commentLines = 0;
let emptyLines = 0;
let codeLines = 0;
let inBlockComment = false;

for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    if (line === '') {
        emptyLines++;
        continue;
    }
    
    if (inBlockComment) {
        commentLines++;
        if (line.includes('*/')) {
            inBlockComment = false;
        }
        continue;
    }
    
    if (line.startsWith('/*')) {
        commentLines++;
        if (!line.includes('*/')) {
            inBlockComment = true;
        }
        continue;
    }
    
    if (line.startsWith('//')) {
        commentLines++;
        continue;
    }
    
    codeLines++;
}

console.log(`代码行: ${codeLines}`);
console.log(`注释行: ${commentLines}`);
console.log(`空行: ${emptyLines}`);

// 统计分隔注释（区块标题）
let sectionCount = 0;
for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('====') && lines[i].includes('*/')) {
        sectionCount++;
    }
}
console.log(`区块分隔注释: ${sectionCount} 个`);

// 统计前缀分布
const nwPrefix = new Set();
const novelWriterPrefix = new Set();
const otherPrefix = new Set();
const classRegex = /\.([a-zA-Z][\w-]*)/g;

for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith('/*')) continue;
    
    let match;
    while ((match = classRegex.exec(line)) !== null) {
        const sel = match[1];
        if (sel.startsWith('nw-')) nwPrefix.add(sel);
        else if (sel.startsWith('novel-writer-')) novelWriterPrefix.add(sel);
        else otherPrefix.add(sel);
    }
}

console.log(`\n类选择器前缀分布:`);
console.log(`  nw- 前缀: ${nwPrefix.size} 个唯一类`);
console.log(`  novel-writer- 前缀: ${novelWriterPrefix.size} 个唯一类`);
console.log(`  其他前缀: ${otherPrefix.size} 个唯一类`);

console.log('\n=== 统计完成 ===');
