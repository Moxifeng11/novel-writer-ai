/**
 * step-gate.ts — 步骤执行门禁（2026-11-27，T8 最小可行子集）
 *
 * ## 云笔的做法 vs 本仓的取舍
 *
 * 云笔的 Skill SOP 是三段式门禁：
 *   B1 草案（不写库）→ B2 确认（真暂停）→ B3 写库+验证
 *
 * 完整实装需要改 step-runner 架构（中断-恢复、状态持久化、UI 确认交互），
 * 成本很高。本仓先实现**最小可行子集**：
 *
 * - 只给「不可跳过的非自动步骤」加执行前确认
 * - 确认是一次性的（点「开始」→ 跑 → 结束），不是完整状态机
 * - 不实现「草案-确认-写库」的三段式，只实现「执行前告知要做什么」
 *
 * ## 为什么这已经有用
 *
 * 本仓步骤链是自动连跑的：用户点了「开始」就一路跑到底。
 * 正文生成（第 7 步）会直接覆盖正文，用户没有中途叫停的机会。
 * 加一道「这一步会做什么、要花多少 token」的确认，就能避免误触。
 */

/**
 * 步骤的最小结构（shared/ 不能 import engine/，所以就地定义）。
 *
 * 与 `engine/step-definitions.ts` 的 FullStep 结构兼容。
 */
export interface StepLike {
    /** 步骤键（如 bodyGeneration / outline） */
    key: string;
    /** 是否自动步骤（不耗 AI 调用，永不确认） */
    auto: boolean;
    /** 是否必需 */
    required: boolean;
    /** 展示标签（可选，用于弹窗文案） */
    label?: string;
}

/** 门禁判定结果 */
export type StepGateDecision =
    /** 直接执行（auto 步骤 / 设置关闭门禁） */
    | 'auto-run'
    /** 需要用户确认后才执行 */
    | 'needs-confirm'
    /** 用户跳过 */
    | 'user-skip';

/** 门禁设置 */
export interface StepGateSettings {
    /** 'off' = 从不确认；'costly' = 只确认高成本步骤（默认）；'all' = 所有手动步骤都确认 */
    mode?: 'off' | 'costly' | 'all';
}

/** 高成本步骤（会调用 pro 模型 + 写正文/大量 token） */
const COSTLY_STEP_KEYS = new Set(['bodyGeneration', 'qualityControl', 'analysisReport']);

/**
 * 判定某步骤是否需要门禁确认。
 *
 * @param step - 步骤定义
 * @param settings - 门禁设置
 * @returns 判定结果
 * @example
 * decideStepGate(bodyStep, { mode: 'costly' }) // 'needs-confirm'
 * decideStepGate(autoStep, { mode: 'all' })    // 'auto-run'（auto 步骤永不确认）
 */
export function decideStepGate(step: StepLike, settings: StepGateSettings = {}): StepGateDecision {
    const mode = settings.mode ?? 'costly';
    // auto 步骤（上下文加载/结算）永不确认——它们不耗 AI 调用，确认只是噪音
    if (step.auto) return 'auto-run';
    if (mode === 'off') return 'auto-run';
    if (mode === 'all') return 'needs-confirm';
    // costly 模式：只确认高成本步骤
    return COSTLY_STEP_KEYS.has(step.key) ? 'needs-confirm' : 'auto-run';
}

/**
 * 门禁提示的结构化描述。
 *
 * 文案由界面层按 code 求值（`shared/` 不得持有界面文案，见
 * `scripts/cjk-keep-allowlist.json` 的引擎层文案门禁）。
 */
export interface StepGatePromptSpec {
    /** 门禁提示类型 */
    code: 'step-gate-confirm';
    /** 步骤标签（如「✍️ 正文生成」） */
    stepLabel: string;
    /** 步骤键 */
    stepKey: string;
    /** 章节名 */
    chapterName: string;
}

/**
 * 构造门禁提示的结构化描述（不含文案）。
 *
 * @param step - 步骤定义
 * @param chapterName - 章节名
 * @returns 结构化描述，供界面层渲染弹窗
 * @example
 * const spec = buildStepGatePrompt(bodyStep, '第12章 暗巷');
 * // 界面层用 settings.writing.stepGateDialog* 系列键求值文案
 */
export function buildStepGatePrompt(step: StepLike, chapterName: string): StepGatePromptSpec {
    return {
        code: 'step-gate-confirm',
        stepLabel: step.label || step.key,
        stepKey: step.key,
        chapterName,
    };
}
