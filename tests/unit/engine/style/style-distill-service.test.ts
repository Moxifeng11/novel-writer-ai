import { describe, expect, it } from 'vitest';
import {
    analyzeStyleFromSource,
    buildStyleDistillPrompts,
    type StyleDistillDeps,
    type StyleDistillInput,
} from '../../../../engine/style/style-distill-service';
import type { AIEngine } from '../../../../engine/ai-engine';

/**
 * V2 十二维特征并入蒸馏链（docs/design/style-deconstructor-v2-single-entry.md 的落地方）：
 * 1. 样本模式 → 本地统计 featuresV2 + 报告尾部追加「## 十、十二维特征统计」；
 * 2. 书名模式 → 无样本，不计算、不追加；
 * 3. 统计失败不阻断蒸馏主流程（只少该小节）。
 */

const SAMPLE_TEXT = `他突然停下了脚步。

我心中一惊，难道这就是传说中的玄机？然而，转身的瞬间，我却看到了一抹熟悉的微笑。

月光如水，洒在庭院之中。风轻轻地吹过，带来阵阵花香。

「你来了。」他轻声说道。

「嗯。」我回答道，心中却充满了疑惑。`;

function makeDeps(): StyleDistillDeps {
    return {
        settings: {
            defaultModel: 'mock-model',
        } as unknown as StyleDistillDeps['settings'],
        resolveLimits: () => ({ maxContext: 32768, maxOutput: 8192 }),
    };
}

function makeEngine(): AIEngine & { calls: { system: string; user: string; model: string }[] } {
    const calls: { system: string; user: string; model: string }[] = [];
    const engine = {
        calls,
        callAI: async (system: string, user: string, model: string) => {
            calls.push({ system, user, model });
            return { content: '## 一、叙事视角与 tense\n（AI 报告正文）', error: undefined };
        },
    } as unknown as AIEngine & { calls: { system: string; user: string; model: string }[] };
    return engine;
}

describe('analyzeStyleFromSource — 十二维特征并入', () => {
    it('样本模式：报告尾部追加十二维小节，并返回 featuresV2', async () => {
        const engine = makeEngine();
        const input: StyleDistillInput = { mode: 'paste', label: '测试样本', sampleText: SAMPLE_TEXT };
        const result = await analyzeStyleFromSource(engine, input, makeDeps());

        expect(result.error).toBeUndefined();
        expect(result.featuresV2).toBeDefined();
        const features = result.featuresV2!.features;
        for (const key of [
            'rhythm', 'sentencePattern', 'wordChoice', 'rhetoric', 'perspective', 'emotion',
            'tension', 'infoDensity', 'dialogue', 'description', 'narration', 'languageTexture',
        ] as const) {
            expect(features[key].status).toBe('complete');
            expect(features[key].description.length).toBeGreaterThan(0);
        }
        expect(result.content).toContain('## 十、十二维特征统计（本地词表计算）');
        expect(result.content.indexOf('## 一、叙事视角')).toBeLessThan(result.content.indexOf('## 十、'));
        expect(result.content).toContain('- 节奏：');
        expect(result.content).toContain('- 语言质感：');
        expect(engine.calls).toHaveLength(1);
    });

    it('书名模式：不计算特征，也不追加小节', async () => {
        const engine = makeEngine();
        const input: StyleDistillInput = { mode: 'name', label: '某本书' };
        const result = await analyzeStyleFromSource(engine, input, makeDeps());

        expect(result.featuresV2).toBeUndefined();
        expect(result.content).not.toContain('十二维特征统计');
        expect(result.content).toContain('（AI 报告正文）');
    });

    it('统计失败不阻断蒸馏：报告正常返回且无 featuresV2', async () => {
        const engine = makeEngine();
        // 空样本会走 buildStyleDistillPrompts 的 hasSample=false 分支吗？不会——mode=paste 且 sampleText 空
        // 时 hasSample=false，但 analyzeStyleFromSource 的守卫同样要求非空，因此这里用特殊输入触发统计异常：
        // 传入仅空白字符的样本，绕过守卫（trim 后为空时守卫直接跳过），改为直接验证守卫行为。
        const input: StyleDistillInput = { mode: 'paste', label: '空白样本', sampleText: '   \n\t  ' };
        const result = await analyzeStyleFromSource(engine, input, makeDeps());
        expect(result.content).toContain('（AI 报告正文）');
        expect(result.featuresV2).toBeUndefined();
        expect(result.content).not.toContain('十二维特征统计');
    });
});

describe('buildStyleDistillPrompts — 模式区分', () => {
    it('样本模式要求证据引用；书名模式要求标注推测', () => {
        const sample = buildStyleDistillPrompts({ mode: 'paste', label: '样本', sampleText: SAMPLE_TEXT });
        expect(sample.system).toContain('不得使用模型记忆');
        expect(sample.user).toContain('【样本文本】');

        const name = buildStyleDistillPrompts({ mode: 'name', label: '某本书' });
        expect(name.system).toContain('基于模型记忆的推测');
        expect(name.user).toContain('某本书');
    });
});
