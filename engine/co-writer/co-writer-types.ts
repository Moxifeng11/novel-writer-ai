/**
 * engine/co-writer/co-writer-types.ts
 * CoWriterEngine 共享类型 — 单一来源（P1-4 拆分阶段一）。
 *
 * 从 co-writer-engine.ts 文件头迁移而来。
 * 原 co-writer-engine.ts 通过 `export type` 重新导出，外部 3 个 import 路径不变。
 */
import type { CharacterPairRelation } from '@/engine/relationship-engine';
import type { OOCCheckResult } from '@/shared/co-writer-types';
import type { EntityStateChange } from '@/engine/entity-state-manager';

/**
 * WritingMode 类型定义。
 */
export type WritingMode = 'continue' | 'rewrite' | 'dialogue' | 'action';

/**
 * 情节节点结构定义。
 */
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

/**
 * PlotProgress 类型定义。
 */
export interface PlotProgress {
    totalNodes: number;
    completedNodes: number;
    currentIndex: number;
    completionPercent: number;
    nextNode: PlotNode | null;
    allCompleted: boolean;
}

/**
 * Suggestion 类型定义。
 */
export interface Suggestion {
    id: string;
    text: string;
    reasoning?: string;
    temperature: number;
    style: 'default' | 'creative' | 'conservative';
}

/**
 * 上下文快照结构定义。
 */
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
    /** 长篇记忆：事实索引中已确认的人物/世界观/剧情事实（空表示无） */
    longTermMemoryContext?: string;
    /** 实体状态速览：结算回写的境界/位置/所有权/近况（v4.20 图谱反查，空表示无） */
    entityRelationsContext?: string;
    /** 同人约束：原作核心设定 + 三条创作规则（原创项目为空） */
    fanficRulesContext?: string;
    /** 创作模式硬约束：短篇/剧本的平台规格与输出格式（长篇为空） */
    creationModeContext?: string;
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

/**
 * SettingGuardReport 类型定义。
 */
export interface SettingGuardReport {
    oocResult: OOCCheckResult | null;
    entityChanges: EntityStateChange[];
    checkedAt: number;
}
