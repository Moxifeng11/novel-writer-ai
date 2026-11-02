/**
 * tool-registry.ts — 受守卫的工具注册表
 *
 * 移植自 DeepSeek Harness 的 Tool Registry / 执行管线：
 *   - schema（name/description/parameters）进入系统提示词组装；
 *   - 执行前做参数校验（必填/枚举/类型/未知键），校验失败返回结构化错误而不是抛异常；
 *   - 执行异常被捕获为失败结果，永远不把异常打进 agent loop；
 *   - 吸收 dsh `guard/timeout-policy`：工具声明 `timeoutMs` 时由注册表派生 deadline，
 *     超时返回结构化失败（不会让整个回合挂死）；工具自身的中止信号同时被触发。
 *   - 吸收 dsh `ResolvedToolSet`：每个模型 step 取一次工具集快照，装配与执行同源。
 */
import type { HarnessTool, HarnessToolContext, HarnessToolResult } from './harness-types';

/** 超时失败的稳定错误码（供模型/宿主识别） */
export const TOOL_TIMEOUT_CODE = 'TOOL_TIMEOUT';
/** 用户取消/外部中止的稳定错误码 */
export const TOOL_CANCELLED_CODE = 'TOOL_CANCELLED';
/** 只读工具的默认超时（未声明 timeoutMs 时） */
const DEFAULT_READONLY_TIMEOUT_MS = 30_000;

/** 某一模型 step 的工具集快照（dsh ResolvedToolSet）：装配与执行必须用同一份 */
export interface HarnessToolCatalog {
    readonly names: readonly string[];
    describeForPrompt(): string;
    get(name: string): HarnessTool | undefined;
    execute(toolName: string, rawArgs: unknown, ctx: HarnessToolContext): Promise<HarnessToolResult>;
}

