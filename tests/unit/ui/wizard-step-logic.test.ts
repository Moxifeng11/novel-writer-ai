/**
 * 阶段 D1：向导步骤纯逻辑
 *
 * 从 `ui/full-writer/wizard-step-renderers.ts` 的 `renderWizardCompleteStep` 抽出。
 * 分卷统计靠正则匹配 `### 第N卷`，这类正则容易写错（阿拉伯数字 vs 中文数字、
 * 有无空格、H3 vs H2），此前埋在向导渲染方法里零测试。
 */

import { describe, expect, it } from 'vitest';
import {
    buildSetupStatItem,
    countVolumeHeadings,
    resolveCountStatus,
    resolveExistsStatus,
    resolveSetupStatusIcon,
} from '../../../ui/full-writer/wizard-step-logic';

describe('D1-13：分卷数统计', () => {
    it('统计标准 H3 分卷标题', () => {
        const outline = [
            '### 第1卷 少年篇',
            '正文……',
            '### 第2卷 成长篇',
            '正文……',
            '### 第3卷 终局篇',
        ].join('\n');
        expect(countVolumeHeadings(outline)).toBe(3);
    });

    it('不把中文数字标题算进去（模板只用阿拉伯数字）', () => {
        expect(countVolumeHeadings('### 第一卷 少年篇')).toBe(0);
    });

    it('不把 H2 标题算进去', () => {
        expect(countVolumeHeadings('## 第1卷 少年篇')).toBe(0);
    });

    it('标题与「第N卷」之间有空格也能识别', () => {
        expect(countVolumeHeadings('###   第1卷')).toBe(1);
    });

    it('空内容返回 0（不抛错）', () => {
        expect(countVolumeHeadings('')).toBe(0);
        expect(countVolumeHeadings(null)).toBe(0);
        expect(countVolumeHeadings(undefined)).toBe(0);
        expect(countVolumeHeadings('   ')).toBe(0);
    });

    it('重复卷号按出现次数计（不按唯一值去重）', () => {
        expect(countVolumeHeadings('### 第1卷\n### 第1卷')).toBe(2);
    });
});

describe('D1-14：检查项状态判定', () => {
    it('文件存在 → ok，不存在 → missing', () => {
        expect(resolveExistsStatus(true)).toBe('ok');
        expect(resolveExistsStatus(false)).toBe('missing');
    });

    it('数量 > 0 → ok，为 0 → warn（不是 missing）', () => {
        expect(resolveCountStatus(1)).toBe('ok');
        expect(resolveCountStatus(0)).toBe('warn');
        expect(resolveCountStatus(-1)).toBe('warn');
        expect(resolveCountStatus(NaN)).toBe('warn');
    });
});

describe('D1-15：状态图标与检查项构造', () => {
    it('三种状态对应三个 emoji', () => {
        expect(resolveSetupStatusIcon('ok')).toBe('✅');
        expect(resolveSetupStatusIcon('warn')).toBe('⚠️');
        expect(resolveSetupStatusIcon('missing')).toBe('❌');
    });

    it('构造检查项时图标由状态派生（调用方不用手写 emoji）', () => {
        const item = buildSetupStatItem('世界观', 'ok', '已生成');
        expect(item).toEqual({ label: '世界观', status: 'ok', icon: '✅', detail: '已生成' });
    });

    it('缺内容的项显示警告图标而不是错误图标', () => {
        const item = buildSetupStatItem('人物', resolveCountStatus(0), '0 个');
        expect(item.icon).toBe('⚠️');
    });
});
