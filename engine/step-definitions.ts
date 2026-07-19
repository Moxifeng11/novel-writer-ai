/**
 * step-definitions.ts — 步骤定义与类型
 *
 * 职责：步骤元数据定义、索引迁移映射、运行时上下文类型导出。
 *
 * 从 step-runner.ts 拆分而来。
 *
 * ============================================================
 * 架构说明：StepRunner 与 CoWriterEngine 的关系
 * ============================================================
 *
 * 本插件存在两条正文生成路径，共享同一套数据存储格式：
 *
 * 【路径 A：StepRunner 驱动的 AI 自动生成（已废弃）
 *   - 入口：full-writer-view.ts 步骤7（bodyGeneration）
 *   - 引擎：StepRunner.executeCurrentStep() → callAIWithRetry()
 *   - 特点：一次性整章生成，用户被动接受结果
 *   - 状态：deprecated，仅作为兼容旧数据的备选路径保留
 *
 * 【路径 B：CoWriterEngine 驱动的句级协同写作（推荐）
 *   - 入口：full-writer-view.ts 步骤7 的"进入句级协同写作"按钮
 *   - 引擎：CoWriterEngine（co-writer-engine.ts）
 *   - 特点：逐句生成 3 条候选，用户接受/编辑/验证后写入
 *   - 状态：当前推荐的正文生成方式
 *
 * 两条路径的数据格式一致性：
 *   - 正文文件路径：完全一致，均写入同一正文 .md 文件
 *   - 步骤状态：均更新 stepResults['bodyGeneration'] 和 stepCompleted
 *   - Frontmatter：均遵循同一套 status / entityNames 等元数据字段
 *   - 后续步骤：qualityControl / analysisReport / settlement 均基于同一正文
 *   - 结论：两条路径产出的数据完全兼容，可随时切换
 *
 * 为什么 bodyGeneration（路径 A）被废弃：
 *   1. 一次性整章生成质量不可控，难以中途调整方向
 *   2. 句级协同写作让用户掌握创作主导权，AI 是辅助而非替代
 *   3. 逐句验证降低 AI 痕迹，反检测效果更好
 *   4. 支持多方向候选，增加创作可能性
 *
 * 推荐工作流：
 *   步骤 1-6（规划阶段）→ 步骤 7（进入句级协同写作）→ CoWritingView →
 *   完成正文 → 回到 FullWriterView → 步骤 8-10（质量控制/分析/结算）
 * ============================================================
 */

import { validateStepResult } from './step-validator';
import { WORD_MIN_RATIO } from '../shared/thresholds';

// ============================================================
// 策略类型
// ============================================================

export type ModelStrategy = 'pro' | 'flash' | 'default';

export type PreValidationResult = { passed: boolean; error?: string; warning?: string };
export type PostValidationResult = { passed: boolean; error?: string; warning?: string };

export type PreValidationFn = (ctx: StepRunCtx) => PreValidationResult;
export type PostValidationFn = (content: string, ctx: StepRunCtx) => PostValidationResult;

// ============================================================
// 前置校验函数
// ============================================================

export const preCheckQualityControl: PreValidationFn = (ctx) => {
    const qcContent = ctx.stepResults['qualityControl'];
    if (!qcContent) {
        return { passed: false, error: '请先执行「质量控制」再执行此步骤' };
    }
    const qcValidation = validateStepResult('qualityControl', qcContent);
    if (qcValidation.level !== 'complete') {
        return { passed: true, warning: `⚠️ 质量控制内容不完整（${qcValidation.missing.join('、')}），结果可能不准确。如确认无误可继续。` };
    }
    return { passed: true };
};

const preCheckBodyGeneration: PreValidationFn = (ctx) => {
    if (!ctx.stepCompleted.has('bodyGeneration')) {
        return { passed: false, error: '请先执行「正文生成」步骤' };
    }
    const bodyContent = ctx.stepResults['bodyGeneration'];
    if (bodyContent) {
        const bodyValidation = validateStepResult('bodyGeneration', bodyContent);
        if (bodyValidation.level !== 'complete') {
            return { passed: true, warning: `⚠️ 正文内容未达完整标准（${bodyValidation.missing.join('、')}），分析结果可能有偏差。` };
        }
    }
    return { passed: true };
};

