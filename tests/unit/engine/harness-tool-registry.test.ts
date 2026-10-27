import { describe, it, expect } from 'vitest';
import { ToolRegistry, type HarnessTool } from '../../../engine/harness/tool-registry';
import { createBuiltinHarnessTools } from '../../../engine/harness/builtin-tools';

function tool(overrides: Partial<HarnessTool> = {}): HarnessTool {
    return {
        id: 'test.echo',
        mode: 'all',
        kind: 'local',
        title: 'echo',
        description: 'echo',
        permission: 'read',
        async run(input) { return input; },
        ...overrides,
    } as HarnessTool;
}

describe('ToolRegistry', () => {
    it('注册、按模式过滤、执行', async () => {
        const registry = new ToolRegistry();
        registry.register(tool());
        registry.register(tool({ id: 'short.only', mode: 'short' }));
        expect(registry.list('long').map(t => t.id)).toEqual(['test.echo']);
        expect(registry.list('short').map(t => t.id)).toContain('short.only');
        const result = await registry.execute('test.echo', { a: 1 });
        expect(result.ok).toBe(true);
        expect(result.value).toEqual({ a: 1 });
    });

    it('重复注册与未知工具返回结构化错误', async () => {
        const registry = new ToolRegistry();
        registry.register(tool());
        expect(() => registry.register(tool())).toThrow(/已注册/);
        const unknown = await registry.execute('missing', {});
        expect(unknown.ok).toBe(false);
        expect(unknown.error).toContain('未注册');
    });

    it('危险/写 vault/网络工具需要权限', async () => {
        const registry = new ToolRegistry();
        registry.register(tool({ id: 'danger', permission: 'danger' }));
        registry.register(tool({ id: 'vault', permission: 'write-vault' }));
        registry.register(tool({ id: 'net', permission: 'network' }));
        expect((await registry.execute('danger', {})).error).toContain('danger');
        expect((await registry.execute('vault', {})).error).toContain('write-vault');
        expect((await registry.execute('net', {})).error).toContain('network');
        expect((await registry.execute('danger', {}, { permissions: ['danger'] })).error).toContain('确认');
        expect((await registry.execute('danger', {}, { permissions: ['danger'], confirmDanger: true })).ok).toBe(true);
    });

    it('内置工具覆盖短篇/剧本核心校验', async () => {
        const registry = new ToolRegistry();
        registry.registerAll(createBuiltinHarnessTools());
        expect(registry.has('short.random-brief')).toBe(true);
        expect(registry.has('short.section-words')).toBe(true);
        expect(registry.has('script.shot-duration')).toBe(true);
        expect(registry.has('script.hook-3s')).toBe(true);

        const words = await registry.execute('short.section-words', { text: '字'.repeat(2000) });
        expect(words.ok).toBe(true);
        const duration = await registry.execute('script.shot-duration', { durations: [30, 30, 25], targetSeconds: 90 });
        expect(duration.ok).toBe(true);
        const hook = await registry.execute('script.hook-3s', { text: '她被当众泼了一身酒，反手亮出股权书。' });
        expect(hook.ok).toBe(true);
    });
});