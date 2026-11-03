/**
 * check-dependencies.mjs — 分层依赖检查脚本
 *
 * 检查规则：
 * - UI 层 (ui/) → 可依赖 engine / services / shared
 * - engine 层 (engine/) → 可依赖 services / shared / repository
 * - services 层 (services/) → 可依赖 shared
 * - shared 层 (shared/) → 不可依赖其他业务层
 * - 禁止循环依赖
 *
 * 口径约定（运行时依赖 vs 类型依赖）：
 * - `import type ...` 与 `import { type A }` 编译后整句擦除，不产生 require，
 *   因此不计入分层违规门禁，也不参与成环；这类依赖单独作为「类型耦合提示」列出。
 * - 注释里的 import 示例不参与任何检查（docs 示例会被误判成真实依赖）。
 * - 门禁只对运行时分层违规与运行时循环做棘轮（见 .arch-baseline.json）。
 *
 * 用法：
 *   node scripts/check-dependencies.mjs
 *   node scripts/check-dependencies.mjs --fix   (仅显示可修复建议)
 */

import { readdirSync, statSync, readFileSync } from 'fs';
import { join, relative, dirname } from 'path';
import { fileURLToPath } from 'url';
import { applySetBaseline, parseBaselineArgs } from './baseline-utils.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');

// ============================================================
// 一、分层配置
// ============================================================

const LAYERS = {
    ui: {
        dirs: ['ui/'],
        allowed: ['engine', 'services', 'shared', 'core'],
        label: 'UI 层',
    },
    engine: {
        dirs: ['engine/'],
        allowed: ['services', 'shared', 'core', 'repository'],
        label: 'Engine 层',
    },
    services: {
        dirs: ['services/'],
        allowed: ['shared', 'core'],
        label: 'Services 层',
    },
    shared: {
        dirs: ['shared/'],
        allowed: ['shared'],
        label: 'Shared 层',
    },
    core: {
        dirs: ['core/'],
        allowed: ['shared'],
        label: 'Core 层',
    },
};

// 这些路径的 import 不参与分层检查
const EXTERNAL_IMPORTS = [
    'obsidian',
    'node:',
    'crypto',
    'fs',
    'path',
    'events',
    'stream',
    'util',
    'buffer',
];

// ============================================================
// 二、工具函数
// ============================================================

function getAllTsFiles(dir) {
    const files = [];
    const entries = readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name === 'tests' || entry.name.startsWith('.')) {
                continue;
            }
            files.push(...getAllTsFiles(fullPath));
        } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
            files.push(fullPath);
        }
    }

    return files;
}

function getFileLayer(filePath) {
    const relPath = relative(PROJECT_ROOT, filePath).replace(/\\/g, '/');

    for (const [layerName, config] of Object.entries(LAYERS)) {
        for (const dir of config.dirs) {
            if (relPath.startsWith(dir)) {
                return layerName;
            }
        }
    }

    return null;
}

/** 说明符是否全部为 inline type（`import { type A, type B }`），纯类型导入不产生运行时依赖 */
function isAllInlineType(specifiers) {
    const s = specifiers.trim();
    if (!s.startsWith('{')) return false;
    const inner = s.slice(1, s.lastIndexOf('}'));
    const parts = inner.split(',').map(p => p.trim()).filter(Boolean);
    return parts.length > 0 && parts.every(p => /^type\s/.test(p));
}

/** 剥离注释，避免文档示例里的 `import ... from '...'` 被当作真实依赖（会造成假自环） */
function stripComments(source) {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
}

function parseImports(filePath) {
    const content = stripComments(readFileSync(filePath, 'utf-8'));
    const imports = [];
    const seen = new Set();

    // 捕获 type 前缀：`import type X from '…'` 编译后整句被擦除，不构成运行时依赖
    const importRegex = /import\s+(type\s+)?([\w*{}\s,]+)\s+from\s+['"]([^'"]+)['"]/g;
    let match;

    while ((match = importRegex.exec(content)) !== null) {
        const typeOnly = Boolean(match[1]) || isAllInlineType(match[2]);
        const key = `${match[3]}|${typeOnly ? 'type' : 'runtime'}`;
        if (seen.has(key)) continue;
        seen.add(key);
        imports.push({ path: match[3], typeOnly });
    }

    const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((match = requireRegex.exec(content)) !== null) {
        const key = `${match[1]}|runtime`;
        if (seen.has(key)) continue;
        seen.add(key);
        imports.push({ path: match[1], typeOnly: false });
    }

    return imports;
}

