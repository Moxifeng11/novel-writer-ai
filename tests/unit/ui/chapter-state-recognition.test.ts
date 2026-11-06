import { describe, it, expect } from 'vitest';
import { App, TFile, TFolder } from 'obsidian';
import { ChapterStateManager } from '../../../ui/states/chapter-state-manager';

const CHAP_DIR = '测试项目/03-大纲与章节/步骤结果/第1卷/第1章';
const BODY_DIR = '测试项目/03-大纲与章节/正文/第1卷';
const BODY_PATH = '测试项目/03-大纲与章节/正文/第1卷/第1章_正文.md';

function makeEmptyChapterApp(): App {
    const app = new App();
    const folder = new TFolder();
    folder.path = CHAP_DIR;
    folder.name = '第1章';
    folder.children = [];
    app.vault.getAbstractFileByPath = () => folder;
    app.vault.getFiles = () => [];
    app.vault.read = async () => '';
    app.metadataCache.getFileCache = () => null;
    return app;
}

describe('ChapterStateManager — 完成性识别', () => {
    it('磁盘无步骤文件时清掉残留 stepResults，不得显示 ◐ 部分完成', async () => {
        const app = makeEmptyChapterApp();
        const mgr = new ChapterStateManager(app);
        // 模拟上一次生成失败/切换章节残留的内存结果
        mgr.stepResults['characterSoul'] = '旧的半成品内容';
        mgr.stepLevels['characterSoul'] = 'partial';
        mgr.stepCompleted.add('characterSoul');

        await mgr.restoreChapterState(CHAP_DIR);

        expect(mgr.stepResults['characterSoul']).toBeUndefined();
        expect(mgr.stepLevels['characterSoul']).toBe('empty');
        expect(mgr.stepCompleted.has('characterSoul')).toBe(false);
    });

    it('结算没有步骤文件，正文 status=settled 时识别为已完成', async () => {
        const app = makeEmptyChapterApp();
        const bodyFile = new TFile();
        bodyFile.path = BODY_PATH;
        bodyFile.name = '第1章_正文.md';
        // findBodyFileV4 现在只列本卷正文目录（G6-4），目录树里必须挂上这个文件
        const bodyVol = new TFolder();
        bodyVol.path = '测试项目/03-大纲与章节/正文/第1卷';
        bodyVol.name = '第1卷';
        bodyVol.children = [bodyFile];
        const chapterFolder = app.vault.getAbstractFileByPath(CHAP_DIR) as TFolder;
        app.vault.getAbstractFileByPath = (path: string) =>
            path === bodyVol.path ? bodyVol : chapterFolder;
        app.vault.getFiles = () => [bodyFile];
        app.metadataCache.getFileCache = (file) =>
            file === bodyFile ? { frontmatter: { status: 'settled' } } : null;

        const mgr = new ChapterStateManager(app);
        await mgr.restoreChapterState(CHAP_DIR);

        expect(mgr.stepCompleted.has('settlement')).toBe(true);
        expect(mgr.stepLevels['settlement']).toBe('complete');
        expect(mgr.stepMissing['settlement']).toEqual([]);
    });

    it('正文未结算时不误标 settlement 完成', async () => {
        const app = makeEmptyChapterApp();
        const bodyFile = new TFile();
        bodyFile.path = BODY_PATH;
        bodyFile.name = '第1章_正文.md';
        const bodyVol = new TFolder();
        bodyVol.path = '测试项目/03-大纲与章节/正文/第1卷';
        bodyVol.name = '第1卷';
        bodyVol.children = [bodyFile];
        const chapterFolder = app.vault.getAbstractFileByPath(CHAP_DIR) as TFolder;
        app.vault.getAbstractFileByPath = (path: string) =>
            path === bodyVol.path ? bodyVol : chapterFolder;
        app.vault.getFiles = () => [bodyFile];
        app.metadataCache.getFileCache = (file) =>
            file === bodyFile ? { frontmatter: { status: 'written' } } : null;

        const mgr = new ChapterStateManager(app);
        mgr.stepCompleted.add('settlement');
        await mgr.restoreChapterState(CHAP_DIR);

        expect(mgr.stepCompleted.has('settlement')).toBe(false);
        expect(mgr.stepLevels['settlement']).toBe('empty');
    });
});

interface ChapterAppOptions {
    /** 步骤结果目录内的文件（标准命名 第1章_类型.md） */
    stepFiles?: TFile[];
    /** 按 path 提供步骤文件内容 */
    stepContents?: Record<string, string>;
    /** 按 path 提供步骤文件 frontmatter 缓存 */
    stepCaches?: Record<string, { frontmatter?: Record<string, string> }>;
    bodyFile?: TFile | null;
    bodyContent?: string;
    bodyStatus?: string;
}

/** 构造带步骤文件/正文文件的章节 App；正文目录经 findBodyFileV4 定位 */
function makeChapterApp(opts: ChapterAppOptions = {}): App {
    const app = new App();
    const folder = new TFolder();
    folder.path = CHAP_DIR;
    folder.name = '第1章';
    folder.children = opts.stepFiles ?? [];

    const bodyFile = opts.bodyFile ?? null;
    const bodyVol = new TFolder();
    bodyVol.path = BODY_DIR;
    bodyVol.name = '第1卷';
    bodyVol.children = bodyFile ? [bodyFile] : [];

    app.vault.getAbstractFileByPath = (path: string) => {
        if (bodyFile && path === bodyFile.path) return bodyFile;
        if (path === BODY_DIR) return bodyVol;
        if (path === CHAP_DIR) return folder;
        return null;
    };
    app.vault.getFiles = () => (bodyFile ? [bodyFile] : []);
    app.vault.read = async (file: TFile) => {
        if (bodyFile && file.path === bodyFile.path) return opts.bodyContent ?? '';
        return opts.stepContents?.[file.path] ?? '';
    };
    app.metadataCache.getFileCache = (file: TFile) => {
        if (bodyFile && file.path === bodyFile.path) {
            return opts.bodyStatus ? { frontmatter: { status: opts.bodyStatus } } : null;
        }
        return opts.stepCaches?.[file.path] ?? null;
    };
    return app;
}

