/**
 * context-fit.ts — 回合内上下文预算（C3）
 *
 * dsh 在每次模型调用前按窗口压力裁剪上下文；本插件此前只在回合开始前做压缩，
 * 一个回合内最多 6 次工具结果（每次最大 6000 字符）可以把窗口撑爆而不自知。
 *
 * 这里用字符 ÷ 1.5 近似 token（与 telemetry 同口径），只做确定性裁剪：
 *   1. 优先把「最旧的工具结果」替换为占位符（保留对话结构）；
 *   2. 仍然超预算时，从最旧的非最后一条开始丢轮次；
 *   3. 仍超预算则返回 overBudget，由调用方显式失败（不静默截断用户输入）。
 */

/**
 * 估算文本 token 数。
 *
 * @param text - 文本内容
 * @returns token 数
 */
export function estimateTokens(text: string): number {
    return Math.ceil(String(text || '').length / 1.5);
}

/**
 * 可用输入预算：窗口 × 0.8，并给输出与固定 headroom 留位；无窗口信息返回 null
 *
 * @param windowTokens - 窗口token 列表
 * @param maxOutputTokens - 最大输出 token 数
 * @param headroomTokens - 预留 token 数
  * @returns 数值结果 或 null
 */
export function resolveContextBudget(
    windowTokens: number | undefined,
    maxOutputTokens: number,
    headroomTokens = 2_000,
): number | null {
    const window = Number(windowTokens) || 0;
    if (window <= 0) return null;
    const byRatio = Math.floor(window * 0.8);
    const byReserve = window - Math.max(0, maxOutputTokens) - Math.max(0, headroomTokens);
    return Math.max(256, Math.min(byRatio, byReserve));
}

/**
 * 待适配的上下文轮次。
 */
export interface ContextTurn {
    role: 'user' | 'assistant' | 'tool';
    text: string;
}

/**
 * 上下文适配结果。
 */
export interface FitContextResult<T extends ContextTurn> {
    turns: T[];
    /** 被替换为占位符的工具轮次数 */
    trimmedTurns: number;
    /** 被整体丢弃的轮次数 */
    droppedTurns: number;
    estimatedTokens: number;
    overBudget: boolean;
}

const TRIM_MARK = '[早期工具结果已裁剪以适配上下文]';

/**
 * 把对话裁到预算内。system 不计入 turns，需由调用方单独加上。
 * @param turns - 对话轮次
 * @param budgetTokens - 预算 token 数
 * @param systemChars - 系统字符数
  * @returns FitContextResult<T> 实例
 */
export function fitTurnsToBudget<T extends ContextTurn>(
    turns: readonly T[],
    budgetTokens: number | null,
    systemChars = 0,
): FitContextResult<T> {
    if (budgetTokens === null) {
        return {
            turns: [...turns],
            trimmedTurns: 0,
            droppedTurns: 0,
            estimatedTokens: estimateTokens(String(systemChars)) + turns.reduce((sum, turn) => sum + estimateTokens(turn.text), 0),
            overBudget: false,
        };
    }

    let working: T[] = [...turns];
    let trimmedTurns = 0;
    let droppedTurns = 0;

    const systemTokens = Math.ceil(Math.max(0, systemChars) / 1.5);
    const total = (): number =>
        systemTokens + working.reduce((sum, turn) => sum + estimateTokens(turn.text), 0);

    // 1) 先裁剪最旧的工具结果
    while (total() > budgetTokens) {
        const index = working.findIndex(turn => turn.role === 'tool' && turn.text !== TRIM_MARK);
        if (index < 0) break;
        working[index] = { ...working[index], text: TRIM_MARK };
        trimmedTurns += 1;
    }

    // 2) 再丢最旧的轮次，但保留最后一条（当前用户指令）
    while (total() > budgetTokens && working.length > 1) {
        working = working.slice(1);
        droppedTurns += 1;
    }

    const estimated = total();
    return {
        turns: working,
        trimmedTurns,
        droppedTurns,
        estimatedTokens: estimated,
        overBudget: estimated > budgetTokens,
    };
}

/**
 * 压缩触发阈值：有窗口信息时按窗口比例推导（字符 ≈ token × 1.5），
 * 否则沿用显式默认值。返回的阈值不会高于显式配置（用户可更早触发）。
 * @param windowTokens - 窗口token 列表
 * @param explicit - 显式配置
 * @returns 数值结果
 */
export function resolveCompactionCharThreshold(
    windowTokens: number | undefined,
    explicit?: number,
): number {
    const fallback = explicit && explicit > 0 ? explicit : 32_000;
    const window = Number(windowTokens) || 0;
    if (window <= 0) return fallback;
    const fromWindow = Math.floor(window * 0.8 * 1.5);
    return Math.max(4_000, Math.min(fallback, fromWindow));
}
