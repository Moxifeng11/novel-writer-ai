/**
 * Rev 186 / T10：正文 prompt 的关联索引注入与去重
 *
 * 有 storyLinkage 时用【关联索引】替代平铺的【未揭示伏笔】/【时间线事件】，
 * 避免同一批数据被注入两次、把预算花在重复行上；没有时保持旧行为。
 */
import { describe, it, expect } from 'vitest';
import { buildUserPrompt } from '../../../engine/ai-prompt-builder';
import type { ChapterContext } from '../../../engine/ai-types';

const baseContext: ChapterContext = {
    chapterNumber: 6,
    project: '测试书',
    volume: '第1卷',
};

const settings = { minWordCount: 2000 };

describe('buildUserPrompt — 关联索引', () => {
    it('有 storyLinkage 时注入【关联索引】，且不再平铺伏笔/时间线', () => {
        const prompt = buildUserPrompt({
            ...baseContext,
            storyLinkage: '【关联伏笔·本章到期】\n- 残玉（高；埋设 第1章；计划 第6-8章）',
            unrevealedForeshadow: '- 残玉',
            timelineEvents: '| 山门试炼 | 第三年春 |',
        }, settings);

        expect(prompt).toContain('【关联索引】');
        expect(prompt).toContain('【关联伏笔·本章到期】');
        expect(prompt).not.toContain('【未揭示伏笔】');
        expect(prompt).not.toContain('【时间线事件】');
    });

    it('无 storyLinkage 时保持旧平铺行为', () => {
        const prompt = buildUserPrompt({
            ...baseContext,
            unrevealedForeshadow: '- 残玉',
            timelineEvents: '| 山门试炼 | 第三年春 |',
        }, settings);

        expect(prompt).not.toContain('【关联索引】');
        expect(prompt).toContain('【未揭示伏笔】');
        expect(prompt).toContain('【时间线事件】');
    });

    it('storyLinkage 与 forcedReveal 共存：强制揭示段仍保留', () => {
        const prompt = buildUserPrompt({
            ...baseContext,
            storyLinkage: '【关联伏笔·本章到期】\n- 残玉',
            forcedReveal: ['残玉'],
        }, settings);

        expect(prompt).toContain('【关联索引】');
        expect(prompt).toContain('【本章必须揭示的伏笔】');
        expect(prompt).toContain('- 残玉');
    });

    it('关联索引超过 1800 字时按上限截断', () => {
        const prompt = buildUserPrompt({
            ...baseContext,
            storyLinkage: '关'.repeat(3000),
        }, settings);

        expect(prompt).toContain('【关联索引】');
        expect(prompt).not.toContain('关'.repeat(1801));
    });
});
