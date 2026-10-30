/**
 * session-log.ts — Agent 会话日志（append-only）
 *
 * 移植自 DeepSeek Harness 的 Session Log 原则：**模型可见即已记录**。
 * 模型每一步看到的上下文都由 `derive()` 从日志投影而来，不在 prompt 里凭空拼凑。
 *
 * 另吸收 dsh `compaction-tool-result-pruner`：超长工具结果在**投影时**保留头/尾、
 * 中段替换为标记。原事件不改写，因此可重放、可审计，也不影响会话压缩的配对扫描。
 */
import type { AgentSessionEvent, DerivedTurn } from './harness-types';
import { pruneToolResultText, DEFAULT_PRUNE_CONFIG, type PruneConfig } from './tool-result-pruner';

export class AgentSessionLog {
    private events: AgentSessionEvent[] = [];
    /** 工具调用计数，用于生成稳定 callId */
    private callSeq = 0;
    /** 投影时裁剪工具结果的预算 */
    private pruneConfig: PruneConfig = { ...DEFAULT_PRUNE_CONFIG };
    /** 最近一次 derive 的裁剪统计（遥测用） */
    private lastPrunedChars = 0;
    private lastPrunedResults = 0;

    get size(): number {
        return this.events.length;
    }

    /** 只读快照（测试/遥测用） */
    snapshot(): readonly AgentSessionEvent[] {
        return [...this.events];
    }

    /** 调整工具结果裁剪预算（0 表示关闭裁剪） */
    setPruneConfig(config: Partial<PruneConfig>): void {
        this.pruneConfig = { ...this.pruneConfig, ...config };
    }

    /** 最近一次 derive 的裁剪统计 */
    get pruneStats(): { chars: number; results: number } {
        return { chars: this.lastPrunedChars, results: this.lastPrunedResults };
    }

    append(event: AgentSessionEvent): void {
        this.events.push(event);
    }

    nextCallId(tool: string): string {
        this.callSeq += 1;
        return `call_${this.callSeq}_${tool}`;
    }

    /** 当前事件序列（会话持久化用；命名避开内部字段 events） */
    allEvents(): readonly AgentSessionEvent[] {
        return [...this.events];
    }

    /** 当前工具调用序号（会话持久化用） */
    get callCounter(): number {
        return this.callSeq;
    }

    /** 从存档恢复（替换全部事件；callSeq 由调用方提供或按 callId 反推） */
    restore(events: readonly AgentSessionEvent[], callSeq: number): void {
        this.events = events.map(event => ({ ...event }));
        this.callSeq = Math.max(0, Math.floor(callSeq) || 0);
        this.lastPrunedChars = 0;
        this.lastPrunedResults = 0;
    }

    /** 清空（重新开始会话） */
    reset(): void {
        this.events = [];
        this.callSeq = 0;
        this.lastPrunedChars = 0;
        this.lastPrunedResults = 0;
    }

    /**
     * 投影成模型可见的对话转写。
     * - system_message 不进转写（走 system 字段）；
     * - context_message / user_message 进转写（前者带系统前缀）；
     * - tool_call 与对应 tool_result 合并为一行工具交互，避免把 JSON 参数原文塞给模型两次；
     * - tool_result 超预算时保留头/尾、裁剪中段（dsh pruner）；
     * - turn_marker 不进转写。
     */
    derive(limitTurns = 24): DerivedTurn[] {
        const turns: DerivedTurn[] = [];
        const pendingCalls = new Map<string, { tool: string; args: Record<string, unknown> }>();
        let prunedChars = 0;
        let prunedResults = 0;

        for (const event of this.events) {
            switch (event.type) {
                case 'user_message':
                    turns.push({ role: 'user', text: event.text });
                    break;
                case 'context_message':
                    turns.push({ role: 'user', text: event.text });
                    break;
                case 'assistant_message':
                    if (event.text.trim()) turns.push({ role: 'assistant', text: event.text });
                    break;
                case 'tool_call':
                    pendingCalls.set(event.callId, { tool: event.tool, args: event.args });
                    break;
                case 'tool_result': {
                    const call = pendingCalls.get(event.callId);
                    pendingCalls.delete(event.callId);
                    const argsText = call ? JSON.stringify(call.args) : '{}';
                    const pruned = this.pruneConfig.thresholdChars > 0
                        ? pruneToolResultText(event.content, this.pruneConfig)
                        : { text: event.content, saved: 0 };
                    if (pruned.saved > 0) {
                        prunedChars += pruned.saved;
                        prunedResults += 1;
                    }
                    turns.push({
                        role: 'tool',
                        text: `[工具 ${event.tool}] 参数 ${argsText} → ${event.ok ? '成功' : '失败'}：${pruned.text}`,
                    });
                    break;
                }
                case 'turn_marker':
                case 'system_message':
                default:
                    break;
            }
        }

        this.lastPrunedChars = prunedChars;
        this.lastPrunedResults = prunedResults;

        // 只保留最近 limitTurns 条，但成对的 assistant/tool 不拆散（简单按条数截断即可，
        // 工具结果行已自带参数摘要，截断不会产生悬空引用）
        return turns.slice(-limitTurns);
    }

