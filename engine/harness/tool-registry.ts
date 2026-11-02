/**
 * tool-registry.ts - harness tool registration and dispatch.
 *
 * Tools are local / ai / io. IO tools must declare a permission; danger tools
 * require explicit confirmation from the caller.
 */
import type { CreationMode } from '../../shared/creation-mode';

/**
 * 工具权限。
 */
export type ToolPermission = 'read' | 'write-project' | 'write-vault' | 'network' | 'danger';

/**
 * 工具上下文。
 */
export interface ToolContext {
    projectId?: string;
    taskId?: string;
    signal?: AbortSignal;
    /** caller-declared permissions; danger/write-vault must be present to run */
    permissions?: ToolPermission[];
    confirmDanger?: boolean;
}

/**
 * 工具结果。
 */
export interface ToolResult<T = unknown> {
    ok: boolean;
    toolId: string;
    value?: T;
    error?: string;
    durationMs: number;
}

/**
 * Harness 工具定义。
 */
export interface HarnessTool<Input = unknown, Output = unknown> {
    id: string;
    mode: CreationMode | 'all';
    kind: 'local' | 'ai' | 'io';
    title: string;
    description: string;
    inputSchema?: unknown;
    outputSchema?: unknown;
    permission: ToolPermission;
    run(input: Input, ctx: ToolContext): Promise<Output>;
}

/**
 * 工具注册表。
 */
export class ToolRegistry {
    private tools = new Map<string, HarnessTool>();

    /**
     * 注册工具。
     *
     * @param tool - 参数
     */
    register(tool: HarnessTool): void {
        if (!tool.id.trim()) throw new Error('ToolRegistry: tool.id 不能为空');
        if (this.tools.has(tool.id)) throw new Error(`ToolRegistry: 工具 ${tool.id} 已注册`);
        this.tools.set(tool.id, tool);
    }

    /**
     * 批量注册。
     *
     * @param tools - 参数
     */
    registerAll(tools: HarnessTool[]): void {
        for (const tool of tools) this.register(tool);
    }

    /**
     * 是否存在。
     *
     * @param id - 参数
     * @returns 布尔值
     */
    has(id: string): boolean {
        return this.tools.has(id);
    }

    /**
     * 取工具。
     *
     * @param id - 参数
     * @returns 工具或 undefined
     */
    get(id: string): HarnessTool | undefined {
        return this.tools.get(id);
    }

    /**
     * 按模式列出工具。
     *
     * @param mode? - 参数
     * @returns 工具数组
     */
    list(mode?: CreationMode): HarnessTool[] {
        const all = [...this.tools.values()];
        return mode ? all.filter(tool => tool.mode === 'all' || tool.mode === mode) : all;
    }

    async execute<Output = unknown>(id: string, input: unknown, ctx: ToolContext = {}): Promise<ToolResult<Output>> {
        const started = Date.now();
        const tool = this.tools.get(id) as HarnessTool | undefined;
        if (!tool) {
            return { ok: false, toolId: id, error: `未注册工具：${id}`, durationMs: Date.now() - started };
        }
        const permissions = ctx.permissions || [];
        if ((tool.permission === 'write-vault' || tool.permission === 'danger') && !permissions.includes(tool.permission)) {
            return { ok: false, toolId: id, error: `缺少权限：${tool.permission}`, durationMs: Date.now() - started };
        }
        if (tool.permission === 'danger' && ctx.confirmDanger !== true) {
            return { ok: false, toolId: id, error: '危险工具需要显式确认', durationMs: Date.now() - started };
        }
        if (tool.permission === 'network' && !permissions.includes('network')) {
            return { ok: false, toolId: id, error: '缺少权限：network', durationMs: Date.now() - started };
        }
        try {
            const value = await tool.run(input, ctx) as Output;
            return { ok: true, toolId: id, value, durationMs: Date.now() - started };
        } catch (e) {
            return {
                ok: false,
                toolId: id,
                error: e instanceof Error ? e.message : String(e),
                durationMs: Date.now() - started,
            };
        }
    }
}

export function createTool<Input, Output>(tool: HarnessTool<Input, Output>): HarnessTool<Input, Output> {
    return tool;
}