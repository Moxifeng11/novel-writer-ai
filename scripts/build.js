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
 *
 * 产物开启 minify（体积约 -36%）。由此带来的约束：
 * - 模块路径注释与顶层变量名会被压缩掉，任何「对 main.js 做字符串断言」的脚本
 *   必须改断言字符串字面量（如模板 key），见 scripts/check-release.mjs。
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
    // 统一路径别名：跨目录引用一律 `@/layer/file`，不再出现 ../../.. 的深嵌套
    alias: { '@': rootDir },
    format: 'cjs',
    platform: 'node',
    outdir: rootDir,
    minify: true,
    // esbuild 默认把非 ASCII 转成 \uXXXX：本项目大量中文提示词与模板会因此膨胀
    // （实测 minify+ascii 5.52 MB，minify+utf8 3.92 MB）。Obsidian 运行于 Electron，
    // 产物按 UTF-8 读取，保留原字符安全且更小。
    charset: 'utf8',
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
