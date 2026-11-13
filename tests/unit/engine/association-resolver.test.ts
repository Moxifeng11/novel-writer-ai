import { describe, expect, it } from 'vitest';
import { App } from 'obsidian';
import { extractPresentEntities, resolveAssociations } from '../../../engine/context/association-resolver';
import { EntityIndex } from '../../../shared/entity-index';

const PROJECT = '长篇小说/测试书';

function seedFile(app: App, path: string, content: string): void {
    (app.vault as unknown as { _seedFile: (p: string, c: string) => void })._seedFile(path, content);
}

function seedEntity(app: App, kind: string, name: string, frontmatter: Record<string, unknown>): void {
    const path = `${PROJECT}/01-世界架构/${kind}/${name}.md`;
    seedFile(app, path, `---\n姓名: ${name}\n---\n`);
    const cache = app.metadataCache as unknown as { getFileCache: (file: { path: string }) => unknown };
    const original = cache.getFileCache.bind(cache);
    cache.getFileCache = (file) => {
        if (file.path === path) return { frontmatter };
        return original(file as never);
    };
}

describe('association-resolver — 实体提取', () => {
    it('最长名称优先，短名不会抢占长名区间', () => {
        const app = new App();
        seedEntity(app, '人物', '林惊鸿', { 姓名: '林惊鸿', 性格标签: '冷静' });
        seedEntity(app, '人物', '林', { 姓名: '林', 性格标签: '路人' });
        const index = EntityIndex.build(app, PROJECT);
        const names = extractPresentEntities('林惊鸿拔剑，林在一旁看着。', index);
        expect(names[0]).toBe('林惊鸿');
        expect(names).not.toContain('林');
    });
});

describe('association-resolver — 关联信息补检', () => {
    it('返回人物/关系/到期伏笔/时间线，并按预算与去重裁剪', async () => {
        const app = new App();
        seedEntity(app, '人物', '林惊鸿', {
            姓名: '林惊鸿', 身份: '主角', 当前状态: '受伤', 当前情绪: '警惕', 性格标签: '冷静、护短',
            伤势: '左臂贯通伤', 持有物品: '断裂的玉佩', 已知信息: '知晓山门暗道',
        });
        seedEntity(app, '人物', '苏雪', { 姓名: '苏雪', 身份: '配角', 当前状态: '良好' });

        seedFile(app, `${PROJECT}/01-世界架构/关系状态.md`, `---
tags: [关系状态]
---
## 林惊鸿 ↔ 苏雪
trust: 62
attraction: 55
fear: 50
resentment: 50
dependence: 50
status: 基本信任
last_updated_chapter: 第3章
history: |
  第3章: 并肩作战
`);

        seedFile(app, `${PROJECT}/02-时间线与伏笔/时间线看板.md`, `### 主线纪元

| 时间 | 对应章节 | 事件 | 影响 |
|---|---|---|---|
| 第三日 | 第3章 | 山门试炼 | 林惊鸿暴露体质 |
`);

        seedFile(app, `${PROJECT}/02-时间线与伏笔/伏笔库.md`, `## 未回收伏笔

| # | 伏笔名称 | 重要程度 | 埋设章节 | 计划回收 | 相关人物 | 关联主线 | 当前状态 |
|---|---------|---------|---------|---------|---------|---------|---------|
| 1 | 断裂的玉佩 | 高 | 第2章 | 第3章 | 林惊鸿 | 身世线 | 未揭示 |
`);

        const bundle = await resolveAssociations({
            app,
            project: PROJECT,
            task: 'body',
            text: '林惊鸿握紧断裂的玉佩，苏雪站在他身后。',
            chapter: 3,
            budgetTokens: 600,
        });

        expect(bundle.skipped).toBe('');
        expect(bundle.items.some((item) => item.kind === 'character' && item.text.includes('林惊鸿'))).toBe(true);
        // DSH-20261114-02：连续性三字段在 association 摘要可见（伤势/已知原有，持有为本次补齐）
        const charItem = bundle.items.find((item) => item.kind === 'character')!;
        expect(charItem.text).toContain('伤势：左臂贯通伤');
        expect(charItem.text).toContain('持有：断裂的玉佩');
        expect(charItem.text).toContain('已知：知晓山门暗道');
        expect(bundle.items.some((item) => item.kind === 'relationship' && item.text.includes('信任62'))).toBe(true);
        expect(bundle.items.some((item) => item.kind === 'foreshadow' && item.text.includes('断裂的玉佩'))).toBe(true);
        expect(bundle.items.some((item) => item.kind === 'timeline' && item.text.includes('山门试炼'))).toBe(true);
        expect(bundle.text).toContain('【关联人物】');

        // 已注入相同人物文本 → 去重
        const characterItem = bundle.items.find((item) => item.kind === 'character')!;
        const deduped = await resolveAssociations({
            app,
            project: PROJECT,
            task: 'body',
            text: '林惊鸿握紧断裂的玉佩。',
            chapter: 3,
            alreadyInjected: [characterItem.text],
            budgetTokens: 600,
        });
        expect(deduped.items.some((item) => item.kind === 'character')).toBe(false);
    });

    it('没有可用实体时返回 no-entities', async () => {
        const app = new App();
        const bundle = await resolveAssociations({
            app,
            project: PROJECT,
            task: 'suggestion',
            text: '一个没有任何已知人物的句子。',
            chapter: 1,
        });
        expect(bundle.skipped).toBe('no-entities');
        expect(bundle.text).toBe('');
    });
});
