/**
 * tool-registry.ts — 受守卫的工具注册表
 *
 * 移植自 DeepSeek Harness 的 Tool Registry / 执行管线：
 *   - schema（name/description/parameters）进入系统提示词组装；
 *   - 执行前做参数校验（必填/枚举/类型），校验失败返回结构化错误而不是抛异常；
 *   - 执行异常被捕获为失败结果，永远不把异常打进 agent loop；
 *   - 吸收 dsh `guard/timeout-policy`：工具声明 `timeoutMs` 时由注册表派生 deadline，
 *     超时返回结构化失败（不会让整个回合挂死）；工具自身的中止信号同时被触发。
 */
import type { HarnessTool, HarnessToolContext, HarnessToolResult } from './harness-types';

/** 超时失败的稳定错误码（供模型/宿主识别） */
export const TOOL_TIMEOUT_CODE = 'TOOL_TIMEOUT';

export class HarnessToolRegistry {
    private tools = new Map<string, HarnessTool>();

    register(tool: HarnessTool): void {
        if (this.tools.has(tool.name)) {
            throw new Error(`Harness tool 重复注册: ${tool.name}`);
        }
        this.tools.set(tool.name, tool);
    }

    get(name: string): HarnessTool | undefined {
        return this.tools.get(name);
    }

    list(): HarnessTool[] {
        return [...this.tools.values()];
    }

    /** 生成系统提示词里的工具目录段 */
    describeForPrompt(): string {
        const lines: string[] = [];
        for (const tool of this.tools.values()) {
            lines.push(`### ${tool.name}`);
            lines.push(tool.description);
            const params = Object.entries(tool.parameters);
            if (params.length > 0) {
                lines.push('参数：');
                for (const [name, schema] of params) {
                    const required = tool.required.includes(name) ? '必填' : '可选';
                    const enumText = schema.enum && schema.enum.length > 0 ? `，只能是：${schema.enum.join('/')}` : '';
                    lines.push(`- ${name}（${schema.type}，${required}）：${schema.description}${enumText}`);
                }
            } else {
                lines.push('参数：无');
            }
            // 副作用提示（吸收 dsh tool metadata 的呈现方式）：让模型知道哪些工具
            // 会改数据、哪些需要用户确认，减少盲目重复调用。
            if (tool.sideEffect === 'dangerous') {
                lines.push('副作用：高成本/破坏性操作，执行前会请求用户确认；被拒绝后不要重复尝试。');
            } else if (tool.sideEffect === 'write') {
                lines.push('副作用：会修改宿主数据；同一参数重复调用会被拦截。');
            }
        }
        return lines.join('\n');
    }

    /** 执行一个工具调用；永不抛异常 */
    async execute(
        toolName: string,
        rawArgs: unknown,
        ctx: HarnessToolContext,
    ): Promise<HarnessToolResult> {
        const tool = this.tools.get(toolName);
        if (!tool) {
            return { ok: false, content: `未知工具「${toolName}」。可用工具：${this.tools.size > 0 ? [...this.tools.keys()].join('、') : '无'}` };
        }

        const args = (rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs))
            ? rawArgs as Record<string, unknown>
            : {};
        const validationError = validateArgs(tool, args);
        if (validationError) {
            return { ok: false, content: `工具「${toolName}」参数校验失败：${validationError}` };
        }

        try {
            return await this.runWithDeadline(tool, args, ctx);
        } catch (e) {
            return {
                ok: false,
                content: `工具「${toolName}」执行异常：${e instanceof Error ? e.message : String(e)}`,
            };
        }
    }

    /**
     * 有预算的工具在派生 signal 上执行：超时先 abort（工具内部可感知），
     * 再把结果替换为结构化超时失败。工具的 Promise 不被丢弃（避免未处理 rejection）。
     */
    private async runWithDeadline(
        tool: HarnessTool,
        args: Record<string, unknown>,
        ctx: HarnessToolContext,
    ): Promise<HarnessToolResult> {
        const budget = typeof tool.timeoutMs === 'number' && tool.timeoutMs > 0 ? tool.timeoutMs : 0;
        if (!budget) return tool.execute(args, ctx);

        const upstream = ctx.signal;
        const controller = new AbortController();
        let timedOut = false;
        const onUpstreamAbort = () => controller.abort(upstream?.reason);
        if (upstream) {
            if (upstream.aborted) controller.abort(upstream.reason);
            else upstream.addEventListener('abort', onUpstreamAbort, { once: true });
        }
        const timer = setTimeout(() => {
            timedOut = true;
            controller.abort(TOOL_TIMEOUT_CODE);
        }, budget);

        const derivedCtx: HarnessToolContext = { ...ctx, signal: controller.signal };
        try {
            const result = await tool.execute(args, derivedCtx);
            if (timedOut) {
                return {
                    ok: false,
                    content: `工具「${tool.name}」超时（${budget}ms），已中止。可以缩小范围后重试，或直接告诉用户当前进展。`,
                    data: { errorCode: TOOL_TIMEOUT_CODE },
                };
            }
            return result;
        } finally {
            clearTimeout(timer);
            upstream?.removeEventListener('abort', onUpstreamAbort);
        }
    }
}

/** 校验必填 / 枚举 / 类型；返回错误说明或 null */
export function validateArgs(tool: HarnessTool, args: Record<string, unknown>): string | null {
    const missing: string[] = [];
    for (const name of tool.required) {
        const value = args[name];
        if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) {
            missing.push(name);
        }
    }
    if (missing.length > 0) {
        return `缺少必填参数：${missing.join('、')}`;
    }

    for (const [name, schema] of Object.entries(tool.parameters)) {
        const value = args[name];
        if (value === undefined || value === null) continue;
        if (schema.enum && schema.enum.length > 0 && !schema.enum.includes(String(value))) {
            return `参数 ${name} 只能是：${schema.enum.join('/')}`;
        }
        if (schema.type === 'number') {
            const num = typeof value === 'number' ? value : Number(value);
            if (!Number.isFinite(num)) return `参数 ${name} 必须是数字`;
        } else if (schema.type === 'boolean') {
            if (typeof value !== 'boolean' && value !== 'true' && value !== 'false') {
                return `参数 ${name} 必须是布尔值`;
            }
        } else if (schema.type === 'object') {
            if (typeof value !== 'object' || Array.isArray(value)) {
                return `参数 ${name} 必须是对象`;
            }
        } else if (schema.type === 'array') {
            if (!Array.isArray(value)) {
                return `参数 ${name} 必须是数组`;
            }
        }
    }
    return null;
}
