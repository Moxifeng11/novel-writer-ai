import { ALL_FULL_STEPS, FullStep } from '../../engine/step-definitions';
import { StepLevel } from '../../engine/step-validator';
import { createLogger } from '../../shared/logger';

const log = createLogger('StreamlinedNav');

/**
 * 精简导航阶段键。
 */
export type StreamlinedPhaseKey = 'context' | 'planning' | 'writing' | 'review' | 'settlement';

/**
 * 精简导航阶段。
 */
export interface StreamlinedPhase {
    key: StreamlinedPhaseKey;
    label: string;
    icon: string;
    steps: string[];
    stepIndexes: number[];
    colorClass: string | null;
    /** 必做步骤（来自 ALL_FULL_STEPS.required）；全可选阶段为空数组 */
    requiredSteps: string[];
}

/**
 * 阶段状态。
 */
export type PhaseStatus = 'pending' | 'loading' | 'partial' | 'complete' | 'stale' | 'active';

/**
 * 阶段状态描述。
 */
export interface PhaseStatusDescriptor {
    icon: string;
    cls: string;
    title: string;
    status: PhaseStatus;
}

interface PhaseDefinition {
    key: StreamlinedPhaseKey;
    label: string;
    icon: string;
    colorClass: string | null;
    stepKeys: string[];
}

const PHASE_DEFINITIONS: PhaseDefinition[] = [
    { key: 'context', label: '上下文加载', icon: '🔄', colorClass: null, stepKeys: ['context', 'characterSoul'] },
    { key: 'planning', label: '章节规划', icon: '📋', colorClass: 'novel-writer-fw-step-soul', stepKeys: ['infoPlan', 'plotDistill', 'outline', 'emotionPlan', 'sceneExpand'] },
    { key: 'writing', label: '正文写作', icon: '✍️', colorClass: 'novel-writer-fw-step-creative', stepKeys: ['bodyGeneration'] },
    { key: 'review', label: '质量审查', icon: '🎯', colorClass: 'novel-writer-fw-step-audit', stepKeys: ['qualityControl', 'analysisReport'] },
    { key: 'settlement', label: '章节结算', icon: '💾', colorClass: null, stepKeys: ['settlement'] },
];

/** 步骤 0 / 10 在 ALL_FULL_STEPS 中 key 为空，导航层使用合成 key */
function navStepKey(step: FullStep): string {
    if (step.index === 0) return 'context';
    if (step.index === 10) return 'settlement';
    return step.key;
}

/**
 * 阶段表由 ALL_FULL_STEPS 派生，不再手写 index。
 * 这样「加/删/挪步骤」时不会出现导航与实际步骤错位。
 */
const STREAMLINED_PHASES: StreamlinedPhase[] = PHASE_DEFINITIONS.map((def) => {
    const members = def.stepKeys
        .map((key) => ALL_FULL_STEPS.find((s) => navStepKey(s) === key))
        .filter((s): s is FullStep => !!s);
    return {
        key: def.key,
        label: def.label,
        icon: def.icon,
        colorClass: def.colorClass,
        steps: members.map(navStepKey),
        stepIndexes: members.map((s) => s.index),
        requiredSteps: members.filter((s) => s.required).map(navStepKey),
    };
});

// 配置漂移检测：阶段表必须覆盖全部步骤，否则导航会漏步骤
const coveredIndexes = new Set(STREAMLINED_PHASES.flatMap((p) => p.stepIndexes));
const uncoveredSteps = ALL_FULL_STEPS.filter((s) => !coveredIndexes.has(s.index));
if (uncoveredSteps.length > 0) {
    log.warn('[StreamlinedNav] 阶段表未覆盖以下步骤:', uncoveredSteps.map((s) => `${s.index}:${navStepKey(s)}`).join(', '));
}

export function getStreamlinedPhases(): StreamlinedPhase[] {
    return STREAMLINED_PHASES;
}

export function getPhaseForStep(stepKey: string): StreamlinedPhase | null {
    for (const phase of STREAMLINED_PHASES) {
        if (phase.steps.includes(stepKey)) return phase;
    }
    return null;
}

export function getPhaseForStepIndex(stepIndex: number): StreamlinedPhase | null {
    for (const phase of STREAMLINED_PHASES) {
        if (phase.stepIndexes.includes(stepIndex)) return phase;
    }
    return null;
}

