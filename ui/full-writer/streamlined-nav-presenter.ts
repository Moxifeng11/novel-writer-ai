import { FullStep } from '../../engine/step-runner';
import { StepLevel } from '../../engine/step-validator';
import { resolveStepKey } from './step-nav-presenter';

export type StreamlinedPhaseKey = 'context' | 'planning' | 'writing' | 'review' | 'settlement';

export interface StreamlinedPhase {
    key: StreamlinedPhaseKey;
    label: string;
    icon: string;
    steps: string[];
    stepIndexes: number[];
    colorClass: string | null;
}

export type PhaseStatus = 'pending' | 'loading' | 'partial' | 'complete' | 'stale' | 'active';

export interface PhaseStatusDescriptor {
    icon: string;
    cls: string;
    title: string;
    status: PhaseStatus;
}

const STREAMLINED_PHASES: StreamlinedPhase[] = [
    {
        key: 'context',
        label: '上下文加载',
        icon: '🔄',
        steps: ['context', 'characterSoul'],
        stepIndexes: [0, 3],
        colorClass: null,
    },
    {
        key: 'planning',
        label: '章节规划',
        icon: '📋',
        steps: ['infoPlan', 'plotDistill', 'outline', 'emotionPlan', 'sceneExpand'],
        stepIndexes: [1, 2, 4, 5, 6],
        colorClass: 'novel-writer-fw-step-soul',
    },
    {
        key: 'writing',
        label: '正文写作',
        icon: '✍️',
        steps: ['bodyGeneration'],
        stepIndexes: [7],
        colorClass: 'novel-writer-fw-step-creative',
    },
    {
        key: 'review',
        label: '质量审查',
        icon: '🎯',
        steps: ['qualityControl', 'analysisReport'],
        stepIndexes: [8, 9],
        colorClass: 'novel-writer-fw-step-audit',
    },
    {
        key: 'settlement',
        label: '章节结算',
        icon: '💾',
        steps: ['settlement'],
        stepIndexes: [10],
        colorClass: null,
    },
];

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

    const totalSteps = phase.steps.length;
    let completedCount = 0;
    let partialCount = 0;
    let staleCount = 0;

    for (const stepKey of phase.steps) {
        if (stepCompleted.has(stepKey) || stepLevels[stepKey] === 'complete') {
            completedCount++;
            if (staleSteps.has(stepKey)) staleCount++;
        } else if (stepLevels[stepKey] === 'partial' || stepResults[stepKey]) {
            partialCount++;
        }
    }

    if (completedCount === totalSteps) {
        if (staleCount > 0) {
            return { icon: '⚠️', cls: 'novel-writer-fw-step-stale', title: '已过期，需重新执行', status: 'stale' };
        }
        return { icon: '✅', cls: 'novel-writer-fw-step-done', title: '已完成', status: 'complete' };
    }

    if (completedCount > 0 || partialCount > 0) {
        return { icon: '◐', cls: 'novel-writer-fw-step-partial', title: `进行中（${completedCount + partialCount}/${totalSteps}）`, status: 'partial' };
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

    for (let i = phase.steps.length - 1; i >= 0; i--) {
        if (stepCompleted.has(phase.steps[i])) {
            return phase.stepIndexes[i];
        }
    }

    return phase.stepIndexes[0];
}

export function getAllStepKeysForPhase(phaseKey: StreamlinedPhaseKey): string[] {
    const phase = STREAMLINED_PHASES.find(p => p.key === phaseKey);
    return phase ? phase.steps : [];
}
