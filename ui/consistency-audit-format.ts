/**
 * consistency-audit-format.ts — 审核视图的纯展示逻辑
 *
 * 从 Modal 里抽出来的原因（门禁 check:view-tests 的建议，也是更好的结构）：
 * 「字符偏移 → 行号」「置信度文案」「证据标题」这类判定/格式化逻辑应当可单测，
 * 不必依赖 DOM。Modal 只负责组装 DOM。
 */

import {
    ASSERTION_KIND_META,
    type ConsistencyContradiction,
    type ConsistencyEvidence,
} from '@/engine/consistency/assertion-model';

/**
 * 字符偏移 → 行号（0 基）。
 *
 * @param content - 文件内容
 * @param offset - 字符偏移（越界会被夹到合法范围）
 * @returns 行号（0 基）
 */
export function offsetToLine(content: string, offset: number): number {
    const text = content || '';
    const safe = Math.max(0, Math.min(offset, text.length));
    let line = 0;
    for (let i = 0; i < safe; i++) {
        if (text[i] === '\n') line++;
    }
    return line;
}

/**
 * 置信度文案（百分比，无小数）。
 *
 * @param confidence - 0–1
 * @returns 形如「置信度 92%」
 */
export function formatConfidence(confidence: number): string {
    const clamped = Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0;
    return `置信度 ${(clamped * 100).toFixed(0)}%`;
}

/**
 * 判定来源文案。
 *
 * @param decidedBy - rule / llm
 * @returns 中文文案
 */
export function formatDecisionSource(decidedBy: 'rule' | 'llm'): string {
    return decidedBy === 'rule' ? '规则判定' : '模型复核';
}

/**
 * 卡片头部的一行元信息。
 *
 * @param c - 矛盾
 * @returns 形如「置信度 92% ｜ 规则判定」
 */
export function formatMetaLine(c: Pick<ConsistencyContradiction, 'confidence' | 'decidedBy'>): string {
    return `${formatConfidence(c.confidence)} ｜ ${formatDecisionSource(c.decidedBy)}`;
}

/**
 * 类型徽章文案与严重度样式后缀。
 *
 * @param kind - 断言种类
 * @returns 标签与样式后缀
 */
export function formatKindBadge(kind: ConsistencyContradiction['kind']): { label: string; severity: 'high' | 'medium' } {
    const meta = ASSERTION_KIND_META[kind];
    return { label: meta.label, severity: meta.severity };
}

/**
 * 证据行的章节显示文案（人物档案/事实索引没有章节）。
 *
 * @param evidence - 证据
 * @returns 章节文案
 */
export function formatEvidenceChapter(evidence: Pick<ConsistencyEvidence, 'chapterKey'>): string {
    return evidence.chapterKey || '（人物档案/事实索引）';
}

/**
 * 证据引文的悬浮标题（说明能否定位）。
 *
 * @param evidence - 证据
 * @returns 标题文案
 */
export function formatEvidenceTitle(evidence: Pick<ConsistencyEvidence, 'offset'>): string {
    return evidence.offset === undefined
        ? '引文（正文中未定位到位置）'
        : `正文字符偏移 ${evidence.offset}`;
}

/**
 * 是否可跳转到正文（有偏移且是章节级证据）。
 *
 * @param evidence - 证据
 * @returns 是否可跳转
 */
export function canJumpToEvidence(evidence: Pick<ConsistencyEvidence, 'offset' | 'chapterKey'>): boolean {
    return evidence.offset !== undefined && Boolean(evidence.chapterKey);
}

/**
 * 空态说明文案（告诉用户「检查了什么、依据什么」，避免误以为是全量保证）。
 *
 * @returns 说明行
 */
export function buildEmptyStateHint(): string {
    return '说明：本检查基于章节摘要中记录的事实、人物档案中的结构化字段、'
        + '时间线/伏笔台账，以及已确认的事实索引。若这些来源本身缺失，结果会偏少。';
}
