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

function parseImports(filePath) {
    const content = readFileSync(filePath, 'utf-8');
    const imports = [];

    const importRegex = /import\s+(?:type\s+)?(?:[\w*{}\s,]+)\s+from\s+['"]([^'"]+)['"]/g;
    let match;

    while ((match = importRegex.exec(content)) !== null) {
        imports.push(match[1]);
    }

    const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((match = requireRegex.exec(content)) !== null) {
        imports.push(match[1]);
    }

    return [...new Set(imports)];
}

function isExternalImport(importPath) {
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
    if (importPath.startsWith('.')) {
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
            const resolved = resolveImportPath(file, imp);
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
        layerStats[layer] = { total: 0, violations: 0 };
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
                const importLayer = getImportLayer(imp, file);

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
                        import: imp,
                        importLayer,
                        message: `${layerName} 层不允许依赖 ${importLayer} 层`,
                    });
                    layerStats[layerName].violations++;
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
        console.log(`  ${status} ${config.label} (${layerName}): ${stats.total} 个文件, ${stats.violations} 个违规`);
    }

    console.log('');

    if (violations.length > 0) {
        console.log(`❌ 发现 ${violations.length} 个分层违规：\n`);
        for (const v of violations) {
            console.log(`  📄 ${v.file}`);
            console.log(`     ↳ import "${v.import}"`);
            console.log(`     ↳ ${v.message}`);
            console.log('');
        }
    } else {
        console.log('✅ 分层依赖检查通过\n');
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
    if (result.violations.length > 0 || result.cycles.length > 0) {
        process.exit(1);
    }
    process.exit(0);
}

const layerKeys = [...new Set(
    result.violations.map(v => `${v.file}|${v.import}|${v.importLayer}`)
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
