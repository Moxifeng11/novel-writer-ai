/**
 * prompt-budget-b6.test.ts — 知识注入必须走统一预算闸门
 *
 * 三处历史绕过：
 * 1. 11 步正文把 knowledge 拼到 system 尾部（窗口不足时最先被截掉）；
 * 2. injectForSceneBody 把「必须层」和「按需层」拼成一个字符串塞回 user；
 * 3. sceneExpand / 大纲扩写直接拼接、完全不过闸门。
 */

import { describe, it, expect, vi } from 'vitest';
import { buildChapterPrompts } from '../../../engine/ai-prompt-builder';
import { KnowledgeInjector } from '../../../engine/knowledge-injector';
import type { InjectionContext } from '../../../engine/knowledge-injector';
import { generateSceneExpansion } from '../../../engine/scene-expander';
import type { ChapterContext } from '../../../engine/ai-types';

function makeCtx(): ChapterContext {
    return {
        project: '测试项目',
        chapterNumber: 10,
        outline: '林晚在东市与线人接头。',
        worldView: '架空王朝',
        settingLib: '设定库内容',
        chapterPlan: '第一卷规划',
    } as unknown as ChapterContext;
}

describe('B6 — buildChapterPrompts 预算闸门', () => {
    it('窗口充足时知识注入保留在 user，不进 system', () => {
        const knowledge = '【文笔风格注入】短句为主';
        const prompts = buildChapterPrompts(
            makeCtx(),
            { minWordCount: 2000, maxWordCount: 4000 },
            undefined,
            knowledge,
            { maxContext: 128000, maxOutput: 4096, modelId: 'gpt-4' },
        );

        expect(prompts.system).not.toContain('【文笔风格注入】');
        expect(prompts.user).toContain('短句为主');
        expect(prompts.droppedKnowledge).toBe(false);
        expect(prompts.trimmedKnowledge).toBe(false);
    });

    it('窗口极小时先丢弃知识层，system 与正文最后指令仍完整', () => {
        const knowledge = `【写作参考】${'风格样本'.repeat(2000)}`;
        const prompts = buildChapterPrompts(
            makeCtx(),
            { minWordCount: 2000, maxWordCount: 4000 },
            undefined,
            knowledge,
            { maxContext: 200, maxOutput: 100, modelId: 'qwen2.5:7b' },
        );

        expect(prompts.droppedKnowledge).toBe(true);
        expect(prompts.user).not.toContain('风格样本风格样本');
        // system 承载输出硬约束，必须完整
        expect(prompts.system).toContain('本章镜头');
        expect(prompts.user).toContain('【最后指令——必须遵守】');
    });
});

describe('B6 — injectForSceneBodyLayers 分层输出', () => {
    const ctx: InjectionContext = { projectPath: '/test', outline: '林晚在东市与线人接头。' };

    it('必须层进 system，按需层进 user', async () => {
        const injector = new KnowledgeInjector(null as never);
        const layers = await injector.injectForSceneBodyLayers(ctx, {
            beats: [{ id: 'b1', description: '在东市与线人接头', type: 'event', required: true }],
            candidates: [{ id: 'c1', name: '林晚', content: '按需设定内容', kind: 'character' }],
            maxInputTokens: 4000,
        });

        expect(layers.system).toContain('本章必须遵循');
        expect(layers.system).toContain('在东市与线人接头');
        expect(layers.user).toContain('相关设定（按需注入）');
        expect(layers.user).not.toContain('本章必须遵循');
    });

    it('预算极小时按需层整段丢弃，必须层仍在 system', async () => {
        const injector = new KnowledgeInjector(null as never);
        const layers = await injector.injectForSceneBodyLayers(ctx, {
            beats: [{ id: 'b1', description: '在东市与线人接头', type: 'event', required: true }],
            candidates: [{ id: 'c1', name: '林晚', content: '设定'.repeat(800), kind: 'character' }],
            maxInputTokens: 20,
        });

        expect(layers.system).toContain('在东市与线人接头');
        expect(layers.user).toBe('');
    });
});

describe('B6 — sceneExpand 走预算闸门', () => {
    it('超预算时丢弃知识注入并给出提示', async () => {
        const callAI = vi.fn(async (_systemPrompt: string, _userPrompt: string) => ({ content: '展开结果' }));
        const showNotice = vi.fn();
        const knowledge = `【写作参考】${'场景知识'.repeat(2000)}`;

        await generateSceneExpansion(
            { callAI } as never,
            {
                protagonistName: '林晚',
                chapNum: '10',
                outlineContent: '林晚在东市与线人接头。',
                sceneKnowledge: knowledge,
            },
            'qwen2.5:7b',
            { showNotice },
            { maxContext: 200, maxOutput: 100 },
        );

        const userPrompt = String(callAI.mock.calls[0][1]);
        expect(userPrompt).not.toContain('场景知识场景知识');
        expect(showNotice.mock.calls.some(c => String(c[0]).includes('跳过场景展开的知识注入'))).toBe(true);
    });

    it('预算充足时知识注入保留', async () => {
        const callAI = vi.fn(async (_systemPrompt: string, _userPrompt: string) => ({ content: '展开结果' }));

        await generateSceneExpansion(
            { callAI } as never,
            {
                protagonistName: '林晚',
                chapNum: '10',
                outlineContent: '林晚在东市与线人接头。',
                sceneKnowledge: '【写作参考】短句节奏',
            },
            'gpt-4',
            { showNotice: vi.fn() },
            { maxContext: 128000, maxOutput: 4096 },
        );

        expect(String(callAI.mock.calls[0][1])).toContain('短句节奏');
    });
});
