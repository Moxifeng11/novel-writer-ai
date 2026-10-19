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
export const FILE_READ_TIMEOUT_MS = 8_000;
export const CONTEXT_LOAD_TIMEOUT_MS = 5_000;

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
