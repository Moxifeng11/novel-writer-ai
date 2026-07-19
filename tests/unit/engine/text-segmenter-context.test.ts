import { describe, it, expect } from 'vitest';
import { TextSegmenter, extractKeyEntities } from '../../../engine/text-segmenter';

describe('segmentWithContext', () => {
    const segmenter = new TextSegmenter({ maxSegmentWords: 100, minSegmentWords: 50, overlapWords: 30, preferChapter: false });

    describe('TR-3.1: segmentWithContext 产出滚动上下文', () => {
        it('第一段 rollingSummary 为空', async () => {
            const paragraphs = [];
            for (let i = 0; i < 30; i++) {
                paragraphs.push('段落' + i + '的内容。这里有一些填充文字来凑够字数。');
            }
            const text = paragraphs.join('\n\n');
            const result = await segmenter.segmentWithContext(text);
            expect(result.length).toBeGreaterThan(1);
            expect(result[0].rollingSummary).toBeUndefined();
        });

        it('段 N>0 时 rollingSummary 非空', async () => {
            const paragraphs = [];
            for (let i = 0; i < 30; i++) {
                paragraphs.push('段落' + i + '的内容。这里有一些填充文字来凑够字数。');
            }
            const text = paragraphs.join('\n\n');
            const result = await segmenter.segmentWithContext(text);
            expect(result.length).toBeGreaterThan(1);
            for (let i = 1; i < result.length; i++) {
                expect(result[i].rollingSummary).toBeDefined();
                expect(result[i].rollingSummary!.length).toBeGreaterThan(0);
            }
        });

        it('rollingSummary 包含前段末尾文本内容', async () => {
            const marker = '【MARKER_紫川秀拔刀】';
            const text = ('前段填充内容。'.repeat(30)) +
                marker +
                '\n\n第二段开始：新的情节展开。'.repeat(5);
            const result = await segmenter.segmentWithContext(text);
            expect(result.length).toBeGreaterThan(1);
            let found = false;
            for (let i = 1; i < result.length; i++) {
                if (result[i].rollingSummary?.includes('紫川秀')) {
                    found = true;
                    break;
                }
            }
            expect(found).toBe(true);
        });

        it('overlapWithPrev 在非首段存在', async () => {
            const paragraphs = [];
            for (let i = 0; i < 30; i++) {
                paragraphs.push('段落' + i + '的内容。这里有一些填充文字来凑够字数。');
            }
            const text = paragraphs.join('\n\n');
            const result = await segmenter.segmentWithContext(text);
            expect(result.length).toBeGreaterThan(1);
            for (let i = 1; i < result.length; i++) {
                expect(result[i].overlapWithPrev).toBeDefined();
                expect(result[i].overlapWithPrev!.length).toBeGreaterThan(0);
            }
        });
    });

    describe('TR-3.2: extractKeyEntities 提取中文人名', () => {
        it('从书名号提取人名', () => {
            const text = '《紫川秀》《帝林》《斯特林》都是紫川家族的核心人物。';
            const entities = extractKeyEntities(text);
            expect(entities).toContain('紫川秀');
            expect(entities).toContain('帝林');
            expect(entities).toContain('斯特林');
        });

        it('从对话引语前提取说话人名', () => {
            const text = '紫川秀说："我们出发吧。"帝林问道："你确定吗？"斯特林笑道："当然确定。';
            const entities = extractKeyEntities(text);
            expect(entities).toContain('紫川秀');
            expect(entities).toContain('帝林');
            expect(entities).toContain('斯特林');
        });

        it('去重', () => {
            const text = '《紫川秀》说了很多。紫川秀说："我来处理。"《紫川秀》又出现了。';
            const entities = extractKeyEntities(text);
            const occurrences = entities.filter(e => e === '紫川秀').length;
            expect(occurrences).toBe(1);
        });

        it('无人物时返回空数组', () => {
            const text = '这是一段没有人物名称的普通描述文本。风景很美，天气很好。';
            const entities = extractKeyEntities(text);
            expect(entities).toEqual([]);
        });

        it('过滤非人名短词', () => {
            const text = '他说："你好。"她问道："你是？"';
            const entities = extractKeyEntities(text);
            expect(entities).toEqual([]);
        });
    });

    describe('TR-3.3: 原有 segment() 不受影响', () => {
        it('segment() 不输出 rollingSummary', async () => {
            const paragraphs = [];
            for (let i = 0; i < 30; i++) {
                paragraphs.push('段落' + i + '的内容。这里有一些填充文字来凑够字数。');
            }
            const text = paragraphs.join('\n\n');
            const result = await segmenter.segment(text);
            expect(result.length).toBeGreaterThan(1);
            for (const seg of result) {
                expect(seg.rollingSummary).toBeUndefined();
                expect(seg.overlapWithPrev).toBeUndefined();
            }
        });

        it('segment() 结果数量与 segmentWithContext() 一致', async () => {
            const paragraphs = [];
            for (let i = 0; i < 30; i++) {
                paragraphs.push('段落' + i + '的内容。这里有一些填充文字来凑够字数。');
            }
            const text = paragraphs.join('\n\n');
            const segResult = await segmenter.segment(text);
            const ctxResult = await segmenter.segmentWithContext(text);
            expect(ctxResult.length).toBe(segResult.length);
        });

        it('segment() 分段的文本内容不变', async () => {
            const text = '第一章 测试\n这是一段测试内容。'.repeat(30);
            const segResult = await segmenter.segment(text);
            const ctxResult = await segmenter.segmentWithContext(text);
            for (let i = 0; i < segResult.length; i++) {
                expect(ctxResult[i].text).toBe(segResult[i].text);
                expect(ctxResult[i].index).toBe(segResult[i].index);
                expect(ctxResult[i].startOffset).toBe(segResult[i].startOffset);
                expect(ctxResult[i].endOffset).toBe(segResult[i].endOffset);
                expect(ctxResult[i].wordCount).toBe(segResult[i].wordCount);
                expect(ctxResult[i].chapterTitle).toBe(segResult[i].chapterTitle);
            }
        });
    });
});
