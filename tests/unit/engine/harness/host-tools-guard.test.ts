/**
 * Host 工具权限与参数边界（G7-4b）
 *
 * Agent 会无人值守调用这些工具：重点是「只允许本插件命令、模式不匹配要拦、
 * 危险命令必须用户确认、项目路径不接受穿越」这几条不能退化。
 */
import { describe, expect, it, vi } from 'vitest';
import { createHostTools, isMemoryKey, isDangerousCommand } from '../../../../engine/agent/harness/host-tools';
import type { AgentContext, GuideAgentPort } from '../../../../engine/agent/agent-types';

interface ToolResult { ok: boolean; content: string; data?: unknown }

function makeHarness(options: {
    port?: Partial<GuideAgentPort>;
    projects?: string[];
    pickedProject?: string;
} = {}) {
    const memory = { slots: {} as Record<string, unknown> };
    if (options.pickedProject) memory.slots.pickedProject = options.pickedProject;
    const plan = { steps: [] as Array<{ step: string; status: 'pending' | 'in_progress' | 'done' }> };
    const ctx = { projects: options.projects ?? [], activeProject: null, mode: 'long' } as unknown as AgentContext;
    const port = {
        listCommands: () => [],
        readFile: vi.fn(async () => null),
        searchVault: vi.fn(async () => []),
        runCommand: vi.fn(async () => true),
        getProjectStatus: vi.fn(async () => null),
        openStorySettings: vi.fn(() => true),
        openPreResearch: vi.fn(() => true),
        ...options.port,
    } as unknown as GuideAgentPort;
    const tools = createHostTools({ port, ctx, memory, plan });
    const call = async (name: string, args: Record<string, unknown> = {}): Promise<ToolResult> => {
        const tool = tools.find(item => item.name === name);
        if (!tool) throw new Error(`工具不存在: ${name}`);
        return await tool.execute(args, { memory, plan } as never) as ToolResult;
    };
    return { tools, call, port, memory, plan, ctx };
}

describe('命令白名单与危险确认', () => {
    it('拒绝非本插件命令（防提示注入执行 app:delete-file）', async () => {
        const h = makeHarness();
        const result = await h.call('run_command', { commandId: 'app:delete-file' });
        expect(result.ok).toBe(false);
        expect(result.content).toContain('只能执行本插件命令');
        expect(h.port.runCommand).not.toHaveBeenCalled();
    });

    it('模式不匹配时拦截长篇专属命令', async () => {
        const h = makeHarness({
            projects: ['短篇小说/书A'],
            pickedProject: '短篇小说/书A',
            port: { getProjectStatus: vi.fn(async () => ({ mode: 'short' })) } as never,
        });
        const result = await h.call('run_command', { commandId: 'novel-writer-chapter-settlement' });
        expect(result.ok).toBe(false);
        expect(result.content).toContain('仅适用于');
        expect(h.port.runCommand).not.toHaveBeenCalled();
    });

    it('危险命令缺少确认端口时拒绝执行', async () => {
        const h = makeHarness();
        const result = await h.call('run_command', { commandId: 'novel-writer-batch-chapters' });
        expect(result.ok).toBe(false);
        expect(result.content).toContain('已拒绝执行');
        expect(h.port.runCommand).not.toHaveBeenCalled();
    });

    it('用户拒绝确认时不执行', async () => {
        const confirm = vi.fn(async () => false);
        const h = makeHarness({ port: { confirmDangerousAction: confirm } as never });
        const result = await h.call('run_command', { commandId: 'novel-writer-batch-chapters', reason: '批量写 3 章' });
        expect(result.ok).toBe(false);
        expect(result.content).toContain('用户拒绝');
        expect(confirm).toHaveBeenCalledOnce();
        expect(h.port.runCommand).not.toHaveBeenCalled();
    });

    it('确认通过后执行一次', async () => {
        const h = makeHarness({ port: { confirmDangerousAction: vi.fn(async () => true) } as never });
        const result = await h.call('run_command', { commandId: 'novel-writer-batch-chapters' });
        expect(result.ok).toBe(true);
        expect(h.port.runCommand).toHaveBeenCalledWith('novel-writer-batch-chapters');
    });

    it('普通命令不需要确认', async () => {
        const confirm = vi.fn(async () => true);
        const h = makeHarness({ port: { confirmDangerousAction: confirm } as never });
        await h.call('run_command', { commandId: 'novel-writer-open-settings' });
        expect(confirm).not.toHaveBeenCalled();
        expect(h.port.runCommand).toHaveBeenCalledOnce();
    });

    it('isDangerousCommand 覆盖批量/结算/导出等写盘命令', () => {
        expect(isDangerousCommand('novel-writer-batch-chapters')).toBe(true);
        expect(isDangerousCommand('novel-writer-chapter-settlement')).toBe(true);
        expect(isDangerousCommand('novel-writer-export-manuscript')).toBe(true);
        expect(isDangerousCommand('novel-writer-open-settings')).toBe(false);
    });

    it('v4.72.0：prune/populate 进危险清单（Agent 执行前需确认）', () => {
        expect(isDangerousCommand('novel-writer-prune-sessions')).toBe(true);
        expect(isDangerousCommand('novel-writer-populate-setting-lib')).toBe(true);
        // rename-project 打开重命名 Modal 自带确认环，不走 dangerous
        expect(isDangerousCommand('novel-writer-rename-project')).toBe(false);
    });
});

