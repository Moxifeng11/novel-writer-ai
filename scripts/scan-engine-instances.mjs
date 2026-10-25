#!/usr/bin/env node
/**
 * scan-engine-instances.mjs — EngineRegistry 治理扫描脚本
 *
 * 功能：
 *   1. 默认模式：全量扫描引擎实例化，生成 JSON + Markdown 报告 + 迁移前基线
 *   2. --check 模式：对比白名单，输出违规列表（应单例但被直接 new 且不在白名单）
 *
 * 用法：
 *   node scripts/scan-engine-instances.mjs          # 全量扫描并生成报告
 *   node scripts/scan-engine-instances.mjs --check    # 守护检查，CI 集成
 *
 * 退出码（--check 模式）：
 *   0 = 无违规
 *   1 = 有违规（应单例但被直接 new 且不在白名单）
 *   2 = 白名单文件缺失或格式错误
 *
 * 零外部依赖，仅使用 Node.js 内置模块。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    parseBaselineArgs,
    readBaseline,
    writeBaseline,
    diffCounts,
} from './baseline-utils.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

// 白名单配置文件路径
const WHITELIST_PATH = path.join(PROJECT_ROOT, '.engine-registry-whitelist.json');

// CLI 参数解析
const CHECK_MODE = process.argv.includes('--check');

// 扫描排除目录（用户要求：tests/, node_modules/, .trae/，额外排除构建产物目录）
const EXCLUDE_DIRS = new Set(['tests', 'node_modules', '.trae', '.git', 'dist', 'build']);

// 匹配模式：new XxxEngine( / new XxxManager( 等 9 类后缀
// 一次性匹配所有目标后缀，避免多次扫描
const INSTANCE_PATTERN = /new\s+([A-Z][A-Za-z0-9_]*(?:Engine|Manager|Service|Store|Generator|Checker|Analyzer|Builder|Controller))\s*\(/g;

// 用于从 engine-registry.ts 提取所有 new Xxx( 调用
const REGISTRY_NEW_PATTERN = /new\s+([A-Z][A-Za-z0-9_]*)\s*\(/g;

// 已注册类的后缀过滤：涵盖扫描的 9 类后缀 + 项目中实际注册的其他后缀
// （Registry/Repository/Learner/Agent/Scheduler/Injector/Enhancer）
// 用于过滤 engine-registry.ts 中的辅助类（Error/Notice/ObsidianFileSystem 等）
const REGISTERED_CLASS_SUFFIX = /(?:Engine|Manager|Service|Store|Generator|Checker|Analyzer|Builder|Controller|Repository|Registry|Learner|Agent|Scheduler|Injector|Enhancer)$/;

// 分类规则
function classify(className) {
    if (/(Engine|Manager|Service|Store)$/.test(className)) {
        return 'singleton';
    }
    if (/(Result|DTO|Builder|Config)$/.test(className)) {
        return 'transient';
    }
    return 'unknown';
}

// 递归遍历 .ts 文件
function walkTsFiles(rootDir, results = []) {
    let entries;
    try {
        entries = fs.readdirSync(rootDir, { withFileTypes: true });
    } catch (e) {
        console.warn(`[警告] 无法读取目录 ${rootDir}: ${e.message}`);
        return results;
    }
    for (const entry of entries) {
        const fullPath = path.join(rootDir, entry.name);
        if (entry.isDirectory()) {
            if (EXCLUDE_DIRS.has(entry.name)) continue;
            walkTsFiles(fullPath, results);
        } else if (entry.isFile() && entry.name.endsWith('.ts')) {
            results.push(fullPath);
        }
    }
    return results;
}

// 扫描单个文件
function scanFile(filePath) {
    let content;
    try {
        content = fs.readFileSync(filePath, 'utf8');
    } catch (e) {
        console.warn(`[警告] 无法读取文件 ${filePath}: ${e.message}`);
        return [];
    }
    const lines = content.split('\n');
    const instances = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        // 跳过注释行
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
            continue;
        }

        const pattern = new RegExp(INSTANCE_PATTERN.source, 'g');
        let match;
        while ((match = pattern.exec(line)) !== null) {
            const className = match[1];

            // 粗略提取参数：从 ( 之后到行尾或第一个 )
            const parenStart = match.index + match[0].length - 1;
            const restOfLine = line.slice(parenStart + 1);
            const parenEnd = restOfLine.indexOf(')');
            const args = parenEnd >= 0
                ? restOfLine.slice(0, parenEnd).trim()
                : restOfLine.trim();

            instances.push({
                className,
                filePath: path.relative(PROJECT_ROOT, filePath).replace(/\\/g, '/'),
                line: i + 1,
                code: trimmed,
                args: args || '(none)',
                // 标记是否在 engine-registry.ts 内部（注册表自身初始化，非绕过）
                inRegistry: filePath.endsWith(path.join('engine', 'engine-registry.ts')),
            });
        }
    }
    return instances;
}

// 从 engine-registry.ts 提取已注册的类名（通过 new Xxx( 调用）
// 过滤掉辅助类（Error/Notice/ObsidianFileSystem 等非注册项）
function loadRegisteredClasses() {
    const registryPath = path.join(PROJECT_ROOT, 'engine', 'engine-registry.ts');
    if (!fs.existsSync(registryPath)) {
        console.warn(`[警告] 未找到 ${registryPath}`);
        return { registeredClasses: [], registryFile: null };
    }
    const content = fs.readFileSync(registryPath, 'utf8');
    const lines = content.split('\n');
    const allNewClasses = new Set();

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
            continue;
        }
        const pattern = new RegExp(REGISTRY_NEW_PATTERN.source, 'g');
        let match;
        while ((match = pattern.exec(line)) !== null) {
            allNewClasses.add(match[1]);
        }
    }

    // 过滤：只保留符合已知注册类后缀模式的类名
    // 排除 Error/Notice/ObsidianFileSystem/ObsidianVaultMeta/AIApiClient/EmbeddingProviderFactory 等辅助类
    const registeredClasses = Array.from(allNewClasses).filter(cls =>
        REGISTERED_CLASS_SUFFIX.test(cls)
    );

    return {
        registeredClasses,
        registryFile: 'engine/engine-registry.ts',
    };
}

// ─── 白名单加载与 --check 模式 ───

/**
 * 加载白名单配置
 * @returns {{ className: string, reason: string, category: string, allowedInstances: number }[]}
 */
