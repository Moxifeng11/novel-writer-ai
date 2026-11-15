/**
 * quality-loop-model.ts — 质量闭环面板的纯展示逻辑（B1/B2/B4 的界面侧）
 *
 * 面板本身只做「取数 → 展示 → 触发」，所有格式化/判定放在这里，便于单测，
 * 也避免 UI 里堆分支（视图测试门禁要求可测的纯逻辑）。
 */

import { CHECK_KIND_LABELS, type QualityPanelSummary, type QualityRecord } from './quality-panel-model';
import type { CheckSeverity } from './post-generation-check-model';

/** 章节下拉选项 */
export interface QualityChapterOption {
    /** 章节名（真实路径名，用于调用 API） */
    name: string;
    /** 显示标签 */
    label: string;
}

/**
 * 选默认章节：优先生效中的工作台章节，其次第一章。
 *
 * @param chapters - 章节名列表
 * @param preferred - 工作台当前章节名（可空）
 * @returns 选中的章节名；列表为空返回 ''
 * @example
 * ```ts
 * pickQualityChapter(['第一章', '第二章'], '第二章'); // '第二章'
 * pickQualityChapter(['第一章'], null);                // '第一章'
 * pickQualityChapter([], null);                        // ''
 * ```
 */
export function pickQualityChapter(chapters: readonly string[], preferred?: string | null): string {
    if (chapters.length === 0) return '';
    const target = String(preferred ?? '').trim();
    if (target) {
        const hit = chapters.find(name => name === target) ?? chapters.find(name => name.includes(target) || target.includes(name));
        if (hit) return hit;
    }
    return chapters[0];
}

/**
 * 把面板汇总格式化成行文本（空面板返回提示行）。
 *
 * @param summary - 汇总
 * @returns 行文本
 * @example
 * ```ts
 * describeQualitySummary({ total: 0, passed: 0, passRate: 0, pendingHuman: 0, kindRanking: [], avgRevisionRounds: 0, recent: [] });
 * // ['还没有校验记录：先点「运行校验」跑一次。']
 * ```
 */
export function describeQualitySummary(summary: QualityPanelSummary): string[] {
    if (summary.total === 0) return ['还没有校验记录：先点「运行校验」跑一次。'];
    const lines = [
        `累计 ${summary.total} 次校验 · 通过率 ${summary.passRate}%（通过 ${summary.passed}）`,
        `平均修订轮次 ${summary.avgRevisionRounds}${summary.pendingHuman > 0 ? ` · 待人工 ${summary.pendingHuman}` : ''}`,
    ];
    if (summary.kindRanking.length > 0) {
        lines.push(`问题类型：${summary.kindRanking.map(item => `${CHECK_KIND_LABELS[item.kind]} ${item.count}`).join(' · ')}`);
    }
    return lines;
}

/**
 * 格式化时间戳（本地时间，月-日 时:分）。
 *
 * @param timestamp - 毫秒时间戳
 * @returns 文本；非法值返回 '—'
 * @example
 * ```ts
 * formatCheckedAt(0); // '—'
 * ```
 */
export function formatCheckedAt(timestamp: number): string {
    if (!Number.isFinite(timestamp) || timestamp <= 0) return '—';
    const date = new Date(timestamp);
    const pad = (value: number): string => String(value).padStart(2, '0');
    return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * 单条历史记录的结论标签。
 *
 * @param record - 记录
 * @returns 文本
 * @example
 * ```ts
 * describeRecordResult({ chapterName: '第一章', checkedAt: 1, passed: true, counts: { error: 0, warn: 0, info: 0 }, kinds: {}, revisionRounds: 0 }); // '✅ 通过'
 * ```
 */
export function describeRecordResult(record: QualityRecord): string {
    if (record.abortedReason) return `⚠️ 中止：${record.abortedReason}`;
    if (record.pendingHuman) return '🖐 待人工';
    return record.passed ? '✅ 通过' : '❌ 未通过';
}

/**
 * 严重度计数 → 一行摘要。
 *
 * @param counts - 计数
 * @returns 文本
 * @example
 * ```ts
 * describeSeverityCounts({ error: 1, warn: 2, info: 0 }); // '❌ 1 · ⚠️ 2'
 * ```
 */
export function describeSeverityCounts(counts: Record<CheckSeverity, number>): string {
    const parts: string[] = [];
    if (counts.error > 0) parts.push(`❌ ${counts.error}`);
    if (counts.warn > 0) parts.push(`⚠️ ${counts.warn}`);
    if (counts.info > 0) parts.push(`ℹ️ ${counts.info}`);
    return parts.length > 0 ? parts.join(' · ') : '无问题';
}

/**
 * 描述定向修订结果。
 *
 * @param outcome - 修订结果（结构化裁剪）
 * @returns 文本
 * @example
 * ```ts
 * describeRevisionOutcome({ passed: true, attempts: 1, wrote: true, rounds: [3], pending: [] });
 * // '✅ 修订通过（1 轮，已落盘）。'
 * ```
 */
export function describeRevisionOutcome(outcome: {
    passed: boolean;
    attempts: number;
    wrote: boolean;
    rounds: readonly number[];
    pending: readonly unknown[];
    abortedReason?: string;
}): string {
    if (outcome.abortedReason) return `⚠️ 修订中止：${outcome.abortedReason}`;
    const rounds = outcome.rounds.length > 0 ? outcome.rounds.join(' → ') : '0';
    const write = outcome.wrote ? '已落盘' : '未落盘';
    if (outcome.passed) return `✅ 修订通过（${outcome.attempts} 轮，问题数 ${rounds}，${write}）。`;
    return `🖐 仍有 ${outcome.pending.length} 条未解决（${outcome.attempts} 轮，问题数 ${rounds}，${write}），已标记待人工。`;
}

/**
 * 章节列表 → 下拉选项。
 *
 * @param chapters - 章节名列表
 * @returns 选项
 * @example
 * ```ts
 * toChapterOptions(['第一章']); // [{ name: '第一章', label: '第一章' }]
 * ```
 */
export function toChapterOptions(chapters: readonly string[]): QualityChapterOption[] {
    return chapters.map(name => ({ name, label: name }));
}
