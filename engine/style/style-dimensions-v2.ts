/**
 * style-dimensions-v2.ts — 写作指纹 V2 12 维数据结构定义
 *
 * 设计原则：
 * - 每个维度包含：定量统计字段 + 定性描述字段 + 代表性示例 + 数据状态标记
 * - 数据状态：'complete'（完整）| 'pending'（待补全）| 'partial'（部分）
 * - V1 的 7 维（字符串描述）映射到 V2 对应维度的 description 字段
 * - 新增的 5 维在 V1→V2 迁移时填充默认值并标记为 'pending'
 *
 * 维度映射表（V1 → V2）：
 * 1. sentenceRhythm    → RhythmStats          (节奏)
 * 2. wordPreference    → WordChoiceStats      (用词)
 * 3. narrativeStyle    → PerspectiveStats     (视角)
 * 4. rhetoric          → RhetoricStatsV2      (修辞)
 * 5. dialogueStyle     → DialogueStatsV2      (对话)
 * 6. paragraphStructure → NarrationStats      (叙事)
 * 7. overallTone       → LanguageTextureStats (语言质感)
 *
 * 新增 5 维（迁移时标记为 'pending'）：
 * 8. SentencePatternStats  (句式)
 * 9. EmotionStats           (情绪)
 * 10. TensionStats          (张力)
 * 11. InfoDensityStats      (信息量)
 * 12. DescriptionStats      (描写)
 */

// ============================================================
// 通用类型
// ============================================================

/** 维度数据状态 */
export type DimensionStatus = 'complete' | 'pending' | 'partial';

/** 版本标识 */
export type FingerprintVersion = 'v1' | 'v2';

// ============================================================
// 1. RhythmStats — 节奏（对应 V1 sentenceRhythm + paragraphStructure 部分）
// ============================================================

/**
 * 节奏统计。
 */
export interface RhythmStats {
    // ── 定量统计 ──
    /** 句长分布（短/中/长占比，0-1） */
    sentenceLengthDistribution: { short: number; medium: number; long: number };
    /** 平均句长（字） */
    avgSentenceLength: number;
    /** 短句占比（≤10 字，0-1） */
    shortSentenceRatio: number;
    /** 标点密度（每千字标点数） */
    punctuationDensity: number;
    /** 段落密度（每千字段落数） */
    paragraphDensity: number;
    /** 停顿频率（逗号/顿号每千字数） */
    pauseFrequency: number;
    // ── 定性描述（50-100 字） ──
    description: string;
    // ── 代表性示例（2-3 段） ──
    samples: string[];
    // ── 数据状态 ──
    status: DimensionStatus;
}

// ============================================================
// 2. SentencePatternStats — 句式（新增维度）
// ============================================================

/**
 * 句式统计。
 */
export interface SentencePatternStats {
    // ── 定量统计 ──
    /** 倒装句密度（每千字） */
    inversionDensity: number;
    /** 省略句密度（每千字） */
    ellipsisDensity: number;
    /** 排比句密度（每千字） */
    parallelismDensity: number;
    /** 设问句比例（0-1） */
    rhetoricalQuestionRatio: number;
    /** 从句嵌套深度（平均层数） */
    clauseNestingDepth: number;
    // ── 定性描述 ──
    description: string;
    // ── 代表性示例 ──
    samples: string[];
    // ── 数据状态 ──
    status: DimensionStatus;
}

// ============================================================
// 3. WordChoiceStats — 用词（对应 V1 wordPreference）
// ============================================================

/**
 * 用词统计。
 */
export interface WordChoiceStats {
    // ── 定量统计 ──
    /** 常用词比例（0-1） */
    commonWordRatio: number;
    /** 生僻词比例（0-1） */
    rareWordRatio: number;
    /** 虚词比例（0-1） */
    functionWordRatio: number;
    /** 词长分布（1/2/3/4+ 字词占比） */
    wordLengthDistribution: { len1: number; len2: number; len3: number; len4plus: number };
    /** 四字格密度（每千字） */
    fourCharIdiomDensity: number;
    // ── 定性描述 ──
    description: string;
    // ── 代表性示例 ──
    samples: string[];
    // ── 数据状态 ──
    status: DimensionStatus;
}

// ============================================================
// 4. RhetoricStatsV2 — 修辞（对应 V1 rhetoric）
// ============================================================

/**
 * 修辞统计（v2）。
 */
