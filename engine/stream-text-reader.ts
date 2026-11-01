/**
 * stream-text-reader.ts — 流式文本读取器
 *
 * 功能：以流式方式读取文本并产出分段，支持从字符串或文件读取，
 *       配合 TextSegmenter 实现边读边分，降低大文件内存占用。
 *
 * 设计原则：
 * - 内存中保留不超过 2 个段的文本量
 * - 支持从指定 offset 恢复（断点续传）
 * - 可异步迭代，按需拉取下一段
 */

import type { TextSegment } from './text-segmenter';
import { countCjkAndWords } from '../shared/word-count';
import { TextSegmenter } from './text-segmenter';
import type { FileSystemPort } from '../shared/file-system-port';

export interface StreamReaderState {
    filePath?: string;
    position: number;
    totalSize: number;
    segmentsProduced: number;
    isReadComplete: boolean;
    readSpeed: number;
    startTime: number;
}

export interface StreamReaderOptions {
    bufferSize?: number;
    segmentOptions?: ConstructorParameters<typeof TextSegmenter>[0];
}

const DEFAULT_OPTIONS: Required<Omit<StreamReaderOptions, 'segmentOptions'>> & { segmentOptions: object } = {
    bufferSize: 64 * 1024,
    segmentOptions: {},
};

export class StreamTextReader {
    private fs: FileSystemPort | null = null;
    private filePath: string | null = null;
    private fullText: string | null = null;
    private position: number = 0;
    private totalSize: number = 0;
    private buffer: string = '';
    private segmenter: TextSegmenter;
    private options: Required<Omit<StreamReaderOptions, 'segmentOptions'>> & { segmentOptions: object };
    private segmentsProduced: number = 0;
    private isReadComplete: boolean = false;
    private startTime: number = 0;
    private bytesRead: number = 0;

    constructor(options: StreamReaderOptions = {}) {
        this.options = { ...DEFAULT_OPTIONS, ...options };
        this.segmenter = new TextSegmenter(this.options.segmentOptions);
    }

    async fromString(text: string, startOffset: number = 0): Promise<void> {
        this.fullText = text;
        this.filePath = null;
        this.fs = null;
        this.position = startOffset;
        this.totalSize = text.length;
        this.buffer = '';
        this.segmentsProduced = 0;
        this.isReadComplete = false;
        this.startTime = Date.now();
        this.bytesRead = 0;

        if (startOffset > 0) {
            this.buffer = text.slice(0, startOffset);
            this.bytesRead = startOffset;
        }
    }

    async fromFile(fs: FileSystemPort, filePath: string, startOffset: number = 0): Promise<void> {
        this.fs = fs;
        this.filePath = filePath;
        this.fullText = null;
        this.position = startOffset;
        this.buffer = '';
        this.segmentsProduced = 0;
        this.isReadComplete = false;
        this.startTime = Date.now();
        this.bytesRead = 0;

        const file = await fs.getFile(filePath);
        if (!file) {
            throw new Error(`文件不存在: ${filePath}`);
        }
        this.totalSize = file.stat?.size ?? 0;

        if (startOffset > 0) {
            const initialText = await this.readFileChunk(0, startOffset);
            this.buffer = initialText;
            this.bytesRead = startOffset;
            this.position = startOffset;
        }
    }

    async readNext(): Promise<TextSegment | null> {
        if (this.isReadComplete && this.buffer.length === 0) {
            return null;
        }

        while (!this.isReadComplete) {
            await this.fillBuffer();

            const segments = await this.segmentBuffer(false);
            if (segments.length > 0) {
                const segment = segments[0];
                this.buffer = this.buffer.slice(segment.endOffset - this.getBufferStartOffset());
                this.segmentsProduced++;
                return {
                    ...segment,
                    index: this.segmentsProduced - 1,
                };
            }

            if (this.isReadComplete) {
                break;
            }
        }

        if (this.buffer.length > 0) {
            const segments = await this.segmentBuffer(true);
            if (segments.length > 0) {
                const segment = segments[0];
                this.buffer = this.buffer.slice(segment.endOffset - this.getBufferStartOffset());
                this.segmentsProduced++;
                return {
                    ...segment,
                    index: this.segmentsProduced - 1,
                };
            }

            if (this.buffer.trim().length > 0) {
                const remainingText = this.buffer;
                const bufferStart = this.getBufferStartOffset();
                this.buffer = '';
                this.segmentsProduced++;
                return {
                    index: this.segmentsProduced - 1,
                    text: remainingText,
                    startOffset: bufferStart,
                    endOffset: bufferStart + remainingText.length,
                    wordCount: countCjkAndWords(remainingText),
                };
            }
        }

        return null;
    }

