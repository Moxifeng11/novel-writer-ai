/**
 * quality-fix.ts — 质量控制报告的「AI 修复」纯逻辑
 *
 * 从 `ui/co-writing-view.ts` 抽出：定位问题文本、构建修复 Prompt、
 * 决定替换/追加/放弃，以及按行号估算滚动位置。DOM 弹窗与异步调用仍由视图负责。
 */
import type { QualityIssue } from './quality-report';

/** 问题文本在正文中的定位结果。 */
export interface QualityTarget {
    /** 起始下标 */
    start: number;
    /** 结束下标 */
    end: number;
    /** 目标前 200 字上下文 */
    contextBefore: string;
    /** 目标原文 */
    targetText: string;
    /** 目标后 200 字上下文 */
    contextAfter: string;
}

/** 修复结果：替换 / 追加 / 原文已变 / 无操作。 */
export type QualityFixApplication =
    | { kind: 'replace'; newText: string; selection: number }
    | { kind: 'append'; newText: string; selection: number }
    | { kind: 'stale' }
    | { kind: 'noop' };

/**
 * 在正文中定位问题文本。
 *
 * @param fullText - 正文全文
 * @param locationText - 报告中的定位文本
 * @returns 定位结果；文本过短或未命中返回 null
 * @example
 * ```ts
 * locateQualityTarget('……', '第3段');
 * ```
 */
export function locateQualityTarget(fullText: string, locationText: string): QualityTarget | null {
    if (!locationText || locationText.length < 2) return null;
    const start = fullText.indexOf(locationText);
    if (start < 0) return null;
    const end = start + locationText.length;
    const contextBefore = start > 0 ? fullText.slice(Math.max(0, start - 200), start) : '';
    const targetText = fullText.slice(start, end);
    const contextAfter = end > 0 ? fullText.slice(end, Math.min(fullText.length, end + 200)) : '';
    return { start, end, contextBefore, targetText, contextAfter };
}

/**
 * 构建 AI 修复 Prompt。
 *
 * @param issue - 质量问题
 * @param target - 定位结果（null = 未定位）
 * @returns Prompt 文本
 * @example
 * ```ts
 * buildQualityFixPrompt(issue, locateQualityTarget(text, issue.locationText));
 * ```
 */
export function buildQualityFixPrompt(issue: QualityIssue, target: QualityTarget | null): string {
    const contextBefore = target?.contextBefore || '';
    const targetText = target?.targetText || '';
    const contextAfter = target?.contextAfter || '';
    return [
        '你是一个小说编辑AI。请根据质量报告对正文中的问题进行修复。',
        '',
        '【问题】',
        issue.problem,
        '',
        '【修改建议】',
        issue.suggestion,
        '',
        contextBefore ? '【前文】' : '',
        contextBefore ? contextBefore.slice(-150) : '',
        '',
        targetText ? '【需修改的文本】' : '',
        targetText || '（未定位到具体文本，将基于上下文判断）',
        '',
        contextAfter ? '【后文】' : '',
        contextAfter ? contextAfter.slice(0, 150) : '',
        '',
        '请直接输出修改后的文本片段。只输出正文，不加解释。',
    ].filter(Boolean).join('\n');
}

/**
 * 决定如何应用 AI 修复结果。
 *
 * @param currentText - 响应到达时的正文全文
 * @param target - 请求时的定位结果
 * @param fixedText - AI 返回的修复文本
 * @returns 应用方式
 * @example
 * ```ts
 * const plan = resolveQualityFixApplication(editor.value, target, fixedText);
 * ```
 */
export function resolveQualityFixApplication(
    currentText: string,
    target: QualityTarget | null,
    fixedText: string,
): QualityFixApplication {
    if (!fixedText) return { kind: 'noop' };
    if (target) {
        // 请求期间用户可能继续输入：旧实现用请求前的全文快照重建整篇，
        // 把这段时间的输入全部抹掉。这里只在目标区间原文未变时替换该区间。
        const currentSlice = currentText.slice(target.start, target.end);
        if (currentSlice !== target.targetText) return { kind: 'stale' };
        const newText = currentText.slice(0, target.start) + fixedText + currentText.slice(target.end);
        return { kind: 'replace', newText, selection: target.start + fixedText.length };
    }
    // 未定位到原文时只追加建议，绝不覆盖用户正文
    const appended = currentText + '\n\n【AI修复建议】\n' + fixedText;
    return { kind: 'append', newText: appended, selection: appended.length };
}

/**
 * 按字符下标估算 textarea 滚动位置。
 *
 * @param text - 全文
 * @param charIndex - 字符下标
 * @param lineHeight - 行高（默认 20）
 * @returns 顶部偏移
 * @example
 * ```ts
 * lineTopForIndex(editor.value, idx);
 * ```
 */
export function lineTopForIndex(text: string, charIndex: number, lineHeight = 20): number {
    const lines = text.slice(0, charIndex).split('\n');
    return lines.length * lineHeight;
}
