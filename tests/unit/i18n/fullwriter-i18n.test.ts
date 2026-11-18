/**
 * fullwriter-i18n.test.ts — 完整写作工作台视图主体双语（缺口⑦ 第二期第17片第一批，ZC-20261118-07）
 *
 * full-writer-view.ts（2771 行）由多个子控制器装配，DOM 级测试在第二/三批
 * （project-selector-controller 等子模块迁移时）补；本片先锁资源面：
 * - zh 资源保持原文（含带 emoji 的按钮文案）
 * - en 资源零 CJK、占位符与 zh 一致（键集一致性由 i18n-parity 兜底）
 * - 视图用到的关键键随语言求值
 */
import { afterEach, describe, expect, it } from 'vitest';
import { t, setLocale, getCatalog } from '../../../i18n';
import type { MessageTree } from '../../../i18n';

afterEach(() => {
    setLocale('zh-CN');
});

describe('fullwriter 双语（缺口⑦ 第二期第17片第一批）', () => {
    it('zh 资源保持原文（按钮/提示/步骤名）', () => {
        setLocale('zh-CN');
        expect(t('fullwriter.viewTitle')).toBe('📖 完整写作工作台');
        expect(t('fullwriter.runBtnOneClick')).toBe('🚀 一键完成本章（推荐：合并规划）');
        expect(t('fullwriter.tabProjects')).toBe('📋 项目与章节');
        expect(t('fullwriter.stepQualityControl')).toBe('质量控制');
        expect(t('fullwriter.planQuickTitle')).toBe('🚀 一键生成全章规划');
        expect(t('fullwriter.progressSummary', { msg: '生成中', current: 2, total: 9, aiCalls: 3 }))
            .toBe('生成中（2/9 步，预计 3 次 AI）');
    });

    it('en-US：关键键全英文且不回退键名', () => {
        setLocale('en-US');
        expect(t('fullwriter.viewTitle')).toBe('📖 Full writing workbench');
        expect(t('fullwriter.runBtnOneClick')).toBe('🚀 One-click chapter (recommended: merged planning)');
        expect(t('fullwriter.stepQualityControl')).toBe('Quality control');
        expect(t('fullwriter.currentStepLabel')).toBe('Current step');
    });

    it('en 资源 fullwriter 子树零 CJK', () => {
        const tree = getCatalog('en-US') as MessageTree;
        const subtree = (tree as unknown as Record<string, Record<string, unknown>>).fullwriter;
        expect(subtree).toBeTruthy();
        const walk = (node: unknown, path: string): void => {
            if (typeof node === 'string') {
                expect(node, `en 资源出现 CJK：${path}`).not.toMatch(/[\u4e00-\u9fff]/);
                return;
            }
            for (const [k, v] of Object.entries(node as Record<string, unknown>)) walk(v, `${path}.${k}`);
        };
        walk(subtree, 'fullwriter');
    });
});
