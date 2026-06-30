/** 信息债判断工具 — 检查章节的信息规划和大纲摘要是否完整 */

import { INFOPLAN_CHECK_FIELDS, INFOPLAN_LEGACY_FIELDS, OUTLINE_CHECK_FIELDS } from './format-constants';

/** 检查信息规划是否完整（需包含章名、核心冲突、熵预算等 6 个关键字段） */
export function isInfoPlanComplete(content: string): boolean {
    if (!content || content.length < 30) return false;
    const fields: readonly string[] = INFOPLAN_CHECK_FIELDS;
    // 尝试匹配模板格式的字段
    let matchedFields = 0;
    for (const f of fields) {
        const m = content.match(new RegExp(f + '[：:][\\s\\S]*?(?=\\n##|\\n---|$)'));
        if (m && m[0].replace(/^.*?[：:]/, '').trim().length >= 5) matchedFields++;
    }
    // 至少匹配到 4/6 个字段即认为完整（兼容旧格式文件）
    if (matchedFields >= 4) return true;
    // 回退：检查旧格式文件的核心字段
    const legacyFields: readonly string[] = INFOPLAN_LEGACY_FIELDS;
    for (const f of legacyFields) {
        const m = content.match(new RegExp(f + '[：:][\\s\\S]*?(?=\\n##|\\n---|$)'));
        if (!m || m[0].replace(/^.*?[：:]/, '').trim().length < 3) return false;
    }
    return true;
}

/** 检查大纲摘要是否完整（需包含定位、场景、信息、基调、钩子 5 个字段） */
export function isOutlineComplete(content: string): boolean {
    const fields: ReadonlyArray<{ label: string; minLen: number }> = [...OUTLINE_CHECK_FIELDS];
    for (const f of fields) {
        const m = content.match(new RegExp(`##\\s*${f.label}[\\s\\S]*?(?=##|$)`));
        if (!m) return false;
        const body = m[0].replace(/##.*/, '').trim().replace(/^\d+\.\s*/gm, '').trim();
        if (body.length < f.minLen) return false;
    }
    return true;
}

/** 诊断大纲摘要完整度（返回诊断文本而非 bool） */
export function diagnoseOutline(content: string): string {
    const fields = [
        { label: '本章在全书中的位置', minLen: 10 },
        { label: '关键场景', minLen: 3 },
        { label: '需要呈现的信息', minLen: 10 },
        { label: '情感基调', minLen: 5 },
        { label: '结尾钩子', minLen: 5 },
    ];
    for (const f of fields) {
        const m = content.match(new RegExp(`##\\s*${f.label}[\\s\\S]*?(?=##|$)`));
        if (!m) return `❌ 缺少字段: ${f.label}`;
        const body = m[0].replace(/##.*/, '').trim().replace(/^\d+\.\s*/gm, '').trim();
        if (body.length < f.minLen) return `❌ 字段内容不足: ${f.label} (${body.length}字 < ${f.minLen}字)`;
    }
    return '✅ 完整';
}
