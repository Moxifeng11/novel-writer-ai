/**
 * knowledge-original-chunker.ts — 将书籍原文切分为可向量化的片段
 *
 * Phase 4.3：知识库检索此前以「拆解报告 JSON」为检索对象，注入给模型的是
 * 分析文本而非原文，风格模仿效果差。这里改为直接对原文分块：
 * - 按空行/换行切段落，再把段落拼到目标字数，避免切断句子；
 * - 单段超长时按硬窗口切分；
 * - 全书分块过多时按均匀步长采样，控制 embedding 成本。
 */

import {
    KB_ORIGINAL_CHUNK_MAX,
    KB_ORIGINAL_CHUNK_MIN,
    KB_ORIGINAL_CHUNK_SIZE,
} from '@/shared/thresholds';

/**
 * 原始文本分块结构定义。
 */
export interface OriginalTextChunk {
    sample: string;
    position: number;
}

/**
 * 分块原始文本选项列表结构定义。
 */
export interface ChunkOriginalTextOptions {
    chunkSize?: number;
    minChunkSize?: number;
    maxChunks?: number;
}

/**
 * 去除首尾空白并压缩连续空行
 *
 * @param text - 文本内容
 * @returns 文本结果
 */
function normalizeText(text: string): string {
    return (text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function splitParagraphs(text: string): string[] {
    return normalizeText(text)
        .split(/\n+/)
        .map(p => p.trim())
        .filter(Boolean);
}

/**
 * 单段超过目标长度时按窗口硬切
 *
 * @param paragraph - 段落
 * @param chunkSize - 分块大小
 * @returns 结果数组
 */
function hardSplit(paragraph: string, chunkSize: number): string[] {
    if (paragraph.length <= chunkSize) return [paragraph];
    const pieces: string[] = [];
    for (let i = 0; i < paragraph.length; i += chunkSize) {
        pieces.push(paragraph.slice(i, i + chunkSize));
    }
    return pieces;
}

/**
 * 原文分块。
 * 返回的 position 为分块在全文中的顺序索引（采样后保持原索引）。
 * @param text - 文本内容
 * @param options - 配置项
 * @returns 结果数组
 */
export function chunkOriginalText(
    text: string,
    options: ChunkOriginalTextOptions = {},
): OriginalTextChunk[] {
    const chunkSize = options.chunkSize ?? KB_ORIGINAL_CHUNK_SIZE;
    const minChunkSize = options.minChunkSize ?? KB_ORIGINAL_CHUNK_MIN;
    const maxChunks = options.maxChunks ?? KB_ORIGINAL_CHUNK_MAX;

    const paragraphs = splitParagraphs(text);
    if (paragraphs.length === 0) return [];

    const rawChunks: string[] = [];
    let buffer = '';
    for (const paragraph of paragraphs) {
        for (const piece of hardSplit(paragraph, chunkSize)) {
            if (buffer && buffer.length + piece.length > chunkSize) {
                rawChunks.push(buffer);
                buffer = '';
            }
            buffer = buffer ? `${buffer}\n${piece}` : piece;
        }
    }
    if (buffer) rawChunks.push(buffer);

    const filtered = rawChunks.filter(c => c.trim().length >= minChunkSize);
    if (filtered.length === 0) {
        // 全书比最小分块还短时，至少保留一段，避免完全检索不到
        return rawChunks.length > 0
            ? [{ sample: rawChunks[0], position: 0 }]
            : [];
    }

    if (filtered.length <= maxChunks) {
        return filtered.map((sample, position) => ({ sample, position }));
    }

    // 均匀采样：保留首尾与等距中间块，避免只覆盖开头
    const step = filtered.length / maxChunks;
    const picked: OriginalTextChunk[] = [];
    for (let i = 0; i < maxChunks; i++) {
        const index = Math.min(filtered.length - 1, Math.floor(i * step));
        picked.push({ sample: filtered[index], position: index });
    }
    return picked;
}
