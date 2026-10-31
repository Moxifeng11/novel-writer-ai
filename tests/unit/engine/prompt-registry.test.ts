import { describe, expect, it } from 'vitest';
import {
    listPromptVariants,
    promptVariantOf,
    renderMetaOf,
    resolveBodyVariant,
    voiceVariantMeta,
} from '../../../engine/prompts/prompt-registry';
import { HUMAN_VOICE_BLOCK, HUMAN_VOICE_WEAK_RULES } from '../../../engine/prompts/human-voice';
import { hashContent } from '../../../shared/versioned-registry';

describe('prompt-registry — 提示词模板版本元数据', () => {
    describe('变体登记', () => {
        it('正文有 V1/V2 两套，id 与版本可区分', () => {
            const v1 = promptVariantOf('bodyGeneration');
            const v2 = promptVariantOf('bodyGenerationV2');
            expect(v1?.id).toBe('bodyGeneration.v1');
            expect(v2?.id).toBe('bodyGeneration.v2');
            expect(v1?.version).not.toBe(v2?.version);
            expect(v1?.hash).not.toBe(v2?.hash);
        });

        it('实验变体 V3/V4 已登记且可被强制选中', () => {
            const v3 = promptVariantOf('bodyGenerationV3');
            const v4 = promptVariantOf('bodyGenerationV4');
            expect(v3?.id).toBe('bodyGeneration.v3');
            expect(v4?.id).toBe('bodyGeneration.v4');
            expect(resolveBodyVariant({}, 'v3').id).toBe('bodyGeneration.v3');
            expect(resolveBodyVariant({}, 'v4').id).toBe('bodyGeneration.v4');
            expect(renderMetaOf('bodyGeneration', { forceBodyVariant: 'v3', voiceMode: 'exemplar' })?.compositeId)
                .toBe('bodyGeneration.v3@3.0.0+voice.exemplar@5.0.0');
        });

        it('vars._bodyVariant 优先于灵魂层自动判断', () => {
            expect(resolveBodyVariant({ _bodyVariant: 'v4', characterSoulReady: '1' }).id).toBe('bodyGeneration.v4');
            expect(resolveBodyVariant({ _bodyVariant: '' , characterSoulReady: '1' }).id).toBe('bodyGeneration.v2');
        });

        it('未登记的步骤返回 null（调用方按无版本处理）', () => {
            expect(promptVariantOf('notARealStep')).toBeNull();
        });

        it('元数据不带出模板正文（避免误把 prompt 塞进账本）', () => {
            const meta = promptVariantOf('bodyGenerationV2') as unknown as Record<string, unknown>;
            expect(meta.system).toBeUndefined();
            expect(meta.user).toBeUndefined();
        });

        it('listPromptVariants 覆盖全部步骤 + 两个人味版本', () => {
            const ids = listPromptVariants().map((variant) => variant.id);
            expect(ids).toEqual(expect.arrayContaining([
                'bodyGeneration.v1',
                'bodyGeneration.v2',
                'voice.exemplar',
                'voice.quota',
            ]));
            expect(new Set(ids).size).toBe(ids.length);
        });
    });

    describe('人味块版本', () => {
        it('quota / exemplar 各自对应一份正文哈希', () => {
            const quota = voiceVariantMeta('quota');
            const exemplar = voiceVariantMeta('exemplar');
            expect(quota.id).toBe('voice.quota');
            expect(exemplar.id).toBe('voice.exemplar');
            expect(quota.hash).toBe(hashContent(HUMAN_VOICE_BLOCK));
            expect(exemplar.hash).toBe(hashContent(HUMAN_VOICE_WEAK_RULES));
            expect(quota.hash).not.toBe(exemplar.hash);
        });
    });

    describe('正文变体路由', () => {
        it('有灵魂层数据走 V2', () => {
            expect(resolveBodyVariant({ characterSoulReady: '1' }).id).toBe('bodyGeneration.v2');
            expect(resolveBodyVariant({ protagonistSoulDetail: '他怕黑' }).id).toBe('bodyGeneration.v2');
        });

        it('没有灵魂层数据回退 V1', () => {
            expect(resolveBodyVariant({}).id).toBe('bodyGeneration.v1');
            expect(resolveBodyVariant(undefined).id).toBe('bodyGeneration.v1');
            expect(resolveBodyVariant({ protagonistSoulDetail: '   ' }).id).toBe('bodyGeneration.v1');
        });

        it('实验可强制指定变体（覆盖灵魂层判断）', () => {
            expect(resolveBodyVariant({ characterSoulReady: '1' }, 'v1').id).toBe('bodyGeneration.v1');
            expect(resolveBodyVariant({}, 'v2').id).toBe('bodyGeneration.v2');
        });
    });

    describe('renderMetaOf 组合归因', () => {
        it('正文的组合 id = 模板版本 + 人味版本', () => {
            const meta = renderMetaOf('bodyGeneration', {
                vars: { characterSoulReady: '1' },
                voiceMode: 'exemplar',
            });
            expect(meta?.stepKey).toBe('bodyGeneration');
            expect(meta?.voiceVersion).toBe('voice.exemplar@5.0.0');
            expect(meta?.compositeId).toBe('bodyGeneration.v2@2.1.0+voice.exemplar@5.0.0');
        });

        it('不给人味模式时组合 id 只有模板部分', () => {
            const meta = renderMetaOf('outline');
            expect(meta?.compositeId).toBe('outline.v1@1.3.0');
            expect(meta?.voiceVersion).toBeUndefined();
        });

        it('未登记步骤返回 null', () => {
            expect(renderMetaOf('unknownStep')).toBeNull();
        });
    });
});
