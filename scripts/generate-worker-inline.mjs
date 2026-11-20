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
import { gzipSync } from 'fflate';
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
    const compressed = {};
    for (const [file, source] of Object.entries(sources)) {
        // 用 fflate（纯 JS）而不是 node:zlib：zlib 的 deflate 输出随其原生库版本变化，
        // 同一份源码在 Node 20 / 22 / 24 上会产出不同字节，导致 main.js 哈希不可复现
        // （社区审核的 Build verification 会重新构建并比对发布资产）。
        // fflate 固定 gzip 头（mtime=0）且算法与运行环境无关，保证跨平台/跨 Node 版本字节一致。
        // mtime 必须固定为 0：fflate 默认把当前时间写进 gzip 头，会让同一份源码每次构建都不同
        compressed[file] = Buffer.from(
            gzipSync(new Uint8Array(Buffer.from(source, 'utf8')), { level: 9, mtime: 0 }),
        ).toString(
            'base64',
        );
    }
    const lines = [
        '/**',
        ' * 自动生成文件 —— 请勿手工编辑。',
        ' * 来源：engine/deconstructors/deconstruction-worker.ts、engine/quality/quality-worker.ts 的打包产物。',
        ' * 重新生成：npm run gen:workers-inline',
        ' *',
        ' * 用途：社区目录只下发 3 个文件，没有 workers/ 目录；主包用这些字符串创建 Blob Worker，',
        ' * 保证 3 文件安装也能后台执行重活（仓库安装仍优先用磁盘上的 workers/*.js）。',
        ' *',
        ' * 体积：内容为 gzip 压缩后再 base64（未压缩时 855KB → 约 340KB）；',
        ' * 压缩用 fflate（纯 JS，固定 gzip 头）而不是 node:zlib —— 后者随 Node 内置 zlib 版本变化，',
        ' * 会让同一份源码在不同 Node 版本产出不同字节，破坏构建可复现性（社区审核会重建比对）。',
        ' * 运行时用 DecompressionStream 解压（warmInlineWorkerUrls），不支持时退回主线程。',
        ' */',
        '/** 内联 Worker 源码的压缩方式（固定为 gzip+base64，运行时用 DecompressionStream 解压） */',
        "export const INLINE_WORKER_COMPRESSION = 'gzip+base64' as const;",
        '/** worker 文件名 → gzip+base64 源码（运行时解压后创建 Blob Worker） */',
        'export const INLINE_WORKER_GZIP_SOURCES: Readonly<Record<string, string>> = {',
    ];
    for (const [file, base64] of Object.entries(compressed).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
        lines.push(`    ${JSON.stringify(file)}: ${JSON.stringify(base64)},`);
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
