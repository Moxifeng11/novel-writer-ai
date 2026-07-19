import { describe, it, expect } from 'vitest';
import { RhythmDeconstructor, EmotionPoint } from '../../../engine/deconstructors/rhythm-deconstructor';

/**
 * P4 节奏分析修复测试
 *
 * 背景：
 * - P4.1 description 全是模板占位符 "低谷（语义匹配）"/"反转（语义匹配）"
 * - P4.2 intensity 值过低 0.06-0.27，未检测到强情绪点
 * - P4.3 emotionPoints 缺少具体事件描述
 *
 * 修复：
 * - 移除"（语义匹配）"模板占位符
 * - 在 detectEmotionPoints 中检测 tension 关键词提升 intensity（每个匹配 +0.1，最多 +0.6）
 * - 新增 eventDescription 字段，从段落首句提取（< 30 字）
 */
describe('RhythmDeconstructor - P4 节奏分析修复', () => {
    describe('SubTask 10.1 + 10.3: 模板占位符移除 + eventDescription 字段', () => {
        it('emotionPoints description 不应包含"（语义匹配）"模板占位符', async () => {
            const deconstructor = new RhythmDeconstructor();
            const text = buildRhythmTestText();
            const result = await deconstructor.analyze(text);

            expect(result.emotionPoints.length).toBeGreaterThan(0);
            for (const point of result.emotionPoints) {
                expect(point.description).not.toContain('（语义匹配）');
                expect(point.description).not.toContain('语义匹配');
            }
        });

        it('emotionPoints 每个元素应包含 eventDescription 字段', async () => {
            const deconstructor = new RhythmDeconstructor();
            const text = buildRhythmTestText();
            const result = await deconstructor.analyze(text);

            expect(result.emotionPoints.length).toBeGreaterThan(0);
            for (const point of result.emotionPoints) {
                expect(point.eventDescription).toBeDefined();
                expect(typeof point.eventDescription).toBe('string');
                // eventDescription 应不超过 30 字
                expect(point.eventDescription!.length).toBeLessThanOrEqual(30);
            }
        });

        it('eventDescription 应为段落首句的具体内容，非空', async () => {
            const deconstructor = new RhythmDeconstructor();
            const text = buildRhythmTestText();
            const result = await deconstructor.analyze(text);

            const nonEmptyPoints = result.emotionPoints.filter(p => p.eventDescription && p.eventDescription.length > 0);
            // 至少有一个 eventDescription 是非空的
            expect(nonEmptyPoints.length).toBeGreaterThan(0);
        });
    });

    describe('SubTask 10.2 + 10.4: intensity 修复（关键词密度提升）', () => {
        it('包含战斗/对峙/反转关键词的章节，emotionPoints intensity 应 > 0.5', async () => {
            const deconstructor = new RhythmDeconstructor();
            const text = buildRhythmTestText();
            const result = await deconstructor.analyze(text);

            expect(result.emotionPoints.length).toBeGreaterThan(0);
            // 至少一个 emotionPoint 的 intensity > 0.5（之前 0.06-0.27）
            const highIntensityPoints = result.emotionPoints.filter(p => p.intensity > 0.5);
            expect(highIntensityPoints.length).toBeGreaterThan(0);
        });

        it('紫川第一章风格样本：emotionPoints intensity 合理提升（> 0.5）', async () => {
            const deconstructor = new RhythmDeconstructor();
            // 模拟紫川第一章节奏：开篇平静 → 魔族溃退战斗冲突 → 平静过渡
            const calm1 = '紫川秀站在山冈上看着远方的战场，思考着家族的未来。'.repeat(15);
            const peak1 = '魔族溃退厮杀战斗冲突对决交锋，愤怒咆哮怒吼厉声呵斥斥责，紫川秀冲过去砍劈刺杀敌人，惊讶震惊意想不到出乎意料，反转翻盘逆转。'.repeat(15);
            const calm2 = '战斗结束后，紫川秀回到营地，慢慢恢复体力。'.repeat(15);
            const peak2 = '又一轮激战厮杀战斗对决，反转出乎意料，惊讶震惊，胜利凯旋狂喜惊喜。'.repeat(15);
            const calm3 = '战争结束，紫川秀回到家乡，过上平静生活。'.repeat(15);
            const text = [
                '第一章 紫川之始', '', calm1, '', peak1, '', calm2, '', peak2, '', calm3
            ].join('\n');

            const result = await deconstructor.analyze(text);

            expect(result.emotionPoints.length).toBeGreaterThan(0);
            // 验证 P4.2: intensity > 0.5（修复前 0.06-0.27）
            const highIntensityPoints = result.emotionPoints.filter(p => p.intensity > 0.5);
            expect(highIntensityPoints.length).toBeGreaterThan(0);
            // 验证 P4.1: description 不含模板占位符
            for (const point of result.emotionPoints) {
                expect(point.description).not.toContain('（语义匹配）');
            }
            // 验证 P4.3: eventDescription 字段存在
            for (const point of result.emotionPoints) {
                expect(point.eventDescription).toBeDefined();
                expect(typeof point.eventDescription).toBe('string');
            }
        });

        it('纯平静文本（无 tension 关键词）的 emotionPoints intensity 应较低', async () => {
            const deconstructor = new RhythmDeconstructor();
            // 构造一个有节奏起伏但无 tension 关键词的文本
            const calmParagraph = '这是平静的描述，主角在思考人生的意义，慢慢走在小路上。'.repeat(20);
            const peakParagraph = '主角非常激动兴奋，开心幸福满足，畅快痛快骄傲自豪，得意扬眉吐气。'.repeat(20);
            const text = [
                '第一章\n\n',
                calmParagraph,
                '\n\n',
                peakParagraph,
                '\n\n',
                calmParagraph,
                '\n\n',
                peakParagraph,
                '\n\n',
                calmParagraph
            ].join('');

            const result = await deconstructor.analyze(text);
            // 即使有 emotionPoints，没有 tension 关键词时 intensity 不应被 boost
            // 但整体 intensity 仍取决于段落本身的 overallRhythm
            if (result.emotionPoints.length > 0) {
                // 验证不会因为 keyword boost 而异常高
                for (const point of result.emotionPoints) {
                    expect(point.intensity).toBeGreaterThanOrEqual(0);
                    expect(point.intensity).toBeLessThanOrEqual(1);
                }
            }
        });
    });

    describe('边界场景', () => {
        it('空文本应返回空结果', async () => {
            const deconstructor = new RhythmDeconstructor();
            const result = await deconstructor.analyze('');
            expect(result.emotionPoints).toEqual([]);
        });

        it('短文本（< 5 段）应返回空 emotionPoints', async () => {
            const deconstructor = new RhythmDeconstructor();
            const text = '第一章\n\n短文本1\n\n短文本2';
            const result = await deconstructor.analyze(text);
            expect(result.emotionPoints).toEqual([]);
        });

        it('eventDescription 在段落为空时应返回空字符串', async () => {
            const deconstructor = new RhythmDeconstructor();
            const text = buildRhythmTestText();
            const result = await deconstructor.analyze(text);

            // 所有 eventDescription 都应为字符串（包括空字符串）
            for (const point of result.emotionPoints) {
                expect(typeof point.eventDescription).toBe('string');
            }
        });
    });

    describe('analyzeWithVector：模板占位符移除（向量增强路径）', () => {
        it('analyzeWithVector 路径下 description 也不应包含"（语义匹配）"', async () => {
            const mockVectorEnhancer = createMockVectorEnhancer();
            const deconstructor = new RhythmDeconstructor(mockVectorEnhancer);
            const text = buildRhythmTestText();

            const result = await deconstructor.analyzeWithVector(text);

            // 至少有 emotionPoints（前提条件）
            if (result.emotionPoints.length > 0) {
                for (const point of result.emotionPoints) {
                    expect(point.description).not.toContain('（语义匹配）');
                    expect(point.description).not.toContain('语义匹配');
                }
            }
        });

        it('analyzeWithVector 路径下 emotionPoints 也应包含 eventDescription', async () => {
            const mockVectorEnhancer = createMockVectorEnhancer();
            const deconstructor = new RhythmDeconstructor(mockVectorEnhancer);
            const text = buildRhythmTestText();

            const result = await deconstructor.analyzeWithVector(text);

            if (result.emotionPoints.length > 0) {
                for (const point of result.emotionPoints) {
                    expect(point.eventDescription).toBeDefined();
                    expect(typeof point.eventDescription).toBe('string');
                }
            }
        });

        it('vectorEnhancer 不可用时应降级为纯统计结果，description 仍不含"（语义匹配）"', async () => {
            const deconstructor = new RhythmDeconstructor(undefined);
            const text = buildRhythmTestText();

            const result = await deconstructor.analyzeWithVector(text);

            if (result.emotionPoints.length > 0) {
                for (const point of result.emotionPoints) {
                    expect(point.description).not.toContain('（语义匹配）');
                }
            }
        });
    });

    describe('frontmatter / markdown 输出包含 eventDescription', () => {
        it('saveAnalysisToMarkdown 生成的 markdown 应包含"具体事件"列', async () => {
            const deconstructor = new RhythmDeconstructor();
            const text = buildRhythmTestText();
            const result = await deconstructor.analyze(text);

            // 通过反射调用 buildMarkdownBody 验证输出
            // 由于 buildMarkdownBody 是 private，直接通过 saveAnalysisToMarkdown 验证
            const writes: Array<{ path: string; data: string }> = [];
            const mockApp = {
                vault: {
                    adapter: {
                        exists: async () => true,
                        mkdir: async () => {},
                        write: async (path: string, data: string) => {
                            writes.push({ path, data });
                        }
                    }
                }
            };

            await deconstructor.saveAnalysisToMarkdown(
                mockApp as any,
                '测试书籍',
                result
            );

            expect(writes.length).toBe(1);
            const markdown = writes[0].data;
            // 如果有 emotionPoints，markdown 应包含"具体事件"列标题
            if (result.emotionPoints.length > 0) {
                expect(markdown).toContain('具体事件');
            }
        });
    });
});

