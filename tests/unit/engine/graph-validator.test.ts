import { describe, expect, it } from 'vitest';
import { App } from 'obsidian';
import { validateProjectGraph } from '../../../engine/graph/graph-validator';

const PROJECT = '长篇小说/测试书';

function seedFile(app: App, path: string, content: string): void {
    (app.vault as unknown as { _seedFile: (p: string, c: string) => void })._seedFile(path, content);
}

function makeApp(): { app: App; cache: Record<string, { frontmatter: Record<string, unknown> }> } {
    const app = new App();
    const cache: Record<string, { frontmatter: Record<string, unknown> }> = {};
    const metadata = app.metadataCache as unknown as {
        getFileCache: (file: { path: string }) => unknown;
        resolvedLinks: Record<string, Record<string, number>>;
        unresolvedLinks: Record<string, Record<string, number>>;
    };
    metadata.getFileCache = (file) => cache[file.path] ?? null;
    metadata.resolvedLinks = {};
    metadata.unresolvedLinks = {};
    return { app, cache };
}

function seedEntity(
    app: App,
    cache: Record<string, { frontmatter: Record<string, unknown> }>,
    kind: string,
    name: string,
    frontmatter: Record<string, unknown>,
): void {
    const path = `${PROJECT}/01-世界架构/${kind}/${name}.md`;
    seedFile(app, path, `---\n姓名: ${name}\n---\n`);
    cache[path] = { frontmatter };
}

describe('graph-validator — 只读兜底校验', () => {
    it('命中断链、孤立实体、关系缺卡、双链类型不符、台账未知引用与类型冲突', async () => {
        const { app, cache } = makeApp();
        seedEntity(app, cache, '人物', '林惊鸿', {
            姓名: '林惊鸿', tags: ['人物'], 所属势力: '[[苏雪]]',
        });
        seedEntity(app, cache, '人物', '苏雪', {
            姓名: '苏雪', tags: ['地点'],
        });
        seedEntity(app, cache, '地点', '青云宗', { 名称: '青云宗', tags: ['地点'] });

        for (let chapter = 1; chapter <= 3; chapter++) {
            const path = `${PROJECT}/03-大纲与章节/正文/第${chapter}章.md`;
            seedFile(app, path, '正文');
            cache[path] = { frontmatter: { tags: ['正文'], 涉及人物: ['林惊鸿'] } };
        }

        seedFile(app, `${PROJECT}/01-世界架构/关系状态.md`, `---
tags: [关系状态]
---
## 林惊鸿 ↔ 不存在的人
trust: 50
attraction: 50
fear: 50
resentment: 50
dependence: 50
status: 陌生
last_updated_chapter: 第1章
history: |
`);
        seedFile(app, `${PROJECT}/02-时间线与伏笔/时间线看板.md`, `### 主线纪元

| # | 事件名称 | 时间 | 地点 | 涉及人物 | 章节 | 类型 |
|---|---|---|---|---|---|---|
| 1 | 山门试炼 | 清晨 | 山门 | 林惊鸿、幽灵甲 | 第2章 | 主线 |
`);

        const metadata = app.metadataCache as unknown as {
            unresolvedLinks: Record<string, Record<string, number>>;
        };
        metadata.unresolvedLinks = {
            [`${PROJECT}/03-大纲与章节/正文/第1章.md`]: {
                [`${PROJECT}/01-世界架构/人物/幽灵.md`]: 1,
            },
        };

        const report = await validateProjectGraph({ app, project: PROJECT });
        const rules = new Set(report.issues.map((issue) => issue.rule));
        expect(report.skipped).toBe('');
        expect(rules.has('broken-link')).toBe(true);
        expect(rules.has('orphan-entity')).toBe(true);
        expect(rules.has('missing-relation-card')).toBe(true);
        expect(rules.has('link-type-mismatch')).toBe(true);
        expect(rules.has('unknown-ledger-ref')).toBe(true);
        expect(rules.has('type-mismatch')).toBe(true);
    });

    it('没有 metadataCache 链接表时返回 skipped，不抛错', async () => {
        const app = new App();
        const report = await validateProjectGraph({ app, project: PROJECT });
        expect(report.skipped).toBe('no-metadata-cache');
        expect(report.issues).toHaveLength(0);
    });
});
