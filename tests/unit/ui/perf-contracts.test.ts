/**
 * 性能契约（G6-8/9/10）——源码级回归，防止优化被后续改动悄悄退回
 *
 * 这些点没有纯函数可测（依赖 App/调度器），但退化会立刻重新引入全库扫描 /
 * 整块重建，因此在源码层锁定关键结构。
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('G6-8 伏笔刷新只刷当前项目且防抖', () => {
    const src = read('main.ts');

    it('modify 事件不再直接调用全量 refreshInfoDebt', () => {
        const handlerStart = src.indexOf("this.app.vault.on('modify'");
        expect(handlerStart).toBeGreaterThan(-1);
        const handlerBody = src.slice(handlerStart, handlerStart + 1200);
        expect(handlerBody).toContain('debounceFixed(`info-debt:${project}`');
        expect(handlerBody).not.toContain('this._foreshadowManager.refreshInfoDebt()');
    });

    it('防抖后只刷新被修改的项目', () => {
        expect(src).toContain('generateInfoDebtBoard(project)');
    });
});

describe('G6-9 写章前文摘要一次快照 + 窗口上限', () => {
    const src = read('ui/write-chapter-modal.ts');

    it('循环外只取一次文件快照', () => {
        expect(src).toContain('const allFiles = app.vault.getFiles();');
        expect(src).toContain('for (let n = summaryStart; n < chapNum; n++)');
        expect(src).toContain('PREV_SUMMARY_WINDOW = 40');
    });

    it('循环内使用快照而不是重复全库扫描', () => {
        expect(src).toContain("findChapterFile(allFiles, prevDir, '大纲摘要')");
        expect(src).toContain("findChapterFile(allFiles, prevDir, '分析报告')");
        expect(src).toContain('prevBody = allFiles.find(');
    });

    it('摘要总预算有上限', () => {
        expect(src).toContain('prevChaptersSummary.length > 12000');
    });
});

describe('G6-10 拆解监控局部更新', () => {
    const src = read('ui/knowledge-monitor-modal.ts');

    it('动态节点带 stable data 标记', () => {
        for (const key of ['total-text', 'total-bar', 'dim-label', 'dim-text', 'dim-bar', 'message']) {
            expect(src).toContain(`'data-nw-progress': '${key}'`);
        }
        expect(src).toContain("'data-nw-task-id': currentTask.id");
    });

    it('定时刷新只在任务/状态变化时重建 DOM', () => {
        const start = src.indexOf('private updateCurrentTab');
        const end = src.indexOf('private patchProgressNode', start);
        expect(start).toBeGreaterThan(-1);
        expect(end).toBeGreaterThan(start);
        const body = src.slice(start, end);
        // 仅在 sameTask 为 false 时走 renderCurrentTab
        expect(body).toContain('if (!sameTask)');
        expect(body).toContain('this.renderCurrentTab(tabContent);');
        // 常规路径只改文字/宽度
        expect(body).toContain('patchProgressNode');
        expect(body).toContain('patchProgressWidth');
    });
});

describe('PF-1 知识向量库预热不阻塞 onload', () => {
    const src = read('engine/engine-registry.ts');

    it('onload 关键路径不再 await 向量库 init', () => {
        // init() 只是预热，查询路径自带 ensureLoaded()；串行读数 MB JSON
        // 会推迟命令/Ribbon/视图注册。
        expect(src).not.toContain('await knowledgeVectorStore.init()');
        expect(src).toContain('workspace.onLayoutReady');
        expect(src).toContain('void knowledgeVectorStore.init()');
    });
});

describe('PF-5 项目选择页单次文件快照', () => {
    const src = read('ui/full-writer/project-selector-controller.ts');

    it('整页渲染只取一次 vault.getFiles()，并把快照透传给元信息读取', () => {
        expect(src.match(/this\.app\.vault\.getFiles\(\)/g)).toHaveLength(1);
        expect(src).toContain('getProjectMeta(this.app, project, files)');
        expect(src).toContain('await this.renderRightPanel(unitsCache, metaOf, files)');
        expect(src).toContain('metaOf?.get(project) ?? await getProjectMeta(this.app, project, files)');
    });

    it('卡片点击与流程摘要复用整页快照（P-3）', () => {
        // 点击卡片不再无参重扫；流程摘要把已扫描章节传给 collectCreationFlowState
        expect(src).toContain('void this.renderRightPanel(unitsCache, metaOf, files)');
        expect(src).toContain('renderFlowSummary(panel, project, mode, unitsCache?.get(project))');
        expect(src).toContain("longChapters: mode === 'long' ? chapters : undefined");
    });

    it('初始渲染把 files 快照透传给长篇扫描与短篇/剧本单元（P2-3）', () => {
        expect(src).toContain('scanProjectChapters(this.app, longProjects, files)');
        expect(src).toContain('listModeUnits(this.app, project, mode, files)');
    });
});
