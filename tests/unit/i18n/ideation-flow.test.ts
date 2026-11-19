/**
 * ideation-flow.test.ts — 脑洞构思工坊双语（缺口⑦ 第二期第43片）
 *
 * 第43片迁移 `ui/ideation-modal.ts` 的界面文案：步骤导航、题材输入表单、创意卡片列表、
 * 详情页（雷达图 + 评分 + 题材匹配）、收藏夹、生成/收藏/保存三类 Notice、保存脑洞弹窗。
 *
 * 有意保留中文的：`GENRE_OPTIONS` 的 14 个题材值（提示词「类型标签：…」、
 * `CreateProjectModal` 的 genre 与收藏里的 selectedGenres 都以中文为准）、
 * systemPrompt / userPrompt、`buildIdeaContent()` 生成的文档正文（含 frontmatter 与表格表头）、
 * 文件名 `脑洞构思.md` 与路径 `04-项目总控`、日志。
 */

import { afterEach, describe, expect, it } from 'vitest';
import { hasMessage, setLocale, translate } from '../../../i18n';

const CJK = /[\u4e00-\u9fff]/;

/** 第43片新增的 70 条语义键 */
const KEYS = [
    'title',
    'tab.ideas', 'tab.favorites',
    'step.input', 'step.ideas', 'step.detail',
    'input.keywordsTitle', 'input.keywordsPlaceholder', 'input.genresTitle',
    'input.extraTitle', 'input.extraPlaceholder', 'input.generate', 'input.needInput',
    'list.count', 'list.refresh', 'list.back', 'list.conflict', 'list.sellingPoint', 'list.avgScore',
    'detail.back', 'detail.saved', 'detail.save', 'detail.coreConcept', 'detail.titleCandidates',
    'detail.elevatorPitch', 'detail.scores', 'detail.genreMatch', 'detail.recommend', 'detail.recommendSeparator',
    'detail.conflict', 'detail.sellingPoint', 'detail.differentiation', 'detail.competitive',
    'detail.export', 'detail.scoreValue',
    'dim.marketHeat', 'dim.innovation', 'dim.writability', 'dim.satisfaction',
    'dim.radar.marketHeat', 'dim.radar.innovation', 'dim.radar.writability', 'dim.radar.satisfaction',
    'history.empty', 'history.count', 'history.view', 'history.delete',
    'notice.generating', 'notice.generateFailed', 'notice.parseFailed', 'notice.generateError',
    'notice.generated', 'notice.favAdded', 'notice.favRemoved', 'notice.savedTo', 'notice.saveFailed',
    'export.title', 'export.intro', 'export.saveCurrent', 'export.createNew',
    'fallback.unnamed',
    'genre.xuanhuan', 'genre.xianxia', 'genre.urban', 'genre.scifi', 'genre.mystery',
    'genre.history', 'genre.romance', 'genre.fantasy', 'genre.wuxia', 'genre.apocalypse',
    'genre.supernatural', 'genre.game', 'genre.competitive', 'genre.fanfic',
];

const key = (name: string): string => 'ideation.' + name;

afterEach(() => {
    setLocale('zh-CN');
});

describe('第43片：资源覆盖（zh / en 同集）', () => {
    it('70 条语义键在两种语言下都能解析，且不回落到键名', () => {
        for (const locale of ['zh-CN', 'en-US'] as const) {
            for (const name of KEYS) {
                expect(hasMessage(key(name)), locale + ' 缺键 ' + name).toBe(true);
                const value = translate(locale, key(name));
                expect(value, locale + ' 回落到键名 ' + name).not.toBe(key(name));
                expect(value.trim().length, locale + ' 空值 ' + name).toBeGreaterThan(0);
            }
        }
    });
});

describe('第43片：英文侧不留中文', () => {
    it('70 条键在 en-US 下零 CJK', () => {
        for (const name of KEYS) {
            const value = translate('en-US', key(name));
            expect(CJK.test(value), name + ' → ' + value).toBe(false);
        }
    });
});

