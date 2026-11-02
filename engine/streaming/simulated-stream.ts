
/**
 * SimulatedStreamOptions 类型定义。
 */
export interface SimulatedStreamOptions {
    chunkDelayMs?: number;
    minDelayMs?: number;
    maxDelayMs?: number;
    splitBy?: 'sentence' | 'paragraph' | 'char';
    chunkSize?: number;
}

const DEFAULT_OPTIONS: Required<SimulatedStreamOptions> = {
    chunkDelayMs: 40,
    minDelayMs: 20,
    maxDelayMs: 60,
    splitBy: 'sentence',
    chunkSize: 1,
};

const SENTENCE_END_REGEX = /[。！？.!?]+/g;
const PARAGRAPH_SPLIT_REGEX = /\n\n+/;

function splitBySentence(text: string): string[] {
    if (!text) return [];
    const chunks: string[] = [];
    let lastIndex = 0;
    let match;
    SENTENCE_END_REGEX.lastIndex = 0;
    while ((match = SENTENCE_END_REGEX.exec(text)) !== null) {
        const endIndex = match.index + match[0].length;
        chunks.push(text.slice(lastIndex, endIndex));
        lastIndex = endIndex;
    }
    if (lastIndex < text.length) {
        chunks.push(text.slice(lastIndex));
    }
    return chunks.filter(c => c.length > 0);
}

function splitByParagraph(text: string): string[] {
    if (!text) return [];
    return text.split(PARAGRAPH_SPLIT_REGEX).filter(p => p.trim().length > 0);
}

function splitByChar(text: string, chunkSize: number = 1): string[] {
    if (!text) return [];
    const size = Math.max(1, chunkSize);
    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += size) {
        chunks.push(text.slice(i, i + size));
    }
    return chunks;
}

/**
 * splitTextIntoChunks 函数。
 * @param text - 文本内容
 * @param options - 配置项
 * @returns 结果数组
 */
export function splitTextIntoChunks(text: string, options: SimulatedStreamOptions = {}): string[] {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    switch (opts.splitBy) {
        case 'paragraph':
            return splitByParagraph(text);
        case 'char':
            return splitByChar(text, opts.chunkSize);
        case 'sentence':
        default:
            return splitBySentence(text);
    }
}

function randomDelay(min: number, max: number): number {
    return min + Math.random() * (max - min);
}

/**
 * 按分块延迟模拟流式输出。
 *
 * @param fullText - 完整文本
 * @param options - 分块与延迟选项
 * @returns 逐块产出文本，最终返回完整文本
 */
export async function* createSimulatedStream(
    fullText: string,
    options: SimulatedStreamOptions = {}
): AsyncGenerator<string, string, unknown> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const chunks = splitTextIntoChunks(fullText, opts);

    if (chunks.length === 0) {
        return fullText;
    }

    let accumulated = '';

    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        accumulated += chunk;

        const delay = opts.minDelayMs !== opts.maxDelayMs
            ? randomDelay(opts.minDelayMs, opts.maxDelayMs)
            : opts.chunkDelayMs;

        await new Promise(resolve => setTimeout(resolve, delay));

        yield chunk;
    }

    return accumulated;
}

/**
 * 带取消信号的模拟流式输出。
 *
 * @param fullText - 完整文本
 * @param signal - 取消信号
 * @param options - 分块与延迟选项
 * @returns 逐块产出文本，最终返回完整文本
 */
export async function* createSimulatedStreamWithSignal(
    fullText: string,
    signal?: AbortSignal,
    options: SimulatedStreamOptions = {}
): AsyncGenerator<string, string, unknown> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const chunks = splitTextIntoChunks(fullText, opts);

    if (chunks.length === 0) {
        return fullText;
    }

    let accumulated = '';

    for (let i = 0; i < chunks.length; i++) {
        if (signal?.aborted) {
            return accumulated;
        }

        const chunk = chunks[i];
        accumulated += chunk;

        const delay = opts.minDelayMs !== opts.maxDelayMs
            ? randomDelay(opts.minDelayMs, opts.maxDelayMs)
            : opts.chunkDelayMs;

        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
                signal?.removeEventListener('abort', onAbort);
                resolve();
            }, delay);

            const onAbort = () => {
                clearTimeout(timer);
                reject(new DOMException('Aborted', 'AbortError'));
            };

            if (signal) {
                signal.addEventListener('abort', onAbort, { once: true });
            }
        });

        yield chunk;
    }

    return accumulated;
}
