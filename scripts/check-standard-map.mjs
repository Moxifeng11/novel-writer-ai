#!/usr/bin/env node
/**
 * check-standard-map.mjs — 开发规矩文档与门禁脚本的完整性门禁
 *
 * 为什么需要：本项目历史上出现过「文档承诺了门禁，但门禁并不校验」（docs/README 声称
 * 新增文档必须登记否则失败，实际只校验 handbook/adr/glossary）；也出现过规矩散落
 * 多份文档互相矛盾。规矩文档一旦不随门禁同步，就会腐化成误导后续开发的过期结论。
 *
 * 校验四件事：
 *  1. package.json 里每个门禁脚本都登记在 docs/STANDARD.md §三 门禁表（漏登记 = 失败）
 *  2. 门禁表里写的每个脚本都真实存在（幽灵门禁 = 失败）
 *  3. 必备章节骨架存在（元规则/规矩清单/验收标准/门禁总表/豁免机制）
 *  4. §三 引用的规则 ID 在 §一 有定义（拼写漂移 = 失败）
 *
 * 只报告、不阻断的项：定义了但门禁表未引用的规则（可能是纯人工评审规矩）。
 *
 * 用法：node scripts/check-standard-map.mjs [--json]
 * 退出码：0 通过 / 1 失败 / 2 前置缺失
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
    collectGateScripts,
    parseGateTable,
    extractDefinedRules,
    findMissingSections,
    diffGateMapping,
} from './lib/standard-map-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STANDARD_PATH = path.join(ROOT, 'docs', 'STANDARD.md');
const AS_JSON = process.argv.slice(2).includes('--json');

if (!fs.existsSync(STANDARD_PATH)) {
    console.error('[standard-map] ❌ 缺少 docs/STANDARD.md（开发规矩与验收标准的唯一口径）');
    process.exit(2);
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const markdown = fs.readFileSync(STANDARD_PATH, 'utf8');

const pkgGates = collectGateScripts(pkg.scripts);
const docRows = parseGateTable(markdown);
const definedRules = extractDefinedRules(markdown);
const missingSections = findMissingSections(markdown);
const diff = diffGateMapping({ pkgGates, docRows, definedRules });

const problems = [];
if (missingSections.length > 0) {
    problems.push(`缺少必备章节：${missingSections.join('、')}（标准文档被削薄到无法自证）`);
}
for (const g of diff.missingInDoc) {
    problems.push(`门禁未登记：\`${g}\` 存在于 package.json 但未出现在 §三 门禁表（新增门禁必须登记规矩归属）`);
}
for (const g of diff.missingInPkg) {
    problems.push(`幽灵门禁：§三 表格登记了 \`${g}\`，但 package.json 中没有该脚本`);
}
for (const { gate, rule } of diff.unknownRules) {
    problems.push(`规则引用失效：门禁表 \`${gate}\` 引用了 ${rule}，但 §一 规矩清单里没有定义（拼写漂移？）`);
}
if (diff.missingInDoc.length === 0 && docRows.length === 0) {
    problems.push('§三 门禁表解析为空（表格格式可能被改坏：应为 | `门禁` | 规矩 | 时机 |）');
}
if (definedRules.length === 0) {
    problems.push('§一 未解析到任何规则 ID（规则行首列应为 R-XX）');
}

if (AS_JSON) {
    console.log(JSON.stringify({ ok: problems.length === 0, pkgGates, docRows, definedRules, diff, problems }, null, 2));
} else {
    console.log(`=== 开发规矩 ↔ 门禁 完整性 ===`);
    console.log(`门禁脚本（package.json）: ${pkgGates.length} 个`);
    console.log(`门禁表登记: ${docRows.length} 行 / 规则定义: ${definedRules.length} 条`);
    if (diff.undocumentedRulesInTable.length > 0) {
        console.log(`ℹ️ 仅人工评审（未绑定门禁）的规矩 ${diff.undocumentedRulesInTable.length} 条：${diff.undocumentedRulesInTable.join(' ')}`);
    }
    if (problems.length === 0) {
        console.log('✅ 规矩文档与门禁双向完整，章节与规则引用一致');
    } else {
        console.error('\n❌ 开发规矩文档与门禁不一致：');
        for (const p of problems) console.error(`  - ${p}`);
        console.error('\n修法：改 docs/STANDARD.md（§一 加规则 / §三 登记门禁），或同步 package.json。'
            + '不要改本脚本以绕过。');
    }
}

process.exit(problems.length === 0 ? 0 : 1);
