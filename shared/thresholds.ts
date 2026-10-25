/**
 * thresholds.ts — 全项目数值阈值常量 (v4.0)
 *
 * 目的：消除硬编码魔法数字。
 * v4.0 变更：章节完成判定从字节阈值改为 step_status 字段，旧阈值标记 @deprecated
 */

// ============================================================
// 一、文件内容最小长度阈值（字节）
// ============================================================
export const FILE_MIN_WORLDVIEW = 500;
export const FILE_MIN_SETTING_LIB = 300;
export const FILE_MIN_OUTLINE = 1000;
export const FILE_MIN_WRITING_STYLE = 500;
export const FILE_MIN_ENTITY_CONTENT = 100;
export const FILE_MIN_ENTITY_BODY = 50;
export const FILE_MIN_CHAPTER_SKELETON = 100;

// ============================================================
// 二、用户通知时长（毫秒）
// ============================================================
export const NOTICE_BRIEF = 2000;
export const NOTICE_SUCCESS = 3000;
export const NOTICE_INFO = 4000;
export const NOTICE_ERROR = 5000;
export const NOTICE_WARNING = 6000;
export const NOTICE_CRITICAL = 8000;
export const NOTICE_PERSIST = 0;

// ============================================================
// 三、超时 / 间隔
// ============================================================
export const TIMEOUT_COVER_PICKER = 60000;
export const POLISH_DEBOUNCE_MS = 500;

// ============================================================
// 四、Token / 字数估算
// ============================================================
export const MAX_CONTEXT_TOKENS = 128000;
export const INTERVENTION_MAX_TOKENS = 2000;
export const TOKEN_ESTIMATE_EN_DIVISOR = 4;
export const TOKEN_ESTIMATE_CN_DIVISOR = 1.5;
export const KB_DIVISOR = 1024;

// ============================================================
// 五、伏笔信息债阈值
// ============================================================
export const DEBT_SEVERE = 20;
export const DEBT_HIGH = 15;
export const DEBT_MODERATE = 10;
export const DEBT_LIGHT = 5;

// ============================================================
// 六、章节 / 实体抽查
// ============================================================
export const CHAPTER_SPOT_CHECK_MAX = 3;
export const SETTING_LIB_TEMPERATURE = 0.3;
export const DEFAULT_TEMPERATURE = 1.4;
export const TEMPERATURE_MIN = 0.1;
export const TEMPERATURE_MAX = 2.0;

// ============================================================
// 七、内容截断 / 显示限制
// ============================================================
export const SCENE_DESC_MAX_LEN = 80;
export const ACTION_CONTENT_MAX_LEN = 100;
export const REVIEW_ISSUE_MAX_LEN = 200;
export const IMPROVEMENT_MAX_LEN = 300;
export const WARNING_MAX_LEN = 500;
export const STYLE_SNIPPET_MAX_LEN = 1500;
export const SNAPSHOT_MAX_LEN = 3000;
export const UNDERSTANDING_OUTPUT_MAX_LEN = 4000;
export const INLINE_PREVIEW_MAX_LEN = 15000;

// ============================================================
// 八、编辑器阈值
// ============================================================
export const POLISH_MIN_SAVE_LEN = 100;
export const WORD_COUNT_WARN_RATIO = 0.7;

// ===== AI 调用超时与限制 =====
export const API_TIMEOUT_MS = 120_000;
export const ZAI_MAX_TOKENS = 131_072;
export const DEFAULT_CONTEXT_WINDOW = 32_768;
export const CHAR_TO_TOKEN_RATIO = 1.5;
/**
 * 协同写作单次建议的输出上限兜底。
 * 设置项允许用户填写任意正数，误填超大值（如 320000）会让本地 7B 模型
 * 一直生成到上下文耗尽，表现为「卡在调用中」，因此需要一个绝对兜底。
 *
 * 兜底值取 8192（本地 deepseek-r1:7b 的真实输出上限），不能更低：
 * 思考型模型（deepseek-flash / deepseek-r1）的思考与正文**共用**同一份预算，
 * 实测 5 次候选流式输出 reasoning_tokens 占 262~2000，硬顶 2000 时正文直接为空
 * （finish_reason=length，content 0 字），用户看到的是「一直在生成中」。
 * 建议卡片正文只需 1-2k token，但思考预算必须留足。
 */
