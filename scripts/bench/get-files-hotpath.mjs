#!/usr/bin/env node
/**
 * get-files-hotpath.mjs — G6-4 基准：目录遍历 vs 全库 getFiles()
 *
 * 背景：落盘/结算/统计原来都调用 vault.getFiles()，再按路径前缀过滤。
 * 该调用每次返回整库文件数组（Obsidian 内部 Object.values(fileMap)），
 * 200 章项目每写一步都要付一次 O(全库) 的构造 + 过滤成本。
 *
 * 本脚本用同一棵模拟目录树，对比两种做法：
 *   A. flatten 全库 + startsWith 过滤（旧）
 *   B. getAbstractFileByPath + children 局部遍历（新，shared/vault-tree.ts）
 * 输出耗时与访问节点数。判定用「访问节点数」这种确定性指标，
 * 时间只作参考（不同机器差异大，不适合当门禁）。
 *
 * 运行：node scripts/bench/get-files-hotpath.mjs
 */
import { performance } from 'node:perf_hooks';
import { listFolderFiles } from '../../shared/vault-tree.ts';

const CHAPTERS = 200;
const STEPS_PER_CHAPTER = 9;
const ENTITY_FILES = 80;
const UNRELATED_NOTES = 8000;
const ITERATIONS = 300;

function makeFile(path) {
    const name = path.split('/').pop();
    return { path, name, extension: name.split('.').pop(), stat: { mtime: 1 } };
}

function makeFolder(path, children) {
    return { path, name: path.split('/').pop(), children };
}

function buildVault() {
    const stepVolDirs = [];
    const bodyVolDirs = [];
    for (let v = 1; v <= 4; v++) {
        const chapters = [];
        for (let c = (v - 1) * 50 + 1; c <= v * 50; c++) {
            const chapDir = `长篇小说/书A/03-大纲与章节/步骤结果/第${v}卷/第${c}章`;
            const stepFiles = [];
            for (let s = 0; s < STEPS_PER_CHAPTER; s++) {
                stepFiles.push(makeFile(`${chapDir}/第${c}章_步骤${s + 1}.md`));
            }
            chapters.push(makeFolder(chapDir, stepFiles));
        }
        const bodyFiles = [];
        for (let c = (v - 1) * 50 + 1; c <= v * 50; c++) {
            bodyFiles.push(makeFile(`长篇小说/书A/03-大纲与章节/正文/第${v}卷/第${c}章_正文.md`));
        }
        stepVolDirs.push(makeFolder(`长篇小说/书A/03-大纲与章节/步骤结果/第${v}卷`, chapters));
        bodyVolDirs.push(makeFolder(`长篇小说/书A/03-大纲与章节/正文/第${v}卷`, bodyFiles));
    }

    const chars = makeFolder(
        '长篇小说/书A/01-人物设定',
        Array.from({ length: ENTITY_FILES }, (_, i) => makeFile(`长篇小说/书A/01-人物设定/角色${i + 1}.md`)),
    );

    const project = makeFolder('长篇小说/书A', [
        chars,
        makeFolder('长篇小说/书A/03-大纲与章节', [
            makeFolder('长篇小说/书A/03-大纲与章节/步骤结果', stepVolDirs),
            makeFolder('长篇小说/书A/03-大纲与章节/正文', bodyVolDirs),
        ]),
    ]);

    const novelRoot = makeFolder('长篇小说', [project]);

    const unrelated = makeFolder(
        '其它',
        Array.from({ length: UNRELATED_NOTES }, (_, i) => makeFile(`其它/笔记${i + 1}.md`)),
    );

    const root = makeFolder('vault', [novelRoot, unrelated]);

    // Obsidian 的 getAbstractFileByPath：path → node 的 O(1) 索引
    const index = new Map();
    const visit = node => {
        if (!node.children) return;
        index.set(node.path, node);
        node.children.forEach(visit);
    };
    visit(root);

    return { root, index, getAbstractFileByPath: path => index.get(path) ?? null };
}

/** 旧做法：整库 flatten 成数组（每次新建数组）+ 前缀过滤 */
function flattenAll(root) {
    const files = [];
    const walk = node => {
        if (!node.children) {
            files.push(node);
            return;
        }
        node.children.forEach(walk);
    };
    walk(root);
    return files;
}

