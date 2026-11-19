/**
 * add-fanfic-flow.test.ts — 同人设定弹窗补漏双语（缺口⑦ 第二期第40片）
 *
 * 第40片只补 `ui/add-fanfic-setting-modal.ts` 在 ZCode 迁移后剩下的界面文案：
 * 校验与前置条件 Notice、来源统计行、模板/待审核/绑定三段的成功与警告提示、
 * 覆盖确认、知识库生成流程的四条进度文案与五行报告，以及规则审核阻断提示。
 *
 * 有意保留中文的：两段 AI 提示词、审核 meta 键名（审核状态/来源数量/来源哈希/生成时间）、
 * 草稿占位数据（（待补充）/未知/（待核实：…））、日志、检索查询词、`玄幻` 默认值。
 */

import { afterEach, describe, expect, it } from 'vitest';
import { hasMessage, setLocale, translate } from '../../../i18n';

const CJK = /[\u4e00-\u9fff]/;

/** 第40片新增的 37 条语义键 */
const FLOW_KEYS = [
    'needWorkName', 'knowledgeButtonHint', 'needUrl', 'sourceExists',
    'needWorkNameForSearch', 'needProjectForResearch', 'searching', 'sourceSummary',
    'templateDraftCreated', 'templateEnsured', 'pendingTitle', 'approvedTo',
    'selected', 'needSettingFile', 'emptySettingFile', 'boundToProject', 'boundMissing',
    'needProject', 'needCredentials', 'kbNotReady',
    'retrievingMaterials', 'noMaterials', 'retrievalErrorSuffix', 'materialsReady',
    'verifyingSources', 'crossChecking', 'overwriteConfirm',
    'reportMaterials', 'reportSources', 'reportContradicted', 'reportUnverified',
    'reportSourceFailed', 'reportSavedPending', 'needCanonSources',
    'generatingDraft', 'generatingFromCanon', 'auditBlocked',
];

const key = (name: string): string => 'addFanfic.flow.' + name;

afterEach(() => {
    setLocale('zh-CN');
});

describe('第40片：资源覆盖（zh / en 同集）', () => {
    it('37 条语义键在两种语言下都能解析，且不回落到键名', () => {
        for (const locale of ['zh-CN', 'en-US'] as const) {
            for (const name of FLOW_KEYS) {
                expect(hasMessage(key(name)), locale + ' 缺键 ' + name).toBe(true);
                const value = translate(locale, key(name));
                expect(value, locale + ' 回落到键名 ' + name).not.toBe(key(name));
                expect(value.trim().length, locale + ' 空值 ' + name).toBeGreaterThan(0);
            }
        }
    });

    it('en 下 37 条界面文案零中文（保留的界面符号用英文标点）', () => {
        for (const name of FLOW_KEYS) {
            expect(translate('en-US', key(name)), name).not.toMatch(CJK);
        }
    });
});

describe('第40片：插值与原文一致', () => {
    it('zh 侧插值逐字保留原模板串', () => {
        expect(translate('zh-CN', key('sourceSummary'), { total: 3, official: 2 }))
            .toBe('已导入 3 条来源，其中官方可用 2 条。');
        expect(translate('zh-CN', key('pendingTitle'), { count: 2 })).toBe('📝 待审核草稿（2）');
        expect(translate('zh-CN', key('boundToProject'), { file: '将夜.md', project: '仙侠' }))
            .toBe('已绑定「将夜.md」到项目「仙侠」');
        expect(translate('zh-CN', key('boundMissing'), { file: '将夜.md', fields: '世界观、力量体系' }))
            .toBe('已绑定「将夜.md」，但缺少：世界观、力量体系。建议补全后重新审核。');
        expect(translate('zh-CN', key('reportSavedPending')))
            .toBe('草稿已存入「_待审核」，请到审核页人工确认后通过。');
        expect(translate('zh-CN', key('retrievalErrorSuffix'), { error: '磁盘满' })).toBe('（检索错误：磁盘满）');
    });

    it('en 侧插值生效且不带中文', () => {
        const samples: Array<[string, Record<string, string | number>]> = [
            ['sourceSummary', { total: 3, official: 2 }],
            ['materialsReady', { count: 5 }],
            ['overwriteConfirm', { path: '_待审核/设定.md' }],
            ['reportContradicted', { items: 'a; b' }],
            ['needCanonSources', { errors: 'x' }],
            ['generatingFromCanon', { work: 'Zhetian' }],
            ['auditBlocked', { issues: 'y' }],
        ];
        for (const [name, params] of samples) {
            const value = translate('en-US', key(name), params);
            expect(value, name).not.toBe(key(name));
            expect(value, name).toContain(String(Object.values(params)[0]));
        }
    });
});