export const CO_WRITE_MAX_TOKENS_CAP = 8_192;

/**
 * 协同写作请求给 Ollama 的上下文窗口。
 * 不传 num_ctx 时 Ollama 按模型自带上下文（deepseek-r1 为 131072）分配 KV 缓存，
 * 实测 8k prompt 的 prefill 需 104s；限制到 32768 后降到 55s（同机器同模型）。
 * 协同写作的 prompt 约 8k-12k token，32768 留足余量。
 */
export const CO_WRITE_NUM_CTX = 32_768;

// ===== AI 重试 / 限流 / 流式信号量轮询（P2-4 集中化） =====
/** 通用网络错误重试退避（每次重试后等待） */
export const AI_RETRY_BACKOFF_MS = 2_000;
/** HTTP 429 限流时的等待 */
export const AI_RATE_LIMIT_WAIT_MS = 3_000;
/** callAIStream 信号量轮询间隔（达到并发上限时） */
export const STREAM_SEMAPHORE_POLL_MS = 500;
/** 每个模型的内层最大重试次数（不含 fallback 切换） */
export const AI_MAX_ATTEMPTS_PER_MODEL = 3;

// ===== 上下文截断阈值 =====
export const WORLDVIEW_SLICE = 2_000;
export const PREV_SUMMARY_SLICE = 6_000;
export const BODY_STATE_SLICE = 6_000;
export const CONTEXT_LONG_SLICE = 3_000;
export const CONTEXT_SHORT_SLICE = 500;
export const CONTEXT_MICRO_SLICE = 300;
export const CONTEXT_NANO_SLICE = 100;
export const CONTEXT_XXL_SLICE = 15_000;

// ============================================================
// 九、v4.0: 模板骨架检测阈值（替代旧字节判定）
// ============================================================

/** 正文空模板最大字节数（超过此值=有实质内容） */
export const BODY_SKELETON_BYTES = 200;

/** 步骤文件空模板最大字节数 */
export const STEP_SKELETON_BYTES = 100;

// ============================================================

// ===== 伏笔与信息债阈值 =====
export const INFO_DEBT_MAX = 15;
export const INFO_DEBT_WARN_HIGH = 5;
export const INFO_DEBT_WARN_CRITICAL = 10;
export const FORCED_REVEAL_OVER_20 = 4;
export const FORCED_REVEAL_OVER_15 = 3;
export const FORCED_REVEAL_OVER_10 = 2;
export const FORCED_REVEAL_OVER_5 = 1;
export const FORCED_REVEAL_WINDOW_FORWARD = 5;
export const FORCED_REVEAL_WINDOW_BACKWARD = 3;

// ===== 其他阈值 =====
export const PROMPT_SPLIT_RATIO = 0.67;
export const WORD_MIN_RATIO = 0.70;
export const TOKEN_SAFE_BUFFER = 500;
export const TIMELINE_SLICE = 30;
export const FORESHADOW_SLICE = 20;
/** 距「计划回收章」还剩几章时开始提醒（协同偏离与全本工作台共用） */
export const FORESHADOW_APPROACHING_CHAPTERS = 3;

// ===== 检索相关性过滤（知识库/指纹向量共用） =====
/** 低于最高分的此比例视为离群：只删明显不相关的尾部，不追求精确卡点 */
export const RETRIEVAL_RELATIVE_MIN_SCORE = 0.85;
/** 最高分低于此值视为整批噪声（查询与库无关），不注入 */
export const RETRIEVAL_ABSOLUTE_MIN_SCORE = 0.15;
export const FILE_READ_TIMEOUT_MS = 8_000;
export const CONTEXT_LOAD_TIMEOUT_MS = 5_000;

// ============================================================
// 十、质量评分与偏离预警（唯一阈值来源，禁止在各引擎/UI 内另写）
// ============================================================

/** 质量等级分界：≥90 S / ≥80 A / ≥70 B / ≥60 C / 其余 D */
export const QUALITY_GRADE_S = 90;
export const QUALITY_GRADE_A = 80;
export const QUALITY_GRADE_B = 70;
export const QUALITY_GRADE_C = 60;

