#!/usr/bin/env node
/**
 * check-linked-scenarios.mjs — G7-5：联动场景清单不能与代码脱节
 *
 * docs/regression/LINKED-SCENARIOS.md 描述四条跨模块链路的关键入口。
 * 命令改名、文件搬家、函数删除都不会让文档报错，只会让它变成误导。
 * 这里把文档里承诺的锚点做成门禁：缺一个就失败，要求同步更新文档与清单。
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** kind: 'file' 存在即可；'text' 还要求文件内容包含 pattern */
const ANCHORS = {
    '链 1 · 生成→质控→修订→结算→导出': [
        { file: 'shared/command-ids.ts', text: "'novel-writer-batch-novels'", why: '批量生成命令（现行入口）' },
        { file: 'shared/command-ids.ts', text: "'novel-writer-batch-chapters'", why: '批量生成命令（兼容入口）' },
        { file: 'shared/command-ids.ts', text: "'novel-writer-chapter-settlement'", why: '章节结算命令' },
        { file: 'shared/command-ids.ts', text: "'novel-writer-export-manuscript'", why: '成稿导出命令' },
        { file: 'engine/settlement-engine.ts', why: '结算引擎' },
        { file: 'engine/step-result-saver.ts', why: '步骤落盘' },
        { file: 'engine/step-runner.ts', text: 'writeFixToBody', why: '修订稿回写正文' },
        { file: 'engine/export/manuscript-compiler.ts', why: '成稿编译（EPUB/DOCX/TXT）' },
        { file: 'ui/export-manuscript-modal.ts', text: 'formatExportPrecheck', why: '导出前质量门槛' },
        { file: 'tests/unit/engine/settlement-engine-behavior.test.ts', why: '结算行为（成功/幂等/回滚）' },
        { file: 'tests/unit/engine/settlement-mode.test.ts', why: '轻结算语义' },
        { file: 'tests/unit/shared/export-precheck.test.ts', why: '导出提示文案' },
        { file: 'tests/e2e/obsidian-plugin.spec.ts', text: '短篇：创建后落在创作流程页', why: '三模式 E2E 旅程' },
    ],
    '链 2 · 知识库→检索→注入→归因→统计': [
        { file: 'engine/rag/retrieval-service.ts', text: 'export async function retrieve', why: '检索引擎' },
        { file: 'engine/knowledge-injector.ts', text: 'ragSink', why: '注入来源上报' },
        { file: 'engine/step-result-saver.ts', text: 'ragSources', why: 'rag_sources 落盘' },
        { file: 'engine/knowledge-usage.ts', text: 'collectKnowledgeUsage', why: '使用统计' },
        { file: 'shared/rag-sources.ts', text: 'pushRagSource', why: '来源去重/上限' },
        { file: 'tests/integration/linked-scenarios.test.ts', text: 'injectKnowledgeBase', why: '链路集成用例（注入侧）' },
        { file: 'tests/integration/linked-scenarios.test.ts', text: 'collectKnowledgeUsage', why: '链路集成用例（统计侧）' },
    ],
    '链 3 · 三模式创建→内容结构→单元写作': [
        { file: 'domains/kernel/domain-project-factory.ts', why: '领域项目工厂' },
        { file: 'shared/mode-content.ts', text: 'SHORT_CONTENT_ROOT', why: '短篇内容根' },
        { file: 'shared/mode-content.ts', text: 'SCRIPT_CONTENT_ROOT', why: '剧本内容根' },
        { file: 'shared/command-mode-rules.ts', text: 'COMMAND_MODE_RULES', why: '命令模式守卫' },
        { file: 'tests/unit/domains/domain-project-factory.test.ts', text: '回滚', why: '创建失败回滚' },
    ],
    '链 4 · Agent 阶段引导→商业化导出检查': [
        { file: 'shared/creation-flow.ts', text: 'resolveCreationFlow', why: '三模式阶段唯一事实源' },
        { file: 'ui/agent-workbench/stage-panel.ts', text: 'buildStagePanelModel', why: '工作台阶段面板投影' },
        { file: 'shared/publication-profile.ts', text: 'checkPublicationReadiness', why: '商业化出版检查' },
        { file: 'ui/export-manuscript-modal.ts', text: 'strictPublication', why: '导出严格模式开关' },
        { file: 'scripts/check-automation.mjs', text: 'trae-loop-state.json', why: '自动化一致性门禁' },
        { file: 'tests/unit/ui/agent-stage-panel.test.ts', why: '阶段面板用例' },
        { file: 'tests/unit/shared/publication-profile.test.ts', why: '出版检查用例' },
    ],
};

const DOC = 'docs/regression/LINKED-SCENARIOS.md';

function readFile(rel) {
    const full = path.join(ROOT, rel);
    return fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null;
}

const problems = [];

if (!readFile(DOC)) {
    problems.push(`${DOC} 不存在（联动清单被删除？）`);
} else {
    const doc = readFile(DOC);
    for (const chain of Object.keys(ANCHORS)) {
        // 只校验编号小节存在：标题措辞可以改，链的编号不能丢
        const num = chain.match(/链 (\d)/)?.[1];
        if (!num || !doc.includes(`## 链 ${num}：`)) {
            problems.push(`${DOC} 缺少「## 链 ${num}：」小节`);
        }
    }
}

let checked = 0;
for (const [chain, anchors] of Object.entries(ANCHORS)) {
    for (const anchor of anchors) {
        checked++;
        const content = readFile(anchor.file);
        if (content === null) {
            problems.push(`${chain}｜${anchor.file} 不存在（${anchor.why}）`);
            continue;
        }
        if (anchor.text && !content.includes(anchor.text)) {
            problems.push(`${chain}｜${anchor.file} 不再包含「${anchor.text}」（${anchor.why}）`);
        }
    }
}

if (problems.length > 0) {
    console.error('❌ 联动场景清单与代码不一致：');
    for (const item of problems) console.error(`  - ${item}`);
    console.error(`\n请更新 ${DOC} 与 scripts/check-linked-scenarios.mjs 的锚点清单。`);
    process.exit(1);
}

console.log(`✅ 联动场景清单锚点全部有效（${Object.keys(ANCHORS).length} 条链 / ${checked} 个锚点）`);
