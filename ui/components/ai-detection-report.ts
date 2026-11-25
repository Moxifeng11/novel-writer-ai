/**
 * ai-detection-report.ts — AI 特征命中报告（纯展示组件）
 *
 * ## 2026-11-25 重大改版
 *
 * 旧版把 `AntiAIDetector.detect().score` 当成「AI 味分数」大字展示（0-100 分 + 雷达图 + 占比）。
 * 实测证明**这个分数排序是反的**：
 * - 真人网文 7 部 → 10.6 分（朱雀 100% 人工）
 * - 云笔 5570 → 9.0 分（朱雀 42.3% 人工）
 * - AI 模板 → 14.0 分（朱雀 0%）
 *
 * 真人分比云笔还高，AI 模板只有 14 分。用这个分数做任何判断都会误导。
 *
 * 新版只展示**可解释的具体命中**：
 * - 命中了哪些模板短语 / 句式（具体词句，用户能自己判断要不要改）
 * - 各特征的出现次数（不是加权分数）
 * - 不做「AI 味 X 分」的伪精确展示
 *
 * 需要人味判据时用 `engine/zhuque-detector.ts`（真实 AIGC 检测）。
 */

import { AntiAIDetector } from '@/engine/anti-ai-detector';
import { t } from '@/i18n';

/** 单条命中（与 AntiAIDetector.detectWithPositions 的输出兼容） */
export interface AIDetectionHitLike {
    type: 'l1' | 'l2' | 'l3';
    text: string;
    start: number;
    end: number;
    weight: number;
}

/** 命中类型标签 → i18n key */
const HIT_TYPE_KEY: Record<string, string> = {
    l1: 'cowrite.aiReport.typeL1',
    l2: 'cowrite.aiReport.typeL2',
    l3: 'cowrite.aiReport.typeL3',
};

/**
 * 渲染 AI 特征命中报告。
 *
 * 只展示「命中了什么」，不展示「AI 味多少分」——后者实测不可信。
 *
 * @param container - 挂载容器（会被清空后写入）
 * @param text - 待检测的正文文本
 * @example
 * ```ts
 * const el = document.createElement('div');
 * renderAIDetectionReport(el, '他的眼神像一潭死水……');
 * ```
 */
export function renderAIDetectionReport(container: HTMLElement, text: string): void {
    const detector = new AntiAIDetector();
    const hits = detector.detectWithPositions(text);

    container.empty();
    container.addClass('nw-ai-report');

    // 1. 头部：只给命中总数，不给分数
    const head = container.createDiv({ cls: 'nw-ai-report-head' });
    head.createSpan({ cls: 'nw-ai-report-title', text: t('cowrite.aiReport.title') });
    head.createSpan({
        cls: 'nw-ai-report-count',
        text: hits.length > 0
            ? t('cowrite.aiReport.count', { count: String(hits.length) })
            : t('cowrite.aiReport.none'),
    });

    // 2. 说明：为什么不给分数
    const note = container.createDiv({ cls: 'nw-ai-report-note' });
    note.createSpan({ text: t('cowrite.aiReport.note') });

    if (hits.length === 0) return;

    // 3. 按类型分组计数
    const byType = new Map<string, AIDetectionHitLike[]>();
    for (const h of hits) {
        const list = byType.get(h.type) || [];
        list.push(h);
        byType.set(h.type, list);
    }

    // 4. 逐类型列出具体命中（去重，每类最多 10 个）
    const groups = container.createDiv({ cls: 'nw-ai-report-groups' });
    for (const [type, list] of byType) {
        const unique = [...new Set(list.map(h => h.text))].slice(0, 10);
        const group = groups.createDiv({ cls: 'nw-ai-report-group' });
        group.createDiv({
            cls: 'nw-ai-report-section-title',
            text: t('cowrite.aiReport.groupTitle', {
                type: t(HIT_TYPE_KEY[type] || ''),
                hits: String(list.length),
                unique: String(unique.length),
            }),
        });
        const hitList = group.createDiv({ cls: 'nw-ai-report-hit-list' });
        for (const phrase of unique) {
            hitList.createDiv({ cls: 'nw-ai-report-hit', text: phrase });
        }
        if (unique.length < list.length) {
            group.createDiv({
                cls: 'nw-ai-report-more',
                text: t('cowrite.aiReport.more', { count: String(list.length - unique.length) }),
            });
        }
    }
}
