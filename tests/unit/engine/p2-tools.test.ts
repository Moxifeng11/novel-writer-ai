/**
 * P2 工具集测试：patch_file / read_chapter / write_chapter / memory_* / open_view
 *
 * 用假端口验证工具行为（参数整理、失败文案、动作分类），不依赖 Obsidian。
 */

import { describe, expect, it, vi } from 'vitest';
import { createP2Tools } from '@/engine/agent/harness/p2-tools';
import type { GuideAgentPort } from '@/engine/agent/agent-types';

/** 造一个最小端口。 */
const makePort = (overrides: Partial<GuideAgentPort> = {}): GuideAgentPort => ({
    createProject: vi.fn(),
    openWizard: vi.fn(),
    openStorySettings: vi.fn(),
    openFullWriter: vi.fn(),
    openPreResearch: vi.fn(),
    ...overrides,
} as unknown as GuideAgentPort);

const toolOf = (port: GuideAgentPort, name: string) => {
    const tool = createP2Tools({ port }).find(item => item.name === name);
    if (!tool) throw new Error(`工具不存在: ${name}`);
    return tool;
};

describe('P2 工具集', () => {
    it('新增 6 个工具且都有 kind', () => {
        const tools = createP2Tools({ port: makePort() });
        expect(tools.map(tool => tool.name)).toEqual([
            'patch_file', 'read_chapter', 'write_chapter', 'memory_search', 'memory_patch', 'open_view',
        ]);
        for (const tool of tools) expect(tool.kind, tool.name).toBeTruthy();
    });

    it('patch_file 成功时返回已替换', async () => {
        const port = makePort({ patchFile: vi.fn(async () => ({ changed: true })) });
        const result = await toolOf(port, 'patch_file').execute({ path: 'a.md', oldText: '旧', newText: '新' }, {} as never);
        expect(result.ok).toBe(true);
        expect(port.patchFile).toHaveBeenCalledWith('a.md', '旧', '新');
    });

    it('patch_file 失败时把原因透给模型', async () => {
        const port = makePort({ patchFile: vi.fn(async () => ({ changed: false, error: '片段出现多次' })) });
        const result = await toolOf(port, 'patch_file').execute({ path: 'a.md', oldText: 'x', newText: 'y' }, {} as never);
        expect(result.ok).toBe(false);
        expect(result.content).toContain('片段出现多次');
    });

    it('read_chapter 找不到时给出明确提示', async () => {
        const port = makePort({ readChapter: vi.fn(async () => null) });
        const result = await toolOf(port, 'read_chapter').execute({ chapter: '第9章' }, {} as never);
        expect(result.ok).toBe(false);
        expect(result.content).toContain('找不到章节');
    });

    it('read_chapter 成功时内容被不可信围栏包裹', async () => {
        const port = makePort({ readChapter: vi.fn(async () => ({ path: 'p/第1章.md', content: '正文' })) });
        const result = await toolOf(port, 'read_chapter').execute({ chapter: '第1章' }, {} as never);
        expect(result.ok).toBe(true);
        expect(result.content).toContain('正文');
        expect(result.content).toContain('p/第1章.md');
    });

    it('write_chapter 是危险副作用工具', () => {
        expect(toolOf(makePort(), 'write_chapter').sideEffect).toBe('dangerous');
        expect(toolOf(makePort(), 'write_chapter').kind).toBe('write-prose');
    });

    it('write_chapter 失败透传错误', async () => {
        const port = makePort({ writeChapter: vi.fn(async () => ({ path: '', ok: false, error: '找不到该章节' })) });
        const result = await toolOf(port, 'write_chapter').execute({ chapter: '第1章', content: 'x' }, {} as never);
        expect(result.ok).toBe(false);
        expect(result.content).toContain('找不到该章节');
    });

    it('memory_search 无结果时返回空提示', async () => {
        const port = makePort({ memorySearch: vi.fn(async () => []) });
        const result = await toolOf(port, 'memory_search').execute({ query: '林玄' }, {} as never);
        expect(result.ok).toBe(true);
        expect(result.content).toContain('没有匹配');
    });

    it('memory_search 有结果时列出名称/类型/路径', async () => {
        const port = makePort({ memorySearch: vi.fn(async () => ([
            { path: 'p/人物/林玄.md', name: '林玄', type: 'character', summary: '主角' },
        ])) });
        const result = await toolOf(port, 'memory_search').execute({ query: '林玄' }, {} as never);
        expect(result.ok).toBe(true);
        expect(result.content).toContain('林玄');
        expect(result.content).toContain('主角');
        expect(result.content).toContain('p/人物/林玄.md');
    });

    it('memory_patch 失败透传原因', async () => {
        const port = makePort({ memoryPatch: vi.fn(async () => ({ changed: false, error: '找不到原文' })) });
        const result = await toolOf(port, 'memory_patch').execute({ path: 'a.md', oldText: 'x', newText: 'y' }, {} as never);
        expect(result.ok).toBe(false);
        expect(result.content).toContain('找不到原文');
    });

    it('open_view 传递 viewId 与项目', async () => {
        const port = makePort({ openView: vi.fn(async () => true) });
        const result = await toolOf(port, 'open_view').execute({ viewId: 'planning', project: '长篇小说/书A' }, {} as never);
        expect(result.ok).toBe(true);
        expect(port.openView).toHaveBeenCalledWith('planning', '长篇小说/书A');
    });

    it('open_view 失败时列出可用视图', async () => {
        const port = makePort({ openView: vi.fn(async () => false) });
        const result = await toolOf(port, 'open_view').execute({ viewId: 'nope' }, {} as never);
        expect(result.ok).toBe(false);
        expect(result.content).toContain('planning/memory');
    });

    it('端口不支持时工具给出明确不可用提示', async () => {
        const port = makePort();
        const result = await toolOf(port, 'patch_file').execute({ path: 'a.md', oldText: 'x', newText: 'y' }, {} as never);
        expect(result.ok).toBe(false);
        expect(result.content).toContain('不支持');
    });
});
