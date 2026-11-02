/**
 * step-settlement.ts — 章节结算链路
 *
 * 从 step-runner.ts 拆分而来：分析报告回退读取、结算引擎调用、叙事总览刷新与上下文面板通知。
 * 文件读写通过宿主注入，便于测试与平台解耦。
 */

import { getChapterFileName, CHAPTER_FILE_TYPES } from './chapter-utils';
import { isChapterSettledText } from '../shared/chapter-status';
import type { SettlementEngine, SettlementResult } from './settlement-engine';
import { NOTICE_ERROR } from '../shared/thresholds';
import { createLogger } from '../shared/logger';

const log = createLogger('StepSettlement');

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
    const forceReveal: string[] = [];
    if (forcedRevealHint) {
        const nameMatches = forcedRevealHint.match(/揭示[：:]\s*(.+?)(?=\n|$)/)?.[1];
        if (nameMatches) {
            for (const name of nameMatches.split(/[,，、]/)) {
                const n = name.trim();
                if (n) forceReveal.push(n);
            }
        }
        // P2-3: 空结果检测 — forcedRevealHint 非空但未解析出任何名字时反馈
        if (forceReveal.length === 0) {
            log.warn('[小说工坊] forcedRevealHint 非空但未解析出名字，输入:', forcedRevealHint.slice(0, 100));
            host.showNotice('⚠️ 强制揭示提示未识别出任何名字（请用「揭示：名字1, 名字2」格式）', NOTICE_ERROR);
        }
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
