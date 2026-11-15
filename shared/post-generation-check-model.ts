/**
 * post-generation-check-model.ts — 生成后校验报告模型（B1）
 *
 * 生成完成后把多路校验结果归一成一份结构化报告，供：
 *  - B2 定向修订消费（按 item 定位问题段落）；
 *  - B4 质量面板聚合展示。
 */

/** 校验项类别 */
export type CheckKind = 'consistency' | 'foreshadow' | 'rhythm' | 'coverage' | 'voice' | 'quality';

/** 严重度（error 会阻断「视为完成」） */
export type CheckSeverity = 'error' | 'warn' | 'info';

/** 单条校验项 */
export interface CheckItem {
    kind: CheckKind;
    severity: CheckSeverity;
    /** 面向作者的一句话说明 */
    message: string;
    /** 建议动作（B2 据此生成修订指令） */
    suggestion?: string;
    /** 关联实体 ID / 名称 */
    refs?: string[];
}

/** 校验报告 */
export interface PostGenerationCheckReport {
    project: string;
    chapterName: string;
    /** 检查时间戳（毫秒） */
    checkedAt: number;
    items: CheckItem[];
    /** 是否通过（无 error 项） */
    passed: boolean;
    /** 各严重度计数 */
    counts: Record<CheckSeverity, number>;
}

/**
 * 汇总报告（计算 passed 与计数）。
 *
 * @param project - 项目
 * @param chapterName - 章节名
 * @param items - 校验项
 * @param now - 时间戳
 * @returns 报告
 */
export function buildCheckReport(
    project: string,
    chapterName: string,
    items: readonly CheckItem[],
    now: number = Date.now(),
): PostGenerationCheckReport {
    const counts: Record<CheckSeverity, number> = { error: 0, warn: 0, info: 0 };
    for (const item of items) counts[item.severity] += 1;
    return {
        project,
        chapterName,
        checkedAt: now,
        items: [...items],
        passed: counts.error === 0,
        counts,
    };
}

/**
 * 渲染报告为可读文本（面板/日志共用）。
 *
 * @param report - 报告
 * @returns Markdown 文本
 */
export function renderCheckReport(report: PostGenerationCheckReport): string {
    const lines = [
        `## 生成后校验 · ${report.chapterName}`,
        '',
        `结论：${report.passed ? '通过' : '未通过'}（error ${report.counts.error} / warn ${report.counts.warn} / info ${report.counts.info}）`,
    ];
    if (report.items.length === 0) {
        lines.push('', '未发现问题。');
        return lines.join('\n');
    }
    lines.push('');
    for (const item of report.items) {
        const tag = item.severity === 'error' ? '❌' : item.severity === 'warn' ? '⚠️' : 'ℹ️';
        const refs = item.refs && item.refs.length > 0 ? `（${item.refs.join('、')}）` : '';
        lines.push(`- ${tag} [${item.kind}] ${item.message}${refs}`);
        if (item.suggestion) lines.push(`  - 建议：${item.suggestion}`);
    }
    return lines.join('\n');
}

/**
 * 过滤需要定向修订的项（error + warn，B2 消费）。
 *
 * @param report - 报告
 * @returns 待修订项
 */
export function actionableItems(report: PostGenerationCheckReport): CheckItem[] {
    return report.items.filter(item => item.severity !== 'info');
}