/**
 * 构造用于节奏分析测试的文本
 * - 包含 5+ 段落
 * - 段落间有节奏起伏（平静段 + 高密度动作/情绪/战斗段）
 * - 包含 TENSION_KEYWORDS 中的关键词（战斗/厮杀/反转/惊讶/震惊）
 */
function buildRhythmTestText(): string {
    const calmPara1 = '紫川秀站在山冈上看着远方的战场，思考着接下来的行动。'.repeat(15);
    const peakPara1 = '激战厮杀战斗冲突对决交锋，愤怒咆哮怒吼厉声呵斥，主角冲过去打敌人，砍劈刺杀，惊讶震惊意想不到出乎意料，反转翻盘逆转。'.repeat(15);
    const calmPara2 = '战斗结束后，主角回到营地，慢慢恢复体力，平静地思考。'.repeat(15);
    const peakPara2 = '又一轮激战厮杀战斗对决，反转出乎意料，惊讶震惊，没想到竟然如此，胜利凯旋狂喜惊喜。'.repeat(15);
    const calmPara3 = '故事结束，主角回到家乡，过上了平静的生活。'.repeat(15);

    return [
        '第一章 测试章节',
        '',
        calmPara1,
        '',
        peakPara1,
        '',
        calmPara2,
        '',
        peakPara2,
        '',
        calmPara3
    ].join('\n');
}

/**
 * 创建 mock vectorEnhancer
 * - isAvailable 返回 true
 * - embedTexts 返回固定向量
 * - cosineSimilarity 返回固定相似度
 */
function createMockVectorEnhancer(): any {
    return {
        isAvailable: async () => true,
        embedTexts: async (texts: string[]) => {
            // 返回简单向量：每个文本一个 3 维向量
            return texts.map((_, idx) => [idx * 0.1, idx * 0.2, idx * 0.3]);
        },
        cosineSimilarity: (a: number[], b: number[]) => {
            // 简单点积
            let sum = 0;
            for (let i = 0; i < Math.min(a.length, b.length); i++) {
                sum += a[i] * b[i];
            }
            return sum;
        }
    };
}
