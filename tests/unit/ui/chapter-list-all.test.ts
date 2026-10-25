/**
 * Rev 186 / T1：章节列表 = 正文 ∪ 步骤结果骨架目录
 *
 * 旧实现只扫描 正文/第N卷/第N章_正文.md，仅建了 步骤结果/第N卷/第M章 目录、
 * 尚未写正文的章节不会出现在选择器里。这里钉住新的并集口径与去重语义。
 */
import { describe, it, expect } from 'vitest';
import { App } from 'obsidian';
import { getChaptersForProject, sortChaptersByNumber, getNextChapter } from '../../../ui/project-utils';

const PROJECT = '测试书';

function makeApp(): App {
    return new App();
}

function seedBody(app: App, vol: number, chap: number, title = ''): void {
    const path = `${PROJECT}/03-大纲与章节/正文/第${vol}卷/第${chap}章_正文.md`;
    (app.vault as any)._seedFile(path, `# 第${chap}章${title ? ' ' + title : ''}\n\n正文内容`);
}

async function seedSkeleton(app: App, vol: number, chap: number): Promise<void> {
    await app.vault.createFolder(`${PROJECT}/03-大纲与章节/步骤结果/第${vol}卷/第${chap}章`);
}

describe('getChaptersForProject — 正文 ∪ 骨架', () => {
    it('正文 2 章 + 骨架 1 章 → 3 条，骨架 file 为 null 且 hasBody=false', async () => {
        const app = makeApp();
        seedBody(app, 1, 1);
        seedBody(app, 1, 2);
        await seedSkeleton(app, 1, 3);

        const chapters = getChaptersForProject(app, PROJECT);

        expect(chapters).toHaveLength(3);
        const byName = new Map(chapters.map(c => [c.chapter, c]));
        expect(byName.get('第1章')?.hasBody).toBe(true);
        expect(byName.get('第1章')?.file).not.toBeNull();
        expect(byName.get('第3章')?.hasBody).toBe(false);
        expect(byName.get('第3章')?.file).toBeNull();
        expect(byName.get('第3章')?.volume).toBe('第1卷');
    });

    it('同一章同时有正文与骨架目录 → 只保留正文那条', async () => {
        const app = makeApp();
        seedBody(app, 1, 2);
        await seedSkeleton(app, 1, 2);

        const chapters = getChaptersForProject(app, PROJECT);

        expect(chapters).toHaveLength(1);
        expect(chapters[0].chapter).toBe('第2章');
        expect(chapters[0].hasBody).toBe(true);
        expect(chapters[0].file?.path).toContain('第2章_正文.md');
    });

    it('跨卷同名章号：正文优先，不因骨架目录重复出现', async () => {
        const app = makeApp();
        seedBody(app, 1, 5);
        await seedSkeleton(app, 2, 5);

        const chapters = getChaptersForProject(app, PROJECT);

        expect(chapters).toHaveLength(1);
        expect(chapters[0].chapter).toBe('第5章');
        expect(chapters[0].volume).toBe('第1卷');
        expect(chapters[0].hasBody).toBe(true);
    });

    it('只有正文、无骨架目录 → 仅返回正文章', () => {
        const app = makeApp();
        seedBody(app, 1, 1);
        seedBody(app, 1, 2);

        const chapters = getChaptersForProject(app, PROJECT);

        expect(chapters).toHaveLength(2);
        expect(chapters.every(c => c.hasBody)).toBe(true);
    });

    it('空项目 → 返回空数组', () => {
        const app = makeApp();
        expect(getChaptersForProject(app, PROJECT)).toEqual([]);
    });

    it('其他项目的骨架目录不会串入', async () => {
        const app = makeApp();
        await app.vault.createFolder('别的书/03-大纲与章节/步骤结果/第1卷/第9章');

        expect(getChaptersForProject(app, PROJECT)).toEqual([]);
    });

    it('排序后骨架章可作为「下一章待写」', async () => {
        const app = makeApp();
        seedBody(app, 1, 1);
        seedBody(app, 1, 2);
        await seedSkeleton(app, 1, 3);
        // 正文两章均已完稿，骨架章 status 为空 → 应被选为下一章
        (app.metadataCache as any).getFileCache = (file: { path: string }) => ({
            frontmatter: { status: file.path.includes('_正文.md') ? 'written' : '' },
            headings: [],
        });

        const sorted = sortChaptersByNumber(getChaptersForProject(app, PROJECT));
        expect(sorted.map(c => c.chapter)).toEqual(['第1章', '第2章', '第3章']);

        const next = getNextChapter(sorted);
        expect(next?.chapter).toBe('第3章');
        expect(next?.hasBody).toBe(false);
    });
});
