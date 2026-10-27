import { describe, it, expect } from 'vitest';
import { createSeededRandom, trueRandom } from '../../../engine/harness/true-random';
import { CreativeRandomizer } from '../../../engine/harness/creative-randomizer';
import { SHORT_STORY_FRAMEWORK, SCRIPT_FRAMEWORK, frameworkPromptBlock, getFramework } from '../../../engine/harness/creative-frameworks';
import { normalizeTrendConfig, buildTrendQuery, TrendResearchService } from '../../../engine/harness/trend-research-service';
import { AiAssistedPremiseService } from '../../../engine/harness/ai-assisted-premise-service';

describe('真随机引擎', () => {
    it('pick 不越界且 shuffle 保留元素', () => {
        const items = [1, 2, 3, 4, 5];
        for (let i = 0; i < 100; i++) {
            expect(items).toContain(trueRandom.pick(items));
        }
        const shuffled = trueRandom.shuffle(items);
        expect([...shuffled].sort()).toEqual([...items].sort());
    });

    it('randomInt 范围正确且多次采样不全等', () => {
        const values = new Set<number>();
        for (let i = 0; i < 200; i++) {
            const value = trueRandom.randomInt(10);
            expect(value).toBeGreaterThanOrEqual(0);
            expect(value).toBeLessThan(10);
            values.add(value);
        }
        expect(values.size).toBeGreaterThan(5);
    });

    it('CSPRNG 与种子随机结果不同（非同分布重放）', () => {
        const seeded = createSeededRandom('same-seed');
        const first = Array.from({ length: 10 }, () => seeded.randomInt(1000));
        const seededAgain = createSeededRandom('same-seed');
        const replay = Array.from({ length: 10 }, () => seededAgain.randomInt(1000));
        expect(first).toEqual(replay);
        const random = Array.from({ length: 10 }, () => trueRandom.randomInt(1000));
        expect(random).not.toEqual(first);
    });

    it('uuid 生成非重复标识', () => {
        const values = new Set(Array.from({ length: 100 }, () => trueRandom.uuid()));
        expect(values.size).toBe(100);
    });
});

describe('多层随机因子', () => {
    const randomizer = new CreativeRandomizer(createSeededRandom('framework-test'));

    it('短篇/剧本各层因子齐全且含禁用套路', () => {
        for (const mode of ['short', 'script'] as const) {
            const factors = randomizer.buildFactors(mode);
            expect(factors.seed).toBeTruthy();
            expect(factors.layers.premise.length).toBeGreaterThan(4);
            expect(factors.layers.structure.length).toBeGreaterThan(2);
            expect(factors.layers.texture).toHaveLength(3);
            expect(factors.layers.differentiation.length).toBeGreaterThan(2);
            expect(factors.forbiddenPatterns.length).toBeGreaterThanOrEqual(2);
        }
    });

    it('同种子因子一致，不同实例默认因子大概率不同', () => {
        const a = randomizer.buildFactors('short');
        const b = randomizer.buildFactors('short');
        expect(b.seed).not.toBe(a.seed);
        const promptA = randomizer.promptBlock(a);
        const promptB = randomizer.promptBlock(b);
        expect(promptA).toContain('【多层真随机创作因子】');
        expect(promptA).toContain('随机种子');
        expect(promptB).toContain('随机种子');
    });
});

describe('固化创作框架', () => {
    it('短篇框架符合行业范式与校验节点', () => {
        expect(SHORT_STORY_FRAMEWORK.industryBasis).toContain('5–10 万字');
        expect(SHORT_STORY_FRAMEWORK.beats.map(beat => beat.id)).toEqual(['S1', 'S2', 'S3', 'S4', 'S5', 'S6']);
        expect(SHORT_STORY_FRAMEWORK.hardConstraints.some(item => item.includes('钩子'))).toBe(true);
    });

    it('剧本框架覆盖 3 秒钩子与分镜交付', () => {
        expect(SCRIPT_FRAMEWORK.industryBasis).toContain('3 秒钩子');
        expect(SCRIPT_FRAMEWORK.beats.some(beat => beat.title.includes('分镜表'))).toBe(true);
        expect(SCRIPT_FRAMEWORK.hardConstraints.some(item => item.includes('旁白'))).toBe(true);
    });

    it('框架提示词块包含阶段交付与硬约束', () => {
        const block = frameworkPromptBlock('short', '测试项目');
        expect(block).toContain('固化创作框架');
        expect(block).toContain('行业依据');
        expect(block).toContain('硬约束');
        expect(getFramework('long')).toBeNull();
    });
});

