import { FullStep } from '../../engine/step-runner';
import { StepLevel } from '../../engine/step-validator';

/**
 * D3：FullWriter 步骤导航的纯展示逻辑。
 *
 * 从 FullWriterView.renderStepNav 外迁的无副作用决策函数（不触碰 DOM、不读 private 字段）。
 * 调用方负责传入当前步骤状态快照并据返回值操作 DOM，行为逐字保留。
 */

/** 解析步骤的状态键（步骤0=context，步骤14=settlement，其余用 step.key）。 */
export function resolveStepKey(step: FullStep): string {
    return step.key || (step.index === 0 ? 'context' : 'settlement');
}

/**
 * 步骤颜色分组：规划蓝 | 灵魂紫 | 创作绿 | 审查橙。
 * 返回需追加的 CSS 类名，无分组时返回 null。
 *
 * v6.0 11步流程（索引 0-10）：
 *   - 灵魂紫：3(角色灵魂提取) / 5(情绪规划) / 6(Scene展开)
 *   - 创作绿：7(正文生成)
 *   - 审查橙：8(质量控制) / 9(分析报告)
 */
export function getStepColorClass(step: FullStep): string | null {
    if (step.index === 3 || step.index === 5 || step.index === 6) {
        return 'novel-writer-fw-step-soul';   // 角色灵魂层 / 情绪规划 / Scene展开 - 紫
    }
    // v6.0: 审查橙范围从 8-13 收缩为 8-9（qualityControl + analysisReport）
    if (step.index >= 8 && step.index <= 9) {
        return 'novel-writer-fw-step-audit';  // 审查类 - 橙
    }
    if (step.index === 7) {
        return 'novel-writer-fw-step-creative'; // 正文生成 - 绿
    }
    return null;
}

/** 步骤状态描述：图标、CSS 类、可选 tooltip。 */
export interface StepStatusDescriptor {
    icon: string;
    cls: string;
    title?: string;
}

/**
 * v6.0: 四级状态体系
 *   complete — 已走完（所有必填模块齐全）→ ✅
 *   partial  — 进行中（有部分内容但不完整）→ ◐
 *   skeleton — 模板骨架（只有空壳，未实际生成）→ ○
 *   empty    — 空/无内容 → ○
 *
 * @param stepLevels 每步骤的完整度等级
 * @param stepMissing 每步骤缺失的必填模块
 * @param staleSteps 过期步骤集合
 */
export function getStepStatusDescriptor(
    step: FullStep,
    stepKey: string,
    currentStepIndex: number,
    stepCompleted: Set<string>,
    stepResults: Record<string, string>,
    staleSteps: Set<string>,
    stepLevels: Record<string, StepLevel> = {},
    stepMissing: Record<string, string[]> = {}
): StepStatusDescriptor {
    // 当前步骤：激活状态
    if (currentStepIndex === step.index) {
        return { icon: '●', cls: 'novel-writer-fw-step-active', title: '当前步骤' };
    }

    const level = stepLevels[stepKey];
    const missing = stepMissing[stepKey] || [];

    // 已完成（complete 级别）
    if (level === 'complete' || stepCompleted.has(stepKey)) {
        // 检查是否过期
        if (staleSteps.has(stepKey)) {
            let title = '正文已修改，需重新执行';
            if (stepKey === 'fix') {
                title = '分析报告/质控已更新，建议重新修正';
            }
            return { icon: '⚠️', cls: 'novel-writer-fw-step-stale', title };
        }
        return { icon: '✅', cls: 'novel-writer-fw-step-done', title: '已完成' };
    }

    // 进行中（partial 级别）
    if (level === 'partial') {
        const missingText = missing.length > 0 ? `\n缺失：${missing.join('、')}` : '';
        return { icon: '◐', cls: 'novel-writer-fw-step-partial', title: `进行中${missingText}` };
    }

    // 模板骨架（skeleton 级别）
    if (level === 'skeleton') {
        return { icon: '◌', cls: 'novel-writer-fw-step-skeleton', title: '仅模板骨架，尚未生成内容' };
    }

    // 审查类有结果但不完整 → 显示为进行中
    // v6.0: 审查类范围从 8-13 收缩为 8-9（qualityControl + analysisReport）
    if (stepKey && stepResults[stepKey] && step.index >= 8 && step.index <= 9) {
        if (staleSteps.has(stepKey)) {
            let title = '正文已修改，需重新执行';
            return { icon: '⚠️', cls: 'novel-writer-fw-step-stale', title };
        }
        return { icon: '◐', cls: 'novel-writer-fw-step-partial', title: '有结果但未完成' };
    }

    // 待办（empty 级别）
    return { icon: '○', cls: 'novel-writer-fw-step-pending', title: '待执行' };
}

/**
 * 步骤是否可点击导航：当前步骤/已完成步骤始终可点；
 * 上下文加载完成后，业务步骤（1-9）均可自由切换。
 * v6.0：业务区间收缩为 1-9（11步流程，索引 0-10，首尾为自动步骤）
 */
export function isStepClickable(
    step: FullStep,
    stepKey: string,
    currentStepIndex: number,
    stepCompleted: Set<string>
): boolean {
    if (stepCompleted.has(stepKey) || currentStepIndex === step.index) {
        return true;
    }
    // v6.0: 可点击范围从 1-13 收缩为 1-9
    if (stepCompleted.has('context') && step.index >= 1 && step.index <= 9) {
        return true;
    }
    return false;
}