export function getPhaseStatusDescriptor(
    phase: StreamlinedPhase,
    currentStepIndex: number,
    stepCompleted: Set<string>,
    stepResults: Record<string, string>,
    staleSteps: Set<string>,
    stepLevels: Record<string, StepLevel> = {}
): PhaseStatusDescriptor {
    const isActivePhase = phase.stepIndexes.includes(currentStepIndex);

    if (isActivePhase) {
        return { icon: '●', cls: 'novel-writer-fw-step-active', title: '当前阶段', status: 'active' };
    }

    const isDone = (stepKey: string): boolean =>
        stepCompleted.has(stepKey) || stepLevels[stepKey] === 'complete';

    // 完成口径：必做步骤全部完成即算阶段完成（用户可跳过可选步骤）；
    // 全可选阶段（如质量审查）做过任意一步即算完成。
    const hasRequired = phase.requiredSteps.length > 0;
    const requiredKeys = hasRequired ? phase.requiredSteps : [];
    const optionalKeys = hasRequired
        ? phase.steps.filter((key) => !requiredKeys.includes(key))
        : phase.steps;
    const requiredDone = requiredKeys.filter(isDone).length;
    const optionalDone = optionalKeys.filter(isDone).length;
    const staleCount = phase.steps.filter((key) => staleSteps.has(key)).length;
    const partialCount = phase.steps.filter(
        (key) => !isDone(key) && (stepLevels[key] === 'partial' || Boolean(stepResults[key])),
    ).length;

    const requiredSatisfied = hasRequired
        ? requiredDone === requiredKeys.length
        : optionalDone > 0;

    if (requiredSatisfied) {
        if (staleCount > 0) {
            return { icon: '⚠️', cls: 'novel-writer-fw-step-stale', title: '已过期，需重新执行', status: 'stale' };
        }
        const optionalHint = optionalKeys.length > 0 ? `（可选 ${optionalDone}/${optionalKeys.length}）` : '';
        return { icon: '✅', cls: 'novel-writer-fw-step-done', title: `已完成${optionalHint}`, status: 'complete' };
    }

    if (requiredDone > 0 || optionalDone > 0 || partialCount > 0) {
        const doneHint = hasRequired
            ? `必做 ${requiredDone}/${requiredKeys.length}`
            : `已完成 ${optionalDone}/${phase.steps.length}`;
        const optionalHint = hasRequired && optionalKeys.length > 0
            ? ` · 可选 ${optionalDone}/${optionalKeys.length}`
            : '';
        return {
            icon: '◐',
            cls: 'novel-writer-fw-step-partial',
            title: `进行中（${doneHint}${optionalHint}）`,
            status: 'partial',
        };
    }

    return { icon: '○', cls: 'novel-writer-fw-step-pending', title: '待执行', status: 'pending' };
}

export function isPhaseClickable(
    phase: StreamlinedPhase,
    currentStepIndex: number,
    stepCompleted: Set<string>
): boolean {
    if (phase.stepIndexes.includes(currentStepIndex)) return true;

    for (const stepKey of phase.steps) {
        if (stepCompleted.has(stepKey)) return true;
    }

    if (stepCompleted.has('context')) {
        if (phase.key === 'planning') return true;
        if (phase.key === 'writing' && isPlanningComplete(stepCompleted)) return true;
        if (phase.key === 'review') return true;
        if (phase.key === 'settlement') return true;
    }

    return false;
}

function isPlanningComplete(stepCompleted: Set<string>): boolean {
    const planningSteps = ['infoPlan', 'plotDistill', 'outline', 'emotionPlan', 'sceneExpand'];
    return planningSteps.some(s => stepCompleted.has(s));
}

export function getFirstStepOfPhase(phase: StreamlinedPhase): string {
    return phase.steps[0];
}

export function mapStreamlinedPhaseToStepIndex(phaseKey: StreamlinedPhaseKey, stepCompleted: Set<string>): number {
    const phase = STREAMLINED_PHASES.find(p => p.key === phaseKey);
    if (!phase) return 0;

    // 上下文加载是自动步骤，点击固定回到起点
    if (phase.key === 'context') return 0;

    // 进入阶段时定位到「第一个未完成步骤」：跳回最后一个已完成步骤会让用户重复劳动
    for (let i = 0; i < phase.steps.length; i++) {
        if (!stepCompleted.has(phase.steps[i])) {
            return phase.stepIndexes[i];
        }
    }

    return phase.stepIndexes[phase.stepIndexes.length - 1];
}

export function getAllStepKeysForPhase(phaseKey: StreamlinedPhaseKey): string[] {
    const phase = STREAMLINED_PHASES.find(p => p.key === phaseKey);
    return phase ? phase.steps : [];
}
