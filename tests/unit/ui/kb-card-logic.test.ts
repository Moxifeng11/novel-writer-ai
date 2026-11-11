/**
 * kb-card-logic 单测（v4.83.0 UI 可测性治理）
 *
 * `kb-book-card.ts`（147 行）与 `kb-config-panel.ts`（221 行）原本覆盖率 0%。
 * 本文件锁定卡片上的判定与预览取样规则：状态配色档位、警示条显隐、进度条条件、
 * 标签最多显示几条、溢出计数、自定义题材判定。
 */

import { describe, expect, it } from 'vitest';
import type { ClassificationResult, ClassificationTag } from '../../../shared/content-classifier';
import type { GenreConfig } from '../../../shared/webnovel-knowledge-base';
import {
    KB_CONFIG_CATEGORIES,
    KB_GENRE_STAT_LABELS,
    CLASSIFICATION_PREVIEW_LIMIT,
    CUSTOM_TAG_PREVIEW_LIMIT,
    SUB_GENRE_PREVIEW_LIMIT,
    resolveBookStatusTone,
    shouldShowVectorWarning,
    resolveVectorWarningTitle,
    shouldShowBreakdownProgress,
    formatBreakdownProgressLabel,
    selectClassificationPreview,
    formatClassificationTagTitle,
    selectCustomTagPreview,
    formatQualityBadge,
    formatAuthorName,
    isCustomGenre,
    buildGenreStatItems,
    selectSubGenrePreview,
    formatSubGenreSectionTitle,
} from '../../../ui/views/kb-card-logic';

/** 构造分类标签 */
function tag(label: string, dimension = '节奏', reason = '测试', confidence = 0.876): ClassificationTag {
    return { label, dimension, reason, confidence } as ClassificationTag;
}

/** 构造分类结果 */
function classification(tags: ClassificationTag[]): ClassificationResult {
    return { primary: '主分类', summary: '摘要', tags };
}

/** 构造题材（只填所需字段） */
function genre(partial: Partial<GenreConfig> = {}): GenreConfig {
    return {
        id: 'g1',
        name: '题材',
        category: 'male',
        description: '描述',
        personalityTags: [],
        abilityTypes: [],
        roleTypes: [],
        backgroundTypes: [],
        techniques: [],
        weights: { character: 1, foreshadow: 1, technique: 1, style: 1, rhythm: 1, structure: 1 },
        ...partial,
    } as GenreConfig;
}

describe('resolveBookStatusTone — 状态配色档位', () => {
    it('五种已知状态各归其档', () => {
        expect(resolveBookStatusTone('completed')).toBe('success');
        expect(resolveBookStatusTone('processing')).toBe('info');
        expect(resolveBookStatusTone('failed')).toBe('danger');
        expect(resolveBookStatusTone('interrupted')).toBe('warning');
        expect(resolveBookStatusTone('pending')).toBe('muted');
    });

    it('未知状态与缺省回落到 muted（不会视觉缺失）', () => {
        expect(resolveBookStatusTone('brand-new-status')).toBe('muted');
        expect(resolveBookStatusTone(undefined)).toBe('muted');
    });
});

describe('向量化失败警示', () => {
    it('只有 failed 才展示', () => {
        expect(shouldShowVectorWarning({ vectorStatus: 'failed' })).toBe(true);
        expect(shouldShowVectorWarning({ vectorStatus: 'done' })).toBe(false);
        expect(shouldShowVectorWarning({})).toBe(false);
        expect(shouldShowVectorWarning(undefined)).toBe(false);
    });

    it('有错误详情时优先展示详情，否则给兜底指引', () => {
        expect(resolveVectorWarningTitle({ vectorError: '嵌入服务 401' })).toBe('嵌入服务 401');
        expect(resolveVectorWarningTitle({})).toContain('重试向量化');
    });
});

describe('拆解进度条', () => {
    it('仅拆解中且进度已知时展示', () => {
        expect(shouldShowBreakdownProgress({ breakdownStatus: 'processing', breakdownProgress: 42 })).toBe(true);
        expect(shouldShowBreakdownProgress({ breakdownStatus: 'processing', breakdownProgress: 0 })).toBe(true);
        expect(shouldShowBreakdownProgress({ breakdownStatus: 'processing' })).toBe(false);
        expect(shouldShowBreakdownProgress({ breakdownStatus: 'completed', breakdownProgress: 100 })).toBe(false);
        expect(shouldShowBreakdownProgress(undefined)).toBe(false);
    });

    it('文案带百分比，进度缺失时为纯文字', () => {
        expect(formatBreakdownProgressLabel({ breakdownProgress: 42 })).toBe('拆解中 42%');
        expect(formatBreakdownProgressLabel({ breakdownProgress: 0 })).toBe('拆解中 0%');
        expect(formatBreakdownProgressLabel({})).toBe('拆解中');
    });
});

describe('selectClassificationPreview — 分类标签预览', () => {
    it('默认最多 3 条', () => {
        const tags = [tag('a'), tag('b'), tag('c'), tag('d')];
        expect(selectClassificationPreview(classification(tags))).toHaveLength(CLASSIFICATION_PREVIEW_LIMIT);
        expect(selectClassificationPreview(classification(tags)).map(t => t.label)).toEqual(['a', 'b', 'c']);
    });

    it('空分类返回空数组', () => {
        expect(selectClassificationPreview(null)).toEqual([]);
        expect(selectClassificationPreview(undefined)).toEqual([]);
        expect(selectClassificationPreview(classification([]))).toEqual([]);
    });

    it('可自定义上限', () => {
        expect(selectClassificationPreview(classification([tag('a'), tag('b')]), 1)).toHaveLength(1);
    });
});

