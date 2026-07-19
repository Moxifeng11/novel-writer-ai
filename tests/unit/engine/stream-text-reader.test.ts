import { describe, it, expect, beforeEach } from 'vitest';
import { StreamTextReader } from '../../../engine/stream-text-reader';
import { MockFileSystem } from '../../../shared/file-system-port';

describe('StreamTextReader', () => {
    let fs: MockFileSystem;

    beforeEach(() => {
        fs = new MockFileSystem();
    });

    describe('字符串流式读取', () => {
        it('短文本返回单段', async () => {
            const reader = new StreamTextReader();
            await reader.fromString('这是一段短文本。');

            const segments = await reader.readAll();
            expect(segments.length).toBe(1);
            expect(segments[0].text).toBe('这是一段短文本。');
        });

        it('长文本分段读取', async () => {
            const reader = new StreamTextReader({ bufferSize: 1000 });
            let text = '';
            for (let i = 0; i < 300; i++) {
                text += `第${i}段内容。这是一段测试文字。用来测试流式读取功能。再加一些内容让它变得更长一些。\n`;
            }

            await reader.fromString(text);

            const segments = await reader.readAll();
            expect(segments.length).toBeGreaterThan(1);
        });

        it('逐个读取段', async () => {
            const reader = new StreamTextReader({ bufferSize: 1000 });
            let text = '';
            for (let i = 0; i < 200; i++) {
                text += `第${i}段内容。这是一段测试文字。用来测试流式读取功能。再加一些内容让它变得更长一些。\n`;
            }

            await reader.fromString(text);

            const segments = [];
            let seg;
            while ((seg = await reader.readNext()) !== null) {
                segments.push(seg);
            }

            expect(segments.length).toBeGreaterThan(1);
            expect(segments[0].index).toBe(0);
            expect(segments[segments.length - 1].index).toBe(segments.length - 1);
        });

        it('asyncIterator 正常工作', async () => {
            const reader = new StreamTextReader({ bufferSize: 1000 });
            let text = '';
            for (let i = 0; i < 200; i++) {
                text += `第${i}段内容。这是一段测试文字。用来测试流式读取功能。再加一些内容让它变得更长一些。\n`;
            }

            await reader.fromString(text);

            const segments = [];
            for await (const seg of reader) {
                segments.push(seg);
            }

            expect(segments.length).toBeGreaterThan(1);
        });
    });

    describe('offset 正确性', () => {
        it('startOffset 从指定位置开始', async () => {
            const reader = new StreamTextReader({ bufferSize: 100 });
            const text = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.repeat(20);

            await reader.fromString(text, 50);

            const state = reader.getState();
            expect(state.position).toBe(50);
        });

        it('第一段 startOffset 正确', async () => {
            const reader = new StreamTextReader({ bufferSize: 500 });
            let text = '';
            for (let i = 0; i < 50; i++) {
                text += `第${i}段内容。这是一段测试文字。用来测试流式读取功能。再加一些内容。\n`;
            }

            await reader.fromString(text);

            const first = await reader.readNext();
            expect(first).not.toBeNull();
            if (first) {
                expect(first.startOffset).toBe(0);
            }
        });

        it('所有段的 offset 与文本位置一致', async () => {
            const reader = new StreamTextReader({ bufferSize: 500 });
            let text = '';
            for (let i = 0; i < 30; i++) {
                text += `第${i}段内容。这是一段测试文字。用来测试流式读取功能。再加一些内容。\n`;
            }

            await reader.fromString(text);

            const segments = await reader.readAll();
            for (const seg of segments) {
                expect(text.slice(seg.startOffset, seg.endOffset)).toBe(seg.text);
            }
        });
    });

    describe('读取状态', () => {
        it('progress 逐渐增加到 1', async () => {
            const reader = new StreamTextReader({ bufferSize: 200 });
            let text = '';
            for (let i = 0; i < 50; i++) {
                text += `第${i}段内容。这是一段测试文字。用来测试流式读取功能。再加一些内容。\n`;
            }

            await reader.fromString(text);

            const startProgress = reader.progress;
            expect(startProgress).toBe(0);

            await reader.readAll();

            expect(reader.progress).toBeCloseTo(1, 0);
            expect(reader.isComplete).toBe(true);
        });

        it('getState 返回正确状态', async () => {
            const reader = new StreamTextReader({ bufferSize: 200 });
            const text = '测试文本'.repeat(100);

            await reader.fromString(text);
            const state = reader.getState();

            expect(state.position).toBe(0);
            expect(state.totalSize).toBe(text.length);
            expect(state.segmentsProduced).toBe(0);
            expect(state.isReadComplete).toBe(false);
            expect(state.readSpeed).toBeGreaterThanOrEqual(0);
        });

        it('isComplete 读取完成后为 true', async () => {
            const reader = new StreamTextReader();
            await reader.fromString('短文本。');

            expect(reader.isComplete).toBe(false);
            await reader.readAll();
            expect(reader.isComplete).toBe(true);
        });
    });

    describe('文件流式读取', () => {
        it('从文件读取', async () => {
            const reader = new StreamTextReader({ bufferSize: 200 });
            const content = '文件内容测试。'.repeat(50);
            fs.setFile('test/novel.md', content);

            await reader.fromFile(fs, 'test/novel.md');

            const state = reader.getState();
            expect(state.filePath).toBe('test/novel.md');

            const segments = await reader.readAll();
            expect(segments.length).toBeGreaterThanOrEqual(1);
            expect(segments[0].text.length).toBeGreaterThan(0);
        });

        it('文件不存在抛出错误', async () => {
            const reader = new StreamTextReader();
            await expect(reader.fromFile(fs, 'not-exist.md')).rejects.toThrow('文件不存在');
        });
    });

    describe('章节流式读取', () => {
        it('按章节分段流式输出', async () => {
            const reader = new StreamTextReader({ bufferSize: 200 });
            let text = '';
            for (let i = 1; i <= 10; i++) {
                text += `第${i}章 标题${i}\n这是第${i}章的内容。有很多文字。用来测试章节读取。\n\n`;
            }

            await reader.fromString(text);

            const segments = await reader.readAll();
            expect(segments.length).toBeGreaterThanOrEqual(3);

            const chapterTitles = segments
                .filter(s => s.chapterTitle)
                .map(s => s.chapterTitle);
            expect(chapterTitles.length).toBeGreaterThan(0);
        });
    });
});
