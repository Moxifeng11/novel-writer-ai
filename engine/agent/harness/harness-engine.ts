/**
 * harness-engine.ts — Harness 对话引擎（对外表面与 GuideAgentEngine 对齐）
 *
 * 职责：把 agent loop（模型+工具）包装成 UI 可直接使用的引擎：
 *   start() / handle(text) → AgentTurnResult（消息 + chips + 工具调用摘要）。
 * 工具在 loop 内直接执行宿主动作，不再走 modal 的 reportAction 二段式；
 * 适配器失败时返回带降级 chip 的提示，由宿主切换到规则引擎。
 */
import { AgentSessionLog } from './session-log';
import { HarnessToolRegistry } from './tool-registry';
import { runHarnessTurn } from './agent-loop';
import { createHostTools, type HostToolDeps } from './host-tools';
import type {
    HarnessAdapter,
    HarnessChip,
    HarnessMemoryState,
    HarnessTurnOutcome,
} from './harness-types';
import type { AgentContext, AgentIntent } from '../agent-types';
import { formatPlanForPrompt, type PlanStep } from './creation-plan';

/** 会话压缩配置（吸收 dsh compaction：压力触发 → 范围替换为单个摘要节点） */
export interface HarnessCompactionOptions {
    /** 派生轮次超过该阈值时触发压缩（默认 30） */
    thresholdTurns?: number;
    /** 压缩后保留的最近轮次（默认 12） */
    keepTurns?: number;
    /**
     * 投影字符数超过该阈值时也触发压缩（默认 32000）。
     * dsh 按 token 压力触发；本插件用字符数近似，避免几段超长工具结果一直占满上下文。
     */
    thresholdChars?: number;
}

export interface AgentHarnessEngineOptions {
    ctx: AgentContext;
    adapter: HarnessAdapter;
    portDeps: Omit<HostToolDeps, 'memory'>;
    maxSteps?: number;
    temperature?: number;
    maxTokens?: number;
    signal?: AbortSignal;
    /** 会话压缩；不传则不压缩 */
    compaction?: HarnessCompactionOptions;
}

export interface HarnessTelemetry {
    turns: number;
    modelCalls: number;
    toolCalls: number;
    toolOk: number;
    toolFail: number;
    byTool: Record<string, { total: number; ok: number }>;
    lastToolCalls: Array<{ tool: string; ok: boolean; summary: string; at: number }>;
    /** 投影时为省上下文裁掉的字符数（dsh tool-result-pruner） */
    prunedChars: number;
    /** 被裁剪的工具结果条数 */
    prunedResults: number;
    /** 本会话累计压缩次数与被摘要掉的事件数 */
    compactions: number;
    compactedEvents: number;
    /** 回合内被插入的用户补充条数 */
    steers: number;
}

export class AgentHarnessEngine {
    private readonly log = new AgentSessionLog();
    private readonly registry = new HarnessToolRegistry();
    private readonly memory: HarnessMemoryState = { slots: {} };
    /** 创作计划（update_plan 工具维护；工作台左栏渲染） */
    private readonly plan: { steps: PlanStep[] } = { steps: [] };
    private done = false;
    private ctx: AgentContext;
    private telemetry: HarnessTelemetry = {
        turns: 0, modelCalls: 0, toolCalls: 0, toolOk: 0, toolFail: 0, byTool: {}, lastToolCalls: [],
        prunedChars: 0, prunedResults: 0, compactions: 0, compactedEvents: 0, steers: 0,
    };
    /** 回合内收件箱（dsh steering）：用户在一回合进行中补充的话 */
    private inbox: string[] = [];
    private turnRunning = false;

    constructor(private readonly options: AgentHarnessEngineOptions) {
        this.ctx = options.ctx;
        for (const tool of createHostTools({ port: options.portDeps.port, ctx: this.ctx, memory: this.memory, plan: this.plan })) {
            this.registry.register(tool);
        }
    }

    /** 创作计划（工作台左栏「创作计划」卡片实时渲染） */
    getPlan(): readonly PlanStep[] {
        return this.plan.steps;
    }

    /** 会话上下文变化（用户在左栏切换项目）时更新，后续工具解析用新列表。
     * 原地合并：工具闭包捕获的是同一 ctx 对象引用，不能用新对象替换。 */
    updateContext(ctx: AgentContext): void {
        Object.assign(this.ctx, ctx);
    }

    /** 会话遥测（工作台右栏监控用） */
    getTelemetry(): Readonly<HarnessTelemetry> {
        return this.telemetry;
    }

    getTools(): Array<{ name: string; description: string }> {
        return this.registry.list().map(tool => ({ name: tool.name, description: tool.description }));
    }

    /** 当前记忆槽位（宿主降级到规则引擎时可用来续接上下文） */
    getSlots(): Readonly<Record<string, unknown>> {
        return { ...this.memory.slots };
    }

