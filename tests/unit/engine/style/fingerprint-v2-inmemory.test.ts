/**
 * fingerprint-v2-inmemory.test.ts — 「内存以 V2 为准、V1 只是投影」契约
 *
 * 背景：ADR docs/design/2026-11-21-style-fingerprint-v2-canonical.md §6 后续项。
 * 旧实现加载时把磁盘 V2 统一降级成 V1 StyleFingerprint 放进三张内存表，
 * 只有 v2Fingerprints 另存一份 12 维；任何走 V1 入口的更新（改名/启停/编辑文案）
 * 都可能让投影与 V2 分叉。本测试锁定新契约：
 *
 * 1. 加载后 V1 表是 V2 的投影（12 维仍在 V2 缓存里）；
 * 2. update/enable/disable 只改投影字段，不丢 5 个新增维度；
 * 3. copy / syncFromTemplate 也不把 12 维降级成 pending。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Vault } from 'obsidian';
import { StyleFingerprintLibrary, type StyleFingerprint } from '../../../../engine/style-fingerprint-library';
import type { EmbeddingProvider, EmbeddingAvailability, ProviderInfo } from '../../../../engine/embedding/embedding-provider';
import { StyleFeaturesAnalyzerV2, type StyleAnalysisResultV2 } from '../../../../engine/style/style-features-v2';
import { V2_NEW_DIMENSIONS } from '../../../../engine/style/style-dimensions-v2';

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

const SAMPLE_TEXT = [
    '雨下了一整夜。青石巷里没有人，只有檐角的水一滴一滴砸在铜盆上。',
    '他推开门，冷风灌进来，烛火猛地一跳。',
    '“你终于来了。”老者的声音很轻，却像钉子一样钉进他耳朵里。',
    '他没有回答，只是把湿透的斗篷挂在门后，走到桌边坐下。',
    '桌上摊着一张旧地图，边角已经磨破，几条红线交错着指向城外的荒山。',
    '“东西呢？”老者问。',
    '他从怀里摸出一枚铜钱，放在地图正中。铜钱上的字被磨得几乎看不清，只剩一道浅浅的轮廓。',
    '窗外的雨忽然停了。远处传来一声闷响，像有什么东西在地底翻身。',
].join('\n\n');

function makeV1Fingerprint(id: string, name: string, extractedAt = 1_700_000_000_000): StyleFingerprint {
    return {
        id,
        name,
        source: '样章',
        scope: 'template',
        enabled: true,
        tags: ['模板'],
        stats: {
            avgSentenceLength: 15,
            avgParagraphLength: 50,
            dialogueRatio: 0.2,
            descriptionRatio: 0.4,
            wordCount: 3000,
        },
        features: {
            sentenceRhythm: '模板文案：短句密集',
            wordPreference: '模板文案：书面语',
            narrativeStyle: '模板文案：第三人称限知',
            rhetoric: '模板文案：环境烘托',
            dialogueStyle: '模板文案：对白克制',
            paragraphStructure: '模板文案：短段',
            overallTone: '模板文案：冷',
        },
        samples: ['模板样章'],
        extractedAt,
    };
}

function pendingCount(features: Record<string, { status?: string }>): number {
    return V2_NEW_DIMENSIONS.filter(key => features[key]?.status !== 'complete').length;
}

describe('StyleFingerprintLibrary — 内存以 V2 为准（V1 仅投影）', () => {
    let vault: Vault;
    let library: StyleFingerprintLibrary;
    let analysis: StyleAnalysisResultV2;

    beforeEach(async () => {
        vault = new Vault();
        library = new StyleFingerprintLibrary({ vault } as any);
        library.setEmbeddingClient(new MockEmbeddingProvider());
        await library.loadGlobal();
        analysis = await new StyleFeaturesAnalyzerV2().analyze(SAMPLE_TEXT);
    });

    it('加载后 V1 表是 V2 投影，12 维仍完整留在 V2 缓存', async () => {
        const fp = await library.addV2Fingerprint({
            scope: 'global',
            name: '规范条目',
            source: '本地分析',
            analysis,
        });

        await library.loadGlobal();

        const projected = library.getGlobal(fp.id);
        expect(projected).toBeTruthy();
        expect(projected!.features.sentenceRhythm).toBeTruthy();
        const v2 = library.getV2Fingerprint(fp.id);
        expect(v2).toBeTruthy();
        expect(pendingCount(v2!.features as unknown as Record<string, { status?: string }>)).toBe(0);
    });

    it('updateGlobal 改名与 7 维文案后，5 个新增维度不丢且落盘仍为 V2', async () => {
        const fp = await library.addV2Fingerprint({
            scope: 'global',
            name: '原名',
            source: '本地分析',
            analysis,
        });

        const updated = { ...library.getGlobal(fp.id)!, name: '新名字' };
        updated.features = { ...updated.features, sentenceRhythm: '人工改写的节奏文案' };
        await library.updateGlobal(updated);

        const projected = library.getGlobal(fp.id)!;
        expect(projected.name).toBe('新名字');
        expect(projected.features.sentenceRhythm).toBe('人工改写的节奏文案');
        const v2 = library.getV2Fingerprint(fp.id)!;
        expect(pendingCount(v2.features as unknown as Record<string, { status?: string }>)).toBe(0);
        expect(v2.features.rhythm.description).toBe('人工改写的节奏文案');
        expect(v2.name).toBe('新名字');
    });

    it('enable/disable 只动 enabled，不重建 V2 维度', async () => {
        const fp = await library.addV2Fingerprint({
            scope: 'global',
            name: '启停条目',
            source: '本地分析',
            analysis,
        });
        const before = library.getV2Fingerprint(fp.id)!.features.emotion;

        await library.disableGlobal(fp.id);
        await library.enableGlobal(fp.id);

        const v2 = library.getV2Fingerprint(fp.id)!;
        expect(v2.enabled).toBe(true);
        expect(v2.features.emotion).toEqual(before);
        expect(pendingCount(v2.features as unknown as Record<string, { status?: string }>)).toBe(0);
    });

    it('copyFingerprint 到项目层保留 12 维完整（不降级为 pending）', async () => {
        const fp = await library.addV2Fingerprint({
            scope: 'global',
            name: '待复制',
            source: '本地分析',
            analysis,
        });
        library.setProject('demo-project');
        await library.loadProject();

        const copied = await library.copyFingerprint('global', 'project', fp.id);
        expect(copied).toBeTruthy();
        const copiedV2 = library.getV2Fingerprint(copied!.id)!;
        expect(copiedV2.scope).toBe('project');
        expect(pendingCount(copiedV2.features as unknown as Record<string, { status?: string }>)).toBe(0);
        expect(copiedV2.features.emotion).toEqual(library.getV2Fingerprint(fp.id)!.features.emotion);
    });

    it('syncFromTemplate 的更新分支保留项目指纹的 12 维，只换 7 维文案', async () => {
        library.setProject('demo-project');
        await library.loadProject();
        const projFp = await library.addV2Fingerprint({
            scope: 'project',
            name: '同名指纹',
            source: '本地分析',
            analysis,
        });
        const template = makeV1Fingerprint('tpl-1', '同名指纹', Date.now() + 60_000);
        await library.addTemplate(template);

        const result = await library.syncFromTemplate();
        expect(result.updated).toContain(projFp.id);

        const v2 = library.getV2Fingerprint(projFp.id)!;
        expect(pendingCount(v2.features as unknown as Record<string, { status?: string }>)).toBe(0);
        expect(v2.features.rhythm.description).toBe('模板文案：短句密集');
        expect(library.getProject(projFp.id)!.features.sentenceRhythm).toBe('模板文案：短句密集');
    });
});
