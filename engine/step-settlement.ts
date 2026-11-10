/**
 * step-settlement.ts — 章节结算链路
 *
 * 从 step-runner.ts 拆分而来：分析报告回退读取、结算引擎调用、叙事总览刷新与上下文面板通知。
 * 文件读写通过宿主注入，便于测试与平台解耦。
 */

import { getChapterFileName, CHAPTER_FILE_TYPES } from './chapter-utils';
import { isChapterSettledText } from '@/shared/chapter-status';
import type { SettlementEngine, SettlementResult } from './settlement-engine';
import { NOTICE_ERROR } from '@/shared/thresholds';
import { createLogger } from '@/shared/logger';

const log = createLogger('StepSettlement');

/**
 * 从 forcedRevealHint 中解析需要强制揭示的名字。
 *
 * 兼容三种真实格式（`template-vars-builder.ts` 生成的就是前两种）：
 *  1. 显式行：`揭示：A，B` / `提示：A、B`（自定义模板写法）
 *  2. bullet 行：`- 玉佩（高，计划:第3章）`
 *  3. 单行建议：`建议至少揭示1个：玉佩（高）`
 *
 * 引导语（「优先揭示以下临近伏笔」）后面的名字在 bullet 行里，不再从该行截取，
 * 避免把「以下临近伏笔」当名字。信息债健康等纯提示行解析结果为空是正常情况。
 *
 * @param hint - 模板变量 forcedRevealHint 的原文
 * @returns 去重后的名字列表（最多 8 个）
 */