function loadWhitelist() {
    if (!fs.existsSync(WHITELIST_PATH)) {
        console.error(`[错误] 白名单文件不存在: ${WHITELIST_PATH}`);
        process.exit(2);
    }
    let raw;
    try {
        raw = fs.readFileSync(WHITELIST_PATH, 'utf8');
    } catch (e) {
        console.error(`[错误] 无法读取白名单文件: ${e.message}`);
        process.exit(2);
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (e) {
        console.error(`[错误] 白名单 JSON 解析失败: ${e.message}`);
        process.exit(2);
    }
    if (!parsed || !Array.isArray(parsed.whitelist)) {
        console.error(`[错误] 白名单格式错误：缺少 whitelist 数组`);
        process.exit(2);
    }
    return parsed.whitelist.map(item => ({
        className: String(item.className),
        reason: String(item.reason || ''),
        category: String(item.category || 'unknown'),
        allowedInstances: Number(item.allowedInstances ?? -1),
    }));
}

/**
 * 应用引擎守卫基线。
 * 无 --baseline 时保持原语义（有违规即失败）；传入基线后只有「新增类/实例数增加/超限增加」才失败。
 */
function applyEngineBaseline(violations, overLimit) {
    const { baselinePath, updateBaseline } = parseBaselineArgs();
    if (!baselinePath) {
        return violations.length > 0 || overLimit.length > 0 ? 1 : 0;
    }

    const bypassCounts = Object.fromEntries(violations.map(v => [v.className, v.bypassCount]));
    const overCounts = Object.fromEntries(overLimit.map(o => [o.className, o.actualBypass]));

    const baseline = readBaseline(baselinePath);
    // 基线文件可能由 check:deps 先创建：只有引擎 section 不存在时才算首次基线化
    if (!baseline || !baseline.engineBypass) {
        writeBaseline(baselinePath, 'engineBypass', bypassCounts);
        writeBaseline(baselinePath, 'engineOverLimit', overCounts);
        console.log(`\n[基线] 首次写入引擎守卫基线：${violations.length} 个非白名单类 / ${overLimit.length} 个超限类 → ${baselinePath}`);
        return 0;
    }

    const bypassDiff = diffCounts(baseline.engineBypass || {}, bypassCounts);
    const overDiff = diffCounts(baseline.engineOverLimit || {}, overCounts);
    const newBypass = [...bypassDiff.added, ...bypassDiff.increased];
    const newOver = [...overDiff.added, ...overDiff.increased];

    if (newBypass.length > 0 || newOver.length > 0) {
        console.log('\n❌ [基线] 引擎守卫新增违规（基线只允许减少）：');
        for (const item of newBypass) {
            console.log(`  + ${item.key}: ${item.count}（基线 ${item.base ?? 0}）`);
        }
        for (const item of newOver) {
            console.log(`  + ${item.key} 超限: ${item.count}（基线 ${item.base ?? 0}）`);
        }
        return 1;
    }

    const tightenedBypass = bypassDiff.decreased.length + bypassDiff.removed.length;
    const tightenedOver = overDiff.decreased.length + overDiff.removed.length;
    if (updateBaseline && (tightenedBypass > 0 || tightenedOver > 0)) {
        writeBaseline(baselinePath, 'engineBypass', bypassCounts);
        writeBaseline(baselinePath, 'engineOverLimit', overCounts);
        console.log(`\n[基线] 已收紧引擎守卫基线：非白名单 ${Object.keys(bypassCounts).length} 个 / 超限 ${Object.keys(overCounts).length} 个。`);
    } else if (tightenedBypass > 0 || tightenedOver > 0) {
        console.log(`\n[基线] 引擎守卫已有 ${tightenedBypass + tightenedOver} 处收紧；运行 \`npm run check-engines -- --baseline .arch-baseline.json --update-baseline\` 可写回。`);
    }

    return 0;
}

/**
 * 守护检查模式：对比白名单，输出违规列表
 *
 * 违规规则：
 *   1. 类分类为 singleton（应该单例）
 *   2. bypassCount > 0（被直接 new，绕过 registry）
 *   3. 不在白名单中
 *
 * 退出码：0=无违规（或仅存在基线内债务），1=有新增违规
 */
function runCheckMode() {
    console.log('[检查] EngineRegistry 守护检查模式启动...');
    const whitelist = loadWhitelist();
    const whitelistSet = new Map(whitelist.map(w => [w.className, w]));
    console.log(`[检查] 已加载白名单: ${whitelist.length} 个类`);

    const tsFiles = walkTsFiles(PROJECT_ROOT);
    const allInstances = [];
    for (const file of tsFiles) {
        const instances = scanFile(file);
        allInstances.push(...instances);
    }

    // 按类名聚合
    const classMap = new Map();
    for (const inst of allInstances) {
        if (!classMap.has(inst.className)) {
            classMap.set(inst.className, []);
        }
        classMap.get(inst.className).push(inst);
    }

    const { registeredClasses } = loadRegisteredClasses();
    const registeredSet = new Set(registeredClasses);

    // 构建摘要
    const classSummaries = [];
    for (const [className, instances] of classMap) {
        const files = [...new Set(instances.map(i => i.filePath))];
        const registryInternalCount = instances.filter(i => i.inRegistry).length;
        const bypassCount = instances.length - registryInternalCount;
        classSummaries.push({
            className,
            totalCount: instances.length,
            bypassCount,
            registryInternalCount,
            fileCount: files.length,
            files,
            category: classify(className),
            isRegistered: registeredSet.has(className),
            instances,
        });
    }

    // 找违规：singleton + bypassCount > 0 + 不在白名单
    const violations = classSummaries.filter(c => {
        if (c.category !== 'singleton') return false;
        if (c.bypassCount <= 0) return false;
        if (whitelistSet.has(c.className)) return false;
        return true;
    });

    // 找超出 allowedInstances 的白名单项
    const overLimit = [];
    for (const w of whitelist) {
        if (w.allowedInstances < 0) continue; // -1 表示不限制
        const c = classSummaries.find(cs => cs.className === w.className);
        if (!c) continue;
        if (c.bypassCount > w.allowedInstances) {
            overLimit.push({ ...w, actualBypass: c.bypassCount });
        }
    }

    // 输出结果
    console.log('');
    console.log('=== 守护检查结果 ===');
    console.log(`扫描文件数: ${tsFiles.length}`);
    console.log(`扫描实例化数: ${allInstances.length}`);
    console.log(`涉及类名数: ${classSummaries.length}`);
    console.log(`白名单类数: ${whitelist.length}`);
    console.log('');

    if (violations.length === 0 && overLimit.length === 0) {
        console.log('[通过] 未发现违规：所有应单例的直接 new 都在白名单中且未超限');
        process.exit(applyEngineBaseline(violations, overLimit));
    }

    if (violations.length > 0) {
        console.log(`[违规] 发现 ${violations.length} 个应单例但被直接 new 且不在白名单的类：`);
        console.log('');
        console.log('| 类名 | bypassCount | 文件数 | 文件列表 |');
        console.log('|------|-------------|--------|----------|');
        for (const v of violations) {
            const fileList = v.files.slice(0, 5).join(', ') + (v.files.length > 5 ? ` (+${v.files.length - 5})` : '');
            console.log(`| ${v.className} | ${v.bypassCount} | ${v.fileCount} | ${fileList} |`);
        }
        console.log('');
        console.log('修复建议：');
        console.log('  1. 如果该类允许多实例，添加到 .engine-registry-whitelist.json 并说明理由');
        console.log('  2. 如果该类应单例，改为通过 registry.get() 获取');
        console.log('');
    }

    if (overLimit.length > 0) {
        console.log(`[超限] 发现 ${overLimit.length} 个白名单类实例数超出 allowedInstances：`);
        for (const o of overLimit) {
            console.log(`  - ${o.className}: 实际 ${o.actualBypass} 个 > 允许 ${o.allowedInstances} 个（理由：${o.reason}）`);
        }
        console.log('');
    }

    process.exit(applyEngineBaseline(violations, overLimit));
}

// 生成 Markdown 报告
function generateMarkdown(overview, classes, registeredClasses, registryFile) {
    const lines = [];
    lines.push('# 引擎实例化扫描报告');
    lines.push('');
    lines.push('> 本报告由 `scripts/scan-engine-instances.mjs` 自动生成。');
    lines.push('');
    lines.push('## 总览');
    lines.push('');
    lines.push('| 指标 | 值 |');
    lines.push('|------|-----|');
    lines.push(`| 扫描时间 | ${overview.scanTime} |`);
    lines.push(`| 项目根目录 | ${overview.projectRoot} |`);
    lines.push(`| 扫描 .ts 文件数 | ${overview.totalFiles} |`);
    lines.push(`| 总实例化数 | ${overview.totalInstances} |`);
    lines.push(`| 涉及类名数 | ${overview.totalClasses} |`);
    lines.push(`| 应该单例 (singleton) | ${overview.singletonCount} |`);
    lines.push(`| 可能多实例 (transient) | ${overview.transientCount} |`);
    lines.push(`| 不确定 (unknown) | ${overview.unknownCount} |`);
    lines.push(`| 已注册到 EngineRegistry | ${overview.registeredCount} |`);
    lines.push(`| 未注册 | ${overview.unregisteredCount} |`);
    lines.push(`| 多实例类数 (totalCount > 1) | ${overview.multiInstanceCount} |`);
    lines.push(`| 多实例单例问题数 | ${overview.multiInstanceSingletonCount} |`);
    lines.push(`| 已注册但仍被直接实例化（绕过 registry） | ${overview.registeredBypassedCount} |`);
    lines.push('');
    lines.push('## 分类规则');
    lines.push('');
    lines.push('- **singleton**（应该单例）：类名以 Engine/Manager/Service/Store 结尾');
    lines.push('- **transient**（可能允许多实例）：类名以 Result/DTO/Builder/Config 结尾');
    lines.push('- **unknown**（不确定）：其他情况');
    lines.push('');
    lines.push('## 已注册到 EngineRegistry 的类');
    lines.push('');
    lines.push(`来源：\`${registryFile}\` 中所有 \`new Xxx(\` 调用`);
    lines.push('');
    if (registeredClasses.length === 0) {
        lines.push('（未检测到）');
    } else {
        lines.push(registeredClasses.map(c => `- \`${c}\``).join('\n'));
    }
    lines.push('');
    lines.push('## 实例化详情（按实例化次数降序）');
    lines.push('');

    for (const c of classes) {
        lines.push(`### ${c.className}`);
        lines.push('');
        lines.push(`- **实例化次数**: ${c.totalCount}`);
        lines.push(`- **文件数**: ${c.fileCount}`);
        lines.push(`- **分类**: ${c.category}`);
        lines.push(`- **已注册到 EngineRegistry**: ${c.isRegistered ? '是' : '否'}`);
        lines.push('');
        lines.push('| 文件 | 行号 | 代码 | 参数（粗略） |');
        lines.push('|------|------|------|--------------|');
        for (const inst of c.instances) {
            const code = inst.code.replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 120);
            const args = inst.args.replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 80);
            lines.push(`| ${inst.filePath} | ${inst.line} | \`${code}\` | \`${args}\` |`);
        }
        lines.push('');
    }

    return lines.join('\n');
}

