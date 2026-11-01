#!/usr/bin/env node
/**
 * check-hotpath-scans.mjs — G6-4：热路径不得退回全库 getFiles()
 *
 * 落盘、结算、字数统计每写一章会跑很多次；一次 vault.getFiles() 就是
 * 整库文件数组的构造，且随用户其它笔记数量线性变慢。
 * 这些路径必须走 shared/vault-tree.ts 的目录遍历（getAbstractFileByPath + children）。
 *
 * 新增热路径模块时把它加进 HOT_FILES，并在文件里保留「为什么不能全库扫」的注释。
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 说明：engine/context-manager.ts 与 ui/cross-volume-state-modal.ts 各保留一处
// 「发现所有项目」的全库扫描（含旧版根目录布局），属冷路径，不在清单内。
// engine/context-manager.ts 只保留 detectProjects 一处全库扫描——
// 它的职责就是「发现所有项目（含旧版根目录布局）」，属于冷路径，不在清单内。
const HOT_FILES = [
    'engine/settlement-engine.ts',
    'engine/step-result-saver.ts',
    'engine/chapter-utils.ts',
    'engine/knowledge-usage.ts',
    'engine/analysis-report-engine.ts',
    'services/writing-stats-service.ts',
    'ui/continue-chapters-modal.ts',
    'ui/full-writer/outline-tree-controller.ts',
];

/** 去掉注释，避免把说明文字当成调用 */
function stripComments(source) {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const offenders = [];
for (const rel of HOT_FILES) {
    const file = path.join(ROOT, rel);
    if (!fs.existsSync(file)) {
        offenders.push(`${rel}（文件不存在：热路径清单需要更新）`);
        continue;
    }
    const source = stripComments(fs.readFileSync(file, 'utf8'));
    if (/\bgetFiles\s*\(/.test(source)) {
        const line = source.split('\n').findIndex(text => /\bgetFiles\s*\(/.test(text)) + 1;
        offenders.push(`${rel}:${line} 调用了 vault.getFiles()，请改用 listFolderFiles/listChapterBodyFiles`);
    }
}

if (offenders.length > 0) {
    console.error('❌ 热路径出现全库扫描：');
    for (const item of offenders) console.error(`  - ${item}`);
    process.exit(1);
}

console.log(`✅ 热路径 0 次全库 getFiles()（${HOT_FILES.length} 个模块）`);
