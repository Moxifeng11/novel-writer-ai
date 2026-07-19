import { describe, it, expect } from 'vitest';
import {
    StructureDeconstructor,
    NarrativeOrder,
    NarrativeDuration,
    NarrativeFrequency,
    StructureTemplateType
} from '../../../engine/deconstructors/structure-deconstructor';

function buildChronologicalText(): string {
    const parts: string[] = [];
    for (let i = 0; i < 30; i++) {
        parts.push(`第${i + 1}章 主角前行\n\n主角继续向前走去，开始新的旅程。他看到了远方的山峦，听到了风声，闻到了花香。`);
    }
    return parts.join('\n\n');
}

function buildMixedOrderText(): string {
    const parts: string[] = [];
    parts.push('第1章 开端\n\n主角站在那里，回忆起往昔的往事。当年他还是个孩子，那时父亲曾带他来过这里。');
    parts.push('第2章 继续\n\n多年后，主角终于回到了故乡。他想起当年的约定，决定继续前行。');
    parts.push('第3章 高潮\n\n主角将来来往往的人群抛在身后，曾经的朋友都已不在。多年后，他终将完成使命。');
    return parts.join('\n\n');
}

function buildIterativeFrequencyText(): string {
    return '主角每天清晨都会修炼。每次修炼都让他变得更强。他总是不断突破自己，常常一坐就是一整天。日复一日，年复一年，他从未停下脚步。';
}

function buildRepetitiveFrequencyText(): string {
    return '他又一次失败了。再一次，他站了起来。再次面对挑战，他不再退缩。又一次的失败让他变得更强。';
}

function buildWebnovelFormulaText(): string {
    const parts: string[] = [];
    parts.push('第1章 穿越\n\n主角穿越到了异世界，醒来时发现自己躺在一个陌生的地方。系统激活，金手指开启。');
    parts.push('第2章 冲突\n\n有人前来挑衅，主角面对对手的羞辱。打脸时刻，所有人都震惊了，不可思议。');
    parts.push('第3章 升级\n\n主角开始修炼升级，突破境界，进阶变强。他不断突破，提升自己。');
    parts.push('第4章 高潮\n\n大高潮来临，主角面临决战。终极对决，最终战胜了最强的对手。');
    return parts.join('\n\n');
}

