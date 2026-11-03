/**
 * revision-guard.ts — 修订闭环的「只接受更优版本」闸门（纯函数）
 *
 * 定向修订此前直接覆盖正文：模型把剧情改硬、把对话改成叙述、或返回一段 JSON，
 * 都会静默替换掉原稿。这里给出可判定的接受条件，失败就保留原稿：
 *
 *   1. 长度 ±10%（允许微调，不允许删戏/扩写）
 *   2. 「锁定人物名」一个都不能丢（防 OOC/换人）
 *   3. 对话占比下降不超过 5 个百分点（防把对话改成叙述）
 *   4. 不能原样返回，也不能是 JSON/代码块（模型没照做）
 */

import { analyzeHumanFeatures } from '@/shared/human-feature-rubric';
import { AntiAIDetector } from '@/engine/anti-ai-detector';

/**
 * 修订闸门结果。
 */
export interface RevisionGateResult {
    accept: boolean;
    reasons: string[];
    metrics: {
        lengthRatio: number;
        dialogueDelta: number;
        missingNames: string[];
        identical: boolean;
    };
}

/**
 * 闸门选项。
 */
export interface RevisionGateOptions {
    /** 原稿里出现、必须保留的人物名 */
    lockedNames?: readonly string[];
    minLengthRatio?: number;
    maxLengthRatio?: number;
    /** 对话占比允许的最大跌幅（0.05 = 5 个百分点） */
    maxDialogueDrop?: number;
}

const GENERIC_NAMES = new Set(['主角', '主人公', '角色', '人物', '姓名', '名称', '旁白']);

/**
 * 从 `${allChars}` 这类「- 名字：…」块里抽人物名
 *
 * @param charBlock - 字符块
 * @returns 结果数组
 */
export function extractCharacterNames(charBlock: string | undefined): string[] {
    const names: string[] = [];
    for (const line of String(charBlock || '').split('\n')) {
        const match = line.match(/^\s*-\s*([^：:｜|]{2,12})[：:｜|]/);
        if (!match) continue;
        const name = match[1].trim();
        if (!name || GENERIC_NAMES.has(name) || names.includes(name)) continue;
        names.push(name);
    }
    return names.slice(0, 24);
}

/**
 * 只锁定「原稿里真的出现过」的名字，避免要求模型凭空补人
 *
 * @param originalText - 原始文本
 * @param candidates - 候选
 * @returns 结果数组
 */
export function collectLockedNames(originalText: string, candidates: readonly string[]): string[] {
    const text = String(originalText || '');
    return candidates.filter((name) => name.length >= 2 && text.includes(name)).slice(0, 20);
}

const charCount = (text: string): number => String(text || '').replace(/\s+/g, '').length;

/**
 * 判定是否接受修订稿；返回中文原因（accept=false 时非空）
 *
 * @param before - 变更前内容
 * @param after - 变更后内容
 * @param options - 配置项
  * @returns RevisionGateResult 实例
 */
export function evaluateRevision(
    before: string,
    after: string,
    options: RevisionGateOptions = {},
): RevisionGateResult {
    const original = String(before || '');
    const revised = String(after || '').trim();
    const originalChars = charCount(original);
    const revisedChars = charCount(revised);
    const lengthRatio = originalChars === 0 ? 0 : revisedChars / originalChars;
    const minRatio = options.minLengthRatio ?? 0.9;
    const maxRatio = options.maxLengthRatio ?? 1.1;
    const maxDialogueDrop = options.maxDialogueDrop ?? 0.05;
    const locked = options.lockedNames || [];

    const originalMetrics = analyzeHumanFeatures(original);
    const revisedMetrics = analyzeHumanFeatures(revised);
    const dialogueDelta = revisedMetrics.dialogueRatio - originalMetrics.dialogueRatio;
    const missingNames = locked.filter((name) => !revised.includes(name));
    const identical = revised !== '' && revised === original.trim();

    const reasons: string[] = [];
    if (!revised) reasons.push('修订稿为空');
    if (revised && (revised.startsWith('{') || revised.includes('```json'))) {
        reasons.push('修订稿看起来是 JSON/代码块，不是正文');
    }
    if (revised && identical) reasons.push('修订稿与原稿完全相同（无改动）');
    if (revised && lengthRatio < minRatio) reasons.push(`字数减少 ${((1 - lengthRatio) * 100).toFixed(0)}%（超过 ${Math.round((1 - minRatio) * 100)}% 上限）`);
    if (revised && lengthRatio > maxRatio) reasons.push(`字数增加 ${((lengthRatio - 1) * 100).toFixed(0)}%（超过 ${Math.round((maxRatio - 1) * 100)}% 上限）`);
    if (missingNames.length > 0) reasons.push(`丢失锁定人物：${missingNames.join('、')}`);
    if (dialogueDelta < -maxDialogueDrop) {
        reasons.push(`对话占比下降 ${(Math.abs(dialogueDelta) * 100).toFixed(0)} 个百分点（上限 ${Math.round(maxDialogueDrop * 100)}）`);
    }

    return {
        accept: reasons.length === 0,
        reasons,
        metrics: { lengthRatio, dialogueDelta, missingNames, identical },
    };
}