describe('formatClassificationTagTitle — 置信度取整', () => {
    it('拼出维度 · 理由（置信度 n%）', () => {
        expect(formatClassificationTagTitle(tag('x', '情绪', '情绪浓度高', 0.876)))
            .toBe('情绪 · 情绪浓度高（置信度 88%）');
    });

    it('小数不出现长串（四舍五入到整数）', () => {
        expect(formatClassificationTagTitle(tag('x', '结构', 'r', 0.333333)))
            .toBe('结构 · r（置信度 33%）');
        expect(formatClassificationTagTitle(tag('x', '结构', 'r', 1))).toBe('结构 · r（置信度 100%）');
    });
});

describe('selectCustomTagPreview — 自定义标签预览', () => {
    const isClassification = (t: string): boolean => t.startsWith('分类:');

    it('过滤自动分类标签并最多取 2 条', () => {
        const tags = ['爽文', '分类:节奏', '逆袭', '停更'];
        expect(selectCustomTagPreview(tags, isClassification)).toEqual(['爽文', '逆袭']);
        expect(selectCustomTagPreview(tags, isClassification)).toHaveLength(CUSTOM_TAG_PREVIEW_LIMIT);
    });

    it('空输入返回空数组', () => {
        expect(selectCustomTagPreview(undefined, isClassification)).toEqual([]);
        expect(selectCustomTagPreview([], isClassification)).toEqual([]);
    });

    it('全部是分类标签时返回空', () => {
        expect(selectCustomTagPreview(['分类:a', '分类:b'], isClassification)).toEqual([]);
    });
});

describe('formatQualityBadge — 质量分展示', () => {
    it('有分数时取整带星', () => {
        expect(formatQualityBadge({ overall: 82 })).toBe('⭐ 82分');
        expect(formatQualityBadge({ overall: 82.6 })).toBe('⭐ 83分');
    });

    it('无分数 / 非法数值返回 null（调用方据此渲染空占位）', () => {
        expect(formatQualityBadge(null)).toBeNull();
        expect(formatQualityBadge(undefined)).toBeNull();
        expect(formatQualityBadge({ overall: Number.NaN })).toBeNull();
        expect(formatQualityBadge({ overall: Number.POSITIVE_INFINITY })).toBeNull();
    });
});

describe('formatAuthorName — 作者兜底', () => {
    it('空/空白作者回落未知作者', () => {
        expect(formatAuthorName('南柯')).toBe('南柯');
        expect(formatAuthorName('')).toBe('未知作者');
        expect(formatAuthorName('   ')).toBe('未知作者');
        expect(formatAuthorName(undefined)).toBe('未知作者');
    });
});

describe('isCustomGenre — 自定义题材判定', () => {
    it('本地标记或知识库判定任一为真即自定义', () => {
        expect(isCustomGenre(genre({ isCustom: true }))).toBe(true);
        expect(isCustomGenre(genre({ isCustom: false }), () => true)).toBe(true);
        expect(isCustomGenre(genre({}), () => false)).toBe(false);
        expect(isCustomGenre(genre({}))).toBe(false);
    });
});

describe('buildGenreStatItems — 题材统计行', () => {
    it('三项顺序与数值映射', () => {
        const items = buildGenreStatItems(genre({
            personalityTags: ['a', 'b'],
            abilityTypes: ['x'],
            techniques: [{}, {}, {}] as GenreConfig['techniques'],
        }));
        expect(items.map(i => i.label)).toEqual([...KB_GENRE_STAT_LABELS]);
        expect(items.map(i => i.value)).toEqual([2, 1, 3]);
    });
});

describe('selectSubGenrePreview — 细分题材预览与溢出', () => {
    const subs = Array.from({ length: 8 }, (_, i) => ({ id: `s${i}`, name: `细分${i}` }));

    it('超过 5 条时截断并给出 overflow', () => {
        const preview = selectSubGenrePreview(subs as never);
        expect(preview.shown).toHaveLength(SUB_GENRE_PREVIEW_LIMIT);
        expect(preview.overflow).toBe(8 - SUB_GENRE_PREVIEW_LIMIT);
    });

    it('不足上限时 overflow 为 0', () => {
        const preview = selectSubGenrePreview(subs.slice(0, 3) as never);
        expect(preview.shown).toHaveLength(3);
        expect(preview.overflow).toBe(0);
    });

    it('空输入返回空预览', () => {
        expect(selectSubGenrePreview(undefined)).toEqual({ shown: [], overflow: 0 });
        expect(selectSubGenrePreview([])).toEqual({ shown: [], overflow: 0 });
    });
});

describe('固定清单与文案', () => {
    it('频道分类三项顺序与图标固定', () => {
        expect(KB_CONFIG_CATEGORIES.map(c => c.key)).toEqual(['male', 'female', 'neutral']);
        expect(KB_CONFIG_CATEGORIES.map(c => c.label)).toEqual(['男频', '女频', '中性']);
    });

    it('细分题材区块标题带总数', () => {
        expect(formatSubGenreSectionTitle(7)).toBe('细分题材 (7)');
        expect(formatSubGenreSectionTitle(0)).toBe('细分题材 (0)');
    });
});
