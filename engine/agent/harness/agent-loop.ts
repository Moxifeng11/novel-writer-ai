/**
 * agent-loop.ts — Harness Agent Loop
 *
 * 移植自 DeepSeek Harness 的核心生命周期「call model, run tools, repeat」：
 *   turn 开始 → [组装上下文 → 调模型 → 解析工具调用 → 执行工具 → 结果写回日志] × N → 最终回复 → turn 结束。
 *
 * 与 dsh 的差异（Obsidian 插件环境的务实取舍）：
 *   - 会话日志在内存中（不落盘），但结构一致，保留后续持久化的可能；
 *   - 工具调用走 JSON 协议适配器（兼容任何 OpenAI 兼容端点，包括 Ollama），
 *     不依赖 provider 原生 function calling；
 *   - 步数预算（默认 6 步）防止模型循环调用工具。
 */
import { AgentSessionLog } from './session-log';
import { assembleHarnessSystemPrompt } from './prompt-sections';
import { fitTurnsToBudget, resolveContextBudget } from './context-fit';
import type { HarnessToolRegistry } from './tool-registry';
import type {
    DerivedTurn,
    HarnessAdapter,
    HarnessApprovalRequest,
    HarnessChip,
    HarnessMemoryState,
    HarnessToolContext,
} from './harness-types';
import {
    buildSpillBody,
    buildSpillReplacement,
    shouldSpill,
    DEFAULT_SPILL_POLICY,
    type SpillPolicy,
    type SpillSink,
} from './spill-store';
import { pushUsageScope } from '@/services/usage-ledger';

import { createLogger } from '@/shared/logger';

const logger = createLogger('AgentHarnessLoop');

/**
 * Harness 循环选项。
 */
export interface HarnessLoopOptions {
    adapter: HarnessAdapter;
    registry: HarnessToolRegistry;
    log: AgentSessionLog;
    memory: HarnessMemoryState;
    /** 创作计划状态（update_plan 工具读写） */
    plan?: { steps: import('./creation-plan').PlanStep[] };
    projects: string[];
    activeProject: string | null;
    /** 单个用户回合内最多模型调用次数（含工具后续步骤） */
    maxSteps?: number;
    temperature?: number;
    maxTokens?: number;
    signal?: AbortSignal;
    /**
     * 回合内收件箱（吸收 dsh agent-loop inbox / steering）：
     * 用户在一回合还在跑时补充的话，在这里被取出并插入会话日志，
     * 模型下一次调用就能看到，不必等整轮结束。
     */
    takeInbox?: () => string[];
    /**
     * 大结果落盘（吸收 dsh spill）：结果超过阈值时写盘并只留定位符。
     * 未提供时退化为投影裁剪（pruner），行为与旧版一致。
     */
    spill?: SpillSink;
    spillPolicy?: SpillPolicy;
    /**
     * 工具审批（dsh approval 的移植）。dangerous 工具没有审批端口时一律拒绝；
     * write 工具是否询问由 `writeApproval` 决定（Harness 默认 allow；Agent 工作台默认传入 ask）。
     */
    requestApproval?: (request: HarnessApprovalRequest) => Promise<boolean>;
    writeApproval?: 'allow' | 'ask';
    /** 模型上下文窗口（token）。提供后每步调用前按预算裁剪历史 */
    contextWindowTokens?: number;
    /** 预算预留（默认 2000 token，给输出与模板固定段） */
    contextHeadroomTokens?: number;
}

/**
 * 单回合结果。
 */
export interface HarnessLoopTurnResult {
    /** 最终给用户看的回复 */
    reply: string;
    chips: HarnessChip[];
    /** 本回合执行过的工具调用（data 为工具产出的结构化结果） */
    toolCalls: Array<{ tool: string; ok: boolean; summary: string; data?: Record<string, unknown> }>;
    /** 是否至少成功调用过一次模型 */
    usedAi: boolean;
    /** 模型/网络层失败（宿主应考虑降级） */
    failed: boolean;
    failReason?: string;
    /** 本回合落盘的大结果条数与节省下的字符数 */
    spilledResults: number;
    spilledChars: number;
    /** 本回合实际模型调用次数（含工具后续步骤） */
    modelSteps: number;
    /** 工具执行总耗时（毫秒） */
    toolMs: number;
    /** 为适配上下文被裁剪/丢弃的轮次数 */
    trimmedTurns: number;
    /** provider 返回的用量累计（若支持） */
    usage: { prompt: number; completion: number; total: number };
}

