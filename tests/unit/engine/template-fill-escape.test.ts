/**
 * fillTemplate —— 模板变量替换（2026-11-28 修替换模式缺陷）
 *
 * 缺陷：原实现 `result.replace(re, value)` 里 `value` 走的是**字符串替换**语义，
 * `String.replace` 会解释 `$` 序列：
 *   `$&`  → 整个匹配
 *   `` $` `` → 匹配左边的文本
 *   `$'`  → 匹配右边的文本
 *   `$$`  → 一个字面 `$`
 *
 * 用户大纲、写作规则、正文里出现 `$&` 这类序列时（成本核算表格、正则示例、
 * 代码片段都可能出现），插入的内容会被悄悄改写。改用函数式替换后原样插入。
 */
import { describe, expect, it } from 'vitest';
import { fillTemplate } from '../../../engine/prompts/template-utils';

describe('fillTemplate 替换语义', () => {
    it('基础替换', () => {
        expect(fillTemplate('${a}与${b}', { a: '甲', b: '乙' })).toBe('甲与乙');
    });

    it('同名占位符全部替换', () => {
        expect(fillTemplate('${a}/${a}/${a}', { a: 'x' })).toBe('x/x/x');
    });

    it('缺失变量保持原样（由调用方兜底）', () => {
        expect(fillTemplate('${a}${b}', { a: '1' })).toBe('1${b}');
    });

    it('空字符串与 undefined 视为空', () => {
        expect(fillTemplate('[${a}]', { a: '' })).toBe('[]');
    });

    it('$& 必须原样插入，不能被解释成整个匹配', () => {
        // 缺陷复现：旧实现会输出 '${a}${a}'（$& = 整个匹配 '${a}'）
        expect(fillTemplate('${a}', { a: '$&' })).toBe('$&');
    });

    it('$\' 与 $` 必须原样插入', () => {
        expect(fillTemplate('前${a}后', { a: "$'" })).toBe("前$'后");
        expect(fillTemplate('前${a}后', { a: '$`' })).toBe('前$`后');
    });

    it('$$ 必须原样插入（不折叠成单个 $）', () => {
        expect(fillTemplate('${a}', { a: '$$' })).toBe('$$');
    });

    it('含正则特殊字符的变量值不影响替换', () => {
        const value = '价格 $& 与 $1 与 \\d+ 与 a.b*c';
        expect(fillTemplate('${a}', { a: value })).toBe(value);
    });
});
