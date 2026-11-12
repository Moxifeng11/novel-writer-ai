/**
 * 证据定位单测（S2）
 *
 * 定位失败必须返回 null（降级为「只展示引文」），**不能猜位置**——
 * 猜错位置会让用户点开跳到错误段落，比不跳更糟。
 */

import { describe, expect, it } from 'vitest';
import { locateQuote, quoteContext } from '../../../../engine/consistency/evidence-locate';

const BODY = '天刚蒙蒙亮，张三推开院门。院子里落了一层薄霜，他裹紧衣领，朝青云城的方向走去。';

describe('locateQuote · 精确匹配', () => {
    it('子串命中并返回偏移', () => {
        const hit = locateQuote(BODY, '张三推开院门');
        expect(hit).not.toBeNull();
        expect(BODY.slice(hit!.offset, hit!.offset + hit!.matched.length)).toBe('张三推开院门');
    });

    it('开头命中偏移为 0', () => {
        expect(locateQuote(BODY, '天刚蒙蒙亮')?.offset).toBe(0);
    });
});

describe('locateQuote · 空白差异', () => {
    it('正文有换行、引文没有 → 仍能定位', () => {
        const body = '张三推开\n院门。';
        const hit = locateQuote(body, '张三推开院门');
        expect(hit).not.toBeNull();
        expect(hit!.offset).toBe(0);
    });

    it('正文有空格、引文没有 → 仍能定位', () => {
        const body = '张三 推开 院门';
        expect(locateQuote(body, '张三推开院门')).not.toBeNull();
    });
});

describe('locateQuote · 前缀回退', () => {
    it('引文末尾被改写 → 用前缀命中', () => {
        const hit = locateQuote(BODY, '张三推开院门，院子里落了一层薄霜，他裹紧衣领，朝远方走去。');
        expect(hit).not.toBeNull();
        expect(hit!.offset).toBe(BODY.indexOf('张三推开院门'));
    });
});

describe('locateQuote · 找不到就返回 null（不猜）', () => {
    it('完全不存在的引文', () => {
        expect(locateQuote(BODY, '李四在酒楼喝酒')).toBeNull();
    });

    it('空引文 / 空正文', () => {
        expect(locateQuote(BODY, '')).toBeNull();
        expect(locateQuote('', '张三')).toBeNull();
        expect(locateQuote('   ', '   ')).toBeNull();
    });

    it('过短的前缀不回退（避免误命中）', () => {
        // 引文只有 3 个字且正文里没有 → 不应因为前缀短就乱匹配
        expect(locateQuote(BODY, '李四在')).toBeNull();
    });
});

describe('quoteContext · 展示用上下文', () => {
    it('命中时返回带前后文的片段', () => {
        const ctx = quoteContext(BODY, '推开院门', 5);
        expect(ctx).toContain('推开院门');
        expect(ctx.length).toBeGreaterThan('推开院门'.length);
    });

    it('未命中时退化为引文本身', () => {
        expect(quoteContext(BODY, '李四喝酒')).toBe('李四喝酒');
    });
});
