#!/usr/bin/env node
/**
 * check-hotpath-scans.mjs — G6-4：热路径不得退回全库扫描
 *
 * 落盘、结算、字数统计每写一章会跑很多次；一次 vault.getFiles() 就是
 * 整库文件数组的构造，且随用户其它笔记数量线性变慢。getMarkdownFiles()
 * 与 getAllLoadedFiles() 同样是 O(全库)，只是多/少一层过滤，一并禁止。
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
    'shared/entity-reader.ts',
    'engine/analysis-report-engine.ts',
    'services/writing-stats-service.ts',
    'ui/continue-chapters-modal.ts',
    // 每章断点续跑 / 每次质量刷新都会调用的 UI 侧热路径（第 21 轮接入）
    'ui/full-writer/batch-pipeline-runner.ts',
    'ui/cowrite/realtime-quality-controller.ts',
    // 工作台阶段面板每次刷新都会整包采集（第 60 轮接入，第 59 轮已把导出检查改为目录局部遍历）
    'ui/full-writer/creation-flow-state.ts',
];

/** 去掉注释，避免把说明文字当成调用 */
function stripComments(source) {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

// 三种 API 都会构造整库文件数组（getMarkdownFiles 只是多一层扩展名过滤，仍是 O(全库)），
// 热路径一律禁止；只查 getFiles() 会给「换成 getMarkdownFiles 规避门禁」留后门。
const FULL_SCAN_APIS = [
    { pattern: /\bgetFiles\s*\(/, name: 'vault.getFiles()', hint: '请改用 listFolderFiles/listChapterBodyFiles' },
    { pattern: /\bgetMarkdownFiles\s*\(/, name: 'vault.getMarkdownFiles()', hint: '请先用 getAbstractFileByPath + children 限定目录' },
    { pattern: /\bgetAllLoadedFiles\s*\(/, name: 'vault.getAllLoadedFiles()', hint: '请先用 getAbstractFileByPath + children 限定目录' },
];

const offenders = [];
for (const rel of HOT_FILES) {
    const file = path.join(ROOT, rel);
    if (!fs.existsSync(file)) {
        offenders.push(`${rel}（文件不存在：热路径清单需要更新）`);
        continue;
    }
    const source = stripComments(fs.readFileSync(file, 'utf8'));
    const lines = source.split('\n');
    for (const api of FULL_SCAN_APIS) {
        const index = lines.findIndex(text => api.pattern.test(text));
        if (index < 0) continue;
        offenders.push(`${rel}:${index + 1} 调用了 ${api.name}，${api.hint}`);
        break;
    }
}

if (offenders.length > 0) {
    console.error('❌ 热路径出现全库扫描：');
    for (const item of offenders) console.error(`  - ${item}`);
    process.exit(1);
}

console.log(`✅ 热路径 0 次全库扫描（getFiles/getMarkdownFiles/getAllLoadedFiles，${HOT_FILES.length} 个模块）`);