export interface RhetoricStatsV2 {
    // ── 定量统计 ──
    /** 比喻密度（每千字） */
    metaphorDensity: number;
    /** 拟人密度（每千字） */
    personificationDensity: number;
    /** 夸张密度（每千字） */
    hyperboleDensity: number;
    /** 排比密度（每千字） */
    parallelismDensity: number;
    /** 对偶密度（每千字） */
    antithesisDensity: number;
    /** 通感检测（每千字） */
    synesthesiaDensity: number;
    // ── 定性描述 ──
    description: string;
    // ── 代表性示例 ──
    samples: string[];
    // ── 数据状态 ──
    status: DimensionStatus;
}

// ============================================================
// 5. PerspectiveStats — 视角（对应 V1 narrativeStyle）
// ============================================================

/**
 * 视角统计。
 */
export interface PerspectiveStats {
    // ── 定量统计 ──
    /** 人称分布（第一/第二/第三人称占比） */
    personDistribution: { first: number; second: number; third: number };
    /** 视角切换频率（每千字切换次数） */
    perspectiveSwitchFrequency: number;
    /** 叙述距离分布（远/中/近占比，0-1） */
    narrativeDistance: { far: number; medium: number; near: number };
    // ── 定性描述 ──
    description: string;
    // ── 代表性示例 ──
    samples: string[];
    // ── 数据状态 ──
    status: DimensionStatus;
}

// ============================================================
// 6. EmotionStats — 情绪（新增维度）
// ============================================================

/**
 * 情绪统计。
 */
export interface EmotionStats {
    // ── 定量统计 ──
    /** 情绪基调（如：压抑/昂扬/平静/激越） */
    emotionalTone: string;
    /** 情绪波动频率（每千字转折次数） */
    emotionalFluctuationFrequency: number;
    /** 情绪强度分布（低/中/高占比，0-1） */
    emotionalIntensityDistribution: { low: number; medium: number; high: number };
    /** 正负向情绪比例（正/负/中性占比，0-1） */
    valenceRatio: { positive: number; negative: number; neutral: number };
    // ── 定性描述 ──
    description: string;
    // ── 代表性示例 ──
    samples: string[];
    // ── 数据状态 ──
    status: DimensionStatus;
}

// ============================================================
// 7. TensionStats — 张力（新增维度）
// ============================================================

/**
 * 张力统计。
 */
export interface TensionStats {
    // ── 定量统计 ──
    /** 悬念密度（每千字悬念标记数） */
    suspenseDensity: number;
    /** 冲突频率（每千字冲突事件数） */
    conflictFrequency: number;
    /** 转折句密度（每千字） */
    turningPointDensity: number;
    /** 伏笔标记数（每千字） */
    foreshadowingMarkerCount: number;
    /** 高潮分布（章节位置占比，0-1） */
    climaxDistribution: { early: number; middle: number; late: number };
    // ── 定性描述 ──
    description: string;
    // ── 代表性示例 ──
    samples: string[];
    // ── 数据状态 ──
    status: DimensionStatus;
}

// ============================================================
// 8. InfoDensityStats — 信息量（新增维度）
// ============================================================

/**
 * 信息密度统计。
 */
export interface InfoDensityStats {
    // ── 定量统计 ──
    /** 信息密度（每百字新信息单元数） */
    infoDensity: number;
    /** 专有名词密度（每千字） */
    properNounDensity: number;
    /** 设定植入频率（每千字） */
    settingInjectionFrequency: number;
    /** 概念引入节奏（每千字新概念数） */
    conceptIntroductionRhythm: number;
    // ── 定性描述 ──
    description: string;
    // ── 代表性示例 ──
    samples: string[];
    // ── 数据状态 ──
    status: DimensionStatus;
}

// ============================================================
// 9. DialogueStatsV2 — 对话（对应 V1 dialogueStyle）
// ============================================================

/**
 * 对话统计（v2）。
 */
export interface DialogueStatsV2 {
    // ── 定量统计 ──
    /** 对话占比（0-1） */
    dialogueRatio: number;
    /** 对话风格标签（如：简练/啰嗦/俏皮/正式） */
    dialogueStyleTag: string;
    /** 台词个性化程度（0-1，越高越能区分角色） */
    personalizationLevel: number;
    /** 潜台词比例（0-1，含言外之意的对话占比） */
    subtextRatio: number;
    // ── 定性描述 ──
    description: string;
    // ── 代表性示例 ──
    samples: string[];
    // ── 数据状态 ──
    status: DimensionStatus;
}

// ============================================================
// 10. DescriptionStats — 描写（新增维度）
// ============================================================

/**
 * 描写统计。
 */
