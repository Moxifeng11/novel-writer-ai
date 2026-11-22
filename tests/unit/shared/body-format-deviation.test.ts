/**
 * 正文格式偏离统计（四项校验「格式」项的依据）
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_BODY_FORMAT, analyzeBodyFormat } from '@/shared/body-format';

describe('analyzeBodyFormat', () => {
    it('空文本返回全零', () => {
        expect(analyzeBodyFormat('')).toEqual({
            totalLines: 0, indentMissing: 0, blankLineBreaks: 0, titleStripped: 0, metaStripped: 0, ratio: 0, samples: [],
        });
    });

    it('完全符合契约的正文零偏离', () => {
        const out = analyzeBodyFormat('　　第一段。\n　　第二段。', DEFAULT_BODY_FORMAT);
        expect(out.totalLines).toBe(2);
        expect(out.indentMissing).toBe(0);
        expect(out.blankLineBreaks).toBe(0);
        expect(out.ratio).toBe(0);
    });

    it('缺缩进 / 空行 / 标题 / 元叙述分别计数', () => {
        const out = analyzeBodyFormat(
            '# 第3章 试炼\n\n好的，以下是我将为您续写的内容：\n正文第一段。',
            DEFAULT_BODY_FORMAT,
        );
        expect(out.titleStripped).toBe(1);
        expect(out.blankLineBreaks).toBe(1);
        expect(out.metaStripped).toBe(1);
        // 非空行 3 行（标题 / 元叙述 / 正文）都缺段首缩进
        expect(out.totalLines).toBe(3);
        expect(out.indentMissing).toBe(3);
        // 偏离 3 行 + 空行 1 处 = 4，相对 3 行超过 1 → 上限截到 1
        expect(out.ratio).toBe(1);
    });

    it('空行契约下不把段间空行算作偏离', () => {
        const out = analyzeBodyFormat('第一段。\n\n第二段。', {
            ...DEFAULT_BODY_FORMAT,
            separator: '\n\n',
            indent: '',
        });
        expect(out.blankLineBreaks).toBe(0);
        expect(out.indentMissing).toBe(0);
        expect(out.ratio).toBe(0);
    });

    it('首部空行不算偏离', () => {
        const out = analyzeBodyFormat('\n\n　　第一段。', DEFAULT_BODY_FORMAT);
        expect(out.blankLineBreaks).toBe(0);
    });

    it('偏离样例行号按原始行序（含首部空行）定位', () => {
        const out = analyzeBodyFormat('\n# 第3章 试炼\n\n正文第一段。', DEFAULT_BODY_FORMAT);
        expect(out.samples.map(sample => sample.line)).toEqual([2, 3, 4]);
        expect(out.samples.map(sample => sample.kind)).toEqual(['title', 'blank', 'indent']);
        expect(out.samples[0].preview).toContain('第3章');
    });

    it('偏离样例最多保留 8 条，计数不受影响', () => {
        const body = Array.from({ length: 12 }, () => '正文。').join('\n');
        const out = analyzeBodyFormat(body, DEFAULT_BODY_FORMAT);
        expect(out.indentMissing).toBe(12);
        expect(out.samples).toHaveLength(8);
        expect(out.samples[7].line).toBe(8);
    });

    it('普通叙述不会被误判为元叙述', () => {
        const out = analyzeBodyFormat('　　好的剑客从不解释。', DEFAULT_BODY_FORMAT);
        expect(out.metaStripped).toBe(0);
    });
});