export function parseForcedRevealNames(hint: string): string[] {
    const text = String(hint || '');
    const names: string[] = [];
    const push = (raw: string): void => {
        const name = String(raw || '')
            .replace(/[，,、;；。.]+$/g, '')
            .trim();
        if (name && !names.includes(name)) names.push(name);
    };

    let match: RegExpExecArray | null;

    // 1) 显式「揭示：/提示：」行；引导语行（含 以下/临近/窗口/建议/至少）跳过
    const explicit = /(?:揭示|提示)[：:][ \t]*([^\n]+)/g;
    while ((match = explicit.exec(text)) !== null) {
        if (/以下|临近|窗口|建议|至少/.test(match[1])) continue;
        for (const part of match[1].split(/[,，、]/)) push(part);
    }

    // 2) bullet 行：取 `（` 之前的部分作为名字
    const bullet = /^[ \t]*[-*•][ \t]*(.+?)(?:[（(].*)?$/gm;
    while ((match = bullet.exec(text)) !== null) push(match[1]);

    // 3) 单行建议：…揭示N个：名字（重要度）
    const single = /揭示\d*个[：:][ \t]*([^\s，,（(]+)/g;
    while ((match = single.exec(text)) !== null) push(match[1]);

    return names.slice(0, 8);
}

/** hint 是否「应当包含名字」：显式行、bullet 列表或单行建议至少出现一种。 */
function looksNameBearing(hint: string): boolean {
    return /(?:揭示|提示)[：:]/.test(hint)
        || /^[ \t]*[-*•][ \t]*\S/m.test(hint)
        || /揭示\d*个[：:]/.test(hint);
}

/**
 * StepSettlementHost 类型定义。
 */
export interface StepSettlementHost {
    settlementEngine: SettlementEngine;
    /**
     * 读取文本文件；文件不存在时返回 null，读取异常向上抛
     *
     * @param path - 路径
      * @returns 文本结果 或 null
     */
    readTextFile(path: string): Promise<string | null>;
    writeTextFile(path: string, content: string): Promise<void>;
    hideProgress(): void;
    showProgress(message: string): void;
    showError(message: string, duration?: number): void;
    showSuccess(message: string, duration?: number): void;
    showNotice(message: string, duration?: number): void;
    /** 结算后通知统一工作台刷新上下文面板 */
    triggerContextRefresh(): void;
}

/**
 * 执行章节结算。
 * 返回前一定会调用一次 renderInContainer（前置守卫命中时直接返回，不渲染）。
 * @param host - 宿主元素
 * @param project - 项目（路径或对象）
 * @param chapDir - 章节目录
 * @param chapterName - 章节名
 * @param stepResults - 步骤结果列表
 * @param stepCompleted - 步骤完成状态
 * @param vars - 变量表
 * @param renderInContainer - 渲染容器
 * @param tabContent - 页签内容
 * @param options - 配置项
  * @returns SettlementResult 或 null
 */
export async function executeSettlement(
    host: StepSettlementHost,
    project: string,
    chapDir: string,
    chapterName: string,
    stepResults: Record<string, string>,
    stepCompleted: Set<string>,
    vars: Record<string, string>,
    renderInContainer: (container: HTMLElement) => Promise<void>,
    tabContent: HTMLElement,
    options: { force?: boolean } = {},
): Promise<SettlementResult | null> {
    if (!chapDir) return null;

    // v1.3.0: 从内存读取分析报告，如果为空则尝试从磁盘文件恢复（P0修复）
    let reportContent = stepResults['analysisReport'] || '';
    if (!reportContent) {
        // 回退：从磁盘读取分析报告文件（重启后内存丢失但文件仍存在）
        const reportPath = `${chapDir}/${getChapterFileName(chapterName, CHAPTER_FILE_TYPES.analysisReport)}`;
        try {
            const loaded = await host.readTextFile(reportPath);
            if (loaded !== null) {
                reportContent = loaded;
                // 将读取到的内容也恢复到内存 stepResults 中
                stepResults['analysisReport'] = reportContent;
            }
        } catch (e) {
            const errMsg = e instanceof Error ? e.message : String(e);
            log.warn('[StepRunner] 无法从磁盘读取分析报告:', e);
            host.showNotice(`⚠️ 读取分析报告失败：${errMsg}`, NOTICE_ERROR);
        }
    }

    // v1.3.0: 前置检查 — 分析报告必须包含有效指令才能结算
    if (!reportContent.match(/(UPDATE_|NEW_|RELATION:|GROWTH:|EMOTION:)/)) {
        host.hideProgress();
        host.showError('⚠️ 分析报告为空或不含有效更新指令。请先执行「📊 分析报告」步骤，确保 AI 提取了元素变化后再执行结算。');
        return null; // 不标记 settlement 完成，允许用户补跑分析报告后重新触发
    }

    host.showProgress('⏳ 执行章节结算...');

    const bodyText = stepResults['bodyGeneration'] || '';
    const chapName = chapterName;

    // 结算写入是追加语义（伏笔/关系/时间线），重复结算会产生重复行。
    // 自动链路默认拦截；用户点“重新结算”时显式 force。
    const alreadySettled = isChapterSettledText(bodyText);
    if (alreadySettled && !options.force) {
        host.hideProgress();
        host.showNotice('ℹ️ 本章已结算；如需重新写入，请使用“重新结算”', 6000);
        return null;
    }

    // 解析强制揭示
    const forcedRevealHint = vars?.['forcedRevealHint'] || '';
    const forceReveal: string[] = forcedRevealHint ? parseForcedRevealNames(forcedRevealHint) : [];
    if (forcedRevealHint && looksNameBearing(forcedRevealHint) && forceReveal.length === 0) {
        // P2-3: 空结果检测 — hint 看起来应包含名字（显式行/列表/建议）却一个都没解析出来
        log.warn('[小说工坊] forcedRevealHint 未解析出名字，输入:', forcedRevealHint.slice(0, 100));
        host.showNotice('⚠️ 强制揭示提示未识别出任何名字（请用「揭示：名字1, 名字2」或 bullet 列表「- 名字（重要度）」格式）', NOTICE_ERROR);
    }

    let settlementResult: SettlementResult | null = null;
    try {
        const result = await host.settlementEngine.settle(
            project, chapDir, chapName, reportContent, bodyText,
            { forceReveal: forceReveal.length > 0 ? forceReveal : undefined }
        );
        settlementResult = result;

        // 空指令集：报告没解析出任何可应用指令时，不得标记已结算（mode=empty 由引擎返回）
        if (result.mode === 'empty') {
            host.hideProgress();
            host.showNotice('⚠️ 分析报告未解析出可应用指令（UPDATE_*/NEW_*/RELATION 等），本次未执行结算；请检查分析报告，或改用轻结算', 8000);
            await renderInContainer(tabContent);
            return result;
        }

        // 部分失败已回滚：不得标完成，否则后续步骤/批量会基于未结算章节继续。
        if (result.rollback || result.settlementPartial || result.partialFailure?.length) {
            host.hideProgress();
            const detail = result.rollback
                ? `恢复 ${result.rollback.reverted} 项${result.rollback.failed > 0 ? `，回滚失败 ${result.rollback.failed} 项` : ''}`
                : result.settlementPartial
                    ? '回滚不完整'
                    : `附加步骤失败：${result.partialFailure!.join('、')}`;
            host.showError(`章节结算失败${result.rollback ? '，已回滚' : ''}（${detail}）；本章未标记完成，请修正分析报告后重试`);
            await renderInContainer(tabContent);
            return result;
        }

        stepCompleted.add('settlement');
        host.hideProgress();
        // v3.4.8 Batch-2: 结算结果汇总通知（settlement引擎 22+ 处静默吞错 → 汇总为1条Notice）
        const summary: string[] = [];
        if (result.created > 0) summary.push(`新创 ${result.created} 项`);
        if (result.updated > 0) summary.push(`更新 ${result.updated} 项`);
        if (result.created === 0 && result.updated === 0) {
            host.showSuccess('章节结算完成（无新增或更新）');
        } else {
            host.showSuccess(`章节结算完成（${summary.join('，')}）`);
        }

        // 叙事总览与章节快照由 StepRunner 的 settlement-coordinator 统一写入
        host.triggerContextRefresh();
    } catch (e) {
        host.hideProgress();
        host.showError(`章节结算失败: ${(e as Error).message}`);
    }

    await renderInContainer(tabContent);
    return settlementResult;
}
