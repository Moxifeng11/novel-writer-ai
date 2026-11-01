/**
 * check-release.mjs — 发布前资产与版本一致性校验
 *
 * 校验项：
 * 1. package.json / manifest.json / 可选 tag 三者版本一致
 * 2. manifest 关键字段（id / main）正确
 * 3. 发布三资产存在且非空（main.js / manifest.json / styles.css）
 * 4. 构建产出的 Worker 包存在（本地构建完整性）
 * 5. 内置模板资源已完整嵌入 main.js（保证 3 文件安装可自举）
 *
 * 用法：
 *   node scripts/check-release.mjs
 *   node scripts/check-release.mjs --tag v4.11.0
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const errors = [];
const notes = [];

function readJson(rel) {
    return JSON.parse(fs.readFileSync(path.join(rootDir, rel), 'utf8'));
}

function requireFile(rel, minBytes = 1) {
    const full = path.join(rootDir, rel);
    if (!fs.existsSync(full)) {
        errors.push(`缺少文件: ${rel}`);
        return null;
    }
    const size = fs.statSync(full).size;
    if (size < minBytes) {
        errors.push(`文件为空或过小: ${rel} (${size} bytes)`);
    }
    return { size };
}

const pkg = readJson('package.json');
const manifest = readJson('manifest.json');

// 1. 版本一致性
if (pkg.version !== manifest.version) {
    errors.push(`版本不一致: package.json=${pkg.version} manifest.json=${manifest.version}`);
}

// 1.1 versions.json 校验（v4.27：Obsidian 社区/BRAT 升级兼容元数据）
const versionsPath = path.join(rootDir, 'versions.json');
if (!fs.existsSync(versionsPath)) {
    errors.push('缺少 versions.json（Obsidian 社区/BRAT 升级兼容元数据）');
} else {
    try {
        const versions = JSON.parse(fs.readFileSync(versionsPath, 'utf8'));
        if (versions[pkg.version] !== manifest.minAppVersion) {
            errors.push(`versions.json 中 ${pkg.version} 的 minAppVersion 与 manifest.json 不一致`);
        }
    } catch (e) {
        errors.push(`versions.json 解析失败: ${e instanceof Error ? e.message : String(e)}`);
    }
}

const tagIndex = process.argv.indexOf('--tag');
if (tagIndex !== -1) {
    const tag = process.argv[tagIndex + 1];
    if (!tag) {
        errors.push('--tag 缺少参数值');
    } else if (tag.replace(/^v/, '') !== pkg.version) {
        errors.push(`tag 与 package.json 版本不一致: tag=${tag} version=${pkg.version}`);
    } else {
        const notesPath = path.join(rootDir, 'docs', 'releases', `${tag}.md`);
        if (!fs.existsSync(notesPath)) {
            errors.push(`缺少发布说明: docs/releases/${tag}.md（release.yml 会退化为自动生成 notes）`);
        }
    }
}

// 2. manifest 关键字段
if (manifest.id !== 'novel-writer-ai') {
    errors.push(`manifest.id 异常: ${manifest.id}`);
}
if (manifest.main !== 'main.js') {
    errors.push(`manifest.main 异常: ${manifest.main}`);
}
if (!manifest.minAppVersion) {
    errors.push('manifest.minAppVersion 缺失');
}

// 3. 发布三资产
const assets = {
    'main.js': requireFile('main.js', 100_000),
}
if (assets['main.js']) {
    try {
        // 只做语法可加载性检查，不执行插件逻辑
        const { execFileSync } = await import('node:child_process');
        execFileSync(process.execPath, ['--check', path.join(rootDir, 'main.js')], { stdio: 'pipe' });
        notes.push('main.js 语法检查通过（node --check）');
    } catch (e) {
        errors.push(`main.js 语法检查失败: ${e instanceof Error ? e.message : String(e)}`);
    }
}
const assetSizes = {
    'manifest.json': requireFile('manifest.json', 50),
    'styles.css': requireFile('styles.css', 10_000),
};
Object.assign(assets, assetSizes);

// 4. Worker 构建产物（运行时可达性由 FR-F-03 负责，发布前先保证产物存在）
const workerFiles = [
    'workers/deconstruction-worker.js',
    'workers/quality-worker.js',
];
for (const rel of workerFiles) {
    const info = requireFile(rel, 1_000);
    if (info) notes.push(`${rel}: ${info.size} bytes`);
}

// 4.1 发布工作流资产必须与本地产物一致（v4.27：曾出现 release.yml 仍列已删的 style-worker，
//     导致打 tag 时 gh release create 因缺文件失败；本地 check:release 完全看不出）
try {
    const workflowPath = path.join(rootDir, '.github', 'workflows', 'release.yml');
    if (fs.existsSync(workflowPath)) {
        const workflow = fs.readFileSync(workflowPath, 'utf8');
        const assetsMatch = workflow.match(/ASSETS=\(([^)]*)\)/);
        if (!assetsMatch) {
            errors.push('release.yml 未找到 ASSETS=(...) 声明，无法校验发布资产（格式变化时必须同步本脚本）');
        } else {
            // 只校验 worker 和 versions.json：main.js/manifest.json/styles.css/$ZIP 由 requireFile 独立检查
            const declared = assetsMatch[1]
                .split(/\s+/)
                .map((token) => token.replace(/["']/g, '').trim())
                .filter((token) => token.startsWith('workers/') || token === 'versions.json')
                .sort();
            const built = [...workerFiles, 'versions.json'].sort();
            const missingInBuild = declared.filter((rel) => !built.includes(rel));
            const missingInRelease = built.filter((rel) => !declared.includes(rel));
            if (missingInBuild.length > 0 || missingInRelease.length > 0) {
                errors.push(
                    `release.yml 资产与构建产物不一致：`
                    + `工作流多出 [${missingInBuild.join(', ')}]，构建多出 [${missingInRelease.join(', ')}]`
                );
            } else {
                notes.push(`release.yml 资产一致（${declared.length} 个 worker/versions）`);
            }
        }
    }
} catch (e) {
    notes.push(`release.yml 资产校验跳过：${e instanceof Error ? e.message : String(e)}`);
}

// 5. 内置模板资源完整性
const assetDir = path.join(rootDir, 'assets', 'template-scaffold');
const generatedFile = path.join(rootDir, 'shared', 'template-scaffold-assets.generated.ts');
if (!fs.existsSync(assetDir)) {
    errors.push('缺少模板资源目录: assets/template-scaffold');
} else if (!fs.existsSync(generatedFile)) {
    errors.push('缺少生成模块: shared/template-scaffold-assets.generated.ts');
} else {
    const generated = fs.readFileSync(generatedFile, 'utf8');
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        return entry.isDirectory() ? walk(full) : [full];
    });
    const keys = walk(assetDir).map((full) =>
        path.relative(assetDir, full).split(path.sep).join('/')
    );
    for (const key of keys) {
        if (!generated.includes(JSON.stringify(key))) {
            errors.push(`模板资源未嵌入生成模块: ${key}`);
        }
    }
    notes.push(`内置模板: ${keys.length} 个文件`);

    // 3 文件安装的自举依赖模板内容内联进产物。产物已开启 minify：模块路径注释与
    // 顶层变量名会被压缩掉，因此改断言模板 key 的字符串字面量（压缩后必然保留）。
    if (assets['main.js']) {
        const mainJs = fs.readFileSync(path.join(rootDir, 'main.js'), 'utf8');
        const markers = [...keys].sort().slice(0, 2).map((key) => JSON.stringify(key));
        for (const marker of markers) {
            if (!mainJs.includes(marker)) {
                errors.push(`main.js 未包含模板自举标记: ${marker}`);
            }
        }
    }
}

if (notes.length > 0) {
    console.log('[check:release] 信息');
    for (const note of notes) console.log(`  - ${note}`);
}

if (errors.length > 0) {
    console.error('[check:release] 校验失败:');
    for (const error of errors) console.error(`  ✗ ${error}`);
    process.exit(1);
}

console.log(`[check:release] 校验通过（v${pkg.version}）`);
