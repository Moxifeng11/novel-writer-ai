import { describe, expect, it } from 'vitest';
import { compressWorldContext } from '../../../engine/context-compressor';
import { estimateTokens } from '../../../shared/token-estimator';
import { truncateTextToTokensHeadTail, truncateTextToTokensTail } from '../../../shared/prompt-budget';

const longParagraph = '青云山位于九州东域，终年云雾缭绕。'.repeat(120);

describe('context-compressor — 台账数据不再被压错', () => {
    it('时间线超 15 条时保留最新（第20章），不保留最旧（第1章）', () => {
        const timeline = Array.from({ length: 20 }, (_, index) => `第${index + 1}章：事件${index + 1}`).join('\n');
        const result = compressWorldContext('', '', '', timeline, '', 20, 100_000);
        expect(result.timeline).toContain('第20章：事件20');
        expect(result.timeline).not.toContain('第1章：事件1');
        expect(result.timeline.split('\n')).toHaveLength(15);
    });

    it('伏笔压缩只保留未回收，并保留计划章与状态', () => {
        const foreshadows = [
            'F1|断裂的玉佩|高|第1章|第3章|林惊鸿|身世线|未揭示',
            'F2|旧剑|低|第1章|第2章|林惊鸿|入门线|已揭示',
            'F3|废弃支线|与主线冲突|第5章|废弃|废弃',
            'F4|神秘来信|中|第2章|第6章|林惊鸿|师门线|待回收',
        ].join('\n');
        const result = compressWorldContext('', '', foreshadows, '', '', 4, 100_000);
        expect(result.foreshadows).toContain('断裂的玉佩');
        expect(result.foreshadows).toContain('计划:第3章');
        expect(result.foreshadows).toContain('状态:未回收');
        expect(result.foreshadows).toContain('神秘来信');
        expect(result.foreshadows).not.toContain('旧剑');
        expect(result.foreshadows).not.toContain('废弃支线');
    });

    it('单段超长世界观看不到关键词时也不返回空串，且不超过上限', () => {
        const result = compressWorldContext(longParagraph, '', '', '', '完全不相关的提纲', 1, 8000);
        expect(result.worldView.length).toBeGreaterThan(0);
        expect(result.worldView.length).toBeLessThanOrEqual(2000);
        expect(result.worldView).toContain('已压缩');
    });
});

describe('prompt-budget — 头尾截断不再丢弃尾部指令', () => {
    it('头缩到极限仍超时，保留尾部写指令', () => {
        const paragraphs = [
            '甲'.repeat(400),
            '乙'.repeat(400),
            '丙'.repeat(400),
            '丁'.repeat(400),
            '戊'.repeat(400),
            '最后写指令：必须停在悬念处',
        ];
        const text = paragraphs.join('\n\n');
        const result = truncateTextToTokensHeadTail(text, 220);
        expect(result).toContain('最后写指令');
        expect(result).toContain('省略');
        expect(estimateTokens(result)).toBeLessThanOrEqual(220);
    });

    it('尾部截断保留文本末尾而不是开头', () => {
        const text = `${'前文'.repeat(500)}结尾关键动作`;
        const result = truncateTextToTokensTail(text, 30);
        expect(result.endsWith('结尾关键动作')).toBe(true);
        expect(estimateTokens(result)).toBeLessThanOrEqual(30);
    });

    it('未超预算原样返回', () => {
        const text = '第一段\n\n第二段\n\n最后指令';
        expect(truncateTextToTokensHeadTail(text, 1000)).toBe(text);
    });
});