// 生成迁移前基线
function generateBaseline(overview, classes, registeredClasses, registryFile) {
    const lines = [];
    lines.push('# EngineRegistry 治理 — 迁移前基线');
    lines.push('');
    lines.push('> 本文档记录 EngineRegistry 治理前的引擎实例化状态，作为迁移基线。');
    lines.push('> 生成工具：`scripts/scan-engine-instances.mjs`');
    lines.push('');
    lines.push(`生成时间：${overview.scanTime}`);
    lines.push('');
    lines.push('## 1. 总览');
    lines.push('');
    lines.push('| 指标 | 值 |');
    lines.push('|------|-----|');
    lines.push(`| 扫描 .ts 文件数 | ${overview.totalFiles} |`);
    lines.push(`| 总实例化数 | ${overview.totalInstances} |`);
    lines.push(`| 涉及类名数 | ${overview.totalClasses} |`);
    lines.push(`| 应该单例 (singleton) | ${overview.singletonCount} |`);
    lines.push(`| 可能多实例 (transient) | ${overview.transientCount} |`);
    lines.push(`| 不确定 (unknown) | ${overview.unknownCount} |`);
    lines.push(`| 已注册到 EngineRegistry | ${overview.registeredCount} |`);
    lines.push(`| 未注册 | ${overview.unregisteredCount} |`);
    lines.push(`| 多实例类数 | ${overview.multiInstanceCount} |`);
    lines.push(`| 多实例单例问题数 | ${overview.multiInstanceSingletonCount} |`);
    lines.push(`| 已注册但仍被直接实例化（绕过 registry） | ${overview.registeredBypassedCount} |`);
    lines.push('');
    lines.push('## 2. 已知的状态不同步问题');
    lines.push('');
    lines.push('根据 `engine/engine-registry.ts` 顶部注释，治理目标包括：');
    lines.push('');
    lines.push('1. 引擎实例化分散在 main.ts onload 各处');
    lines.push('2. UI 组件直接 `new` 引擎导致多实例状态不同步');
    lines.push('3. 缺乏统一初始化顺序管理');
    lines.push('');
    lines.push('### 2.1 已注册但仍被直接实例化的类（绕过 EngineRegistry）');
    lines.push('');
    lines.push('以下类**已注册**到 EngineRegistry，但在代码中仍被直接 `new` 实例化（排除 registry 自身初始化），');
    lines.push('绕过了注册表，这是状态不同步的直接证据。这些实例化点需要改为通过 `registry.get()` 获取。');
    lines.push('');
    lines.push('| 类名 | 绕过实例化次数 | 文件数 | 分类 |');
    lines.push('|------|---------------|--------|------|');

    const registeredButBypassed = classes
        .filter(c => c.isRegistered && c.bypassCount > 0)
        .sort((a, b) => b.bypassCount - a.bypassCount);
    if (registeredButBypassed.length === 0) {
        lines.push('| (无) | - | - | - |');
    } else {
        for (const c of registeredButBypassed) {
            lines.push(`| \`${c.className}\` | ${c.bypassCount} | ${c.fileCount} | ${c.category} |`);
        }
    }
    lines.push('');
    lines.push('> 注：绕过实例化次数 = 总实例化次数 - registry 内部初始化次数（engine-registry.ts 中的 `new` 调用）。');
    lines.push('> 仅计 registry 外部的直接 `new` 调用，这些才是真正的绕过行为。');
    lines.push('');
    lines.push('## 3. 已注册到 EngineRegistry 的引擎列表');
    lines.push('');
    lines.push(`来源：\`${registryFile}\` 中所有 \`new Xxx(\` 调用（对应 ENGINE_NAMES 注册项）`);
    lines.push('');
    lines.push('| 类名 | 在扫描中是否出现 | 实例化次数 |');
    lines.push('|------|------------------|------------|');

    const classMap = new Map(classes.map(c => [c.className, c]));
    for (const cls of registeredClasses) {
        const found = classMap.get(cls);
        lines.push(`| \`${cls}\` | ${found ? '是' : '仅在 registry 中'} | ${found ? found.totalCount : 0} |`);
    }
    lines.push('');
    lines.push('## 4. 未注册但有多次实例化的引擎列表');
    lines.push('');
    lines.push('以下类未被 EngineRegistry 注册，但存在多次实例化（可能导致状态不同步）：');
    lines.push('');
    lines.push('| 类名 | 实例化次数 | 文件数 | 分类 |');
    lines.push('|------|-----------|--------|------|');

    const unregisteredMulti = classes.filter(c => !c.isRegistered && c.totalCount > 1);
    if (unregisteredMulti.length === 0) {
        lines.push('| (无) | - | - | - |');
    } else {
        for (const c of unregisteredMulti) {
            lines.push(`| \`${c.className}\` | ${c.totalCount} | ${c.fileCount} | ${c.category} |`);
        }
    }
    lines.push('');
    lines.push('## 5. 未注册但仅实例化一次的类');
    lines.push('');
    lines.push('以下类未被 EngineRegistry 注册，但仅实例化一次（可作为后续迁移候选）：');
    lines.push('');
    lines.push('| 类名 | 实例化位置 | 分类 |');
    lines.push('|------|-----------|------|');

    const unregisteredSingle = classes.filter(c => !c.isRegistered && c.totalCount === 1);
    if (unregisteredSingle.length === 0) {
        lines.push('| (无) | - | - |');
    } else {
        for (const c of unregisteredSingle) {
            const inst = c.instances[0];
            lines.push(`| \`${c.className}\` | ${inst.filePath}:${inst.line} | ${c.category} |`);
        }
    }
    lines.push('');
    lines.push('## 6. 迁移优先级建议');
    lines.push('');
    lines.push('### P0-A — 立即迁移（多实例 + 应该单例 + 未注册）');
    lines.push('');
    lines.push('这些类应该单例，但未注册到 EngineRegistry，且存在多次实例化，存在状态不同步风险。');
    lines.push('需要：1) 注册到 EngineRegistry；2) 替换所有直接 `new` 为 `registry.get()`。');
    lines.push('');
    const p0 = classes.filter(c => !c.isRegistered && c.totalCount > 1 && c.category === 'singleton');
    if (p0.length === 0) {
        lines.push('（无）');
    } else {
        for (const c of p0) {
            lines.push(`- **${c.className}** — ${c.totalCount} 次, ${c.fileCount} 个文件`);
        }
    }
    lines.push('');
    lines.push('### P0-B — 立即修复（已注册但仍被直接实例化，绕过 EngineRegistry）');
    lines.push('');
    lines.push('这些类**已注册**到 EngineRegistry，但代码中仍直接 `new` 实例化（排除 registry 自身初始化），绕过了注册表。');
    lines.push('这是状态不同步的直接证据 — 存在与 registry 中实例不同的"野生"实例。');
    lines.push('需要：将所有直接 `new` 替换为 `registry.get()`（注册已存在，仅需改调用方）。');
    lines.push('');
    const p0b = classes
        .filter(c => c.isRegistered && c.bypassCount > 0)
        .sort((a, b) => b.bypassCount - a.bypassCount);
    if (p0b.length === 0) {
        lines.push('（无）');
    } else {
        for (const c of p0b) {
            lines.push(`- **${c.className}** — ${c.bypassCount} 次绕过实例化, ${c.fileCount} 个文件 (分类: ${c.category})`);
        }
    }
    lines.push('');
    lines.push('### P1 — 建议迁移（单实例 + 应该单例 + 未注册）');
    lines.push('');
    lines.push('这些类应该单例，但未注册到 EngineRegistry；虽然目前仅实例化一次，但应统一管理以防滥用。');
    lines.push('');
    const p1 = classes.filter(c => !c.isRegistered && c.totalCount === 1 && c.category === 'singleton');
    if (p1.length === 0) {
        lines.push('（无）');
    } else {
        for (const c of p1) {
            lines.push(`- **${c.className}** — ${c.instances[0].filePath}:${c.instances[0].line}`);
        }
    }
    lines.push('');
    lines.push('### P2 — 评估迁移（多实例 + 不确定）');
    lines.push('');
    lines.push('这些类分类不确定，需要人工评估是否应该单例。');
    lines.push('');
    const p2 = classes.filter(c => !c.isRegistered && c.totalCount > 1 && c.category === 'unknown');
    if (p2.length === 0) {
        lines.push('（无）');
    } else {
        for (const c of p2) {
            lines.push(`- **${c.className}** — ${c.totalCount} 次, ${c.fileCount} 个文件`);
        }
    }
    lines.push('');
    lines.push('### P3 — 无需迁移（transient）');
    lines.push('');
    lines.push('这些类允许有多实例（Builder/Config/DTO 等），无需迁移。');
    lines.push('');
    const p3 = classes.filter(c => c.category === 'transient');
    if (p3.length === 0) {
        lines.push('（无）');
    } else {
        for (const c of p3) {
            lines.push(`- **${c.className}** — ${c.totalCount} 次`);
        }
    }
    lines.push('');
    lines.push('## 7. 迁移路径建议');
    lines.push('');
    lines.push('1. **P0-A 类**：注册到 EngineRegistry（`register` / `registerLazy`），并替换所有直接 `new` 为 `registry.get()`');
    lines.push('2. **P0-B 类**：注册已存在，仅需将所有直接 `new` 替换为 `registry.get()`（修复绕过问题）');
    lines.push('3. **P1 类**：次优先迁移，统一通过 `registry.get()` 获取');
    lines.push('4. **P2 类**：人工评估后决定');
    lines.push('5. **P3 类**：无需迁移');
    lines.push('');
    lines.push('## 8. 后续 Task 建议');
    lines.push('');
    lines.push('- Task 2: 修复 P0-B 类（已注册但被绕过）— 将直接 `new` 替换为 `registry.get()`');
    lines.push('- Task 3: 迁移 P0-A 类（未注册的多实例单例）到 EngineRegistry');
    lines.push('- Task 4: 迁移 P1 类');
    lines.push('- Task 5: 评估 P2 类');
    lines.push('- Task 6: 迁移验证（重新扫描，确认多实例问题已解决）');
    lines.push('');
    return lines.join('\n');
}

