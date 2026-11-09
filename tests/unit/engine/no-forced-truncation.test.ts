import { describe, expect, it } from 'vitest';
import { assembleStepPrompt } from '../../../engine/step-prompt-assembly';
import { ContextOverflowError } from '../../../engine/context/overflow-recovery';
import { generateUnitText, type UnitWriterContext } from '../../../engine/mode-unit-writer';

function ctx(): Record<string, unknown> {
    return {
        project: '长篇小说/测试书',
        chapterName: '第1章',
        chapterNum: 1,
        volume: '第1卷',
        chapDir: '',
        vars: { allChars: '- 林惊鸿：冷静', protagonistName: '林惊鸿' },
        stepResults: {},
        stepCompleted: new Set<string>(),
        currentStepIndex: 0,
        setCurrentStepIndex: () => undefined,
        tabContent: {},
        systemPromptEl: {},
        userPromptEl: {},
        temperatureSlider: {},
        isLoading: false,
        buildTemplateVars: async () => ({}),
        saveStepResult: async () => true,
        renderInContainer: async () => undefined,
        setIsLoading: () => undefined,
        refreshWorkspace: () => undefined,
    };
}

describe('step-prompt-assembly — 超预算不静默截断', () => {
    it('正文步骤在压缩后仍超预算时抛 ContextOverflowError', async () => {
        const host = {
            loadOutlineKnowledge: async () => '',
            loadBodyKnowledge: async () => '',
            resolveStepBudgetLimits: () => ({ maxContext: 180, maxOutput: 30, maxInputTokens: 150 }),
        };
        await expect(assembleStepPrompt(
            host,
            ctx() as never,
            'bodyGeneration',
            '系统提示',
            `【大纲】\n${'内容'.repeat(4000)}`,
            'default',
        )).rejects.toBeInstanceOf(ContextOverflowError);
    });
});

describe('mode-unit-writer — 单元写入有预算闸门', () => {
    const base: UnitWriterContext = {
        mode: 'short',
        project: '短篇小说/测试',
        unitNumber: 1,
        unitName: '第1节',
        unitPath: '短篇小说/测试/短篇创作/03-正文/第1节.md',
        outlineSection: '',
        outlineDoc: '',
        storyDoc: '',
        characters: '林惊鸿',
        previousTail: '',
        modeGuide: '',
        targetWords: 1500,
        existingBody: '',
    };

    it('超窗时抽取压缩后再发送', async () => {
        let captured = '';
        const ai = {
            callAI: async (_system: string, user: string) => {
                captured = user;
                return { content: '生成结果' };
            },
        };
        const huge = { ...base, outlineSection: '大纲内容。'.repeat(40_000) };
        await generateUnitText(ai, huge, 'generate', { model: 'unknown-model', maxTokens: 1024 });
        expect(captured.length).toBeGreaterThan(0);
        expect(captured.length).toBeLessThan(huge.outlineSection.length);
        expect(captured).toContain('压缩');
    });

    it('mode=off 时超窗直接报错', async () => {
        const ai = { callAI: async () => ({ content: '不应被调用' }) };
        const huge = { ...base, outlineSection: '大纲内容。'.repeat(40_000) };
        await expect(generateUnitText(ai, huge, 'generate', {
            model: 'unknown-model', maxTokens: 1024, compressionMode: 'off',
        })).rejects.toBeInstanceOf(ContextOverflowError);
    });
});
