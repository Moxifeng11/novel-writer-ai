/**
 * engine/co-writer/co-writer-types.ts
 * CoWriterEngine 共享类型 — 单一来源（P1-4 拆分阶段一）。
 *
 * 从 co-writer-engine.ts 文件头迁移而来。
 * 原 co-writer-engine.ts 通过 `export type` 重新导出，外部 3 个 import 路径不变。
 */
import type { CharacterPairRelation } from '../relationship-engine';
import type { OOCCheckResult } from '../../shared/co-writer-types';
import type { EntityStateChange } from '../entity-state-manager';

export type WritingMode = 'continue' | 'rewrite' | 'dialogue' | 'action';

export interface PlotNode {
    id: string;
    index: number;
    location: string;
    characters: string;
    conflict: string;
    goal: string;
    infoIncrement: string;
    source: 'outline' | 'scene_expand' | 'plot_distill';
    completed: boolean;
}

export interface PlotProgress {
    totalNodes: number;
    completedNodes: number;
    currentIndex: number;
    completionPercent: number;
    nextNode: PlotNode | null;
    allCompleted: boolean;
}

export interface Suggestion {
    id: string;
    text: string;
    reasoning?: string;
    temperature: number;
    style: 'default' | 'creative' | 'conservative';
}

export interface ContextSnapshot {
    project: string;
    chapterName: string;
    allChars: string;
    allFactions: string;
    allLocs: string;
    allItems: string;
    /**
     * 伏笔库聚合数据。结构由 gatherAll 返回的 ForeshadowData 决定（详见 ../context/context-types.ts）。
     */
    foreshadows: unknown;
    relationshipStates: CharacterPairRelation[];
    crossVolumeContext: string;
    worldView: string;
    worldType: string;
    writingStyle: string;
    writingRules: string;
    protagonistSoulDetail: string;
    emotionPlan: string;
    sceneExpansion: string;
    chapPlan: string;
    prevChaptersSummary: string;
    settingLib: string;
    timeline: string;
    characterCores: string;
    triggeredMemories: string;
    precedingText: string;
    cursorHint: string;
    currentMode: WritingMode;
    gatheredAt: number;
    dirtyFields: Set<string>;
}

export interface SettingGuardReport {
    oocResult: OOCCheckResult | null;
    entityChanges: EntityStateChange[];
    checkedAt: number;
}
