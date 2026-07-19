/**
 * types.ts — 题材自适应框架类型定义
 *
 * 定义 GenreConfig 数据结构，作为所有拆解器获取题材相关关键词体系的统一入口。
 * 与 webnovel-knowledge-base.ts 中的 GenreConfig（知识库元数据）用途不同，
 * 本接口专注于"拆解引擎关键词体系"，按题材动态加载，避免硬编码单一题材。
 */

export interface BehaviorTrait {
    word: string;      // 行为词，如"大笑"
    trait: string;     // 性格标签，如"幽默"
}

export interface GenreConfig {
    genreId: string;                       // 题材 ID，如 "cultivation"
    displayName: string;                   // 显示名，如"修仙"
    behaviorTraits: BehaviorTrait[];       // 行为词 → 性格标签映射
    abilityKeywords: string[];             // 能力关键词
    techniqueKeywords: string[];           // 写作技巧关键词
    foreshadowTypes: string[];             // 伏笔类型关键词
    conflictKeywords: string[];            // 冲突词
    showSignalWords: string[];             // Show 信号词
    styleKeywords: string[];               // 风格关键词
    detectorSignals: string[];             // 题材识别特征词（用于 GenreDetector 识别题材）
    tensionKeywords?: TensionKeywords;     // 节奏强度关键词（按事件类型分类，可选；未提供时使用通用兜底）
    waveRhythmKeywords?: WaveRhythmKeywords; // 商业节奏关键词（爽点/反转/高潮三类，可选；未提供时使用通用兜底）
}

/**
 * 节奏强度关键词：按情绪事件类型分类。
 * 用于 rhythm-deconstructor 的 intensity 计算（keywordBoost）。
 * 题材相关词应从 genre.json 注入；通用词由源码兜底常量提供。
 */
export interface TensionKeywords {
    conflict: string[];      // 冲突/对峙词，如军事"厮杀"、修仙"斗法"
    suspense: string[];     // 悬念词，如悬疑"线索"、通用"究竟"
    reversal: string[];     // 反转词，如"然而"、"突然"
    cool_point: string[];   // 爽点词，如修仙"突破"、都市"逆袭"
    setback: string[];      // 挫折词，如"惨败"、"重伤"
    climax: string[];       // 高潮词，如"决战"、"宿命对决"
}

/**
 * 商业节奏关键词：分三类密度层级。
 * 用于 commercial-deconstructor 的 waveRhythm 计算（间隔与合规度）。
 * 题材相关词应从 genre.json 注入；通用词由源码兜底常量提供。
 */
export interface WaveRhythmKeywords {
    smallCool: string[];        // 小爽点词（期望间隔 2 章）
    mediumReversal: string[];   // 中型反转词（期望间隔 5 章）
    bigClimax: string[];        // 大型高潮词（期望间隔 15 章）
}

export interface GenreDetectionResult {
    genreId: string;
    confidence: number;       // 0-1
    primary?: string;
    secondary?: string;
}
