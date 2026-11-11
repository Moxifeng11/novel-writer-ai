/**
 * wizard-step-logic.ts — 向导步骤的纯逻辑（阶段 D1）
 *
 * 从 `ui/full-writer/wizard-step-renderers.ts` 的 `renderWizardCompleteStep` 抽出。
 *
 * 抽出的理由：分卷统计靠正则匹配 `### 第N卷`，这类正则容易写错
 * （阿拉伯数字 vs 中文数字、有无空格、H3 vs H2），
 * 而它此前埋在向导渲染方法里，没有任何测试。
 */

/** 项目初始化完成后的检查项状态 */
export type SetupStatus = 'ok' | 'warn' | 'missing';

/**
 * 统计分卷大纲里的卷数。
 *
 * 只认 `### 第N卷`（H3 + 阿拉伯数字），与既有大纲模板保持一致。
 *
 * @param outlineContent - 合并后的大纲正文
 * @returns 卷数（无匹配为 0）
 */
export function countVolumeHeadings(outlineContent: string | null | undefined): number {
    const content = String(outlineContent ?? '');
    if (!content.trim()) return 0;
    const matches = content.match(/###\s+第\d+卷/g);
    return matches ? matches.length : 0;
}

/**
 * 「文件是否存在」类检查项的状态。
 *
 * @param exists - 是否存在
 * @returns ok / missing
 */
export function resolveExistsStatus(exists: boolean): SetupStatus {
    return exists ? 'ok' : 'missing';
}

/**
 * 「生成了多少个」类检查项的状态。
 *
 * 数量为 0 时是 `warn`（不是 `missing`）——文件/目录可能存在，只是还没内容。
 *
 * @param count - 数量
 * @returns ok / warn
 */
export function resolveCountStatus(count: number): SetupStatus {
    return Number(count) > 0 ? 'ok' : 'warn';
}

/**
 * 状态 → 展示用 emoji。
 *
 * @param status - 状态
 * @returns emoji
 */
export function resolveSetupStatusIcon(status: SetupStatus): string {
    if (status === 'ok') return '✅';
    if (status === 'warn') return '⚠️';
    return '❌';
}

/**
 * 构造一个初始化检查项。
 *
 * @param label - 项目名（世界观 / 人物 / 分卷大纲 …）
 * @param status - 状态
 * @param detail - 详情文案
 * @returns 检查项
 */
export function buildSetupStatItem(
    label: string,
    status: SetupStatus,
    detail: string,
): { label: string; status: SetupStatus; icon: string; detail: string } {
    return { label, status, icon: resolveSetupStatusIcon(status), detail };
}
