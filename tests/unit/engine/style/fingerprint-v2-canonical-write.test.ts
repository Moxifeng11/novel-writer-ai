/**
 * fingerprint-v2-canonical-write.test.ts — 「磁盘只写 V2」规范模型契约
 *
 * 背景：2026-11-21 决策（docs/design/2026-11-21-style-fingerprint-v2-canonical.md）
 * 把 V2 定为规范模型、V1 七维降为提示词投影。此前 `toPersistedFingerprint`
 * 在没有 V2 缓存时直接回写 V1，于是「新建指纹 → 磁盘是 V1 → 下次加载才迁移 →
 * 5 个 V2 维度永远 pending」。本测试锁定新的写入契约：
 *
 * 1. 通过 V1 入口（addGlobal/addProject/addTemplate）新增的指纹，落盘必须是 V2；
 * 2. 迁移补齐的 7 维 description 原样来自 V1 文案，5 个新增维度为 pending；
 * 3. 再次保存（启用/停用）不会把结构降级，也不会丢 v1Backup。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Vault } from 'obsidian';
import { StyleFingerprintLibrary, type StyleFingerprint } from '../../../../engine/style-fingerprint-library';
import type { EmbeddingProvider, EmbeddingAvailability, ProviderInfo } from '../../../../engine/embedding/embedding-provider';
import { STYLE_DIMENSION_KEYS_V2 } from '../../../../engine/style/style-dimensions-v2';
import { globalFingerprintsFile } from '../../../../shared/paths';

class MockEmbeddingProvider implements EmbeddingProvider {
    async embed(text: string): Promise<number[]> {
        if (!text) return [];
        return [text.length, 1, 0, 0, 0, 0, 0, 0];
    }
    async embedBatch(texts: string[]): Promise<number[][]> {
        return Promise.all(texts.map(t => this.embed(t)));
    }
    async isAvailable(): Promise<EmbeddingAvailability> {
        return { available: true, model: 'mock-embed', dimensions: 8 };
    }
    getProviderInfo(): ProviderInfo {
        return { type: 'mock', name: 'mock', model: 'mock-embed' };
    }
    getModelName(): string { return 'mock-embed'; }
    async getDimensions(): Promise<number> { return 8; }
}

/** 只带 V1 七维字符串的旧格式指纹（AI 抽取入口的产物形态） */
function makeV1Fingerprint(id: string): StyleFingerprint {
    return {
        id,
        name: '旧格式指纹',
        source: 'AI 抽取',
        scope: 'global',
        enabled: true,
        tags: ['旧'],
        stats: {
            avgSentenceLength: 13.5,
            avgParagraphLength: 42,
            dialogueRatio: 0.31,
            descriptionRatio: 0.22,
            wordCount: 12000,
        },
        features: {
            sentenceRhythm: '节奏偏快，短句密集',
            wordPreference: '偏口语，动词多',
            narrativeStyle: '第三人称限知',
            rhetoric: '少用比喻',
            dialogueStyle: '对话推进剧情',
            paragraphStructure: '短段落',
            overallTone: '冷峻',
        },
        samples: ['示例一段', '示例二段'],
        extractedAt: 1_700_000_000_000,
    };
}

async function readGlobalFile(vault: Vault): Promise<any[]> {
    const raw = await (vault as any).readByPath(globalFingerprintsFile());
    return JSON.parse(raw);
}

describe('StyleFingerprintLibrary — 磁盘只写 V2（规范模型契约）', () => {
    let vault: Vault;
    let library: StyleFingerprintLibrary;

    beforeEach(async () => {
        vault = new Vault();
        library = new StyleFingerprintLibrary({ vault } as any);
        library.setEmbeddingClient(new MockEmbeddingProvider());
        await library.loadGlobal();
    });

    it('V1 入口新增的指纹落盘即为 V2（7 维 complete + 5 维 pending）', async () => {
        await library.addGlobal(makeV1Fingerprint('fp-new'));

        const onDisk = await readGlobalFile(vault);
        const item = onDisk.find(fp => fp.id === 'fp-new');
        expect(item).toBeTruthy();

        expect(item.version).toBe('v2');
        expect(Object.keys(item.features)).toHaveLength(STYLE_DIMENSION_KEYS_V2.length);
        expect(item.features.rhythm.description).toBe('节奏偏快，短句密集');
        expect(item.features.wordChoice.description).toBe('偏口语，动词多');
        expect(item.features.languageTexture.description).toBe('冷峻');
        for (const key of ['rhythm', 'wordChoice', 'rhetoric', 'perspective', 'dialogue', 'narration', 'languageTexture'] as const) {
            expect(item.features[key].status).toBe('complete');
        }
        for (const key of ['sentencePattern', 'emotion', 'tension', 'infoDensity', 'description'] as const) {
            expect(item.features[key].status).toBe('pending');
        }
        // 旧 V1 文案必须留档，供加载时还原 V1 视图
        expect(item.v1Backup.features.sentenceRhythm).toBe('节奏偏快，短句密集');
        expect(item.samples).toEqual(['示例一段', '示例二段']);
    });

    it('再次保存（启用/停用）仍保持 V2 且不丢样本与备份', async () => {
        await library.addGlobal(makeV1Fingerprint('fp-keep'));
        await library.disableGlobal('fp-keep');

        const onDisk = await readGlobalFile(vault);
        const item = onDisk.find(fp => fp.id === 'fp-keep');
        expect(item.version).toBe('v2');
        expect(item.enabled).toBe(false);
        expect(item.features.rhythm.description).toBe('节奏偏快，短句密集');
        expect(item.features.emotion.status).toBe('pending');
        expect(item.v1Backup.features.sentenceRhythm).toBe('节奏偏快，短句密集');
        expect(Object.keys(item.features)).toHaveLength(STYLE_DIMENSION_KEYS_V2.length);
    });

    it('文件里每个条目都必须是 V2（不允许 V1 与 V2 混写）', async () => {
        await library.addGlobal(makeV1Fingerprint('fp-a'));
        await library.addGlobal(makeV1Fingerprint('fp-b'));

        const onDisk = await readGlobalFile(vault);
        expect(onDisk).toHaveLength(2);
        expect(onDisk.every(fp => fp.version === 'v2')).toBe(true);
    });
});
