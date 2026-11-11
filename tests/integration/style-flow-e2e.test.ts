/**
 * 阶段 A2：风格流端到端（指纹三层 → 启用 → 选择 → 强度 → 注入）
 *
 * 长期目标（docs/LONG-TERM-GOAL.md）阶段 A 的第二条链路自证。
 *
 * **不 mock 中间层**：真实 `StyleFingerprintLibrary`（三层存储）、真实
 * `LocalVectorStore`（指纹向量）、真实 `PromptBuilder.getFingerprintPromptParts`。
 *
 * 要守住的三件事：
 * 1. **三层语义**：project / global 参与注入，template 是来源库**不参与**
 * 2. **强度两层**：全局默认 + 项目覆盖，强度 0 等于禁用
 * 3. **启用即生效**：启用状态变化后，注入内容随之变化（不依赖调用方手动 reload）
 */

import { describe, expect, it } from 'vitest';
import { Vault } from 'obsidian';
import { StyleFingerprintLibrary, type StyleFingerprint } from '../../engine/style-fingerprint-library';
import { LocalVectorStore } from '../../engine/local-vector-store';
import { PromptBuilder } from '../../engine/prompt-builder';
import type { EmbeddingProvider, EmbeddingAvailability, ProviderInfo } from '../../engine/embedding/embedding-provider';

const PROJECT = '长篇小说/风格测试';

/** 确定性嵌入 */
class DeterministicEmbeddingProvider implements EmbeddingProvider {
    async embed(text: string): Promise<number[]> {
        if (!text) return [];
        const vec = new Array(16).fill(0);
        for (let i = 0; i < text.length; i++) vec[i % 16] += text.charCodeAt(i);
        const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
        return vec.map(v => v / norm);
    }
    async embedBatch(texts: string[]): Promise<number[][]> {
        return Promise.all(texts.map(t => this.embed(t)));
    }
    async isAvailable(): Promise<EmbeddingAvailability> {
        return { available: true, model: 'deterministic', dimensions: 16 };
    }
    getProviderInfo(): ProviderInfo {
        return { type: 'mock', name: 'deterministic', model: 'deterministic' };
    }
    getModelName(): string { return 'deterministic'; }
    async getDimensions(): Promise<number> { return 16; }
}

/** 构造指纹（特征文本是断言锚点） */
function makeFingerprint(
    id: string,
    scope: 'template' | 'global' | 'project',
    tone: string,
    samples: string[] = ['示例片段：他推开门，雨声灌了进来。'],
): StyleFingerprint {
    return {
        id,
        name: `指纹-${id}`,
        source: '测试源',
        scope,
        enabled: true,
        tags: ['test'],
        stats: {
            avgSentenceLength: 18,
            avgParagraphLength: 90,
            dialogueRatio: 0.35,
            descriptionRatio: 0.4,
            wordCount: 12000,
        },
        features: {
            sentenceRhythm: `节奏特征-${tone}`,
            wordPreference: `用词特征-${tone}`,
            narrativeStyle: `叙述特征-${tone}`,
            rhetoric: `修辞特征-${tone}`,
            dialogueStyle: `对白特征-${tone}`,
            paragraphStructure: `段落特征-${tone}`,
            overallTone: tone,
        },
        samples,
        extractedAt: Date.now(),
    };
}

/** 建库 + 建向量库 + 建 builder */
async function makePipeline(fingerprints: StyleFingerprint[]): Promise<{
    library: StyleFingerprintLibrary;
    builder: PromptBuilder;
}> {
    const vault = new Vault();
    const provider = new DeterministicEmbeddingProvider();
    const library = new StyleFingerprintLibrary({ vault } as never, PROJECT);
    await library.loadProject();
    await library.loadGlobal();

    const projectStore = new LocalVectorStore({ vault } as never, 'project', provider, PROJECT);
    const globalStore = new LocalVectorStore({ vault } as never, 'global', provider);

    for (const fp of fingerprints) {
        if (fp.scope === 'project') {
            await library.addProject(fp);
            await projectStore.add(fp.id, fp.samples ?? []);
        } else if (fp.scope === 'global') {
            await library.addGlobal(fp);
            await globalStore.add(fp.id, fp.samples ?? []);
        } else {
            await library.addTemplate(fp);
        }
    }

    const builder = new PromptBuilder(() => null, null, null, library, projectStore);
    return { library, builder };
}

