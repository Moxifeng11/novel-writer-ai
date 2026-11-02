
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    splitTextIntoChunks,
    createSimulatedStream,
    createSimulatedStreamWithSignal,
    type SimulatedStreamOptions,
} from '../../../engine/streaming/simulated-stream';
import {
    StreamParser,
    parseSSERaw,
    parseOpenAISSE,
    parseOllamaLine,
    detectStreamFormat,
    type SSEEvent,
    type StreamParseResult,
} from '../../../engine/streaming/stream-parser';

describe('simulated-stream', () => {
    describe('splitTextIntoChunks', () => {
        it('should split text by sentence (Chinese)', () => {
            const text = '你好，世界！这是一个测试。有三句话吗？是的。';
            const chunks = splitTextIntoChunks(text, { splitBy: 'sentence' });
            expect(chunks.length).toBeGreaterThanOrEqual(3);
            expect(chunks.join('')).toBe(text);
        });

        it('should split text by sentence (English)', () => {
            const text = 'Hello world! This is a test. Does it work? Yes.';
            const chunks = splitTextIntoChunks(text, { splitBy: 'sentence' });
            expect(chunks.length).toBeGreaterThanOrEqual(3);
            expect(chunks.join('')).toBe(text);
        });

        it('should split text by paragraph', () => {
            const text = '第一段内容。\n\n第二段内容。\n\n第三段内容。';
            const chunks = splitTextIntoChunks(text, { splitBy: 'paragraph' });
            expect(chunks.length).toBe(3);
            expect(chunks[0]).toContain('第一段');
            expect(chunks[1]).toContain('第二段');
            expect(chunks[2]).toContain('第三段');
            // 逐块拼接必须还原原文；分隔符丢失会让正文段落粘连
            expect(chunks.join('')).toBe(text);
        });

        it('should split text by character', () => {
            const text = 'abcdef';
            const chunks = splitTextIntoChunks(text, { splitBy: 'char', chunkSize: 2 });
            expect(chunks).toEqual(['ab', 'cd', 'ef']);
        });

        it('should handle empty string', () => {
            const chunks = splitTextIntoChunks('');
            expect(chunks).toEqual([]);
        });

        it('should handle text with no sentence endings', () => {
            const text = '这是一段没有句号的文字';
            const chunks = splitTextIntoChunks(text, { splitBy: 'sentence' });
            expect(chunks.length).toBe(1);
            expect(chunks[0]).toBe(text);
        });

        it('should default to sentence splitting', () => {
            const text = '第一句。第二句。';
            const chunks = splitTextIntoChunks(text);
            expect(chunks.length).toBeGreaterThanOrEqual(2);
        });
    });

    describe('createSimulatedStream', () => {
        it('should yield chunks and return full text', async () => {
            const fullText = '第一句。第二句。第三句。';
            const options: SimulatedStreamOptions = {
                splitBy: 'sentence',
                chunkDelayMs: 0,
                minDelayMs: 0,
                maxDelayMs: 0,
            };

            const stream = createSimulatedStream(fullText, options);
            const chunks: string[] = [];

            let result;
            while (true) {
                const { value, done } = await stream.next();
                if (done) {
                    result = value;
                    break;
                }
                chunks.push(value);
            }

            expect(chunks.length).toBeGreaterThanOrEqual(3);
            expect(chunks.join('')).toBe(fullText);
            expect(result).toBe(fullText);
        });

        it('should work with empty text', async () => {
            const stream = createSimulatedStream('');
            const { value, done } = await stream.next();
            expect(done).toBe(true);
            expect(value).toBe('');
        });

        it('should support for await...of syntax', async () => {
            const fullText = '句子一。句子二。';
            const options: SimulatedStreamOptions = {
                splitBy: 'sentence',
                chunkDelayMs: 0,
                minDelayMs: 0,
                maxDelayMs: 0,
            };

            const chunks: string[] = [];
            const stream = createSimulatedStream(fullText, options);

            for await (const chunk of stream) {
                chunks.push(chunk);
            }

            expect(chunks.length).toBeGreaterThanOrEqual(2);
            expect(chunks.join('')).toBe(fullText);
        });
    });

    describe('createSimulatedStreamWithSignal', () => {
        it('should complete normally if not aborted', async () => {
            const fullText = '第一句。第二句。';
            const controller = new AbortController();
            const options: SimulatedStreamOptions = {
                splitBy: 'sentence',
                chunkDelayMs: 0,
                minDelayMs: 0,
                maxDelayMs: 0,
            };

            const stream = createSimulatedStreamWithSignal(fullText, controller.signal, options);
            const chunks: string[] = [];

            let result;
            while (true) {
                const { value, done } = await stream.next();
                if (done) {
                    result = value;
                    break;
                }
                chunks.push(value);
            }

            expect(chunks.length).toBeGreaterThanOrEqual(2);
            expect(result).toBe(fullText);
        });

        it('should handle pre-aborted signal', async () => {
            const fullText = '第一句。第二句。第三句。';
            const controller = new AbortController();
            controller.abort();

            const options: SimulatedStreamOptions = {
                splitBy: 'sentence',
                chunkDelayMs: 0,
                minDelayMs: 0,
                maxDelayMs: 0,
            };

            const stream = createSimulatedStreamWithSignal(fullText, controller.signal, options);
            const { value, done } = await stream.next();

            expect(done).toBe(true);
            expect(value).toBe('');
        });
    });
});