describe('项目路径不接受穿越', () => {
    it('open_story_settings 对 ../.. 不落到端口', async () => {
        const h = makeHarness({ projects: ['长篇小说/书A'] });
        const result = await h.call('open_story_settings', { project: '../../etc' });
        expect(result.ok).toBe(false);
        expect(result.content).toContain('没有指定项目');
        expect(h.port.openStorySettings).not.toHaveBeenCalled();
    });

    it('命中真实项目时才打开', async () => {
        const h = makeHarness({ projects: ['长篇小说/书A'] });
        const result = await h.call('open_story_settings', { project: '书A' });
        expect(result.ok).toBe(true);
        expect(h.port.openStorySettings).toHaveBeenCalledWith('长篇小说/书A');
    });
});

describe('read_file / search_vault 参数边界', () => {
    it('offset/limit 被夹紧到合法范围', async () => {
        const readFile = vi.fn(async () => ({
            path: '长篇小说/书A/a.md',
            startLine: 1,
            endLine: 1,
            totalLines: 1,
            content: 'x',
            truncated: false,
        }));
        const h = makeHarness({ port: { readFile } as never });
        await h.call('read_file', { path: '长篇小说/书A/a.md', offset: -5, limit: 9999 });
        expect(readFile).toHaveBeenCalledWith('长篇小说/书A/a.md', { offset: 1, limit: 2000 });
    });

    it('文件不存在时提示不要臆造路径', async () => {
        const h = makeHarness();
        const result = await h.call('read_file', { path: '不存在.md' });
        expect(result.ok).toBe(false);
        expect(result.content).toContain('未找到文件');
    });

    it('search_vault 空关键词被拒绝，limit 夹紧', async () => {
        const searchVault = vi.fn(async () => []);
        const h = makeHarness({ port: { searchVault } as never });
        expect((await h.call('search_vault', { query: '   ' })).ok).toBe(false);
        await h.call('search_vault', { query: '玉佩', limit: 999 });
        expect(searchVault).toHaveBeenCalledWith('玉佩', { limit: 50, folder: undefined });
    });
});

