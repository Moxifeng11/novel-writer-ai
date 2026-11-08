#!/usr/bin/env node
/**
 * gen-support-qr.mjs — 把支付宝收钱码图片生成内嵌 data URI 的 TS 模块
 *
 * 为什么内嵌：Obsidian 社区市场/BRAT 安装只下载 main.js / manifest.json / styles.css，
 * 插件目录下的独立图片文件不会被一起分发；因此收款码必须以 data URI 形式进包。
 * 原图保存在 `assets/support/alipay-qr.jpg`（优化后约 38KB），改动后重跑本脚本即可。
 *
 * 用法：
 *   node scripts/gen-support-qr.mjs
 *   node scripts/gen-support-qr.mjs --check   # 只校验生成物是否最新（不写盘）
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(ROOT, 'assets/support/alipay-qr.jpg');
const TARGET = path.join(ROOT, 'shared/support-qr.generated.ts');
const CHECK = process.argv.includes('--check');

if (!fs.existsSync(SOURCE)) {
    console.error(`❌ 缺少收款码原图：${path.relative(ROOT, SOURCE)}`);
    process.exit(1);
}

const bytes = fs.readFileSync(SOURCE);
const dataUri = `data:image/jpeg;base64,${bytes.toString('base64')}`;
const content = `/**
 * support-qr.generated.ts — 支付宝收钱码（生成物，禁止手改）
 *
 * 由 \`npm run gen:support-qr\` 从 assets/support/alipay-qr.jpg 生成。
 * 内嵌 data URI 的原因：社区市场只分发 main.js / manifest.json / styles.css，
 * 独立图片文件不会随插件一起安装。
 */

/** 支付宝收钱码图片（data URI，JPEG） */
export const ALIPAY_SUPPORT_QR_DATA_URI = '${dataUri}';
`;

if (CHECK) {
    const current = fs.existsSync(TARGET) ? fs.readFileSync(TARGET, 'utf8') : '';
    if (current !== content) {
        console.error('[support-qr] ❌ 生成物与源图不一致，请运行 npm run gen:support-qr');
        process.exit(1);
    }
    console.log('[support-qr] ✅ 生成物与源图一致');
    process.exit(0);
}

fs.writeFileSync(TARGET, content, 'utf8');
console.log(`[support-qr] 已生成 ${path.relative(ROOT, TARGET)}（${bytes.length} 字节源码图 → ${dataUri.length} 字符 data URI）`);
