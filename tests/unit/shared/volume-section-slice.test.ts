import { describe, expect, it } from 'vitest';
import { volumeSectionSlice } from '../../../shared/format-constants';

const outline = [
    '### 第1卷',
    '### 第3章 测脉',
    '本章任务：复测',
    '### 第2卷',
    '### 第3章 重逢',
    '本章任务：与旧敌重逢',
].join('\n');

describe('format-constants — 分卷大纲卷内切片', () => {
    it('同号章只命中当前卷的段落', () => {
        const slice = volumeSectionSlice(outline, '第1卷');
        expect(slice).toContain('复测');
        expect(slice).not.toContain('重逢');
        expect(slice.match(/第3章/g)?.length).toBe(1);
    });

    it('卷名不存在时返回全文（行为不变）', () => {
        expect(volumeSectionSlice(outline, '第9卷')).toBe(outline);
    });

    it('未传卷名时返回全文', () => {
        expect(volumeSectionSlice(outline, undefined)).toBe(outline);
    });
});