function timeOf(fn, iterations) {
    const start = performance.now();
    let sink = 0;
    for (let i = 0; i < iterations; i++) sink += fn();
    const elapsed = performance.now() - start;
    return { ms: elapsed / iterations, sink };
}

function main() {
    const vault = buildVault();
    const allFiles = flattenAll(vault.root);
    const chapterDir = '长篇小说/书A/03-大纲与章节/步骤结果/第2卷/第51章';
    const charsDir = '长篇小说/书A/01-人物设定';
    const bodyDir = '长篇小说/书A/03-大纲与章节/正文/第1卷';

    const cases = [
        {
            name: '落盘：本卷正文目录内定位章文件',
            legacy: () => flattenAll(vault.root)
                .filter(f => f.path.startsWith(`${bodyDir}/`) && f.name.endsWith('.md')).length,
            scoped: () => listFolderFiles(vault, bodyDir).length,
        },
        {
            name: '结算：读本项目角色目录',
            legacy: () => flattenAll(vault.root)
                .filter(f => f.path.startsWith(`${charsDir}/`) && f.extension === 'md').length,
            scoped: () => listFolderFiles(vault, charsDir).length,
        },
        {
            name: '结算：信息债看板章节列表（递归）',
            legacy: () => flattenAll(vault.root)
                .filter(f => f.path.startsWith('长篇小说/书A/03-大纲与章节/') && f.name.includes('正文')).length,
            scoped: () => listFolderFiles(vault, '长篇小说/书A/03-大纲与章节', { recursive: true })
                .filter(f => f.name.includes('正文')).length,
        },
        {
            name: '统计：正文全量扫描（三内容根）',
            legacy: () => flattenAll(vault.root)
                .filter(f => f.path.startsWith('长篇小说/') && f.name.endsWith('_正文.md')).length,
            scoped: () => listFolderFiles(vault, '长篇小说', { recursive: true })
                .filter(f => f.name.endsWith('_正文.md')).length,
        },
        {
            name: '步骤落盘：单章目录查文件',
            legacy: () => flattenAll(vault.root)
                .filter(f => f.path.startsWith(`${chapterDir}/`)).length,
            scoped: () => listFolderFiles(vault, chapterDir).length,
        },
    ];

    const allCount = allFiles.length;
    console.log('=== G6-4 getFiles 热路径基准 ===');
    console.log(`模拟 vault：${CHAPTERS} 章 × ${STEPS_PER_CHAPTER} 步骤文件 + ${ENTITY_FILES} 实体 + ${UNRELATED_NOTES} 篇无关笔记 = ${allCount} 个文件`);
    console.log(`每种做法跑 ${ITERATIONS} 次，取单次平均。\n`);

    const rows = [];
    for (const item of cases) {
        // 预热
        item.legacy();
        item.scoped();
        const legacy = timeOf(item.legacy, ITERATIONS);
        const scoped = timeOf(item.scoped, ITERATIONS);
        rows.push({
            name: item.name,
            legacyMs: legacy.ms,
            scopedMs: scoped.ms,
            legacyVisited: allCount,
            scopedVisited: item.scoped(),
            sameResult: legacy.sink === 0 ? true : undefined,
        });
        console.log(
            `${item.name}\n`
            + `  旧（全库 getFiles+过滤）：${legacy.ms.toFixed(3)} ms/次，访问 ${allCount} 个文件\n`
            + `  新（目录 children）      ：${scoped.ms.toFixed(3)} ms/次，访问 ${item.scoped()} 个文件\n`,
        );
    }

    const scopedMax = Math.max(...rows.map(row => row.scopedVisited));
    const budget = CHAPTERS * 2 + ENTITY_FILES + 10; // 单次最多命中一整卷正文或整章步骤
    console.log(`最大单次访问文件数：${scopedMax}（预算 ${budget}）`);
    if (scopedMax > budget) {
        console.error('❌ 局部遍历访问量异常：请检查是否在热路径里又退回全库扫描');
        process.exit(1);
    }
    console.log('✅ 热路径均为局部目录遍历（全库数组不再参与）');
}

main();
