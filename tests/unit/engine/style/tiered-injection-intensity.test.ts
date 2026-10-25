import { describe, it, expect } from 'vitest';
import {
    ContextAnalyzer,
    TieredInjectionBuilder,
} from '../../../../engine/style/dynamic-injection-engine';
import type { StyleIntensityConfig } from '../../../../engine/style/style-intensity-engine';
import type { StyleFingerprint } from '../../../../engine/style-fingerprint-library';

function makeFingerprint(): StyleFingerprint {
    return {
        id: 'fp-1',
        name: '测试指纹',
        source: 'test',
        scope: 'global',
        enabled: true,
        tags: [],
        stats: {
            avgSentenceLength: 12,
            avgParagraphLength: 40,
            dialogueRatio: 0.3,
            descriptionRatio: 0.2,
            wordCount: 10000,
        },
        features: {
            sentenceRhythm: '节'.repeat(150),
            wordPreference: '词'.repeat(150),
            narrativeStyle: '视'.repeat(150),
            rhetoric: '修'.repeat(150),
            dialogueStyle: '话'.repeat(150),
            paragraphStructure: '段'.repeat(150),
            overallTone: '调'.repeat(150),
        },
        samples: [],
        extractedAt: Date.now(),
    } as StyleFingerprint;
}

function samples(count: number) {
    return Array.from({ length: count }, (_, i) => ({
        sample: `示例片段${i + 1}`,
        score: 0.9,
        reason: 'context-match',
    }));
}

const context = new ContextAnalyzer().analyze('他推开门，走了出去。');

describe('TieredInjectionBuilder — 指纹强度真正生效（Phase 4.1）', () => {
    const builder = new TieredInjectionBuilder();

    it('未传强度配置时保持旧行为（描述不截断、示例不裁剪）', () => {
        const parts = builder.build([makeFingerprint()], samples(3), context);
        const text = parts.join('\n');
        expect(text).toContain('节'.repeat(150));
        expect(text).toContain('3. 示例片段3');
    });

    it('强度为 0 时完全禁用指纹注入', () => {
        const configs = new Map<string, StyleIntensityConfig>([['fp-1', { globalIntensity: 0 }]]);
        const parts = builder.build([makeFingerprint()], samples(3), context, configs);
        const text = parts.join('\n');
        expect(text).not.toContain('【写作风格指纹】');
        expect(text).not.toContain('参考片段');
        expect(text).not.toContain('节'.repeat(10));
    });

    it('强度 0.5 时描述截断到 100 字、示例保留 2 条', () => {
        const configs = new Map<string, StyleIntensityConfig>([['fp-1', { globalIntensity: 0.5 }]]);
        const parts = builder.build([makeFingerprint()], samples(3), context, configs);
        const text = parts.join('\n');
        expect(text).toContain('节'.repeat(100));
        expect(text).not.toContain('节'.repeat(101));
        expect(text).toContain('2. 示例片段2');
        expect(text).not.toContain('3. 示例片段3');
    });

    it('强度 0.1 时只保留 1 条示例、描述截断到 20 字', () => {
        const configs = new Map<string, StyleIntensityConfig>([['fp-1', { globalIntensity: 0.1 }]]);
        const parts = builder.build([makeFingerprint()], samples(3), context, configs);
        const text = parts.join('\n');
        expect(text).toContain('节'.repeat(20));
        expect(text).toContain('1. 示例片段1');
        expect(text).not.toContain('2. 示例片段2');
    });
});
