/**
 * quality-panel-model.ts — 质量面板聚合模型（B4）
 *
 * 把「生成后校验 + 定向修订」的历史记录聚合成可读面板数据：
 * 通过率、问题类型分布、修订轮次趋势、待人工清单。
 */

import type { CheckKind, CheckSeverity, PostGenerationCheckReport } from './post-generation-check-model';

/** 一次校验/修订记录 */
export interface QualityRecord {
    chapterName: string;
    /** 校验时间戳 */
    checkedAt: number;
    /** 首次校验是否通过（无 error） */
    passed: boolean;
    /** 各类严重度计数 */
    counts: Record<CheckSeverity, number>;
    /** 问题类型分布 */
    kinds: Partial<Record<CheckKind, number>>;
    /** 修订轮次（0 = 无需修订） */
    revisionRounds: number;
    /** 最终是否仍未通过（待人工） */
    pendingHuman?: boolean;
    /** 中止原因（守卫/模型报错） */
    abortedReason?: string;
}

/** 面板汇总 */
export interface QualityPanelSummary {
    /** 记录总数 */
    total: number;
    /** 通过数 */
    passed: number;
    /** 通过率（0–100，保留 1 位小数） */
    passRate: number;
    /** 待人工数 */
    pendingHuman: number;
    /** 问题类型分布（按次数降序） */
    kindRanking: Array<{ kind: CheckKind; count: number }>;
    /** 平均修订轮次 */
    avgRevisionRounds: number;
    /** 最近记录（按时间倒序，最多 10 条） */
    recent: QualityRecord[];
}

/**
 * 从单次校验结果构造记录。
 *
 * @param report - 校验报告
 * @param revisionRounds - 实际修订轮次
 * @param options - 附加判定
 * @returns 记录
 */
export function toQualityRecord(
    report: PostGenerationCheckReport,
    revisionRounds = 0,
    options: { pendingHuman?: boolean; abortedReason?: string } = {},
): QualityRecord {
    const kinds: Partial<Record<CheckKind, number>> = {};
    for (const item of report.items) {
        kinds[item.kind] = (kinds[item.kind] ?? 0) + 1;
    }
    return {
        chapterName: report.chapterName,
        checkedAt: report.checkedAt,
        passed: report.passed,
        counts: { ...report.counts },
        kinds,
        revisionRounds,
        pendingHuman: options.pendingHuman,
        abortedReason: options.abortedReason,
    };
}

/**
 * 聚合历史记录为面板汇总。
 *
 * @param records - 历史记录（任意顺序）
 * @returns 汇总
 */
export function summarizeQualityPanel(records: readonly QualityRecord[]): QualityPanelSummary {
    const total = records.length;
    const passed = records.filter(record => record.passed).length;
    const pendingHuman = records.filter(record => record.pendingHuman).length;
    const kindTotals = new Map<CheckKind, number>();
    let revisionTotal = 0;
    for (const record of records) {
        revisionTotal += record.revisionRounds;
        for (const [kind, count] of Object.entries(record.kinds)) {
            kindTotals.set(kind as CheckKind, (kindTotals.get(kind as CheckKind) ?? 0) + (count ?? 0));
        }
    }
    const kindRanking = [...kindTotals.entries()]
        .map(([kind, count]) => ({ kind, count }))
        .sort((a, b) => b.count - a.count);
    const recent = [...records].sort((a, b) => b.checkedAt - a.checkedAt).slice(0, 10);
    return {
        total,
        passed,
        passRate: total === 0 ? 0 : Math.round((passed / total) * 1000) / 10,
        pendingHuman,
        kindRanking,
        avgRevisionRounds: total === 0 ? 0 : Math.round((revisionTotal / total) * 10) / 10,
        recent,
    };
}

/** 问题类型中文名 */
export const CHECK_KIND_LABELS: Record<CheckKind, string> = {
    consistency: '一致性',
    foreshadow: '伏笔',
    rhythm: '节奏',
    coverage: '实体覆盖',
    voice: '口吻',
    quality: '质量',
};

/**
 * 渲染面板为 Markdown。
 *
 * @param summary - 汇总
 * @returns 文本
 */
export function renderQualityPanel(summary: QualityPanelSummary): string {
    const lines = [
        '## 质量面板',
        '',
        `- 校验次数：${summary.total}`,
        `- 通过率：${summary.passRate}%（${summary.passed}/${summary.total}）`,
        `- 待人工：${summary.pendingHuman}`,
        `- 平均修订轮次：${summary.avgRevisionRounds}`,
    ];
    if (summary.kindRanking.length > 0) {
        lines.push('', '### 问题类型分布', '');
        for (const item of summary.kindRanking) {
            lines.push(`- ${CHECK_KIND_LABELS[item.kind] ?? item.kind}：${item.count}`);
        }
    }
    if (summary.recent.length > 0) {
        lines.push('', '### 最近记录', '');
        for (const record of summary.recent) {
            const flag = record.pendingHuman ? '⛔待在人工' : record.passed ? '✅' : '⚠️';
            lines.push(`- ${flag} ${record.chapterName}：error ${record.counts.error} / warn ${record.counts.warn}，修订 ${record.revisionRounds} 轮`);
        }
    }
    return lines.join('\n');
}