describe('热点调研服务', () => {
    it('manual 或无 key 不发请求', async () => {
        let called = false;
        const service = new TrendResearchService(normalizeTrendConfig({ provider: 'manual', maxSources: 3 }), async () => {
            called = true;
            return { status: 200, text: '[]' };
        });
        expect(await service.search('short', '婚姻家庭')).toEqual([]);
        expect(called).toBe(false);
    });

    it('Brave 来源解析并裁剪数量', async () => {
        const service = new TrendResearchService(normalizeTrendConfig({ provider: 'brave', apiKey: 'k', maxSources: 2 }), async () => ({
            status: 200,
            text: JSON.stringify({
                web: { results: [
                    { title: 'A', url: 'https://a.example', description: 'a' },
                    { title: 'B', url: 'https://b.example', description: 'b' },
                    { title: 'C', url: 'https://c.example', description: 'c' },
                ] },
            }),
        }));
        const sources = await service.search('script', '都市逆袭');
        expect(sources).toHaveLength(2);
        expect(sources[0].title).toBe('A');
    });

    it('查询构造区分短篇与剧本', () => {
        expect(buildTrendQuery('short', '婚姻家庭', '女频')).toContain('番茄小说');
        expect(buildTrendQuery('script', '都市逆袭', '短剧')).toContain('红果短剧');
    });
});

describe('AI 前期调研服务', () => {
    it('结合随机因子/框架/来源输出 3 个候选并标注未核实', async () => {
        const ai = {
            callAI: async () => ({
                content: JSON.stringify({
                    summary: '未经实时核实：当前短篇偏好强情绪单主线',
                    sources: [{ title: '模型来源', url: '', snippet: '模型推断' }],
                    suggestions: [
                        { name: '甲', logline: 'A', coreConflict: 'C1', emotionalPromise: 'E1', hook: 'H1', endingPayoff: 'F1', characters: 'P1', scenes: 'S1' },
                        { name: '乙', logline: 'B', coreConflict: 'C2', emotionalPromise: 'E2', hook: 'H2', endingPayoff: 'F2', characters: 'P2', scenes: 'S2' },
                        { name: '丙', logline: 'D', coreConflict: 'C3', emotionalPromise: 'E3', hook: 'H3', endingPayoff: 'F3', characters: 'P3', scenes: 'S3' },
                    ],
                }),
                error: undefined,
            }),
        } as never;

        const service = new AiAssistedPremiseService(ai, normalizeTrendConfig({ provider: 'manual' }));
        const result = await service.generate({ mode: 'short', categoryOrGenre: '婚姻家庭' });

        expect(result.suggestions).toHaveLength(3);
        expect(result.trend.verified).toBe(false);
        expect(result.trend.warnings.join('')).toContain('需人工核实');
        expect(result.premiseBlock).toContain('固化创作框架');
        expect(result.premiseBlock).toContain('多层真随机创作因子');
        expect(result.randomBrief.seed).toBeTruthy();
    });

    it('AI 返回为空时抛错，不伪造候选', async () => {
        const ai = { callAI: async () => ({ content: '', error: 'empty' }) } as never;
        const service = new AiAssistedPremiseService(ai, normalizeTrendConfig({ provider: 'manual' }));
        await expect(service.generate({ mode: 'script', categoryOrGenre: '都市逆袭' })).rejects.toThrow();
    });
});
