/**
 * book-detail-metrics 单测（v4.83.0 UI 可测性治理）
 *
 * `ui/views/book-detail-renderer.ts` 原本 2,247 行、覆盖率 0.1%、无任何测试。
 * 本文件锁定从中抽出的纯数据准备规则：归一化、组装、筛选、排序、查表。
 * 这些函数不碰 DOM，因此能直接断言「显示成什么值」而不是「点了会怎样」。
 */

import { describe, expect, it } from 'vitest';
import type { StyleData, StructureData, ForeshadowData, TechniqueData } from '../../../ui/views/knowledge-base-view';
import {
    SENTENCE_LENGTH_SCALE,
    PARAGRAPH_LENGTH_SCALE,
    TECHNIQUE_TOP_LIMIT,
    WORD_CLOUD_LIMIT,
    normalizeToPercent,
    normalizeSentenceLength,
    normalizeParagraphLength,
    buildStyleRadarItems,
    buildRhetoricBarData,
    buildWordCloudItems,
    buildTimelineEvents,
    filterForeshadows,
    rankTechniquesTop,
    buildTechniqueBarData,
    resolveTierLabel,
    resolveArcTypeLabel,
    resolveTimelineIcon,
    joinRoleParts,
    resolveChannelLabel,
    buildForeshadowStatItems,
    buildTechniqueQualityItems,
} from '../../../ui/views/book-detail-metrics';

/** 构造只含所需字段的风格数据（类型上其余字段可选） */
function styleData(partial: Record<string, unknown>): StyleData {
    return partial as unknown as StyleData;
}

describe('normalizeToPercent — 归一化边界', () => {
    it('按基准换算并截断上界', () => {
        expect(normalizeToPercent(25, 50)).toBe(50);
        expect(normalizeToPercent(50, 50)).toBe(100);
        expect(normalizeToPercent(0, 50)).toBe(0);
        expect(normalizeToPercent(999, 50)).toBe(100);
    });

    it('undefined / NaN / Infinity 记 0（不让 NaN 传进图表）', () => {
        expect(normalizeToPercent(undefined, 50)).toBe(0);
        expect(normalizeToPercent(Number.NaN, 50)).toBe(0);
        expect(normalizeToPercent(Number.POSITIVE_INFINITY, 50)).toBe(0);
    });

    it('基准非法（0 / 负数 / NaN）时记 0，不做除零', () => {
        expect(normalizeToPercent(10, 0)).toBe(0);
        expect(normalizeToPercent(10, -5)).toBe(0);
        expect(normalizeToPercent(10, Number.NaN)).toBe(0);
    });

    it('默认基准常量与雷达图口径一致', () => {
        expect(SENTENCE_LENGTH_SCALE).toBe(50);
        expect(PARAGRAPH_LENGTH_SCALE).toBe(200);
        expect(normalizeSentenceLength(25)).toBe(50);
        expect(normalizeParagraphLength(100)).toBe(50);
    });
});

describe('buildStyleRadarItems — 雷达图数据', () => {
    it('空数据返回空数组', () => {
        expect(buildStyleRadarItems(null)).toEqual([]);
        expect(buildStyleRadarItems(undefined)).toEqual([]);
        expect(buildStyleRadarItems(styleData({}))).toEqual([]);
    });

    it('只收录存在的维度，顺序固定', () => {
        const items = buildStyleRadarItems(styleData({
            sentenceRhythm: { avgSentenceLength: 25 },
            narrativeStyle: { dialogueRatio: 0.4, descriptionRatio: { total: 0.3 } },
            wordPreference: { colloquialismLevel: 0.5, idiomDensity: 12 },
        }));
        expect(items.map(i => i.label)).toEqual(['平均句长', '平均段长', '对白占比', '描写占比', '口语化程度', '成语密度']
            .filter(l => items.some(i => i.label === l)));
        expect(items[0]).toEqual({ label: '平均句长', value: 50 });
        expect(items.find(i => i.label === '对白占比')?.value).toBeCloseTo(40);
        expect(items.find(i => i.label === '成语密度')?.value).toBe(12);
    });

    it('成语密度按 100 截断（与原实现等价）', () => {
        const items = buildStyleRadarItems(styleData({ wordPreference: { idiomDensity: 250 } }));
        expect(items.find(i => i.label === '成语密度')?.value).toBe(100);
    });

    it('不足 3 维时调用方不渲染（数组长度可小于 3）', () => {
        const items = buildStyleRadarItems(styleData({ sentenceRhythm: { avgSentenceLength: 10 } }));
        expect(items).toHaveLength(1);
    });
});

