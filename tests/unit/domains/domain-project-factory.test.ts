/**
 * DomainProjectFactory — 短篇/剧本项目创建（G7-4）
 *
 * 重点：失败必须回滚半成品目录，否则重试会被 exists 判成「已存在」永久卡住。
 */
import { describe, expect, it, vi } from 'vitest';
import { Notice } from '../../__mocks__/obsidian';
import { DomainProjectFactory } from '../../../domains/kernel/domain-project-factory';
import { newProjectPath } from '../../../domains/kernel/project-locator';

function makeAdapter(options: { failWriteMatching?: RegExp } = {}) {
    const files = new Map<string, string>();
    const folders = new Set<string>();
    const log = { removed: [] as string[], rmdir: [] as string[] };

    const adapter = {
        exists: async (path: string) => files.has(path) || folders.has(path),
        mkdir: async (path: string) => { folders.add(path); },
        write: async (path: string, content: string) => {
            if (options.failWriteMatching && options.failWriteMatching.test(path)) {
                throw new Error(`模拟写盘失败: ${path}`);
            }
            files.set(path, content);
            const dir = path.slice(0, path.lastIndexOf('/'));
            if (dir) folders.add(dir);
        },
        read: async (path: string) => files.get(path) ?? '',
        list: async (dir: string) => ({
            files: [...files.keys()].filter(p => p.startsWith(`${dir}/`) && !p.slice(dir.length + 1).includes('/')),
            folders: [...folders].filter(f => f.startsWith(`${dir}/`) && !f.slice(dir.length + 1).includes('/')),
        }),
        remove: async (path: string) => { log.removed.push(path); files.delete(path); },
        rmdir: async (path: string, _recursive?: boolean) => {
            log.rmdir.push(path);
            folders.delete(path);
            for (const key of [...files.keys()]) if (key.startsWith(`${path}/`)) files.delete(key);
            for (const folder of [...folders]) if (folder.startsWith(`${path}/`)) folders.delete(folder);
        },
    };
    return { adapter, files, folders, log };
}

function makeFactory(adapter: unknown) {
    const plugin = {
        engineRegistry: { get: () => { throw new Error('测试不初始化写作配置'); } },
    };
    return new DomainProjectFactory({} as never, plugin as never, adapter as never);
}

const BASE_INPUT = {
    name: '短篇测试',
    mode: 'short' as const,
    genre: '都市日常',
    targetWords: 80000,
    targetUnits: 20,
};

void Notice;

describe('DomainProjectFactory — 创建成功', () => {
    it('写入 .project / 作品信息 / 创作模式指南，并回调 onCreated', async () => {
        const { adapter, files } = makeAdapter();
        const factory = makeFactory(adapter);
        const onCreated = vi.fn();

        const projectId = await factory.create({ ...BASE_INPUT, onCreated });

        expect(projectId).toBe(newProjectPath('短篇测试', 'short'));
        expect(files.get(`${projectId}/.project`)).toContain('创作模式');
        expect(files.get(`${projectId}/作品信息.md`)).toContain('短篇测试');
        expect(files.get(`${projectId}/00-系统模板/创作模式指南.md`)).toContain('番茄短篇小说');
        expect(onCreated).toHaveBeenCalledWith(projectId);
    });
});

describe('DomainProjectFactory — 前置校验', () => {
    it('非法名称在创建目录前被拒绝', async () => {
        const { adapter } = makeAdapter();
        const factory = makeFactory(adapter);
        await expect(factory.create({ ...BASE_INPUT, name: 'a' })).rejects.toThrow('项目名只能包含');
    });

    it('长篇模式必须走长篇入口', async () => {
        const { adapter } = makeAdapter();
        const factory = makeFactory(adapter);
        await expect(factory.create({ ...BASE_INPUT, mode: 'long' })).rejects.toThrow('长篇');
    });

    it('已存在同名项目时拒绝', async () => {
        const { adapter, folders } = makeAdapter();
        folders.add(newProjectPath('短篇测试', 'short'));
        const factory = makeFactory(adapter);
        await expect(factory.create(BASE_INPUT)).rejects.toThrow('已存在');
    });

    it('目标字数/单元数超范围时拒绝', async () => {
        const { adapter } = makeAdapter();
        const factory = makeFactory(adapter);
        await expect(factory.create({ ...BASE_INPUT, targetWords: 1000 })).rejects.toThrow('超出范围');
        await expect(factory.create({ ...BASE_INPUT, targetUnits: 999 })).rejects.toThrow('超出范围');
    });
});

describe('DomainProjectFactory — 失败回滚', () => {
    it('写盘中途失败 → 删除半成品目录并给出可重试的错误', async () => {
        const { adapter, folders, log } = makeAdapter({ failWriteMatching: /作品信息\.md$/ });
        const factory = makeFactory(adapter);

        await expect(factory.create(BASE_INPUT)).rejects.toThrow('已回滚');

        const projectId = newProjectPath('短篇测试', 'short');
        expect(log.rmdir).toContain(projectId);
        expect(folders.has(projectId)).toBe(false);
        // 回滚后重试不应再被判为「已存在」
        expect(await adapter.exists(projectId)).toBe(false);
    });
});
