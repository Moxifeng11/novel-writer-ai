/**
 * 批次 2 / 性能：多项目章节一次扫描
 *
 * 项目选择页一次渲染要对 N 个项目取章节，旧实现是 N 次全库遍历（每次 getFiles
 * + getAllLoadedFiles）。这里钉住两点：
 *   1. 批量扫描结果与逐项目 getChaptersForProject 逐项一致（口径不能分叉）；
 *   2. 全库遍历轮次与项目数无关。
 */
import { describe, it, expect, vi } from 'vitest';
import { App } from 'obsidian';
import { getChaptersForProject, scanProjectChapters, type ChapterListEntry } from '../../../ui/project-utils';

const PROJECTS = Array.from({ length: 8 }, (_, i) => `项目${i + 1}`);

function seedBody(app: App, project: string, vol: number, chap: number, title: string): void {
    (app.vault as any)._seedFile(
        `${project}/03-大纲与章节/正文/第${vol}卷/第${chap}章_正文.md`,
        `# 第${chap}章 ${title}\n\n正文内容`,
    );
}

async function seedSkeleton(app: App, project: string, vol: number, chap: number): Promise<void> {
    await app.vault.createFolder(`${project}/03-大纲与章节/步骤结果/第${vol}卷/第${chap}章`);
}

/** 400 章 / 8 项目：每项目 48 章正文 + 2 章仅有骨架 */
async function seedLargeVault(app: App): Promise<void> {
    for (const project of PROJECTS) {
        for (let chap = 1; chap <= 48; chap++) {
            seedBody(app, project, 1, chap, `标题${chap}`);
        }
        await seedSkeleton(app, project, 1, 49);
        await seedSkeleton(app, project, 1, 50);
    }
}

/** 只比较可稳定比较的字段（file 是每次新建的对象） */
function comparable(list: ChapterListEntry[]) {
    return list.map(c => ({
        chapter: c.chapter,
        volume: c.volume,
        title: c.title,
        status: c.status,
        hasBody: c.hasBody,
        written: c.written,
        size: c.size,
    }));
}

describe('scanProjectChapters — 多项目一次扫描', () => {
    it('8 项目 / 400 章：批量结果与逐项目查询逐项一致', async () => {
        const app = new App();
        await seedLargeVault(app);

        const scanned = scanProjectChapters(app, PROJECTS);

        for (const project of PROJECTS) {
            const batch = scanned.get(project);
            expect(batch).toBeDefined();
            expect(comparable(batch!)).toEqual(comparable(getChaptersForProject(app, project)));
            expect(batch).toHaveLength(50);
        }
    });

    it('全库遍历轮次与项目数无关（旧路径为每个项目各遍历一次）', async () => {
        const app = new App();
        await seedLargeVault(app);

        const spy = vi.spyOn(app.vault, 'getFiles');

        // 旧路径：每个项目各调一次 getChaptersForProject
        for (const project of PROJECTS) getChaptersForProject(app, project);
        const legacyCalls = spy.mock.calls.length;

        spy.mockClear();
        scanProjectChapters(app, PROJECTS);
        const batchCalls = spy.mock.calls.length;

        // mock 的 getAllLoadedFiles 内部也会调一次 getFiles，故单轮 = 2 次
        expect(batchCalls).toBe(2);
        expect(legacyCalls).toBe(PROJECTS.length * 2);
        spy.mockRestore();
    });

    it('只返回传入的项目', async () => {
        const app = new App();
        await seedLargeVault(app);

        const scanned = scanProjectChapters(app, ['项目1', '项目3']);

        expect(Array.from(scanned.keys()).sort()).toEqual(['项目1', '项目3']);
        expect(scanned.get('项目2')).toBeUndefined();
    });

    it('传入 files 快照：批量扫描不再自己取全库文件（P2-3）', async () => {
        const app = new App();
        await seedLargeVault(app);
        const snapshot = app.vault.getFiles();
        const spy = vi.spyOn(app.vault, 'getFiles');
        spy.mockClear();

        const scanned = scanProjectChapters(app, PROJECTS, snapshot);

        // mock getAllLoadedFiles 内部会调一次 getFiles，除此之外不应再有全库取文件
        expect(spy).toHaveBeenCalledTimes(1);
        expect(scanned.get('项目1')).toHaveLength(50);
        spy.mockRestore();
    });

    it('空项目列表 → 空 Map，且不触发全库遍历', () => {
        const app = new App();
        const spy = vi.spyOn(app.vault, 'getFiles');

        const scanned = scanProjectChapters(app, []);

        expect(scanned.size).toBe(0);
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });

    it('无章节的项目返回空数组而不是缺失键', async () => {
        const app = new App();
        seedBody(app, '有章节的书', 1, 1, '开篇');
        await app.vault.createFolder('空书的书/03-大纲与章节');

        const scanned = scanProjectChapters(app, ['有章节的书', '空书的书']);

        expect(scanned.get('空书的书')).toEqual([]);
        expect(scanned.get('有章节的书')).toHaveLength(1);
    });

    it('项目名互为前缀时不串数据（书 vs 书2）', async () => {
        const app = new App();
        seedBody(app, '书', 1, 1, '甲的章');
        seedBody(app, '书2', 1, 2, '乙的章');

        const scanned = scanProjectChapters(app, ['书', '书2']);

        expect(scanned.get('书')!.map(c => c.chapter)).toEqual(['第1章']);
        expect(scanned.get('书2')!.map(c => c.chapter)).toEqual(['第2章']);
    });
});