    /**
     * 回合内补充（吸收 dsh agent-loop inbox）。
     * 只在回合进行中有效：消息进入收件箱，loop 在下一步调模型前把它写进会话日志。
     * @returns 是否被接收（false = 当前没有在跑的回合，调用方应走普通 handle）
     */
    steer(text: string): boolean {
        const trimmed = String(text || '').trim();
        if (!trimmed || !this.turnRunning) return false;
        this.inbox.push(trimmed);
        this.telemetry.steers++;
        return true;
    }

    /** 是否正在跑一个回合 */
    get isRunning(): boolean {
        return this.turnRunning;
    }

    isDone(): boolean {
        return this.done;
    }

    start(): Promise<HarnessTurnOutcome> {
        this.log.reset();
        this.done = false;
        const hasProjects = this.ctx.projects.length > 0;
        this.log.append({
            type: 'user_message',
            text: hasProjects
                ? `（会话开始。用户有 ${this.ctx.projects.length} 个项目${this.ctx.activeProject ? `，当前打开「${this.ctx.activeProject}」` : ''}。）请开始对话引导。`
                : '（会话开始。用户还没有项目。）请开始对话引导。',
        });
        return this.runTurn();
    }

    async handle(text: string): Promise<HarnessTurnOutcome> {
        const raw = String(text || '').trim();
        if (!raw) {
            return {
                messages: [{ role: 'agent', text: '没有收到内容，请再输入一次，或点下面的选项。' }],
                chips: [],
                done: false,
                usedAi: false,
                degraded: false,
                toolCalls: [],
            };
        }
        this.log.append({ type: 'user_message', text: raw });
        return this.runTurn();
    }

    /** 供宿主在工具已直接执行后追加一条说明（兼容旧 UI 流程，一般不用） */
    appendSystemNote(text: string): HarnessTurnOutcome {
        this.log.append({ type: 'assistant_message', text });
        return {
            messages: [{ role: 'agent', text }],
            chips: [],
            done: this.done,
            usedAi: false,
            degraded: false,
            toolCalls: [],
        };
    }

    /**
     * 会话压缩（吸收 dsh compaction 的「压力触发 → 范围替换为单个摘要节点」）：
     * 轮次 **或** 投影字符数超阈值时触发（dsh 按 token 压力，本插件用字符数近似），
     * 把较老的历史范围通过一次 AI 调用压缩成摘要；
     * 工具配对安全边界由日志的 balanceAt 扫描保证。失败静默跳过（不影响回合）。
     */
    private async maybeCompactHistory(): Promise<void> {
        const compaction = this.options.compaction;
        if (!compaction) return;
        const threshold = compaction.thresholdTurns ?? 30;
        const keepTurns = compaction.keepTurns ?? 12;
        const thresholdChars = compaction.thresholdChars ?? 32_000;
        const turns = this.log.derive(10_000).length;
        const chars = this.log.derivedChars(10_000);
        // 压力信号：任一超阈值就压缩（只靠轮次时，几段超长工具结果会一直撑满上下文）
        if (turns < threshold && chars < thresholdChars) return;
        try {
            const older = this.log.derive(Math.max(1, turns - keepTurns));
            if (older.length === 0) return;
            const summary = await this.summarizeTranscript(older);
            if (!summary) return;
            const removed = this.log.compactToSummary(summary, keepTurns);
            if (removed > 0) {
                this.telemetry.compactions++;
                this.telemetry.compactedEvents += removed;
                this.log.append({
                    type: 'system_message',
                    text: `[compaction] 已把较早的 ${removed} 条历史压缩为摘要节点`,
                });
            }
        } catch (e) {
            console.warn('[AgentHarness] 会话压缩失败（本轮跳过）:', e);
        }
    }

    /** 用适配器把一段旧对话压成摘要（压缩专用提示词，与回合回复解耦） */
    private async summarizeTranscript(older: Array<{ role: string; text: string }>): Promise<string | null> {
        const transcript = older
            .map(turn => turn.role === 'user' ? `【用户】${turn.text}` : turn.role === 'assistant' ? `【助手】${turn.text}` : turn.text)
            .join('\n\n')
            // 保留最近的 24k：被删范围里靠后的轮次才是最新结论（已确认结构/已写章节），
            // 旧实现 slice(0) 丢掉的正是这些内容。
            .slice(-24_000);
        const result = await this.options.adapter.complete({
            system: '你是会话压缩器。把一段小说创作助手与用户的对话历史压缩成一份摘要，保留：已确认的创作决定（项目名/类型/结构/基调等）、已执行的工具操作及其结果、未完成的待办与用户的明确要求。用条目列出，总长不超过 400 字。只输出摘要正文。',
            turns: [{ role: 'user', text: transcript }],
            temperature: 0.2,
            maxTokens: 800,
            signal: this.options.signal,
        });
        const summary = result?.reply?.trim();
        return summary || null;
    }

