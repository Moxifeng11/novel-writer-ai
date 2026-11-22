/**
 * knowledge-injector-fingerprint.test.ts — 正文生成/润色的指纹来源唯一化
 *
 * 旧实现经 `getEnabledFingerprintsFromLibrary(profile)` 只读
 * `profile.fingerprint.enabledProject/enabledGlobal`，而这两个数组在全仓没有任何写入方
 * （默认空、只能手改画像文件）：11 步正文生成的「写作指纹风格参考」永远为空，
 * 指纹只对协同写作生效。这里锁定「以指纹库启用状态为唯一真相源」，
 * 且强度 0（界面「完全禁用」）不注入。
 */

import { describe, it, expect } from 'vitest';
import { KnowledgeInjector, type InjectionContext } from '../../../engine/knowledge-injector';
import { DEFAULT_INTENSITY_CONFIG, type StyleIntensityConfig } from '../../../engine/style/style-intensity-engine';
import type { StyleFingerprint, StyleFingerprintLibrary } from '../../../engine/style-fingerprint-library';
import type { StyleFingerprintFeaturesV2 } from '../../../engine/style/style-dimensions-v2';
import type { WritingProfile } from '../../../engine/writing-profile';
import type { App } from 'obsidian';

function makeFp(
    id: string,
    scope: 'project' | 'global',
    enabled: boolean,
    features: Partial<StyleFingerprint['features']>,
): StyleFingerprint {
    return {
        id,
        name: id,
        source: 'test',
        scope,
        enabled,
        tags: [],
        stats: {} as StyleFingerprint['stats'],
        features: features as StyleFingerprint['features'],
        samples: [],
        extractedAt: 1,
    };
}

function makeLibrary(
    project: StyleFingerprint[],
    global: StyleFingerprint[],
    configs: Record<string, StyleIntensityConfig> = {},
    v2: Record<string, StyleFingerprintFeaturesV2> = {},
): StyleFingerprintLibrary {
    return {
        loadIntensityConfigs: async () => configs,
        listProject: () => project,
        listGlobal: () => global,
        isGlobalEnabledForProject: (fpId: string) => !!global.find(fp => fp.id === fpId && fp.enabled),
        getIntensityConfig: (fpId: string) => configs[fpId] ?? DEFAULT_INTENSITY_CONFIG,
        getV2FeaturesMap: (ids: string[]) => new Map(ids.filter(id => v2[id]).map(id => [id, v2[id]])),
    } as unknown as StyleFingerprintLibrary;
}

/** 只填测试关心的维度；其余维度缺失时注入器应自动跳过 */
function makeV2(patch: Record<string, unknown>): StyleFingerprintFeaturesV2 {
    return patch as unknown as StyleFingerprintFeaturesV2;
}

const V2_SENTENCE_PATTERN = {
    inversionDensity: 2.4,
    ellipsisDensity: 1.2,
    parallelismDensity: 0.8,
    rhetoricalQuestionRatio: 0.06,
    clauseNestingDepth: 1.3,
    description: '短句倒装多，少用长从句',
    samples: [],
    status: 'complete' as const,
};

/** 前两个参数是已删除的旧画像字段：保留用于验证「旧字段写了 id 也不生效」 */
function makeProfile(
    enabledProject: string[] = [],
    enabledGlobal: string[] = [],
    injectionStrength = 0.8,
): WritingProfile {
    return {
        style: {
            primaryStyle: '冷峻',
            perspective: 'third',
            formalityLevel: 0.6,
            sentenceRhythm: '短句为主',
        },
        fingerprint: { injectionStrength, enabledProject, enabledGlobal },
    } as unknown as WritingProfile;
}

function makeInjector(library: StyleFingerprintLibrary): KnowledgeInjector {
    const injector = new KnowledgeInjector({} as App, { fingerprintLibrary: library });
    injector.setSwitches({
        rhythm: false,
        technique: false,
        character: false,
        foreshadow: false,
        rules: false,
    });
    return injector;
}

const CTX = { projectPath: '/test' } as InjectionContext;