export interface DescriptionStats {
    // ── 定量统计 ──
    /** 环境描写占比（0-1） */
    environmentDescriptionRatio: number;
    /** 细节密度（每百字细节单元数） */
    detailDensity: number;
    /** 感官描写分布（视/听/触/嗅/味占比，0-1） */
    sensoryDistribution: { visual: number; auditory: number; tactile: number; olfactory: number; gustatory: number };
    // ── 定性描述 ──
    description: string;
    // ── 代表性示例 ──
    samples: string[];
    // ── 数据状态 ──
    status: DimensionStatus;
}

// ============================================================
// 11. NarrationStats — 叙事（对应 V1 paragraphStructure）
// ============================================================

/**
 * 叙述统计。
 */
export interface NarrationStats {
    // ── 定量统计 ──
    /** 叙事速度（每千字推进的剧情节点数） */
    narrationSpeed: number;
    /** 时间跳跃频率（每千字跳跃次数） */
    timeJumpFrequency: number;
    /** 场景切换频率（每千字切换次数） */
    sceneSwitchFrequency: number;
    // ── 定性描述 ──
    description: string;
    // ── 代表性示例 ──
    samples: string[];
    // ── 数据状态 ──
    status: DimensionStatus;
}

// ============================================================
// 12. LanguageTextureStats — 语言质感（对应 V1 overallTone）
// ============================================================

/**
 * 语言质感统计。
 */
export interface LanguageTextureStats {
    // ── 定量统计 ──
    /** 书面化程度（0-1，越高越书面化） */
    writtenLevel: number;
    /** 口语化程度（0-1，越高越口语化） */
    colloquialLevel: number;
    /** 古风化程度（0-1） */
    archaismLevel: number;
    /** 地域特色词检测（命中数每千字） */
    regionalWordDensity: number;
    // ── 定性描述 ──
    description: string;
    // ── 代表性示例 ──
    samples: string[];
    // ── 数据状态 ──
    status: DimensionStatus;
}

// ============================================================
// V2 12 维聚合类型
// ============================================================

/** V2 风格指纹特征 — 12 维完整定义 */
export interface StyleFingerprintFeaturesV2 {
    rhythm: RhythmStats;
    sentencePattern: SentencePatternStats;
    wordChoice: WordChoiceStats;
    rhetoric: RhetoricStatsV2;
    perspective: PerspectiveStats;
    emotion: EmotionStats;
    tension: TensionStats;
    infoDensity: InfoDensityStats;
    dialogue: DialogueStatsV2;
    description: DescriptionStats;
    narration: NarrationStats;
    languageTexture: LanguageTextureStats;
}

// ============================================================
// 维度键类型与常量
// ============================================================

/** V2 维度键（与 StyleFingerprintFeaturesV2 字段名对应） */
export type StyleDimensionKeyV2 = keyof StyleFingerprintFeaturesV2;

/** V2 维度元信息 */
export interface StyleDimensionMetaV2 {
    key: StyleDimensionKeyV2;
    name: string;        // 中文名
    icon: string;       // 图标标识（用于 UI）
    description: string;// 维度说明
    /** 是否为 V1 迁移来源（true=V1 有对应字段；false=新增维度） */
    fromV1: boolean;
}

/** V2 12 维常量数组（用于 UI 展示与遍历） */
export const STYLE_DIMENSIONS_V2: readonly StyleDimensionMetaV2[] = [
    {
        key: 'rhythm',
        name: '节奏',
        icon: 'pulse',
        description: '句长分布、短句占比、标点密度、段落密度、停顿频率',
        fromV1: true,
    },
    {
        key: 'sentencePattern',
        name: '句式',
        icon: 'list',
        description: '倒装句密度、省略句密度、排比句密度、设问句比例、从句嵌套深度',
        fromV1: false,
    },
    {
        key: 'wordChoice',
        name: '用词',
        icon: 'pencil',
        description: '常用词比例、生僻词比例、虚词比例、词长分布、四字格密度',
        fromV1: true,
    },
    {
        key: 'rhetoric',
        name: '修辞',
        icon: 'sparkles',
        description: '比喻密度、拟人密度、夸张密度、排比密度、对偶密度、通感检测',
        fromV1: true,
    },
    {
        key: 'perspective',
        name: '视角',
        icon: 'eye',
        description: '人称分布、视角切换频率、叙述距离（远/中/近）',
        fromV1: true,
    },
    {
        key: 'emotion',
        name: '情绪',
        icon: 'heart',
        description: '情绪基调、情绪波动频率、情绪强度分布、正负向情绪比例',
        fromV1: false,
    },
    {
        key: 'tension',
        name: '张力',
        icon: 'zap',
        description: '悬念密度、冲突频率、转折句密度、伏笔标记、高潮分布',
        fromV1: false,
    },
    {
        key: 'infoDensity',
        name: '信息量',
        icon: 'database',
        description: '信息密度、专有名词密度、设定植入频率、概念引入节奏',
        fromV1: false,
    },
    {
        key: 'dialogue',
        name: '对话',
        icon: 'message-circle',
        description: '对话占比、对话风格、台词个性化程度、潜台词比例',
        fromV1: true,
    },
    {
        key: 'description',
        name: '描写',
        icon: 'image',
        description: '环境描写占比、细节密度、感官描写分布（视/听/触/嗅/味）',
        fromV1: false,
    },
    {
        key: 'narration',
        name: '叙事',
        icon: 'book-open',
        description: '叙事速度、时间跳跃频率、场景切换频率',
        fromV1: true,
    },
    {
        key: 'languageTexture',
        name: '语言质感',
        icon: 'feather',
        description: '书面/口语化程度、古风化程度、地域特色词检测',
        fromV1: true,
    },
] as const;

