import { describe, it, expect } from 'vitest';
import { parseVolumeOutline, countChapters } from '../../../ui/plot-canvas-parser';

describe('plot-canvas-parser — parseVolumeOutline', () => {
    it('解析卷标题 + 卷名 + 章节表格', () => {
        const lines = [
            '### 第1卷',
            '- **卷名**：起点',
            '| 章号 | 冲突 |',
            '| ---- | ---- |',
            '| 1 | 主角觉醒 |',
            '| 2 | 初遇反派 |',
        ];
        const volumes = parseVolumeOutline(lines, 0);
        expect(volumes.length).toBe(1);
        expect(volumes[0].volNum).toBe(1);
        expect(volumes[0].volName).toBe('起点');
        expect(volumes[0].chapters.length).toBe(2);
        expect(volumes[0].chapters[0].chapNum).toBe(1);
        expect(volumes[0].chapters[0].conflict).toBe('主角觉醒');
    });

    it('解析多卷', () => {
        const lines = [
            '### 第1卷',
            '- **卷名**：第一卷',
            '| 章号 | 冲突 |',
            '| ---- | ---- |',
            '| 1 | 第一章 |',
            '### 第2卷',
            '- **卷名**：第二卷',
            '| 章号 | 冲突 |',
            '| ---- | ---- |',
            '| 2 | 第二章 |',
        ];
        const volumes = parseVolumeOutline(lines, 0);
        expect(volumes.length).toBe(2);
        expect(volumes[1].volNum).toBe(2);
        expect(volumes[1].volName).toBe('第二卷');
        expect(volumes[1].chapters.length).toBe(1);
    });

    it('空输入返回空数组', () => {
        expect(parseVolumeOutline([], 0)).toEqual([]);
        expect(parseVolumeOutline(['一些无关内容'], 0)).toEqual([]);
    });

    it('无章节表格的卷仍被解析（空卷）', () => {
        const lines = ['### 第1卷', '- **卷名**：空卷'];
        const volumes = parseVolumeOutline(lines, 0);
        expect(volumes.length).toBe(1);
        expect(volumes[0].volName).toBe('空卷');
        expect(volumes[0].chapters.length).toBe(0);
    });

    it('rowLine 与 sourceIdx 正确记录', () => {
        const lines = [
            '### 第1卷',
            '| 章号 | 冲突 |',
            '| ---- | ---- |',
            '| 1 | 第一章 |',
        ];
        const volumes = parseVolumeOutline(lines, 3);
        expect(volumes[0].chapters[0].rowLine).toBe(3);
        expect(volumes[0].chapters[0].sourceIdx).toBe(3);
    });

    it('表格结束后的非表格行不再解析为章节', () => {
        const lines = [
            '### 第1卷',
            '| 章号 | 冲突 |',
            '| ---- | ---- |',
            '| 1 | 第一章 |',
            '',
            '这是表格外的说明文字',
            '| 99 | 不应被解析 |',
        ];
        const volumes = parseVolumeOutline(lines, 0);
        expect(volumes[0].chapters.length).toBe(1);
    });
});

describe('plot-canvas-parser — countChapters', () => {
    it('统计章节总数', () => {
        const volumes = parseVolumeOutline([
            '### 第1卷',
            '| 章号 | 冲突 |',
            '| ---- | ---- |',
            '| 1 | a |',
            '| 2 | b |',
        ], 0);
        expect(countChapters(volumes)).toBe(2);
    });

    it('空卷列表返回 0', () => {
        expect(countChapters([])).toBe(0);
    });
});
