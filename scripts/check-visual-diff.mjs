#!/usr/bin/env node
/**
 * check-visual-diff.mjs — 视觉基线比对（2026-11-16）
 *
 * 用法：
 *   node scripts/check-visual-diff.mjs <before.json> <after.json> [--tol=1] [--verbose] [--update]
 *
 * 判定（对应规范 §2 的 R1~R3）：
 *   R1 节点路径集合必须一致（DOM 结构不变）
 *   R2 每个节点矩形漂移 ≤ tol（默认 1px）
 *   R3 每个节点计算样式必须完全一致
 *
 * 退出码：0 = 无倒退；1 = 有倒退；2 = 参数/文件问题。
 * 视口或视图宽度不一致时给出警告（几何比较不可靠），并要求 --allow-width-change。
 */
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';

const args = process.argv.slice(2);
const files = args.filter(arg => !arg.startsWith('--'));
const flag = name => args.find(arg => arg.startsWith(`--${name}=`))?.split('=')[1];
const has = name => args.includes(`--${name}`);

if (files.length < 2) {
    console.error('用法: node scripts/check-visual-diff.mjs <before.json> <after.json> [--tol=1] [--verbose] [--update]');
    process.exit(2);
}
const tolerance = Number(flag('tol') ?? 1);
const verbose = has('verbose');

/** 读取快照并做基本校验 */
function load(file) {
    try {
        const data = JSON.parse(readFileSync(file, 'utf8'));
        if (!Array.isArray(data.nodes)) throw new Error('缺少 nodes 数组');
        return data;
    } catch (error) {
        console.error(`❌ 读取失败 ${file}: ${error.message}`);
        process.exit(2);
    }
}

const before = load(files[0]);
const after = load(files[1]);

/** 展开样式字典：节点只存 s（样式索引） */
function stylesOf(snapshot, node) {
    if (node.styles) return node.styles;
    return snapshot.styles?.[node.s] ?? {};
}
const problems = [];
const notes = [];

if (before.leafWidth !== after.leafWidth && !has('allow-width-change')) {
    console.error(`❌ 视图宽度不同（before ${before.leafWidth}px / after ${after.leafWidth}px），几何对比不可靠；` +
        '请把视图调到相同宽度重新采集，或加 --allow-width-change');
    process.exit(2);
}
if (before.viewport?.width !== after.viewport?.width) {
    notes.push(`视口宽度不同（${before.viewport?.width} vs ${after.viewport?.width}）`);
}

const beforeByPath = new Map(before.nodes.map(node => [node.path, node]));
const afterByPath = new Map(after.nodes.map(node => [node.path, node]));

// R1：结构
const removed = [...beforeByPath.keys()].filter(path => !afterByPath.has(path));
const added = [...afterByPath.keys()].filter(path => !beforeByPath.has(path));
for (const path of removed.slice(0, 20)) problems.push(`R1 节点消失: ${path}`);
for (const path of added.slice(0, 20)) problems.push(`R1 新增节点: ${path}`);
if (removed.length > 20) problems.push(`R1 还有 ${removed.length - 20} 个节点消失…`);
if (added.length > 20) problems.push(`R1 还有 ${added.length - 20} 个新增节点…`);

// R2 / R3
let rectDrift = 0;
let styleDrift = 0;
for (const [path, beforeNode] of beforeByPath) {
    const afterNode = afterByPath.get(path);
    if (!afterNode) continue;
    for (const key of ['x', 'y', 'w', 'h']) {
        const delta = Math.abs((afterNode.rect?.[key] ?? 0) - (beforeNode.rect?.[key] ?? 0));
        if (delta > tolerance) {
            rectDrift += 1;
            if (rectDrift <= 20) {
                problems.push(`R2 几何漂移 ${path}.${key}: ${beforeNode.rect?.[key]} → ${afterNode.rect?.[key]}（Δ${delta}px）`);
            }
        }
    }
    const beforeStyles = stylesOf(before, beforeNode);
    const afterStyles = stylesOf(after, afterNode);
    const styleKeys = new Set([...Object.keys(beforeStyles), ...Object.keys(afterStyles)]);
    for (const key of styleKeys) {
        const a = beforeStyles[key];
        const b = afterStyles[key];
        if (a !== b) {
            styleDrift += 1;
            if (styleDrift <= 20) problems.push(`R3 样式变化 ${path}.${key}: ${a} → ${b}`);
        }
    }
    if ((beforeNode.textLen ?? 0) !== (afterNode.textLen ?? 0)) {
        problems.push(`R4 文本长度变化 ${path}: ${beforeNode.textLen} → ${afterNode.textLen}`);
    }
}

console.log('=== 视觉基线比对 ===');
console.log(`before: ${before.module ?? '?'} 节点 ${before.nodes.length}（${before.capturedAt ?? '?'}）`);
console.log(`after : ${after.module ?? '?'} 节点 ${after.nodes.length}（${after.capturedAt ?? '?'}）`);
console.log(`容差: ${tolerance}px；结构差异 ${removed.length + added.length}；几何差异 ${rectDrift}；样式差异 ${styleDrift}`);
for (const note of notes) console.log(`⚠️ ${note}`);

if (problems.length === 0) {
    console.log('✅ 无视觉倒退（R1 结构 / R2 几何 / R3 样式 / R4 文本 全部一致）');
    if (has('update')) {
        copyFileSync(files[1], files[0]);
        console.log(`✅ 已用 after 覆盖基线: ${files[0]}`);
    }
    process.exit(0);
}

for (const problem of problems) console.error(`  - ${problem}`);
if (verbose) {
    console.error(`\n共 ${problems.length} 条差异；如为有意改动，确认后用 --update 更新基线并写明原因。`);
}
console.error('\n=== 检查失败：存在视觉倒退 ===');
process.exit(1);
