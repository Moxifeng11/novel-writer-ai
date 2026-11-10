/**
 * engine/settlement/settle-context.ts
 * settle() 主流程跨步骤共享状态容器（P1-2 阶段二）。
 *
 * 设计目的：替代原 settle() 内部 580 行单方法中散落的 6 个闭包变量
 * （snapshots / createdFiles / hasPartialFailure / rollbackFailed / 以及两个闭包函数 snapshotField/restoreSnapshots）。
 * 现在跨步骤通过 SettleContext 对象传递，每个 step 方法接收 ctx 参数。
 *
 * 闭包等价保证：
 * - snapshots / createdFiles 是引用类型，传递引用即可保持同一份 Map/Array
 * - hasPartialFailure / rollbackFailed 是 boolean，因不在 step 内做局部读后写回，
 *   故必须以 ctx 对象字段形式存储而非裸 boolean 参数
 */
import type { TFile } from 'obsidian';
import type { Instructions } from './settlement-types';
import type { SettlementOptions, SettlementResult } from '@/engine/settlement-engine';
import { SettlementJournal } from './settlement-journal';

/**
 * SettleContext 类型定义。
 */
export interface SettleContext {
    /** 项目名 */
    project: string;
    /** 步骤目录（v4.0: 03-大纲与章节/步骤结果/第X卷/第Y章） */
    chapDir: string;
    /** 章节名（如"第3章"） */
    chapName: string;
    /** 章节正文（用于 V2 关系状态解析） */
    bodyText: string;
    /** 分析报告原文（V2 关系解析需要） */
    report: string;
    /** 调用方传入选项（强制揭示等） */
    options?: SettlementOptions;

    /** 解析后的指令集 */
    instr: Instructions;

    /** 汇总结果对象（各 step 累加） */
    result: SettlementResult;

    // ── 跨步骤共享状态 ──

    /**
     * 回滚快照表：filePath -> (fieldName -> 原始值)。值保留 frontmatter 原类型，
     * 否则 list 字段回滚会退化成字符串（F2）。
     */
    snapshots: Map<string, Map<string, unknown>>;

    /**
     * NEW 操作创建的文件路径列表。
     * 回滚阶段（hasPartialFailure 时）需要删除这些新文件，否则会留下脏数据。
     */
    createdFiles: string[];

    /** 任意一个 step 抛错但被 catch 后置 true，触发汇总阶段的回滚 */
    hasPartialFailure: boolean;

    /** R3-3: 回滚本身失败的标志，触发"数据可能脏态"提示 */
    rollbackFailed: boolean;

    /**
     * 回滚快照读取失败的标志（v4.79.0 交叉审计）：
     * 读失败 ≠ 文件是本次新建；此时无法保证回滚完整性，回滚发生后应标记 partial。
     */
    snapshotIncomplete: boolean;

    /**
     * run 级回滚日志（frontmatter 字段 / 整文件前值 / 追加标记）。
     * 与 snapshots 并存但取代其回滚职责：追加类写入只有 journal 能精确撤销。
     */
    journal: SettlementJournal;
}

/**
 * 创建 SettleContext 的工厂函数
 *
 * @param project - 项目（路径或对象）
 * @param chapDir - 章节目录
 * @param chapName - 章节名
 * @param bodyText - 正文文本
 * @param report - 报告
 * @param instr - 指令
 * @param options - 配置项
  * @returns SettleContext 实例
 */
export function createSettleContext(
    project: string,
    chapDir: string,
    chapName: string,
    bodyText: string,
    report: string,
    instr: Instructions,
    options?: SettlementOptions
): SettleContext {
    return {
        project,
        chapDir,
        chapName,
        bodyText,
        report,
        options,
        instr,
        result: {
            updated: 0,
            created: 0,
            updatedChars: 0,
            updatedForeshadows: 0,
            updatedFactions: 0,
            updatedLocations: 0,
            updatedItems: 0,
            updatedRelations: 0,
            updatedGrowth: 0,
            updatedEmotions: 0,
            createdChars: 0,
            createdLocs: 0,
            createdFactions: 0,
            createdItems: 0,
            createdForeshadows: 0,
            createdTimelines: 0,
            chars: [],
            locs: [],
            factions: [],
            items: [],
            rejectedFields: [],
            missingEntities: [],
            linkFieldWrites: 0,
        },
        snapshots: new Map<string, Map<string, unknown>>(),
        createdFiles: [],
        hasPartialFailure: false,
        rollbackFailed: false,
        snapshotIncomplete: false,
        journal: new SettlementJournal(),
    };
}
