/**
 * Agent 工具动作分类快照测试
 *
 * 锁住「每个工具都声明了 kind」与关键工具的语义，避免新增工具漏声明。
 */

import { describe, expect, it } from 'vitest';
import { createHostTools } from '@/engine/agent/harness/host-tools';
import { resolveToolKind } from '@/shared/action-contract';

/** 构造最小依赖（只读工具注册不需要真实端口）。 */
const makeTools = () => createHostTools({
    port: {} as never,
    ctx: { activeProject: '', mode: 'long' } as never,
    memory: { slots: {} },
});

describe('Agent 工具动作分类', () => {
    it('全部工具都声明了 kind', () => {
        const tools = makeTools();
        expect(tools.length).toBeGreaterThanOrEqual(25);
        for (const tool of tools) {
            expect(tool.kind, tool.name).toBeTruthy();
        }
    });

    it('读类工具 = read', () => {
        const byName = new Map(makeTools().map(tool => [tool.name, tool]));
        for (const name of ['read_file', 'list_chapters', 'get_project_status', 'search_vault', 'open_chapter']) {
            expect(byName.get(name)?.kind, name).toBe('read');
        }
    });

    it('写文件/改记忆 = 写设定（路径决定正文时由 resolveToolKind 细化）', () => {
        const byName = new Map(makeTools().map(tool => [tool.name, tool]));
        expect(byName.get('write_file')?.kind).toBe('write-setting');
        expect(byName.get('update_memory')?.kind).toBe('write-setting');
    });

    it('建/删项目与执行命令 = 管理', () => {
        const byName = new Map(makeTools().map(tool => [tool.name, tool]));
        expect(byName.get('create_long_project')?.kind).toBe('admin');
        expect(byName.get('delete_project')?.kind).toBe('admin');
        expect(byName.get('run_command')?.kind).toBe('admin');
    });

    it('resolveToolKind：自声明优先，未声明回退推断', () => {
        expect(resolveToolKind({ name: 'whatever', kind: 'read' })).toBe('read');
        expect(resolveToolKind({ name: 'write_file' }, { path: '长篇小说/书A/03-正文/第01章.md' })).toBe('write-prose');
        expect(resolveToolKind({ name: 'unknown_tool' })).toBe('admin');
    });
});
