/**
 * step-keys.ts — 步骤键的单一真源（编译期 token）
 *
 * 背景（审计 B1 / C 清单 #8）：这些键既是 `stepResults[...]` / `stepCompleted` 的索引，
 * 也是步骤表里的运行时值。过去它们全靠字面量在 20+ 个文件里复写，改键名不会有
 * 任何编译错误（静默错位），所以抽成常量对象。
 *
 * 放在 shared/ 而不是 engine/：`shared/prompt-template-catalog.ts` 与
 * `shared/task-model.ts` 也要用这些键，而分层规则（tests/unit/architecture/
 * ui-internal-boundaries.test.ts）禁止 shared/ import engine/。
 *
 * 新增/改名步骤时**只改这里**，消费方一律 `STEP_KEYS.XXX`。
 * `'settlement'` 同时被用作 creation-flow 阶段 id / job 分类，语义重叠，
 * 字符串键收编留给 P2 #16。
 */
export const STEP_KEYS = {
    INFO_PLAN: 'infoPlan',
    PLOT_DISTILL: 'plotDistill',
    CHARACTER_SOUL: 'characterSoul',
    OUTLINE: 'outline',
    EMOTION_PLAN: 'emotionPlan',
    SCENE_EXPAND: 'sceneExpand',
    BODY_GENERATION: 'bodyGeneration',
    QUALITY_CONTROL: 'qualityControl',
    ANALYSIS_REPORT: 'analysisReport',
    /** 章节结算（步骤 10 的结果键：步骤表里 key 为空，状态里用这个键） */
    SETTLEMENT: 'settlement',
} as const;

/** 步骤键类型 */
export type StepKey = typeof STEP_KEYS[keyof typeof STEP_KEYS];
