import { describe, expect, it } from 'vitest';
import { buildModeDocumentPrompt } from '../../../engine/mode-document-writer';
import type { ModeRuntimeContext } from '../../../engine/mode-runtime';
import type { ModeInjectionResult } from '../../../engine/mode-injection';

function runtime(overrides: Partial<ModeRuntimeContext> = {}): ModeRuntimeContext {
    return {
        mode: 'short',
        project: '短篇小说/雨夜合同',
        meta: { mode: 'short', targetWords: 80000, targetUnits: 20 } as ModeRuntimeContext['meta'],
        outlineDoc: '第1节：雨夜咖啡馆',
        storyDoc: '一个替人收拾残局的女人。',
        storyboardDoc: '',
        preResearch: null,
        preResearchDigest: '主分类：都市\n故事前提：最后一次交易遇到旧识。',
        entities: '【人物】\n- 林晚：冷静',
        styleGuide: '克制、短句、少形容词。',
        modeGuide: '短篇创作约束',
        targetWords: 3000,
        ...overrides,
    };
}

describe('buildModeDocumentPrompt — 模式文档提示词', () => {
    it('短篇大纲带前期调研、目标单元数与开篇三屏要求', () => {
        const prompt = buildModeDocumentPrompt('short', 'outline', runtime(), {
            model: '',
            maxTokens: 0,
            instruction: '更偏悬疑',
        });
        expect(prompt.system).toContain('分节大纲');
        expect(prompt.system).toContain('更偏悬疑');
        expect(prompt.user).toContain('【前期调研】');
        expect(prompt.user).toContain('约 20 个节');
    });

    it('剧本分镜带场景圣经与分镜规则', () => {
        const prompt = buildModeDocumentPrompt('script', 'storyboard', runtime({
            mode: 'script',
            modeGuide: '剧本约束',
            storyDoc: '场景圣经内容',
            storyboardDoc: '旧分镜',
        }), { model: '', maxTokens: 0 });
        expect(prompt.system).toContain('分镜表');
        expect(prompt.system).toContain('画面必须可拍');
        expect(prompt.user).toContain('【场景圣经】');
    });
});

describe('buildModeDocumentPrompt — 知识库/指纹注入', () => {
    it('注入结果带指纹与知识时，user 提示词含【文笔指纹】且知识原文只带一次「参考知识」表头', () => {
        const injection: ModeInjectionResult = {
            knowledge: '参考知识\n- 都市合同纠纷：定金不得超过主合同标的额的 20%。',
            fingerprints: '- 江湖冷峻流：句式 短促；对白 少而利落',
        };
        const prompt = buildModeDocumentPrompt('short', 'outline', runtime(), { model: '', maxTokens: 0 }, injection);
        expect(prompt.user).toContain('【文笔指纹】');
        expect(prompt.user).toContain('- 江湖冷峻流：句式 短促；对白 少而利落');
        // knowledge 已自带表头，直接原文追加，不应再包一层【参考知识】
        expect(prompt.user).not.toContain('【参考知识】');
        expect(prompt.user.match(/参考知识/g)?.length).toBe(1);
    });

    it('注入为空时不产生空的指纹/知识块', () => {
        const prompt = buildModeDocumentPrompt(
            'short',
            'outline',
            runtime(),
            { model: '', maxTokens: 0 },
            { knowledge: '', fingerprints: '' },
        );
        expect(prompt.user).not.toContain('【文笔指纹】');
        expect(prompt.user).not.toContain('参考知识');
        expect(prompt.user).not.toMatch(/\n\n\n/);
    });
});
