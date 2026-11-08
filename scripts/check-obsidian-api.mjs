#!/usr/bin/env node
/**
 * check-obsidian-api.mjs — Obsidian 插件缺陷类静态门禁（v4.76.0）
 *
 * 为什么存在：`check:any` 管类型、`check:bundle` 管体积、`check:inline-styles` 管样式，
 * 但没有一条管「Obsidian API 用法」。以下缺陷类能过全部现有门禁，却会被官方审查打回、
 * 或在 1.4.x / 移动端 / 第二窗口 / 自定义配置目录上静默失效：
 *
 *  1. plugin-path-hardcoded     插件数据目录硬编码（用户改 configDir 或 BRAT 改名即写错位置）
 *  2. deprecated-api            晚于 minAppVersion 1.4.0 的 API / 已弃用 API
 *  3. direct-fetch              非流式 HTTP 未走 requestUrl（移动端无 CORS 豁免）
 *  4. global-document-listener  document 级监听（需成对移除；新处必须显式登记）
 *  5. console-direct            运行时直接 console.*（统一走 shared/logger）
 *
 * 语义：棘轮 —— 违规数只允许下降。基线见 `.obsidian-api-baseline.json`；
 * 新增违规（含「换个文件继续违规」）会让门禁失败。确认要增加的，必须
 * `--update-baseline` 并在 note 里写清理由。
 *
 * 用法：
 *   node scripts/check-obsidian-api.mjs                     # 校验
 *   node scripts/check-obsidian-api.mjs --update-baseline --note "…"
 *   node scripts/check-obsidian-api.mjs --json              # 机器可读
 *   node scripts/check-obsidian-api.mjs --root <dir> --baseline <file>   # 测试夹具
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(SCRIPT_DIR, '..');
const BASELINE_FILE = '.obsidian-api-baseline.json';
const SCAN_DIRS = ['main.ts', 'ui', 'core', 'engine', 'services', 'shared', 'domains'];
const SKIP_DIRS = new Set(['node_modules', 'docs', 'scripts', 'tests', '.git', 'coverage', 'dist']);

/**
 * 规则：pattern 命中即违规；allow 是「合法例外」的路径前缀/文件名清单。
 * 注释行（纯注释）不参与扫描——文档里提到 API 名不应算违规。
 */
