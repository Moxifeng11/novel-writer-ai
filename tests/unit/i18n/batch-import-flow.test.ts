/**
 * batch-import-flow.test.ts — 批量导入双语（缺口⑦ 第二期第44片）
 *
 * 第44片迁移 `ui/batch-import-modal.ts` 的五步向导：文件选择、智能识别预览、批量设置
 * （预设 / 拆解维度 / 并发 / 优先级 / 两类标签）、导入进度与任务列表、结果与历史、
 * 两个库内选择器（文件 / 文件夹）与全部 Notice。
 *
 * 有意保留中文的：`THEME_CATEGORIES` / `TECHNIQUE_CATEGORIES` 的值（
 * `tagManager.getTagsByType()` 的入参，是数据键）、构造函数的开发者错误文案、日志。
 */

import { afterEach, describe, expect, it } from 'vitest';
import { flattenMessages, getCatalog, setLocale, translate } from '../../../i18n';

const CJK = /[\u4e00-\u9fff]/;
const PREFIX = 'batchImport.';

const zhKeys = (): string[] =>
    Object.keys(flattenMessages(getCatalog('zh-CN'))).filter(k => k.startsWith(PREFIX));
const enKeys = (): string[] =>
    Object.keys(flattenMessages(getCatalog('en-US'))).filter(k => k.startsWith(PREFIX));

afterEach(() => {
    setLocale('zh-CN');
});

describe('第44片：资源覆盖（zh / en 同集）', () => {
    it('batchImport.* 在两种语言下键集一致且非空', () => {
        const zh = zhKeys().sort();
        const en = enKeys().sort();
        expect(zh.length).toBeGreaterThan(120);
        expect(en).toEqual(zh);
        for (const key of zh) {
            for (const locale of ['zh-CN', 'en-US'] as const) {
                const value = translate(locale, key);
                expect(value, locale + ' 回落到键名 ' + key).not.toBe(key);
                expect(value.trim().length, locale + ' 空值 ' + key).toBeGreaterThan(0);
            }
        }
    });
});

describe('第44片：英文侧不留中文', () => {
    it('batchImport.* 在 en-US 下零 CJK', () => {
        for (const key of enKeys()) {
            const value = translate('en-US', key);
            expect(CJK.test(value), key + ' → ' + value).toBe(false);
        }
    });
});

