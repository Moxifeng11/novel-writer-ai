/**
 * session-retention.ts — 会话保留/清理统一策略（按数量上限的保守 MVP）
 *
 * 审计 P2：分析会话、Agent 会话（以及已在 v4.27.0 截断的协同 settings 历史）
 * 三套落点此前无统一保留策略，磁盘会随使用无限增长。本模块提供：
 * - 一个可注入、可测试的端口接口（RetentionTarget）：调用方提供「列举 / 删除 / 豁免」，
 *   本模块不直接触碰 app.vault 或任何具体存储；
 * - 一个统一的修剪入口（pruneSessions）：按 mtime 降序保留前 maxCount 个，
 *   其余删除；keep 列表中的路径永不删除。
 *
 * 保守原则（MVP）：
 * - 只按数量上限修剪，不按天数（避免把"很久没打开但重要"的会话误删）；
 * - 不感知"活跃会话"，活跃/最近会话由调用方通过 keep 豁免；
 * - 单条删除失败只 log.warn 并继续，不因个别文件失败中断整体修剪。
 */

import { createLogger } from './logger';

const log = createLogger('SessionRetention');

/**
 * 单个会话候选文件的描述。
 */
export interface RetentionFileInfo {
    /** 会话文件的库内相对路径 */
    path: string;
    /** 最后修改时间（epoch 毫秒）；缺失时视为最旧（优先被修剪） */
    mtime?: number;
}

/**
 * 保留策略目标端口 —— 把「某一种会话落点」抽象为可注入的能力。
 *
 * 调用方（如 main.ts）为每种会话各构造一个实现：
 * - list()：返回该落点下的全部会话文件（路径 + mtime）；
 * - remove(path)：删除单个会话文件；
 * - keep（可选）：永不删除的路径列表（当前活跃/最近会话等）。
 *
 * 端口与具体存储解耦：测试时用内存实现即可，不需要 vault。
 */
export interface RetentionTarget {
    /**
     * 列出该落点下的全部会话文件
     *
     * @returns 会话文件列表（路径 + 可选 mtime）
     */
    list(): Promise<RetentionFileInfo[]>;
    /**
     * 删除单个会话文件
     *
     * @param path - 会话文件的库内相对路径
     */
    remove(path: string): Promise<void>;
    /** 永不删除的路径列表（如当前活跃会话）；缺省视为无豁免 */
    keep?: string[];
}

/**
 * 单个目标的修剪结果。
 */
export interface PruneResult {
    /** 目标标签（构造时传入，用于日志与结果区分） */
    label: string;
    /** 本次实际删除成功的文件路径列表（删除失败的不计入） */
    removed: string[];
}

/**
 * 单个修剪目标的配置。
 */
export interface PruneTargetConfig {
    /** 目标标签（如 'analysisSessions' / 'agentSessions'） */
    label: string;
    /** 该落点的端口实现 */
    port: RetentionTarget;
    /** 数量上限：按 mtime 降序保留前 maxCount 个，其余删除 */
    maxCount: number;
}

/**
 * 会话保留默认上限（保守 MVP 值）。
 *
 * 只按数量截断、不做天数过期，两个上限都取得宽松：
 * - 正常使用远达不到 30 个，修剪几乎不触发；
 * - 即使触发，也只影响最旧的 1-2 个文件。
 * 后续如需更激进策略（按天数/体积），应在此演进而不是散落各落点。
 */
export const SESSION_RETENTION_DEFAULTS = {
    /** 分析会话（插件目录 .sessions/*.json）数量上限 */
    analysisSessions: 30,
    /** Agent 会话（.sessions/agent/*.jsonl）数量上限 */
    agentSessions: 30,
} as const;

/**
 * 按数量上限修剪多个会话落点。
 *
 * 语义（对每个 target 独立执行）：
 * 1. 取 port.list()，按 mtime 降序排序，mtime 缺失视为最旧（排最后）；
 * 2. 保留集 = 排序后前 maxCount 个 ∪ port.keep 豁免集；
 * 3. 其余文件逐个 port.remove：单条失败 log.warn 并继续，不计入 removed；
 * 4. list() 本身失败视为该目标整体不可修剪：log.warn 后返回
 *    `{ label, removed: [] }`，不影响其它目标。
 *
 * @param targets - 修剪目标列表（标签 + 端口 + 上限）
 * @returns 各目标的修剪结果（与入参顺序一致）
 *
 * @example
 * ```ts
 * const results = await pruneSessions([
 *     {
 *         label: 'analysisSessions',
 *         maxCount: SESSION_RETENTION_DEFAULTS.analysisSessions,
 *         port: {
 *             list: () => manager.listSessionFiles(),
 *             remove: (p) => adapter.remove(p),
 *         },
 *     },
 *     {
 *         label: 'agentSessions',
 *         maxCount: SESSION_RETENTION_DEFAULTS.agentSessions,
 *         port: {
 *             list: () => listAgentSessionFiles(app),
 *             remove: (p) => adapter.remove(p),
 *             keep: currentAgentSessionPath ? [currentAgentSessionPath] : [],
 *         },
 *     },
 * ]);
 * for (const r of results) {
 *     if (r.removed.length > 0) log.info(`[${r.label}] 已修剪 ${r.removed.length} 个旧会话`);
 * }
 * ```
 */
export async function pruneSessions(targets: PruneTargetConfig[]): Promise<PruneResult[]> {
    const results: PruneResult[] = [];

    for (const target of targets) {
        const result: PruneResult = { label: target.label, removed: [] };
        results.push(result);

        let entries: RetentionFileInfo[];
        try {
            entries = await target.port.list();
        } catch (err) {
            log.warn(`[${target.label}] 列举会话文件失败，跳过该目标的修剪:`, err);
            continue;
        }

        // mtime 降序；缺失 mtime 视为最旧（排最后，优先进入删除集）
        const sorted = [...entries].sort((a, b) => {
            const am = a.mtime ?? Number.NEGATIVE_INFINITY;
            const bm = b.mtime ?? Number.NEGATIVE_INFINITY;
            return bm - am;
        });

        const keepSet = new Set(target.port.keep ?? []);
        const maxCount = Math.max(0, target.maxCount);

        for (const [index, entry] of sorted.entries()) {
            // keep 豁免：永不删除（不参与配额，也不受上限约束）
            if (keepSet.has(entry.path)) continue;
            // 保留窗口内：前 maxCount 个
            if (index < maxCount) continue;
            try {
                await target.port.remove(entry.path);
                result.removed.push(entry.path);
            } catch (err) {
                log.warn(`[${target.label}] 删除会话文件失败（跳过）: ${entry.path}`, err);
            }
        }
    }

    return results;
}
