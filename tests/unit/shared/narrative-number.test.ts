/**
 * narrative-number 单测：中文数量与时间表达式的归一化
 *
 * 这一层错了，后面的「数量不符 / 时长矛盾」全部误报或漏报，
 * 所以边界（中文数词、单位、半、近似容差）必须逐条钉死。
 */

import { describe, expect, it } from 'vitest';
import {
    durationsAreCompatible,
    numbersAreCompatible,
    parseDuration,
    parseNarrativeNumber,
    parseQuantity,
} from '../../../shared/narrative-number';

describe('parseNarrativeNumber · 中文数词', () => {
    it('阿拉伯数字直接返回', () => {
        expect(parseNarrativeNumber('18')).toBe(18);
        expect(parseNarrativeNumber('3.5')).toBe(3.5);
    });

    it('个位数与「两」', () => {
        expect(parseNarrativeNumber('三')).toBe(3);
        expect(parseNarrativeNumber('两')).toBe(2);
        expect(parseNarrativeNumber('九')).toBe(9);
    });

    it('十位组合', () => {
        expect(parseNarrativeNumber('十二')).toBe(12);
        expect(parseNarrativeNumber('二十')).toBe(20);
        expect(parseNarrativeNumber('二十三')).toBe(23);
    });

    it('百位与零位', () => {
        expect(parseNarrativeNumber('一百')).toBe(100);
        expect(parseNarrativeNumber('一百零五')).toBe(105);
        expect(parseNarrativeNumber('两百三十')).toBe(230);
    });

    it('万与亿', () => {
        expect(parseNarrativeNumber('三万')).toBe(30000);
        expect(parseNarrativeNumber('五万')).toBe(50000);
        expect(parseNarrativeNumber('一亿')).toBe(100000000);
    });

    it('阿拉伯 + 万', () => {
        expect(parseNarrativeNumber('3万')).toBe(30000);
        expect(parseNarrativeNumber('1.5万')).toBe(15000);
    });

    it('无法解析返回 null（不猜）', () => {
        expect(parseNarrativeNumber('一堆')).toBeNull();
        expect(parseNarrativeNumber('十几个')).toBeNull();
        expect(parseNarrativeNumber('')).toBeNull();
        expect(parseNarrativeNumber('   ')).toBeNull();
    });
});

describe('parseQuantity · 数量 + 单位', () => {
    it('年龄', () => {
        expect(parseQuantity('十八岁')).toEqual({ value: 18, unit: '岁', raw: '十八岁' });
        expect(parseQuantity('今年30岁')).toEqual({ value: 30, unit: '岁', raw: '30岁' });
    });

    it('距离', () => {
        expect(parseQuantity('三百里')).toEqual({ value: 300, unit: '里', raw: '三百里' });
        expect(parseQuantity('三丈')).toEqual({ value: 3, unit: '丈', raw: '三丈' });
    });

    it('金额（万级）', () => {
        expect(parseQuantity('五万金币')?.value).toBe(50000);
        expect(parseQuantity('五万金币')?.unit).toBe('金币');
    });

    it('计数', () => {
        expect(parseQuantity('十二名')?.value).toBe(12);
        // 量词「个」会被当作单位，数值仍应正确解析
        expect(parseQuantity('三十个人')?.value).toBe(30);
        expect(parseQuantity('三十个人')?.unit).toBe('个');
    });

    it('无单位返回 null', () => {
        expect(parseQuantity('十八')).toBeNull();
        expect(parseQuantity('走过')).toBeNull();
    });
});

describe('parseDuration · 时间跨度', () => {
    it('日/天', () => {
        expect(parseDuration('三日')?.minutes).toBe(3 * 24 * 60);
        expect(parseDuration('三天')?.minutes).toBe(3 * 24 * 60);
    });

    it('月/年', () => {
        expect(parseDuration('三个月')?.minutes).toBe(3 * 30 * 24 * 60);
        expect(parseDuration('两年')?.minutes).toBe(2 * 365 * 24 * 60);
    });

    it('时辰与半', () => {
        expect(parseDuration('一个时辰')?.minutes).toBe(120);
        expect(parseDuration('半个时辰')?.minutes).toBe(60);
    });

    it('无数词的默认一', () => {
        expect(parseDuration('时辰')?.minutes).toBe(120);
    });

    it('无时间词返回 null', () => {
        expect(parseDuration('他走了')).toBeNull();
    });
});

describe('容差比较', () => {
    it('时长同量级：三日 vs 三天 等价', () => {
        const a = parseDuration('三日')!.minutes;
        const b = parseDuration('三天')!.minutes;
        expect(durationsAreCompatible(a, b)).toBe(true);
    });

    it('时长跨量级：三日 vs 两个月 不相容', () => {
        const a = parseDuration('三日')!.minutes;
        const b = parseDuration('两个月')!.minutes;
        expect(durationsAreCompatible(a, b)).toBe(false);
    });

    it('时长为 0 或负数不算相容（避免除零）', () => {
        expect(durationsAreCompatible(0, 100)).toBe(false);
        expect(durationsAreCompatible(-1, 100)).toBe(false);
    });

    it('数值近似：18 vs 18 相等，18 vs 30 不等', () => {
        expect(numbersAreCompatible(18, 18)).toBe(true);
        expect(numbersAreCompatible(18, 30)).toBe(false);
    });

    it('数值近似允许取整误差（1000 vs 1001）', () => {
        expect(numbersAreCompatible(1000, 1001)).toBe(true);
    });

    it('0 与 0 视为相等', () => {
        expect(numbersAreCompatible(0, 0)).toBe(true);
    });
});
