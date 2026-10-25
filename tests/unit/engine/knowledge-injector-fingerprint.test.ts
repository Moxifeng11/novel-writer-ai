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
): StyleFingerprintLibrary {
    return {
        loadIntensityConfigs: async () => configs,
        listProject: () => project,
        listGlobal: () => global,
        isGlobalEnabledForProject: (fpId: string) => !!global.find(fp => fp.id === fpId && fp.enabled),
        getIntensityConfig: (fpId: string) => configs[fpId] ?? DEFAULT_INTENSITY_CONFIG,
    } as unknown as StyleFingerprintLibrary;
}

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
