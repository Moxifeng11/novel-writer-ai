import { afterEach, describe, expect, it } from 'vitest';
import {
    formatStyleSamplesForPrompt,
    selectBodyStyleSamples,
} from '../../../engine/style/style-sample-service';
import { clearSharedEmbeddingProvider } from '../../../engine/embedding/embedding-service';
import {
    formatContrastPairForPrompt,
    parseContrastLibrary,
    selectContrastPair,
} from '../../../shared/contrast-library';
import type { StyleFingerprint } from '../../../engine/style-fingerprint-library';

function fp(id: string, scope: 'global' | 'project', samples: string[]): StyleFingerprint {
    return {
        id,
        name: `fp-${id}`,
        source: 'test',
        scope,
        enabled: true,
        tags: [],
        stats: {
            avgSentenceLength: 10,
            avgParagraphLength: 50,
            dialogueRatio: 0.3,
            descriptionRatio: 0.4,
            wordCount: 1000,
        },
        features: {
            sentenceRhythm: '', wordPreference: '', narrativeStyle: '', rhetoric: '',
            dialogueStyle: '', paragraphStructure: '', overallTone: '',
        },
        samples,
        extractedAt: Date.now(),
    };
}

describe('StyleSampleService — 正文样章回退', () => {
    afterEach(() => clearSharedEmbeddingProvider());

    it('无 embedding 时按 project → global 回退原始样章', async () => {
        const selection = await selectBodyStyleSamples(
            {} as never,
            '项目',
            [
                fp('g1', 'global', ['全局样章一', '全局样章二']),
                fp('p1', 'project', ['项目样章一']),
            ],
            'query',
            2,
        );

        expect(selection.source).toBe('fallback');
        expect(selection.samples[0].text).toBe('项目样章一');
        expect(selection.samples).toHaveLength(2);
    });

    it('没有样章时返回 none', async () => {
        const selection = await selectBodyStyleSamples({} as never, '项目', [], 'query');
        expect(selection.source).toBe('none');
        expect(selection.samples).toEqual([]);
    });

    it('格式化为 system 片段并限长', () => {
        const text = formatStyleSamplesForPrompt({
            source: 'fallback',
            samples: [{ text: '第一段样章' }, { text: '第二段样章' }],
        });
        expect(text).toContain('【参考片段');
        expect(text).toContain('1. 第一段样章');
        expect(text).toContain('2. 第二段样章');
    });
});

describe('ContrastLibrary — 强弱对照', () => {
    const content = `# 写作对照库

## 对话

### 弱写法
他愤怒地说道：“你走。”

### 强写法
他把杯子放回桌面，杯底磕出一声轻响。“你走。”

### 差异
弱写法用副词标签说明情绪；强写法用动作和停顿让读者判断。

## 战斗

### 弱写法
他用力挥剑。

### 强写法
剑锋擦过石壁，火星溅在他手背上。

### 差异
具体动作替代抽象力度。
`;

    it('解析多个维度的弱/强对照', () => {
        const pairs = parseContrastLibrary(content);
        expect(pairs).toHaveLength(2);
        expect(pairs[0].dimension).toBe('对话');
        expect(pairs[0].weak).toContain('愤怒地说道');
        expect(pairs[0].strong).toContain('杯底');
        expect(pairs[0].difference).toContain('副词标签');
    });

    it('按场景类型匹配：对话/战斗', () => {
        const pairs = parseContrastLibrary(content);
        expect(selectContrastPair(pairs, 'dialogue')?.dimension).toBe('对话');
        expect(selectContrastPair(pairs, 'battle')?.dimension).toBe('战斗');
        expect(selectContrastPair(pairs, 'unknown')).toBeNull();
    });

    it('格式化包含弱写法、强写法与差异', () => {
        const pairs = parseContrastLibrary(content);
        const text = formatContrastPairForPrompt(pairs[0]);
        expect(text).toContain('弱写法（禁止模仿）');
        expect(text).toContain('强写法（学习其工艺');
        expect(text).toContain('差异：');
    });
});