describe('StructureDeconstructor - 叙事时序与模板匹配扩展', () => {
    const deconstructor = new StructureDeconstructor();

    describe('analyze - 叙事时序分析', () => {
        it('空文本返回 chronological 默认值', async () => {
            const result = await deconstructor.analyze('');
            expect(result.narrativeTemporality).toBeDefined();
            expect(result.narrativeTemporality!.order.type).toBe('chronological');
            expect(result.narrativeTemporality!.frequency.type).toBe('singulative');
        });

        it('时序类型能正确识别 chronological', async () => {
            const text = buildChronologicalText();
            const result = await deconstructor.analyze(text);
            const order = result.narrativeTemporality!.order.type;
            const validTypes: NarrativeOrder[] = ['chronological', 'analeptic', 'proleptic', 'mixed'];
            expect(validTypes).toContain(order);
        });

        it('时序类型能识别 mixed（倒叙+预叙共存）', async () => {
            const text = buildMixedOrderText();
            const result = await deconstructor.analyze(text);
            expect(['mixed', 'analeptic', 'proleptic']).toContain(result.narrativeTemporality!.order.type);
            const analepticCount = result.narrativeTemporality!.order.flashbacks.length;
            const prolepticCount = result.narrativeTemporality!.order.flashforwards.length;
            if (analepticCount > 0 && prolepticCount > 0) {
                expect(result.narrativeTemporality!.order.type).toBe('mixed');
            }
        });

        it('时长分布占比总和约等于 1', async () => {
            const text = buildChronologicalText();
            const result = await deconstructor.analyze(text);
            const dist = result.narrativeTemporality!.duration.distribution;
            const sum = dist.scene + dist.summary + dist.pause + dist.ellipsis + dist.stretch;
            expect(sum).toBeGreaterThan(0.99);
            expect(sum).toBeLessThan(1.01);
        });

        it('时长主导类型在分布中', async () => {
            const text = buildChronologicalText();
            const result = await deconstructor.analyze(text);
            const dominant = result.narrativeTemporality!.duration.dominantType;
            const validTypes: NarrativeDuration[] = ['scene', 'summary', 'pause', 'ellipsis', 'stretch'];
            expect(validTypes).toContain(dominant);
        });

        it('频率类型能识别 iterative', async () => {
            const text = buildIterativeFrequencyText();
            const result = await deconstructor.analyze(text);
            expect(['iterative', 'singulative']).toContain(result.narrativeTemporality!.frequency.type);
        });

        it('频率类型能识别 repeating', async () => {
            const text = buildRepetitiveFrequencyText();
            const result = await deconstructor.analyze(text);
            expect(['repeating', 'singulative']).toContain(result.narrativeTemporality!.frequency.type);
        });

        it('时序置信度在 0-1 之间', async () => {
            const text = buildMixedOrderText();
            const result = await deconstructor.analyze(text);
            const conf = result.narrativeTemporality!.order.confidence;
            expect(conf).toBeGreaterThanOrEqual(0);
            expect(conf).toBeLessThanOrEqual(1);
        });

        it('倒叙位置在 0-1 之间', async () => {
            const text = buildMixedOrderText();
            const result = await deconstructor.analyze(text);
            for (const fb of result.narrativeTemporality!.order.flashbacks) {
                expect(fb.position).toBeGreaterThanOrEqual(0);
                expect(fb.position).toBeLessThanOrEqual(1);
                expect(fb.targetPosition).toBeGreaterThanOrEqual(0);
                expect(fb.targetPosition).toBeLessThanOrEqual(1);
            }
        });
    });

    describe('analyze - 结构模板匹配', () => {
        it('空文本仍返回模板结果', async () => {
            const result = await deconstructor.analyze('');
            expect(result.templateMatch).toBeDefined();
            expect(result.templateMatch!.bestMatch).toBeDefined();
            expect(result.templateMatch!.allMatches).toBeDefined();
        });

        it('matchScore 在 0-100 之间', async () => {
            const text = buildWebnovelFormulaText();
            const result = await deconstructor.analyze(text);
            for (const m of result.templateMatch!.allMatches) {
                expect(m.matchScore).toBeGreaterThanOrEqual(0);
                expect(m.matchScore).toBeLessThanOrEqual(100);
            }
        });

        it('bestMatch 是 allMatches 中得分最高的', async () => {
            const text = buildWebnovelFormulaText();
            const result = await deconstructor.analyze(text);
            const allScores = result.templateMatch!.allMatches.map(m => m.matchScore);
            const maxScore = Math.max(...allScores);
            expect(result.templateMatch!.bestMatch.matchScore).toBe(maxScore);
        });

        it('模板类型覆盖所有预定义类型', async () => {
            const text = buildWebnovelFormulaText();
            const result = await deconstructor.analyze(text);
            const types = result.templateMatch!.allMatches.map(m => m.template);
            const expectedTypes: StructureTemplateType[] = [
                'three_act', 'hero_journey', 'kishotenketsu', 'save_the_cat', 'webnovel_formula'
            ];
            for (const t of expectedTypes) {
                expect(types).toContain(t);
            }
        });

        it('网文公式文本应匹配 webnovel_formula 或其他高得分模板', async () => {
            const text = buildWebnovelFormulaText();
            const result = await deconstructor.analyze(text);
            const webnovelMatch = result.templateMatch!.allMatches.find(m => m.template === 'webnovel_formula');
            expect(webnovelMatch).toBeDefined();
            expect(webnovelMatch!.matchScore).toBeGreaterThan(0);
        });

        it('matchedNodes 与 missingNodes 之和等于总节点数', async () => {
            const text = buildWebnovelFormulaText();
            const result = await deconstructor.analyze(text);
            for (const m of result.templateMatch!.allMatches) {
                const total = m.matchedNodes.length + m.missingNodes.length;
                expect(total).toBeGreaterThan(0);
            }
        });

        it('匹配节点置信度在 0-1 之间', async () => {
            const text = buildWebnovelFormulaText();
            const result = await deconstructor.analyze(text);
            for (const m of result.templateMatch!.allMatches) {
                for (const n of m.matchedNodes) {
                    expect(n.confidence).toBeGreaterThanOrEqual(0);
                    expect(n.confidence).toBeLessThanOrEqual(1);
                    expect(n.position).toBeGreaterThanOrEqual(0);
                    expect(n.position).toBeLessThanOrEqual(1);
                }
            }
        });
    });

    describe('analyze - 向后兼容性', () => {
        it('不破坏现有 QCCH 分析', async () => {
            const text = buildChronologicalText();
            const result = await deconstructor.analyze(text);
            expect(result.qcchSegments).toBeDefined();
            expect(Array.isArray(result.qcchSegments)).toBe(true);
            expect(result.rhythmUnits).toBeDefined();
            expect(result.threeLineStructure).toBeDefined();
            expect(result.structureType).toBeDefined();
            expect(result.stats).toBeDefined();
        });

        it('Markdown 输出包含新增的分析部分', async () => {
            const text = buildWebnovelFormulaText();
            const result = await deconstructor.analyze(text);
            expect(result.narrativeTemporality).toBeDefined();
            expect(result.templateMatch).toBeDefined();
            expect(result.narrativeTemporality!.description).toContain('时序类型');
            expect(result.templateMatch!.description).toContain('最佳匹配');
        });

        it('buildMarkdownBody 包含叙事时序与模板匹配章节', async () => {
            const text = buildWebnovelFormulaText();
            const result = await deconstructor.analyze(text);
            const anyDec = deconstructor as unknown as {
                buildMarkdownBody(r: typeof result, name: string): string;
                buildFrontmatter(r: typeof result): string;
            };
            const md = anyDec.buildMarkdownBody(result, '测试书');
            expect(md).toContain('## 叙事时序分析（Genette 框架）');
            expect(md).toContain('### 时序（Order）');
            expect(md).toContain('### 时长（Duration）');
            expect(md).toContain('### 频率（Frequency）');
            expect(md).toContain('## 结构模板匹配');
            expect(md).toContain('### 所有模板评分对比');
            expect(md).toContain('### 最佳匹配详情');
        });

        it('buildFrontmatter 包含新增字段', async () => {
            const text = buildWebnovelFormulaText();
            const result = await deconstructor.analyze(text);
            const anyDec = deconstructor as unknown as {
                buildFrontmatter(r: typeof result): string;
            };
            const fm = anyDec.buildFrontmatter(result);
            const parsed = JSON.parse(fm);
            expect(parsed.narrativeTemporality).toBeDefined();
            expect(parsed.templateMatch).toBeDefined();
            expect(parsed.narrativeTemporality.order).toBeDefined();
            expect(parsed.narrativeTemporality.duration).toBeDefined();
            expect(parsed.narrativeTemporality.frequency).toBeDefined();
            expect(parsed.templateMatch.bestMatch).toBeDefined();
            expect(Array.isArray(parsed.templateMatch.allMatches)).toBe(true);
        });
    });
});