function renderCatalog(tools: ReadonlyMap<string, HarnessTool>): string {
    const lines: string[] = [];
    for (const tool of tools.values()) {
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

/**
 * Harness 工具注册表。
 */
export class HarnessToolRegistry {
    private tools = new Map<string, HarnessTool>();

    /**
     * 注册工具。
     *
     * @param tool - 工具
     */
    register(tool: HarnessTool): void {
        if (this.tools.has(tool.name)) {
            throw new Error(`Harness tool 重复注册: ${tool.name}`);
        }
        this.tools.set(tool.name, tool);
    }

    /**
     * 已注册工具名（HarnessToolCatalog 的结构要求）
     *
     * @returns 结果数组
     */
    get names(): readonly string[] {
        return [...this.tools.keys()];
    }

    /**
     * 按名称取工具。
     *
     * @param name - 名称
     * @returns 工具或 undefined
     */
    get(name: string): HarnessTool | undefined {
        return this.tools.get(name);
    }

    /**
     * 列出全部工具。
     * @returns 工具数组
     */
    list(): HarnessTool[] {
        return [...this.tools.values()];
    }

    /**
     * 生成系统提示词里的工具目录段
     *
     * @returns 文本结果
     */
    describeForPrompt(): string {
        return renderCatalog(this.tools);
    }

    /**
     * 取本模型 step 的工具集快照：此后即使注册表增删工具，本 step 的
     * 提示词与执行仍使用同一份集合（dsh ResolvedToolSet 语义）。
      * @returns HarnessToolCatalog 实例
     */
    snapshot(): HarnessToolCatalog {
        const frozen = new Map(this.tools);
        return {
            names: [...frozen.keys()],
            describeForPrompt: () => renderCatalog(frozen),
            get: (name: string) => frozen.get(name),
            execute: (name: string, args: unknown, ctx: HarnessToolContext) =>
                this.runTool(frozen, name, args, ctx),
        };
    }

    /**
     * 执行一个工具调用；永不抛异常
     *
     * @param toolName - 工具名
     * @param rawArgs - 原始参数列表
     * @param ctx - 上下文
      * @returns HarnessToolResult 实例
     */
    async execute(
        toolName: string,
        rawArgs: unknown,
        ctx: HarnessToolContext,
    ): Promise<HarnessToolResult> {
        return this.runTool(this.tools, toolName, rawArgs, ctx);
    }

    private async runTool(
        tools: ReadonlyMap<string, HarnessTool>,
        toolName: string,
        rawArgs: unknown,
        ctx: HarnessToolContext,
    ): Promise<HarnessToolResult> {
        const tool = tools.get(toolName);
        if (!tool) {
            return { ok: false, content: `未知工具「${toolName}」。可用工具：${tools.size > 0 ? [...tools.keys()].join('、') : '无'}` };
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
     * 在派生 signal 上执行：超时/取消先 abort（工具内部可感知），
     * 同时用 race 保证宿主不会因为工具不响应 signal 而挂死。
     */
    private async runWithDeadline(
        tool: HarnessTool,
        args: Record<string, unknown>,
        ctx: HarnessToolContext,
    ): Promise<HarnessToolResult> {
        const declared = typeof tool.timeoutMs === 'number' && tool.timeoutMs > 0 ? tool.timeoutMs : 0;
        // 只读工具默认 30s；写/危险工具不设默认值（由工具自身的 timeoutMs 决定）
        const budget = declared || (tool.sideEffect === 'none' ? DEFAULT_READONLY_TIMEOUT_MS : 0);

        // 无论有没有超时预算，都派生 controller，保证取消能传到工具
        const upstream = ctx.signal;
        const controller = new AbortController();
        let timedOut = false;
        let cancelled = false;
        const onUpstreamAbort = () => {
            cancelled = true;
            controller.abort(upstream?.reason);
        };
        if (upstream) {
            if (upstream.aborted) {
                cancelled = true;
                controller.abort(upstream.reason);
            } else {
                upstream.addEventListener('abort', onUpstreamAbort, { once: true });
            }
        }
        const timer = budget > 0
            ? setTimeout(() => {
                timedOut = true;
                controller.abort(TOOL_TIMEOUT_CODE);
            }, budget)
            : null;

        const derivedCtx: HarnessToolContext = { ...ctx, signal: controller.signal };
        const aborted = new Promise<HarnessToolResult>(resolve => {
            const onAbort = () => resolve({
                ok: false,
                content: cancelled
                    ? `工具「${tool.name}」已取消。`
                    : `工具「${tool.name}」超时（${budget}ms），已中止。可以缩小范围后重试，或直接告诉用户当前进展。`,
                data: { errorCode: cancelled ? TOOL_CANCELLED_CODE : TOOL_TIMEOUT_CODE },
            });
            if (controller.signal.aborted) onAbort();
            else controller.signal.addEventListener('abort', onAbort, { once: true });
        });

        try {
            const result = await Promise.race([tool.execute(args, derivedCtx), aborted]);
            if (timedOut) {
                return {
                    ok: false,
                    content: `工具「${tool.name}」超时（${budget}ms），已中止。可以缩小范围后重试，或直接告诉用户当前进展。`,
                    data: { errorCode: TOOL_TIMEOUT_CODE },
                };
            }
            return result;
        } finally {
            if (timer) clearTimeout(timer);
            upstream?.removeEventListener('abort', onUpstreamAbort);
        }
    }
}

/**
 * 校验必填 / 枚举 / 类型 / 未知键；返回错误说明或 null
 *
 * @param tool - 工具
 * @param args - 参数列表
  * @returns 文本结果 或 null
 */
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

    // 未知参数直接拒绝：避免模型把别名/拼写错误当成有效输入
    const known = new Set(Object.keys(tool.parameters));
    const unknown = Object.keys(args).filter(key => !known.has(key));
    if (unknown.length > 0) {
        return `包含未知参数：${unknown.join('、')}（可用参数：${[...known].join('、') || '无'}）`;
    }

    for (const [name, schema] of Object.entries(tool.parameters)) {
        const value = args[name];
        if (value === undefined || value === null) continue;
        if (schema.enum && schema.enum.length > 0 && !schema.enum.includes(String(value))) {
            return `参数 ${name} 只能是：${schema.enum.join('/')}`;
        }
        if (schema.type === 'string') {
            if (typeof value !== 'string') return `参数 ${name} 必须是字符串`;
        } else if (schema.type === 'number') {
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
            if (schema.items) {
                const bad = value.findIndex(item => typeof item !== schema.items);
                if (bad >= 0) return `参数 ${name} 的第 ${bad + 1} 项必须是 ${schema.items}`;
            }
        }
    }
    return null;
}
