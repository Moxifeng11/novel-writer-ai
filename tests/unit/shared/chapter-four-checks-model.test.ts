/**
 * 本章四项校验：聚合模型（措辞 + 状态映射）
 */

import { describe, expect, it } from 'vitest';
import {
    FORMAT_DEVIATION_WARN_RATIO,
    buildFourCheckReport,
    describeFourCheckEmpty,
    describeFourCheckHeader,
    fourCheckAttentionItems,
    renderFourCheckReport,
} from '@/shared/chapter-four-checks-model';

const base = {
    chapterName: '第3章',
    wordCount: 3200,
    targetWords: 3000,
    wordMinRatio: 0.8,
    now: 1_700_000_000_000,
};

const item = (report: ReturnType<typeof buildFourCheckReport>, id: string) =>
    report.items.find(i => i.id === id)!;

describe('字数', () => {
    it('低于硬门禁下限判 fail（与 postCheckWordCount 同口径）', () => {
        const report = buildFourCheckReport({ ...base, wordCount: 2300 });
        expect(item(report, 'wordCount').status).toBe('fail');
        expect(item(report, 'wordCount').message).toContain('2400'); // floor(3000*0.8)
    });

    it('介于下限与目标之间判 pass 并说明略低', () => {
        const report = buildFourCheckReport({ ...base, wordCount: 2800 });
        expect(item(report, 'wordCount').status).toBe('pass');
        expect(item(report, 'wordCount').message).toContain('略低于目标');
    });

    it('达到目标判 pass', () => {
        expect(item(buildFourCheckReport(base), 'wordCount').message).toContain('达到目标');
    });
});

describe('格式', () => {
    it('无分析结果判 skip', () => {
        expect(item(buildFourCheckReport(base), 'format').status).toBe('skip');
    });

    it('偏离比例达到阈值判 warn 并列出明细', () => {
        const report = buildFourCheckReport({
            ...base,
            format: { ratio: FORMAT_DEVIATION_WARN_RATIO, indentMissing: 3, blankLineBreaks: 2, titleStripped: 1, metaStripped: 0 },
        });
        const format = item(report, 'format');
        expect(format.status).toBe('warn');
        expect(format.message).toContain('缺段首缩进 3 行');
        expect(format.message).toContain('剥离标题 1 行');
        expect(format.message).toContain('自动规整');
    });

    it('带偏离样例时给出行号定位', () => {
        const report = buildFourCheckReport({
            ...base,
            format: {
                ratio: 0.3, indentMissing: 2, blankLineBreaks: 0, titleStripped: 0, metaStripped: 0,
                samples: [
                    { line: 2, kind: 'indent', preview: '正文一。' },
                    { line: 5, kind: 'indent', preview: '正文二。' },
                ],
            },
        });
        const format = item(report, 'format');
        expect(format.message).toContain('偏离定位：第 2 行（缺缩进）、第 5 行（缺缩进）');
    });

    it('偏离比例低于阈值判 pass', () => {
        const report = buildFourCheckReport({
            ...base,
            format: { ratio: 0.05, indentMissing: 1, blankLineBreaks: 0, titleStripped: 0, metaStripped: 0 },
        });
        expect(item(report, 'format').status).toBe('pass');
    });
});

describe('视角', () => {
    it('无统计判 skip', () => {
        expect(item(buildFourCheckReport(base), 'perspective').status).toBe('skip');
    });

    it('混用判 warn，并给两侧计数', () => {
        const report = buildFourCheckReport({
            ...base,
            perspective: { first: 8, third: 10, mixed: true, ratio: 0.8 },
        });
        const perspective = item(report, 'perspective');
        expect(perspective.status).toBe('warn');
        expect(perspective.message).toContain('第一人称 8 处');
        expect(perspective.message).toContain('第三人称 10 处');
    });

    it('未达阈值判 pass', () => {
        const report = buildFourCheckReport({
            ...base,
            perspective: { first: 1, third: 20, mixed: false, ratio: 0.05 },
        });
        expect(item(report, 'perspective').status).toBe('pass');
    });
});

describe('钩子', () => {
    it('章纲未声明钩子 → skip', () => {
        expect(item(buildFourCheckReport(base), 'hook').status).toBe('skip');
    });

    it('声明了钩子但没写内容 → skip（无法判定，不误报）', () => {
        const report = buildFourCheckReport({ ...base, hook: { required: 1, hookType: '悬念', present: null } });
        const hook = item(report, 'hook');
        expect(hook.status).toBe('skip');
        expect(hook.message).toContain('未写钩子内容');
    });

    it('末段检出钩子 → pass', () => {
        const report = buildFourCheckReport({ ...base, hook: { required: 1, hookType: '反转', present: true } });
        expect(item(report, 'hook').status).toBe('pass');
        expect(item(report, 'hook').message).toContain('反转');
    });

    it('末段未检出钩子 → warn（人工复核，不阻断）', () => {
        const report = buildFourCheckReport({ ...base, hook: { required: 1, hookType: '危机', present: false } });
        const hook = item(report, 'hook');
        expect(hook.status).toBe('warn');
        expect(hook.message).toContain('建议人工复核结尾');
    });
});

describe('聚合与渲染', () => {
    it('warnCount 只数 warn/fail，顺序固定为字数→格式→视角→钩子', () => {
        const report = buildFourCheckReport({
            ...base,
            wordCount: 1000,
            hook: { required: 1, present: false },
        });
        expect(report.items.map(i => i.id)).toEqual(['wordCount', 'format', 'perspective', 'hook']);
        expect(report.warnCount).toBe(2);
        expect(report.checkedAt).toBe(base.now);
        expect(report.summary).toContain('2 项待关注');
    });

    it('全部通过时摘要写明', () => {
        const report = buildFourCheckReport({
            ...base,
            format: { ratio: 0, indentMissing: 0, blankLineBreaks: 0, titleStripped: 0, metaStripped: 0 },
            perspective: { first: 0, third: 5, mixed: false, ratio: 0 },
            hook: { required: 1, present: true },
        });
        expect(report.summary).toContain('全部通过');
        expect(fourCheckAttentionItems(report)).toHaveLength(0);
    });

    it('渲染文本每项一行且带图标', () => {
        const report = buildFourCheckReport({ ...base, wordCount: 1000 });
        const text = renderFourCheckReport(report);
        expect(text).toContain('本章四项校验 · 第3章');
        expect(text.split('\n')).toHaveLength(6);
        expect(text).toContain('❌ [字数]');
    });
});

describe('面板文案（放在 shared，避开 ui 中文棘轮）', () => {
    it('无记录占位带章节名，空章节用「当前章节」', () => {
        expect(describeFourCheckEmpty('第3章')).toContain('暂无「第3章」');
        expect(describeFourCheckEmpty('')).toContain('暂无「当前章节」');
    });

    it('首行 = 摘要 + 检查时间', () => {
        const report = buildFourCheckReport({ ...base, wordCount: 1000 });
        const text = describeFourCheckHeader(report, '2026-11-22 17:00');
        expect(text).toBe(`${report.summary}（2026-11-22 17:00）`);
    });
});