const DEFAULT_MAX_STEPS = 6;
const DEFAULT_TEMPERATURE = 0.6;
const DEFAULT_MAX_TOKENS = 2500;

/**
 * 深度键排序后再 stringify：仅属性顺序不同的参数应视为同一次调用（dsh canonicalize）
 *
 * @param value - 值
 * @returns 文本结果
 */
function canonicalizeArgs(value: unknown): string {
    const sort = (input: unknown): unknown => {
        if (Array.isArray(input)) return input.map(sort);
        if (input && typeof input === 'object') {
            const source = input as Record<string, unknown>;
            const sorted: Record<string, unknown> = {};
            for (const key of Object.keys(source).sort()) sorted[key] = sort(source[key]);
            return sorted;
        }
        return input;
    };
    try {
        return JSON.stringify(sort(value ?? {}));
    } catch {
        return String(value);
    }
}

/**
 * 从模型原始输出解析 JSON 协议；容错：代码块围栏、前后杂文本、非 JSON 纯文本
 *
 * @param raw - 原始
  * @returns HarnessChip[] } 实例
 */
export function parseAssistantTurn(raw: string): { reply: string; tool?: { name: string; args: Record<string, unknown> }; chips?: HarnessChip[] } {
    const text = String(raw || '').trim();
    if (!text) return { reply: '' };

    for (const candidate of extractJsonCandidates(text)) {
        try {
            const data = JSON.parse(candidate) as Record<string, unknown>;
            // 只认协议对象：含 reply / tool / chips 任意一个字段，
            // 否则前言里的 `{确认一下}` 之类也会被当成协议，导致空回复。
            if (!data || typeof data !== 'object'
                || (!('reply' in data) && !('tool' in data) && !('chips' in data))) {
                continue;
            }
            const reply = typeof data.reply === 'string' ? data.reply : '';
            const toolData = (data.tool && typeof data.tool === 'object' ? data.tool : null) as Record<string, unknown> | null;
            const toolName = toolData && typeof toolData.name === 'string' ? toolData.name : '';
            let tool: { name: string; args: Record<string, unknown> } | undefined;
            if (toolName) {
                tool = { name: toolName, args: normalizeToolArgs(toolData?.arguments) };
            }
            const chips = parseChips(data.chips);
            return { reply, tool, chips };
        } catch {
            // 换下一个候选
        }
    }
    return { reply: text };
}

/**
 * 工具参数：对象直接用；JSON 字符串（OpenAI 兼容端点常见）解析后使用
 *
 * @param value - 值
 * @returns 映射结果
 */
function normalizeToolArgs(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, unknown>;
    }
    if (typeof value === 'string' && value.trim()) {
        try {
            const parsed = JSON.parse(value);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return parsed as Record<string, unknown>;
            }
        } catch {
            // 非 JSON 字符串：当作空参数
        }
    }
    return {};
}

/**
 * 提取文本中所有平衡的 JSON 对象候选（优先代码围栏内的内容）。
 * 逐个尝试解析，由调用方挑选「协议对象」——只取第一个 `{` 会把前言里的花括号当协议。
 * @param text - 文本内容
 * @returns 结果数组
 */
export function extractJsonCandidates(text: string): string[] {
    const candidates: string[] = [];
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) {
        const block = extractBalancedObjects(fenced[1]);
        candidates.push(...block);
    }
    candidates.push(...extractBalancedObjects(text));
    return candidates;
}

/**
 * 文本中所有平衡的 {...} 片段（按出现顺序）
 *
 * @param text - 文本内容
 * @returns 结果数组
 */
function extractBalancedObjects(text: string): string[] {
    const objects: string[] = [];
    let index = 0;
    while (index < text.length) {
        const start = text.indexOf('{', index);
        if (start < 0) break;
        const end = findBalancedEnd(text, start);
        if (end < 0) break;
        objects.push(text.slice(start, end + 1));
        index = end + 1;
    }
    return objects;
}

/**
 * 从 start 处 `{` 开始找配对的 `}`，找不到返回 -1
 *
 * @param text - 文本内容
 * @param start - 起始位置
 * @returns 数值结果
 */
