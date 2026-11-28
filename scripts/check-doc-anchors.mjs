#!/usr/bin/env node
/**
 * check-doc-anchors.mjs — 活文档锚点校验门禁
 *
 * 规矩（2026-11-28 固化）：固化文档（*-flow / *-map / *-reference / *-guide）
 * 必须随软件优化同步更新——后续优化读到过期结论会造成设计偏移。
 * 本门禁把「随码更新」变成强制项：
 *   - 代码改动删了/挪了活文档里引用的文件 → 门禁拦
 *   - 设置接口删了/改名了活文档里登记的字段 → 门禁拦
 * 修法只有一条：同步更新文档（或把过期的固化文档降级为历史快照改名）。
 * 历史审计报告（*-audit.md）是时间点快照，允许过期，不校验。
 *
 * 用法：node scripts/check-doc-anchors.mjs（exit 0 全锚点有效 / 1 有失锚）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isLivingDoc, extractPathAnchors, extractSettingsFieldAnchors, verifyAnchors } from './lib/doc-anchors-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AUDIT_DIR = path.join(ROOT, 'docs', 'audits');

if (!fs.existsSync(AUDIT_DIR)) {
    console.error('[doc-anchors] ❌ docs/audits 目录不存在');
    process.exit(2);
}

const docs = fs.readdirSync(AUDIT_DIR).filter(f => f.endsWith('.md') && isLivingDoc(f));
if (docs.length === 0) {
    console.log('[doc-anchors] ✅ 当前无活文档（*-flow/*-map/*-reference/*-guide）');
    process.exit(0);
}

// 设置字段存在性验证语料：settings 默认值 + 主接口
const repoTextSources = [
    path.join(ROOT, 'core', 'settings-service.ts'),
    path.join(ROOT, 'main.ts'),
    path.join(ROOT, 'shared', 'deconstruction-settings.ts'),
];
let repoText = '';
for (const f of repoTextSources) {
    if (fs.existsSync(f)) repoText += fs.readFileSync(f, 'utf8') + '\n';
}

let failed = 0;
for (const doc of docs.sort()) {
    const full = path.join(AUDIT_DIR, doc);
    const content = fs.readFileSync(full, 'utf8');
    const anchors = {
        paths: extractPathAnchors(content),
        // 设置字段锚点只对设置底账启用（其它活文档的反引号标识符不是设置字段）
        fields: /settings/.test(doc) ? extractSettingsFieldAnchors(content) : [],
    };
    const ctx = {
        fileExists: (p) => fs.existsSync(path.join(ROOT, p)),
        repoText,
    };
    const { missingPaths, missingFields } = verifyAnchors(anchors, ctx);
    const ok = missingPaths.length === 0 && missingFields.length === 0;
    if (ok) {
        console.log(`[doc-anchors] ✅ ${doc}（路径 ${anchors.paths.length} / 字段 ${anchors.fields.length} 个锚点全部有效）`);
        continue;
    }
    failed++;
    console.error(`[doc-anchors] ❌ ${doc} 有失锚引用（文档结论已过期，必须同步更新）：`);
    for (const p of missingPaths) {
        const deleted = /已删除|已移除|删除/.test(content.split('\n').find(l => l.includes(p)) || '') ;
        const hint = deleted ? '（文中已注明已删除——改写为不引用路径的表述，或标注历史快照）' : '（文件被移动/改名/删除）';
        console.error(`   - 路径失锚: \`${p}\` ${hint}`);
    }
    for (const f of missingFields) {
        console.error(`   - 字段失锚: \`${f}\`（settings 接口/默认值中不存在——字段改名或移除后未同步文档）`);
    }
}

if (failed > 0) {
    console.error(`[doc-anchors] ❌ ${failed} 份活文档失锚。固化文档必须随软件优化而更新——同步文档，或将过期文档改名降级为历史快照（如 *-snapshot.md）。`);
    process.exit(1);
}
console.log('[doc-anchors] ✅ 全部活文档锚点有效');
