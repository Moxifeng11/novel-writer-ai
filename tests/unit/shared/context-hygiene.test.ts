import { describe, expect, it } from 'vitest';
import {
    auditContextBlocks,
    bigramSimilarity,
    extractChapterNumbers,
    formatContextHygiene,
    resolveStyleConflicts,
} from '../../../shared/context-hygiene';

const longText = (seed: string): string => Array.from(
    { length: 20 },
    (_, i) => `${seed}第${i}段：他抬手，风从袖口灌进来，铁腥味顺着喉咙往下沉，指节抵着桥栏，冷得发麻。`,
).join('\n');

describe('context-hygiene — 上下文体检', () => {
    describe('相似度', () => {
        it('完全相同返回 1，短文本不参与判定', () => {
            const text = longText('A');
            expect(bigramSimilarity(text, text)).toBe(1);
            expect(bigramSimilarity('短文本', '短文本')).toBe(0);
        });

        it('不同内容相似度低', () => {
            const other = Array.from({ length: 20 }, (_, i) => `第${i}章：议会在雨里开会，粮价涨了三成，老人把手炉抱得更紧。`).join('\n');
            expect(bigramSimilarity(longText('甲'), other)).toBeLessThan(0.5);
        });
    });

    describe('重复段', () => {
        it('世界观与设定库几乎相同 → 保留世界观、清空设定库', () => {
            const text = longText('世界观');
            const result = auditContextBlocks([
                { key: 'worldView', label: '世界观', text },
                { key: 'settingLib', label: '设定库', text: `${text}\n` },
            ], { chapterNum: 1 });
            expect(result.issues).toHaveLength(1);
            expect(result.issues[0].type).toBe('duplicate');
            expect(result.issues[0].severity).toBe('high');
            expect(result.dropKeys).toEqual(['settingLib']);
        });

        it('规则与「文笔风格」含相同规则副本 → 清空文笔风格', () => {
            const text = longText('规则');
            const result = auditContextBlocks([
                { key: 'writingStyleContent', label: '文笔风格', text },
                { key: 'writingRules', label: '写作规则', text },
            ], { chapterNum: 2 });
            expect(result.dropKeys).toEqual(['writingStyleContent']);
        });

        it('场景卡与场景展开重复时保留场景卡（硬约束优先）', () => {
            const text = longText('场景');
            const result = auditContextBlocks([
                { key: 'sceneExpansion', label: '场景展开', text },
                { key: 'sceneCardDigest', label: '场景卡', text },
            ], { chapterNum: 1 });
            expect(result.dropKeys).toEqual(['sceneExpansion']);
        });

        it('短段重复不误报', () => {
            const result = auditContextBlocks([
                { key: 'worldView', label: '世界观', text: '很短' },
                { key: 'settingLib', label: '设定库', text: '很短' },
            ], { chapterNum: 1 });
            expect(result.issues).toEqual([]);
            expect(result.dropKeys).toEqual([]);
        });
    });

    describe('串章', () => {
        it('步骤结果只引用别的章节（≥2 次）→ 告警', () => {
            const result = auditContextBlocks([
                { key: 'infoPlan', label: '信息规划', text: '## 第3章 信息规划\n本章承接第3章结尾。' },
            ], { chapterNum: 4 });
            expect(result.issues).toHaveLength(1);
            expect(result.issues[0].type).toBe('staleChapter');
            expect(result.issues[0].severity).toBe('high');
            expect(result.dropKeys).toEqual([]);
        });

        it('包含当前章节号 → 不告警', () => {
            const result = auditContextBlocks([
                { key: 'infoPlan', label: '信息规划', text: '## 第4章 信息规划\n接第3章。' },
            ], { chapterNum: 4 });
            expect(result.issues).toEqual([]);
        });

        it('只提一次别的章（引用前情）不告警', () => {
            const result = auditContextBlocks([
                { key: 'outlineContent', label: '大纲摘要', text: '这章承接第3章的线索。' },
            ], { chapterNum: 4 });
            expect(result.issues).toEqual([]);
        });
    });

    describe('章节号抽取与摘要', () => {
        it('抽取去重且保序', () => {
            expect(extractChapterNumbers('第3章、第3章、第12章')).toEqual([3, 12]);
        });

        it('formatContextHygiene 输出重复/串章摘要', () => {
            const text = longText('X');
            const result = auditContextBlocks([
                { key: 'worldView', label: '世界观', text },
                { key: 'settingLib', label: '设定库', text },
                { key: 'infoPlan', label: '信息规划', text: '第3章 / 第3章' },
            ], { chapterNum: 9 });
            const line = formatContextHygiene(result);
            expect(line).toContain('【上下文体检】');
            expect(line).toContain('1 处重复');
            expect(line).toContain('settingLib');
            expect(line).toContain('1 处疑似串章');
        });
    });

    describe('文笔风格 × 写作规则冲突（实测样本）', () => {
        const styleWithOldRules = [
            '## 二、文笔特征',
            '短句为主。每段仅一个句号，句号后必须换行。',
            '高频率使用粤语白话文词汇。',
            '## 三、对话风格',
            '对话是剧情推进的核心载体。',
        ].join('\n');
        const anchorRules = '## 一、段落\n- 每个自然段 2–6 句、80–220 字。';

        it('规则给了自然段锚点、风格要求一句一段 → 判冲突并剔除冲突行', () => {
            const result = resolveStyleConflicts(styleWithOldRules, anchorRules);
            expect(result.conflicts).toEqual(['每段仅一个句号', '句号后必须换行']);
            expect(result.cleaned).not.toContain('每段仅一个句号');
            expect(result.cleaned).toContain('高频率使用粤语白话文词汇');
            expect(result.tooMuchTrimmed).toBe(false);
        });

        it('规则没有段落锚点时不剔行，但报告「规则缺锚点」', () => {
            const result = resolveStyleConflicts(styleWithOldRules, '## 一、视角\n第三人称限知。');
            expect(result.conflicts).toEqual(['每段仅一个句号', '句号后必须换行']);
            expect(result.cleaned).toBe(styleWithOldRules);
            expect(result.rulesLackAnchor).toBe(true);
        });

        it('冲突行占比过高时只告警、不清空', () => {
            const almostAll = '每段仅一个句号，句号后必须换行。\n很短的风格说明。';
            const result = resolveStyleConflicts(almostAll, anchorRules);
            expect(result.tooMuchTrimmed).toBe(true);
            expect(result.cleaned).toBe(almostAll);
        });
    });
});