    async *[Symbol.asyncIterator](): AsyncGenerator<TextSegment> {
        let segment: TextSegment | null;
        while ((segment = await this.readNext()) !== null) {
            yield segment;
        }
    }

    async readAll(): Promise<TextSegment[]> {
        const segments: TextSegment[] = [];
        for await (const segment of this) {
            segments.push(segment);
        }
        return segments;
    }

    getState(): StreamReaderState {
        const elapsed = (Date.now() - this.startTime) / 1000;
        const readSpeed = elapsed > 0 ? this.bytesRead / elapsed : 0;

        return {
            filePath: this.filePath ?? undefined,
            position: this.position,
            totalSize: this.totalSize,
            segmentsProduced: this.segmentsProduced,
            isReadComplete: this.isReadComplete,
            readSpeed,
            startTime: this.startTime,
        };
    }

    get progress(): number {
        if (this.totalSize === 0) return 0;
        return Math.min(1, this.position / this.totalSize);
    }

    get isComplete(): boolean {
        return this.isReadComplete && this.buffer.length === 0;
    }

    private async fillBuffer(): Promise<void> {
        if (this.isReadComplete) return;

        if (this.fullText !== null) {
            const end = Math.min(this.position + this.options.bufferSize, this.fullText.length);
            if (this.position >= this.fullText.length) {
                this.isReadComplete = true;
                return;
            }
            const chunk = this.fullText.slice(this.position, end);
            this.buffer += chunk;
            this.bytesRead += chunk.length;
            this.position = end;
            if (this.position >= this.fullText.length) {
                this.isReadComplete = true;
            }
        } else if (this.fs && this.filePath) {
            const chunk = await this.readFileChunk(this.position, this.options.bufferSize);
            if (chunk.length === 0) {
                this.isReadComplete = true;
                return;
            }
            this.buffer += chunk;
            this.bytesRead += chunk.length;
            this.position += chunk.length;
            if (chunk.length < this.options.bufferSize) {
                this.isReadComplete = true;
            }
        } else {
            this.isReadComplete = true;
        }
    }

    private async readFileChunk(offset: number, length: number): Promise<string> {
        if (!this.fs || !this.filePath) {
            return '';
        }

        const fullContent = await this.fs.read(this.filePath);
        return fullContent.slice(offset, offset + length);
    }

    private async segmentBuffer(isFinal: boolean): Promise<TextSegment[]> {
        if (this.buffer.length === 0) return [];

        const bufferStart = this.getBufferStartOffset();

        if (isFinal) {
            const segments = await this.segmenter.segment(this.buffer);
            return segments.map(s => ({
                ...s,
                startOffset: s.startOffset + bufferStart,
                endOffset: s.endOffset + bufferStart,
            }));
        }

        const minBufferSize = 2000;
        if (this.buffer.length < minBufferSize && !this.isReadComplete) {
            return [];
        }

        const tempSegments = await this.segmenter.segment(this.buffer);
        if (tempSegments.length <= 1) {
            return [];
        }

        const result: TextSegment[] = [];
        for (let i = 0; i < tempSegments.length - 1; i++) {
            result.push({
                ...tempSegments[i],
                startOffset: tempSegments[i].startOffset + bufferStart,
                endOffset: tempSegments[i].endOffset + bufferStart,
            });
        }

        return result;
    }

    private getBufferStartOffset(): number {
        if (this.fullText !== null) {
            return this.position - this.buffer.length;
        }
        return this.position - this.buffer.length;
    }

}
