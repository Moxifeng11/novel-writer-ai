#!/usr/bin/env node
/**
 * check-linked-scenarios.mjs — G7-5：联动场景清单不能与代码脱节
 *
 * `docs/regression/LINKED-SCENARIOS.md` 描述四条跨模块链路的关键入口。
 * 命令改名、文件搬家、函数删除都不会让文档报错，只会让它变成误导。
 * 这里把文档里承诺的锚点做成门禁：缺一个就失败，要求同步更新文档与清单。
 *
 * **2026-11-12 修自证循环（Trae preflight 审计 P2 · 第 17 步）**：
 * 锚点清单原本内嵌在本脚本里——文件搬家时把锚点删掉，检查也跟着消失，门禁永远绿。
 * 现在清单外置到 `scripts/linked-scenarios.anchors.json`，并加了三条防退化：
 * 1. 清单缺失 / 空 / schema 不对 → 失败（不再静默通过）
 * 2. 锚点总数下限棘轮 `floor`：删锚点必须 `--update-floor --note "原因"`
 * 3. 文档小节交叉校验（清单里的链必须在 LINKED-SCENARIOS.md 有对应小节）
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
    ANCHOR_FILE,
    countAnchors,
    evaluateAnchorFloor,
    evaluateAnchors,
    validateAnchorData,
} from './lib/linked-scenarios-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readFile(rel) {
    const full = path.join(ROOT, rel);
    return fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null;
}

const anchorPath = path.join(ROOT, ANCHOR_FILE);

// ── 1. 清单必须存在（缺失即失败，不能因为「读不到」就当作没问题） ─────────
if (!fs.existsSync(anchorPath)) {
    console.error(`❌ 锚点清单不存在：${ANCHOR_FILE}`);
    console.error('   本文件是 check:linked-scenarios 的数据源，缺失会导致门禁空转。');
    process.exit(1);
}

let data;
try {
    data = JSON.parse(fs.readFileSync(anchorPath, 'utf8'));
} catch (error) {
    console.error(`❌ 锚点清单 JSON 解析失败：${error.message}`);
    process.exit(1);
}

// ── 2. 结构校验 ────────────────────────────────────────────────────
const schemaErrors = validateAnchorData(data);
if (schemaErrors.length > 0) {
    console.error('❌ 锚点清单结构非法：');
    for (const item of schemaErrors) console.error(`  - ${item}`);
    process.exit(1);
}

// ── 3. 锚点下限棘轮 ────────────────────────────────────────────────
const total = countAnchors(data);
const floorCheck = evaluateAnchorFloor({ total, floor: data.floor });
const updateFloorIndex = process.argv.indexOf('--update-floor');
if (updateFloorIndex >= 0) {
    const noteIndex = process.argv.indexOf('--note');
    const note = noteIndex >= 0 ? String(process.argv[noteIndex + 1] || '').trim() : '';
    if (!note) {
        console.error('❌ --update-floor 必须提供非空 --note 说明原因');
        process.exit(1);
    }
    data.floor = total;
    fs.writeFileSync(anchorPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    console.log(`✅ 锚点下限已更新为 ${total}（${note}）`);
    process.exit(0);
}
if (!floorCheck.ok) {
    console.error(`❌ ${floorCheck.reason}`);
    process.exit(1);
}
if (floorCheck.tighten) {
    console.log(`ℹ ${floorCheck.reason}（可选：--update-floor --note "原因"）`);
}

// ── 4. 锚点与文档/源码一致性 ────────────────────────────────────────
const { problems, checked, chains, files } = evaluateAnchors({ data, readFile });

if (problems.length > 0) {
    console.error('❌ 联动场景清单与代码不一致：');
    for (const item of problems) console.error(`  - ${item}`);
    console.error(`\n请更新 ${data.doc} 与 ${ANCHOR_FILE} 的锚点清单。`);
    process.exit(1);
}

console.log(`✅ 联动场景清单锚点全部有效（${chains} 条链 / ${checked} 个锚点 / ${files} 个文件，下限 ${data.floor}）`);