    private async runTurn(): Promise<HarnessTurnOutcome> {
        this.turnRunning = true;
        try {
            // 会话压缩（吸收 dsh compaction）：轮次或投影字符数任一超阈值就压缩
            await this.maybeCompactHistory();

            const outcome = await runHarnessTurn({
                adapter: this.options.adapter,
                registry: this.registry,
                log: this.log,
                memory: this.memory,
                plan: this.plan,
                projects: this.ctx.projects,
                activeProject: this.ctx.activeProject,
                maxSteps: this.options.maxSteps,
                temperature: this.options.temperature,
                maxTokens: this.options.maxTokens,
                signal: this.options.signal,
                takeInbox: () => this.inbox.splice(0, this.inbox.length),
            });
            return this.finishTurn(outcome);
        } finally {
            this.turnRunning = false;
            // 回合结束仍未消费的补充消息：不丢失，留给下一次 handle（作为普通用户消息）
            if (this.inbox.length > 0 && !this.options.signal?.aborted) {
                const leftover = this.inbox.splice(0, this.inbox.length);
                for (const text of leftover) {
                    this.log.append({ type: 'user_message', text });
                }
            }
        }
    }

    private finishTurn(outcome: { usedAi: boolean; failed: boolean; failReason?: string; reply: string; chips: HarnessChip[]; toolCalls: Array<{ tool: string; ok: boolean; summary: string }> }): HarnessTurnOutcome {
        // 遥测累积（工作台右栏监控）
        this.telemetry.turns++;
        if (outcome.usedAi) this.telemetry.modelCalls++;
        const prune = this.log.pruneStats;
        this.telemetry.prunedChars += prune.chars;
        this.telemetry.prunedResults += prune.results;
        for (const call of outcome.toolCalls) {
            this.telemetry.toolCalls++;
            if (call.ok) this.telemetry.toolOk++; else this.telemetry.toolFail++;
            const byTool = this.telemetry.byTool[call.tool] || { total: 0, ok: 0 };
            byTool.total++;
            if (call.ok) byTool.ok++;
            this.telemetry.byTool[call.tool] = byTool;
            this.telemetry.lastToolCalls.unshift({ tool: call.tool, ok: call.ok, summary: call.summary, at: Date.now() });
        }
        this.telemetry.lastToolCalls = this.telemetry.lastToolCalls.slice(0, 12);

        if (outcome.failed && !outcome.usedAi) {
            return {
                messages: [{
                    role: 'agent',
                    text: `⚠️ AI 助手暂时不可用（${outcome.failReason || '调用失败'}）。\n可以切换到离线逐步引导，或稍后重试。`,
                }],
                chips: [{ label: '🔄 切换到离线引导', value: '__fallback_rule__' }],
                done: false,
                usedAi: false,
                degraded: true,
                toolCalls: [],
            };
        }
        if (outcome.failed && outcome.usedAi) {
            // 模型已工作但中途失败（如步数超限）：把已有回复或兜底文本给用户
            return {
                messages: [{ role: 'agent', text: outcome.reply || `本轮对话中断：${outcome.failReason || '未知原因'}。可以重新描述你的需求。` }],
                chips: [{ label: '🔄 重试', value: '__retry__' }, { label: '🔄 切换到离线引导', value: '__fallback_rule__' }],
                done: false,
                usedAi: true,
                degraded: false,
                toolCalls: outcome.toolCalls,
            };
        }

        const messages: HarnessTurnOutcome['messages'] = [];
        for (const call of outcome.toolCalls) {
            messages.push({
                role: 'system',
                text: `${call.ok ? '🛠' : '⚠️'} ${call.tool} → ${call.ok ? '成功' : '失败'}：${call.summary}`,
            });
        }
        if (outcome.reply) {
            messages.push({ role: 'agent', text: outcome.reply, chips: outcome.chips });
        }
        // Harness 不自动结束会话：创建完成后模型可继续引导（开向导/调设定），由用户关闭弹窗
        const done = false;
        return {
            messages: messages.length > 0 ? messages : [{ role: 'agent', text: '（空回复，请重试）' }],
            chips: outcome.chips,
            done,
            usedAi: outcome.usedAi,
            degraded: false,
            toolCalls: outcome.toolCalls,
        };
    }
}

/** 把 harness 记忆导出为 AgentIntent 需要的形状（宿主降级时使用） */
export function harnessSlotsToIntentSlots(slots: Readonly<Record<string, unknown>>): Record<string, unknown> {
    return { ...slots };
}

export type { HarnessChip };
export type { AgentIntent };
