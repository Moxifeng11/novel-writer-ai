/**
 * ai-detection-report.ts — AI 味检测报告渲染组件（UI 可视化，P0-1）
 *
 * 纯展示组件：接收正文文本，调用 AntiAIDetector.detect 得到检测结果，
 * 渲染「评分 + 雷达图 + 命中短语 + 修改建议」四部分。
 * 零副作用：不修改任何全局状态，仅操作传入的 container；不引入新依赖（复用现有 radarChart）。
 */

import { AntiAIDetector } from '../../engine/anti-ai-detector';
import { radarChart } from '../svg-charts';

type ScoreLevel = 'low' | 'medium' | 'high';

function scoreLevel(score: number): ScoreLevel {
    if (score < 30) return 'low';
    if (score < 60) return 'medium';
    return 'high';
}

function levelLabel(score: number): string {
    if (score < 30) return '人味正常';
    if (score < 60) return '疑似 AI 味';
    return '明显 AI 味';
}

/**
 * 渲染 AI 味检测报告到指定容器。
 * @param container 目标容器（会被清空后写入）
 * @param text 待检测的正文文本
 *
 * @example
 * ```ts
 * const el = document.createElement('div');
 * renderAIDetectionReport(el, '他的眼神像一潭死水……');
 * container.appendChild(el);
 * ```
 */
export function renderAIDetectionReport(container: HTMLElement, text: string): void {
    const detector = new AntiAIDetector();
    const result = detector.detect(text);

    container.empty();
    container.addClass('nw-ai-report');

    // 1. 头部：标题 + 评分 + 等级
    const head = container.createDiv({ cls: 'nw-ai-report-head' });
    head.createSpan({ cls: 'nw-ai-report-title', text: '🤖 AI 味检测' });
    const scoreWrap = head.createDiv({ cls: 'nw-ai-report-score-wrap' });
    scoreWrap.createSpan({
        cls: `nw-ai-report-score nw-ai-report-score-${scoreLevel(result.score)}`,
        text: String(result.score),
    });
    scoreWrap.createSpan({ cls: 'nw-ai-report-score-unit', text: '分' });
    head.createSpan({
        cls: `nw-ai-report-level nw-ai-report-level-${scoreLevel(result.score)}`,
        text: levelLabel(result.score),
    });

    // 2. 雷达图（至少 3 个维度才渲染）
    if (result.features.length >= 3) {
        const chart = container.createDiv({ cls: 'nw-ai-report-chart' });
        chart.innerHTML = radarChart(
            result.features.map(f => ({ label: f.displayName, value: f.value })),
            { size: 280, title: 'AI 味特征' },
        );
    }

    // 3. 评分构成（各分项的原始得分与相对占比，用于定位主要 AI 味来源）
    const scored = result.features.filter(f => typeof f.score === 'number' && f.score > 0);
    const weightSum = scored.reduce((sum, f) => sum + (f.score || 0), 0);
    if (scored.length > 0 && weightSum > 0) {
        const breakdown = container.createDiv({ cls: 'nw-ai-report-breakdown' });
        breakdown.createDiv({ cls: 'nw-ai-report-section-title', text: '评分构成（相对贡献）' });
        for (const f of [...scored].sort((a, b) => (b.score || 0) - (a.score || 0))) {
            const share = Math.round(((f.score || 0) / weightSum) * 100);
            breakdown.createDiv({
                cls: 'nw-ai-report-suggestion',
                text: `• ${f.displayName}：${(f.score || 0).toFixed(1)} 分 · 占比 ${share}%`,
            });
        }
    }

    // 4. 命中模板短语（仅 L2/L3，去重，最多 8 个）
    const l2l3 = result.hits.filter(h => h.type === 'l2' || h.type === 'l3');
    const unique = [...new Set(l2l3.map(h => h.text))].slice(0, 8);
    if (unique.length > 0) {
        const hits = container.createDiv({ cls: 'nw-ai-report-hits' });
        hits.createDiv({ cls: 'nw-ai-report-section-title', text: `命中 ${unique.length} 处模板短语` });
        const hitList = hits.createDiv({ cls: 'nw-ai-report-hit-list' });
        for (const phrase of unique) {
            hitList.createDiv({ cls: 'nw-ai-report-hit', text: phrase });
        }
    }

    // 5. 修改建议
    if (result.suggestions.length > 0) {
        const sug = container.createDiv({ cls: 'nw-ai-report-suggestions' });
        sug.createDiv({ cls: 'nw-ai-report-section-title', text: '修改建议' });
        for (const s of result.suggestions) {
            sug.createDiv({ cls: 'nw-ai-report-suggestion', text: `• ${s}` });
        }
    }
}
