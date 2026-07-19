/**
 * sync-version.js — 从 package.json 读取版本号并同步到 manifest.json
 *
 * 用法：node scripts/sync-version.js
 *
 * 作为唯一真相源的同步工具，确保 manifest.json 的 version 与 package.json 一致。
 */

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const pkgPath = path.join(rootDir, 'package.json');
const manifestPath = path.join(rootDir, 'manifest.json');

function syncVersion() {
    // 1. 读取 package.json 版本号
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const version = pkg.version;
    if (!version) {
        console.error('[sync-version] 错误：package.json 中未找到 version 字段');
        process.exit(1);
    }

    // 2. 读取 manifest.json
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const oldVersion = manifest.version;

    // 3. 同步版本号
    if (manifest.version === version) {
        console.log(`[sync-version] 版本号已一致：${version}，无需更新`);
        return;
    }

    manifest.version = version;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 4) + '\n', 'utf8');
    console.log(`[sync-version] manifest.json 版本号已更新：${oldVersion} → ${version}`);
}

// 输出当前版本供 esbuild define 使用
function printVersion() {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    console.log(pkg.version);
}

const command = process.argv[2];
if (command === '--print') {
    printVersion();
} else {
    syncVersion();
}
