/**
 * settlement-coordinator.ts — 结算后产物的统一编排（Wave B-2）
 *
 * 结算完成后有三件事必须成套：结算表、章节快照、叙事总览。
 * 此前 5 条入口各做一部分：
 *   - 章节结算弹窗：表 + 快照（无总览）
 *   - 一键成文：表（无快照/总览）
 *   - 批量流水线：快照 + 总览（无表）
 *   - 步骤结算 + StepRunner：总览在一处、快照在另一处
 * 结果就是「同一章经不同入口结算，产物不同」。
 *
 * 这里只负责编排与容错，不直接碰 Obsidian：写盘能力由端口注入。
 * 副作用顺序固定为「表 → 快照 → 总览」，任一非关键产物失败只记 warning，
 * 不阻断其余产物（与既有 best-effort 语义一致）。
 */
import {
    buildSettlementTable,
    type SettlementTableResult,
} from './settlement-artifacts';

/**
 * SettlementArtifactMode 类型定义。
 */
export type SettlementArtifactMode = 'full' | 'light' | 'empty';

/**
 * SettlementArtifactInput 类型定义。
 */
export interface SettlementArtifactInput {
    chapterName: string;
    volume: string;
    mode: SettlementArtifactMode;
    result: SettlementTableResult;
    /** 轻量结算表由调用方生成（字段不同）；完整结算缺省用统一生成器 */
    tableText?: string;
    model?: string;
    timestamp?: string;
}

/**
 * SettlementArtifactPorts 类型定义。
 */
export interface SettlementArtifactPorts {
    /** 写结算表（包含标记正文 settled / 打开文件等既有副作用） */
    writeSettlementTable?: (text: string) => Promise<void>;
    /** 写章节状态快照 */
    writeSnapshot?: () => Promise<void>;
    /** 重新生成叙事总览（best-effort；只在完整结算时调用） */
    refreshNarrativeOverview?: () => Promise<void>;
}

/**
 * SettlementArtifactReport 类型定义。
 */
export interface SettlementArtifactReport {
    /** 成功执行的产物名，顺序与执行顺序一致 */
    written: Array<'table' | 'snapshot' | 'overview'>;
    /** 失败产物与原因（调用方可汇总成一条 Notice） */
    warnings: string[];
}

const LABEL = { table: '结算表', snapshot: '章节快照', overview: '叙事总览' } as const;

/**
 * writeSettlementArtifacts 函数。
 * @param input - 输入
 * @param ports - 端口集合
  * @returns SettlementArtifactReport 实例
 */
export async function writeSettlementArtifacts(
    input: SettlementArtifactInput,
    ports: SettlementArtifactPorts,
): Promise<SettlementArtifactReport> {
    const report: SettlementArtifactReport = { written: [], warnings: [] };
    // 空指令集：引擎没有写入任何东西，不能写表/快照/总览，否则会把「未结算」显示成已结算
    if (input.mode === 'empty') return report;

    // 部分失败已回滚：本次没有可确认的结算结果，写「已完成」表/快照/总览会把失败伪装成功。
    const rollback = input.result.rollback;
    if (rollback) {
        report.warnings.push(
            `结算已回滚（恢复 ${rollback.reverted} 项${rollback.failed > 0 ? `，回滚失败 ${rollback.failed} 项` : ''}），本次未写结算表/快照/总览`,
        );
        return report;
    }
    if (input.result.settlementPartial) {
        report.warnings.push('结算回滚不完整（settlement_partial），本次未写结算表/快照/总览');
        return report;
    }
    // D3-7：回滚终态之后的关系/承诺/角色弧线失败无法回滚，但也不能把本章显示成「已完成」
    if (input.result.partialFailure?.length) {
        report.warnings.push(
            `结算附加步骤失败（${input.result.partialFailure.join('、')}），本次未写结算表/快照/总览；重跑结算可补齐`,
        );
        return report;
    }

    const run = async (
        name: 'table' | 'snapshot' | 'overview',
        fn: (() => Promise<void>) | undefined,
    ): Promise<void> => {
        if (!fn) return;
        try {
            await fn();
            report.written.push(name);
        } catch (e) {
            report.warnings.push(`${LABEL[name]}写入失败：${e instanceof Error ? e.message : String(e)}`);
        }
    };

    if (ports.writeSettlementTable) {
        const text = input.tableText ?? buildSettlementTable({
            chapterName: input.chapterName,
            volume: input.volume,
            result: input.result,
            model: input.model,
            timestamp: input.timestamp,
        });
        await run('table', () => ports.writeSettlementTable!(text));
    }
    await run('snapshot', ports.writeSnapshot);
    // 轻量结算不重建叙事总览（实体信息不完整，重建反而会误导）
    if (input.mode === 'full') await run('overview', ports.refreshNarrativeOverview);

    return report;
}

/**
 * 把报告转成一条用户可见提示；全部成功返回 null
 *
 * @param report - 报告
  * @returns 文本结果 或 null
 */
export function settlementArtifactNotice(report: SettlementArtifactReport): string | null {
    return report.warnings.length > 0 ? `⚠️ ${report.warnings.join('；')}` : null;
}
