import { describe, it, expect } from 'vitest';
import { App, TFolder, TFile } from 'obsidian';
import { listChapterNumbers } from '../../../engine/chapter-utils';

function makeFolder(path: string, children: Array<{ name: string; folder?: boolean }>): TFolder {
    const folder = new TFolder();
    folder.path = path;
    folder.name = path.split('/').pop() || '';
    folder.children = children.map((c) => {
        if (c.folder) {
            const f = new TFolder();
            f.path = `${path}/${c.name}`;
            f.name = c.name;
            return f;
        }
        const f = new TFile();
        f.path = `${path}/${c.name}`;
        f.name = c.name;
        f.basename = c.name.replace(/\.md$/, '');
        return f;
    });
    return folder;
}

function makeBodyFile(path: string): TFile {
    const f = new TFile();
    f.path = path;
    f.name = path.split('/').pop() || '';
    f.basename = f.name.replace(/\.md$/, '');
    return f;
}

function makeApp(files: TFile[], folders: TFolder[]): App {
    const byPath = new Map(folders.map((f) => [f.path, f]));
    return {
        vault: {
            getAbstractFileByPath: (p: string) => byPath.get(p) ?? null,
            getFiles: () => files,
        },
    } as unknown as App;
}

describe('listChapterNumbers', () => {
    const project = '书籍A';

    it('并集步骤目录与正文文件，去重并排序', () => {
        const stepVol = makeFolder(`${project}/03-大纲与章节/步骤结果/第2卷`, [
            { name: '第1章', folder: true },
            { name: '第2章', folder: true },
            { name: '说明.md' },
        ]);
        const files = [
            makeBodyFile(`${project}/03-大纲与章节/正文/第2卷/第2章_正文.md`),
            makeBodyFile(`${project}/03-大纲与章节/正文/第2卷/第3章_风起_正文.md`),
            // 干扰项：其它目录 / 其它卷
            makeBodyFile(`${project}/03-大纲与章节/正文/第3卷/第9章_正文.md`),
            makeBodyFile(`${project}/03-大纲与章节/步骤结果/第2卷/第1章/第1章_大纲摘要.md`),
        ];
        // 目录树里也要有本卷正文目录：listChapterNumbers 现在只列该目录（G6-4）
        const bodyVol = makeFolder(`${project}/03-大纲与章节/正文/第2卷`, [
            { name: '第2章_正文.md' },
            { name: '第3章_风起_正文.md' },
        ]);
        const app = makeApp(files, [stepVol, bodyVol]);

        expect(listChapterNumbers(app, project, 2)).toEqual([1, 2, 3]);
    });

    it('步骤目录不存在时只按正文文件推导', () => {
        const files = [makeBodyFile(`${project}/03-大纲与章节/正文/第1卷/第5章_正文.md`)];
        const bodyVol = makeFolder(`${project}/03-大纲与章节/正文/第1卷`, [{ name: '第5章_正文.md' }]);
        const app = makeApp(files, [bodyVol]);

        expect(listChapterNumbers(app, project, 1)).toEqual([5]);
    });

    it('无任何骨架时返回空数组', () => {
        const app = makeApp([], []);

        expect(listChapterNumbers(app, project, 1)).toEqual([]);
    });

    it('忽略非正文命名的 md（避免把大纲摘要当骨架）', () => {
        const stepVol = makeFolder(`${project}/03-大纲与章节/步骤结果/第1卷`, []);
        const files = [makeBodyFile(`${project}/03-大纲与章节/正文/第1卷/第7章_大纲摘要.md`)];
        const app = makeApp(files, [stepVol]);

        expect(listChapterNumbers(app, project, 1)).toEqual([]);
    });
});
