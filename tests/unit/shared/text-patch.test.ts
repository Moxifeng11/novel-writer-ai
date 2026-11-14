/**
 * text-patch 单测（通用局部替换）
 */

import { describe, expect, it } from 'vitest';
import { applyTextPatch, validateTextPatch } from '@/shared/text-patch';

describe('applyTextPatch', () => {
    it('唯一匹配被替换', () => {
        const result = applyTextPatch('A\n旧句子\nB', '旧句子', '新句子');
        expect(result.changed).toBe(true);
        expect(result.content).toBe('A\n新句子\nB');
    });

    it('newText 为空即删除该段', () => {
        expect(applyTextPatch('A\n删掉\nB', '删掉\n', '').content).toBe('A\nB');
    });

    it('找不到原文 → 报错', () => {
        const result = applyTextPatch('原文', '不存在', 'x');
        expect(result.changed).toBe(false);
        expect(result.error).toContain('找不到');
    });

    it('多处匹配 → 拒绝并要求更长上下文', () => {
        const result = applyTextPatch('同\n同', '同', 'x');
        expect(result.changed).toBe(false);
        expect(result.error).toContain('多次');
    });

    it('新旧相同 → 不产生变更', () => {
        const result = applyTextPatch('abc', 'abc', 'abc');
        expect(result.changed).toBe(false);
        expect(result.content).toBe('abc');
    });

    it('空 oldText → 报错', () => {
        expect(applyTextPatch('a', '', 'b').error).toContain('不能为空');
    });
});

describe('validateTextPatch', () => {
    it('合法通过', () => {
        expect(validateTextPatch({ oldText: 'a', newText: 'b' })).toBeNull();
    });

    it('空 oldText 拒绝', () => {
        expect(validateTextPatch({ oldText: ' ', newText: 'b' })).toContain('oldText');
    });

    it('newText 非字符串拒绝', () => {
        expect(validateTextPatch({ oldText: 'a', newText: 2 })).toContain('newText');
    });

    it('非对象拒绝', () => {
        expect(validateTextPatch(null)).toContain('对象');
    });
});