/** 分数着色分界：≥good 绿 / ≥warning 黄 / 其余红 */
export const QUALITY_SCORE_GOOD = 80;
export const QUALITY_SCORE_WARNING = 60;

/** 偏离度分界：≥critical 严重 / ≥warning 警告 */
export const DIVERGENCE_CRITICAL = 60;
export const DIVERGENCE_WARNING = 30;

/** 质量历史落盘上限（超出按时间裁剪最旧记录） */
export const QUALITY_HISTORY_MAX_RECORDS = 200;

/**
 * 章级质量趋势：当前章与前序章（按章聚合、每章只取最后一次评估）比较。
 *
 * 不能复用实时评估的「最近 5 次」：协同实时评估约 2.5s 一次，5 次只覆盖十几秒的
 * 打字波动，同一章内来回改几个字就会让箭头翻转；趋势的统计单位必须是「章」。
 */
export const QUALITY_CHAPTER_TREND = {
    /** 参与比较的前序章数 */
    windowSize: 5,
    /** 至少要有这么多前序章才判定趋势 */
    minChapters: 2,
    /** 当前章高出/低于前序章均分该值才判定上升/下降 */
    delta: 5,
} as const;

/**
 * 质量引擎可评估的最小正文长度。
 * 低于该值时 `WritingQualityEngine` 返回 0 分 / D 的空结果，这不是「写得差」而是「无法评估」；
 * 任何展示/落盘方都必须按「无数据」处理，不能渲染成分数或参与基线对比。
 */
export const QUALITY_MIN_EVALUABLE_CHARS = 100;

/**
 * 剧情完成度可评估的最小正文长度。
 * 低于该值时 `PlotCompletionEngine` 返回全 0 空结果：这是「无法评估」而非「完成度 0」，
 * 展示方必须显示无数据，且不能把它写进趋势历史。
 */
export const PLOT_COMPLETION_MIN_EVALUABLE_CHARS = 50;

/**
 * 剧情偏离可检测的最小正文长度。
 * 低于该值时 `PlotDivergenceEngine` 返回 0% / normal 空结果，
 * 若直接渲染会被读成「完全贴合大纲」，必须按无数据处理。
 */
export const DEVIATION_MIN_EVALUABLE_CHARS = 100;

/**
 * 协同写作实时质量落盘节流：正文达到该字数才记一条，且同一章至少间隔该时长。
 * 实时评估每 2.5s 触发一次，若不节流会变成「边打字边写盘」，且历史被同一章刷屏。
 */
export const QUALITY_LIVE_PERSIST_MIN_CHARS = 300;
export const QUALITY_LIVE_PERSIST_INTERVAL_MS = 10 * 60 * 1000;

/**
 * 输入触发的设定守卫（OOC / 实体状态变更）节流。
 *
 * 「输入」路径在停顿 8 秒后就会触发一次检查，而实体状态检测每次都会把正文前
 * 6000 字发给 AI：连续写作时等于每停一次就全量重扫一遍。这里要求「正文至少新增
 * 这么多字，或距上次检查已过冷却时间」才重新检测；插入建议 / 保存 / 手动检查不受限。
 */
export const GUARD_INPUT_MIN_GROWTH_CHARS = 300;
export const GUARD_INPUT_COOLDOWN_MS = 5 * 60 * 1000;

/**
 * 协同写作「剧情完成度」自动评估的 AI 调用节流。
 *
 * 侧边栏每 10 秒就允许一次 `evaluatePlotComplete`，而它会把整章正文拼成约 9.6k token
 * 的 prompt 发给 AI：只要开着 `autoPlotEvaluation`，打字期间每分钟最多 6 次请求，
 * 而正文往往只多了几十字。这里改为「正文有变化 + 新增 ≥ 门槛或冷却到期」才评估，
 * 并保留最小间隔，避免快速打字时连续触发；手动重试 / 生成完成后的强制刷新不受限。
 */
