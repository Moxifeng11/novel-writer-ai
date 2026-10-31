/**
 * deconstruction-settings.ts — 拆解引擎的维度类型与默认配置
 *
 * 为什么放在 shared：core/settings-service 生成 DEFAULT_SETTINGS 时需要默认值，
 * engine/deconstruction-scheduler、ui 设置面板、main 再导出也都要用。
 * 常量与类型零运行时依赖，放 engine 会让 core 产生一条 core → engine 反向边。
 */

export type BreakdownDimension = 'style' | 'rhythm' | 'technique' | 'structure' | 'character' | 'foreshadow' | 'commercial' | 'readability';

export type DeconstructionQualityLevel = 'fast' | 'standard' | 'deep';

export interface DeconstructionEngineSettings {
    defaultQualityLevel: 'fast' | 'standard' | 'deep';
    enableAutoUpgrade: boolean;
    enabledDimensions: BreakdownDimension[];
    includeCommercial: boolean;
    includeReadability: boolean;
    vectorEnabled: boolean;
    vectorModel: string;
    vectorCacheSize: number;
    vectorBatchSize: number;
    llmEnabled: boolean;
    llmModel: string;
    maxConcurrency: number;
    textSampleLimit: number;
    dimensionConcurrency: number;
    sampleMode?: boolean;
}

export const DEFAULT_DECONSTRUCTION_ENGINE_SETTINGS: DeconstructionEngineSettings = {
    defaultQualityLevel: 'standard',
    enableAutoUpgrade: true,
    enabledDimensions: ['style', 'rhythm', 'technique', 'structure', 'character', 'foreshadow'],
    includeCommercial: true,
    includeReadability: true,
    vectorEnabled: true,
    vectorModel: 'bge-m3',
    vectorCacheSize: 5000,
    vectorBatchSize: 32,
    llmEnabled: false,
    llmModel: 'deepseek-r1:7b',
    maxConcurrency: 2,
    textSampleLimit: 100000,
    dimensionConcurrency: 3,
    sampleMode: false,
};

export const ALL_BREAKDOWN_DIMENSIONS: BreakdownDimension[] = [
    'style', 'rhythm', 'technique', 'structure', 'character', 'foreshadow', 'commercial', 'readability',
];

export const DIMENSION_LABELS: Record<BreakdownDimension, string> = {
    style: '风格分析',
    rhythm: '节奏分析',
    technique: '写作技巧',
    structure: '结构拆解',
    character: '人设提取',
    foreshadow: '伏笔梳理',
    commercial: '商业价值',
    readability: '可读性分析',
};
