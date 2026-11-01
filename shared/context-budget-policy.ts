/**
 * context-budget-policy.ts — 上下文配额策略（纯函数）
 *
 * 旧实现用一批固定常量给上下文切片：上一章结尾 500 字、长篇记忆 1500 字/12 条、
 * 场景卡 12 场/3000 字、实体速览 8 人、记忆碎片 3 条×200 字……这些值是按 32K 窗口
 * 时代定的；闸门修到真实窗口后（`contextTokenCap` 默认按模型能力），继续用旧常量
 * 等于把 95% 的窗口空着、却把关键上下文切掉——实测表现为剧情跳步与人物 OOC。
 *
 * 这里按「输入预算」推导各段配额：给足下限，再随窗口线性放大，并留绝对上限防失控。
 */

export interface ContextQuotas {
    /** 上一章结尾注入字符数（V2「从上一章结尾往下写」的锚点） */
    prevChapterEndingChars: number;
    /** 长篇记忆整体字符预算 */
    longTermMemoryChars: number;
    /** 长篇记忆每类事实条数 */
    longTermMemoryPerCategory: number;
    /** 场景卡最多注入场数 */
    sceneCardMaxCount: number;
    /** 单张场景卡字符预算 */
    sceneCardChars: number;
    /** 实体速览最多角色数 */
    entityGraphMaxChars: number;
    /** 人物字段单字段字符上限（故事总线紧凑文本的降级阈值） */
    entityFieldChars: number;
    /** 知识注入单维度字符预算（约 3% 窗口） */
    knowledgePerDimensionChars: number;
    /** 记忆碎片条数 */
    memoryFragmentCount: number;
    /** 单条记忆碎片字符数 */
    memoryFragmentChars: number;
}

/** 未指定预算时的默认参考窗口（约 120K token，对应主流长上下文模型） */
const DEFAULT_INPUT_TOKENS = 120_000;

/** 基准窗口：配额按 120K 设计，低于此值按比例收紧，高于此值线性放大但受绝对上限约束 */
const BASE_INPUT_TOKENS = 120_000;

function scaleFor(maxInputTokens: number): number {
    const tokens = Number.isFinite(maxInputTokens) && maxInputTokens > 0 ? maxInputTokens : DEFAULT_INPUT_TOKENS;
    // 32K 窗口 → 0.35；120K → 1；1M → 3（再由各字段的绝对上限兜住）
    return Math.max(0.3, Math.min(3.2, tokens / BASE_INPUT_TOKENS));
}

/**
 * 按 factor 缩放，并夹在 [floor, max] 之间。
 * floor 必须是旧常量：小窗口（本地 32K）时不能比改造前切得更少，
 * 否则「按预算推导」反而成了缩水（G2-4：32K 下 prevChapterEnding 曾从 500 掉到 360）。
 */
function scale(value: number, factor: number, max: number, floor: number): number {
    return Math.round(Math.min(max, Math.max(floor, value * factor)));
}

/**
 * 推导当前输入预算下的配额。
 * 下限就是旧常量（不会比过去更差），放大倍数随窗口增长。
 */
export function resolveContextQuotas(maxInputTokens?: number): ContextQuotas {
    const factor = scaleFor(maxInputTokens ?? DEFAULT_INPUT_TOKENS);
    return {
        prevChapterEndingChars: scale(1200, factor, 4000, 500),
        longTermMemoryChars: scale(3000, factor, 12000, 1500),
        longTermMemoryPerCategory: scale(20, factor, 48, 12),
        sceneCardMaxCount: scale(12, factor, 40, 12),
        // 旧常量是「12 场 / 共 3000 字」，折合单卡约 250；保留 400 作为单卡下限
        sceneCardChars: scale(400, factor, 900, 400),
        entityGraphMaxChars: scale(20, factor, 60, 8),
        entityFieldChars: scale(600, factor, 1600, 600),
        knowledgePerDimensionChars: scale(1800, factor, 6000, 600),
        memoryFragmentCount: scale(6, factor, 20, 3),
        memoryFragmentChars: scale(400, factor, 1200, 200),
    };
}

let activeTokens = 0;
let activeQuotasCache: ContextQuotas | null = null;

/**
 * 当前生效的配额。
 * 调用点大多是同步的常量位置（切片上限），不想每处都传预算：
 * 由 `setActiveInputBudget()` 在一键/协同入口设置一次即可。
 */
export function activeContextQuotas(): ContextQuotas {
    if (!activeQuotasCache) activeQuotasCache = resolveContextQuotas();
    return activeQuotasCache;
}

/**
 * 在「一次流程」内临时生效的输入预算，结束后恢复上一个值（G2-4）。
 *
 * activeTokens 是进程级单值：协同写作、一键生成、逐步执行如果各自 set 了不同模型的
 * 预算，异步交错时后开始的流程会污染前一个流程的切片配额（实测：小窗口模型先跑，
 * 后续云端流程仍按 120K 默认配额切上下文，或反过来把云端流程压到本地配额）。
 * 所有入口统一用这个包装，保证「谁设置、谁还原」。
 */
export async function withActiveInputBudget<T>(
    maxInputTokens: number | undefined,
    fn: () => T | Promise<T>,
): Promise<T> {
    const previous = activeTokens;
    setActiveInputBudget(maxInputTokens);
    try {
        return await fn();
    } finally {
        setActiveInputBudget(previous || undefined);
    }
}

/** 设置当前生效的输入预算（进入一次生成前调用；传 0/undefined 恢复默认） */
export function setActiveInputBudget(maxInputTokens?: number): void {
    activeTokens = Number.isFinite(maxInputTokens) && (maxInputTokens || 0) > 0
        ? Math.floor(maxInputTokens as number)
        : 0;
    activeQuotasCache = resolveContextQuotas(activeTokens || undefined);
}

/** 当前设置的预算（0 = 默认）；测试与账本展示用 */
export function getActiveInputBudget(): number {
    return activeTokens;
}

/** 测试用：清空缓存 */
export function resetActiveInputBudget(): void {
    activeTokens = 0;
    activeQuotasCache = null;
}