describe('update_memory / update_plan', () => {
    it('只接受白名单记忆字段，忽略未知键', async () => {
        const h = makeHarness();
        const result = await h.call('update_memory', {
            slots: { projectName: ' 书A ', evil: 'x' },
        });
        expect(result.ok).toBe(true);
        expect(h.memory.slots.projectName).toBe('书A');
        expect(h.memory.slots.evil).toBeUndefined();
        expect(result.content).toContain('忽略未知字段');
    });

    it('非对象 slots 被拒绝', async () => {
        const h = makeHarness();
        expect((await h.call('update_memory', { slots: ['a'] })).ok).toBe(false);
    });

    it('isMemoryKey 只认白名单', () => {
        expect(isMemoryKey('projectName')).toBe(true);
        expect(isMemoryKey('__proto__')).toBe(false);
    });

    it('update_plan 写入合法计划，非法步骤被拒绝', async () => {
        const h = makeHarness();
        const bad = await h.call('update_plan', { steps: [{ step: '', status: 'done' }] });
        expect(bad.ok).toBe(false);

        const good = await h.call('update_plan', {
            steps: [
                { step: '写第1章', status: 'done' },
                { step: '写第2章', status: 'in_progress' },
            ],
        });
        expect(good.ok).toBe(true);
        expect(h.plan.steps).toHaveLength(2);
        expect(good.content).toContain('[in_progress] 写第2章');
    });
});

describe('全权限工具：写文件 / 删文件 / 移动 / 删项目', () => {
    it('注册了文件与项目写操作工具', () => {
        const h = makeHarness();
        const names = h.tools.map(tool => tool.name);
        expect(names).toEqual(expect.arrayContaining(['write_file', 'delete_file', 'move_file', 'delete_project']));
        expect(h.tools.find(tool => tool.name === 'delete_project')?.sideEffect).toBe('dangerous');
        expect(h.tools.find(tool => tool.name === 'delete_file')?.sideEffect).toBe('dangerous');
        expect(h.tools.find(tool => tool.name === 'write_file')?.sideEffect).toBe('write');
    });

    it('write_file 透传路径/内容/追加模式', async () => {
        const writeFile = vi.fn(async () => ({ path: '长篇小说/书A/设定.md', created: true, bytes: 3 }));
        const h = makeHarness({ port: { writeFile } as never });
        const result = await h.call('write_file', { path: '长篇小说/书A/设定.md', content: '内容', append: true });
        expect(result.ok).toBe(true);
        expect(writeFile).toHaveBeenCalledWith('长篇小说/书A/设定.md', '内容', { append: true });
    });

    it('delete_project 成功后刷新会话项目快照并清空当前项目', async () => {
        const deleteProject = vi.fn(async () => ({ project: '长篇小说/书A', deleted: true }));
        const h = makeHarness({
            projects: ['长篇小说/书A', '长篇小说/书B'],
            pickedProject: '长篇小说/书A',
            port: {
                deleteProject,
                listProjects: () => ['长篇小说/书B'],
            } as never,
        });
        h.ctx.activeProject = '长篇小说/书A';
        const result = await h.call('delete_project', { project: '书A' });
        expect(result.ok).toBe(true);
        expect(deleteProject).toHaveBeenCalledWith('长篇小说/书A');
        expect(h.ctx.projects).toEqual(['长篇小说/书B']);
        expect(h.ctx.activeProject).toBeNull();
    });

    it('删除已从快照消失的残留项目时可用完整路径', async () => {
        const deleteProject = vi.fn(async () => ({ project: '长篇小说/已删项目', deleted: true }));
        const h = makeHarness({ projects: [], port: { deleteProject } as never });
        const result = await h.call('delete_project', { project: '长篇小说/已删项目' });
        expect(result.ok).toBe(true);
        expect(deleteProject).toHaveBeenCalledWith('长篇小说/已删项目');
    });

    it('delete_project 失败时保留项目快照', async () => {
        const h = makeHarness({
            projects: ['长篇小说/书A'],
            pickedProject: '长篇小说/书A',
            port: { deleteProject: vi.fn(async () => ({ project: '长篇小说/书A', deleted: false, reason: '被占用' })) } as never,
        });
        const result = await h.call('delete_project', { project: '书A' });
        expect(result.ok).toBe(false);
        expect(result.content).toContain('被占用');
        expect(h.ctx.projects).toEqual(['长篇小说/书A']);
    });
});