export const PLOT_EVAL_MIN_GROWTH_CHARS = 300;
export const PLOT_EVAL_COOLDOWN_MS = 2 * 60 * 1000;
export const PLOT_EVAL_MIN_INTERVAL_MS = 30 * 1000;

/**
 * 偏离度「持续上升」告警的最小时间跨度。
 *
 * 面板 B 每 500ms 就可能评估一次，若只看「最近 3 次评估」的数值，
 * 几秒钟内的三次编辑就会被判成「连续多章偏离度上升」，文案与事实不符。
 * 只有这三次评估至少跨过 2 分钟，才认为是持续上升。
 */
export const DIVERGENCE_RISING_MIN_WINDOW_MS = 2 * 60 * 1000;

/**
 * 协同写作「自动联想（幽灵建议）」的最小请求间隔。
 *
 * 输入停顿 1.5 秒就会触发一次自动联想，而尾部种子只要多一个字就算「变了」：
 * 慢速打字（每 2 秒一个字）会变成每分钟约 30 次 AI 请求，本地模型会被持续占满。
 * 两次自动联想至少间隔这么久；切章 / 首次输入不受限（`lastAt = 0`）。
 */
export const GHOST_ASSOCIATION_MIN_INTERVAL_MS = 4 * 1000;

/**
 * 协同写作偏离检测的人物设定缓存时长。
 * 人物档案不随打字变化，但可能在别处被编辑；60s 后可重新读取，避免设定改动永久不生效。
 */
export const DEVIATION_CHARACTER_INFO_TTL_MS = 60 * 1000;

/** 协同写作「编辑验证」通过线：三项分数均需 ≥ 此值 */
export const EDIT_VALIDATION_PASS_SCORE = 60;

/** 质量基线校准：至少需要的样本数（不足则不输出基线对比） */
export const QUALITY_BASELINE_MIN_SAMPLES = 3;
/** 质量基线校准：|z| 小于该值视为「与基线持平」 */
export const QUALITY_BASELINE_AT_SIGMA = 0.5;

// ============================================================
// 十一、知识库原文分块（Phase 4.3：检索对象改为原文而非拆解报告）
// ============================================================

/** 单个原文分块的目标字数 */
export const KB_ORIGINAL_CHUNK_SIZE = 400;
/** 分块最小字数（过短的段落不单独成块） */
export const KB_ORIGINAL_CHUNK_MIN = 40;
/** 单本书最多入库的分块数（超出后按全文均匀采样） */
export const KB_ORIGINAL_CHUNK_MAX = 120;

// ============================================================
// 十二、质量维度内部校准系数（Phase 1.2b）
//
// 与第十节的「等级 / 预警阈值」区分：这里放的是打分公式自身的
// 「维度权重 + 子项权重 + 标定乘数 + 理想区间」。
// 改动任一数值都会改变分数，必须同步回归
// quality-score-engine / writing-quality-engine 的测试。
// ============================================================

/** WritingQualityEngine 六维 → 总分权重（和为 1） */
export const WQE_DIMENSION_WEIGHTS = {
    language: 0.20,
    rhythm: 0.15,
    character: 0.20,
    plot: 0.20,
    atmosphere: 0.10,
    structure: 0.15,
} as const;

/** QualityScoreEngine 六维 → 总分权重（未注入统一内核时的兜底路径） */
export const QSE_DIMENSION_WEIGHTS = {
    readability: 0.18,
    rhythm: 0.17,
    emotion: 0.17,
    characterConsistency: 0.18,
    coherence: 0.15,
    languageTexture: 0.15,
} as const;

/** WritingQualityEngine 维度内子项权重（每个维度内和为 1） */
export const WQE_SUB_WEIGHTS = {
    language: { vocab: 0.3, variety: 0.3, rhetoric: 0.25, typo: 0.15 },
    rhythm: { paceVariety: 0.25, balance: 0.3, dialogue: 0.2, sceneShift: 0.15, action: 0.1 },
    character: { mention: 0.25, dialogue: 0.25, action: 0.2, depth: 0.15, personality: 0.15 },
    plot: { conflict: 0.25, suspense: 0.2, cool: 0.2, logic: 0.2, foreshadow: 0.15 },
    atmosphere: { environment: 0.3, emotion: 0.3, sense: 0.25, immersion: 0.15 },
    structure: { opening: 0.3, middle: 0.3, ending: 0.25, balance: 0.15 },
} as const;

