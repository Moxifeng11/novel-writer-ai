/**
 * ai-types.ts — AI 引擎相关类型定义
 * 从 ai-engine.ts 底部提取，避免 2881 行巨文件
 */

export interface ChapterContext {
    chapterNumber: number;
    chapterTitle?: string;
    project: string;
    volume: string;
    chapterPlan?: string;
    outline?: string;
    infoPlan?: string;
    previousChapters?: string;
    unrevealedForeshadow?: string;
    timelineEvents?: string;
    worldView?: string;
    settingLib?: string;
    worldType?: string;
    worldEra?: string;
    forbiddenElements?: string;
    powerSystem?: string;
    writingStyle?: string;
    characters?: string;
    forcedReveal?: string[];
    unrevealedCount?: number;
    /** Rev 186：时间线/伏笔 ↔ 设定库/规划的关联索引（已格式化，≤1800 字） */
    storyLinkage?: string;
    model?: string;
}

/**
 * 审校上下文。
 */
export interface ReviewContext {
    characters?: string;
    settingLib?: string;
    previousChapter?: string;
}

/**
 * 大纲设置。
 */
export interface OutlineSettings {
    totalWords: string;
    volumes: number;
    wordsPerChapter: number;
    /** 题材（如：玄幻、都市），用于骨架阶段提示词 */
    theme?: string;
    /** 主题立意，用于骨架阶段提示词 */
    genre?: string;
}

/**
 * 世界要素集合。
 */
export interface WorldElements {
    characters?: string;
    locations?: string;
    factions?: string;
    items?: string;
    foreshadows?: string;
    timelineEvents?: string;
}

/**
 * 章节叙事指标 — 每章结算时记录的叙事维度数据
 */
export interface NarrativeMetric {
    chapterNum: number;
    densityScore: string;
    emotionTemp: number;
    conflictIntensity: number;
    activeCharacters: string[];
    foreshadowsRevealed: number;
    foreshadowsBuried: number;
}

/**
 * 多章叙事指标快照 — 用于趋势分析
 */
export interface NarrativeSnapshot {
    project: string;
    metrics: NarrativeMetric[];
    generatedAt: string;
}