function makeChapterFile(name: string, mtime = 0): TFile {
    const file = new TFile();
    file.path = `${CHAP_DIR}/${name}`;
    file.name = name;
    file.basename = name.replace(/\.md$/, '');
    file.stat = { ctime: 0, mtime, size: 10 };
    return file;
}

describe('ChapterStateManager — 失效标脏链', () => {
    it('chapDir 为空时早退，不清空既有状态', async () => {
        const mgr = new ChapterStateManager(makeChapterApp());
        mgr.stepCompleted.add('outline');
        mgr.stepResults['outline'] = '保留的旧结果';

        await mgr.restoreChapterState('');

        expect(mgr.stepCompleted.has('outline')).toBe(true);
        expect(mgr.stepResults['outline']).toBe('保留的旧结果');
    });

    it('chapDir 不是文件夹时早退，不清空既有状态', async () => {
        const app = makeChapterApp();
        app.vault.getAbstractFileByPath = () => makeChapterFile('第1章.md');
        const mgr = new ChapterStateManager(app);
        mgr.stepCompleted.add('outline');

        await mgr.restoreChapterState(CHAP_DIR);

        expect(mgr.stepCompleted.has('outline')).toBe(true);
        expect(mgr.staleSteps.size).toBe(0);
    });

    it('质量控制晚于修正记录时把 fix 标脏（审计→修正时序）', async () => {
        const fix = makeChapterFile('第1章_修正记录.md', 100);
        const qc = makeChapterFile('第1章_质量控制.md', 200);
        const mgr = new ChapterStateManager(makeChapterApp({ stepFiles: [fix, qc] }));

        await mgr.restoreChapterState(CHAP_DIR);

        expect(mgr.staleSteps.has('fix')).toBe(true);
        expect(mgr.stepCompleted.has('fix')).toBe(false);
    });

    it('分析报告含 CRITICAL_FAIL 时把 finalFix 标脏', async () => {
        const ar = makeChapterFile('第1章_分析报告.md', 100);
        const finalFix = makeChapterFile('第1章_最终修正.md', 200);
        const app = makeChapterApp({
            stepFiles: [ar, finalFix],
            stepContents: { [ar.path]: '---\nstep_status: generated\n---\n结论：CRITICAL_FAIL 存在' },
        });
        const mgr = new ChapterStateManager(app);

        await mgr.restoreChapterState(CHAP_DIR);

        expect(mgr.staleSteps.has('finalFix')).toBe(true);
    });

    it('正文已完稿时跳过 mtime 与时序标脏', async () => {
        const fix = makeChapterFile('第1章_修正记录.md', 100);
        const qc = makeChapterFile('第1章_质量控制.md', 200);
        const ar = makeChapterFile('第1章_分析报告.md', 100);
        const finalFix = makeChapterFile('第1章_最终修正.md', 200);
        const body = makeChapterFile('第1章_正文.md', 500);
        body.path = BODY_PATH;
        const app = makeChapterApp({
            stepFiles: [fix, qc, ar, finalFix],
            stepContents: { [ar.path]: 'CRITICAL_FAIL' },
            bodyFile: body,
            bodyStatus: '已完稿',
        });
        const mgr = new ChapterStateManager(app);

        await mgr.restoreChapterState(CHAP_DIR);

        expect(mgr.staleSteps.size).toBe(0);
    });

    it('正文比审查文件新时把依赖正文的步骤标脏', async () => {
        const fix = makeChapterFile('第1章_修正记录.md', 100);
        const qc = makeChapterFile('第1章_质量控制.md', 100);
        const ar = makeChapterFile('第1章_分析报告.md', 100);
        const body = makeChapterFile('第1章_正文.md', 500);
        body.path = BODY_PATH;
        const app = makeChapterApp({
            stepFiles: [fix, qc, ar],
            bodyFile: body,
            bodyStatus: 'written',
        });
        const mgr = new ChapterStateManager(app);

        await mgr.restoreChapterState(CHAP_DIR);

        expect(mgr.staleSteps.has('fix')).toBe(true);
        expect(mgr.staleSteps.has('qualityControl')).toBe(true);
        expect(mgr.staleSteps.has('analysisReport')).toBe(true);
    });

    it('step_status=reviewed 的文件即使内容为空也视为已完成', async () => {
        const outline = makeChapterFile('第1章_大纲摘要.md', 0);
        const app = makeChapterApp({
            stepFiles: [outline],
            stepCaches: { [outline.path]: { frontmatter: { step_status: 'reviewed' } } },
        });
        const mgr = new ChapterStateManager(app);

        await mgr.restoreChapterState(CHAP_DIR);

        expect(mgr.stepCompleted.has('outline')).toBe(true);
        expect(mgr.stepLevels['outline']).toBe('complete');
    });
});
