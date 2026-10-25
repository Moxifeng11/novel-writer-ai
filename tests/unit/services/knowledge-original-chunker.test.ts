import { describe, it, expect } from 'vitest';
import { chunkOriginalText } from '../../../services/knowledge-original-chunker';

describe('knowledge-original-chunker — 原文分块（Phase 4.3）', () => {
    it('空文本返回空数组', () => {
        expect(chunkOriginalText('')).toEqual([]);
        expect(chunkOriginalText('   \n\n  ')).toEqual([]);
    });

    it('多个短段落拼接到目标字数', () => {
        const paragraphs = Array.from({ length: 10 }, (_, i) => `第${i + 1}段：${'文'.repeat(80)}`);
        const chunks = chunkOriginalText(paragraphs.join('\n\n'), { chunkSize: 400 });

        expect(chunks.length).toBeGreaterThan(0);
        expect(chunks.length).toBeLessThan(paragraphs.length);
        for (const chunk of chunks) {
            expect(chunk.sample.length).toBeLessThanOrEqual(400 + 1); // 拼接的换行符
        }
        expect(chunks.map(c => c.position)).toEqual([...chunks.keys()]);
    });

    it('超长段落按窗口硬切，不丢内容', () => {
        const text = '长'.repeat(1000);
        const chunks = chunkOriginalText(text, { chunkSize: 300, minChunkSize: 40 });

        expect(chunks.length).toBe(4);
        expect(chunks.map(c => c.sample).join('')).toHaveLength(1000);
    });

    it('过短片段被过滤', () => {
        const text = ['短', '这一段足够长'.repeat(20)].join('\n\n');
        const chunks = chunkOriginalText(text, { chunkSize: 400, minChunkSize: 40 });
        expect(chunks).toHaveLength(1);
        expect(chunks[0].sample).not.toBe('短');
    });

    it('全书都短于最小分块时至少保留一段', () => {
        const chunks = chunkOriginalText('很短的一句。', { minChunkSize: 40 });
        expect(chunks).toHaveLength(1);
        expect(chunks[0].sample).toContain('很短的一句');
    });

    it('超过上限时均匀采样，保留首尾且 position 递增', () => {
        const paragraphs = Array.from({ length: 1000 }, (_, i) => `第${i}段：${'文'.repeat(100)}`);
        const chunks = chunkOriginalText(paragraphs.join('\n'), { chunkSize: 200, maxChunks: 10 });

        expect(chunks).toHaveLength(10);
        expect(chunks[0].sample).toContain('第0段');
        const positions = chunks.map(c => c.position);
        expect(positions).toEqual([...positions].sort((a, b) => a - b));
        expect(positions[positions.length - 1]).toBeGreaterThan(500);
    });
});
