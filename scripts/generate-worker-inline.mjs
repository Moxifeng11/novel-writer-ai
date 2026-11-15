/**
 * generate-worker-inline.mjs — 把 Worker 产物内联为字符串模块（社区目录 3 文件安装）
 *
 * 背景：Obsidian 社区目录只下发 main.js / manifest.json / styles.css，
 * 不含 workers/ 目录 → 拆解、质检等重活只能退回主线程（UI 卡顿，实测降级通知）。
 * 本脚本在构建前把两个 worker 打包产物读成字符串常量写进 TS 模块，
 * 主包运行时用 Blob URL 创建 Worker，从而在 3 文件安装下也能后台执行。
 *
 * 顺序约束：必须先生成该模块，再跑 scripts/build.js（主包 import 它）。
 * build.js 仍会照常产出 workers/*.js，供仓库/BRAT 完整安装使用（文件优先）。
 *
 * 用法：
 *   node scripts/generate-worker-inline.mjs           # 生成
 *   node scripts/generate-worker-inline.mjs --check   # 校验生成物是否与源码一致
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const outFile = path.join(rootDir, 'shared', 'workers-inline.generated.ts');

const WORKER_ENTRIES = {
    'deconstruction-worker.js': 'engine/deconstructors/deconstruction-worker.ts',
    'quality-worker.js': 'engine/quality/quality-worker.ts',
};

/**
 * 用与 scripts/build.js 相同的选项单独打包 worker，读出产物文本。
 *
 * @returns {Promise<Record<string, string>>} 文件名 → 产物源码
 */
async function bundleWorkers() {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-workers-'));
    try {
        await build({
            entryPoints: Object.fromEntries(
                Object.entries(WORKER_ENTRIES).map(([file, entry]) => [file.replace(/\.js$/, ''), entry]),
            ),
            bundle: true,
            external: ['obsidian'],
            alias: { '@': rootDir },
            format: 'cjs',
            platform: 'node',
            outdir: tmpDir,
            minify: true,
            charset: 'utf8',
            define: {
                PLUGIN_VERSION: `"${JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8')).version}"`,
            },
            logLevel: 'silent',
        });
        const sources = {};
        for (const file of Object.keys(WORKER_ENTRIES)) {
            sources[file] = fs.readFileSync(path.join(tmpDir, file.replace(/\.js$/, '.js')), 'utf8');
        }
        return sources;
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}

/**
 * 生成 TS 模块文本。
 *
 * @param {Record<string, string>} sources - worker 源码
 * @returns {string} 模块文本
 */
function buildModuleText(sources) {
    const lines = [
        '/**',
        ' * 自动生成文件 —— 请勿手工编辑。',
        ' * 来源：engine/deconstructors/deconstruction-worker.ts、engine/quality/quality-worker.ts 的打包产物。',
        ' * 重新生成：npm run gen:workers-inline',
        ' *',
        ' * 用途：社区目录只下发 3 个文件，没有 workers/ 目录；主包用这些字符串创建 Blob Worker，',
        ' * 保证 3 文件安装也能后台执行重活（仓库安装仍优先用磁盘上的 workers/*.js）。',
        ' */',
        'export const INLINE_WORKER_SOURCES: Readonly<Record<string, string>> = {',
    ];
    for (const [file, source] of Object.entries(sources).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
        lines.push(`    ${JSON.stringify(file)}: ${JSON.stringify(source)},`);
    }
    lines.push('};', '');
    return lines.join('\n');
}

const sources = await bundleWorkers();
const text = buildModuleText(sources);
const checkOnly = process.argv.includes('--check');
const totalBytes = Object.values(sources).reduce((sum, source) => sum + Buffer.byteLength(source, 'utf8'), 0);

if (checkOnly) {
    const current = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8').replace(/\r\n/g, '\n') : '';
    if (current !== text) {
        console.error('[gen:workers-inline] 生成物与 worker 源码不一致，请运行 npm run gen:workers-inline');
        process.exit(1);
    }
    console.log(`[gen:workers-inline] 校验通过（${Object.keys(sources).length} 个 worker，共 ${Math.round(totalBytes / 1024)}KB）`);
} else {
    fs.writeFileSync(outFile, text, 'utf8');
    console.log(
        `[gen:workers-inline] 已生成 ${path.relative(rootDir, outFile)}（${Object.keys(sources).length} 个 worker，共 ${Math.round(totalBytes / 1024)}KB）`,
    );
}