/** WritingQualityEngine 标定乘数 / 理想值 */
export const WQE_CALIBRATION = {
    language: {
        /** 词汇丰富度采样上限（超过按 500 计，避免短文虚高） */
        vocabSampleCap: 500,
        /** 词汇丰富度 → 分数放大倍数 */
        vocabScale: 1.5,
        /** 句长标准差 / 平均句长 → 句式多样性倍数 */
        sentenceVarietyScale: 200,
        /** 每处修辞的得分 */
        rhetoricPerHit: 8,
        /** 每处用字问题的扣分 */
        typoPenaltyPerHit: 5,
        /** 每组重复用字的扣分 */
        repeatPenaltyPerHit: 10,
    },
    rhythm: {
        /** 段落节奏方差 → 多样性倍数 */
        paceVarianceScale: 100,
        /** 每处场景切换的得分 */
        sceneShiftPerHit: 25,
        /** 对话占比 → 分数倍数 */
        dialogueScale: 250,
        /** 动作密度 → 分数倍数 */
        actionScale: 20,
    },
    character: {
        /** 每次人物提及的得分 */
        mentionScale: 4,
        /** 对话句占比 → 分数倍数 */
        dialogueScale: 200,
        /** 每处角色动作的得分 */
        actionScale: 10,
        /** 角色立体感基础分 */
        depthBase: 40,
        /** 每个多角度角色的加分 */
        depthPerCharacter: 20,
        /** 触发立体感加成的最少提及次数 */
        depthMinMentions: 3,
    },
    plot: {
        suspensePerHit: 12,
        coolPerHit: 15,
        conflictPerHit: 10,
        /** 逻辑链基础分 */
        logicBase: 50,
        /** 每个因果关联词的加分 */
        logicPerHit: 8,
        foreshadowPerHit: 15,
    },
    atmosphere: {
        environmentPerHit: 6,
        emotionPerHit: 8,
        sensePerHit: 12,
        /** 第一人称代入感基础分 */
        firstPersonBase: 60,
        firstPersonPerHit: 3,
        /** 第三人称代入感基础分 */
        thirdPersonBase: 50,
        thirdPersonPerHit: 0.5,
        /** 判定为第一人称主导的代词占比 */
        firstPersonRatioMin: 0.3,
    },
    structure: {
        /** 开篇有钩子时的基础分 */
        openingBase: 30,
        openingPerHook: 20,
        /** 开篇篇幅落在理想区间的加分 */
        openingLengthBonus: 10,
        openingLengthMin: 50,
        openingLengthMax: 500,
        /** 中段基础分与密度放大倍数 */
        middleBase: 40,
        middleDensityScale: 100,
        /** 结尾基础分、每钩子加分、篇幅理想加分 */
        endingBase: 40,
        endingPerHook: 15,
        endingLengthBonus: 10,
        endingLengthMin: 30,
        endingLengthMax: 300,
        /** 头/中/尾篇幅偏离惩罚倍数 */
        balancePenaltyScale: 150,
        /** 头/中/尾理想篇幅占比 */
        idealFirstRatio: 0.2,
        idealMiddleRatio: 0.6,
        idealLastRatio: 0.2,
    },
    /** 动静平衡：理想密度与偏离惩罚 */
    balance: {
        idealActionRatio: 2.5,
        idealDialogueRatio: 0.25,
        idealDescRatio: 12,
        deviationScale: 80,
    },
    /** 对话辨识度 */
    dialoguePersonality: {
        minDialogues: 5,
        startWeight: 0.3,
        endWeight: 0.3,
        lengthWeight: 0.4,
        /** 与平均句长偏离超过该比例视为「长度有变化」 */
        lengthDeviationRatio: 0.5,
    },
    /** 趋势判定 */
    trend: {
        minSamples: 3,
        windowSize: 5,
        /** 前后半段均分差超过该值视为上升/下降 */
        delta: 5,
        historyMax: 20,
    },
    /** 字数里程碑 */
    milestones: [500, 1000, 2000, 3000, 5000] as readonly number[],
} as const;

