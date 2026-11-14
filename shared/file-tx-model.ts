/**
 * file-tx-model.ts — 文件事务日志模型（纯函数）
 *
 * 借鉴催更姬 infrastructure/persistence 的事务语义：
 * 先暂存（记录每个文件的原内容）→ 写目标文件 → 标记提交 → 清理日志；
 * 中途失败或插件中断时，下次启动按日志回滚到原内容，避免「写一半」。
 *
 * 纯函数：不碰 Obsidian API，方便单测。
 */

/** 单个文件变更 */
export interface FileTxOp {
    /** vault 相对路径 */
    path: string;
    /** 目标内容 */
    content: string;
    /** 变更前内容（文件原本不存在时为 null） */
    before: string | null;
}

/** 事务状态 */
export type FileTxState = 'staged' | 'committed';

/** 事务日志 */
export interface FileTxJournal {
    /** 事务 id（时间戳 + 随机后缀） */
    id: string;
    /** 创建时间（毫秒） */
    createdAt: number;
    /** 状态：staged=未完成，committed=已完成待清理 */
    state: FileTxState;
    /** 变更列表 */
    ops: FileTxOp[];
}

/** 事务日志格式版本 */
export const FILE_TX_VERSION = 1 as const;

/** 带版本的落盘结构 */
export interface FileTxJournalFile {
    version: typeof FILE_TX_VERSION;
    journal: FileTxJournal;
}

/**
 * 生成事务 id。
 *
 * @param now - 时间戳
 * @param random - 随机数（0–1）
 * @returns 事务 id
 */
export function createTxId(now: number = Date.now(), random: number = Math.random()): string {
    const suffix = Math.floor(random * 36 ** 4).toString(36).padStart(4, '0');
    return `tx-${now}-${suffix}`;
}

/**
 * 创建 staged 事务日志。
 *
 * @param ops - 变更列表
 * @param now - 时间戳
 * @param random - 随机数
 * @returns 事务日志
 */
export function createJournal(
    ops: readonly FileTxOp[],
    now: number = Date.now(),
    random: number = Math.random(),
): FileTxJournal {
    return {
        id: createTxId(now, random),
        createdAt: now,
        state: 'staged',
        ops: ops.map(op => ({ ...op })),
    };
}

/**
 * 标记事务已提交。
 *
 * @param journal - 事务日志
 * @returns 新日志
 */
export function markCommitted(journal: FileTxJournal): FileTxJournal {
    return { ...journal, state: 'committed' };
}

/**
 * 是否需要在启动时回滚（staged 表示写入未完成）。
 *
 * @param journal - 事务日志
 * @returns 需要回滚返回 true
 */
export function needsRollback(journal: FileTxJournal): boolean {
    return journal.state === 'staged';
}

/**
 * 计算回滚计划：恢复 before 内容；before 为 null 表示原本不存在 → 删除。
 *
 * @param journal - 事务日志
 * @returns 回滚步骤
 */
export function rollbackPlan(journal: FileTxJournal): Array<{ path: string; content: string | null }> {
    return journal.ops.map(op => ({ path: op.path, content: op.before }));
}

/**
 * 事务摘要（日志/诊断展示用）。
 *
 * @param journal - 事务日志
 * @returns 摘要文本
 */
export function describeJournal(journal: FileTxJournal): string {
    const state = journal.state === 'committed' ? '已提交' : '未完成';
    const paths = journal.ops.map(op => op.path).join('、');
    return `${journal.id}（${state}，${journal.ops.length} 个文件：${paths}）`;
}

/**
 * 解析落盘日志；结构不符返回 null（损坏日志不应阻断启动）。
 *
 * @param raw - 原始 JSON 文本
 * @returns 事务日志；无法解析返回 null
 */
export function parseJournalFile(raw: string): FileTxJournal | null {
    try {
        const parsed = JSON.parse(raw) as Partial<FileTxJournalFile>;
        if (parsed?.version !== FILE_TX_VERSION) return null;
        const journal = parsed.journal;
        if (!journal || typeof journal.id !== 'string' || !Array.isArray(journal.ops)) return null;
        return journal;
    } catch {
        // silent-ok: 损坏的事务日志等价于「无日志」，不能阻断插件启动
        return null;
    }
}
