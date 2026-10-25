/**
 * prompt-builder-fingerprint.test.ts — 指纹向量检索结果进入 prompt 的过滤与归属
 *
 * 覆盖三个缺陷：
 *   1. 已禁用指纹的向量样本仍会被注入 prompt（禁用无效）
 *   2. 检索结果丢失 fingerprintId 后，多样性规则把所有样本当成同一指纹，topN=3 退化为 2 条
 *   3. 强度设为 0（界面「完全禁用」）只让全局层描述消失，示例样本照旧注入
 */

import { describe, it, expect, vi } from 'vitest';
import { PromptBuilder } from '../../../engine/prompt-builder';
import type {
    StyleFingerprint,
    StyleFingerprintLibrary,
    VectorStore,
} from '../../../engine/style-fingerprint-library';
import {
    DEFAULT_INTENSITY_CONFIG,
    type StyleIntensityConfig,
} from '../../../engine/style/style-intensity-engine';
import { getDegradationNotifier } from '../../../shared/degradation-notifier';

function makeFingerprint(id: string): StyleFingerprint {
    return {
        id,
        name: `指纹 ${id}`,
        source: '测试源文本',
        scope: 'project',
        enabled: true,
        tags: ['test'],
        stats: {
            avgSentenceLength: 20,
            avgParagraphLength: 100,
            dialogueRatio: 0.3,
            descriptionRatio: 0.4,
            wordCount: 10000,
        },
        features: {
            sentenceRhythm: '短句为主，节奏明快',
            wordPreference: '常用词，四字格密度低',
            narrativeStyle: '第三人称全知',
            rhetoric: '比喻为主，少排比',
            dialogueStyle: '简短对白，潜台词多',
            paragraphStructure: '单段成意，少长段',
            overallTone: '冷峻克制',
        },
        samples: ['示例片段一'],
        extractedAt: Date.now(),
    };
}

function makeLibrary(
    enabled: StyleFingerprint[],
    configs: Record<string, StyleIntensityConfig> = {},
): StyleFingerprintLibrary {
    return {
        getEnabledFingerprints: async () => enabled,
        loadIntensityConfigs: async () => configs,
        getIntensityConfig: (fpId: string) => configs[fpId] ?? DEFAULT_INTENSITY_CONFIG,
    } as unknown as StyleFingerprintLibrary;
}

function makeBuilder(
    enabled: StyleFingerprint[],
    results: Array<{ sample: string; score: number; fingerprintId?: string }>,
    configs: Record<string, StyleIntensityConfig> = {},
): PromptBuilder {
    const vectorStore: VectorStore = {
        add: async () => undefined,
        delete: async () => undefined,
        search: async () => results,
    };
    return new PromptBuilder(() => null, null, null, makeLibrary(enabled, configs), vectorStore);
}

async function buildText(
    results: Array<{ sample: string; score: number; fingerprintId?: string }>,
    enabled: StyleFingerprint[] = [makeFingerprint('fp_on')],
    configs: Record<string, StyleIntensityConfig> = {},
): Promise<string> {
    const builder = makeBuilder(enabled, results, configs);
    const parts = await builder.getFingerprintPromptParts('他推开门，屋里没有人。');
    return parts.join('\n');
}

describe('PromptBuilder 指纹样本注入', () => {
    it('已禁用指纹的检索样本不会进入 prompt', async () => {
        const text = await buildText([
            { sample: '禁用指纹样本甲禁用指纹样本甲', score: 0.99, fingerprintId: 'fp_off' },
            { sample: '启用指纹样本乙启用指纹样本乙', score: 0.9, fingerprintId: 'fp_on' },
        ]);

        expect(text).not.toContain('禁用指纹样本甲');
        expect(text).toContain('启用指纹样本乙');
    });

    it('检索结果缺失 fingerprintId 时不被过滤，且可返回 3 条样本', async () => {
        const text = await buildText([
            { sample: '无来源样本甲无来源样本甲', score: 0.95 },
            { sample: '无来源样本乙无来源样本乙', score: 0.9 },
            { sample: '无来源样本丙无来源样本丙', score: 0.85 },
        ]);

        expect(text).toContain('无来源样本甲');
        expect(text).toContain('无来源样本乙');
        expect(text).toContain('无来源样本丙');
    });

    it('同一启用指纹的样本仍受 2 条多样性上限约束', async () => {
        const text = await buildText([
            { sample: '同一指纹样本甲同一指纹样本甲', score: 0.95, fingerprintId: 'fp_on' },
            { sample: '同一指纹样本乙同一指纹样本乙', score: 0.9, fingerprintId: 'fp_on' },
            { sample: '同一指纹样本丙同一指纹样本丙', score: 0.85, fingerprintId: 'fp_on' },
        ]);

        expect(text).toContain('同一指纹样本甲');
        expect(text).toContain('同一指纹样本乙');
        expect(text).not.toContain('同一指纹样本丙');
    });

    it('强度设为 0 的指纹即使 enabled 也不注入示例样本', async () => {
        const text = await buildText(
            [
                { sample: '强度归零指纹样本强度归零指纹样本', score: 0.99, fingerprintId: 'fp_zero' },
                { sample: '正常强度指纹样本正常强度指纹样本', score: 0.9, fingerprintId: 'fp_on' },
            ],
            [makeFingerprint('fp_zero'), makeFingerprint('fp_on')],
            { fp_zero: { globalIntensity: 0 }, fp_on: DEFAULT_INTENSITY_CONFIG },
        );

        expect(text).not.toContain('强度归零指纹样本');
        expect(text).toContain('正常强度指纹样本');
    });

    it('强度大于 0 时示例样本照常注入（不过度过滤）', async () => {
        const text = await buildText(
            [{ sample: '低强度指纹样本低强度指纹样本', score: 0.95, fingerprintId: 'fp_low' }],
            [makeFingerprint('fp_low')],
            { fp_low: { globalIntensity: 0.5 } },
        );

        expect(text).toContain('低强度指纹样本');
    });
});