describe('buildRhetoricBarData — 修辞柱状图', () => {
    it('为空返回空数组', () => {
        expect(buildRhetoricBarData(undefined)).toEqual([]);
    });

    it('顺序固定且逐项映射', () => {
        const data = buildRhetoricBarData({
            metaphor: 1, personification: 2, parallelism: 3,
            rhetoricalQuestion: 4, hyperbole: 5, antithesis: 6, total: 21, perThousand: 7,
        });
        expect(data.map(d => d.label)).toEqual(['比喻', '拟人', '排比', '反问', '夸张', '对偶']);
        expect(data.map(d => d.value)).toEqual([1, 2, 3, 4, 5, 6]);
    });
});

describe('buildWordCloudItems — 词云取样', () => {
    it('为空返回空数组', () => {
        expect(buildWordCloudItems(undefined)).toEqual([]);
        expect(buildWordCloudItems([])).toEqual([]);
    });

    it('默认截取 30 条并映射 word→text / count→weight', () => {
        const words = Array.from({ length: 40 }, (_, i) => ({ word: `w${i}`, count: 40 - i }));
        const items = buildWordCloudItems(words);
        expect(items).toHaveLength(WORD_CLOUD_LIMIT);
        expect(items[0]).toEqual({ text: 'w0', weight: 40 });
    });

    it('可自定义上限', () => {
        const words = Array.from({ length: 5 }, (_, i) => ({ word: `w${i}`, count: i }));
        expect(buildWordCloudItems(words, 2)).toHaveLength(2);
    });
});

describe('buildTimelineEvents — 起承转合时间轴', () => {
    it('为空返回空数组', () => {
        expect(buildTimelineEvents(undefined)).toEqual([]);
        expect(buildTimelineEvents([])).toEqual([]);
    });

    it('逐段映射，level 固定 0', () => {
        const segments = [{ type: '起', startPosition: 0, endPosition: 0.25, chapterRange: [1, 3] }] as StructureData['qcchSegments'];
        expect(buildTimelineEvents(segments)).toEqual([
            { position: 0, label: '起', description: '起', type: '起', level: 0 },
        ]);
    });
});

describe('filterForeshadows — 伏笔筛选', () => {
    const items = [
        { hasResolution: true, name: 'a' },
        { hasResolution: false, name: 'b' },
        { hasResolution: true, name: 'c' },
    ];

    it('all 返回全部且不改原数组', () => {
        const out = filterForeshadows(items, 'all');
        expect(out).toHaveLength(3);
        expect(out).not.toBe(items);
    });

    it('resolved 只保留已回收', () => {
        expect(filterForeshadows(items, 'resolved').map(i => i.name)).toEqual(['a', 'c']);
    });

    it('unresolved 及其它值都按未回收处理', () => {
        expect(filterForeshadows(items, 'unresolved').map(i => i.name)).toEqual(['b']);
        expect(filterForeshadows(items, 'whatever').map(i => i.name)).toEqual(['b']);
    });

    it('空输入返回空数组', () => {
        expect(filterForeshadows(undefined, 'all')).toEqual([]);
        expect(filterForeshadows([], 'resolved')).toEqual([]);
    });
});