// ============================================================
// 后置校验函数
// ============================================================

const postCheckWordCount: PostValidationFn = (content, ctx) => {
    const baseWords = ctx.defaultWordCount || 3000;
    const outputLen = content.length;
    const minWords = Math.floor(baseWords * WORD_MIN_RATIO);
    if (outputLen < minWords) {
        return { passed: false, error: `⚠️ 字数不足：输出 ${outputLen} 字，低于最低要求 ${minWords} 字（目标 ${baseWords} 字）。建议重新生成或使用迭代精修扩充。` };
    }
    if (outputLen < baseWords) {
        return { passed: true, warning: `⚠️ 字数略低：输出 ${outputLen} 字，目标 ${baseWords} 字。如果内容完整可以接受。` };
    }
    return { passed: true };
};

// ============================================================
// 步骤定义
// ============================================================

/** 完整步骤描述（含步骤0和步骤10） */
export type FullStep = {
    index: number;
    key: string;          // 对应 ALL_STEPS 的 key，步骤0和10为空
    label: string;
    required: boolean;
    canSkip: boolean;
    auto: boolean;        // 自动执行
    deprecated?: boolean; // 已由新路径替代的步骤
    modelStrategy: ModelStrategy;
    preValidation: PreValidationFn | null;
    postValidation: PostValidationFn | null;
};

export const ALL_FULL_STEPS: FullStep[] = [
    { index: 0,  key: '',               label: '📦 上下文加载',     required: true,  canSkip: false, auto: true,  modelStrategy: 'default', preValidation: null, postValidation: null },
    { index: 1,  key: 'infoPlan',       label: '📋 信息规划',       required: true,  canSkip: false, auto: false, modelStrategy: 'flash',   preValidation: null, postValidation: null },
    { index: 2,  key: 'plotDistill',    label: '🔥 情节蒸馏',       required: false, canSkip: true,  auto: false, modelStrategy: 'flash',   preValidation: null, postValidation: null },
    { index: 3,  key: 'characterSoul',  label: '🫀 角色灵魂提取',   required: false, canSkip: true,  auto: true,  modelStrategy: 'default', preValidation: null, postValidation: null },
    { index: 4,  key: 'outline',        label: '📝 大纲摘要',       required: false, canSkip: true,  auto: false, modelStrategy: 'flash',   preValidation: null, postValidation: null },
    { index: 5,  key: 'emotionPlan',    label: '🎭 情绪规划',       required: false, canSkip: true,  auto: false, modelStrategy: 'flash',   preValidation: null, postValidation: null },
    { index: 6,  key: 'sceneExpand',    label: '🎬 Scene展开',      required: false, canSkip: true,  auto: false, modelStrategy: 'flash',   preValidation: null, postValidation: null },
    /**
     * @deprecated 正文生成已统一迁移至句级协同写作工作台（CoWritingView）
     * 
     * 废弃说明：
     * - 本步骤（AI 一次性整章生成）为 v5.0 之前的旧模式
     * - 推荐使用「句级协同写作」：逐句生成 3 条候选，用户接受/编辑/验证
     * - 两条路径数据完全兼容，共享同一正文文件和 stepResults['bodyGeneration']
     * - 入口：步骤 7 页面顶部的「进入句级协同写作」按钮
     * 
     * 保留原因：
     * - 兼容已保存的旧章节数据
     * - 作为批量快速生成的备选方案（不推荐用于正式创作）
     */
    { index: 7,  key: 'bodyGeneration', label: '✍️ 正文生成',       required: true,  canSkip: false, auto: false, modelStrategy: 'pro',     preValidation: null, postValidation: postCheckWordCount, deprecated: true },
    { index: 8,  key: 'qualityControl', label: '🎯 质量控制',       required: false, canSkip: true,  auto: false, modelStrategy: 'pro',     preValidation: null, postValidation: null },
    { index: 9,  key: 'analysisReport', label: '📊 分析报告',       required: false, canSkip: true,  auto: false, modelStrategy: 'flash',   preValidation: preCheckBodyGeneration, postValidation: null },
    { index: 10, key: '',               label: '💾 章节结算',       required: true,  canSkip: false, auto: true,  modelStrategy: 'default', preValidation: null, postValidation: null },
];

