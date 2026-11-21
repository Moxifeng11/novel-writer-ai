/**
 * fingerprint-analysis-merge.test.ts — V2 规范模型 P2/P3 契约
 *
 * 背景：docs/design/2026-11-21-style-fingerprint-v2-canonical.md（用户 2026-11-22 定「效果最好」）
 *   P2a：AI 抽取与本地十二维分析同一份原文 → 新建即落「12 维完整」V2，7 维文案仍用 AI 的；
 *   P2b：加载期对旧 V2 条目（5 维 pending）按原文/样章回填；
 *   P3：V2 独有 5 维进入提示词全局层（只补 V1 没有的维度，强度 0 仍完全禁用）。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Vault } from 'obsidian';
import { StyleFingerprintLibrary, type StyleFingerprint } from '../../../../engine/style-fingerprint-library';
import type { EmbeddingProvider, EmbeddingAvailability, ProviderInfo } from '../../../../engine/embedding/embedding-provider';
import { StyleFeaturesAnalyzerV2, type StyleAnalysisResultV2 } from '../../../../engine/style/style-features-v2';
import { STYLE_DIMENSION_KEYS_V2, V2_NEW_DIMENSIONS } from '../../../../engine/style/style-dimensions-v2';
import {
    ContextAnalyzer,
    TieredInjectionBuilder,
} from '../../../../engine/style/dynamic-injection-engine';
import type { StyleIntensityConfig } from '../../../../engine/style/style-intensity-engine';
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

/** 一段有对话、有描写、有转折的中文样本（本地统计需要足够长度） */
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

/** AI 抽取入口的产物（只有 V1 七维文案，不含任何 V2 特征） */
function makeV1Fingerprint(id: string): StyleFingerprint {
    return {
        id,
        name: 'AI 抽取指纹',
        source: '样章',
        scope: 'global',
        enabled: true,
        tags: ['测试'],
        stats: {
            avgSentenceLength: 15,
            avgParagraphLength: 50,
            dialogueRatio: 0.2,
            descriptionRatio: 0.4,
            wordCount: 3000,
        },
        features: {
            sentenceRhythm: 'AI 判定：短句与长句交替，节奏偏慢',
            wordPreference: 'AI 判定：书面语为主，少用网络词',
            narrativeStyle: 'AI 判定：第三人称限知',
            rhetoric: 'AI 判定：以环境烘托为主',
            dialogueStyle: 'AI 判定：对白克制，潜台词多',
            paragraphStructure: 'AI 判定：多段短句推进',
            overallTone: 'AI 判定：阴冷压抑',
        },
        samples: ['示例一段'],
        extractedAt: 1_700_000_000_000,
    };
}

async function analyzeSample(): Promise<StyleAnalysisResultV2> {
    return new StyleFeaturesAnalyzerV2().analyze(SAMPLE_TEXT);
}

async function readGlobalFile(vault: Vault): Promise<any[]> {
    const raw = await (vault as any).readByPath(globalFingerprintsFile());
    return JSON.parse(raw);
}

describe('V2 规范模型 P2a — 新建入口合并十二维', () => {
    let vault: Vault;
    let library: StyleFingerprintLibrary;

    beforeEach(async () => {
        vault = new Vault();
        library = new StyleFingerprintLibrary({ vault } as any);
        library.setEmbeddingClient(new MockEmbeddingProvider());
        await library.loadGlobal();
    });

    it('addGlobal(fp, analysis) 一次落盘即为 12 维 complete，7 维文案保留 AI 版本', async () => {
        const analysis = await analyzeSample();
        await library.addGlobal(makeV1Fingerprint('fp-p2a'), analysis);

        const item = (await readGlobalFile(vault)).find(fp => fp.id === 'fp-p2a');
        expect(item.version).toBe('v2');
        expect(Object.keys(item.features)).toHaveLength(STYLE_DIMENSION_KEYS_V2.length);

        // 7 维：AI 文案优先于本地规则文案
        expect(item.features.rhythm.description).toBe('AI 判定：短句与长句交替，节奏偏慢');
        expect(item.features.languageTexture.description).toBe('AI 判定：阴冷压抑');
        expect(item.v1Backup.features.sentenceRhythm).toBe('AI 判定：短句与长句交替，节奏偏慢');

        // 12 维全部 complete（P2a 消除「永远 pending」）
        for (const key of STYLE_DIMENSION_KEYS_V2) {
            expect(item.features[key].status, key).toBe('complete');
        }
        // V2 独有 5 维有定量字段与文案
        for (const key of V2_NEW_DIMENSIONS) {
            expect(item.features[key].description, key).toBeTruthy();
        }
        expect(item.features.sentencePattern.inversionDensity).toBeTypeOf('number');
        expect(item.features.emotion.emotionalTone).toBeTypeOf('string');
        // 基础统计沿用调用方（抽取器）的数据；分析统计只在回填路径使用
        expect(item.stats.wordCount).toBe(3000);
    });
});

