/**
 * ai-builder-flow.test.ts — AI 世界元素生成器补漏双语（缺口⑦ 第二期第41片）
 *
 * 第41片迁移 `ui/ai-builder-modal.ts` 剩下的界面文案：仪表盘/生成页标题、单条与批量表单的
 * 标签与占位符、生成进度与失败提示、保存与完整性校验结果、项目自动改名提示。
 *
 * 有意保留中文的：两段角色修补提示词、模板文件名、项目名正则、AI 需求片段
 * （题材倾向 / 故事逻辑方针 / 批量生成要求）、校验器契约串（正文分节 / YAML frontmatter 未闭合）、
 * 姓名提取正则、日志。
 */

import { afterEach, describe, expect, it } from 'vitest';
import { hasMessage, setLocale, translate } from '../../../i18n';

const CJK = /[\u4e00-\u9fff]/;

/** 第41片新增的 38 条语义键 */
const FLOW_KEYS = [
    'onlyOneProject', 'dashboardTitle', 'existingCount', 'generationTitle',
    'batchGenerationTitle', 'needCredentials', 'unknownError', 'generatingWorldview',
    'worldviewOverwriteConfirm', 'renameUnavailable', 'worldviewDoneRenamed',
    'worldviewDoneNamed', 'nameLabel', 'namePlaceholder', 'characterPromptPlaceholder',
    'rolePlaceholder', 'needName', 'batchCharacterPlaceholder', 'batchPromptPlaceholder',
    'generatingLabel', 'generationFailedTitle', 'charactersProgress', 'batchNoneReturned',
    'batchPartialFail', 'unsupportedEntity', 'generatingProgress', 'itemFailedGen',
    'itemFailed', 'batchDoneFailures', 'moreSuffix', 'batchDone', 'nothingGenerated',
    'integrityFailed', 'saveFailedDetail', 'renamedHint', 'savedTo', 'charactersSaved',
    'charactersSavedSkipped',
];

const key = (name: string): string => 'aiBuilder.flow.' + name;

afterEach(() => {
    setLocale('zh-CN');
});

describe('第41片：资源覆盖（zh / en 同集）', () => {
    it('38 条语义键在两种语言下都能解析，且不回落到键名', () => {
        for (const locale of ['zh-CN', 'en-US'] as const) {
            for (const name of FLOW_KEYS) {
                expect(hasMessage(key(name)), locale + ' 缺键 ' + name).toBe(true);
                const value = translate(locale, key(name));
                expect(value, locale + ' 回落到键名 ' + name).not.toBe(key(name));
                expect(value.trim().length, locale + ' 空值 ' + name).toBeGreaterThan(0);
            }
        }
    });

    it('en 下 38 条界面文案零中文', () => {
        for (const name of FLOW_KEYS) {
            expect(translate('en-US', key(name)), name).not.toMatch(CJK);
        }
    });
});

describe('第41片：插值与原文一致', () => {
    it('zh 侧插值逐字保留原模板串', () => {
        expect(translate('zh-CN', key('dashboardTitle'), { project: '示例项目' }))
            .toBe('✨ 示例项目 — 世界元素');
        expect(translate('zh-CN', key('existingCount'), { count: 3 })).toBe('已有 3 个');
        expect(translate('zh-CN', key('generationTitle'), { icon: '👤', label: '人物' }))
            .toBe('👤 生成人物');
        expect(translate('zh-CN', key('charactersProgress'), { from: 1, to: 10, total: 20 }))
            .toBe('⏳ 正在生成角色 (1-10/20)...');
        expect(translate('zh-CN', key('generatingProgress'), { label: '物品', index: 2, total: 5 }))
            .toBe('⏳ 正在生成物品 (2/5)...');
        expect(translate('zh-CN', key('itemFailed'), { index: 4, error: '超时' })).toBe('第4个（超时）');
        expect(translate('zh-CN', key('integrityFailed'), { name: '张三', fields: '身份、年龄' }))
            .toBe('「张三」未通过完整性校验，未保存。缺少：身份、年龄');
        expect(translate('zh-CN', key('charactersSaved'), { count: 2, project: '示例项目' }))
            .toBe('人物已保存：2 个 → 示例项目');
        expect(translate('zh-CN', key('savedTo'), { name: '李四', project: '示例项目', hint: '' }))
            .toBe('「李四」已保存到 示例项目');
    });

    it('en 侧插值生效且不带中文', () => {
        const samples: Array<[string, Record<string, string | number>]> = [
            ['dashboardTitle', { project: 'Demo' }],
            ['existingCount', { count: 3 }],
            ['renameUnavailable', { error: 'duplicate', old: 'Demo' }],
            ['worldviewDoneNamed', { name: 'New Demo' }],
            ['namePlaceholder', { label: 'Character' }],
            ['rolePlaceholder', { label: 'Faction' }],
            ['batchPromptPlaceholder', { label: 'Item' }],
            ['generatingProgress', { label: 'Item', index: 2, total: 5 }],
            ['batchDoneFailures', { saved: 3, total: 5, failed: 2, items: 'a, b', more: '' }],
            ['saveFailedDetail', { name: 'Li', error: 'timeout' }],
            ['charactersSavedSkipped', { base: 'Characters saved: 2 → Demo', skipped: 1 }],
        ];
        for (const [name, params] of samples) {
            const value = translate('en-US', key(name), params);
            expect(value, name).not.toBe(key(name));
            expect(value, name).toContain(String(Object.values(params)[0]));
            expect(value, name).not.toMatch(CJK);
        }
    });
});