describe('KnowledgeInjector — 正文生成指纹以库为准', () => {
    it('库里有启用指纹时注入特征（画像 id 列表为空也不影响）', async () => {
        const library = makeLibrary(
            [
                makeFp('fp_on', 'project', true, { sentenceRhythm: '短促有力' }),
                makeFp('fp_off', 'project', false, { sentenceRhythm: '绵长缠绕' }),
            ],
            [],
        );
        const text = await makeInjector(library).injectForBodyGeneration(makeProfile(), CTX);

        expect(text).toContain('【写作指纹风格参考】');
        expect(text).toContain('短促有力');
        expect(text).not.toContain('绵长缠绕');
        expect(text).toContain('参考 1 个启用的写作指纹');
    });

    it('强度 0 的指纹即使 enabled 也不注入（与协同口径一致）', async () => {
        const library = makeLibrary(
            [makeFp('fp_zero', 'project', true, { sentenceRhythm: '短促有力' })],
            [],
            { fp_zero: { globalIntensity: 0 } },
        );
        const text = await makeInjector(library).injectForBodyGeneration(makeProfile(), CTX);

        expect(text).not.toContain('【写作指纹风格参考】');
        expect(text).not.toContain('短促有力');
    });

    it('画像里的陈旧 id 不再生效：库中已禁用则不注入', async () => {
        const library = makeLibrary(
            [makeFp('fp_off', 'project', false, { sentenceRhythm: '绵长缠绕' })],
            [],
        );
        const text = await makeInjector(library)
            .injectForBodyGeneration(makeProfile(['fp_off'], []), CTX);

        expect(text).not.toContain('【写作指纹风格参考】');
    });

    it('默认 injectionStrength 0.5 也注入指纹（不受风格描述详略门控）', async () => {
        const library = makeLibrary(
            [makeFp('fp_on', 'project', true, { sentenceRhythm: '短促有力' })],
            [],
        );
        const text = await makeInjector(library)
            .injectForBodyGeneration(makeProfile([], [], 0.5), CTX);

        expect(text).toContain('【写作指纹风格参考】');
        expect(text).toContain('短促有力');
    });

    it('全局指纹按项目启用状态参与，未启用的跳过', async () => {
        const library = makeLibrary(
            [],
            [
                makeFp('fp_global_on', 'global', true, { wordPreference: '书面化用词' }),
                makeFp('fp_global_off', 'global', false, { rhetoric: '大量排比' }),
            ],
        );
        const text = await makeInjector(library).injectForBodyGeneration(makeProfile(), CTX);

        expect(text).toContain('【写作指纹风格参考】');
        expect(text).toContain('书面化用词');
        expect(text).not.toContain('大量排比');
    });

    // B4：11 步与协同共用上限 3，检索不可用时回退前 3 而不是全量
    it('启用 5 个指纹时最多注入前 3 个', async () => {
        const library = makeLibrary(
            [
                makeFp('fp1', 'project', true, { sentenceRhythm: '一号节奏' }),
                makeFp('fp2', 'project', true, { wordPreference: '二号用词' }),
                makeFp('fp3', 'project', true, { narrativeStyle: '三号叙事' }),
                makeFp('fp4', 'project', true, { rhetoric: '四号修辞' }),
                makeFp('fp5', 'project', true, { overallTone: '五号基调' }),
            ],
            [],
        );
        const text = await makeInjector(library).injectForBodyGeneration(makeProfile(), CTX);

        expect(text).toContain('参考 3 个启用的写作指纹');
        expect(text).toContain('一号节奏');
        expect(text).toContain('二号用词');
        expect(text).toContain('三号叙事');
        expect(text).not.toContain('四号修辞');
        expect(text).not.toContain('五号基调');
    });

    it('多指纹合并后单字段超过 200 字会截断并注明合并数', async () => {
        const longA = '甲'.repeat(150);
        const longB = '乙'.repeat(150);
        const longC = '丙'.repeat(150);
        const library = makeLibrary(
            [
                makeFp('fp1', 'project', true, { sentenceRhythm: longA }),
                makeFp('fp2', 'project', true, { sentenceRhythm: longB }),
                makeFp('fp3', 'project', true, { sentenceRhythm: longC }),
            ],
            [],
        );
        const text = await makeInjector(library).injectForBodyGeneration(makeProfile(), CTX);

        expect(text).toContain('…（已合并 3 个指纹）');
        expect(text).not.toContain('甲'.repeat(151));
    });
});

