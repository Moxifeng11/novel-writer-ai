#!/usr/bin/env node
/**
 * check-relationship-authority.mjs — 关系数据权威源契约检查
 *
 * 决策：docs/design/g1-authority-decisions.md §1.3
 * 关系数值/状态的唯一权威源是 `01-世界架构/关系状态.md`（V2）；
 * 实体卡「与其他角色的互信息」只允许作为人读日志被写入，不得被任何代码解析。
 *
 * 做法（保守但可执行）：`互信息` 分节字符串只允许出现在下列白名单文件里。
 * - settlement-engine：写入方（追加/去重）
 * - ai-character-generator / ai-entity-generator：提示词模板（要求 AI 产出该分节）
 * 新增文件若要提到该分节，必须先在 ADR 里说明理由并加入白名单。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const MARKER = /与其他(角色|元素)的互信息/;
const ALLOWED = new Set([
    // 写入方（追加 + 整行去重）
    'engine/settlement-engine.ts',
    // 提示词模板：要求 AI 产出该分节
    'engine/ai-character-generator.ts',
    'engine/ai-entity-generator.ts',
    'ui/ai-builder-modal.ts',
    // 模板正文 / 分节标题常量 / 短标题→长标题映射（只描述结构，不解析数值）
    'shared/entity-templates.ts',
    'shared/format-constants.ts',
    'shared/template-scaffold-assets.generated.ts',
]);
const EXCLUDE_DIRS = new Set(['node_modules', 'tests', '.git', '.trae', 'dist', 'build', 'coverage', 'scripts']);

function walk(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (EXCLUDE_DIRS.has(entry.name)) continue;
            walk(path.join(dir, entry.name), out);
        } else if (entry.isFile() && entry.name.endsWith('.ts')) {
            out.push(path.join(dir, entry.name));
        }
    }
    return out;
}

const violations = [];
for (const file of walk(root)) {
    const rel = path.relative(root, file).replace(/\\/g, '/');
    if (ALLOWED.has(rel)) continue;
    const content = fs.readFileSync(file, 'utf8');
    if (MARKER.test(content)) violations.push(rel);
}

if (violations.length > 0) {
    console.error('[check:relationship-authority] ❌ 以下文件引用了「互信息」分节，但不在白名单：');
    for (const rel of violations) console.error(`  - ${rel}`);
    console.error('关系数值只能从 relationship-engine 的 loadRelationshipStates 读取（见 docs/design/g1-authority-decisions.md）。');
    console.error('如确需写入该分节，请更新 ADR 并把它加入本脚本 ALLOWED。');
    process.exit(1);
}

console.log('[check:relationship-authority] ✅ 互信息分节仅出现在白名单写入方/模板中');
