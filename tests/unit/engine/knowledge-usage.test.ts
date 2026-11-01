import { describe, expect, it } from 'vitest';
import { collectKnowledgeUsage, labelOfStepFile } from '../../../engine/knowledge-usage';

interface FakeFile { path: string; name: string; stat?: { mtime: number } }

function makeApp(files: Array<FakeFile & { rag?: unknown; frontmatter?: Record<string, unknown> }>) {
    return {
        vault: { getFiles: () => files.map(({ path, name, stat }) => ({ path, name, stat })) },
        metadataCache: {
            getFileCache: (target: { path: string }) => {
                const hit = files.find(file => file.path === target.path);
                if (!hit) return null;
                if (hit.frontmatter) return { frontmatter: hit.frontmatter };
                if (hit.rag === undefined) return null;
                return { frontmatter: { rag_sources: hit.rag } };
            },
        },
    };
}

const P = '长篇小说/书A';

describe('labelOfStepFile', () => {
    it('从步骤文件名推断类型', () => {
        expect(labelOfStepFile('第3章_大纲摘要.md')).toBe('大纲摘要');
        expect(labelOfStepFile('第3章_正文.md')).toBe('正文');
        expect(labelOfStepFile('随便.md')).toBe('随便');
    });
});

describe('collectKnowledgeUsage', () => {
    it('只统计本项目、步骤结果与正文目录，并汇总命中率', () => {
        const app = makeApp([
            {
                path: `${P}/03-大纲与章节/步骤结果/第1卷/第1章/第1章_大纲摘要.md`,
                name: '第1章_大纲摘要.md',
                stat: { mtime: 10 },
                rag: [{ book: '书A', dimension: 'style', score: 0.8, excerpt: '片段1' }],
            },
            {
                path: `${P}/03-大纲与章节/正文/第1卷/第1章_正文.md`,
                name: '第1章_正文.md',
                stat: { mtime: 20 },
                rag: [
                    { book: '书A', dimension: 'style', score: 0.9, excerpt: '片段2' },
                    { book: '书B', dimension: 'original', score: 0.5, excerpt: '片段3' },
                ],
            },
            {
                path: `${P}/03-大纲与章节/步骤结果/第1卷/第1章/第1章_质量控制.md`,
                name: '第1章_质量控制.md',
                stat: { mtime: 30 },
                frontmatter: { step_status: 'generated' },
            },
            // 其它项目 / 非承载目录：不参与统计
            {
                path: '长篇小说/书B/03-大纲与章节/步骤结果/第1卷/第1章/第1章_正文.md',
                name: '第1章_正文.md',
                stat: { mtime: 40 },
                rag: [{ book: '书C', dimension: 'style', score: 1, excerpt: 'x' }],
            },
            {
                path: `${P}/02-时间线与伏笔/伏笔库.md`,
                name: '伏笔库.md',
                stat: { mtime: 50 },
                rag: [{ book: '书D', dimension: 'style', score: 1, excerpt: 'y' }],
            },
        ]);

        const usage = collectKnowledgeUsage(app, P);
        expect(usage.stepsTotal).toBe(3);
        expect(usage.stepsWithRag).toBe(2);
        expect(usage.totalSources).toBe(3);
        expect(usage.byBook.map(item => item.book)).toEqual(['书A', '书B']);
        // recent 按 mtime 降序：正文(20) 在 大纲摘要(10) 之前
        expect(usage.recent.map(item => item.label)).toEqual(['正文', '大纲摘要']);
    });

    it('空项目 / 全无 frontmatter 时返回零值', () => {
        expect(collectKnowledgeUsage(makeApp([]), '').stepsTotal).toBe(0);
        const app = makeApp([
            { path: `${P}/03-大纲与章节/步骤结果/第1卷/第1章/第1章_大纲摘要.md`, name: '第1章_大纲摘要.md' },
        ]);
        const usage = collectKnowledgeUsage(app, P);
        expect(usage.stepsTotal).toBe(0);
        expect(usage.hitRate).toBe(0);
    });
});