describe('rankTechniquesTop — 技巧排行', () => {
    it('按 count 降序并默认取 10 条', () => {
        const list = Array.from({ length: 15 }, (_, i) => ({ name: `t${i}`, count: i }));
        const top = rankTechniquesTop(list);
        expect(top).toHaveLength(TECHNIQUE_TOP_LIMIT);
        expect(top[0].count).toBe(14);
        expect(top[9].count).toBe(5);
    });

    it('不改原数组', () => {
        const list = [{ name: 'a', count: 1 }, { name: 'b', count: 9 }];
        const snapshot = list.map(i => i.name);
        rankTechniquesTop(list);
        expect(list.map(i => i.name)).toEqual(snapshot);
        expect(list[0].name).toBe('a');
    });

    it('空输入返回空数组', () => {
        expect(rankTechniquesTop(undefined)).toEqual([]);
        expect(rankTechniquesTop([])).toEqual([]);
    });

    it('转化为柱状图数据', () => {
        const bars = buildTechniqueBarData([{ name: '比喻', count: 3 }, { name: '排比', count: 7 }]);
        expect(bars).toEqual([{ label: '排比', value: 7 }, { label: '比喻', value: 3 }]);
    });
});

describe('查表映射 — 角色层级 / 弧线 / 时间线 / 频道', () => {
    it('层级标签覆盖五种角色且未知值原样返回', () => {
        expect(resolveTierLabel('protagonist')).toBe('主角');
        expect(resolveTierLabel('core_supporting')).toBe('核心配角');
        expect(resolveTierLabel('important_supporting')).toBe('重要配角');
        expect(resolveTierLabel('minor_supporting')).toBe('次要配角');
        expect(resolveTierLabel('extra')).toBe('路人角色');
        expect(resolveTierLabel('unknown_tier')).toBe('unknown_tier');
        expect(resolveTierLabel(undefined)).toBe('路人角色');
    });

    it('弧线类型标签与未知回落', () => {
        expect(resolveArcTypeLabel('growth')).toBe('成长型');
        expect(resolveArcTypeLabel('darkening')).toBe('黑化型');
        expect(resolveArcTypeLabel('custom')).toBe('custom');
    });

    it('时间线图标与未知回落为圆点', () => {
        expect(resolveTimelineIcon('appearance')).toBe('👤');
        expect(resolveTimelineIcon('turning_point')).toBe('⚡');
        expect(resolveTimelineIcon('unknown')).toBe('•');
    });

    it('频道标签与未知回落', () => {
        expect(resolveChannelLabel('male')).toBe('男频');
        expect(resolveChannelLabel('female')).toBe('女频');
        expect(resolveChannelLabel('other')).toBe('综合');
        expect(resolveChannelLabel('x')).toBe('x');
        expect(resolveChannelLabel(undefined)).toBe('');
    });
});

describe('joinRoleParts — 角色描述拼接', () => {
    it('丢弃空值并用 · 连接', () => {
        expect(joinRoleParts(['剑客', undefined, '主角'])).toBe('剑客 · 主角');
        expect(joinRoleParts(['', null, false, '唯一'])).toBe('唯一');
    });

    it('全空返回空串', () => {
        expect(joinRoleParts([])).toBe('');
        expect(joinRoleParts([undefined, null])).toBe('');
    });
});

describe('评分项组装 — 伏笔统计 / 技巧质量', () => {
    it('伏笔统计逐项映射', () => {
        const stats: ForeshadowData['stats'] = {
            totalForeshadows: 10, resolvedCount: 4, unresolvedCount: 6, avgImportance: 3.5,
        };
        expect(buildForeshadowStatItems(stats)).toEqual([
            { label: '伏笔总数', value: 10 },
            { label: '已回收', value: 4 },
            { label: '未回收', value: 6 },
            { label: '平均重要性', value: 3.5 },
        ]);
        expect(buildForeshadowStatItems(undefined)).toEqual([]);
    });

    it('技巧质量逐项映射', () => {
        const qs: TechniqueData['qualityScore'] = { totalScore: 80, diversityScore: 70, coverageScore: 60 };
        expect(buildTechniqueQualityItems(qs)).toEqual([
            { label: '总分', value: 80 },
            { label: '多样性', value: 70 },
            { label: '覆盖度', value: 60 },
        ]);
        expect(buildTechniqueQualityItems(undefined)).toEqual([]);
    });
});
