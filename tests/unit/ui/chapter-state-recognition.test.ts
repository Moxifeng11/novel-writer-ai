import { describe, it, expect } from 'vitest';
import { App, TFile, TFolder } from 'obsidian';
import { ChapterStateManager } from '../../../ui/states/chapter-state-manager';

const CHAP_DIR = '测试项目/03-大纲与章节/步骤结果/第1卷/第1章';
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