describe('KnowledgeInjector — V2 独有 5 维进入 11 步正文（ADR R3）', () => {
    it('7 段 V1 投影之后追加「V2 深化特征（量化）：」', async () => {
        const library = makeLibrary(
            [makeFp('fp_on', 'project', true, { sentenceRhythm: '短促有力' })],
            [],
            {},
            { fp_on: makeV2({ sentencePattern: V2_SENTENCE_PATTERN }) },
        );
        const text = await makeInjector(library).injectForBodyGeneration(makeProfile(), CTX);

        expect(text).toContain('- 句式节奏：短促有力');
        expect(text).toContain('V2 深化特征（量化）：');
        expect(text).toContain('- 句式：');
        expect(text).toContain('倒装 2.4/千字');
        expect(text).toContain('短句倒装多，少用长从句');
        // 顺序：V1 七维在前，V2 段在后（ADR R3「7 段之后追加」）
        expect(text.indexOf('- 句式节奏：')).toBeLessThan(text.indexOf('V2 深化特征（量化）：'));
    });

    it('status 不是 complete 的维度不注入（避免半成品进 prompt）', async () => {
        const library = makeLibrary(
            [makeFp('fp_on', 'project', true, { sentenceRhythm: '短促有力' })],
            [],
            {},
            {
                fp_on: makeV2({
                    sentencePattern: V2_SENTENCE_PATTERN,
                    emotion: {
                        emotionalTone: '压抑',
                        emotionalFluctuationFrequency: 0.5,
                        emotionalIntensityDistribution: { low: 0.5, medium: 0.3, high: 0.2 },
                        valenceRatio: { positive: 0.4, negative: 0.6 },
                        description: '',
                        samples: [],
                        status: 'pending',
                    },
                }),
            },
        );
        const text = await makeInjector(library).injectForBodyGeneration(makeProfile([], [], 0.8), CTX);

        expect(text).toContain('- 句式：');
        expect(text).not.toContain('- 情绪：');
        expect(text).not.toContain('压抑');
    });

    it('库没有 V2 特征时不出现 V2 段（V1 注入保持不变）', async () => {
        const library = makeLibrary([makeFp('fp_on', 'project', true, { sentenceRhythm: '短促有力' })], []);
        const text = await makeInjector(library).injectForBodyGeneration(makeProfile(), CTX);

        expect(text).toContain('【写作指纹风格参考】');
        expect(text).not.toContain('V2 深化特征');
    });

    it('强度 0（完全禁用）的指纹连 V2 段一起消失', async () => {
        const library = makeLibrary(
            [makeFp('fp_zero', 'project', true, { sentenceRhythm: '短促有力' })],
            [],
            { fp_zero: { globalIntensity: 0 } },
            { fp_zero: makeV2({ sentencePattern: V2_SENTENCE_PATTERN }) },
        );
        const text = await makeInjector(library).injectForBodyGeneration(makeProfile(), CTX);

        expect(text).not.toContain('【写作指纹风格参考】');
        expect(text).not.toContain('V2 深化特征');
    });

    it('画像强度 < 0.3 时只留定量摘要，不注入维度描述', async () => {
        const library = makeLibrary(
            [makeFp('fp_on', 'project', true, { sentenceRhythm: '短促有力' })],
            [],
            {},
            { fp_on: makeV2({ sentencePattern: V2_SENTENCE_PATTERN }) },
        );
        const text = await makeInjector(library).injectForBodyGeneration(makeProfile([], [], 0.2), CTX);

        expect(text).toContain('倒装 2.4/千字');
        expect(text).not.toContain('短句倒装多，少用长从句');
    });
});
