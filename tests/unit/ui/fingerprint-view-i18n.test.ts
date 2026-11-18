/**
 * fingerprint-view-i18n.test.ts — 写作指纹库视图三件套双语（缺口⑦ 第二期第16片，ZC-20261118-06）
 *
 * 视图主体（writing-fingerprint-view.ts，2018 行）的 DOM 渲染依赖完整插件宿主，
 * 由实机 zh/en 截图验收；这里覆盖可纯测的双语面：
 * - fingerprint-utils 的 12 维名/描述/状态标签（引擎常量不改、UI 按键求值）
 * - fingerprint-scope-logic 的层名与空态引导（zh 逐字保留，旧测试零修改）
 * - fingerprint-detail-logic 的统计卡片标签
 */
import { afterEach, describe, expect, it } from 'vitest';
import { t, setLocale } from '../../../i18n';
import { dimensionNameV2, dimensionDescV2, dimensionStatusLabel, FEATURE_DIMENSIONS } from '../../../ui/fingerprint-utils';
import { buildEmptyScopeGuidance, scopeLabel } from '../../../ui/views/fingerprint-scope-logic';
import { buildStatItems } from '../../../ui/views/fingerprint-detail-logic';
import { STYLE_DIMENSIONS_V2 } from '../../../engine/style/style-dimensions-v2';

afterEach(() => {
    setLocale('zh-CN');
});

describe('指纹库双语（缺口⑦ 第二期第16片）', () => {
    it('12 维名/描述/状态：zh 与引擎常量逐字一致，en 全英文', () => {
        setLocale('zh-CN');
        for (const dim of STYLE_DIMENSIONS_V2) {
            expect(dimensionNameV2(dim.key)).toBe(dim.name);
            expect(dimensionDescV2(dim.key)).toBe(dim.description);
        }
        expect(dimensionStatusLabel('complete')).toBe('完整');
        expect(dimensionStatusLabel('pending')).toBe('待补充');
        setLocale('en-US');
        for (const dim of STYLE_DIMENSIONS_V2) {
            expect(dimensionNameV2(dim.key)).not.toMatch(/[\u4e00-\u9fff]/);
            expect(dimensionNameV2(dim.key)).not.toContain('fingerprint.dim.');
            expect(dimensionDescV2(dim.key)).not.toMatch(/[\u4e00-\u9fff]/);
        }
        expect(dimensionStatusLabel('complete')).toBe('Complete');
        expect(dimensionStatusLabel('pending')).toBe('Pending');
        expect(dimensionStatusLabel('partial')).toBe('Partial');
    });

    it('V1 七维标签：zh 原文、en 全英文且不回退键名', () => {
        setLocale('zh-CN');
        const zh = FEATURE_DIMENSIONS.map(d => t(d.labelKey));
        expect(zh).toEqual(['句式节奏', '用词偏好', '叙事特点', '修辞手法', '对话风格', '段落结构', '整体文风']);
        setLocale('en-US');
        for (const d of FEATURE_DIMENSIONS) {
            const label = t(d.labelKey);
            expect(label).not.toMatch(/[\u4e00-\u9fff]/);
            expect(label).not.toContain('fingerprint.v1dim.');
        }
    });

    it('层名与空态引导随语言切换（zh 逐字保留）', () => {
        setLocale('zh-CN');
        expect(scopeLabel('template')).toBe('📋 模板层');
        expect(buildEmptyScopeGuidance('template', { template: 0, global: 3, project: 5 }))
            .toBe('当前层暂无指纹，可切换到🌐 全局层 / 📁 项目层查看');
        setLocale('en-US');
        expect(scopeLabel('global')).toBe('🌐 Global layer');
        const guidance = buildEmptyScopeGuidance('template', { template: 0, global: 3, project: 5 });
        expect(guidance).toContain('Global layer');
        expect(guidance).not.toMatch(/[\u4e00-\u9fff]/);
        expect(buildEmptyScopeGuidance('global', { template: 0, global: 0, project: 0 }))
            .toBe('Extract a writing fingerprint from chapter text for style alignment and reference');
    });

    it('统计卡片标签：zh 原文、en 全英文', () => {
        const stats = { avgSentenceLength: 12.5, avgParagraphLength: 100, dialogueRatio: 0.2, descriptionRatio: 0.3 };
        setLocale('zh-CN');
        expect(buildStatItems(stats).map(item => item.label)).toEqual(['平均句长', '平均段长', '对话占比', '描写占比']);
        setLocale('en-US');
        for (const item of buildStatItems(stats)) {
            expect(item.label).not.toMatch(/[\u4e00-\u9fff]/);
            expect(item.label).not.toContain('fingerprint.view.');
        }
        expect(buildStatItems(stats)[0].value).toContain('chars');
        // stats 缺失时的占位符来自 knowledge-detail-format（共享格式化层，不在本片范围），只保证标签无中文
    });
});
