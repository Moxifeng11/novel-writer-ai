import { describe, expect, it } from 'vitest';
import {
    buildQualityRadarData,
    buildQualityScoreRows,
    buildScoreBars,
    sortCharactersByImportance,
    sortSuggestionsBySeverity,
    sortTensionPoints,
    topCentralityBars,
} from '../../../ui/views/book-detail-logic';

/**
 * 书籍详情页数据整形回归（阶段 D2 / DSH-20261112-07）。
 *
 * 这些逻辑原先内联在 900+ 行渲染器里且零覆盖；抽出后锁住：
 * 8 维雷达（可选维度按 0）、N/A 行、排序稳定性、图表数据过滤与缩放。
 */

const qs = {
    character: 80,
    foreshadow: 70,
    technique: 60,
    style: 50,
    rhythm: 40,
    structure: 30,
    commercial: 20,
    readability: 10,
    overall: 55,
};

describe('buildQualityRadarData', () => {
    it('固定输出 8 维且顺序稳定', () => {
        const data = buildQualityRadarData(qs);
        expect(data.map(d => d.label)).toEqual(['人设', '伏笔', '技巧', '风格', '节奏', '结构', '商业', '可读']);
        expect(data.map(d => d.value)).toEqual([80, 70, 60, 50, 40, 30, 20, 10]);
    });

    it('商业/可读缺失时按 0 画（雷达图不允许 undefined）', () => {
        const data = buildQualityRadarData({ ...qs, commercial: undefined, readability: undefined });
        expect(data.find(d => d.label === '商业')?.value).toBe(0);
        expect(data.find(d => d.label === '可读')?.value).toBe(0);
    });
});

describe('buildQualityScoreRows', () => {
    it('后补维度标记 optional，缺失值保留 undefined（UI 显示 N/A）', () => {
        const rows = buildQualityScoreRows({ ...qs, commercial: undefined });
        const commercial = rows.find(r => r.name === '商业');
        expect(commercial).toEqual({ name: '商业', value: undefined, optional: true });
        expect(rows.filter(r => r.optional).map(r => r.name)).toEqual(['商业', '可读']);
    });
});

describe('sortCharactersByImportance', () => {
    it('按总分降序且不修改入参', () => {
        const list = [
            { name: 'A', importance: { totalScore: 10 } },
            { name: 'B', importance: { totalScore: 30 } },
            { name: 'C' },
        ];
        const sorted = sortCharactersByImportance(list);
        expect(sorted.map(c => c.name)).toEqual(['B', 'A', 'C']);
        expect(list.map(c => c.name)).toEqual(['A', 'B', 'C']);
    });

    it('同分保持原相对顺序（稳定排序）', () => {
        const list = [
            { name: 'A', importance: { totalScore: 5 } },
            { name: 'B', importance: { totalScore: 5 } },
        ];
        expect(sortCharactersByImportance(list).map(c => c.name)).toEqual(['A', 'B']);
    });
});

describe('topCentralityBars', () => {
    it('按 pagerank 降序并截断到 limit', () => {
        const bars = topCentralityBars([
            { characterName: '甲', pagerank: 0.1 },
            { characterName: '乙', pagerank: 0.9 },
            { characterName: '丙', pagerank: 0.5 },
        ], 2);
        expect(bars).toEqual([
            { label: '乙', value: 0.9 },
            { label: '丙', value: 0.5 },
        ]);
    });

    it('limit 为 0 返回空数组', () => {
        expect(topCentralityBars([{ characterName: '甲', pagerank: 1 }], 0)).toEqual([]);
    });
});

describe('sortSuggestionsBySeverity', () => {
    it('high → medium → low → 未知顺序', () => {
        const sorted = sortSuggestionsBySeverity([
            { severity: 'low', id: 1 },
            { severity: 'unknown', id: 2 },
            { severity: 'high', id: 3 },
            { severity: 'medium', id: 4 },
        ]);
        expect(sorted.map(s => s.id)).toEqual([3, 4, 1, 2]);
    });
});

describe('buildScoreBars', () => {
    it('过滤 undefined、乘以 scale、label 缺失回落 key', () => {
        const bars = buildScoreBars(
            { openingConflict: 0.8, infoDensity: undefined, unknownKey: 0.5 },
            { openingConflict: '开篇冲突' },
        );
        expect(bars).toEqual([
            { label: '开篇冲突', value: 80 },
            { label: 'unknownKey', value: 50 },
        ]);
    });

    it('null/undefined 输入返回空数组', () => {
        expect(buildScoreBars(null, {})).toEqual([]);
        expect(buildScoreBars(undefined, {})).toEqual([]);
    });
});

describe('sortTensionPoints', () => {
    it('峰谷合并后按章节序号升序', () => {
        const points = sortTensionPoints(
            [{ chapterIndex: 3, intensity: 0.9 }, { chapterIndex: 1, intensity: 0.8 }],
            [{ chapterIndex: 2, intensity: 0.2 }],
        );
        expect(points).toEqual([
            { label: 'C1', value: 0.8 },
            { label: 'C2', value: 0.2 },
            { label: 'C3', value: 0.9 },
        ]);
    });

    it('空输入返回空数组', () => {
        expect(sortTensionPoints([], [])).toEqual([]);
    });
});
