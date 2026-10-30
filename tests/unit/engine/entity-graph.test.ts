import { describe, expect, it } from 'vitest';
import {
    buildEntityRelationsBlock,
    getOwnedItems,
    getRecentBehaviors,
} from '../../../engine/entity-graph';

/** 最小 App mock：vault.getFiles + metadataCache.getFileCache + vault.adapter */
interface FrontmatterLike {
    [key: string]: unknown;
}

interface FakeFile {
    path: string;
    basename: string;
}

function createApp(options: {
    files: Array<{ path: string; frontmatter?: FrontmatterLike }>;
    behaviorLog?: string;
}): App {
    // 真实 TFile.basename 不含扩展名
    const files = options.files.map((entry) => ({
        path: entry.path,
        basename: (entry.path.split('/').pop() || entry.path).replace(/\.md$/, ''),
    })) as unknown as TFile[];
    const cacheByPath = new Map(options.files.map((entry) => [entry.path, { frontmatter: entry.frontmatter }]));
    return {
        vault: {
            getFiles: () => files,
            adapter: {
                exists: async (path: string) => path.endsWith('出场记录.md') && !!options.behaviorLog,
                read: async () => options.behaviorLog || '',
            },
        },
        metadataCache: {
            getFileCache: (file: FakeFile) => cacheByPath.get(file.path) || null,
        },
    } as unknown as App;
}

import type { App, TFile } from 'obsidian';

const PROJECT = '长篇小说/测试项目';

describe('entity-graph — 所有权反查（单侧写入的查询侧）', () => {
    it('物品 frontmatter「所属/归属」链接到人物时反查命中', () => {
        const app = createApp({
            files: [
                {
                    path: `${PROJECT}/01-世界架构/物品功法/轩辕剑.md`,
                    frontmatter: { '所属/归属': '[[武昭]]', '品阶/等级': '上品', 当前状态: '封印中' },
                },
                {
                    path: `${PROJECT}/01-世界架构/物品功法/破靴.md`,
                    frontmatter: { '所属/归属': '[[沈青]]' },
                },
                {
                    path: `${PROJECT}/01-世界架构/人物/武昭.md`,
                    frontmatter: { 修为等级: '元婴期' },
                },
            ],
        });
        const owned = getOwnedItems(app, PROJECT, '武昭');
        expect(owned).toHaveLength(1);
        expect(owned[0]).toMatchObject({ name: '轩辕剑', grade: '上品', status: '封印中' });
    });

    it('旧格式纯字符串归属也能命中（读取兼容）', () => {
        const app = createApp({
            files: [
                {
                    path: `${PROJECT}/01-世界架构/物品功法/黑色石头.md`,
                    frontmatter: { '所属/归属': '武昭' },
                },
            ],
        });
        expect(getOwnedItems(app, PROJECT, '武昭')).toHaveLength(1);
    });

    it('无命中返回空数组', () => {
        const app = createApp({
            files: [{ path: `${PROJECT}/01-世界架构/物品功法/破靴.md`, frontmatter: { '所属/归属': '[[沈青]]' } }],
        });
        expect(getOwnedItems(app, PROJECT, '武昭')).toEqual([]);
    });
});

describe('entity-graph — 状态速览块', () => {
    it('汇总境界/位置/势力/物品/近况；无数据角色跳过', async () => {
        const behaviorLog = [
            '# 角色出场记录',
            '',
            '| 章节 | 角色 | 本章行为摘要 |',
            '|---|---|---|',
            '| 第11章 | 武昭 | 拒绝死神交易 |',
            '| 第12章 | 武昭 | 擦刀时认出守卫的徽记 |',
            '| 第12章 | 沈青 | 锁上第一扇门 |',
        ].join('\n');
        const app = createApp({
            files: [
                {
                    path: `${PROJECT}/01-世界架构/人物/武昭.md`,
                    frontmatter: { 修为等级: '元婴期', 所属势力: '[[青云宗]]', 当前位置: '[[断刃城]]', 当前情绪: '警惕' },
                },
                {
                    path: `${PROJECT}/01-世界架构/物品功法/轩辕剑.md`,
                    frontmatter: { '所属/归属': '[[武昭]]', '品阶/等级': '上品', 当前状态: '封印中' },
                },
                { path: `${PROJECT}/01-世界架构/人物/路人甲.md`, frontmatter: {} },
            ],
            behaviorLog,
        });

        const block = await buildEntityRelationsBlock(app, PROJECT, ['武昭', '路人甲']);
        expect(block).toContain('【实体状态速览');
        expect(block).toContain('武昭｜修为：元婴期｜所属：青云宗｜所在：断刃城｜情绪：警惕');
        expect(block).toContain('随身物品：轩辕剑（上品 · 封印中）');
        expect(block).toContain('近况：第11章 拒绝死神交易；第12章 擦刀时认出守卫的徽记');
        expect(block).not.toContain('路人甲');
    });

    it('无任何数据时返回空串（调用方跳过注入）', async () => {
        const app = createApp({ files: [] });
        expect(await buildEntityRelationsBlock(app, PROJECT, ['武昭'])).toBe('');
        expect(await buildEntityRelationsBlock(app, PROJECT, [])).toBe('');
    });

    it('近况查询按角色过滤', async () => {
        const behaviorLog = [
            '# 角色出场记录',
            '',
            '| 章节 | 角色 | 本章行为摘要 |',
            '|---|---|---|',
            '| 第12章 | 武昭 | 擦刀 |',
            '| 第12章 | 沈青 | 锁门 |',
        ].join('\n');
        const app = createApp({ files: [], behaviorLog });
        expect(await getRecentBehaviors(app, PROJECT, '沈青')).toEqual(['第12章 锁门']);
        expect(await getRecentBehaviors(app, PROJECT, '不存在的人')).toEqual([]);
    });
});
