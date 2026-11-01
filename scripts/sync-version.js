/**
 * sync-version.js — 从 package.json 读取版本号并同步到 manifest.json / versions.json
 *
 * 用法：node scripts/sync-version.js
 *
 * 作为唯一真相源的同步工具，确保 manifest.json 的 version 与 package.json 一致，
 * 并保证 versions.json 里有当前版本 → minAppVersion 的映射
 *（Obsidian 社区市场/BRAT 靠它判断升级是否可用）。
 */

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const pkgPath = path.join(rootDir, 'package.json');
const manifestPath = path.join(rootDir, 'manifest.json');
const versionsPath = path.join(rootDir, 'versions.json');

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

    // 3. 同步 manifest 版本号
    if (manifest.version === version) {
        console.log(`[sync-version] manifest.json 版本号已一致：${version}`);
    } else {
        manifest.version = version;
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 4) + '\n', 'utf8');
        console.log(`[sync-version] manifest.json 版本号已更新：${oldVersion} → ${version}`);
    }

    // 4. 同步 versions.json（version → minAppVersion）
    const minAppVersion = manifest.minAppVersion;
    if (!minAppVersion) {
        console.warn('[sync-version] 警告：manifest.json 缺少 minAppVersion，跳过 versions.json 同步');
        return;
    }
    let versions = {};
    try {
        versions = JSON.parse(fs.readFileSync(versionsPath, 'utf8'));
    } catch {
        versions = {};
    }
    const expected = versions[version];
    if (expected === minAppVersion) {
        console.log(`[sync-version] versions.json 已包含 ${version} → ${minAppVersion}`);
        return;
    }
    versions[version] = minAppVersion;
    fs.writeFileSync(versionsPath, JSON.stringify(versions, null, 4) + '\n', 'utf8');
    console.log(`[sync-version] versions.json 已更新：${version} → ${minAppVersion}`);
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
