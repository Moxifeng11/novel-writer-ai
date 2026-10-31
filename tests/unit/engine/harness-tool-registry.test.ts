import { describe, it, expect } from 'vitest';
import { ToolRegistry, type HarnessTool } from '../../../engine/harness/tool-registry';

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

});