/** 复检结果（v4.25）：不重跑 14 项，只给可比的量化对照 */
export interface RevisionRecheck {
    /** 采纳前的闸门结论（拒绝时不做复检） */
    accepted: boolean;
    /** AI 味分（0-100，越高越像 AI）；负数表示修订后更低（改善） */
    aiScoreBefore: number;
    aiScoreAfter: number;
    aiScoreDelta: number;
    /** 对话占比 / 短叙述占比对照 */
    dialogueBefore: number;
    dialogueAfter: number;
    shortNarrationBefore: number;
    shortNarrationAfter: number;
    /** 问题证据关键词仍出现在修订稿中的条数（提示性，不阻断） */
    keywordHits: number;
    summary: string;
}

/**
 * 修订复检：单次量化对照，不消耗额外模型调用。
 * AI 味上升 / 对话占比明显下滑时在 summary 里给出「建议人工复核」提示。
 * @param before - 变更前内容
 * @param after - 变更后内容
 * @param issues - 问题列表
 * @param options - 配置项
  * @returns RevisionRecheck 实例
 */
export function recheckRevision(
    before: string,
    after: string,
    issues: ReadonlyArray<{ evidence?: string }>,
    options: { lockedNames?: readonly string[] } = {},
): RevisionRecheck {
    const detector = new AntiAIDetector();
    const aiScoreBefore = detector.score(before);
    const aiScoreAfter = detector.score(after);
    const beforeMetrics = analyzeHumanFeatures(before);
    const afterMetrics = analyzeHumanFeatures(after);
    const keywordHits = issues.filter((issue) => {
        const tokens = String(issue.evidence || '')
            .match(/[\u4e00-\u9fa5]{4,}/g) || [];
        if (tokens.length === 0) return false;
        return tokens.every((token) => after.includes(token));
    }).length;
    const gate = evaluateRevision(before, after, options);

    const parts = [
        `AI味 ${aiScoreBefore.toFixed(0)}→${aiScoreAfter.toFixed(0)}（${aiScoreAfter - aiScoreBefore >= 0 ? '+' : ''}${(aiScoreAfter - aiScoreBefore).toFixed(0)}）`,
        `对话 ${(beforeMetrics.dialogueRatio * 100).toFixed(0)}%→${(afterMetrics.dialogueRatio * 100).toFixed(0)}%`,
        `短叙述 ${(beforeMetrics.shortNarrationShare * 100).toFixed(0)}%→${(afterMetrics.shortNarrationShare * 100).toFixed(0)}%`,
        `未消化问题线索 ${keywordHits}/${issues.length}`,
    ];
    const warnings: string[] = [];
    if (aiScoreAfter - aiScoreBefore > 10) warnings.push('AI 味分明显上升，建议人工复核');
    if (afterMetrics.dialogueRatio < beforeMetrics.dialogueRatio - 0.05) warnings.push('对话占比明显下滑，建议人工复核');

    return {
        accepted: gate.accept,
        aiScoreBefore,
        aiScoreAfter,
        aiScoreDelta: aiScoreAfter - aiScoreBefore,
        dialogueBefore: beforeMetrics.dialogueRatio,
        dialogueAfter: afterMetrics.dialogueRatio,
        shortNarrationBefore: beforeMetrics.shortNarrationShare,
        shortNarrationAfter: afterMetrics.shortNarrationShare,
        keywordHits,
        summary: parts.join('；') + (warnings.length > 0 ? ` ⚠ ${warnings.join('，')}` : ''),
    };
}
