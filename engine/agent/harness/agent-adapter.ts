/**
 * agent-adapter.ts — Harness 模型适配器（LLM adapter seam）
 *
 * 基于插件现有 AIEngine.callAI（system + user 两段式消息）实现 agent loop
 * 需要的多轮 + 工具调用能力：把会话转写折叠进 user 消息，要求模型输出
 * JSON 协议（reply / chips / tool）。任何 OpenAI 兼容端点（含 Ollama）都可用。
 */
import type {
    DerivedTurn,
    HarnessAdapter,
    HarnessAdapterRequest,
    HarnessAssistantTurn,
} from './harness-types';
import { parseAssistantTurn } from './agent-loop';
import { extractResponseText } from '@/shared/api-response-utils';

/** 引擎层不依赖插件类型：注入最小调用面 */
export type CallAIFn = (
    system: string,
    user: string,
    options?: { signal?: AbortSignal },
) => Promise<{ content: string; error?: string; finishReason?: string }>;

const PROTOCOL_REMINDER = '\n\n（再次提醒：只输出一个 JSON 对象，字段为 reply / chips / tool。）';

function formatTurns(turns: DerivedTurn[]): string {
    if (turns.length === 0) return '（会话刚刚开始，还没有历史消息。）';
    return turns
        .map((turn) => {
            if (turn.role === 'user') return `【用户】${turn.text}`;
            if (turn.role === 'assistant') return `【你上一条回复】${turn.text}`;
            return `【工具结果】${turn.text}`;
        })
        .join('\n\n');
}

/**
 * 把 AI 调用封装成 Harness 适配器。
 *
 * 适配器把「对话历史 + 系统指令」压成一次调用，并解析模型返回的 JSON 回合；
 * 解析失败时返回 `null`，由 Harness 上层决定重试或终止。
 *
 * @param callAI - 底层 AI 调用函数
 * @param opts - 可选的模型覆盖
 * @returns Harness 适配器
 */
export function createCallAIAdapter(callAI: CallAIFn, opts: { model?: string } = {}): HarnessAdapter {
    return {
        async complete(request: HarnessAdapterRequest): Promise<HarnessAssistantTurn | null> {
            const user = [
                '【对话历史】',
                formatTurns(request.turns),
                '',
                '请根据历史与系统指令，输出下一个 JSON 回复。',
            ].join('\n');

            let response;
            try {
                response = await callAI(request.system + PROTOCOL_REMINDER, user, {
                    signal: request.signal,
                });
            } catch {
                return null;
            }
            if (!response || response.error) return null;
            const raw = extractResponseText(response.content || '');
            if (!raw.trim()) return null;

            // 与 loop 用同一套解析：围栏优先、只认协议对象、参数支持 JSON 字符串
            const parsed = parseAssistantTurn(raw);
            if (parsed.reply || parsed.tool || parsed.chips) {
                return {
                    reply: parsed.reply,
                    tool: parsed.tool,
                    chips: parsed.chips,
                    raw,
                };
            }
            return { reply: raw.trim(), raw };
        },
    };
}
