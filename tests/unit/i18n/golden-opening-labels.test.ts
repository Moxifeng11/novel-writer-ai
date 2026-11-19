/**
 * golden-opening-labels.test.ts — 黄金开篇工坊补漏双语（缺口⑦ 第二期第39片）
 *
 * 第39片只补 ZCode 迁移后的残留（`goldenOpening.*` 的 kNN 键之外）：
 * 四个插值标题/行、六个钩子类型、六处解析兜底词、三条 Notice、
 * 保存段的四处文案，以及十四个题材标签的展示名（存储值仍是中文原词）。
 */

import { afterEach, describe, expect, it } from 'vitest';
import { hasMessage, setLocale, translate } from '../../../i18n';

const CJK = /[\u4e00-\u9fff]/;

/** 补漏的 26 条语义键 */
const LABEL_KEYS = [
    'chapterTitle', 'unnamedChapter',
    'hookTypeSuspense', 'hookTypeQuestion', 'hookTypeTwist', 'hookTypeScene', 'hookTypeDialogue', 'hookTypeAction',
    'hookTypeFallback', 'strengthScore', 'hookCheckDone', 'unknown',
    'paraLabel', 'moderate', 'mediumPace',
    'charRole', 'charRelation', 'unnamed',
    'severityLine', 'priorityMedium', 'priorityLow',
    'scoringDone', 'exportIntro', 'exportSaveCurrent', 'savedTo', 'pathOccupied',
];

/** 题材标签：id 是资源键，zh 侧值与 GENRE_OPTIONS 逐字一致 */
const GENRE_KEYS = [
    'xuanhuan', 'xianxia', 'urban', 'scifi', 'mystery', 'history', 'romance',
    'fantasy', 'wuxia', 'apocalypse', 'supernatural', 'game', 'competitive', 'fanfic',
];

afterEach(() => {
    setLocale('zh-CN');
});

describe('第39片：资源覆盖（zh / en 同集）', () => {
    it('26 条语义键 + 14 条题材键在两种语言下都能解析，且不回落到键名', () => {
        const keys = [
            ...LABEL_KEYS.map(key => 'goldenOpening.labels.' + key),
            ...GENRE_KEYS.map(key => 'goldenOpening.labels.genre.' + key),
        ];
        for (const locale of ['zh-CN', 'en-US'] as const) {
            for (const key of keys) {
                expect(hasMessage(key), locale + ' 缺键 ' + key).toBe(true);
                const value = translate(locale, key);
                expect(value, locale + ' 回落到键名 ' + key).not.toBe(key);
                expect(value.trim().length, locale + ' 空值 ' + key).toBeGreaterThan(0);
            }
        }
    });

    it('en 下 40 条界面文案零中文', () => {
        const keys = [
            ...LABEL_KEYS.map(key => 'goldenOpening.labels.' + key),
            ...GENRE_KEYS.map(key => 'goldenOpening.labels.genre.' + key),
        ];
        for (const key of keys) {
            expect(translate('en-US', key), key).not.toMatch(CJK);
        }
    });
});

describe('第39片：zh 逐字（零回归）', () => {
    it('插值标题与行保持原样', () => {
        expect(translate('zh-CN', 'goldenOpening.labels.chapterTitle', { chapter: 2, title: '暗流' }))
            .toBe('第2章：暗流');
        expect(translate('zh-CN', 'goldenOpening.labels.strengthScore', { score: 8 })).toBe('8分');
        expect(translate('zh-CN', 'goldenOpening.labels.paraLabel', { index: 3 })).toBe('第3段');
        expect(translate('zh-CN', 'goldenOpening.labels.charRole', { role: '导师' })).toBe('角色：导师');
        expect(translate('zh-CN', 'goldenOpening.labels.charRelation', { relation: '师徒' }))
            .toBe('与主角关系：师徒');
        expect(translate('zh-CN', 'goldenOpening.labels.severityLine', { score: 7 })).toBe('严重程度：7/10');
        expect(translate('zh-CN', 'goldenOpening.labels.hookTypeFallback', { index: 7 })).toBe('类型7');
    });

    it('Notice 与保存段文案逐字一致', () => {
        expect(translate('zh-CN', 'goldenOpening.labels.hookCheckDone', { score: 6 }))
            .toBe('检测完成，综合评分: 6分');
        expect(translate('zh-CN', 'goldenOpening.labels.scoringDone', { score: 9 }))
            .toBe('综合评分完成：9分');
        expect(translate('zh-CN', 'goldenOpening.labels.savedTo', { path: '长篇小说/晨星外传/04-项目总控/黄金开篇.md' }))
            .toBe('已保存到「长篇小说/晨星外传/04-项目总控/黄金开篇.md」');
        expect(translate('zh-CN', 'goldenOpening.labels.pathOccupied', { path: 'a/b' }))
            .toBe('路径已被文件占用：a/b');
        expect(translate('zh-CN', 'goldenOpening.labels.exportSaveCurrent', { project: '晨星外传' }))
            .toBe('保存到当前项目「晨星外传」');
    });

    it('题材标签的 zh 值与 GENRE_OPTIONS 逐字一致（存储值依赖）', () => {
        const expected = ['玄幻', '仙侠', '都市', '科幻', '悬疑', '历史', '言情',
            '奇幻', '武侠', '末世', '灵异', '游戏', '竞技', '同人'];
        expect(GENRE_KEYS.map(key => translate('zh-CN', 'goldenOpening.labels.genre.' + key))).toEqual(expected);
    });

    it('en 插值真的落进去（不是原样占位符）', () => {
        expect(translate('en-US', 'goldenOpening.labels.chapterTitle', { chapter: 1, title: 'Dawn' }))
            .toBe('Chapter 1: Dawn');
        expect(translate('en-US', 'goldenOpening.labels.strengthScore', { score: 9 })).toBe('9 pts');
        expect(translate('en-US', 'goldenOpening.labels.genre.xuanhuan')).toBe('Fantasy');
    });
});