describe('stream-parser', () => {
    describe('parseSSERaw', () => {
        it('should parse basic SSE events', () => {
            const data = 'data: hello\n\n';
            const { events, remaining } = parseSSERaw(data);
            expect(events.length).toBe(1);
            expect(events[0].data).toBe('hello');
            expect(remaining).toBe('');
        });

        it('should handle multiple events', () => {
            const data = 'data: first\n\ndata: second\n\n';
            const { events, remaining } = parseSSERaw(data);
            expect(events.length).toBe(2);
            expect(events[0].data).toBe('first');
            expect(events[1].data).toBe('second');
        });

        it('should handle incomplete data (buffer remaining)', () => {
            const data = 'data: hello\n\ndata: inc';
            const { events, remaining } = parseSSERaw(data);
            expect(events.length).toBe(1);
            expect(events[0].data).toBe('hello');
            expect(remaining).toBe('data: inc');
        });

        it('should handle comment lines (starting with :)', () => {
            const data = ': this is a comment\n\ndata: hello\n\n';
            const { events } = parseSSERaw(data);
            expect(events.length).toBe(1);
            expect(events[0].data).toBe('hello');
        });

        it('should handle event type field', () => {
            const data = 'event: message\ndata: hello\n\n';
            const { events } = parseSSERaw(data);
            expect(events[0].event).toBe('message');
            expect(events[0].data).toBe('hello');
        });

        it('should handle multi-line data', () => {
            const data = 'data: line1\ndata: line2\n\n';
            const { events } = parseSSERaw(data);
            expect(events[0].data).toBe('line1\nline2');
        });
    });

    describe('parseOpenAISSE', () => {
        it('should parse [DONE] event', () => {
            const event: SSEEvent = { data: '[DONE]' };
            const result = parseOpenAISSE(event);
            expect(result).not.toBeNull();
            expect(result?.done).toBe(true);
            expect(result?.content).toBe('');
        });

        it('should parse content delta', () => {
            const data = JSON.stringify({
                choices: [
                    { delta: { content: 'Hello' }, finish_reason: null }
                ]
            });
            const event: SSEEvent = { data };
            const result = parseOpenAISSE(event);
            expect(result).not.toBeNull();
            expect(result?.content).toBe('Hello');
            expect(result?.done).toBe(false);
        });

        it('should detect finish reason stop', () => {
            const data = JSON.stringify({
                choices: [
                    { delta: {}, finish_reason: 'stop' }
                ]
            });
            const event: SSEEvent = { data };
            const result = parseOpenAISSE(event);
            expect(result).not.toBeNull();
            expect(result?.done).toBe(true);
        });

        it('should return null for invalid JSON', () => {
            const event: SSEEvent = { data: 'invalid json' };
            const result = parseOpenAISSE(event);
            expect(result).toBeNull();
        });
    });

    describe('parseOllamaLine', () => {
        it('should parse Ollama response chunk', () => {
            const line = JSON.stringify({
                model: 'llama2',
                response: 'Hello',
                done: false,
            });
            const result = parseOllamaLine(line);
            expect(result).not.toBeNull();
            expect(result?.content).toBe('Hello');
            expect(result?.done).toBe(false);
        });

        it('should detect Ollama done event', () => {
            const line = JSON.stringify({
                model: 'llama2',
                response: '',
                done: true,
                prompt_eval_count: 10,
                eval_count: 20,
            });
            const result = parseOllamaLine(line);
            expect(result).not.toBeNull();
            expect(result?.done).toBe(true);
            expect(result?.usage?.prompt_tokens).toBe(10);
            expect(result?.usage?.completion_tokens).toBe(20);
        });

        it('should return null for invalid JSON', () => {
            const result = parseOllamaLine('not json');
            expect(result).toBeNull();
        });
    });

    describe('detectStreamFormat', () => {
        it('should detect OpenAI SSE format', () => {
            const chunk = 'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n';
            expect(detectStreamFormat(chunk)).toBe('openai-sse');
        });

        it('should detect Ollama format', () => {
            const chunk = '{"model":"llama2","response":"hi","done":false}\n';
            expect(detectStreamFormat(chunk)).toBe('ollama');
        });

        it('should default to openai-sse for empty', () => {
            expect(detectStreamFormat('')).toBe('openai-sse');
        });
    });

    describe('StreamParser', () => {
        it('should parse OpenAI SSE stream', () => {
            const parser = new StreamParser('openai-sse');

            const chunk1 = 'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n';
            const results1 = parser.feed(chunk1);
            expect(results1.length).toBe(1);
            expect(results1[0].content).toBe('Hello');

            const chunk2 = 'data: {"choices":[{"delta":{"content":" World"}}]}\n\n';
            const results2 = parser.feed(chunk2);
            expect(results2.length).toBe(1);
            expect(results2[0].content).toBe(' World');

            const chunk3 = 'data: [DONE]\n\n';
            const results3 = parser.feed(chunk3);
            expect(results3.length).toBe(1);
            expect(results3[0].done).toBe(true);
        });

        it('should parse Ollama stream', () => {
            const parser = new StreamParser('ollama');

            const chunk1 = '{"model":"llama2","response":"Hello","done":false}\n';
            const results1 = parser.feed(chunk1);
            expect(results1.length).toBe(1);
            expect(results1[0].content).toBe('Hello');

            const chunk2 = '{"model":"llama2","response":" World","done":false}\n';
            const results2 = parser.feed(chunk2);
            expect(results2.length).toBe(1);
            expect(results2[0].content).toBe(' World');

            const chunk3 = '{"model":"llama2","response":"","done":true}\n';
            const results3 = parser.feed(chunk3);
            expect(results3.length).toBe(1);
            expect(results3[0].done).toBe(true);
        });

        it('should auto-detect format', () => {
            const parser = new StreamParser('auto');

            const ollamaChunk = '{"model":"llama2","response":"hi","done":false}\n';
            const results = parser.feed(ollamaChunk);
            expect(parser.getFormat()).toBe('ollama');
            expect(results.length).toBe(1);
        });

        it('should handle partial chunks', () => {
            const parser = new StreamParser('openai-sse');

            const partial1 = 'data: {"choices":[{"delta":{"content":"Hel';
            const results1 = parser.feed(partial1);
            expect(results1.length).toBe(0);

            const partial2 = 'lo"}}]}\n\n';
            const results2 = parser.feed(partial2);
            expect(results2.length).toBe(1);
            expect(results2[0].content).toBe('Hello');
        });

        it('should flush remaining buffer', () => {
            const parser = new StreamParser('ollama');
            parser.feed('{"model":"llama2","response":"hi","done":false}');
            const results = parser.flush();
            expect(results.length).toBe(1);
            expect(results[0].content).toBe('hi');
        });

        it('should reset correctly', () => {
            const parser = new StreamParser('openai-sse');
            parser.feed('data: test\n\n');
            parser.reset();

            const results = parser.flush();
            expect(results.length).toBe(0);
        });
    });
});