describe('V2 规范模型 P2b — 加载期回填', () => {
    it('旧 V2 条目（5 维 pending + sourceText）在 loadGlobal 时被补齐并备份', async () => {
        const vault = new Vault();
        const analysis = await analyzeSample();
        const pending = {
            version: 'v2',
            id: 'fp-legacy',
            name: '旧条目',
            source: '样章',
            scope: 'global',
            enabled: true,
            tags: [],
            samples: [],
            sourceText: SAMPLE_TEXT,
            stats: { avgSentenceLength: 0, avgParagraphLength: 0, dialogueRatio: 0, descriptionRatio: 0, wordCount: 0 },
            features: {
                ...analysis.features,
                sentencePattern: { ...analysis.features.sentencePattern, description: '', status: 'pending' },
                emotion: { ...analysis.features.emotion, description: '', status: 'pending' },
                tension: { ...analysis.features.tension, description: '', status: 'pending' },
                infoDensity: { ...analysis.features.infoDensity, description: '', status: 'pending' },
                description: { ...analysis.features.description, description: '', status: 'pending' },
            },
            v1Backup: { features: { sentenceRhythm: '旧文案' }, extractedAt: 1, migratedAt: 1 },
            extractedAt: 1,
        };
        await (vault as unknown as { write(path: string, data: string): Promise<void> }).write(globalFingerprintsFile(), JSON.stringify([pending], null, 2));

        const library = new StyleFingerprintLibrary({ vault } as any);
        library.setEmbeddingClient(new MockEmbeddingProvider());
        await library.loadGlobal();

        const item = (await readGlobalFile(vault)).find(fp => fp.id === 'fp-legacy');
        for (const key of V2_NEW_DIMENSIONS) {
            expect(item.features[key].status, key).toBe('complete');
            expect(item.features[key].description, key).toBeTruthy();
        }
        // 原文件留档
        const backup = await (vault as any).readByPath(globalFingerprintsFile() + '.v2backfill.bak');
        expect(backup).toContain('"pending"');
    });

    it('既无原文也无样章的条目保持 pending（不凭空造数据）', async () => {
        const vault = new Vault();
        const analysis = await analyzeSample();
        const noText = {
            version: 'v2',
            id: 'fp-no-text',
            name: '无原文',
            source: '',
            scope: 'global',
            enabled: true,
            tags: [],
            samples: [],
            stats: {},
            features: { ...analysis.features, emotion: { ...analysis.features.emotion, description: '', status: 'pending' } },
            v1Backup: { features: {}, extractedAt: 1, migratedAt: 1 },
            extractedAt: 1,
        };
        await (vault as unknown as { write(path: string, data: string): Promise<void> }).write(globalFingerprintsFile(), JSON.stringify([noText], null, 2));

        const library = new StyleFingerprintLibrary({ vault } as any);
        library.setEmbeddingClient(new MockEmbeddingProvider());
        await library.loadGlobal();

        const item = (await readGlobalFile(vault)).find(fp => fp.id === 'fp-no-text');
        expect(item.features.emotion.status).toBe('pending');
    });
});

describe('V2 规范模型 P3 — V2 独有 5 维进入提示词', () => {
    const builder = new TieredInjectionBuilder();
    const context = new ContextAnalyzer().analyze('他推开门，冷风灌了进来。');

    it('传入 v2Features 时追加「V2 深化特征（量化）」段，且不重复 V1 七维', async () => {
        const analysis = await analyzeSample();
        const fp = makeV1Fingerprint('fp-p3');
        const map = new Map([[fp.id, analysis.features]]);

        const text = builder.build([fp], [], context, undefined, 2000, undefined, map).join('\n');
        expect(text).toContain('【写作风格指纹】');
        expect(text).toContain('V2 深化特征（量化）：');
        expect(text).toContain('- 句式：');
        expect(text).toContain('- 情绪：');
        expect(text).toContain('- 张力：');
        expect(text).toContain('- 信息量：');
        expect(text).toContain('- 描写：');
        // 只补 5 维：V1 的七个标签不应重复出现
        expect(text).not.toContain('- 节奏：');
        expect(text).not.toContain('- 用词：');
    });

    it('不传 v2Features 时保持旧行为（无 V2 段）', () => {
        const text = builder.build([makeV1Fingerprint('fp-v1')], [], context).join('\n');
        expect(text).toContain('【写作风格指纹】');
        expect(text).not.toContain('V2 深化特征');
    });

    it('强度 0 的指纹连 V2 段一起被禁用', async () => {
        const analysis = await analyzeSample();
        const fp = makeV1Fingerprint('fp-zero');
        const map = new Map([[fp.id, analysis.features]]);
        const configs = new Map<string, StyleIntensityConfig>([[fp.id, { globalIntensity: 0 }]]);

        const text = builder.build([fp], [], context, configs, 2000, undefined, map).join('\n');
        expect(text).not.toContain('【写作风格指纹】');
        expect(text).not.toContain('V2 深化特征');
    });
});
