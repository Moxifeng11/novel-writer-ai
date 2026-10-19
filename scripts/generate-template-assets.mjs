/**
 * generate-template-assets.mjs — 将内置模板资源嵌入为 TS 模块
 *
 * 背景：Obsidian 插件以 3 个文件分发（main.js / manifest.json / styles.css），
 * 无法随包携带 assets 目录。为保证全新安装也能初始化「元文件」模板树，
 * 构建前将 assets/template-scaffold 下的文件生成为字符串常量，随 main.js 一起打包。
 *
 * 用法：
 *   node scripts/generate-template-assets.mjs           # 生成
 *   node scripts/generate-template-assets.mjs --check   # 校验生成物是否与资源一致
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const assetDir = path.join(rootDir, 'assets', 'template-scaffold');
const outFile = path.join(rootDir, 'shared', 'template-scaffold-assets.generated.ts');

function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const result = [];
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            result.push(...walk(full));
        } else if (entry.isFile()) {
            result.push(full);
        }
    }
    return result;
}

function buildModule() {
    if (!fs.existsSync(assetDir)) {
        throw new Error(`模板资源目录不存在: ${assetDir}`);
    }

    const files = walk(assetDir)
        .map((full) => ({
            key: path.relative(assetDir, full).split(path.sep).join('/'),
            content: fs.readFileSync(full, 'utf8').replace(/\r\n/g, '\n'),
        }))
        .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

    if (files.length === 0) {
        throw new Error(`模板资源目录为空: ${assetDir}`);
    }

    const lines = [
        '/**',
        ' * 自动生成文件 —— 请勿手工编辑。',
        ' * 来源：assets/template-scaffold/',
        ' * 重新生成：npm run gen:templates',
        ' */',
        'export const TEMPLATE_SCAFFOLD_FILES: Readonly<Record<string, string>> = {',
    ];

    for (const { key, content } of files) {
        lines.push(`    ${JSON.stringify(key)}: ${JSON.stringify(content)},`);
    }
    lines.push('};', '');

    return { text: lines.join('\n'), count: files.length };
}

const { text, count } = buildModule();
const checkOnly = process.argv.includes('--check');

if (checkOnly) {
    const current = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8').replace(/\r\n/g, '\n') : '';
    if (current !== text) {
        console.error('[gen:templates] 生成物与 assets/template-scaffold 不一致，请运行 npm run gen:templates');
        process.exit(1);
    }
    console.log(`[gen:templates] 校验通过（${count} 个文件）`);
} else {
    fs.writeFileSync(outFile, text, 'utf8');
    console.log(`[gen:templates] 已生成 ${path.relative(rootDir, outFile)}（${count} 个文件）`);
}