// 主函数
function main() {
    // --check 模式：守护检查，对比白名单
    if (CHECK_MODE) {
        runCheckMode();
        return;
    }

    console.log('[扫描] 开始扫描引擎实例化...');
    console.log(`[扫描] 项目根目录: ${PROJECT_ROOT}`);

    const tsFiles = walkTsFiles(PROJECT_ROOT);
    console.log(`[扫描] 找到 ${tsFiles.length} 个 .ts 文件`);

    const allInstances = [];
    for (const file of tsFiles) {
        const instances = scanFile(file);
        allInstances.push(...instances);
    }
    console.log(`[扫描] 找到 ${allInstances.length} 个实例化`);

    // 按类名聚合
    const classMap = new Map();
    for (const inst of allInstances) {
        if (!classMap.has(inst.className)) {
            classMap.set(inst.className, []);
        }
        classMap.get(inst.className).push(inst);
    }

    // 加载已注册类
    const { registeredClasses, registryFile } = loadRegisteredClasses();
    const registeredSet = new Set(registeredClasses);
    console.log(`[扫描] EngineRegistry 已注册类: ${registeredClasses.length} 个`);

    // 构建摘要
    const classSummaries = [];
    for (const [className, instances] of classMap) {
        const files = [...new Set(instances.map(i => i.filePath))];
        const registryInternalCount = instances.filter(i => i.inRegistry).length;
        const bypassCount = instances.length - registryInternalCount;
        classSummaries.push({
            className,
            totalCount: instances.length,
            bypassCount,
            registryInternalCount,
            fileCount: files.length,
            files,
            category: classify(className),
            isRegistered: registeredSet.has(className),
            instances,
        });
    }

    // 按实例化次数降序，相同次数按类名升序
    classSummaries.sort((a, b) => b.totalCount - a.totalCount || a.className.localeCompare(b.className));

    // 统计概览
    const overview = {
        scanTime: new Date().toISOString(),
        projectRoot: PROJECT_ROOT.replace(/\\/g, '/'),
        totalFiles: tsFiles.length,
        totalInstances: allInstances.length,
        totalClasses: classSummaries.length,
        singletonCount: classSummaries.filter(c => c.category === 'singleton').length,
        transientCount: classSummaries.filter(c => c.category === 'transient').length,
        unknownCount: classSummaries.filter(c => c.category === 'unknown').length,
        registeredCount: classSummaries.filter(c => c.isRegistered).length,
        unregisteredCount: classSummaries.filter(c => !c.isRegistered).length,
        multiInstanceCount: classSummaries.filter(c => c.totalCount > 1).length,
        multiInstanceSingletonCount: classSummaries.filter(c => c.totalCount > 1 && c.category === 'singleton').length,
        registeredBypassedCount: classSummaries.filter(c => c.isRegistered && c.bypassCount > 0).length,
    };

    // 生成 JSON 报告
    const jsonReport = {
        overview,
        registeredClasses: { file: registryFile, classes: registeredClasses },
        classes: classSummaries,
    };

    const docsDir = path.join(PROJECT_ROOT, 'docs');
    if (!fs.existsSync(docsDir)) {
        fs.mkdirSync(docsDir, { recursive: true });
    }

    const jsonPath = path.join(docsDir, 'engine-instances-report.json');
    fs.writeFileSync(jsonPath, JSON.stringify(jsonReport, null, 2), 'utf8');
    console.log(`[报告] JSON 报告已生成: ${jsonPath}`);

    // 生成 Markdown 报告
    const md = generateMarkdown(overview, classSummaries, registeredClasses, registryFile);
    const mdPath = path.join(docsDir, 'engine-instances-report.md');
    fs.writeFileSync(mdPath, md, 'utf8');
    console.log(`[报告] Markdown 报告已生成: ${mdPath}`);

    // 生成迁移前基线
    const baseline = generateBaseline(overview, classSummaries, registeredClasses, registryFile);
    const baselinePath = path.join(docsDir, 'engine-registry-governance-baseline.md');
    fs.writeFileSync(baselinePath, baseline, 'utf8');
    console.log(`[基线] 迁移前基线已生成: ${baselinePath}`);

    // 打印摘要
    console.log('\n=== 扫描摘要 ===');
    console.log(`总文件数: ${overview.totalFiles}`);
    console.log(`总实例化数: ${overview.totalInstances}`);
    console.log(`涉及类名数: ${overview.totalClasses}`);
    console.log(`多实例类数 (totalCount > 1): ${overview.multiInstanceCount}`);
    console.log(`多实例单例问题数: ${overview.multiInstanceSingletonCount}`);
    console.log(`已注册但仍被直接实例化（绕过 registry）: ${overview.registeredBypassedCount}`);
    console.log(`已注册到 EngineRegistry 的类: ${overview.registeredCount}`);
    console.log(`未注册的类: ${overview.unregisteredCount}`);

    console.log('\n=== TOP 10 多实例类 ===');
    classSummaries.slice(0, 10).forEach((c, i) => {
        const reg = c.isRegistered ? '已注册' : '未注册';
        const bypass = c.isRegistered && c.totalCount > 1 ? ' [绕过registry]' : '';
        console.log(`${(i + 1).toString().padStart(2)}. ${c.className.padEnd(40)} ${c.totalCount} 次 | ${c.category} | ${reg}${bypass}`);
    });

    console.log('\n=== 优先级分布 ===');
    const p0a = classSummaries.filter(c => !c.isRegistered && c.totalCount > 1 && c.category === 'singleton').length;
    const p0b = classSummaries.filter(c => c.isRegistered && c.bypassCount > 0).length;
    const p1 = classSummaries.filter(c => !c.isRegistered && c.totalCount === 1 && c.category === 'singleton').length;
    const p2 = classSummaries.filter(c => !c.isRegistered && c.totalCount > 1 && c.category === 'unknown').length;
    const p3 = classSummaries.filter(c => c.category === 'transient').length;
    console.log(`P0-A (立即迁移-未注册多实例单例): ${p0a}`);
    console.log(`P0-B (立即修复-已注册但被绕过):     ${p0b}`);
    console.log(`P1   (建议迁移-未注册单实例单例):   ${p1}`);
    console.log(`P2   (评估迁移-多实例不确定):       ${p2}`);
    console.log(`P3   (无需迁移-transient):           ${p3}`);

    console.log('\n[完成] 扫描已结束。');
}

main();