describe('PromptBuilder 指纹相关性筛选（V2 12 维检索）', () => {
    function makeToneFingerprint(id: string, tone: string): StyleFingerprint {
        const fp = makeFingerprint(id);
        return { ...fp, features: { ...fp.features, overallTone: tone } };
    }

    function makeBuilderV2(
        enabled: StyleFingerprint[],
        rankedIds: string[] | 'throw',
    ) {
        const searchV2 = vi.fn(async (_query: string, _opts?: { topN?: number; fingerprintIds?: string[] }) => {
            if (rankedIds === 'throw') throw new Error('embed boom');
            return rankedIds.map((id, i) => ({
                fingerprintId: id,
                fingerprintName: id,
                overallScore: 0.9 - i * 0.1,
                dimensionScores: {},
                scope: 'project' as const,
            }));
        });
        const library = {
            getEnabledFingerprints: async () => enabled,
            loadIntensityConfigs: async () => ({}),
            getIntensityConfig: () => DEFAULT_INTENSITY_CONFIG,
            searchSimilarStylesV2: searchV2,
        } as unknown as StyleFingerprintLibrary;
        const vectorStore: VectorStore = {
            add: async () => undefined,
            delete: async () => undefined,
            search: async () => [],
        };
        return {
            builder: new PromptBuilder(() => null, null, null, library, vectorStore),
            searchV2,
        };
    }

    const FIVE = [
        makeToneFingerprint('fp1', '冷峻甲'),
        makeToneFingerprint('fp2', '冷峻乙'),
        makeToneFingerprint('fp3', '冷峻丙'),
        makeToneFingerprint('fp4', '冷峻丁'),
        makeToneFingerprint('fp5', '冷峻戊'),
    ];

    it('启用指纹超过 3 个时只注入与当前正文最相似的 3 个', async () => {
        const { builder, searchV2 } = makeBuilderV2(FIVE, ['fp3', 'fp1', 'fp5']);
        const text = (await builder.getFingerprintPromptParts('他推开门。')).join('\n');

        expect(searchV2).toHaveBeenCalledTimes(1);
        // 排名范围必须限定在启用指纹内：禁用/模板指纹不得先占满 topN 再把筛选结果挤成空
        expect(searchV2.mock.calls[0][1]).toMatchObject({
            topN: 3,
            fingerprintIds: ['fp1', 'fp2', 'fp3', 'fp4', 'fp5'],
        });
        expect(text).toContain('冷峻甲');
        expect(text).toContain('冷峻丙');
        expect(text).toContain('冷峻戊');
        expect(text).not.toContain('冷峻乙');
        expect(text).not.toContain('冷峻丁');
    });

    it('启用指纹不超过 3 个时不发起 V2 检索（保持全量注入）', async () => {
        const { builder, searchV2 } = makeBuilderV2(FIVE.slice(0, 3), ['fp1']);
        const text = (await builder.getFingerprintPromptParts('他推开门。')).join('\n');

        expect(searchV2).not.toHaveBeenCalled();
        expect(text).toContain('冷峻甲');
        expect(text).toContain('冷峻乙');
        expect(text).toContain('冷峻丙');
    });

    it('V2 检索无结果时回退全量注入，风格约束不能因检索失败丢失', async () => {
        const { builder } = makeBuilderV2(FIVE, []);
        const text = (await builder.getFingerprintPromptParts('他推开门。')).join('\n');

        expect(text).toContain('冷峻甲');
        expect(text).toContain('冷峻乙');
        expect(text).toContain('冷峻丙');
        expect(text).toContain('冷峻丁');
        expect(text).toContain('冷峻戊');
    });

    it('V2 检索抛错时回退全量注入', async () => {
        const { builder } = makeBuilderV2(FIVE, 'throw');
        const text = (await builder.getFingerprintPromptParts('他推开门。')).join('\n');

        expect(text).toContain('冷峻甲');
        expect(text).toContain('冷峻戊');
    });

    // B5：回退全量必须可见，否则「上限 3」静默失效，用户无法察觉
    it('V2 检索无结果时发一次 vector/style 降级事件', async () => {
        getDegradationNotifier().clear();
        const { builder } = makeBuilderV2(FIVE, []);
        await builder.getFingerprintPromptParts('他推开门。');

        const events = getDegradationNotifier().getEvents()
            .filter(e => e.source === 'vector' && e.dimension === 'style');
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
            from: 'v2_ranking',
            to: 'inject_all_enabled',
            severity: 'warning',
            recoverable: true,
        });
        expect(events[0].reason).toContain('V2 检索无结果');
    });

    it('同一实例重复回退只上报一次，避免逐章刷屏', async () => {
        getDegradationNotifier().clear();
        const { builder } = makeBuilderV2(FIVE, 'throw');
        await builder.getFingerprintPromptParts('他推开门。');
        await builder.getFingerprintPromptParts('他关上门。');

        const events = getDegradationNotifier().getEvents()
            .filter(e => e.source === 'vector' && e.dimension === 'style');
        expect(events).toHaveLength(1);
        expect(events[0].reason).toContain('V2 检索异常');
    });

    it('V2 检索成功时不发降级事件', async () => {
        getDegradationNotifier().clear();
        const { builder } = makeBuilderV2(FIVE, ['fp1', 'fp2', 'fp3']);
        await builder.getFingerprintPromptParts('他推开门。');

        expect(getDegradationNotifier().getEvents().filter(e => e.dimension === 'style')).toEqual([]);
    });
});