describe('阶段 A2：风格流端到端', () => {
    it('项目指纹启用后，特征与示例进入 prompt 片段', async () => {
        const { builder } = await makePipeline([makeFingerprint('fp-p', 'project', '冷峻')]);
        const parts = await builder.getFingerprintPromptParts('他推开门，雨声灌了进来。');
        const text = parts.join('\n');
        expect(text).toBeTruthy();
        expect(text).toContain('冷峻');
    });

    it('全局指纹启用后同样参与注入（跨项目通用）', async () => {
        const { builder } = await makePipeline([makeFingerprint('fp-g', 'global', '疏朗')]);
        const parts = await builder.getFingerprintPromptParts('他推开门，雨声灌了进来。');
        expect(parts.join('\n')).toContain('疏朗');
    });

    it('模板层是来源库，不参与注入', async () => {
        const { builder } = await makePipeline([makeFingerprint('fp-t', 'template', '模板腔')]);
        const parts = await builder.getFingerprintPromptParts('他推开门，雨声灌了进来。');
        expect(parts.join('\n')).not.toContain('模板腔');
    });

    it('禁用指纹后注入立即消失（启用状态生效，不依赖手动 reload）', async () => {
        const { library, builder } = await makePipeline([makeFingerprint('fp-x', 'project', '会被禁用')]);
        expect((await builder.getFingerprintPromptParts('雨声')).join('\n')).toContain('会被禁用');

        await library.disableProject('fp-x');
        expect((await builder.getFingerprintPromptParts('雨声')).join('\n')).not.toContain('会被禁用');
    });

    it('强度 0 等于禁用：特征描述消失', async () => {
        const { library, builder } = await makePipeline([makeFingerprint('fp-z', 'project', '会被强度禁用')]);
        expect((await builder.getFingerprintPromptParts('雨声')).join('\n')).toContain('会被强度禁用');

        await library.setIntensityConfig('fp-z', { globalIntensity: 0 }, PROJECT);
        expect((await builder.getFingerprintPromptParts('雨声')).join('\n')).not.toContain('会被强度禁用');
    });

    it('全局默认强度对未覆盖的项目生效（两层语义）', async () => {
        // 说明：这里验证「两层取值链」与「注入确实读到它」，不验证示例条数的裁剪细节
        // —— 示例裁剪由 tests/unit/engine/style/tiered-injection-intensity.test.ts 精确覆盖，
        // 且依赖真实嵌入的相似度阈值，用确定性假嵌入断言条数会变成脆测试。
        const { library, builder } = await makePipeline([
            makeFingerprint('fp-i', 'project', '强度两层'),
        ]);

        // 只设全局默认 → 项目读到它
        await library.setGlobalIntensityConfig('fp-i', { globalIntensity: 0.1 });
        await library.loadIntensityConfigs(PROJECT);
        expect(library.getIntensityConfig('fp-i', PROJECT).globalIntensity).toBe(0.1);
        expect(library.hasIntensityOverride('fp-i', PROJECT)).toBe(false);

        // 项目覆盖 1.0 → 覆盖优先，且仍能正常注入
        await library.setIntensityConfig('fp-i', { globalIntensity: 1.0 }, PROJECT);
        await library.loadIntensityConfigs(PROJECT);
        expect(library.getIntensityConfig('fp-i', PROJECT).globalIntensity).toBe(1.0);
        expect(library.hasIntensityOverride('fp-i', PROJECT)).toBe(true);
        expect((await builder.getFingerprintPromptParts('雨声灌了进来')).join('\n')).toContain('强度两层');

        // 移除覆盖 → 回落到全局默认
        await library.removeIntensityConfig('fp-i', PROJECT);
        await library.loadIntensityConfigs(PROJECT);
        expect(library.getIntensityConfig('fp-i', PROJECT).globalIntensity).toBe(0.1);
        expect(library.hasIntensityOverride('fp-i', PROJECT)).toBe(false);
    });

    it('没有启用指纹时不产出空片段', async () => {
        const { builder } = await makePipeline([]);
        expect(await builder.getFingerprintPromptParts('雨声')).toEqual([]);
    });
});
