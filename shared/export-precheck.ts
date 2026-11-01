/**
 * export-precheck.ts — 导出前质量门槛的文案组装（纯函数）
 *
 * 导出不应静默打包半成品：长篇列出未结算/未质控的章，短篇/剧本列出未完成的单元。
 * 只告警不阻断——用户明确点了导出，就按当前内容导出，但要知道缺什么。
 */

import type { CreationMode } from './creation-mode';

export interface ExportPrecheckInput {
    mode: CreationMode;
    /** 长篇：正文 frontmatter status 未到 settled 的章 */
    unsettled?: string[];
    /** 长篇：缺质控步骤产物的章 */
    unreviewed?: string[];
    /** 短篇/剧本：没有正文内容或 status 未完成的单元 */
    unfinished?: string[];
    /** 每类最多列出多少个名字，默认 5 */
    maxListed?: number;
}

const LABEL: Record<CreationMode, string> = {
    long: '章',
    short: '节',
    script: '集',
};

function listNames(names: string[], maxListed: number): string {
    const shown = names.slice(0, maxListed).join('、');
    return names.length > maxListed ? `${shown}…` : shown;
}

/** 返回 Notice 文案；无需告警时返回 null */
export function formatExportPrecheck(input: ExportPrecheckInput): string | null {
    const maxListed = input.maxListed ?? 5;
    const parts: string[] = [];
    const unit = LABEL[input.mode] ?? '章';

    const unsettled = input.unsettled ?? [];
    const unreviewed = input.unreviewed ?? [];
    const unfinished = input.unfinished ?? [];

    if (unsettled.length > 0) {
        parts.push(`未结算 ${unsettled.length} ${unit}（${listNames(unsettled, maxListed)}）`);
    }
    if (unreviewed.length > 0) {
        parts.push(`未过质控 ${unreviewed.length} ${unit}（${listNames(unreviewed, maxListed)}）`);
    }
    if (unfinished.length > 0) {
        parts.push(`未完成 ${unfinished.length} ${unit}（${listNames(unfinished, maxListed)}）`);
    }

    if (parts.length === 0) return null;
    return `📋 导出前检查：${parts.join('；')}。已按当前内容导出，建议完成后再导出成稿。`;
}