/**
 * P2-5: 旧 index → 新 index 迁移映射表（已保存的 frontmatter 兼容）
 *
 * 历史索引序列（V2 灵魂驱动插入时为兼容已落盘数据沿用）：
 *   0, 1, 2, 12, 3, 13, 14, 4, 5, 6, 7, 8, 9, 10, 11
 *
 * 本表用于 chapter-state-manager 启动时一次性升级老数据到最新 0-10 索引体系。
 */
export const STEP_INDEX_MIGRATION_MAP: Readonly<Record<number, number>> = Object.freeze({
    0: 0,    // 上下文加载
    1: 1,    // infoPlan
    2: 2,    // plotDistill
    12: 3,   // characterSoul（V2 插入）
    3: 4,    // outline
    13: 5,   // emotionPlan（V2 插入）
    14: 6,   // sceneExpand（V2 插入）
    4: 7,    // bodyGeneration
    5: 8,    // selfCheck → 合并入 qualityControl
    6: 8,    // continuityCheck → 合并入 qualityControl
    7: 8,    // fix（deprecated，不再在导航中，跳到质量控制）
    8: 8,    // qualityControl → 新位置 8
    9: 8,    // finalFix（deprecated，不再在导航中，跳到质量控制）
    10: 9,   // analysisReport → 新位置 9
    11: 10,  // 章节结算 → 新位置 10
});

/**
 * 将历史 logicalIndex 升级到新的连续索引。
 * 已是新值（≥0 且 <=14 且不在旧映射范围内）→ 原样返回。
 * 旧值（包含 12/13/14 这种 V2 插槽）→ 映射到新值。
 */
export function migrateStepIndex(oldIndex: number): number {
    if (typeof oldIndex !== 'number' || !Number.isFinite(oldIndex)) return 0;
    // 注意：旧索引和新索引在 0-11 区间存在重叠语义（如旧 4=bodyGeneration / 新 4=outline），
    // 因此调用方必须在「首次读取已落盘 frontmatter」时调一次，结果落盘后下次直接用新值即可。
    return STEP_INDEX_MIGRATION_MAP[oldIndex] ?? oldIndex;
}

/** 步骤执行需要的运行时上下文（由 FullWriterView 提供） */
export type StepRunCtx = {
    stepResults: Record<string, string>;
    stepCompleted: Set<string>;
    currentStepIndex: number;
    setCurrentStepIndex: (v: number) => void;
    tabContent: HTMLElement;
    systemPromptEl: HTMLTextAreaElement;
    userPromptEl: HTMLTextAreaElement;
    temperatureSlider: HTMLInputElement;
    chapDir: string;
    chapterName: string;
    volume: string;
    chapterNum: number;
    project: string;
    vars: Record<string, string>;
    isLoading: boolean;
    buildTemplateVars: () => Promise<Record<string, string>>;
    saveStepResult: (stepKey: string, content: string) => Promise<void>;
    renderInContainer: (container: HTMLElement) => Promise<void>;
    setIsLoading: (loading: boolean) => void;
    refreshWorkspace: () => void;
    // ✅ v1.6.0 实体状态追踪：步骤完成后回调
    onStepComplete?: (stepKey: string, content: string) => Promise<void>;
    /** 标记哪些 stepKey 在本会话中由 AI 生成（非磁盘恢复） */
    generatedThisSession?: Set<string>;
    /** 后置字数校验用的目标字数（默认 3000） */
    defaultWordCount?: number;
};