function findBalancedEnd(text: string, start: number): number {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
            if (escaped) escaped = false;
            else if (ch === '\\') escaped = true;
            else if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') inString = true;
        else if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

/**
 * 兼容旧调用方：返回第一个平衡 JSON 对象
 *
 * @param text - 文本内容
  * @returns 文本结果 或 null
 */
export function extractJsonBlock(text: string): string | null {
    const objects = extractBalancedObjects(String(text || ''));
    return objects.length > 0 ? objects[0] : null;
}

function parseChips(value: unknown): HarnessChip[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const chips: HarnessChip[] = [];
    for (const item of value) {
        if (!item || typeof item !== 'object') continue;
        const record = item as Record<string, unknown>;
        const label = typeof record.label === 'string' ? record.label.trim() : '';
        const chipValue = typeof record.value === 'string' ? record.value.trim() : label;
        if (!label && !chipValue) continue;
        chips.push({
            label: label || chipValue,
            value: chipValue || label,
            description: typeof record.description === 'string' ? record.description : undefined,
        });
        if (chips.length >= 6) break;
    }
    return chips.length > 0 ? chips : undefined;
}

function summarizeToolArgs(name: string, args: Record<string, unknown>): string {
    const keys = Object.keys(args);
    if (name === 'update_memory') return `记录 ${keys.length} 项信息`;
    const projectName = typeof args.projectName === 'string' ? args.projectName : '';
    if (projectName) return projectName;
    // 单个短字符串参数直接展示值（如 echo 的消息、open 的目标）
    if (keys.length === 1) {
        const value = args[keys[0]];
        if (typeof value === 'string' && value.length <= 40) return value;
    }
    if (name.startsWith('open_')) {
        const target = args.project || args.mode || '';
        return target ? String(target) : '打开界面';
    }
    return keys.length > 0 ? `${keys.slice(0, 3).join('、')}${keys.length > 3 ? ' 等' : ''}` : '执行完成';
}

/**
 * 运行一个用户回合。日志里应已包含本回合的 user_message（由引擎层写入）。
 * 返回最终回复与遥测；适配器失败时 failed=true，由宿主决定降级。
 *
 * 用量归因：回合最外层 pushUsageScope 挂上 source=agent + 当前项目，
 * 本回合所有模型调用的用量记录都会带上该归因；try/finally 覆盖回合内
 * 全部提前 return 与异常，保证 scope 一定退出。回合内再嵌套更细的 scope：
 * 每次模型调用挂 turn:<step>，每次工具执行挂 tool:<name>（见 runHarnessTurnInner）。
 * @param options - 配置项
 * @returns HarnessLoopTurnResult 实例
 */
export async function runHarnessTurn(options: HarnessLoopOptions): Promise<HarnessLoopTurnResult> {
    const exitUsage = pushUsageScope({ source: 'agent', project: options.activeProject ?? undefined });
    try {
        return await runHarnessTurnInner(options);
    } finally {
        exitUsage();
    }
}

/**
 * runHarnessTurn 的执行体（原逻辑不变；拆出以便用量 scope 包裹整个回合）。
 * @param options - 配置项
 * @returns HarnessLoopTurnResult 实例
 */
async function runHarnessTurnInner(options: HarnessLoopOptions): Promise<HarnessLoopTurnResult> {
    const {
        adapter, registry, log, memory, plan,
        projects, activeProject,
        maxSteps = DEFAULT_MAX_STEPS,
        temperature = DEFAULT_TEMPERATURE,
        maxTokens = DEFAULT_MAX_TOKENS,
        signal,
    } = options;

    const result: HarnessLoopTurnResult = {
        reply: '', chips: [], toolCalls: [], usedAi: false, failed: false,
        spilledResults: 0, spilledChars: 0,
        modelSteps: 0, toolMs: 0, trimmedTurns: 0,
        usage: { prompt: 0, completion: 0, total: 0 },
    };
    const budgetTokens = resolveContextBudget(options.contextWindowTokens, maxTokens, options.contextHeadroomTokens);
    let systemChars = 0;
    const spillPolicy = options.spillPolicy || DEFAULT_SPILL_POLICY;
    let lastToolContent = '';
    let lastToolFailed = false;
    /**
     * 整回合调用计数：key = 工具 + 规范化参数。
     * 旧实现只比对「上一次调用」，A-B-A-B 交替即可绕过写工具拦截。
     */
    const callCounts = new Map<string, number>();
    /** 每个 key 已提醒过的阈值（3/5/8），避免反复刷同一条提醒 */
    const remindedAt = new Map<string, Set<number>>();

    const drainInbox = (): void => {
        if (!options.takeInbox) return;
        const pending = options.takeInbox();
        for (const text of pending) {
            const trimmed = text.trim();
            if (!trimmed) continue;
            log.append({ type: 'user_message', text: `（用户在你执行过程中补充）${trimmed}` });
        }
    };

    for (let step = 0; step < maxSteps; step++) {
        if (signal?.aborted) {
            result.failed = true;
            result.failReason = '用户取消';
            return result;
        }
        // 回合内补充：每步调模型前把 inbox 里的用户消息写进日志
        drainInbox();

        // 本 step 的工具集快照：提示词与执行同源（dsh ResolvedToolSet）
        const toolset = registry.snapshot();
        const system = assembleHarnessSystemPrompt({
            projects,
            activeProject,
            memory,
            registry: toolset,
            planSteps: plan?.steps,
        });
        systemChars = system.length;
        const derived: DerivedTurn[] = log.derive();
        // 回合内预算：每次模型调用前裁剪，避免 6 次大工具结果撑爆窗口
        const fitted = fitTurnsToBudget(derived, budgetTokens, systemChars);
        result.trimmedTurns += fitted.trimmedTurns + fitted.droppedTurns;
        if (fitted.overBudget) {
            result.failed = true;
            result.failReason = `上下文超预算（约 ${fitted.estimatedTokens} token，预算 ${budgetTokens}）。请缩短本章参考或清理会话后重试。`;
            return result;
        }
        const turns = fitted.turns;

        let assistant;
        try {
            // 步骤级归因：本次模型调用的用量记到 turn:<step>。
            // 嵌套 scope 栈顶整体生效（不字段合并），必须重述 source/project；
            // push 紧贴本次调用，finally 保证退出，且不改外层 try/catch 语义。
            const exitStepUsage = pushUsageScope({
                source: 'agent',
                project: options.activeProject ?? undefined,
                stepKey: `turn:${step}`,
            });
            try {
                assistant = await adapter.complete({ system, turns, temperature, maxTokens, signal });
            } finally {
                exitStepUsage();
            }
        } catch (e) {
            result.failed = true;
            result.failReason = e instanceof Error ? e.message : String(e);
            return result;
        }
        if (!assistant) {
            result.failed = true;
            result.failReason = '模型调用失败';
            return result;
        }
        result.usedAi = true;
        result.modelSteps += 1;
        if (assistant.usage) {
            result.usage.prompt += Number(assistant.usage.prompt) || 0;
            result.usage.completion += Number(assistant.usage.completion) || 0;
            result.usage.total += Number(assistant.usage.total) || 0;
        }

        const parsed = parseAssistantTurn(assistant.raw || '') ?? assistant;
        const reply = parsed.reply || assistant.reply || '';
        const tool = parsed.tool || assistant.tool;
        const chips = parsed.chips || assistant.chips;

        // 最终回复：无工具调用 → 回合结束
        if (!tool || !tool.name) {
            log.append({ type: 'assistant_message', text: reply });
            result.reply = reply;
            result.chips = chips || [];
            return result;
        }

        // 工具回合：记录 assistant + tool_call → 执行 → tool_result 写回日志 → 下一步
        log.append({ type: 'assistant_message', text: reply || `（调用工具 ${tool.name}）` });
        const callId = log.nextCallId(tool.name);
        log.append({ type: 'tool_call', callId, tool: tool.name, args: tool.args });

        if (signal?.aborted) {
            result.failed = true;
            result.failReason = '用户取消';
            return result;
        }

        // 重复调用策略（吸收 dsh repeat-tool-reminder，按副作用分级）：
        // - write / dangerous：第二次重复直接拦截（重复建项目、重复批量生成的破坏不可逆）；
        // - none（只读/查询）：允许重跑，但在 3/5/8 连续重复时注入一条上下文提醒，
        //   让模型自己意识到在原地打转（dsh 的 advisory 语义，不硬否决）。
        const callKey = `${tool.name}|${canonicalizeArgs(tool.args)}`;
        const repeatCount = (callCounts.get(callKey) || 0) + 1;
        callCounts.set(callKey, repeatCount);
        const toolDef = toolset.get(tool.name);
        const sideEffect = toolDef?.sideEffect ?? 'write';

        let toolResult: { ok: boolean; content: string; data?: Record<string, unknown> } | null = null;
        let toolDurationMs: number | undefined;
        let approvalGranted = false;
        if (sideEffect !== 'none' && repeatCount >= 2) {
            toolResult = {
                ok: false,
                content: `重复调用已被阻止：本回合已经用相同参数执行过「${tool.name}」（第 ${repeatCount} 次）。请直接使用上一次的结果继续，或换一种做法。`,
            };
        } else {
            if (sideEffect === 'none' && [3, 5, 8].includes(repeatCount)) {
                const reminded = remindedAt.get(callKey) ?? new Set<number>();
                if (!reminded.has(repeatCount)) {
                    reminded.add(repeatCount);
                    remindedAt.set(callKey, reminded);
                    log.append({
                        type: 'context_message',
                        text: `【系统提醒】你已连续 ${repeatCount} 次用完全相同的参数调用「${tool.name}」。`
                            + '如果任务还没完成，请换一种做法或换个参数；如果信息已经足够，请直接给出结论。',
                    });
                }
            }

            // 审批：dangerous 一律 fail-closed；write 按会话策略（工作台默认 ask）。
            const needsApproval = sideEffect === 'dangerous'
                || (sideEffect === 'write' && options.writeApproval === 'ask');
            if (needsApproval) {
                const approved = options.requestApproval
                    ? await options.requestApproval({
                        tool: tool.name,
                        args: tool.args,
                        sideEffect: sideEffect === 'dangerous' ? 'dangerous' : 'write',
                        reason: summarizeToolArgs(tool.name, tool.args),
                    })
                    : false;
                if (!approved) {
                    toolResult = {
                        ok: false,
                        content: `用户未批准执行「${tool.name}」。不要重复尝试；请说明你打算做什么，或改用无需写入的方式。`,
                    };
                } else {
                    approvalGranted = true;
                }
            }
            if (!toolResult) {
                const toolCtx: HarnessToolContext = {
                    memory: { slots: { ...memory.slots } },
                    plan,
                    signal,
                    approvalGranted,
                };
                const startedAt = Date.now();
                // 工具级归因：工具执行期间（含未来工具内部的 AI 调用）的用量记到 tool:<name>。
                // 同样重述 source/project（嵌套栈顶整体生效）；只包住本次 execute，不改控制流。
                const exitToolUsage = pushUsageScope({
                    source: 'agent',
                    project: options.activeProject ?? undefined,
                    stepKey: `tool:${tool.name}`,
                });
                try {
                    toolResult = await toolset.execute(tool.name, tool.args, toolCtx);
                } finally {
                    exitToolUsage();
                }
                toolDurationMs = Date.now() - startedAt;
                result.toolMs += toolDurationMs;
            }
        }
        const finalToolResult = toolResult ?? { ok: false, content: '工具未执行' };
        // 大结果落盘（dsh spill）：原文进 .sessions，日志只留定位符 + 头尾摘要。
        // 写盘失败时保留原文（宁可多花 token，也不能丢结果）。
        let resultContent = finalToolResult.content;
        if (options.spill && shouldSpill(resultContent, spillPolicy)) {
            try {
                const original = resultContent;
                const locator = await options.spill.write(`${tool.name}-${callId}`, buildSpillBody(tool.name, original));
                if (locator) {
                    const replacement = buildSpillReplacement(original, locator, spillPolicy);
                    result.spilledResults += 1;
                    result.spilledChars += Math.max(0, original.length - replacement.length);
                    resultContent = replacement;
                }
            } catch (e) {
                logger.warn('大结果落盘失败，保留原文:', e);
            }
        }
        lastToolContent = resultContent;
        lastToolFailed = !finalToolResult.ok;
        log.append({
            type: 'tool_result',
            callId,
            tool: tool.name,
            ok: finalToolResult.ok,
            content: resultContent,
            data: finalToolResult.data,
            durationMs: toolDurationMs,
        });
        result.toolCalls.push({
            tool: tool.name,
            ok: finalToolResult.ok,
            summary: summarizeToolArgs(tool.name, tool.args),
            data: finalToolResult.data,
        });

        // 工具执行后若没有下一步模型调用的预算，直接把工具结果作为回复兜底
        if (step === maxSteps - 1) {
            // 最后一步工具失败时不能再以模型「动手前」的承诺当成功：
            // 旧实现优先返回 reply，用户看到「正在导出」而不是失败原因。
            if (lastToolFailed) {
                result.failed = true;
                result.failReason = lastToolContent || `${tool.name} 执行失败`;
                result.reply = lastToolContent;
            } else {
                result.reply = reply || lastToolContent || `已完成 ${tool.name}。`;
            }
            result.chips = chips || [];
            return result;
        }
    }

    result.failed = true;
    result.failReason = `超过单回合步数上限（${maxSteps}）`;
    return result;
}