describe('第44片：中文插值逐字（口径：先保视觉，再谈措辞）', () => {
    it('计数 / 预设 / 建议类文案与源码逐字一致', () => {
        expect(translate('zh-CN', 'batchImport.select.selectedCount', { count: 3 })).toBe('已选文件 (3)');
        expect(translate('zh-CN', 'batchImport.select.metaChapters', { count: 42 })).toBe('📖 42 章');
        expect(translate('zh-CN', 'batchImport.preview.intro', { count: 2 })).toBe('智能识别预览（共 2 本）');
        expect(translate('zh-CN', 'batchImport.preview.moreChapters', { count: 7 })).toBe('... 还有 7 章');
        expect(translate('zh-CN', 'batchImport.progress.logStart', { count: 5 })).toBe('开始导入，共 5 本书籍');
        expect(translate('zh-CN', 'batchImport.progress.retry', { count: 1, max: 3 })).toBe('重试 1/3');
        expect(translate('zh-CN', 'batchImport.result.historyTotal', { count: 9 })).toBe('总计 9 本');
        expect(translate('zh-CN', 'batchImport.result.historyDimensions', { count: 6 })).toBe('拆解维度: 6 个');
        expect(translate('zh-CN', 'batchImport.result.partialRetry', { retried: 2, missing: 3 }))
            .toBe('已重试 2 项；3 项任务记录已过期');
        expect(translate('zh-CN', 'batchImport.notice.tooLarge', { name: 'a.txt', size: 12 }))
            .toBe('文件过大已跳过: a.txt（12MB，上限 10MB）');
        expect(translate('zh-CN', 'batchImport.notice.presetApplied', { name: '默认' })).toBe('已应用预设：默认');
        expect(translate('zh-CN', 'batchImport.picker.fileCount', { count: 4 })).toBe('4 个文件');
    });

    it('标签 / 按钮 / 空态类文案逐字一致', () => {
        const expected: Record<string, string> = {
            title: '📚 批量导入书籍',
            'steps.select': '文件选择',
            'steps.preview': '智能预览',
            'steps.settings': '批量设置',
            'steps.progress': '导入进度',
            'steps.result': '结果与历史',
            'select.localFile': '📁 选择本地文件',
            'select.vault': '📝 从库内选择',
            'select.history': '📜 导入历史',
            'select.empty': '暂无文件，请添加要导入的小说文件',
            'preview.unknownAuthor': '未识别',
            'setting.dimensions': '🔍 拆解维度',
            'setting.priorityHigh': '高优先级',
            'setting.priorityLow': '低优先级',
            'setting.noThemeTags': '暂无题材标签',
            'progress.pauseAll': '⏸ 全部暂停',
            'status.queued': '排队中',
            'status.cancelled': '已取消',
            'result.statSuccess': '✅ 成功',
            'result.retryFailed': '🔄 重试失败项',
            'result.expired': '任务记录已过期，请重新添加文件导入',
            'footer.next': '下一步 →',
            'footer.prev': '← 上一步',
            'footer.start': '🚀 开始导入',
            'footer.continueImport': '📂 继续导入',
            'picker.root': '(根目录)',
            'picker.folderMissing': '文件夹不存在',
            'notice.epubSkipped': 'EPUB 格式暂不支持，已跳过',
            'wordCount.million': '{n} 百万字',
            'wordCount.wan': '{n} 万字',
            'wordCount.chars': '{n} 字',
        };
        for (const [name, value] of Object.entries(expected)) {
            expect(translate('zh-CN', PREFIX + name), name).toBe(value);
        }
        expect(translate('zh-CN', 'batchImport.wordCount.wan', { n: '12.3' })).toBe('12.3 万字');
        expect(translate('zh-CN', 'batchImport.wordCount.chars', { n: '856' })).toBe('856 字');
    });

    it('分类显示名与 THEME_CATEGORIES / TECHNIQUE_CATEGORIES 的存储值一一对应', () => {
        const themes = [
            ['male', '男频'], ['female', '女频'], ['short', '短篇'], ['derivative', '衍生'],
        ] as const;
        const techniques = [
            ['structure', '结构类'], ['hook', '爽点类'], ['emotion', '情绪类'],
            ['rhythm', '节奏类'], ['genre', '流派类'],
        ] as const;
        for (const [id, stored] of themes) {
            expect(translate('zh-CN', 'batchImport.themeCategory.' + id), id).toBe(stored);
        }
        for (const [id, stored] of techniques) {
            expect(translate('zh-CN', 'batchImport.techniqueCategory.' + id), id).toBe(stored);
        }
    });
});

describe('第44片：英文插值生效', () => {
    it('占位符替换后不含花括号残留，且按 K/MB 口径渲染', () => {
        const rendered = [
            translate('en-US', 'batchImport.select.selectedCount', { count: 3 }),
            translate('en-US', 'batchImport.preview.intro', { count: 2 }),
            translate('en-US', 'batchImport.progress.retry', { count: 1, max: 3 }),
            translate('en-US', 'batchImport.result.partialRetry', { retried: 2, missing: 3 }),
            translate('en-US', 'batchImport.notice.tooLarge', { name: 'a.txt', size: 12 }),
            translate('en-US', 'batchImport.wordCount.wan', { n: '12.3' }),
            translate('en-US', 'batchImport.wordCount.million', { n: '3.5' }),
            translate('en-US', 'batchImport.wordCount.chars', { n: '856' }),
        ];
        for (const text of rendered) {
            expect(text).not.toMatch(/\{[a-z]+\}/);
        }
        expect(rendered[0]).toBe('Selected files (3)');
        expect(rendered[2]).toBe('Retry 1/3');
        expect(rendered[5]).toBe('12.3k words');
        expect(rendered[6]).toBe('3.5M words');
        expect(rendered[7]).toBe('856 words');
    });
});
