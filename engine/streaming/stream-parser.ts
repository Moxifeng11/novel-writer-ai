
/**
 * 流格式。
 */
export type StreamFormat = 'openai-sse' | 'ollama' | 'auto';

/**
 * 流解析结果。
 */
export interface StreamParseResult {
    content: string;
    done: boolean;
    raw?: any;
    usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
    };
}

/**
 * SSE 事件。
 */
export interface SSEEvent {
    event?: string;
    data: string;
    id?: string;
    retry?: number;
}

/**
 * 解析原始 SSE 缓冲。
 *
 * @param buffer - 缓冲区
 * @returns {events,remaining}
 */
export function parseSSERaw(buffer: string): { events: SSEEvent[]; remaining: string } {
    const events: SSEEvent[] = [];
    const lines = buffer.split('\n');
    let currentEvent: SSEEvent = { data: '' };

    for (let i = 0; i < lines.length - 1; i++) {
        const line = lines[i];

        if (line === '') {
            if (currentEvent.data || currentEvent.event) {
                events.push(currentEvent);
                currentEvent = { data: '' };
            }
            continue;
        }

        if (line.startsWith(':')) {
            continue;
        }

        let field: string;
        let value: string;
        const colonIndex = line.indexOf(':');

        if (colonIndex === -1) {
            field = line;
            value = '';
        } else {
            field = line.slice(0, colonIndex);
            value = line.slice(colonIndex + 1);
            if (value.startsWith(' ')) {
                value = value.slice(1);
            }
        }

        switch (field) {
            case 'event':
                currentEvent.event = value;
                break;
            case 'data':
                currentEvent.data += (currentEvent.data ? '\n' : '') + value;
                break;
            case 'id':
                currentEvent.id = value;
                break;
            case 'retry':
                const retryNum = parseInt(value, 10);
                if (!isNaN(retryNum)) {
                    currentEvent.retry = retryNum;
                }
                break;
        }
    }

    const remaining = lines[lines.length - 1] || '';
    return { events, remaining };
}

/**
 * 解析 OpenAI SSE 事件。
 *
 * @param event - 事件
 * @returns 解析结果或 null
 */
export function parseOpenAISSE(event: SSEEvent): StreamParseResult | null {
    if (event.data === '[DONE]') {
        return { content: '', done: true };
    }

    try {
        const data = JSON.parse(event.data);
        const delta = data?.choices?.[0]?.delta?.content;
        const finishReason = data?.choices?.[0]?.finish_reason;
        const usage = data?.usage;

        return {
            content: delta || '',
            done: finishReason === 'stop' || finishReason === 'length',
            raw: data,
            usage: usage ? {
                prompt_tokens: usage.prompt_tokens,
                completion_tokens: usage.completion_tokens,
                total_tokens: usage.total_tokens,
            } : undefined,
        };
    } catch {
        return null;
    }
}

/**
 * 解析 Ollama 行。
 *
 * @param line - 行
 * @returns 解析结果或 null
 */
export function parseOllamaLine(line: string): StreamParseResult | null {
    try {
        const data = JSON.parse(line);
        const response = data?.response || '';
        const done = data?.done === true;

        let usage: StreamParseResult['usage'] | undefined;
        if (data?.prompt_eval_count !== undefined || data?.eval_count !== undefined) {
            usage = {
                prompt_tokens: data.prompt_eval_count || 0,
                completion_tokens: data.eval_count || 0,
                total_tokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
            };
        }

        return {
            content: response,
            done,
            raw: data,
            usage,
        };
    } catch {
        return null;
    }
}

/**
 * 检测流格式。
 *
 * @param firstChunk - 首个分片
 * @returns 格式
 */