function isExternalImport(importPath) {
    // 统一路径别名：`@/layer/file` 是仓内引用，不是外部包
    if (importPath.startsWith('@/')) return false;
    for (const ext of EXTERNAL_IMPORTS) {
        if (importPath === ext || importPath.startsWith(ext + '/') || importPath.startsWith('node:')) {
            return true;
        }
    }
    return !importPath.startsWith('.') && !importPath.startsWith('/');
}

function resolveImportPath(filePath, importPath) {
    if (isExternalImport(importPath)) {
        return null;
    }

    const fileDir = dirname(filePath);

    let resolved;
    if (importPath.startsWith('@/')) {
        resolved = join(PROJECT_ROOT, importPath.slice(2));
    } else if (importPath.startsWith('.')) {
        resolved = join(fileDir, importPath);
    } else {
        resolved = join(PROJECT_ROOT, importPath);
    }

    const tryPaths = [
        resolved + '.ts',
        resolved + '/index.ts',
        resolved,
    ];

    for (const p of tryPaths) {
        try {
            if (statSync(p).isFile()) {
                return p;
            }
        } catch {
            // 路径不存在
        }
    }

    return null;
}

function getImportLayer(importPath, filePath) {
    if (isExternalImport(importPath)) {
        return 'external';
    }

    const resolved = resolveImportPath(filePath, importPath);
    if (!resolved) {
        return 'unresolved';
    }

    return getFileLayer(resolved);
}

// ============================================================
// 三、循环依赖检测
// ============================================================

function detectCircularDependencies(fileToImports) {
    const visited = new Set();
    const stack = new Set();
    const cycles = [];
    const pathStack = [];

    function dfs(file) {
        if (stack.has(file)) {
            const cycleStartIdx = pathStack.indexOf(file);
            if (cycleStartIdx !== -1) {
                const cycle = pathStack.slice(cycleStartIdx);
                cycle.push(file);
                cycles.push(cycle);
            }
            return;
        }

        if (visited.has(file)) return;

        visited.add(file);
        stack.add(file);
        pathStack.push(file);

        const imports = fileToImports.get(file) || [];
        for (const imp of imports) {
            // 循环依赖是运行时概念：import type 编译后擦除，不参与成环
            if (imp.typeOnly) continue;
            const resolved = resolveImportPath(file, imp.path);
            if (resolved && getFileLayer(resolved)) {
                dfs(resolved);
            }
        }

        pathStack.pop();
        stack.delete(file);
    }

    for (const file of fileToImports.keys()) {
        dfs(file);
    }

    const uniqueCycles = [];
    const seen = new Set();
    for (const cycle of cycles) {
        const key = cycle.sort().join('|');
        if (!seen.has(key)) {
            seen.add(key);
            uniqueCycles.push(cycle);
        }
    }

    return uniqueCycles;
}

// ============================================================
// 四、主检查逻辑
// ============================================================