/** QualityScoreEngine 兜底启发式的子项权重 */
export const QSE_SUB_WEIGHTS = {
    readability: { sentenceLength: 0.3, variety: 0.25, vocab: 0.2, punctuation: 0.1, typo: 0.15 },
    rhythmAnalyzer: { paceVariety: 0.35, typeDiversity: 0.35, tension: 0.3 },
    emotionAnalyzer: { variety: 0.3, intensity: 0.3, volatility: 0.2, arc: 0.2 },
    emotionFallback: { emotion: 0.6, balance: 0.4 },
    characterFallback: { mention: 0.4, personality: 0.6 },
    coherence: { coherence: 0.5, causality: 0.3, timeline: 0.2 },
    languageTexture: { rhetoric: 0.3, precision: 0.25, style: 0.25, uniqueness: 0.2 },
    /** C2：V1 内核路径下 languageTexture 由 languageQuality.details 派生时的子项权重 */
    languageTextureFromV1: { vocab: 0.6, rhetoric: 0.4 },
} as const;

/** QualityScoreEngine 兜底启发式的标定乘数 / 理想区间 */
export const QSE_CALIBRATION = {
    readability: {
        idealSentenceMin: 15,
        idealSentenceMax: 30,
        hardSentenceMin: 5,
        hardSentenceMax: 60,
        sentenceVarietyScale: 200,
        vocabSampleCap: 500,
        vocabScale: 1.5,
        idealPunctMin: 0.05,
        idealPunctMax: 0.12,
        hardPunctMin: 0.02,
        hardPunctMax: 0.2,
        typoPenaltyPerHit: 5,
        repeatPenaltyPerHit: 10,
    },
    rhythmAnalyzer: {
        /** 紧张度 = 均值 × avg + 峰值 × max */
        tensionAvgWeight: 0.6,
        tensionMaxWeight: 0.4,
        /** 单一节奏占比超过该值判为偏快/偏慢 */
        dominantPaceRatio: 0.5,
        minSegments: 4,
    },
    rhythmFallback: {
        idealActionRatio: 2.5,
        idealDialogueRatio: 2.5,
        idealDescRatio: 12,
        deviationScale: 80,
    },
    emotionAnalyzer: {
        varietyPerType: 20,
        idealVolatilityMin: 15,
        idealVolatilityMax: 30,
        hardVolatilityMin: 0,
        hardVolatilityMax: 60,
        arcWaveScore: 100,
        arcRiseFallScore: 75,
        arcFlatScore: 50,
    },
    emotionFallback: {
        emotionPerHit: 8,
        balancePenaltyPerHit: 10,
        /** 无情绪词时的平衡分 */
        neutralBalanceScore: 50,
    },
    characterFallback: {
        mentionScale: 4,
        /** 对话辨识度基础分与首尾变化权重 */
        personalityBase: 40,
        startWeight: 0.3,
        endWeight: 0.3,
        minDialogues: 5,
    },
    coherence: {
        duplicateSentencePenalty: 15,
        repeatedPhrasePenalty: 10,
        otherPenalty: 5,
        /** 单类问题计入扣分的最大次数 */
        countCap: 5,
        causalityBase: 50,
        causalityPerHit: 8,
        timelineBase: 50,
        timelinePerHit: 10,
    },
    languageTexture: {
        rhetoricPerHit: 8,
        idealPrecisionMin: 0.6,
        idealPrecisionMax: 0.75,
        hardPrecisionMin: 0.3,
        hardPrecisionMax: 0.9,
        defaultStyleScore: 70,
        /** 与目标指纹差值小于该值视为匹配 */
        styleMatchTolerance: 0.2,
        rareCharScale: 300,
    },
} as const;

// ============================================================
// R3-7: 按模型动态超时
// ============================================================

/** 模型默认超时（兜底值） */
export const MODEL_TIMEOUT_DEFAULT_MS = 120_000;

/**
 * 模型 → 超时映射表。
 * getTimeoutForModel 使用 lowercase + includes 子串匹配，因此：
 * 1. 更具体的 key 必须排在更宽泛的 key 之前（如 'deepseek-v3-2' 在 'deepseek-v3' 前）
 * 2. 'default' 作为兜底，总是最后匹配
 */