export function detectStreamFormat(firstChunk: string): StreamFormat {
    const trimmed = firstChunk.trim();
    if (!trimmed) return 'openai-sse';

    if (trimmed.startsWith('data:')) {
        return 'openai-sse';
    }

    try {
        const parsed = JSON.parse(trimmed.split('\n')[0] || trimmed);
        if ('response' in parsed || ('model' in parsed && 'done' in parsed)) {
            return 'ollama';
        }
    } catch {
    }

    return 'openai-sse';
}

/**
 * 流解析器（SSE/Ollama）。
 */
export class StreamParser {
    private buffer = '';
    private format: StreamFormat;
    private detected = false;

    constructor(format: StreamFormat = 'auto') {
        this.format = format;
    }

    /**
     * 喂入数据块并返回解析结果。
     *
     * @param chunk - 文本块
     * @returns 结果数组
     */
    feed(chunk: string): StreamParseResult[] {
        const results: StreamParseResult[] = [];
        this.buffer += chunk;

        if (!this.detected && this.format === 'auto' && this.buffer.trim()) {
            this.format = detectStreamFormat(this.buffer);
            this.detected = true;
        }

        if (this.format === 'ollama') {
            results.push(...this.parseOllamaBuffer());
        } else {
            results.push(...this.parseSSEBuffer());
        }

        return results;
    }

    private parseSSEBuffer(): StreamParseResult[] {
        const results: StreamParseResult[] = [];
        const { events, remaining } = parseSSERaw(this.buffer);
        this.buffer = remaining;

        for (const event of events) {
            const parsed = parseOpenAISSE(event);
            if (parsed) {
                results.push(parsed);
            }
        }

        return results;
    }

    private parseOllamaBuffer(): StreamParseResult[] {
        const results: StreamParseResult[] = [];
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop() || '';

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            const parsed = parseOllamaLine(trimmed);
            if (parsed) {
                results.push(parsed);
            }
        }

        return results;
    }

    /**
     * 冲刷剩余缓冲。
     * @returns 结果数组
     */
    flush(): StreamParseResult[] {
        if (!this.buffer.trim()) return [];

        const results: StreamParseResult[] = [];

        if (this.format === 'ollama') {
            const trimmed = this.buffer.trim();
            if (trimmed) {
                const parsed = parseOllamaLine(trimmed);
                if (parsed) {
                    results.push(parsed);
                }
            }
        } else {
            const { events } = parseSSERaw(this.buffer + '\n\n');
            for (const event of events) {
                const parsed = parseOpenAISSE(event);
                if (parsed) {
                    results.push(parsed);
                }
            }
        }

        this.buffer = '';
        return results;
    }

    /**
     * 重置解析器。
     */
    reset(): void {
        this.buffer = '';
        this.detected = false;
        if (this.format === 'auto') {
            this.format = 'auto';
        }
    }

    /**
     * 当前格式。
     * @returns 格式
     */
    getFormat(): StreamFormat {
        return this.detected ? this.format : 'auto';
    }
}

export async function* parseReadableStream(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    format: StreamFormat = 'auto',
    signal?: AbortSignal
): AsyncGenerator<string, { content: string; usage?: StreamParseResult['usage'] }, unknown> {
    const decoder = new TextDecoder();
    const parser = new StreamParser(format);
    let fullContent = '';
    let lastUsage: StreamParseResult['usage'] | undefined;

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            if (signal?.aborted) {
                break;
            }

            const chunk = decoder.decode(value, { stream: true });
            const results = parser.feed(chunk);

            for (const result of results) {
                if (result.content) {
                    fullContent += result.content;
                    yield result.content;
                }
                if (result.usage) {
                    lastUsage = result.usage;
                }
                if (result.done) {
                    return { content: fullContent, usage: lastUsage };
                }
            }
        }

        const remaining = parser.flush();
        for (const result of remaining) {
            if (result.content) {
                fullContent += result.content;
                yield result.content;
            }
            if (result.usage) {
                lastUsage = result.usage;
            }
        }

        return { content: fullContent, usage: lastUsage };
    } finally {
        try {
            reader.releaseLock();
        } catch {
        }
    }
}
