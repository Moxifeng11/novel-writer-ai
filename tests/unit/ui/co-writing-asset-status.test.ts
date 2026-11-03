import { describe, expect, it } from 'vitest';
import {
    calculateFingerprintCompleteness,
    calculateKnowledgeBaseCompleteness,
    getCompletenessIcon,
} from '@/ui/co-writing/asset-status';
import type { KnowledgeBaseManager } from '@/services/knowledge-base-manager';
import type { StyleFingerprintLibrary, StyleFingerprint } from '@/engine/style-fingerprint-library';

describe('calculateKnowledgeBaseCompleteness', () => {
    it('未初始化返回空状态', async () => {
        await expect(calculateKnowledgeBaseCompleteness(null)).resolves.toEqual({
            completed: 0, total: 0, completeness: 0,
        });
    });

    it('按 breakdownStatus 统计完成度', async () => {
        const manager = {
            getAllBooks: async () => [
                { breakdownStatus: 'completed' },
                { breakdownStatus: 'completed' },
                { breakdownStatus: 'pending' },
                { breakdownStatus: 'failed' },
            ],
        } as unknown as KnowledgeBaseManager;
        await expect(calculateKnowledgeBaseCompleteness(manager)).resolves.toEqual({
            completed: 2, total: 4, completeness: 50,
        });
    });
});

function fingerprint(overrides: Partial<StyleFingerprint>): StyleFingerprint {
    const features = {
        sentenceRhythm: '短句', wordPreference: '口语', narrativeStyle: '限知',
        rhetoric: '白描', dialogueStyle: '克制', paragraphStructure: '错落', overallTone: '冷',
    };
    return {
        id: 'fp', name: '测试', enabled: true, features,
        samples: Array.from({ length: 15 }, (_, i) => `样本${i}`),
        sourceText: '原文',
        ...overrides,
    } as StyleFingerprint;
}

describe('calculateFingerprintCompleteness', () => {
    it('未初始化返回空状态', async () => {
        await expect(calculateFingerprintCompleteness(null)).resolves.toEqual({
            completed: 0, total: 0, completeness: 0,
        });
    });

    it('特征/样本/原文齐全才计完成', async () => {
        const library = {
            loadGlobal: async () => undefined,
            loadProject: async () => undefined,
            listProject: () => [fingerprint({ id: 'a' })],
            listGlobal: () => [fingerprint({ id: 'b', samples: [] })],
        } as unknown as StyleFingerprintLibrary;
        await expect(calculateFingerprintCompleteness(library)).resolves.toEqual({
            completed: 1, total: 2, completeness: 50,
        });
    });
});

describe('getCompletenessIcon', () => {
    it('按 100/60 两档切换图标', () => {
        expect(getCompletenessIcon(100).icon).toBe('✓');
        expect(getCompletenessIcon(60).icon).toBe('⚠');
        expect(getCompletenessIcon(59).icon).toBe('✗');
    });
});