export const MODEL_TIMEOUT_MAP: Record<string, number> = {
    // ── 推理 / 大模型（响应慢）180s ──
    'deepseek-reasoner': 180_000,
    'deepseek-r1': 180_000,
    'deepseek-v4-pro': 180_000,
    'doubao-seed-2-0-pro': 180_000,
    'doubao-seed-2-0-code': 180_000,
    'glm-4-plus': 180_000,
    'glm-4-7': 180_000,
    'claude-4-opus': 180_000,
    'claude-opus': 180_000,

    // ── Flash/轻量模型（响应快）60s ──
    'deepseek-v4-flash': 60_000,
    'doubao-seed-1-8': 60_000,
    'glm-4-flash': 60_000,
    'glm-4-air': 60_000,
    'gpt-4.1-nano': 60_000,
    'gpt-4.1-mini': 60_000,
    'gpt-4o-mini': 60_000,
    'claude-haiku': 60_000,

    // ── 标准模型 90s ──
    'deepseek-v3-2': 90_000,
    'deepseek-v3': 90_000,
    'deepseek-chat': 90_000,

    // ── 标准模型 120s ──
    'gpt-4.1': 120_000,
    'gpt-4o': 120_000,
    'claude-3.7-sonnet': 120_000,
    'claude-sonnet': 120_000,
    'qwen2.5': 120_000,

    // 兜底（必须排在最后，因为所有模型 ID 都包含空串）
    'default': MODEL_TIMEOUT_DEFAULT_MS,
};

/**
 * 根据模型 ID 返回对应的超时毫秒数。
 * 使用子串匹配：modelId 中包含 map key 即视为匹配。
 * 无匹配时返回 MODEL_TIMEOUT_DEFAULT_MS (120s)。
 */
export function getTimeoutForModel(modelId: string): number {
    const lower = modelId.toLowerCase();
    const key = Object.keys(MODEL_TIMEOUT_MAP).find(k => lower.includes(k.toLowerCase()));
    return key ? MODEL_TIMEOUT_MAP[key] : MODEL_TIMEOUT_DEFAULT_MS;
}

// ============================================================
// R1: 业务阈值运行时可覆盖
//
// 目的：把「真正被读取的业务阈值」开放为设置项，同时保持零行为变化——
// 未在设置中填写时，生效值与上面的内置常量完全一致。
// 仅纳入当前确实被调用的比例型阈值；阈值的定义权仍在本文件（单一事实源）。
// ============================================================

/** 可被设置项覆盖的业务阈值键 → 内置默认值（均为 0-1 比例型） */
export const BUSINESS_THRESHOLD_DEFAULTS = {
    /** 步骤输出最低字数比例（相对目标字数），见 step-definitions.postCheckWordCount */
    wordMinRatio: WORD_MIN_RATIO,
    /** 超长提示词保留头部的比例，见 step-runner 上下文截断 */
    promptSplitRatio: PROMPT_SPLIT_RATIO,
} as const;

export type BusinessThresholdKey = keyof typeof BUSINESS_THRESHOLD_DEFAULTS;

const businessThresholdOverrides = new Map<BusinessThresholdKey, number>();

/**
 * 应用业务阈值覆盖。非法值（非有限数、≤0、>1）会被忽略并回落到内置默认值，
 * 因此调用方即使传入空设置也不改变现有行为。
 */
export function setBusinessThresholdOverrides(
    next: Partial<Record<BusinessThresholdKey, number | undefined>>
): void {
    for (const key of Object.keys(BUSINESS_THRESHOLD_DEFAULTS) as BusinessThresholdKey[]) {
        const value = next?.[key];
        if (typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1) {
            businessThresholdOverrides.set(key, value);
        } else {
            businessThresholdOverrides.delete(key);
        }
    }
}

/** 读取当前生效的业务阈值（未覆盖时返回内置默认值） */
export function getBusinessThreshold(key: BusinessThresholdKey): number {
    return businessThresholdOverrides.get(key) ?? BUSINESS_THRESHOLD_DEFAULTS[key];
}