const RULES = [
    {
        id: 'plugin-path-hardcoded',
        description: '插件根/数据目录必须经 shared/paths 单源派生（setPluginRootDir / pluginDataDir）',
        pattern: /\.obsidian\/plugins\/novel-writer-ai|plugins\/novel-writer-ai'/,
        allow: ['shared/paths.ts', 'shared/changelog-data.ts'],
    },
    {
        id: 'deprecated-api',
        description: '晚于 minAppVersion 1.4.0 的 API 或已弃用 API',
        // v4.79.0：补「强转绕过」形态——(app as unknown as { isMobile?: boolean }).isMobile
        pattern: /MarkdownRenderer\.renderMarkdown|Vault\.getAllFolders|getAllFolders\(|setCssProps|app\.isMobile|\{\s*isMobile\?\s*:/,
        allow: ['shared/file-system-port.ts', 'shared/changelog-data.ts'],
    },
    {
        id: 'direct-fetch',
        description: '非流式 HTTP 必须 requestUrl（移动端 fetch 无 CORS 豁免）；流式 SSE 才允许 fetch',
        pattern: /await fetch\(/,
        allow: [
            'engine/ai-api-stream.ts',
            'engine/ai-api-client.ts',
            'engine/embedding/',
            'engine/co-writer/local-model-utils.ts',
            'services/local-model-probe.ts',
        ],
    },
    {
        id: 'global-document-listener',
        description: 'document 级监听需在 onClose/destroy 成对移除；popout 窗口下应使用 ownerDocument',
        // v4.79.0：registerDomEvent(document|window, ...) 与 addEventListener 等价，此前漏检
        pattern: /document\.addEventListener\(|registerDomEvent\(\s*(document|window)\s*,/,
        allow: [],
    },
    {
        id: 'console-direct',
        description: '运行时不得直接 console.*，统一走 shared/logger',
        pattern: /console\.(log|debug|info|warn|error)/,
        // 白名单是 console 的合法出口：logger sink 本身 + store 中间件（%c 样式化调试，
        // 有 5 条单测断言精确参数；换 logger 会丢样式且默认 warn 级别下静默）
        allow: ['shared/logger.ts', 'shared/store/middleware/logger.ts'],
    },
];

function parseArgs(argv) {
    const args = { update: false, json: false, note: '', root: DEFAULT_ROOT, baseline: null };
    for (let i = 0; i < argv.length; i++) {
        const item = argv[i];
        if (item === '--update-baseline') args.update = true;
        else if (item === '--json') args.json = true;
        else if (item === '--note') args.note = argv[++i] || '';
        else if (item === '--root') args.root = path.resolve(argv[++i] || DEFAULT_ROOT);
        else if (item === '--baseline') args.baseline = path.resolve(argv[++i]);
    }
    if (!args.baseline) args.baseline = path.join(args.root, BASELINE_FILE);
    return args;
}

function walk(entry, root, out) {
    const abs = path.join(root, entry);
    if (!fs.existsSync(abs)) return;
    const stat = fs.statSync(abs);
    if (stat.isFile()) {
        if (abs.endsWith('.ts') && !abs.endsWith('.d.ts')) out.push(abs);
        return;
    }
    if (SKIP_DIRS.has(path.basename(abs))) return;
    for (const name of fs.readdirSync(abs)) {
        walk(path.join(entry, name), root, out);
    }
}

function isCommentLine(line) {
    const trimmed = line.trim();
    return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
}

function collectViolations(root) {
    const files = [];
    for (const entry of SCAN_DIRS) walk(entry, root, files);

    const report = {};
    for (const rule of RULES) report[rule.id] = { count: 0, files: {}, samples: [] };

    for (const abs of files.sort()) {
        const rel = path.relative(root, abs).split(path.sep).join('/');
        const lines = fs.readFileSync(abs, 'utf8').split('\n');
        lines.forEach((line, idx) => {
            if (isCommentLine(line)) return;
            for (const rule of RULES) {
                if (rule.allow.some((prefix) => rel === prefix || rel.startsWith(prefix))) continue;
                if (!rule.pattern.test(line)) continue;
                const entry = report[rule.id];
                entry.count += 1;
                entry.files[rel] = (entry.files[rel] || 0) + 1;
                if (entry.samples.length < 5) entry.samples.push(`${rel}:${idx + 1}`);
            }
        });
    }
    return { files: files.length, report };
}

function loadBaseline(file) {
    if (!fs.existsSync(file)) return null;
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        return null;
    }
}

function compare(report, baseline) {
    const problems = [];
    for (const rule of RULES) {
        const current = report[rule.id];
        const base = baseline?.rules?.[rule.id];
        if (!base) {
            // 无基线条目：任何违规都算新增（首次请 --update-baseline 建基线）
            if (current.count > 0) {
                problems.push(`[${rule.id}] 无基线条目，但存在 ${current.count} 处违规（${current.samples.join('、')}）`);
            }
            continue;
        }
        if (current.count > base.count) {
            const newFiles = Object.keys(current.files).filter((file) => !(file in (base.files || {})));
            problems.push(
                `[${rule.id}] 违规 ${base.count} → ${current.count}（+${current.count - base.count}）` +
                (newFiles.length ? `；新增文件：${newFiles.join('、')}` : ''),
            );
        }
    }
    return problems;
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    const { files, report } = collectViolations(args.root);
    const baseline = loadBaseline(args.baseline);

    if (args.json) {
        console.log(JSON.stringify({ scanned: files, rules: report }, null, 2));
        return 0;
    }

    if (args.update) {
        const payload = {
            generatedAt: new Date().toISOString(),
            note: args.note || '（未填写说明）',
            rules: Object.fromEntries(RULES.map((rule) => [rule.id, {
                count: report[rule.id].count,
                files: report[rule.id].files,
            }])),
        };
        fs.writeFileSync(args.baseline, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
        const total = RULES.reduce((sum, rule) => sum + report[rule.id].count, 0);
        console.log(`✅ 已写入基线: ${path.relative(args.root, args.baseline)}（${total} 处 / ${files} 文件）`);
            for (const rule of RULES) {
            console.log(`   ${rule.id}: ${report[rule.id].count}`);
        }
        return 0;
    }

    console.log('=== Obsidian API 用法门禁 ===');
    for (const rule of RULES) {
        const entry = report[rule.id];
        const base = baseline?.rules?.[rule.id]?.count ?? 0;
        const flag = entry.count > base ? '❌' : '✅';
        console.log(`${flag} ${rule.id}: ${entry.count}（基线 ${base}）— ${rule.description}`);
    }

    const problems = compare(report, baseline);
    if (problems.length > 0) {
        console.error('\n❌ 出现新增违规（棘轮只允许下降）：');
        for (const problem of problems) console.error(`  - ${problem}`);
        console.error('\n  修法：改用 shared/paths 单源、requestUrl、shared/logger、成对移除监听；');
        console.error('  确需增加的，运行 --update-baseline 并在 note 写清理由。');
        return 1;
    }
    console.log('\n✅ Obsidian API 用法门禁通过（无新增违规）');
    return 0;
}

process.exitCode = main();