    /** 当前投影的总字符数（会话压缩的压力信号，dsh token-meter 的精简版） */
    derivedChars(limitTurns = 24): number {
        return this.derive(limitTurns).reduce((sum, turn) => sum + turn.text.length, 0);
    }

    /**
     * 会话压缩（吸收 dsh compaction：**把一段历史范围替换为一个摘要节点**，
     * 且只能在「工具配对平衡」的边界切割——每个 tool_call 的 tool_result
     * 必须与它在同一侧，否则模型会看到无来源的工具结果）。
     *
     * 算法：从尾部保留最近 keepTurns 条派生轮次；向前找到最近的平衡切割点
     * （切割处之前所有 tool_call 都已收到 tool_result）；把切割点之前的事件
     * 替换为一个摘要 user_message 节点。system_message 永远保留。
     *
     * @returns 实际被摘要掉的事件数（0 = 没有可压缩的空间）
     */
    compactToSummary(summary: string, keepTurns: number): number {
        const events = this.events;
        if (events.length === 0) return 0;

        // 1. 扫描事件流，计算每个下标处的「未闭合 tool_call 数」（dsh tool-pairing），
        //    配对数为 0 的位置才是安全切割点。
        const balanceAt: number[] = new Array(events.length + 1).fill(0);
        let inProgress = 0;
        for (let i = 0; i < events.length; i++) {
            const event = events[i];
            if (event.type === 'tool_call') inProgress++;
            if (event.type === 'tool_result') inProgress--;
            balanceAt[i + 1] = inProgress;
        }

        // 2. 从尾部往前数 keepTurns 条「派生轮次」（user/assistant/tool 各算一条），
        //    找到保留区起点；再从起点向前找最近的平衡切割点。
        let derivedSeen = 0;
        let keepStart = 0;
        for (let i = events.length - 1; i >= 0; i--) {
            const type = events[i].type;
            if (type === 'user_message' || type === 'context_message'
                || type === 'assistant_message' || type === 'tool_result') {
                derivedSeen++;
                if (derivedSeen >= keepTurns) {
                    keepStart = i;
                    break;
                }
            }
            keepStart = i;
        }
        // 没有任何派生轮次（纯 system 日志）→ 无从压缩
        if (derivedSeen === 0) return 0;

        // 从 keepStart 向前找最近的平衡切割点（balanceAt[i] === 0 表示 [0, i) 内工具全配对）
        let cut = -1;
        for (let i = keepStart; i >= 0; i--) {
            if (balanceAt[i] === 0) {
                cut = i;
                break;
            }
        }
        if (cut <= 0) return 0; // 没有可安全摘除的范围

        // 3. 范围替换：[0, cut) → 一个摘要节点；system_message 原样保留在最前。
        const keptSystem = events.slice(0, cut).filter(event => event.type === 'system_message');
        const removed = cut - keptSystem.length;
        this.events = [
            ...keptSystem,
            { type: 'user_message', text: `【历史摘要】以下是更早对话的压缩摘要（原文已归档）：\n${summary}` },
            ...events.slice(cut),
        ];
        return removed;
    }
}
