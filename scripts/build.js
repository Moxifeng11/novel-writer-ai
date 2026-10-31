/**
 * build.js — esbuild 包装脚本
 *
 * 从 package.json 读取版本号，通过 --define:PLUGIN_VERSION 注入为编译时常量。
 * 用法：node scripts/build.js [--watch]
 *
 * 支持多入口打包：
 * - main.ts → main.js (主插件入口)
 * - engine/deconstructors/deconstruction-worker.ts → workers/deconstruction-worker.js
 * - engine/quality/quality-worker.ts → workers/quality-worker.js
 */

const { build } = require('esbuild');
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const version = pkg.version;

const isWatch = process.argv.includes('--watch');

const workerDir = path.join(rootDir, 'workers');
if (!fs.existsSync(workerDir)) {
    fs.mkdirSync(workerDir, { recursive: true });
}

const buildOptions = {
    entryPoints: {
        'main': 'main.ts',
        'workers/deconstruction-worker': 'engine/deconstructors/deconstruction-worker.ts',
        'workers/quality-worker': 'engine/quality/quality-worker.ts',
    },
    bundle: true,
    external: ['obsidian'],
    format: 'cjs',
    platform: 'node',
    outdir: rootDir,
    define: {
        PLUGIN_VERSION: `"${version}"`,
    },
};

if (isWatch) {
    buildOptions.watch = {
        onRebuild(error) {
            if (error) {
                console.error('[esbuild] 重建失败:', error);
            } else {
                console.log(`[esbuild] 重建完成 (v${version})`);
            }
        },
    };
}

build(buildOptions)
    .then(() => {
        const cssDir = path.join(rootDir, 'css');
        const destDir = rootDir;
        if (fs.existsSync(cssDir)) {
            const cssFiles = fs.readdirSync(cssDir);
            cssFiles.forEach(file => {
                if (file.endsWith('.css')) {
                    fs.copyFileSync(
                        path.join(cssDir, file),
                        path.join(destDir, file)
                    );
                    console.log(`[esbuild] 复制 CSS: ${file}`);
                }
            });
        }
        console.log(`[esbuild] 构建完成 v${version}${isWatch ? ' (watch 模式)' : ''}`);
    })
    .catch((err) => {
        console.error('[esbuild] 构建失败:', err);
        process.exit(1);
    });
