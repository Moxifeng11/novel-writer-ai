/**
 * maintenance-model.ts — 高级维护动作的结果摘要（纯函数）
 *
 * 背景：`syncRelationGraph` / `rebuildAssertions` / `runBaselineProbe` /
 * `generateChapterBySceneLoop` 四个能力此前只暴露在 `plugin-api`（脚本可调），
 * 界面上没有入口。补入口时把结果格式化抽到这里，保证可测、可复用。
 */

/**
 * 把任意维护结果压成可读行（优先用服务自带的 report/summary）。
 *
 * @param result - 服务返回值
 * @returns 文本行
 * @example
 * ```ts
 * summarizeMaintenanceResult({ dryRun: true, count: 12, path: 'a/断言.json' });
 * // ['模式：预览（未写入）', '条目数：12', '文件：a/断言.json']
 * ```
 */
export function summarizeMaintenanceResult(result: unknown): string[] {
    if (!result || typeof result !== 'object') return ['（无返回结果）'];
    const record = result as Record<string, unknown>;
    if (typeof record.report === 'string' && record.report.trim()) return record.report.split('\n');
    if (typeof record.summary === 'string' && record.summary.trim()) {
        const lines = [record.summary];
        if (typeof record.chars === 'number') lines.push(`字数：${record.chars}`);
        if (Array.isArray(record.failedScenes) && record.failedScenes.length > 0) {
            lines.push(`失败场景：${record.failedScenes.join('、')}`);
        }
        return lines;
    }

    const lines: string[] = [];
    if ('dryRun' in record) lines.push(record.dryRun === true ? '模式：预览（未写入）' : '模式：已写入');
    if ('wrote' in record) lines.push(record.wrote === true ? '落盘：已写入' : '落盘：未写入');
    for (const [key, label] of [
        ['count', '条目数'],
        ['derived', '派生出边'],
        ['keptManual', '保留手工边'],
        ['removed', '移除派生边'],
        ['skipped', '跳过'],
        ['path', '文件'],
        ['backup', '备份'],
        ['reductionPercent', 'prompt 下降'],
        ['completedAll', '全部场景完成'],
    ] as const) {
        const value = record[key];
        if (value === undefined || value === null) continue;
        if (key === 'reductionPercent' && typeof value === 'number') {
            lines.push(`${label}：${value}%`);
            continue;
        }
        lines.push(`${label}：${Array.isArray(value) ? value.join('、') : String(value)}`);
    }
    const warnings = record.warnings;
    if (Array.isArray(warnings) && warnings.length > 0) {
        lines.push(`告警：${warnings.slice(0, 5).join('；')}${warnings.length > 5 ? ' …' : ''}`);
    }
    if (lines.length === 0) {
        const keys = Object.keys(record).slice(0, 8);
        lines.push(keys.length > 0 ? `结果字段：${keys.join('、')}` : '（空结果）');
    }
    return lines;
}

/**
 * 动作需要章节时提示。
 *
 * @param actionLabel - 动作名
 * @param chapter - 当前章节
 * @returns 提示文本；章节存在返回空串
 * @example
 * ```ts
 * describeMissingChapter('基线探测', ''); // '「基线探测」需要先选择章节'
 * ```
 */
export function describeMissingChapter(actionLabel: string, chapter: string): string {
    return chapter ? '' : `「${actionLabel}」需要先选择章节`;
}
