/**
 * deconstruction-settings.ts — 拆解引擎的维度类型与默认配置
 *
 * 为什么放在 shared：core/settings-service 生成 DEFAULT_SETTINGS 时需要默认值，
 * engine/deconstruction-scheduler、ui 设置面板、main 再导出也都要用。
 * 常量与类型零运行时依赖，放 engine 会让 core 产生一条 core → engine 反向边。
 */

import { hasMessage, t } from '@/i18n';

/**
 * 拆解维度标识（八维）。
 */
export type BreakdownDimension = 'style' | 'rhythm' | 'technique' | 'structure' | 'character' | 'foreshadow' | 'commercial' | 'readability';

/**
 * DeconstructionQualityLevel 类型定义。
 */
export type DeconstructionQualityLevel = 'fast' | 'standard' | 'deep';

/**
 * DeconstructionEngineSettings 类型定义。
 */
export interface DeconstructionEngineSettings {
    defaultQualityLevel: 'fast' | 'standard' | 'deep';
    enableAutoUpgrade: boolean;
    enabledDimensions: BreakdownDimension[];
    includeCommercial: boolean;
    includeReadability: boolean;
    /**
     * 是否启用朱雀人味检测（2026-11-25）。
     *
     * **默认关闭**：它会消耗 EdgeOne Makers 额度（每月 50 万 tokens）。
     * 开启后拆解多一个「朱雀人味检测」维度，返回真实的人工率占比。
     *
     * 为什么值得开：其余 8 个维度都是本地统计代理指标，
     * 与朱雀人工率的相关性弱（长句 r=0.150）。只有朱雀自己给的分才可信。
     */
    includeZhuque: boolean;
    /** 朱雀单次检测的最大字符数（超出截断，省额度） */
    zhuqueMaxChars: number;
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

/**
 * DEFAULT_DECONSTRUCTION_ENGINE_SETTINGS 常量。
 */
export const DEFAULT_DECONSTRUCTION_ENGINE_SETTINGS: DeconstructionEngineSettings = {
    defaultQualityLevel: 'standard',
    enableAutoUpgrade: true,
    enabledDimensions: ['style', 'rhythm', 'technique', 'structure', 'character', 'foreshadow'],
    includeCommercial: true,
    includeReadability: true,
    includeZhuque: false,
    zhuqueMaxChars: 20000,
    vectorEnabled: true,
    vectorModel: 'bge-m3',
    vectorCacheSize: 5000,
    vectorBatchSize: 32,
    llmEnabled: false,
    /**
     * LLM 增强模型：**必须云端**（2026-11-25 修正，用户明确要求）。
     *
     * 旧默认值是 `'deepseek-r1:7b'`（本地 Ollama），两个问题：
     * 1. 拆解增强要求严格 JSON 结构化输出，7B 级本地模型成功率低——用户实测「会出错」
     * 2. 本地模型走主线程串行调用，是知识库拆解卡死的直接原因之一
     *
     * 空字符串 = 未选择：用户必须显式选云端模型才能开 LLM 增强。
     * 注意：`vectorModel` 用本地是**正确**的（embedding 轻量、不要求结构化输出）。
     */
    llmModel: '',
    maxConcurrency: 2,
    textSampleLimit: 100000,
    dimensionConcurrency: 3,
    sampleMode: false,
};

/**
 * ALL_BREAKDOWN_DIMENSIONS 常量。
 */
export const ALL_BREAKDOWN_DIMENSIONS: BreakdownDimension[] = [
    'style', 'rhythm', 'technique', 'structure', 'character', 'foreshadow', 'commercial', 'readability',
];

/**
 * 维度标签列表常量。
 */
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

/** 维度显示名的资源键（界面用；引擎日志仍用上面的中文常量） */
export const DIMENSION_LABEL_KEYS: Record<BreakdownDimension, string> = {
    style: 'deconstruction.dimension.style',
    rhythm: 'deconstruction.dimension.rhythm',
    technique: 'deconstruction.dimension.technique',
    structure: 'deconstruction.dimension.structure',
    character: 'deconstruction.dimension.character',
    foreshadow: 'deconstruction.dimension.foreshadow',
    commercial: 'deconstruction.dimension.commercial',
    readability: 'deconstruction.dimension.readability',
};

/**
 * 取维度的界面显示名（跟随当前语言）。
 *
 * 未登记语言的资源缺失时回落到中文常量，避免英文界面出现裸键名。
 *
 * @param dim - 拆解维度
 * @returns 显示名
 */
export function dimensionLabel(dim: BreakdownDimension): string {
    const key = DIMENSION_LABEL_KEYS[dim];
    return key && hasMessage(key) ? t(key) : (DIMENSION_LABELS[dim] ?? dim);
}
