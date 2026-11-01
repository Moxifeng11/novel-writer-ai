/**
 * KnowledgeTagManager — 标签体系默认树/CRUD/损坏恢复（G7-4c）
 *
 * 这层是知识库题材筛选的唯一数据源：读失败若直接中断，知识库整体不可用；
 * 若静默覆盖，用户自定义标签会被默认树吃掉。
 */
import { describe, expect, it, vi } from 'vitest';
import { KnowledgeTagManager } from '../../../engine/knowledge-tags';
import { kbTagSystemFile } from '../../../shared/paths';

function makeAdapter(seed: Record<string, string> = {}) {
    const files = new Map(Object.entries(seed));
    const dirs = new Set<string>();
    const renames: Array<{ from: string; to: string }> = [];
    const adapter = {
        exists: async (path: string) => files.has(path) || dirs.has(path),
        read: async (path: string) => files.get(path) ?? '',
        write: async (path: string, data: string) => { files.set(path, data); },
        mkdir: async (path: string) => { dirs.add(path); },
        rename: async (from: string, to: string) => {
            renames.push({ from, to });
            const content = files.get(from);
            if (content !== undefined) {
                files.delete(from);
                files.set(to, content);
            }
        },
    };
    return { app: { vault: { adapter } }, files, dirs, renames };
}

describe('KnowledgeTagManager — 初始化', () => {
    it('无标签文件时生成默认树并落盘', async () => {
        const { app, files } = makeAdapter();
        const manager = new KnowledgeTagManager(app as never);
        await manager.init();

        const themes = manager.getTagsByCategory('theme');
        const techniques = manager.getTagsByCategory('technique');
        expect(themes.length).toBeGreaterThan(10);
        expect(techniques.length).toBeGreaterThan(0);
        expect(files.get(kbTagSystemFile(undefined))).toContain('# 标签体系');
    });

    it('重复 init 不重复生成（幂等）', async () => {
        const { app } = makeAdapter();
        const manager = new KnowledgeTagManager(app as never);
        await manager.init();
        const first = manager.getAllTags().length;
        await manager.init();
        expect(manager.getAllTags()).toHaveLength(first);
    });

    it('标签文件损坏时退回默认树并留档，不抛错也不覆盖原文件', async () => {
        const path = kbTagSystemFile(undefined);
        const { app, renames, files } = makeAdapter({ [path]: '%%% not markdown %%%' });
        const manager = new KnowledgeTagManager(app as never);

        await expect(manager.init()).resolves.toBeUndefined();
        expect(manager.getAllTags().length).toBeGreaterThan(0);
        expect(renames).toHaveLength(1);
        expect(renames[0].to).toContain('.corrupt-');
        // 损坏内容仍保留在备份里
        expect(files.get(renames[0].to)).toBe('%%% not markdown %%%');
    });
});

describe('KnowledgeTagManager — 增删改与查询', () => {
    it('addTag 生成 id 并可查询', async () => {
        const { app } = makeAdapter();
        const manager = new KnowledgeTagManager(app as never);
        await manager.init();

        const tag = await manager.addTag({ name: '测试题材', category: 'theme', description: '测试用' });

        expect(tag.id).toMatch(/^tag_/);
        expect(manager.getTagById(tag.id)?.name).toBe('测试题材');
        expect(manager.getTagByName('测试题材')?.description).toBe('测试用');
    });

    it('updateTag 保留 id，未知 id 静默忽略', async () => {
        const { app } = makeAdapter();
        const manager = new KnowledgeTagManager(app as never);
        await manager.init();
        const tag = await manager.addTag({ name: '旧名', category: 'theme' });

        await manager.updateTag(tag.id, { name: '新名', id: 'hijack' });
        expect(manager.getTagById(tag.id)?.name).toBe('新名');

        await expect(manager.updateTag('missing', { name: 'x' })).resolves.toBeUndefined();
        expect(manager.getTagById('missing')).toBeUndefined();
    });

    it('deleteTag 级联删除子标签', async () => {
        const { app } = makeAdapter();
        const manager = new KnowledgeTagManager(app as never);
        await manager.init();
        const parent = await manager.addTag({ name: '父', category: 'theme' });
        const child = await manager.addTag({ name: '子', category: 'theme', parentId: parent.id });
        const grandchild = await manager.addTag({ name: '孙', category: 'theme', parentId: child.id });

        await manager.deleteTag(parent.id);

        expect(manager.getTagById(parent.id)).toBeUndefined();
        expect(manager.getTagById(child.id)).toBeUndefined();
        expect(manager.getTagById(grandchild.id)).toBeUndefined();
    });

    it('getChildTags 只返回直接子级', async () => {
        const { app } = makeAdapter();
        const manager = new KnowledgeTagManager(app as never);
        await manager.init();
        const parent = await manager.addTag({ name: '父', category: 'theme' });
        const child = await manager.addTag({ name: '子', category: 'theme', parentId: parent.id });
        await manager.addTag({ name: '孙', category: 'theme', parentId: child.id });

        expect(manager.getChildTags(parent.id).map(tag => tag.name)).toEqual(['子']);
    });
});

describe('KnowledgeTagManager — 持久化往返', () => {
    it('新增标签后新实例能读回（名称/描述/分类）', async () => {
        const { app } = makeAdapter();
        const first = new KnowledgeTagManager(app as never);
        await first.init();
        await first.addTag({ name: '往返题材', category: 'theme', description: '保存后仍可见' });

        const second = new KnowledgeTagManager(app as never);
        await second.init();

        const restored = second.getTagByName('往返题材');
        expect(restored).toBeDefined();
        expect(restored?.category).toBe('theme');
        expect(restored?.description).toBe('保存后仍可见');
    });

    it('自定义 baseDir 写入对应目录', async () => {
        const { app, files } = makeAdapter();
        const manager = new KnowledgeTagManager(app as never, '自定义知识库');
        await manager.init();
        expect(files.has(kbTagSystemFile('自定义知识库'))).toBe(true);
    });
});

void vi;
