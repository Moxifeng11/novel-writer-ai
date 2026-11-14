/**
 * 工具注册表守卫测试：只读模式拦截 Agent 写工具
 */

import { describe, expect, it, vi } from 'vitest';
import { HarnessToolRegistry } from '@/engine/agent/harness/tool-registry';
import type { HarnessTool } from '@/engine/agent/harness/harness-types';

/** 构造一个最小可执行工具。 */
const makeTool = (name: string, sideEffect: 'none' | 'write' = 'write'): HarnessTool => ({
    name,
    description: 'test tool',
    parameters: { path: { type: 'string', description: '路径' } },
    required: [],
    sideEffect,
    execute: vi.fn(async () => ({ ok: true, content: 'done' })),
});

describe('HarnessToolRegistry 守卫', () => {
    it('守卫拒绝时不执行工具', async () => {
        const tool = makeTool('write_file');
        const registry = new HarnessToolRegistry(() => '🔒 只读模式已开启');
        registry.register(tool);
        const result = await registry.execute('write_file', { path: 'a.md' }, {} as never);
        expect(result.ok).toBe(false);
        expect(result.content).toContain('只读模式');
        expect(tool.execute).not.toHaveBeenCalled();
    });

    it('守卫放行时正常执行', async () => {
        const tool = makeTool('write_file');
        const registry = new HarnessToolRegistry(() => null);
        registry.register(tool);
        const result = await registry.execute('write_file', { path: 'a.md' }, {} as never);
        expect(result.ok).toBe(true);
        expect(tool.execute).toHaveBeenCalled();
    });

    it('未提供守卫时行为不变', async () => {
        const tool = makeTool('read_file', 'none');
        const registry = new HarnessToolRegistry();
        registry.register(tool);
        const result = await registry.execute('read_file', { path: 'a.md' }, {} as never);
        expect(result.ok).toBe(true);
    });

    it('守卫收到的参数是校验后的对象', async () => {
        const guard = vi.fn(() => null);
        const registry = new HarnessToolRegistry(guard);
        registry.register(makeTool('write_file'));
        await registry.execute('write_file', { path: '长篇小说/书A/03-正文/第01章.md' }, {} as never);
        expect(guard).toHaveBeenCalledWith('write_file', { path: '长篇小说/书A/03-正文/第01章.md' });
    });

    it('参数校验失败时守卫不被调用', async () => {
        const guard = vi.fn(() => null);
        const tool: HarnessTool = {
            ...makeTool('write_file'),
            parameters: { path: { type: 'string', description: '路径' } },
            required: ['path'],
        };
        const registry = new HarnessToolRegistry(guard);
        registry.register(tool);
        const result = await registry.execute('write_file', {}, {} as never);
        expect(result.ok).toBe(false);
        expect(guard).not.toHaveBeenCalled();
    });
});
