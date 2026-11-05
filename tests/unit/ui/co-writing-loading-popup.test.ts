import { describe, it, expect } from 'vitest';
import { formatLocalProgressText } from '../../../ui/co-writing/suggestion-loading';
import { computePopupPosition } from '../../../ui/co-writing/quality-popup';

/**
 * 生成进度文案与质量浮窗定位的纯计算。
 * 浮窗必须留在视口内，否则右下角的问题详情会跑到屏幕外。
 */
describe('co-writing suggestion-loading 文案', () => {
    it('本地串行生成显示第 N/M 条', () => {
        expect(formatLocalProgressText(2, 3)).toBe('正在生成第 2/3 条建议…');
    });
});

describe('co-writing quality-popup 定位', () => {
    it('常规位置向右下偏移 10px', () => {
        expect(computePopupPosition(100, 100, 800, 600)).toEqual({ left: 110, top: 90 });
    });

    it('靠近右下角时夹到视口内', () => {
        expect(computePopupPosition(900, 700, 800, 600)).toEqual({ left: 480, top: 400 });
    });
});
