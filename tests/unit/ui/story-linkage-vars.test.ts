/**
 * Rev 186 关联索引接入活路径（2026-11-28）
 *
 * 历史：该特性原本只落在死路径 ai-prompt-builder（「有 linkage 则注入
 * 【关联索引】并替代平铺伏笔/时间线」），活模板从未有 ${storyLinkage}
 * 占位符——数据流到 buildStoryContext 即断。现接入四个正文用户模板，
 * 装配语义由 finalizeStoryLinkageVars 承载。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { finalizeStoryLinkageVars } from '../../../engine/prompts/story-linkage-vars';
import { TEMPLATE_VAR_FALLBACK_KEYS } from '../../../ui/full-writer/template-vars-builder';
import { BODY_GENERATION_USER_TEMPLATE_V2 } from '../../../shared/prompts/body-v2-prompts';
import { BODY_GENERATION_USER_TEMPLATE_V3 } from '../../../engine/prompts/body-v3-prompts';
import { BODY_GENERATION_USER_TEMPLATE_V4 } from '../../../engine/prompts/body-v4-prompts';
import { BODY_GENERATION_USER_TEMPLATE } from '../../../engine/prompts/chapter-pipeline-prompts';

const LONG_TEXT = '行'.repeat(2000);

describe('finalizeStoryLinkageVars — 装配语义', () => {
    it('有 linkage → 注入带标题的关联索引，平铺两段替换为注记', () => {
        const vars: Record<string, string> = {
            timelineEvents: '第3章：夜袭。',
            unrevealedForeshadow: '- 剑谱下落',
            forcedRevealHint: '【本章必须揭示】剑谱',
        };
        finalizeStoryLinkageVars(vars, { promptText: '- 伏笔「剑谱」↔ 设定库·藏剑阁' });

        expect(vars["storyLinkage"]).toContain('【关联索引');
        expect(vars["storyLinkage"]).toContain('↔ 设定库·藏剑阁');
        expect(vars["timelineEvents"]).toContain('已并入');
        expect(vars["unrevealedForeshadow"]).toContain('已并入');
        // forcedRevealHint 不受影响（本章必须揭示的伏笔永远显式列出）
        expect(vars["forcedRevealHint"]).toBe('【本章必须揭示】剑谱');
    });

    it('无 linkage → storyLinkage 置空，平铺清单原样保留', () => {
        const vars: Record<string, string> = {
            timelineEvents: '第3章：夜袭。',
            unrevealedForeshadow: '- 剑谱下落',
        };
        finalizeStoryLinkageVars(vars, null);
        expect(vars["storyLinkage"]).toBe('');
        expect(vars["timelineEvents"]).toBe('第3章：夜袭。');
        expect(vars["unrevealedForeshadow"]).toBe('- 剑谱下落');
    });

    it('promptText 超 1800 字截断（沿用原死路径上限）', () => {
        const vars: Record<string, string> = {};
        finalizeStoryLinkageVars(vars, { promptText: LONG_TEXT });
        const injected = vars["storyLinkage"].split('\n').slice(1).join('\n');
        expect(injected.length).toBe(1800);
    });

    it('空白 promptText 视为无 linkage', () => {
        const vars: Record<string, string> = { timelineEvents: '保留' };
        finalizeStoryLinkageVars(vars, { promptText: '   ' });
        expect(vars["storyLinkage"]).toBe('');
        expect(vars["timelineEvents"]).toBe('保留');
    });
});

describe('模板与注册表接线', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const read = (rel: string): string => readFileSync(path.resolve(here, '..', '..', '..', rel), 'utf8');

    it('四个正文用户模板都含 ${storyLinkage} 占位符（恰好一次）', () => {
        for (const tpl of [BODY_GENERATION_USER_TEMPLATE_V2, BODY_GENERATION_USER_TEMPLATE_V3, BODY_GENERATION_USER_TEMPLATE_V4, BODY_GENERATION_USER_TEMPLATE]) {
            expect(tpl).toContain('${storyLinkage}');
        }
    });

    it('infoPlan 用户模板不含该占位符（只有正文模板接 linkage）', () => {
        const src = read('engine/prompts/chapter-pipeline-prompts.ts');
        // 文件里 infoPlan 段在正文段之前，占位符只允许出现在正文段
        const bodyStart = src.indexOf('export const BODY_GENERATION_USER_TEMPLATE = `');
        expect(src.slice(0, bodyStart)).not.toContain('${storyLinkage}');
    });

    it('storyLinkage 登记在 fallback 键表（否则占位符原样发给模型）', () => {
        expect(TEMPLATE_VAR_FALLBACK_KEYS).toContain('storyLinkage');
    });
});