function checkDependencies() {
    console.log('\n' + '='.repeat(70));
    console.log('📐  小说工坊 AI - 分层依赖检查');
    console.log('='.repeat(70) + '\n');

    const allTsFiles = getAllTsFiles(PROJECT_ROOT);
    const layerFiles = {};
    const violations = [];
    const fileToImports = new Map();
    const layerStats = {};

    for (const layer of Object.keys(LAYERS)) {
        layerFiles[layer] = [];
        layerStats[layer] = { total: 0, violations: 0, typeOnly: 0 };
    }

    for (const file of allTsFiles) {
        const layer = getFileLayer(file);
        if (layer && layerFiles[layer]) {
            layerFiles[layer].push(file);
            layerStats[layer].total++;
        }

        const imports = parseImports(file);
        fileToImports.set(file, imports);
    }

    // 分层检查
    for (const [layerName, config] of Object.entries(LAYERS)) {
        const files = layerFiles[layerName] || [];

        for (const file of files) {
            const imports = parseImports(file);

            for (const imp of imports) {
                const importLayer = getImportLayer(imp.path, file);

                if (importLayer === 'external' || importLayer === 'unresolved' || importLayer === null) {
                    continue;
                }

                if (importLayer === layerName) {
                    continue;
                }

                if (!config.allowed.includes(importLayer)) {
                    const relPath = relative(PROJECT_ROOT, file).replace(/\\/g, '/');
                    violations.push({
                        file: relPath,
                        layer: layerName,
                        import: imp.path,
                        importLayer,
                        typeOnly: imp.typeOnly,
                        message: `${layerName} 层不允许依赖 ${importLayer} 层`,
                    });
                    // 只有运行时依赖计入门禁；type-only 依赖仅作为提示
                    if (imp.typeOnly) {
                        layerStats[layerName].typeOnly++;
                    } else {
                        layerStats[layerName].violations++;
                    }
                }
            }
        }
    }

    // 循环依赖检测
    const cycles = detectCircularDependencies(fileToImports);

    // ============================================================
    // 输出报告
    // ============================================================

    console.log('📊 各层文件统计\n');
    for (const [layerName, config] of Object.entries(LAYERS)) {
        const stats = layerStats[layerName];
        const status = stats.violations > 0 ? '❌' : '✅';
        const typedNote = stats.typeOnly > 0 ? `, ${stats.typeOnly} 条类型耦合（不计入门禁）` : '';
        console.log(`  ${status} ${config.label} (${layerName}): ${stats.total} 个文件, ${stats.violations} 个运行时违规${typedNote}`);
    }

    console.log('');

    const runtimeViolations = violations.filter(v => !v.typeOnly);
    const typeOnlyViolations = violations.filter(v => v.typeOnly);

    if (runtimeViolations.length > 0) {
        console.log(`❌ 发现 ${runtimeViolations.length} 个运行时分层违规：\n`);
        for (const v of runtimeViolations) {
            console.log(`  📄 ${v.file}`);
            console.log(`     ↳ import "${v.import}"`);
            console.log(`     ↳ ${v.message}`);
            console.log('');
        }
    } else {
        console.log('✅ 分层依赖检查通过\n');
    }

    if (typeOnlyViolations.length > 0) {
        console.log(`ℹ️  ${typeOnlyViolations.length} 条 import type 类型耦合（编译后擦除，不计入门禁）：\n`);
        for (const v of typeOnlyViolations) {
            console.log(`  · ${v.file} → "${v.import}"`);
        }
        console.log('');
    }

    if (cycles.length > 0) {
        console.log(`⚠️  发现 ${cycles.length} 个循环依赖：\n`);
        for (let i = 0; i < cycles.length; i++) {
            const cycle = cycles[i];
            console.log(`  循环 #${i + 1}:`);
            for (let j = 0; j < cycle.length; j++) {
                const relPath = relative(PROJECT_ROOT, cycle[j]).replace(/\\/g, '/');
                const prefix = j === 0 ? '    ' : '    → ';
                console.log(`${prefix}${relPath}`);
            }
            console.log('');
        }
    } else {
        console.log('✅ 未发现循环依赖\n');
    }

    // Import 统计
    const totalImports = [...fileToImports.values()].reduce((sum, imps) => sum + imps.length, 0);
    console.log(`📈 总计扫描 ${allTsFiles.length} 个文件, ${totalImports} 个 import 语句`);

    console.log('\n' + '='.repeat(70) + '\n');

    return {
        violations,
        cycles,
        layerStats,
        totalFiles: allTsFiles.length,
        totalImports,
    };
}

const result = checkDependencies();

// 无 --baseline 时保持原语义：有任何违规即失败（用于一次性排查）。
// 传入 --baseline 文件后进入「棘轮」模式：只有新增违规才失败。
const { baselinePath } = parseBaselineArgs();
if (!baselinePath) {
    if (result.violations.some(v => !v.typeOnly) || result.cycles.length > 0) {
        process.exit(1);
    }
    process.exit(0);
}

const layerKeys = [...new Set(
    result.violations.filter(v => !v.typeOnly).map(v => `${v.file}|${v.import}|${v.importLayer}`)
)].sort();
const cycleKeys = [...new Set(
    result.cycles.map(cycle => cycle
        .map(file => relative(PROJECT_ROOT, file).replace(/\\/g, '/'))
        .sort()
        .join('|'))
)].sort();

const layerBaseline = applySetBaseline({
    section: 'dependencyLayerViolations',
    items: layerKeys,
    label: '分层违规',
});
const cycleBaseline = applySetBaseline({
    section: 'dependencyCycles',
    items: cycleKeys,
    label: '循环依赖',
});

if (layerBaseline.failed || cycleBaseline.failed) {
    process.exit(1);
}
process.exit(0);
