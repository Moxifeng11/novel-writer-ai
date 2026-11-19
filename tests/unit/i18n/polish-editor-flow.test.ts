/**
 * polish-editor-flow.test.ts — 文笔润色编辑器与 AI 润色弹窗双语（缺口⑦ 第二期第42片）
 *
 * 第42片迁移 `ui/polish-editor.ts` 的界面文案：编辑器头部按钮与自动保存状态、实体图例与
 * tooltip、节奏分析面板、风格指南面板、AI 润色弹窗的三阶段（选项/加载/结果）与错误提示。
 *
 * 有意保留中文的：`POLISH_STYLE_HINTS` 四段风格说明、systemPrompt / userPrompt、
 * 指纹风格参考附录（含 句式节奏 等分项名）、`偏好风格：` / `避免风格：` 解析前缀、
 * `PolishScope` / `PolishStyle` 的联合类型值（落盘与提示词契约）、日志。
 */

import { afterEach, describe, expect, it } from 'vitest';
import { hasMessage, setLocale, translate } from '../../../i18n';

const CJK = /[\u4e00-\u9fff]/;

/** 第42片新增的 70 条语义键 */
const KEYS = [
    'title', 'btnPolish', 'btnRhythm', 'btnRhythmBusy', 'btnStyleGuide', 'statusSaved',
    'statusSaving', 'statusTooShort', 'statusSavedAt', 'statusSaveFailed', 'returnEmpty',
    'entity.char', 'entity.loc', 'entity.faction', 'entity.item',
    'legend.char', 'legend.loc', 'legend.faction', 'legend.item',
    'noticePolishError', 'noticeBodyTooShort', 'noticeRhythmError', 'noticeStyleError',
    'noticeSelectParagraph', 'noticePolishFailed', 'noticePolishException', 'noticeApplied',
    'rhythmTitle', 'rhythm.overall', 'rhythm.segments', 'rhythm.slow', 'rhythm.fast',
    'rhythm.suggestions', 'rhythm.detail', 'rhythm.density', 'rhythm.tension',
    'pace.fast', 'pace.medium', 'pace.slow',
    'segType.action', 'segType.dialogue', 'segType.description', 'segType.introspection',
    'styleTitle', 'styleEmpty', 'stylePref', 'styleAvoid',
    'modalTitle', 'scopeSection', 'scope.full', 'scope.partial',
    'styleSection', 'style.concise', 'style.detailed', 'style.emotional', 'style.rhythm',
    'fingerprintSection', 'fingerprintDesc', 'fingerprintToggle',
    'startBtn', 'cancelBtn', 'progress', 'progressHint',
    'resultTitle', 'resultMeta', 'colOriginal', 'colPolished', 'applyBtn', 'retryBtn',
    'noSelectionHint',
];

const key = (name: string): string => 'polishEditor.' + name;

afterEach(() => {
    setLocale('zh-CN');
});

describe('第42片：资源覆盖（zh / en 同集）', () => {
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

describe('第42片：英文侧不留中文', () => {
    it('70 条键在 en-US 下零 CJK（露头说明回落到中文兜底）', () => {
        for (const name of KEYS) {
            const value = translate('en-US', key(name));
            expect(CJK.test(value), name + ' → ' + value).toBe(false);
        }
    });
});

describe('第42片：中文插值逐字', () => {
    it('保留原文案措辞与占位位置', () => {
        expect(translate('zh-CN', key('statusSavedAt'), { time: '12:30:45' }))
            .toBe('💾 已保存 12:30:45');
        expect(translate('zh-CN', key('rhythm.overall'), { pace: translate('zh-CN', key('pace.fast')) }))
            .toBe('整体节奏: ⚡ 偏快');
        expect(translate('zh-CN', key('rhythm.segments'), { count: 12 })).toBe('段落数: 12');
        expect(translate('zh-CN', key('rhythm.slow'), { count: 3 })).toBe('拖沓段: 3');
        expect(translate('zh-CN', key('rhythm.density'), { value: 42 })).toBe('密度42');
        expect(translate('zh-CN', key('rhythm.tension'), { value: 88 })).toBe('紧张88');
        expect(translate('zh-CN', key('progress'), { scope: '全文润色', style: '精简凝练' }))
            .toBe('⏳ 正在调用 AI 润色（全文润色 · 精简凝练），请稍候...');
        expect(translate('zh-CN', key('resultMeta'), { scope: '选中段落润色', style: '节奏优化' }))
            .toBe('范围：选中段落润色 · 风格：节奏优化');
        expect(translate('zh-CN', key('noticePolishError'), { msg: '超时' })).toBe('AI润色出错: 超时');
        expect(translate('zh-CN', key('noticePolishFailed'), { msg: '返回为空' })).toBe('润色失败: 返回为空');
    });

    it('标签类键与源码逐字一致（口径：先保视觉，再谈措辞）', () => {
        const expected: Record<string, string> = {
            title: '✏️ 文笔润色编辑器',
            btnPolish: '✨ AI润色',
            btnRhythm: '📊 节奏分析',
            btnRhythmBusy: '⏳ 分析中...',
            btnStyleGuide: '🎨 风格指南',
            styleTitle: '🎨 作者风格指南',
            rhythmTitle: '📊 节奏分析结果',
            modalTitle: '✨ AI 润色',
            resultTitle: '✨ AI 润色结果',
            'scope.full': '全文润色',
            'scope.partial': '选中段落润色',
            'style.concise': '精简凝练',
            'style.detailed': '细节丰富',
            'style.emotional': '情感强化',
            'style.rhythm': '节奏优化',
            'legend.item': '⚔️ 物品/功法',
            'entity.item': '物品/功法',
            'segType.description': '📝描写',
        };
        for (const [name, value] of Object.entries(expected)) {
            expect(translate('zh-CN', key(name)), name).toBe(value);
        }
    });
});

describe('第42片：英文插值生效', () => {
    it('占位符替换后不含花括号残留，也没有中文', () => {
        const rendered = [
            translate('en-US', key('statusSavedAt'), { time: '12:30:45' }),
            translate('en-US', key('rhythm.overall'), { pace: translate('en-US', key('pace.slow')) }),
            translate('en-US', key('rhythm.segments'), { count: 5 }),
            translate('en-US', key('rhythm.density'), { value: 30 }),
            translate('en-US', key('progress'), { scope: 'Whole text', style: 'Concise' }),
            translate('en-US', key('resultMeta'), { scope: 'Selected paragraph', style: 'Pacing' }),
            translate('en-US', key('noticePolishException'), { msg: 'timeout' }),
        ];
        for (const text of rendered) {
            expect(text).not.toMatch(/\{[a-z]+\}/);
            expect(CJK.test(text), text).toBe(false);
        }
        expect(rendered[0]).toBe('💾 Saved 12:30:45');
        expect(rendered[1]).toBe('Overall pace: 🐌 Slow');
        expect(rendered[2]).toBe('Paragraphs: 5');
    });
});
