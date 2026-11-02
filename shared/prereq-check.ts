/**
 * shared/prereq-check.ts — 协同写作「前置规划」缺口判定（纯函数）
 *
 * 信息规划 / 大纲摘要缺失、读取失败或只是空模板时，协同建议会缺少章节上下文。
 * 这里只负责把检查结果翻译成给用户看的缺口列表，读盘与 DOM 仍由视图处理。
 */

export interface PrerequisiteCheck {
    /** 步骤中文名（信息规划 / 大纲摘要） */
    name: string;
    /** 文件是否存在 */
    exists: boolean;
    /** 读取是否抛错（存在才有意义） */
    readFailed?: boolean;
    /** 去掉 frontmatter 后的正文长度 */
    bodyLength?: number;
}

/** 正文少于该字符数视为「空模板」 */
export const PREREQ_MIN_BODY_CHARS = 100;

/**
 * 汇总前置规划缺口。
 * - 文件不存在 → 只报名字；
 * - 读取失败 → 「（读取失败）」；
 * - 正文不足门槛 → 「（内容过短）」，恰好等于门槛视为通过。
 * @param checks - 检查项
 * @param minBodyChars - 最小正文字符
 * @returns 结果数组
 */
export function describePrerequisiteGaps(
    checks: PrerequisiteCheck[],
    minBodyChars: number = PREREQ_MIN_BODY_CHARS,
): string[] {
    const gaps: string[] = [];
    for (const check of checks) {
        if (!check.exists) {
            gaps.push(check.name);
            continue;
        }
        if (check.readFailed) {
            gaps.push(`${check.name}（读取失败）`);
            continue;
        }
        if ((check.bodyLength ?? 0) < minBodyChars) {
            gaps.push(`${check.name}（内容过短）`);
        }
    }
    return gaps;
}