describe('第43片：中文插值逐字', () => {
    it('保留原文案措辞与占位位置', () => {
        expect(translate('zh-CN', key('tab.favorites'), { count: 3 })).toBe('收藏夹 (3)');
        expect(translate('zh-CN', key('list.count'), { count: 10 })).toBe('共 10 个创意方向');
        expect(translate('zh-CN', key('list.conflict'), { text: '废柴逆袭' })).toBe('冲突：废柴逆袭');
        expect(translate('zh-CN', key('list.sellingPoint'), { text: '开局无敌' })).toBe('卖点：开局无敌');
        expect(translate('zh-CN', key('list.avgScore'), { score: 78 })).toBe('综合评分: 78');
        expect(translate('zh-CN', key('detail.recommend'), { genres: '玄幻、仙侠' }))
            .toBe('💡 推荐方向：玄幻、仙侠');
        expect(translate('zh-CN', key('detail.scoreValue'), { value: 90 })).toBe('90分');
        expect(translate('zh-CN', key('detail.recommendSeparator'))).toBe('、');
        expect(translate('en-US', key('detail.recommendSeparator'))).toBe(', ');
        expect(translate('zh-CN', key('history.count'), { count: 2 })).toBe('共收藏 2 个创意');
        expect(translate('zh-CN', key('notice.generateFailed'), { error: '超时' })).toBe('生成失败: 超时');
        expect(translate('zh-CN', key('notice.generated'), { count: 10 })).toBe('已生成 10 个创意');
        expect(translate('zh-CN', key('notice.savedTo'), { path: '示例项目/04-项目总控/脑洞构思.md' }))
            .toBe('已保存到「示例项目/04-项目总控/脑洞构思.md」');
        expect(translate('zh-CN', key('export.intro'), { project: '示例项目' }))
            .toBe('当前项目：示例项目。可以保存到当前项目，或基于这个脑洞创建新项目。');
        expect(translate('zh-CN', key('export.saveCurrent'), { project: '示例项目' }))
            .toBe('保存到当前项目「示例项目」');
    });

    it('标签类键与源码逐字一致（口径：先保视觉，再谈措辞）', () => {
        const expected: Record<string, string> = {
            title: '💡 脑洞构思工坊',
            'tab.ideas': '创意发散',
            'step.input': '题材输入',
            'input.keywordsTitle': '📌 题材关键词',
            'input.genresTitle': '🏷️ 类型标签（可多选）',
            'input.extraTitle': '💭 额外要求（可选）',
            'input.generate': '🚀 生成10个创意',
            'input.needInput': '请输入关键词或选择至少一个类型标签',
            'list.refresh': '🔄 换一批',
            'detail.back': '← 返回列表',
            'detail.saved': '❤️ 已收藏',
            'detail.save': '🤍 收藏',
            'detail.coreConcept': '🎯 核心概念',
            'detail.elevatorPitch': '⚡ 一句话梗概 (Elevator Pitch)',
            'detail.scores': '📊 多维度评分',
            'detail.genreMatch': '🎭 题材类型匹配',
            'detail.differentiation': '🏆 竞品差异化分析',
            'detail.export': '📝 保存为项目资料',
            'dim.satisfaction': '爽点密度',
            'history.empty': '暂无收藏的创意',
            'history.view': '查看详情',
            'notice.generating': '⏳ 正在生成创意...',
            'export.title': '📁 保存脑洞',
            'fallback.unnamed': '未命名创意',
            'genre.xuanhuan': '玄幻',
            'genre.fanfic': '同人',
        };
        for (const [name, value] of Object.entries(expected)) {
            expect(translate('zh-CN', key(name)), name).toBe(value);
        }
    });

    it('题材显示名与 GENRE_OPTIONS 的存储值逐字一致', () => {
        const genreKeys = [
            ['xuanhuan', '玄幻'], ['xianxia', '仙侠'], ['urban', '都市'], ['scifi', '科幻'],
            ['mystery', '悬疑'], ['history', '历史'], ['romance', '言情'], ['fantasy', '奇幻'],
            ['wuxia', '武侠'], ['apocalypse', '末世'], ['supernatural', '灵异'], ['game', '游戏'],
            ['competitive', '竞技'], ['fanfic', '同人'],
        ] as const;
        for (const [id, stored] of genreKeys) {
            expect(translate('zh-CN', key('genre.' + id)), id).toBe(stored);
        }
    });
});

describe('第43片：英文插值生效', () => {
    it('占位符替换后不含花括号残留，也没有中文', () => {
        const rendered = [
            translate('en-US', key('tab.favorites'), { count: 3 }),
            translate('en-US', key('list.count'), { count: 10 }),
            translate('en-US', key('list.avgScore'), { score: 78 }),
            translate('en-US', key('detail.recommend'), { genres: 'Fantasy, Xianxia' }),
            translate('en-US', key('detail.scoreValue'), { value: 90 }),
            translate('en-US', key('notice.generated'), { count: 10 }),
            translate('en-US', key('notice.savedTo'), { path: 'demo/脑洞构思.md' }),
            translate('en-US', key('export.intro'), { project: 'demo' }),
        ];
        for (const text of rendered) {
            expect(text).not.toMatch(/\{[a-z]+\}/);
        }
        expect(rendered[0]).toBe('Favorites (3)');
        expect(rendered[1]).toBe('10 idea(s)');
        expect(rendered[2]).toBe('Overall score: 78');
        expect(rendered[4]).toBe('90 pts');
    });
});