/** V2 维度键列表 */
export const STYLE_DIMENSION_KEYS_V2: readonly StyleDimensionKeyV2[] = STYLE_DIMENSIONS_V2.map(d => d.key);

/** V2 维度中文名映射 */
export const STYLE_DIMENSION_LABELS_V2: Record<StyleDimensionKeyV2, string> = {
    rhythm: '节奏',
    sentencePattern: '句式',
    wordChoice: '用词',
    rhetoric: '修辞',
    perspective: '视角',
    emotion: '情绪',
    tension: '张力',
    infoDensity: '信息量',
    dialogue: '对话',
    description: '描写',
    narration: '叙事',
    languageTexture: '语言质感',
};

/** V2 维度数量 */
export const V2_DIMENSION_COUNT = 12;

/** V2 维度默认权重（均匀分布） */
export const STYLE_DIMENSION_WEIGHTS_V2: Record<StyleDimensionKeyV2, number> = {
    rhythm: 1 / 12,
    sentencePattern: 1 / 12,
    wordChoice: 1 / 12,
    rhetoric: 1 / 12,
    perspective: 1 / 12,
    emotion: 1 / 12,
    tension: 1 / 12,
    infoDensity: 1 / 12,
    dialogue: 1 / 12,
    description: 1 / 12,
    narration: 1 / 12,
    languageTexture: 1 / 12,
};

// ============================================================
// V1→V2 字段映射常量（供迁移工具使用）
// ============================================================

/** V1 字段名 → V2 维度键 的映射 */
export const V1_TO_V2_FIELD_MAP: Record<string, StyleDimensionKeyV2> = {
    sentenceRhythm: 'rhythm',
    wordPreference: 'wordChoice',
    narrativeStyle: 'perspective',
    rhetoric: 'rhetoric',
    dialogueStyle: 'dialogue',
    paragraphStructure: 'narration',
    overallTone: 'languageTexture',
};

/** V2 新增维度（无 V1 来源，迁移时标记为 pending） */
export const V2_NEW_DIMENSIONS: readonly StyleDimensionKeyV2[] = [
    'sentencePattern',
    'emotion',
    'tension',
    'infoDensity',
    'description',
];

// ============================================================
// V2 指纹完整类型 + V1 备份类型
// ============================================================

/** V1 指纹特征备份（迁移时保留原始数据） */
export interface V1FingerprintBackup {
    /** V1 原始 7 维特征（字符串描述） */
    features: Record<string, string>;
    /** V1 提取时间戳 */
    extractedAt: number;
    /** 迁移时间戳 */
    migratedAt: number;
}

/** V2 完整风格指纹（含版本标识与 V1 备份） */
export interface V2Fingerprint {
    id: string;
    name: string;
    source: string;
    scope: 'template' | 'global' | 'project';
    enabled: boolean;
    tags: string[];
    /** 版本标识：V2 指纹固定为 'v2' */
    version: FingerprintVersion;
    /** 基础统计（保留 V1 字段，后续可扩展） */
    stats: {
        avgSentenceLength: number;
        avgParagraphLength: number;
        dialogueRatio: number;
        descriptionRatio: number;
        wordCount: number;
    };
    /** V2 12 维特征 */
    features: StyleFingerprintFeaturesV2;
    samples: string[];
    extractedAt: number;
    sourceText?: string;
    /** 迁移时间戳（仅 V1→V2 迁移产生时存在） */
    migratedAt?: number;
    /** V1 原始数据备份（仅迁移产生时存在） */
    v1Backup?: V1FingerprintBackup;
}
