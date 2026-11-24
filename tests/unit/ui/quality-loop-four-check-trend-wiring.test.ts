/**
 * quality-loop-four-check-trend-wiring.test.ts — 面板趋势接线断言（P1-1）
 *
 * 趋势的构建/文案已在 `tests/unit/shared/four-check-trend.test.ts` 用真函数锁死；
 * 这里只锁「面板确实接线了」这一件纯源码事实：
 * 1. `renderFourChecks()` 会调用 `renderFourCheckTrend()`（本章区与趋势区都要出）；
 * 2. 趋势渲染使用 `buildFourCheckTrend` 与 `describeFourCheckTrendRow`（不是复制一套逻辑）；
 * 3. 空态用 `FOUR_CHECK_TREND_EMPTY` 占位。
 *
 * 为什么要断言源码而不是渲染 DOM：`QualityLoopModal` 依赖 Obsidian `Setting`/`Modal`，
 * 假 DOM 夹具只能覆盖到 contentEl 一部分，接线断掉时渲染测试不一定红；而接线是纯文本事实。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('ui/quality-loop-modal.ts', 'utf8');

describe('质量面板四项校验趋势接线（P1-1）', () => {
    it('renderFourChecks 调用 renderFourCheckTrend（本章与趋势都渲染）', () => {
        expect(source).toMatch(/private renderFourChecks\(\): void \{/);
        expect(source).toMatch(/this\.renderFourCheckTrend\(el\);/);
    });

    it('趋势渲染走 shared 的唯一实现（构建 + 行文本 + 空态）', () => {
        expect(source).toMatch(/buildFourCheckTrend\(this\.fourChecks\)/);
        expect(source).toMatch(/describeFourCheckTrendRow\(/);
        expect(source).toMatch(/FOUR_CHECK_TREND_EMPTY/);
        expect(source).toMatch(/describeFourCheckTrendTitle\(/);
    });

    it('「本章无记录」不再提前 return（趋势区仍要渲染）', () => {
        // 旧实现在无本章报告时 return，会把趋势区一起跳过
        const fn = source.slice(source.indexOf('private renderFourChecks()'));
        const body = fn.slice(0, fn.indexOf('private renderFourCheckTrend'));
        expect(body).not.toMatch(/return;\s*\}\s*el\.createEl\('p', \{ text: describeFourCheckHeader/);
    });
});
